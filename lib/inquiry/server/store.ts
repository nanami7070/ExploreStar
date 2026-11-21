/**
 * Server store for inquiry studies.
 *
 * Every write is one transaction on a row locked with `SELECT ... FOR UPDATE`:
 * the command id makes a retried request idempotent, the expected revision
 * makes a stale browser fail with CONFLICT and a fresh state, and state plus
 * events are written together so replay never sees a half-applied command
 * (plan §3.10).
 */
import { randomUUID } from 'node:crypto';

import type { Queryable } from '@openmaic/storage/document/pg';

import {
  applyInquiryEvent,
  createInquirySessionState,
} from '@/lib/inquiry/domain/state';
import type { InquiryEvent } from '@/lib/inquiry/domain/events';
import {
  completePhase,
  confirmSubmission,
  recordChatMessage,
  recordDifficulty,
  recordExperiment,
  recordObservation,
  recordSafetyFlag,
  requestHint,
  revertPhase,
  startSession,
  submitSubmission,
  type InquiryTransition,
} from '@/lib/inquiry/domain/transition';
import { PHASE_IDS } from '@/lib/inquiry/domain/types';
import type {
  ChatMessageRecord,
  ChatMessageRole,
  DifficultyType,
  HintLevel,
  InquirySessionState,
  InquiryTask,
  SafetyFlagKind,
  SessionStatus,
} from '@/lib/inquiry/domain/types';
import { FLOAT_SINK_TASK } from '@/lib/inquiry/tasks/float-sink';
import { ensureInquirySchema } from '@/lib/persistence/inquiry-tables';

import type { InquiryStudyAction } from '@/lib/inquiry/actions';

import type { InquiryDb, InquiryQueryable } from './db';
import { rebuildInquiryProjections } from './projections';

export type { InquiryStudyAction } from '@/lib/inquiry/actions';

export const INQUIRY_TASKS: readonly InquiryTask[] = [FLOAT_SINK_TASK];

export type InquiryStoreErrorCode =
  | 'NOT_FOUND'
  | 'CONFLICT'
  | 'INVALID_PAYLOAD'
  | 'TASK_NOT_FOUND'
  | 'REPORT_NOT_READY'
  | 'PERSISTENCE_UNAVAILABLE';

export class InquiryStoreError extends Error {
  constructor(
    readonly code: InquiryStoreErrorCode,
    message: string,
    /** Latest study state, for a 409 the client can recover from. */
    readonly study?: InquiryStudy,
  ) {
    super(message);
    this.name = 'InquiryStoreError';
  }
}

export interface InquiryStudy {
  id: string;
  taskId: string;
  ownerId: string;
  learnerKey: string;
  state: InquirySessionState;
  status: SessionStatus;
  revision: number;
  task: InquiryTask;
}

export interface TaskSummary {
  id: string;
  key: string;
  name: string;
  grade: string;
  goals: string[];
  intro: { title: string; text: string };
  published: boolean;
}

export interface CommandOutcome {
  study: InquiryStudy;
  /** The events this command appended (replayed ones for a duplicate). */
  events: InquiryEvent[];
  replayed: boolean;
}

// ---------------------------------------------------------------------------
// Bootstrap and seeding
// ---------------------------------------------------------------------------

const readyByDb = new WeakMap<InquiryDb, Promise<void>>();

export function ensureInquiryReady(db: InquiryDb): Promise<void> {
  let ready = readyByDb.get(db);
  if (!ready) {
    ready = (async () => {
      await ensureInquirySchema(db as unknown as Queryable);
      await seedInquiryTasks(db);
    })();
    // Let a later request retry after a failure (e.g. the database was down).
    ready.catch(() => readyByDb.delete(db));
    readyByDb.set(db, ready);
  }
  return ready;
}

/**
 * Insert or refresh the seeded tasks. A human review verdict (`published`)
 * is never overwritten by seeding; a version bump refreshes the content.
 */
export async function seedInquiryTasks(
  db: InquiryQueryable,
  tasks: readonly InquiryTask[] = INQUIRY_TASKS,
): Promise<void> {
  for (const task of tasks) {
    await db.query(
      `INSERT INTO inquiry_tasks
         (id, key, name, grade, version, goals, concepts, knowledge, intro,
          materials, liquids, safety, phases, definition, published)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
       ON CONFLICT (key) DO UPDATE SET
         name = EXCLUDED.name,
         grade = EXCLUDED.grade,
         version = EXCLUDED.version,
         goals = EXCLUDED.goals,
         concepts = EXCLUDED.concepts,
         knowledge = EXCLUDED.knowledge,
         intro = EXCLUDED.intro,
         materials = EXCLUDED.materials,
         liquids = EXCLUDED.liquids,
         safety = EXCLUDED.safety,
         phases = EXCLUDED.phases,
         definition = EXCLUDED.definition,
         updated_at = now()
       WHERE inquiry_tasks.version <> EXCLUDED.version`,
      [
        task.id,
        task.key,
        task.name,
        task.grade,
        task.version,
        JSON.stringify(task.goals),
        JSON.stringify(task.concepts),
        JSON.stringify(task.knowledge),
        JSON.stringify(task.intro),
        JSON.stringify(task.materials),
        JSON.stringify(task.liquids),
        JSON.stringify(task.safety),
        JSON.stringify(task.phases),
        JSON.stringify(task),
        task.published,
      ],
    );
  }
}

export async function listInquiryTasks(db: InquiryQueryable): Promise<TaskSummary[]> {
  // Personal (student-generated) tasks never appear in the shared task list;
  // their studies show up under the student's own "我的探究".
  const result = await db.query(
    `SELECT id, key, name, grade, goals, intro, published
     FROM inquiry_tasks
     WHERE owner_id IS NULL
     ORDER BY created_at, key`,
  );
  return result.rows.map((row) => ({
    id: String(row.id),
    key: String(row.key),
    name: String(row.name),
    grade: String(row.grade),
    goals: readJson<string[]>(row.goals) ?? [],
    intro: readJson<{ title: string; text: string }>(row.intro) ?? { title: '', text: '' },
    published: row.published === true,
  }));
}

export async function getInquiryTask(
  db: InquiryQueryable,
  key: string,
): Promise<InquiryTask | null> {
  const result = await db.query(`SELECT definition FROM inquiry_tasks WHERE key = $1`, [key]);
  return parseTaskDefinition(result.rows[0]?.definition);
}

// ---------------------------------------------------------------------------
// Study reads
// ---------------------------------------------------------------------------

export async function loadInquiryStudy(
  db: InquiryQueryable,
  studyId: string,
  ownerId: string,
): Promise<InquiryStudy | null> {
  return loadStudyTx(db, studyId, ownerId);
}

/**
 * Teacher read access by id. The caller must already have passed the teacher
 * token check; this function deliberately has no owner filter.
 */
export async function loadInquiryStudyForTeacher(
  db: InquiryQueryable,
  studyId: string,
): Promise<InquiryStudy | null> {
  const result = await db.query(
    `SELECT id, task_id, owner_id, learner_key, state, status, revision
     FROM inquiry_studies WHERE id = $1`,
    [studyId],
  );
  const row = result.rows[0];
  if (!row) return null;
  return rowToStudy(db, row as unknown as StudyRow);
}

export async function loadInquiryStudyEvents(
  db: InquiryQueryable,
  studyId: string,
  ownerId: string,
  afterSequence: number,
): Promise<InquiryEvent[] | null> {
  const owned = await db.query(`SELECT 1 FROM inquiry_studies WHERE id = $1 AND owner_id = $2`, [
    studyId,
    ownerId,
  ]);
  if (!owned.rows.length) return null;
  return readEventsAfter(db, studyId, afterSequence);
}

export async function getInquiryCommandResult(
  db: InquiryQueryable,
  studyId: string,
  ownerId: string,
  commandId: string,
): Promise<Record<string, unknown> | null> {
  const result = await db.query(
    `SELECT c.result FROM inquiry_commands c
     JOIN inquiry_studies s ON s.id = c.study_id
     WHERE c.study_id = $1 AND c.command_id = $2 AND s.owner_id = $3`,
    [studyId, commandId, ownerId],
  );
  return readJson<Record<string, unknown>>(result.rows[0]?.result);
}

// ---------------------------------------------------------------------------
// Study creation
// ---------------------------------------------------------------------------

export interface CreateStudyInput {
  ownerId: string;
  taskKey: string;
  commandId: string;
  learnerKey?: string;
}

export async function createInquiryStudy(
  db: InquiryDb,
  input: CreateStudyInput,
): Promise<CommandOutcome> {
  try {
    return await db.transaction((tx) => createInTransaction(tx, input));
  } catch (error) {
    // Two concurrent creates with one command id: the unique index lets one
    // win; the loser answers with the winner's study.
    if ((error as { code?: string }).code === '23505') {
      return db.transaction((tx) => createInTransaction(tx, input));
    }
    throw error;
  }
}

async function createInTransaction(
  tx: InquiryQueryable,
  input: CreateStudyInput,
): Promise<CommandOutcome> {
  const existing = await tx.query(
    `SELECT id FROM inquiry_studies WHERE owner_id = $1 AND creation_command_id = $2`,
    [input.ownerId, input.commandId],
  );
  const existingId = existing.rows[0]?.id;
  if (existingId) {
    const study = await loadStudyTx(tx, String(existingId), input.ownerId);
    if (!study) throw new InquiryStoreError('NOT_FOUND', 'the created study is gone');
    const events = await readEventsAfter(tx, study.id, 0);
    return { study, events, replayed: true };
  }

  const task = await getInquiryTask(tx, input.taskKey);
  if (!task) throw new InquiryStoreError('TASK_NOT_FOUND', `unknown task ${input.taskKey}`);

  const initial = createInquirySessionState(task);
  const started = startSession(task, initial);
  const studyId = `study-${randomUUID()}`;
  const learnerKey = input.learnerKey ?? input.ownerId;
  await tx.query(
    `INSERT INTO inquiry_studies
       (id, task_id, owner_id, learner_key, state, status, revision, creation_command_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
    [
      studyId,
      task.id,
      input.ownerId,
      learnerKey,
      JSON.stringify(started.state),
      started.state.status,
      1,
      input.commandId,
    ],
  );
  await insertEvents(tx, studyId, initial.lastSequence, started.events);

  return {
    study: {
      id: studyId,
      taskId: task.id,
      ownerId: input.ownerId,
      learnerKey,
      state: started.state,
      status: started.state.status,
      revision: 1,
      task,
    },
    events: started.events,
    replayed: false,
  };
}

// ---------------------------------------------------------------------------
// Student-generated task drafts
// ---------------------------------------------------------------------------

/**
 * An AI-generated task definition owned by one student. Drafts are versioned:
 * every regeneration bumps `version`. Confirming a draft turns it into a
 * personal row in `inquiry_tasks` and creates the study in the same
 * transaction, so the study's task definition is a durable snapshot.
 */
export interface TaskDraft {
  id: string;
  ownerId: string;
  originalQuestion: string;
  refinedQuestion: string | null;
  definition: InquiryTask;
  version: number;
  status: 'draft' | 'confirmed';
  confirmedStudyId: string | null;
  updatedAt: string;
}

export interface SaveTaskDraftInput {
  ownerId: string;
  /** Present when regenerating an existing draft. */
  draftId?: string;
  originalQuestion: string;
  refinedQuestion: string;
  definition: InquiryTask;
  feedback?: string;
}

interface DraftRow {
  id: string;
  owner_id: string;
  original_question: string;
  refined_question: string | null;
  definition: unknown;
  version: number | string;
  status: string;
  confirmed_study_id: string | null;
  updated_at: string | Date;
}

function rowToDraft(row: DraftRow): TaskDraft | null {
  const definition = parseTaskDefinition(row.definition);
  if (!definition) return null;
  return {
    id: row.id,
    ownerId: row.owner_id,
    originalQuestion: row.original_question,
    refinedQuestion: row.refined_question,
    definition,
    version: Number(row.version),
    status: row.status === 'confirmed' ? 'confirmed' : 'draft',
    confirmedStudyId: row.confirmed_study_id,
    updatedAt:
      row.updated_at instanceof Date ? row.updated_at.toISOString() : String(row.updated_at),
  };
}

const DRAFT_COLUMNS = `id, owner_id, original_question, refined_question, definition,
  version, status, confirmed_study_id, updated_at`;

export async function saveTaskDraft(
  db: InquiryDb,
  input: SaveTaskDraftInput,
): Promise<TaskDraft> {
  if (input.draftId) {
    return db.transaction(async (tx) => {
      const existing = await tx.query(
        `SELECT ${DRAFT_COLUMNS} FROM inquiry_task_drafts
         WHERE id = $1 AND owner_id = $2 FOR UPDATE`,
        [input.draftId, input.ownerId],
      );
      const row = existing.rows[0] as unknown as DraftRow | undefined;
      if (!row) throw new InquiryStoreError('NOT_FOUND', 'unknown task draft');
      if (row.status === 'confirmed') {
        throw new InquiryStoreError('CONFLICT', 'this draft was already confirmed');
      }
      const updated = await tx.query(
        `UPDATE inquiry_task_drafts SET
           refined_question = $3,
           definition = $4,
           version = version + 1,
           feedback = $5,
           updated_at = now()
         WHERE id = $1 AND owner_id = $2
         RETURNING ${DRAFT_COLUMNS}`,
        [
          input.draftId,
          input.ownerId,
          input.refinedQuestion,
          JSON.stringify(input.definition),
          input.feedback ?? null,
        ],
      );
      const draft = rowToDraft(updated.rows[0] as unknown as DraftRow);
      if (!draft) throw new InquiryStoreError('INVALID_PAYLOAD', 'draft definition is unreadable');
      return draft;
    });
  }

  const result = await db.query(
    `INSERT INTO inquiry_task_drafts
       (id, owner_id, original_question, refined_question, definition, version, status, feedback)
     VALUES ($1,$2,$3,$4,$5,1,'draft',$6)
     RETURNING ${DRAFT_COLUMNS}`,
    [
      `draft-${randomUUID()}`,
      input.ownerId,
      input.originalQuestion,
      input.refinedQuestion,
      JSON.stringify(input.definition),
      input.feedback ?? null,
    ],
  );
  const draft = rowToDraft(result.rows[0] as unknown as DraftRow);
  if (!draft) throw new InquiryStoreError('INVALID_PAYLOAD', 'draft definition is unreadable');
  return draft;
}

export async function getTaskDraft(
  db: InquiryQueryable,
  draftId: string,
  ownerId: string,
): Promise<TaskDraft | null> {
  const result = await db.query(
    `SELECT ${DRAFT_COLUMNS} FROM inquiry_task_drafts WHERE id = $1 AND owner_id = $2`,
    [draftId, ownerId],
  );
  const row = result.rows[0] as unknown as DraftRow | undefined;
  return row ? rowToDraft(row) : null;
}

export interface ConfirmDraftInput {
  draftId: string;
  ownerId: string;
  commandId: string;
}

/**
 * Turn a confirmed draft into a personal task row plus a study. Repeating the
 * call (same draft, or the same command id) returns the existing study.
 */
export async function confirmDraftStudy(
  db: InquiryDb,
  input: ConfirmDraftInput,
): Promise<CommandOutcome> {
  return db.transaction((tx) => confirmInTransaction(tx, input));
}

async function confirmInTransaction(
  tx: InquiryQueryable,
  input: ConfirmDraftInput,
): Promise<CommandOutcome> {
  const draftResult = await tx.query(
    `SELECT ${DRAFT_COLUMNS} FROM inquiry_task_drafts
     WHERE id = $1 AND owner_id = $2 FOR UPDATE`,
    [input.draftId, input.ownerId],
  );
  const row = draftResult.rows[0] as unknown as DraftRow | undefined;
  if (!row) throw new InquiryStoreError('NOT_FOUND', 'unknown task draft');

  if (row.status === 'confirmed' && row.confirmed_study_id) {
    const study = await loadStudyTx(tx, row.confirmed_study_id, input.ownerId);
    if (!study) throw new InquiryStoreError('NOT_FOUND', 'the confirmed study is gone');
    const events = await readEventsAfter(tx, study.id, 0);
    return { study, events, replayed: true };
  }

  const draft = rowToDraft(row);
  if (!draft) throw new InquiryStoreError('INVALID_PAYLOAD', 'draft definition is unreadable');
  const task = draft.definition;
  const taskKey = `gen-${randomUUID()}`;
  const taskId = `task-${randomUUID()}`;
  await tx.query(
    `INSERT INTO inquiry_tasks
       (id, key, name, grade, version, goals, concepts, knowledge, intro,
        materials, liquids, safety, phases, definition, published, owner_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)`,
    [
      taskId,
      taskKey,
      task.name,
      task.grade,
      task.version,
      JSON.stringify(task.goals),
      JSON.stringify(task.concepts),
      JSON.stringify(task.knowledge),
      JSON.stringify(task.intro),
      JSON.stringify(task.materials),
      JSON.stringify(task.liquids),
      JSON.stringify(task.safety),
      JSON.stringify(task.phases),
      JSON.stringify({ ...task, id: taskId, key: taskKey, ownerId: input.ownerId }),
      true,
      input.ownerId,
    ],
  );

  const outcome = await createInTransaction(tx, {
    ownerId: input.ownerId,
    taskKey,
    commandId: input.commandId,
  });

  await tx.query(
    `UPDATE inquiry_task_drafts
     SET status = 'confirmed', confirmed_study_id = $2, updated_at = now()
     WHERE id = $1`,
    [input.draftId, outcome.study.id],
  );
  return outcome;
}

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

export interface ApplyActionInput {
  studyId: string;
  ownerId: string;
  commandId: string;
  /** Stale browsers fail with CONFLICT and receive the latest state. */
  expectedRevision?: number;
  action: InquiryStudyAction;
}

export async function applyInquiryStudyAction(
  db: InquiryDb,
  input: ApplyActionInput,
): Promise<CommandOutcome> {
  return db.transaction(async (tx) => {
    const row = await lockStudy(tx, input.studyId, input.ownerId);
    const study = await rowToStudy(tx, row);
    if (!study) throw new InquiryStoreError('NOT_FOUND', 'study not found');

    const duplicate = await commandOutcome(tx, study, input.commandId);
    if (duplicate) return duplicate;

    if (input.expectedRevision !== undefined && input.expectedRevision !== study.revision) {
      throw new InquiryStoreError(
        'CONFLICT',
        `revision ${input.expectedRevision} is stale; the study is at ${study.revision}`,
        study,
      );
    }

    const transition = runAction(study.task, study.state, input.action);
    return commitCommand(tx, study, input.commandId, transition);
  });
}

export interface RecordDifficultyStoreInput {
  studyId: string;
  ownerId: string;
  commandId: string;
  type: DifficultyType;
  expectedRevision?: number;
}

/**
 * Persist a classifier result. Internal to the tutor turn — it is not part of
 * the student action API, and it never advances or completes a phase.
 */
export async function recordInquiryDifficulty(
  db: InquiryDb,
  input: RecordDifficultyStoreInput,
): Promise<CommandOutcome> {
  const allowed: readonly DifficultyType[] = [
    'concept',
    'method',
    'analysis',
    'expression',
    'off-task',
  ];
  if (!allowed.includes(input.type)) {
    throw new InquiryStoreError('INVALID_PAYLOAD', `unknown difficulty type ${input.type}`);
  }
  return db.transaction(async (tx) => {
    const row = await lockStudy(tx, input.studyId, input.ownerId);
    const study = await rowToStudy(tx, row);
    if (!study) throw new InquiryStoreError('NOT_FOUND', 'study not found');
    const duplicate = await commandOutcome(tx, study, input.commandId);
    if (duplicate) return duplicate;
    if (input.expectedRevision !== undefined && input.expectedRevision !== study.revision) {
      throw new InquiryStoreError(
        'CONFLICT',
        `revision ${input.expectedRevision} is stale; the study is at ${study.revision}`,
        study,
      );
    }
    const transition = recordDifficulty(study.state, { type: input.type });
    return commitCommand(tx, study, input.commandId, transition);
  });
}

export interface RecordSafetyFlagStoreInput {
  studyId: string;
  ownerId: string;
  commandId: string;
  kind: SafetyFlagKind;
  expectedRevision?: number;
}

/** Persist a deterministic safety interception. Internal to the tutor turn. */
export async function recordInquirySafetyFlag(
  db: InquiryDb,
  input: RecordSafetyFlagStoreInput,
): Promise<CommandOutcome> {
  if (input.kind !== 'unsafe' && input.kind !== 'injection') {
    throw new InquiryStoreError('INVALID_PAYLOAD', `unknown safety flag ${input.kind}`);
  }
  return db.transaction(async (tx) => {
    const row = await lockStudy(tx, input.studyId, input.ownerId);
    const study = await rowToStudy(tx, row);
    if (!study) throw new InquiryStoreError('NOT_FOUND', 'study not found');
    const duplicate = await commandOutcome(tx, study, input.commandId);
    if (duplicate) return duplicate;
    if (input.expectedRevision !== undefined && input.expectedRevision !== study.revision) {
      throw new InquiryStoreError(
        'CONFLICT',
        `revision ${input.expectedRevision} is stale; the study is at ${study.revision}`,
        study,
      );
    }
    const transition = recordSafetyFlag(study.state, { kind: input.kind });
    return commitCommand(tx, study, input.commandId, transition);
  });
}

// ---------------------------------------------------------------------------
// Chat
// ---------------------------------------------------------------------------

export interface AppendChatInput {
  studyId: string;
  ownerId: string;
  commandId: string;
  messageId: string;
  role: ChatMessageRole;
  text: string;
  hintLevel?: HintLevel;
  /** Omitted for the server-side tutor continuation after generation. */
  expectedRevision?: number;
}

export interface AppendChatOutcome extends CommandOutcome {
  message: ChatMessageRecord;
}

export async function appendInquiryChatMessage(
  db: InquiryDb,
  input: AppendChatInput,
): Promise<AppendChatOutcome> {
  return db.transaction(async (tx) => {
    const row = await lockStudy(tx, input.studyId, input.ownerId);
    const study = await rowToStudy(tx, row);
    if (!study) throw new InquiryStoreError('NOT_FOUND', 'study not found');

    const duplicate = await commandOutcome(tx, study, input.commandId);
    if (duplicate) {
      const stored = await getCommandResult(tx, input.studyId, input.commandId);
      const message = readJson<ChatMessageRecord>(stored?.message);
      if (!message) throw new InquiryStoreError('INVALID_PAYLOAD', 'stored chat command is empty');
      return { ...duplicate, message };
    }

    if (input.expectedRevision !== undefined && input.expectedRevision !== study.revision) {
      throw new InquiryStoreError(
        'CONFLICT',
        `revision ${input.expectedRevision} is stale; the study is at ${study.revision}`,
        study,
      );
    }

    const transition = recordChatMessage(study.state, {
      messageId: input.messageId,
      role: input.role,
      text: input.text,
      ...(input.hintLevel === undefined ? {} : { hintLevel: input.hintLevel }),
    });
    const event = transition.events[0];
    if (!event || event.type !== 'chat.recorded') {
      throw new InquiryStoreError('INVALID_PAYLOAD', 'chat transition produced no message');
    }
    const committed = await commitCommand(tx, study, input.commandId, transition, {
      message: event.message,
    });
    return { ...committed, message: event.message };
  });
}

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

interface StudyRow {
  id: string;
  task_id: string;
  owner_id: string;
  learner_key: string;
  state: unknown;
  status: string;
  revision: number;
}

async function lockStudy(
  tx: InquiryQueryable,
  studyId: string,
  ownerId: string,
): Promise<StudyRow> {
  const result = await tx.query(
    `SELECT id, task_id, owner_id, learner_key, state, status, revision
     FROM inquiry_studies WHERE id = $1 AND owner_id = $2 FOR UPDATE`,
    [studyId, ownerId],
  );
  const row = result.rows[0];
  if (!row) throw new InquiryStoreError('NOT_FOUND', 'study not found');
  return row as unknown as StudyRow;
}

async function loadStudyTx(
  tx: InquiryQueryable,
  studyId: string,
  ownerId: string,
): Promise<InquiryStudy | null> {
  const result = await tx.query(
    `SELECT id, task_id, owner_id, learner_key, state, status, revision
     FROM inquiry_studies WHERE id = $1 AND owner_id = $2`,
    [studyId, ownerId],
  );
  const row = result.rows[0];
  if (!row) return null;
  return rowToStudy(tx, row as unknown as StudyRow);
}

async function rowToStudy(
  tx: InquiryQueryable,
  row: StudyRow,
): Promise<InquiryStudy | null> {
  const taskRow = await tx.query(`SELECT definition FROM inquiry_tasks WHERE id = $1`, [
    row.task_id,
  ]);
  const task = parseTaskDefinition(taskRow.rows[0]?.definition);
  if (!task) return null;
  const state = parseState(row.state);
  return {
    id: row.id,
    taskId: row.task_id,
    ownerId: row.owner_id,
    learnerKey: row.learner_key,
    state,
    status: (row.status as SessionStatus) ?? state.status,
    revision: Number(row.revision),
    task,
  };
}

async function commandOutcome(
  tx: InquiryQueryable,
  study: InquiryStudy,
  commandId: string,
): Promise<CommandOutcome | null> {
  const result = await getCommandResult(tx, study.id, commandId);
  if (!result) return null;
  const events = readJson<InquiryEvent[]>(result.events) ?? [];
  return { study, events, replayed: true };
}

async function getCommandResult(
  tx: InquiryQueryable,
  studyId: string,
  commandId: string,
): Promise<Record<string, unknown> | null> {
  const result = await tx.query(
    `SELECT result FROM inquiry_commands WHERE study_id = $1 AND command_id = $2`,
    [studyId, commandId],
  );
  return readJson<Record<string, unknown>>(result.rows[0]?.result);
}

async function commitCommand(
  tx: InquiryQueryable,
  study: InquiryStudy,
  commandId: string,
  transition: InquiryTransition,
  extraResult: Record<string, unknown> = {},
): Promise<CommandOutcome> {
  const revision = study.revision + 1;
  const nextStatus = transition.state.status;
  await tx.query(
    `UPDATE inquiry_studies SET state = $2, status = $3, revision = $4, updated_at = now()
     WHERE id = $1`,
    [study.id, JSON.stringify(transition.state), nextStatus, revision],
  );
  await insertEvents(tx, study.id, study.state.lastSequence, transition.events);
  // Derived tables are rewritten from the folded state in the same
  // transaction; `inquiry_events` stays the only source of truth.
  await rebuildInquiryProjections(tx, study.id, transition.state);
  await tx.query(
    `INSERT INTO inquiry_commands (study_id, command_id, result) VALUES ($1, $2, $3)`,
    [
      study.id,
      commandId,
      JSON.stringify({ events: transition.events, revision, ...extraResult }),
    ],
  );
  return {
    study: { ...study, state: transition.state, status: nextStatus, revision },
    events: transition.events,
    replayed: false,
  };
}

async function insertEvents(
  tx: InquiryQueryable,
  studyId: string,
  baseSequence: number,
  events: readonly InquiryEvent[],
): Promise<void> {
  for (let index = 0; index < events.length; index += 1) {
    await tx.query(
      `INSERT INTO inquiry_events (study_id, sequence, event) VALUES ($1, $2, $3)`,
      [studyId, baseSequence + index + 1, JSON.stringify(events[index])],
    );
  }
}

async function readEventsAfter(
  tx: InquiryQueryable,
  studyId: string,
  afterSequence: number,
): Promise<InquiryEvent[]> {
  const result = await tx.query(
    `SELECT event FROM inquiry_events WHERE study_id = $1 AND sequence > $2 ORDER BY sequence`,
    [studyId, afterSequence],
  );
  return result.rows
    .map((row) => readJson<InquiryEvent>(row.event))
    .filter((event): event is InquiryEvent => event !== null);
}

/** Fold the persisted events; used by tests to prove state = replay(events). */
export function replayStudyEvents(task: InquiryTask, events: readonly InquiryEvent[]) {
  return events.reduce(applyInquiryEvent, createInquirySessionState(task));
}

function runAction(
  task: InquiryTask,
  state: InquirySessionState,
  action: InquiryStudyAction,
): InquiryTransition {
  switch (action?.action) {
    case 'submit':
      if (!action.content || typeof action.content !== 'object') {
        throw new InquiryStoreError('INVALID_PAYLOAD', 'submit needs a content object');
      }
      return submitSubmission(task, state, {
        submissionId: `sub-${randomUUID()}`,
        content: action.content,
      });
    case 'requestHint':
      return requestHint(state, {
        explicit: action.explicit === true,
        classifiedType: normalizeDifficultyType(action.classifiedType),
      });
    case 'confirmSubmission':
      return confirmSubmission(state, {
        ...(typeof action.submissionId === 'string' && action.submissionId
          ? { submissionId: action.submissionId }
          : {}),
      });
    case 'revert':
      if (!Number.isInteger(action.targetPhaseIndex)) {
        throw new InquiryStoreError('INVALID_PAYLOAD', 'revert needs an integer targetPhaseIndex');
      }
      return revertPhase(task, state, {
        targetPhaseIndex: action.targetPhaseIndex,
        ...(typeof action.reason === 'string' && action.reason ? { reason: action.reason } : {}),
      });
    case 'next':
      return completePhase(task, state);
    case 'recordExperiment': {
      const outcomes = ['float', 'sink', 'suspend'] as const;
      if (
        typeof action.materialId !== 'string' ||
        typeof action.liquidId !== 'string' ||
        (action.source !== 'sim' && action.source !== 'real') ||
        !outcomes.includes(action.studentPrediction)
      ) {
        throw new InquiryStoreError(
          'INVALID_PAYLOAD',
          'recordExperiment needs material, liquid, source and the student prediction',
        );
      }
      if (action.observed && !outcomes.includes(action.observed)) {
        throw new InquiryStoreError('INVALID_PAYLOAD', 'unknown observed outcome');
      }
      if (typeof action.note === 'string' && action.note.length > 300) {
        throw new InquiryStoreError('INVALID_PAYLOAD', 'the observation note is too long');
      }
      return recordExperiment(task, state, {
        trialId: `trial-${randomUUID()}`,
        materialId: action.materialId,
        liquidId: action.liquidId,
        source: action.source,
        studentPrediction: action.studentPrediction,
        ...(action.observed ? { observed: action.observed } : {}),
        ...(typeof action.note === 'string' && action.note.trim()
          ? { note: action.note.trim() }
          : {}),
        recordedAt: new Date().toISOString(),
      });
    }
    case 'recordObservation': {
      if (
        typeof action.guess !== 'string' ||
        typeof action.observation !== 'string' ||
        action.guess.length > 300 ||
        action.observation.length > 1000 ||
        (typeof action.note === 'string' && action.note.length > 300)
      ) {
        throw new InquiryStoreError(
          'INVALID_PAYLOAD',
          'recordObservation needs a guess (≤300) and an observation (≤1000)',
        );
      }
      return recordObservation(task, state, {
        observationId: `obs-${randomUUID()}`,
        guess: action.guess,
        observation: action.observation,
        ...(typeof action.note === 'string' && action.note.trim()
          ? { note: action.note.trim() }
          : {}),
        recordedAt: new Date().toISOString(),
      });
    }
    default:
      throw new InquiryStoreError('INVALID_PAYLOAD', 'unknown inquiry action');
  }
}

function normalizeDifficultyType(value: DifficultyType | null | undefined): DifficultyType | null {
  const allowed: readonly DifficultyType[] = [
    'concept',
    'method',
    'analysis',
    'expression',
    'off-task',
  ];
  return typeof value === 'string' && (allowed as readonly string[]).includes(value)
    ? (value as DifficultyType)
    : null;
}

function readJson<T>(value: unknown): T | null {
  if (value === null || value === undefined) return null;
  if (typeof value === 'string') {
    try {
      return JSON.parse(value) as T;
    } catch {
      return null;
    }
  }
  return value as T;
}

function parseTaskDefinition(value: unknown): InquiryTask | null {
  const task = readJson<InquiryTask>(value);
  if (!task || typeof task !== 'object') return null;
  if (typeof task.key !== 'string' || typeof task.id !== 'string') return null;
  if (!Array.isArray(task.phases) || task.phases.length !== PHASE_IDS.length) return null;
  return task;
}

function parseState(value: unknown): InquirySessionState {
  const state = readJson<InquirySessionState>(value);
  if (!state || typeof state !== 'object' || !Array.isArray(state.phases)) {
    throw new InquiryStoreError('INVALID_PAYLOAD', 'stored inquiry state is unreadable');
  }
  // Older rows (before chat recording / safety flags) lack these arrays.
  if (!Array.isArray(state.conversation)) state.conversation = [];
  if (!Array.isArray(state.safetyFlags)) state.safetyFlags = [];
  // Rows written before real-world observations lack the array too. Filling it
  // keeps replay of old event logs byte-identical (the events never touch it).
  if (state.collected && typeof state.collected === 'object') {
    for (const collected of Object.values(state.collected)) {
      if (collected && !Array.isArray(collected.observations)) collected.observations = [];
    }
  }
  return state;
}
