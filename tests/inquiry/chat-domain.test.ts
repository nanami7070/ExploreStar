import { describe, expect, it } from 'vitest';

import { replayInquiryEvents } from '@/lib/inquiry/domain/state';
import { recordChatMessage } from '@/lib/inquiry/domain/transition';
import { InquiryTransitionError } from '@/lib/inquiry/domain/types';
import { QUESTION, TASK, afterEvidence, startedSession } from './_helpers';

function expectCode(fn: () => unknown, code: string) {
  try {
    fn();
  } catch (error) {
    expect(error).toBeInstanceOf(InquiryTransitionError);
    expect((error as InquiryTransitionError).code).toBe(code);
    return;
  }
  throw new Error(`expected InquiryTransitionError ${code}, nothing was thrown`);
}

describe('chat recording in the domain', () => {
  it('records student and tutor turns without touching phase progress', () => {
    const driver = startedSession();
    const before = driver.state.phases[0]!.status;

    driver.chat('c-1', '老师，为什么木块会浮起来？', 'student');
    driver.chat('c-2', '你觉得木块和石头有什么不一样？先猜一猜。', 'tutor', 0);

    const state = driver.state;
    expect(before).toBe('active');
    expect(state.phases[0]!.status).toBe('active');
    expect(state.position.phaseId).toBe('question');
    expect(state.phases[0]!.attempts).toBe(0);
    expect(state.conversation).toHaveLength(2);
    expect(state.conversation[0]).toMatchObject({
      id: 'c-1',
      role: 'student',
      phaseId: 'question',
      phaseRevision: 0,
    });
    expect(state.conversation[1]).toMatchObject({ id: 'c-2', role: 'tutor', hintLevel: 0 });
    expect(state.conversation[1]!.seq).toBe(state.conversation[0]!.seq + 1);
  });

  it('rejects an empty chat message', () => {
    const driver = startedSession();
    expectCode(
      () => recordChatMessage(driver.state, { messageId: 'empty', role: 'student', text: '   ' }),
      'CHAT_EMPTY',
    );
  });

  it('refuses chat outside an active session', () => {
    const driver = afterEvidence();
    driver.submit('a-1', { text: '我发现木块浮在水上，石头沉下去。' }).complete();
    driver.submit('r-1', { text: '我下次想多试几种材料。' }).complete();
    expect(driver.state.status).toBe('completed');
    expectCode(
      () => recordChatMessage(driver.state, { messageId: 'late', role: 'student', text: '还在吗' }),
      'SESSION_NOT_ACTIVE',
    );
  });

  it('replays the conversation from the event log', () => {
    const driver = startedSession().submit('q-1', QUESTION).chat('c-1', '我想研究木块。');
    driver.chat('c-2', '好主意，先写下你的问题吧。', 'tutor', 1);
    expect(replayInquiryEvents(TASK, driver.events)).toEqual(driver.state);
    expect(driver.replay().conversation.map((message) => message.id)).toEqual(['c-1', 'c-2']);
  });
});
