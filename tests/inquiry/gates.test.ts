import { describe, expect, it } from 'vitest';

import { InquiryTransitionError } from '@/lib/inquiry/domain/types';
import {
  DESIGN,
  QUESTION,
  YES_NO_QUESTION,
  afterDesign,
  afterHypothesis,
  afterQuestion,
  startedSession,
} from './_helpers';

function softResults(driver: ReturnType<typeof startedSession>, phaseId: 'question' | 'hypothesis') {
  return driver.state.collected[phaseId].evaluations.filter(
    (evaluation) => evaluation.kind === 'soft-check',
  );
}

describe('hard vs soft gates', () => {
  it('accepts a yes/no question as complete and only reports it as a suggestion', () => {
    const driver = startedSession().submit('q-yesno', YES_NO_QUESTION);
    // Soft checks never change the phase status or block progression.
    expect(driver.state.phases[0]!.status).toBe('active');
    const form = softResults(driver, 'question').find((e) => e.verdict.checkId === 'question.form');
    expect(form?.verdict.passed).toBe(false);

    driver.complete();
    expect(driver.state.position.phaseId).toBe('hypothesis');
    const recorded = driver.state.collected.question.evaluations;
    expect(recorded.map((e) => e.verdict.checkId)).toEqual(
      expect.arrayContaining(['question.form', 'question.relevance']),
    );
  });

  it('records passed and failed soft checks alike, linked to the submission', () => {
    const driver = startedSession().submit('q-1', QUESTION);
    const evaluations = softResults(driver, 'question');
    expect(evaluations).toHaveLength(2);
    expect(evaluations.every((e) => e.submissionId === 'q-1')).toBe(true);
    expect(evaluations.find((e) => e.verdict.checkId === 'question.form')?.verdict.passed).toBe(
      true,
    );
  });

  it('lets an imperfect hypothesis continue without any reason', () => {
    const driver = afterQuestion().submit('h-noreason', { text: '我觉得木块会浮。' });
    const reason = softResults(driver, 'hypothesis').find(
      (e) => e.verdict.checkId === 'hypothesis.reason',
    );
    expect(reason?.verdict.passed).toBe(false);

    // Hard checks pass: the incomplete hypothesis is kept and may be revised later.
    driver.complete();
    expect(driver.state.position.phaseId).toBe('experiment-design');
  });

  it('accepts a single experiment record as complete evidence', () => {
    const driver = afterDesign().experiment('t-1', 'wood-block', 'water');
    driver.complete();
    expect(driver.state.position.phaseId).toBe('analysis');

    const evaluations = driver.state.collected.evidence.evaluations;
    const count = evaluations.find((e) => e.verdict.checkId === 'evidence.suggested-count');
    expect(count?.verdict.passed).toBe(false); // suggestion only, not a block
    expect(driver.state.phases[3]!.status).toBe('completed');
  });

  it('blocks completion on missing design data (data completeness is hard)', () => {
    const driver = afterHypothesis().submit('d-nosafety', {
      ...DESIGN,
      safetyConfirmed: false,
    });
    expect(() => driver.complete()).toThrowError(InquiryTransitionError);
    try {
      driver.complete();
    } catch (error) {
      expect((error as InquiryTransitionError).code).toBe('HARD_CHECKS_FAILED');
      const failing = (error as InquiryTransitionError).details as { id: string }[];
      expect(failing.map((result) => result.id)).toEqual(
        expect.arrayContaining(['design.safety-confirmed']),
      );
    }
    expect(driver.state.position.phaseId).toBe('experiment-design');
  });

  it('rejects a design that references materials the task does not ship', () => {
    const driver = afterHypothesis().submit('d-unknown', {
      ...DESIGN,
      materialIds: ['wood-block', 'unobtainium'],
    });
    expect(() => driver.complete()).toThrowError(/hard checks failed/);
    expect(driver.state.position.phaseId).toBe('experiment-design');
  });

  it('keeps the evidence phase blocked until an experiment is recorded', () => {
    const driver = afterDesign();
    expect(() => driver.complete()).toThrowError(/hard checks failed/);
    expect(driver.state.position.phaseId).toBe('evidence');
    driver.experiment('t-1', 'wood-block', 'water').complete();
    expect(driver.state.position.phaseId).toBe('analysis');
  });
});
