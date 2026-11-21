import { describe, expect, it } from 'vitest';

import { activeExperiments } from '@/lib/inquiry/domain/gates';
import { InquiryTransitionError } from '@/lib/inquiry/domain/types';
import {
  ANALYSIS,
  QUESTION,
  REFLECTION,
  afterEvidence,
  afterQuestion,
  startedSession,
} from './_helpers';

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

describe('revert and data consistency', () => {
  it('keeps history, invalidates downstream phases and supersedes their artifacts', () => {
    const driver = afterEvidence(); // analysis phase active, trials t-1/t-2 recorded
    const beforeEvidence = driver.state.collected.evidence.experiments;
    expect(beforeEvidence.every((experiment) => !experiment.superseded)).toBe(true);

    driver.revert({ targetPhaseIndex: 1, reason: '修正假设' });

    const state = driver.state;
    expect(state.position).toEqual({ phaseIndex: 1, phaseId: 'hypothesis' });
    expect(state.phases[1]!.status).toBe('active');
    expect(state.phases[1]!.revision).toBe(1);
    // History is intact.
    expect(state.collected.question.submissions.map((s) => s.id)).toEqual(['q-1']);
    expect(state.collected.hypothesis.submissions.map((s) => s.id)).toEqual(['h-1']);
    expect(state.collected.evidence.experiments.map((e) => e.id)).toEqual(['t-1', 't-2']);
    // Downstream is invalidated, not deleted.
    expect(state.phases[2]!.status).toBe('invalidated');
    expect(state.phases[3]!.status).toBe('invalidated');
    expect(state.phases[4]!.status).toBe('invalidated');
    expect(state.collected.evidence.experiments.every((e) => e.superseded)).toBe(true);
    const designEvaluations = state.collected['experiment-design'].evaluations;
    expect(designEvaluations.length).toBeGreaterThan(0);
    expect(designEvaluations.every((e) => e.superseded)).toBe(true);
    expect(state.collected.evidence.evaluations.every((e) => e.superseded)).toBe(true);
    // Only the live evidence counts toward gates.
    expect(activeExperiments(state.collected.evidence)).toEqual([]);
  });

  it('requires an explicit confirmation or a new submission after a revert', () => {
    const driver = afterEvidence().revert({ targetPhaseIndex: 1 });
    expectCode(() => driver.complete(), 'SUBMISSION_NOT_CONFIRMED');

    driver.confirm('h-1');
    driver.complete();
    expect(driver.state.position.phaseId).toBe('experiment-design');
    expect(driver.state.phases[2]!.status).toBe('active');
    expect(driver.state.phases[2]!.revision).toBe(1);

    // The old design submission does not silently re-approve itself either.
    expectCode(() => driver.complete(), 'SUBMISSION_NOT_CONFIRMED');
    driver.confirm('d-1');
    driver.complete();
    expect(driver.state.position.phaseId).toBe('evidence');
    expect(driver.state.phases[3]!.revision).toBe(1);
  });

  it('does not count superseded experiments as evidence after a revisit', () => {
    const driver = afterEvidence().revert({ targetPhaseIndex: 1 });
    driver.confirm('h-1').complete();
    driver.confirm('d-1').complete();

    expect(driver.state.position.phaseId).toBe('evidence');
    expect(() => driver.complete()).toThrowError(/hard checks failed/);

    driver.experiment('t-3', 'wax-block', 'water').complete();
    expect(driver.state.position.phaseId).toBe('analysis');
    const active = activeExperiments(driver.state.collected.evidence);
    expect(active.map((experiment) => experiment.id)).toEqual(['t-3']);
  });

  it('completes the session through the revisited phases only', () => {
    const driver = afterEvidence().revert({ targetPhaseIndex: 1 });
    driver.confirm('h-1').complete();
    driver.confirm('d-1').complete();
    driver.experiment('t-3', 'wax-block', 'water').complete();
    driver.submit('a-2', ANALYSIS).complete();
    driver.submit('r-2', REFLECTION).complete();

    expect(driver.state.status).toBe('completed');
    expect(driver.state.phases.every((phase) => phase.status === 'completed')).toBe(true);
    // Old evidence stays visible as history but is not presented as current.
    expect(driver.state.collected.evidence.experiments.filter((e) => !e.superseded)).toHaveLength(1);
  });

  it('allows a new submission instead of confirmation', () => {
    const driver = afterEvidence().revert({ targetPhaseIndex: 1 });
    driver.submit('h-2', { text: '我改变想法：也许是物体的轻重不同。', reason: '轻重不同' });
    driver.complete();
    expect(driver.state.position.phaseId).toBe('experiment-design');
    expect(driver.state.collected.hypothesis.submissions.map((s) => s.id)).toEqual(['h-1', 'h-2']);
  });

  it('rejects invalid revert targets', () => {
    const driver = startedSession().submit('q-1', QUESTION);
    expectCode(() => driver.revert({ targetPhaseIndex: 0 }), 'REVERT_TARGET_NOT_COMPLETED');

    const deeper = afterQuestion();
    expectCode(() => deeper.revert({ targetPhaseIndex: 1 }), 'REVERT_TARGET_NOT_COMPLETED');
    expectCode(() => deeper.revert({ targetPhaseIndex: 2 }), 'REVERT_TARGET_NOT_COMPLETED');
    expectCode(() => deeper.revert({ targetPhaseIndex: -1 }), 'REVERT_TARGET_NOT_COMPLETED');
  });

  it('can jump back further, invalidating the phase that was just reopened', () => {
    const driver = afterEvidence().revert({ targetPhaseIndex: 1 });
    driver.revert({ targetPhaseIndex: 0 });

    expect(driver.state.position.phaseId).toBe('question');
    expect(driver.state.phases[1]!.status).toBe('invalidated');
    expect(driver.state.phases[1]!.revision).toBe(1);
    expect(driver.state.phases[0]!.revision).toBe(1);
    expect(driver.state.collected.question.submissions.map((s) => s.id)).toEqual(['q-1']);
    expect(driver.state.collected.hypothesis.evaluations.every((e) => e.superseded)).toBe(true);
  });

  it('cannot revert a phase that was never completed', () => {
    // Hypothesis is active (not completed) while question is completed.
    const driver = afterQuestion();
    driver.revert({ targetPhaseIndex: 0 }); // question is fine
    expectCode(() => driver.revert({ targetPhaseIndex: 0 }), 'REVERT_TARGET_NOT_COMPLETED');
  });
});
