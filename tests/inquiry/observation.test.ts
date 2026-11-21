import { describe, expect, it } from 'vitest';

import { buildGateContext, runHardChecks } from '@/lib/inquiry/domain/gates';
import { replayInquiryEvents } from '@/lib/inquiry/domain/state';
import {
  completePhase,
  recordExperiment,
  recordObservation,
  revertPhase,
  startSession,
  submitSubmission,
  type InquiryTransition,
} from '@/lib/inquiry/domain/transition';
import type { InquiryEvent } from '@/lib/inquiry/domain/events';
import type {
  InquirySessionState,
  InquiryTask,
  SubmissionContent,
} from '@/lib/inquiry/domain/types';
import { compileTask } from '@/lib/inquiry/generation/compile-task';
import { FLOAT_SINK_TASK } from '@/lib/inquiry/tasks/float-sink';

import { observationDraft } from './_generation-fixtures';

const TASK: InquiryTask = compileTask(observationDraft());

const QUESTION: SubmissionContent = { text: '为什么绿豆苗会朝着窗户生长？' };
const HYPOTHESIS: SubmissionContent = {
  text: '我认为绿豆苗会朝光的方向生长，因为它需要光。',
  reason: '植物需要阳光',
};
const DESIGN: SubmissionContent = {
  materialIds: [TASK.materials[0]!.id],
  changedCondition: '摆放的位置（窗边 / 暗处）',
  keptConditions: '都浇一样多的水',
  observedTarget: '茎的弯曲方向',
  safetyConfirmed: true,
};

class Driver {
  state: InquirySessionState;
  events: InquiryEvent[] = [];

  constructor() {
    this.state = startSession(TASK).state;
    this.events.push(...startSession(TASK).events);
  }

  apply(transition: InquiryTransition): this {
    this.state = transition.state;
    this.events.push(...transition.events);
    return this;
  }

  submit(id: string, content: SubmissionContent): this {
    return this.apply(submitSubmission(TASK, this.state, { submissionId: id, content }));
  }

  complete(): this {
    return this.apply(completePhase(TASK, this.state));
  }

  observe(id: string, guess: string, observation: string, note?: string): this {
    return this.apply(
      recordObservation(TASK, this.state, {
        observationId: id,
        guess,
        observation,
        ...(note ? { note } : {}),
        recordedAt: '2026-11-21T09:00:00.000Z',
      }),
    );
  }

  revertTo(targetPhaseIndex: number): this {
    return this.apply(revertPhase(TASK, this.state, { targetPhaseIndex }));
  }
}

function toEvidence(): Driver {
  return new Driver()
    .submit('q-1', QUESTION)
    .complete()
    .submit('h-1', HYPOTHESIS)
    .complete()
    .submit('d-1', DESIGN)
    .complete();
}

describe('real-observation evidence path', () => {
  it('the observation task is in the evidence phase and offers recordObservation', () => {
    const driver = toEvidence();
    expect(driver.state.position.phaseId).toBe('evidence');
    expect(driver.state.status).toBe('waiting_for_student');
  });

  it('records an observation and replays byte-identically', () => {
    const driver = toEvidence().observe('o-1', '我猜它会朝窗户弯', '茎真的弯向窗户了', '第 5 天');
    const stored = driver.state.collected.evidence.observations;
    expect(stored).toHaveLength(1);
    expect(stored[0]!.trialNo).toBe(1);
    expect(stored[0]!.superseded).toBe(false);
    expect(driver.state.position.phaseId).toBe('evidence');
    // Replay from events alone reproduces the same state.
    expect(replayInquiryEvents(TASK, driver.events)).toEqual(driver.state);
  });

  it('a retried observation id is idempotent', () => {
    const driver = toEvidence().observe('o-1', '猜', '看到');
    const again = recordObservation(TASK, driver.state, {
      observationId: 'o-1',
      guess: '猜',
      observation: '看到',
    });
    expect(again.events).toHaveLength(0);
  });

  it('the hard check blocks completion until one observation exists', () => {
    const driver = toEvidence();
    const phase = TASK.phases.find((candidate) => candidate.id === 'evidence')!;
    const before = runHardChecks(
      buildGateContext(TASK, phase, driver.state.collected.evidence),
    ).find((result) => result.id === 'evidence.min-observation-records');
    expect(before?.passed).toBe(false);

    driver.observe('o-1', '猜', '看到');
    const after = runHardChecks(
      buildGateContext(TASK, phase, driver.state.collected.evidence),
    ).find((result) => result.id === 'evidence.min-observation-records');
    expect(after?.passed).toBe(true);
  });

  it('completes the evidence phase with one observation', () => {
    const driver = toEvidence().observe('o-1', '猜', '看到').complete();
    expect(driver.state.position.phaseId).toBe('analysis');
  });

  it('a revert upstream supersedes observations instead of deleting them', () => {
    const driver = toEvidence().observe('o-1', '猜', '看到').complete();
    // analysis active; revert to experiment-design (index 2) invalidates the
    // evidence phase and supersedes its records.
    driver.revertTo(2);
    const observations = driver.state.collected.evidence.observations;
    expect(observations).toHaveLength(1);
    expect(observations[0]!.superseded).toBe(true);
  });

  it('rejects recordExperiment on an observation task', () => {
    const driver = toEvidence();
    expect(() =>
      recordExperiment(TASK, driver.state, {
        trialId: 't-1',
        materialId: TASK.materials[0]!.id,
        liquidId: 'water',
        source: 'sim',
        studentPrediction: 'float',
      }),
    ).toThrowError(/no simulation model/);
  });

  it('rejects recordObservation on a simulation task', () => {
    const state = startSession(FLOAT_SINK_TASK).state;
    expect(() =>
      recordObservation(FLOAT_SINK_TASK, state, {
        observationId: 'o-1',
        guess: '猜',
        observation: '看到',
      }),
    ).toThrowError(/evidence/);
  });

  it('validates guess and observation payloads', () => {
    const driver = toEvidence();
    expect(() =>
      recordObservation(TASK, driver.state, { observationId: 'o-1', guess: '  ', observation: '看到' }),
    ).toThrowError(/guess/);
    expect(() =>
      recordObservation(TASK, driver.state, { observationId: 'o-2', guess: '猜', observation: ' ' }),
    ).toThrowError(/what the student saw/);
    expect(() =>
      recordObservation(TASK, driver.state, {
        observationId: 'o-3',
        guess: '猜',
        observation: 'x'.repeat(1001),
      }),
    ).toThrowError(/exceeds/);
  });

  it('observation events do not disturb existing replay of the float/sink flow', () => {
    // Sanity: the old task still records experiments and replays identically.
    const state = startSession(FLOAT_SINK_TASK).state;
    expect(state.collected.evidence.observations).toEqual([]);
  });
});
