/**
 * Store tests on PGlite: real SQL, real transactions, real row locks — no
 * Docker and no network. The production adapter is the same seam over the
 * shared pg pool (lib/inquiry/server/db.ts).
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { InquiryTransitionError } from '@/lib/inquiry/domain/types';
import {
  InquiryStoreError,
  appendInquiryChatMessage,
  applyInquiryStudyAction,
  createInquiryStudy,
  listInquiryTasks,
  loadInquiryStudy,
  loadInquiryStudyEvents,
  recordInquiryDifficulty,
  recordInquirySafetyFlag,
  replayStudyEvents,
} from '@/lib/inquiry/server/store';
import { DESIGN, QUESTION, REFLECTION, TASK } from './_helpers';
import { createStoreHarness, type StoreHarness } from './_store-harness';

let harness: StoreHarness;
let db: StoreHarness['db'];
const OWNER = 'owner-a';
const OTHER = 'owner-b';

beforeEach(async () => {
  harness = await createStoreHarness();
  db = harness.db;
});

afterEach(async () => {
  await harness.close();
});

async function create() {
  return createInquiryStudy(db, { ownerId: OWNER, taskKey: 'float-sink', commandId: 'create-1' });
}

async function countStudies(): Promise<number> {
  const result = await db.query(`SELECT count(*)::int AS count FROM inquiry_studies`);
  return Number(result.rows[0]!.count);
}

describe('inquiry store', () => {
  it('seeds the demo task as an unpublished draft', async () => {
    const tasks = await listInquiryTasks(db);
    expect(tasks).toHaveLength(1);
    expect(tasks[0]).toMatchObject({ key: 'float-sink', published: false });
  });

  it('creates a started study and is idempotent per creation command', async () => {
    const first = await create();
    expect(first.replayed).toBe(false);
    expect(first.study.state.status).toBe('waiting_for_student');
    expect(first.study.state.position.phaseId).toBe('question');
    expect(first.study.revision).toBe(1);
    expect(first.events.map((event) => event.type)).toEqual([
      'session.started',
      'phase.entered',
    ]);

    const retry = await create();
    expect(retry.replayed).toBe(true);
    expect(retry.study.id).toBe(first.study.id);
    expect(await countStudies()).toBe(1);

    const events = await loadInquiryStudyEvents(db, first.study.id, OWNER, 0);
    expect(events).toHaveLength(2);
  });

  it('keeps studies owner-scoped', async () => {
    const { study } = await create();
    expect(await loadInquiryStudy(db, study.id, OTHER)).toBeNull();
    expect(await loadInquiryStudyEvents(db, study.id, OTHER, 0)).toBeNull();
    expect((await loadInquiryStudy(db, study.id, OWNER))?.id).toBe(study.id);
  });

  it('applies an action transactionally and deduplicates its command', async () => {
    const { study } = await create();
    const applied = await applyInquiryStudyAction(db, {
      studyId: study.id,
      ownerId: OWNER,
      commandId: 'act-1',
      expectedRevision: 1,
      action: { action: 'submit', content: QUESTION },
    });
    expect(applied.replayed).toBe(false);
    expect(applied.study.revision).toBe(2);
    expect(applied.study.state.collected.question.submissions).toHaveLength(1);
    expect(applied.events.map((event) => event.type)).toEqual([
      'submission.recorded',
      'evaluation.recorded',
      'evaluation.recorded',
    ]);

    const retry = await applyInquiryStudyAction(db, {
      studyId: study.id,
      ownerId: OWNER,
      commandId: 'act-1',
      expectedRevision: 1,
      action: { action: 'submit', content: QUESTION },
    });
    expect(retry.replayed).toBe(true);
    expect(retry.study.state.collected.question.submissions).toHaveLength(1);
    expect(retry.study.revision).toBe(2);
  });

  it('rejects a stale revision with CONFLICT and the latest state', async () => {
    const { study } = await create();
    await applyInquiryStudyAction(db, {
      studyId: study.id,
      ownerId: OWNER,
      commandId: 'act-1',
      expectedRevision: 1,
      action: { action: 'submit', content: QUESTION },
    });

    try {
      await applyInquiryStudyAction(db, {
        studyId: study.id,
        ownerId: OWNER,
        commandId: 'act-2',
        expectedRevision: 1,
        action: { action: 'next' },
      });
      throw new Error('expected conflict');
    } catch (error) {
      expect(error).toBeInstanceOf(InquiryStoreError);
      const conflict = error as InquiryStoreError;
      expect(conflict.code).toBe('CONFLICT');
      expect(conflict.study?.revision).toBe(2);
      expect(conflict.study?.state.collected.question.submissions).toHaveLength(1);
    }
  });

  it('rolls back a refused transition', async () => {
    const { study } = await create();
    await applyInquiryStudyAction(db, {
      studyId: study.id,
      ownerId: OWNER,
      commandId: 'act-1',
      expectedRevision: 1,
      action: { action: 'submit', content: QUESTION },
    });
    await applyInquiryStudyAction(db, {
      studyId: study.id,
      ownerId: OWNER,
      commandId: 'act-2',
      expectedRevision: 2,
      action: { action: 'next' },
    });

    await expect(
      applyInquiryStudyAction(db, {
        studyId: study.id,
        ownerId: OWNER,
        commandId: 'act-3',
        expectedRevision: 3,
        action: { action: 'next' }, // hypothesis has no submission yet
      }),
    ).rejects.toBeInstanceOf(InquiryTransitionError);

    const reloaded = await loadInquiryStudy(db, study.id, OWNER);
    expect(reloaded?.revision).toBe(3);
    expect(reloaded?.state.position.phaseId).toBe('hypothesis');
    expect(reloaded?.state.phases[1]!.status).toBe('active');
  });

  it('records chat idempotently and keeps it out of phase progress', async () => {
    const { study } = await create();
    const student = await appendInquiryChatMessage(db, {
      studyId: study.id,
      ownerId: OWNER,
      commandId: 'chat-1',
      messageId: 'm-1',
      role: 'student',
      text: '老师，我想研究木块为什么会浮起来。',
      expectedRevision: 1,
    });
    expect(student.study.revision).toBe(2);
    expect(student.message.phaseId).toBe('question');
    expect(student.study.state.phases[0]!.attempts).toBe(0);

    const retry = await appendInquiryChatMessage(db, {
      studyId: study.id,
      ownerId: OWNER,
      commandId: 'chat-1',
      messageId: 'm-1',
      role: 'student',
      text: '老师，我想研究木块为什么会浮起来。',
      expectedRevision: 1,
    });
    expect(retry.replayed).toBe(true);
    expect(retry.message.id).toBe('m-1');
    expect(retry.study.state.conversation).toHaveLength(1);

    const tutor = await appendInquiryChatMessage(db, {
      studyId: study.id,
      ownerId: OWNER,
      commandId: 'chat-1:tutor',
      messageId: 'm-2',
      role: 'tutor',
      text: '好问题！你觉得木块和石块有什么不一样？',
      hintLevel: 0,
    });
    expect(tutor.study.state.conversation.map((message) => message.role)).toEqual([
      'student',
      'tutor',
    ]);
    expect(tutor.study.revision).toBe(3);
  });

  it('records a classified difficulty idempotently without changing the hint level', async () => {
    const { study } = await create();
    const first = await recordInquiryDifficulty(db, {
      studyId: study.id,
      ownerId: OWNER,
      commandId: 'cls-1',
      type: 'concept',
      expectedRevision: 1,
    });
    expect(first.study.state.phases[0]!.hint.consecutive).toEqual({ type: 'concept', count: 1 });
    expect(first.study.state.phases[0]!.hint.level).toBe(0);
    expect(first.events).toEqual([
      {
        type: 'hint.classified',
        phaseId: 'question',
        classifiedType: 'concept',
        consecutive: { type: 'concept', count: 1 },
      },
    ]);

    const retry = await recordInquiryDifficulty(db, {
      studyId: study.id,
      ownerId: OWNER,
      commandId: 'cls-1',
      type: 'concept',
    });
    expect(retry.replayed).toBe(true);
    expect(retry.study.revision).toBe(first.study.revision);
    expect(retry.study.state.phases[0]!.hint.consecutive).toEqual({ type: 'concept', count: 1 });
  });

  it('records a safety flag idempotently', async () => {
    const { study } = await create();
    const first = await recordInquirySafetyFlag(db, {
      studyId: study.id,
      ownerId: OWNER,
      commandId: 'safety-1',
      kind: 'unsafe',
      expectedRevision: 1,
    });
    expect(first.study.state.safetyFlags).toEqual([
      { kind: 'unsafe', phaseId: 'question', seq: expect.any(Number) },
    ]);
    const retry = await recordInquirySafetyFlag(db, {
      studyId: study.id,
      ownerId: OWNER,
      commandId: 'safety-1',
      kind: 'unsafe',
    });
    expect(retry.replayed).toBe(true);
    expect(retry.study.state.safetyFlags).toHaveLength(1);
  });

  it('replays a duplicate chat command even with a stale expected revision', async () => {
    const { study } = await create();
    const first = await appendInquiryChatMessage(db, {
      studyId: study.id,
      ownerId: OWNER,
      commandId: 'chat-1',
      messageId: 'm-1',
      role: 'student',
      text: '你好',
      expectedRevision: 1,
    });
    const retry = await appendInquiryChatMessage(db, {
      studyId: study.id,
      ownerId: OWNER,
      commandId: 'chat-1',
      messageId: 'm-2',
      role: 'student',
      text: '你好',
      expectedRevision: 1, // stale after the first send, but the command is the same
    });
    expect(retry.replayed).toBe(true);
    expect(retry.message.id).toBe('m-1');
    expect(retry.study.revision).toBe(first.study.revision);
    expect(retry.study.state.conversation).toHaveLength(1);
  });

  it('replays the persisted event log to exactly the stored state', async () => {
    const { study } = await create();
    const steps = [
      { action: 'submit', content: QUESTION },
      { action: 'next' },
      { action: 'submit', content: { text: '我认为木制的物体会浮，因为比较轻。', reason: '比较轻' } },
      { action: 'next' },
      { action: 'submit', content: DESIGN },
      { action: 'next' },
      {
        action: 'recordExperiment',
        materialId: 'wood-block',
        liquidId: 'water',
        source: 'sim',
        studentPrediction: 'float',
      },
      { action: 'next' },
      {
        action: 'submit',
        content: { text: '我发现木块在水里浮起来，因为木块比石块轻。' },
      },
      { action: 'next' },
      { action: 'submit', content: REFLECTION },
      { action: 'next' },
    ] as const;

    let revision = 1;
    for (const [index, action] of steps.entries()) {
      const outcome = await applyInquiryStudyAction(db, {
        studyId: study.id,
        ownerId: OWNER,
        commandId: `step-${index}`,
        expectedRevision: revision,
        action: action as Parameters<typeof applyInquiryStudyAction>[1]['action'],
      });
      revision = outcome.study.revision;
    }

    const final = await loadInquiryStudy(db, study.id, OWNER);
    expect(final?.state.status).toBe('completed');
    const events = await loadInquiryStudyEvents(db, study.id, OWNER, 0);
    expect(events).not.toBeNull();
    expect(replayStudyEvents(TASK, events!)).toEqual(final!.state);
  });
});
