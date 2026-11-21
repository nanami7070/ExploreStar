import { describe, expect, it } from 'vitest';

import { computeScaffold, softFailStreak } from '@/lib/inquiry/domain/scaffolding';
import { QUESTION, YES_NO_QUESTION, startedSession } from './_helpers';

function baseInput(overrides: Partial<Parameters<typeof computeScaffold>[0]> = {}) {
  return {
    phaseId: 'question' as const,
    attempts: 0,
    explicitHelp: false,
    classifiedType: null,
    currentLevel: 0 as const,
    consecutiveType: { type: null, count: 0 },
    softFailStreak: { checkId: null, count: 0 },
    ...overrides,
  };
}

describe('scaffolding rules', () => {
  it('defaults to L0 with the neutral template', () => {
    const decision = computeScaffold(baseInput());
    expect(decision).toEqual({
      level: 0,
      type: null,
      templateKey: 'question.default.L0',
      reason: 'no-escalation',
      providedExplanation: false,
    });
  });

  it('caps escalation at L2 until the fourth attempt', () => {
    const first = computeScaffold(baseInput({ explicitHelp: true }));
    expect(first.level).toBe(1);

    const second = computeScaffold(
      baseInput({ explicitHelp: true, currentLevel: 1, attempts: 2 }),
    );
    expect(second.level).toBe(2);

    const third = computeScaffold(
      baseInput({ explicitHelp: true, currentLevel: 2, attempts: 3 }),
    );
    expect(third.level).toBe(2);
    expect(third.providedExplanation).toBe(false);
  });

  it('reaches L3 only from the fourth attempt onward', () => {
    const decision = computeScaffold(
      baseInput({ explicitHelp: true, currentLevel: 2, attempts: 4 }),
    );
    expect(decision.level).toBe(3);
    expect(decision.providedExplanation).toBe(true);
    expect(decision.reason).toContain('structured-support');
  });

  it('never grants L3 for free at four attempts without a trigger', () => {
    const decision = computeScaffold(
      baseInput({ currentLevel: 2, attempts: 4, explicitHelp: false }),
    );
    expect(decision.level).toBe(2);
  });

  it('escalates on the second consecutive same-type difficulty', () => {
    const decision = computeScaffold(
      baseInput({ classifiedType: 'concept', consecutiveType: { type: 'concept', count: 2 } }),
    );
    expect(decision.level).toBe(1);
    expect(decision.templateKey).toBe('question.concept.L1');
  });

  it('escalates when the same soft check fails twice in a row', () => {
    const decision = computeScaffold(
      baseInput({ softFailStreak: { checkId: 'question.form', count: 2 } }),
    );
    expect(decision.level).toBe(1);
    expect(decision.reason).toContain('repeat:question.form');
  });

  it('degrades a missing classification to the default template without changing rules', () => {
    const decision = computeScaffold(
      baseInput({ classifiedType: null, explicitHelp: true }),
    );
    expect(decision.type).toBeNull();
    expect(decision.level).toBe(1);
    expect(decision.templateKey).toBe('question.default.L1');
  });
});

describe('scaffolding in the state machine', () => {
  it('walks L0 → L1 → L2 → L3 across explicit help requests', () => {
    const driver = startedSession();
    for (let i = 0; i < 4; i += 1) driver.submit(`q-${i}`, QUESTION);
    expect(driver.state.phases[0]!.attempts).toBe(4);

    driver.hint({ explicit: true });
    expect(driver.state.phases[0]!.hint.level).toBe(1);
    driver.hint({ explicit: true });
    expect(driver.state.phases[0]!.hint.level).toBe(2);
    driver.hint({ explicit: true });
    expect(driver.state.phases[0]!.hint.level).toBe(3);

    const log = driver.state.phases[0]!.hint.log;
    expect(log).toHaveLength(3);
    expect(log[2]!.providedExplanation).toBe(true);
    expect(log[2]!.reason).toContain('structured-support');
    expect(driver.state.lastSequence).toBeGreaterThan(0);
  });

  it('escalates after the same soft check fails on two consecutive submissions', () => {
    const driver = startedSession().submit('q-a', YES_NO_QUESTION).submit('q-b', YES_NO_QUESTION);
    expect(softFailStreak(driver.state.collected.question)).toEqual({
      checkId: 'question.form',
      count: 2,
    });

    driver.hint({ explicit: false });
    expect(driver.state.phases[0]!.hint.level).toBe(1);
    expect(driver.state.phases[0]!.hint.log[0]!.reason).toContain('repeat:question.form');
  });

  it('tracks consecutive classified difficulties', () => {
    const driver = startedSession();
    driver.hint({ explicit: false, classifiedType: 'concept' });
    expect(driver.state.phases[0]!.hint.level).toBe(0);
    driver.hint({ explicit: false, classifiedType: 'concept' });
    expect(driver.state.phases[0]!.hint.level).toBe(1);
    expect(driver.state.phases[0]!.hint.consecutive).toEqual({ type: 'concept', count: 2 });
  });

  it('resets the level but keeps the hint log after a revert', () => {
    const driver = startedSession().submit('q-1', QUESTION).hint({ explicit: true });
    expect(driver.state.phases[0]!.hint.level).toBe(1);
    expect(driver.state.phases[0]!.hint.log).toHaveLength(1);

    driver.complete();
    driver.revert({ targetPhaseIndex: 0, reason: '重新想一想问题' });
    const question = driver.state.phases[0]!;
    expect(question.status).toBe('active');
    expect(question.hint.level).toBe(0);
    // The support history is learning evidence and is retained.
    expect(question.hint.log).toHaveLength(1);
  });
});
