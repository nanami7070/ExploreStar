/**
 * One tutor turn: persist the student message, build the prompt, stream the
 * reply, persist the tutor message.
 *
 * The generator is injected so the turn's ordering, idempotency and failure
 * behavior are unit-testable without a model or network. The SSE route wires
 * it to `streamLLM`; tests wire it to a scripted generator.
 *
 * Command ids:
 * - `msg:<clientCommandId>` records the student message;
 * - `<clientCommandId>:tutor` records the reply.
 * A retried client command therefore replays both halves instead of
 * duplicating either.
 */
import { randomUUID } from 'node:crypto';

import type { InquiryEvent } from '@/lib/inquiry/domain/events';
import type { ChatMessageRecord, DifficultyType } from '@/lib/inquiry/domain/types';
import { findPhaseConfig } from '@/lib/inquiry/domain/types';
import { buildTutorPrompt, type TutorPrompt } from '@/lib/inquiry/prompts/tutor';
import { screenStudentMessage } from '@/lib/inquiry/safety';

import type { InquiryDb } from './db';
import type { DifficultyClassifyInput } from './difficulty';
import {
  InquiryStoreError,
  appendInquiryChatMessage,
  getInquiryCommandResult,
  loadInquiryStudy,
  recordInquiryDifficulty,
  recordInquirySafetyFlag,
} from './store';

export const MAX_STUDENT_MESSAGE_CHARS = 1000;
/** Guard against a runaway model reply; far above any intended answer. */
export const MAX_TUTOR_REPLY_CHARS = 4000;

export type TutorTurnEvent =
  | {
      type: 'student.recorded';
      message: ChatMessageRecord;
      revision: number;
      /** Existing events, so a reconnecting client can resynchronize. */
      events: InquiryEvent[];
    }
  | { type: 'tutor.start'; messageId: string }
  | { type: 'tutor.delta'; text: string }
  | { type: 'tutor.done'; messageId: string; text: string; revision: number }
  | {
      type: 'tutor.error';
      code:
        | 'INVALID_TEXT'
        | 'CONFLICT'
        | 'NOT_FOUND'
        | 'GENERATION_FAILED'
        | 'EMPTY_REPLY'
        | 'STORE_FAILED';
      message: string;
      /** Latest state for a CONFLICT, so the client can refresh and retry. */
      state?: unknown;
    };

export interface TutorTurnDeps {
  db: InquiryDb;
  /** Yields text deltas. The route adapts streamLLM; tests script it. */
  generate: (prompt: TutorPrompt) => AsyncIterable<string>;
  /**
   * Optional difficulty classifier. It only names a type; the hint level
   * remains the deterministic scaffolding decision. Failures are ignored.
   */
  classify?: (input: DifficultyClassifyInput) => Promise<DifficultyType | null>;
  newId?: () => string;
}

export interface TutorTurnInput {
  studyId: string;
  ownerId: string;
  commandId: string;
  text: string;
  expectedRevision?: number;
}

export async function* runTutorTurn(
  deps: TutorTurnDeps,
  input: TutorTurnInput,
): AsyncGenerator<TutorTurnEvent> {
  const newId = deps.newId ?? (() => `chat-${randomUUID()}`);
  const text = input.text.trim();
  if (!text || text.length > MAX_STUDENT_MESSAGE_CHARS) {
    yield {
      type: 'tutor.error',
      code: 'INVALID_TEXT',
      message: `消息需要 1–${MAX_STUDENT_MESSAGE_CHARS} 个字符。`,
    };
    return;
  }

  // 1. The student's message is durable before any generation starts.
  let student;
  try {
    student = await appendInquiryChatMessage(deps.db, {
      studyId: input.studyId,
      ownerId: input.ownerId,
      commandId: `msg:${input.commandId}`,
      messageId: newId(),
      role: 'student',
      text,
      ...(input.expectedRevision === undefined
        ? {}
        : { expectedRevision: input.expectedRevision }),
    });
  } catch (error) {
    yield storeFailure(error);
    return;
  }
  yield {
    type: 'student.recorded',
    message: student.message,
    revision: student.study.revision,
    events: student.events,
  };

  // 2. A retried send replays the stored reply instead of generating again.
  const storedTutor = await getInquiryCommandResult(
    deps.db,
    input.studyId,
    input.ownerId,
    `${input.commandId}:tutor`,
  );
  const storedMessage = readStoredMessage(storedTutor);
  if (storedMessage) {
    yield { type: 'tutor.start', messageId: storedMessage.id };
    yield { type: 'tutor.delta', text: storedMessage.text };
    yield {
      type: 'tutor.done',
      messageId: storedMessage.id,
      text: storedMessage.text,
      revision: student.study.revision,
    };
    return;
  }

  // 3. Build the prompt from the state that now includes the student message.
  let study = await loadInquiryStudy(deps.db, input.studyId, input.ownerId);
  if (!study) {
    yield { type: 'tutor.error', code: 'NOT_FOUND', message: '没有找到这次探究。' };
    return;
  }

  // 3a. Deterministic safety screening. A flagged message gets a fixed,
  // model-free reply; the model is never asked to handle a dangerous request
  // or an injection attempt.
  const safety = screenStudentMessage(text);
  if (safety.kind && safety.reply) {
    try {
      await recordInquirySafetyFlag(deps.db, {
        studyId: input.studyId,
        ownerId: input.ownerId,
        commandId: `${input.commandId}:safety`,
        kind: safety.kind,
      });
    } catch {
      // The safe reply still goes out; the flag is best-effort evidence.
    }
    const messageId = newId();
    yield { type: 'tutor.start', messageId };
    yield { type: 'tutor.delta', text: safety.reply };
    try {
      const saved = await appendInquiryChatMessage(deps.db, {
        studyId: input.studyId,
        ownerId: input.ownerId,
        commandId: `${input.commandId}:tutor`,
        messageId,
        role: 'tutor',
        text: safety.reply,
        hintLevel: study.state.phases[study.state.position.phaseIndex]!.hint.level,
      });
      yield { type: 'tutor.done', messageId, text: safety.reply, revision: saved.study.revision };
    } catch {
      yield {
        type: 'tutor.error',
        code: 'STORE_FAILED',
        message: '这条回复没有保存成功，请再试一次。',
      };
    }
    return;
  }

  // 3b. Classify the difficulty type, best effort. This never changes the
  // hint level and never blocks the turn.
  if (deps.classify) {
    try {
      const phase = findPhaseConfig(study.task, study.state.position.phaseId);
      const type = await deps.classify({
        text,
        phaseId: study.state.position.phaseId,
        phaseTitle: phase.title,
        phaseGoal: phase.goal,
        taskName: study.task.name,
      });
      if (type) {
        const recorded = await recordInquiryDifficulty(deps.db, {
          studyId: input.studyId,
          ownerId: input.ownerId,
          commandId: `${input.commandId}:difficulty`,
          type,
        });
        study = recorded.study;
      }
    } catch {
      // A classifier outage must not stop the student's inquiry.
    }
  }

  const prompt = buildTutorPrompt({ task: study.task, state: study.state });

  // 4. Stream, then persist the completed reply.
  const messageId = newId();
  yield { type: 'tutor.start', messageId };
  let reply = '';
  try {
    for await (const delta of deps.generate(prompt)) {
      if (!delta) continue;
      reply += delta;
      yield { type: 'tutor.delta', text: delta };
      if (reply.length > MAX_TUTOR_REPLY_CHARS) break;
    }
  } catch {
    yield {
      type: 'tutor.error',
      code: 'GENERATION_FAILED',
      message: '导师暂时没有回应，请稍后再试一次。',
    };
    return;
  }

  const trimmed = reply.trim();
  if (!trimmed) {
    yield { type: 'tutor.error', code: 'EMPTY_REPLY', message: '导师这次没有说出内容，请再试一次。' };
    return;
  }

  try {
    const saved = await appendInquiryChatMessage(deps.db, {
      studyId: input.studyId,
      ownerId: input.ownerId,
      commandId: `${input.commandId}:tutor`,
      messageId,
      role: 'tutor',
      text: trimmed,
      hintLevel: prompt.meta.hintLevel,
    });
    yield {
      type: 'tutor.done',
      messageId,
      text: trimmed,
      revision: saved.study.revision,
    };
  } catch {
    yield {
      type: 'tutor.error',
      code: 'STORE_FAILED',
      message: '这条回复没有保存成功，请再试一次。',
    };
  }
}

function readStoredMessage(result: Record<string, unknown> | null): ChatMessageRecord | null {
  if (!result) return null;
  const value = result.message;
  if (!value) return null;
  if (typeof value === 'string') {
    try {
      return JSON.parse(value) as ChatMessageRecord;
    } catch {
      return null;
    }
  }
  return value as ChatMessageRecord;
}

function storeFailure(error: unknown): TutorTurnEvent {
  if (error instanceof InquiryStoreError) {
    if (error.code === 'CONFLICT') {
      return {
        type: 'tutor.error',
        code: 'CONFLICT',
        message: '这次探究在别处有了新的进展，请刷新后再试。',
        state: error.study?.state,
      };
    }
    if (error.code === 'NOT_FOUND') {
      return { type: 'tutor.error', code: 'NOT_FOUND', message: '没有找到这次探究。' };
    }
  }
  return { type: 'tutor.error', code: 'STORE_FAILED', message: '保存消息失败，请再试一次。' };
}
