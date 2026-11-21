import { describe, expect, it } from 'vitest';

import { createInquirySessionState } from '@/lib/inquiry/domain/state';
import {
  allowedStudentActions,
  failSession,
  recordExperiment,
  startSession,
  submitSubmission,
} from '@/lib/inquiry/domain/transition';
import { InquiryTransitionError } from '@/lib/inquiry/domain/types';
import {
  ANALYSIS,
  QUESTION,
  REFLECTION,
  TASK,
  afterDesign,
  afterEvidence,
  afterHypothesis,
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

describe('inquiry state machine', () => {
  it('starts in the question phase and offers chat but not next', () => {
    const driver = startedSession();
    expect(driver.state.status).toBe('waiting_for_student');
    expect(driver.state.position).toEqual({ phaseIndex: 0, phaseId: 'question' });
    expect(driver.state.phases[0]!.status).toBe('active');
    expect(driver.state.lastSequence).toBe(2);

    const actions = allowedStudentActions(TASK, driver.state);
    expect(actions).toContain('chat');
    expect(actions).toContain('submit');
    expect(actions).not.toContain('next');
    expect(actions).not.toContain('revert');
  });

  it('refuses to start twice', () => {
    const driver = startedSession();
    expectCode(() => startSession(TASK, driver.state), 'SESSION_ALREADY_STARTED');
  });

  it('refuses an empty submission but records a substantive one', () => {
    const driver = startedSession();
    expectCode(
      () => submitSubmission(TASK, driver.state, { submissionId: 'empty', content: { text: '  ' } }),
      'SUBMISSION_EMPTY',
    );

    driver.submit('q-1', QUESTION);
    const question = driver.state.collected.question;
    expect(question.submissions).toHaveLength(1);
    expect(question.submissions[0]!.seq).toBe(3); // after started(1) + phase.entered(2)
    expect(driver.state.phases[0]!.attempts).toBe(1);
    expect(allowedStudentActions(TASK, driver.state)).toContain('next');
  });

  it('blocks completion when hard checks fail and reports which ones', () => {
    const driver = afterHypothesis().submit('d-empty', {
      materialIds: ['wood-block'],
    });
    try {
      driver.complete();
      throw new Error('expected failure');
    } catch (error) {
      expect(error).toBeInstanceOf(InquiryTransitionError);
      const transition = error as InquiryTransitionError;
      expect(transition.code).toBe('HARD_CHECKS_FAILED');
      expect((transition.details as { id: string }[]).map((result) => result.id)).toEqual(
        expect.arrayContaining(['design.changed-condition', 'design.safety-confirmed']),
      );
    }
  });

  it('rejects actions against a non-active phase', () => {
    const driver = afterQuestion();
    expectCode(
      () =>
        recordExperiment(TASK, driver.state, {
          trialId: 't-early',
          materialId: 'wood-block',
          liquidId: 'water',
          source: 'sim',
        }),
      'INVALID_EXPERIMENT_PHASE',
    );
  });

  it('records a deterministic simulation result and links it to the design submission', () => {
    const driver = afterDesign();
    driver.experiment('t-1', 'wood-block', 'water');
    driver.experiment('t-2', 'clay-ball', 'water');

    const [wood, clay] = driver.state.collected.evidence.experiments;
    expect(wood!.result.predicted).toBe('float');
    expect(wood!.result.observed).toBe('float');
    expect(wood!.result.explanation).toBe('object 0.50 < liquid 1.00');
    expect(clay!.result.predicted).toBe('sink');
    expect(clay!.trialNo).toBe(2);
    expect(wood!.derivedFrom).toEqual({
      phaseId: 'experiment-design',
      phaseRevision: 0,
      submissionId: 'd-1',
    });
  });

  it('records the student observation in real-experiment mode', () => {
    const driver = afterDesign().experiment('t-real', 'plastic-block', 'water', 'real', 'sink');
    const record = driver.state.collected.evidence.experiments[0]!;
    expect(record.result.predicted).toBe('float');
    expect(record.result.observed).toBe('sink');
  });

  it('rejects unknown materials, unknown liquids and a missing real observation', () => {
    const driver = afterDesign();
    expectCode(
      () =>
        recordExperiment(TASK, driver.state, {
          trialId: 't-x',
          materialId: 'unobtainium',
          liquidId: 'water',
          source: 'sim',
        }),
      'UNKNOWN_MATERIAL',
    );
    expectCode(
      () =>
        recordExperiment(TASK, driver.state, {
          trialId: 't-y',
          materialId: 'wood-block',
          liquidId: 'lava',
          source: 'sim',
        }),
      'UNKNOWN_LIQUID',
    );
    expectCode(
      () =>
        recordExperiment(TASK, driver.state, {
          trialId: 't-z',
          materialId: 'wood-block',
          liquidId: 'water',
          source: 'real',
        }),
      'OBSERVED_RESULT_REQUIRED',
    );
  });

  it('treats a retried trial id as idempotent', () => {
    const driver = afterDesign().experiment('t-1', 'wood-block', 'water');
    const before = driver.state;
    const retry = recordExperiment(TASK, before, {
      trialId: 't-1',
      materialId: 'wood-block',
      liquidId: 'water',
      source: 'sim',
    });
    expect(retry.events).toEqual([]);
    expect(retry.state).toBe(before);
  });

  it('runs all six phases to completion', () => {
    const driver = afterEvidence().submit('a-1', ANALYSIS).complete();
    expect(driver.state.position.phaseId).toBe('reflection');

    driver.submit('r-1', REFLECTION).complete();
    expect(driver.state.status).toBe('completed');
    expect(driver.state.phases.every((phase) => phase.status === 'completed')).toBe(true);
    expect(driver.events[driver.events.length - 1]).toEqual({ type: 'session.completed' });
    expect(allowedStudentActions(TASK, driver.state)).toEqual([]);
  });

  it('refuses to complete after the session completed', () => {
    const driver = afterEvidence().submit('a-1', ANALYSIS).complete();
    driver.submit('r-1', REFLECTION).complete();
    expectCode(() => driver.complete(), 'SESSION_NOT_ACTIVE');
    expectCode(
      () =>
        submitSubmission(TASK, driver.state, {
          submissionId: 'late',
          content: { text: '再补充一点' },
        }),
      'SESSION_NOT_ACTIVE',
    );
  });

  it('keeps chat available in every active phase but exposes experiments only in evidence', () => {
    for (const driver of [startedSession(), afterQuestion(), afterHypothesis()]) {
      expect(allowedStudentActions(TASK, driver.state)).toContain('chat');
      expect(allowedStudentActions(TASK, driver.state)).not.toContain('recordExperiment');
    }
    const evidence = afterDesign();
    expect(allowedStudentActions(TASK, evidence.state)).toContain('recordExperiment');
    expect(allowedStudentActions(TASK, evidence.state)).not.toContain('next');
    expect(
      allowedStudentActions(TASK, evidence.experiment('t-1', 'wood-block', 'water').state),
    ).toContain('next');
  });

  it('fails a session explicitly', () => {
    const driver = startedSession();
    const transition = failSession(driver.state, 'model unavailable');
    expect(transition.state.status).toBe('failed');
    expect(transition.events).toEqual([{ type: 'session.failed', reason: 'model unavailable' }]);
  });

  it('creates an unstarted state with all phases pending', () => {
    const state = createInquirySessionState(TASK);
    expect(state.status).toBe('created');
    expect(state.phases.every((phase) => phase.status === 'pending')).toBe(true);
    expect(state.lastSequence).toBe(0);
  });
});
