import { describe, expect, it } from 'vitest';

import { buildInquiryReport } from '@/lib/inquiry/evaluation/report';
import type { EvaluationBundle } from '@/lib/inquiry/evaluation/types';
import {
  activeObservations,
  collectEvidence,
  evaluateRules,
  observationQuote,
} from '@/lib/inquiry/evaluation/rules';
import { replayInquiryEvents } from '@/lib/inquiry/domain/state';
import {
  completePhase,
  recordObservation,
  startSession,
  submitSubmission,
  type InquiryTransition,
} from '@/lib/inquiry/domain/transition';
import type { InquiryEvent } from '@/lib/inquiry/domain/events';
import type { InquirySessionState, InquiryTask } from '@/lib/inquiry/domain/types';
import { compileTask } from '@/lib/inquiry/generation/compile-task';

import { observationDraft } from './_generation-fixtures';

const TASK: InquiryTask = compileTask(observationDraft());

class Driver {
  state: InquirySessionState = startSession(TASK).state;
  events: InquiryEvent[] = [...startSession(TASK).events];

  apply(transition: InquiryTransition): this {
    this.state = transition.state;
    this.events.push(...transition.events);
    return this;
  }

  submit(id: string, text: string): this {
    return this.apply(submitSubmission(TASK, this.state, { submissionId: id, content: { text } }));
  }

  submitDesign(): this {
    return this.apply(
      submitSubmission(TASK, this.state, {
        submissionId: 'd-1',
        content: {
          materialIds: [TASK.materials[0]!.id],
          changedCondition: '摆放位置',
          keptConditions: '同样浇水',
          observedTarget: '茎的方向',
          safetyConfirmed: true,
        },
      }),
    );
  }

  complete(): this {
    return this.apply(completePhase(TASK, this.state));
  }

  observe(id: string, trialNo: number): this {
    return this.apply(
      recordObservation(TASK, this.state, {
        observationId: id,
        guess: `我猜第 ${trialNo} 次会朝光弯`,
        observation: `第 ${trialNo} 次观察：茎朝窗户弯了约 30 度`,
        note: `第 ${trialNo} 天记录`,
        recordedAt: `2026-11-2${trialNo}T09:00:00.000Z`,
      }),
    );
  }
}

function completedStudy(observationCount: number): Driver {
  const driver = new Driver()
    .submit('q-1', '为什么绿豆苗会朝着窗户生长？')
    .complete()
    .submit('h-1', '我认为它朝光生长，因为植物需要光。')
    .complete()
    .submitDesign()
    .complete();
  for (let index = 1; index <= observationCount; index += 1) {
    driver.observe(`o-${index}`, index);
  }
  return driver
    .complete()
    .submit('a-1', '我发现第 1 次观察里茎朝窗户弯了，说明植物会朝光生长。')
    .complete()
    .submit('r-1', '这次观察次数还不够多，下次想每天同一时间记录。')
    .complete();
}

describe('observation evaluation', () => {
  it('collects observation evidence with server-built quotes', () => {
    const driver = completedStudy(2);
    const { active, superseded } = collectEvidence(TASK, driver.state);
    const observationItems = active.filter((item) => item.kind === 'observation');
    expect(observationItems).toHaveLength(2);
    expect(observationItems[0]!.quote).toContain('我猜第 1 次');
    expect(observationItems[0]!.quote).toContain('观察到');
    expect(superseded).toHaveLength(0);
  });

  it('rates evidence from observations, never from a correct guess', () => {
    const driver = completedStudy(2);
    const evidence = evaluateRules(TASK, driver.state).find(
      (dimension) => dimension.dimension === 'evidence',
    )!;
    expect(evidence.sufficient).toBe(true);
    expect(evidence.cap).toBeGreaterThanOrEqual(3);
    expect(evidence.findings.join('')).toContain('2 次真实观察');
    expect(evidence.evidenceRefs.every((ref) => ref.kind === 'observation')).toBe(true);
  });

  it('single observation caps at level 2', () => {
    const driver = completedStudy(1);
    const evidence = evaluateRules(TASK, driver.state).find(
      (dimension) => dimension.dimension === 'evidence',
    )!;
    expect(evidence.cap).toBe(2);
  });

  it('reports observations in the document and timeline', () => {
    const driver = completedStudy(3);
    const rules = evaluateRules(TASK, driver.state);
    const evidence = collectEvidence(TASK, driver.state);
    const bundle: EvaluationBundle = {
      evaluationVersion: 'test-observation',
      dimensions: rules.map((rule) => ({
        dimension: rule.dimension,
        title: rule.dimension,
        status: rule.sufficient ? 'evaluated' : 'insufficient_evidence',
        level: rule.cap,
        ruleCap: rule.cap,
        semanticLevel: null,
        source: 'rules',
        basis: rule.findings,
        evidenceRefs: rule.evidenceRefs,
        suggestions: rule.suggestions,
      })),
      semanticStatus: 'skipped',
      activeEvidence: evidence.active,
      supersededEvidence: evidence.superseded,
    };
    const document = buildInquiryReport({
      task: TASK,
      state: replayInquiryEvents(TASK, driver.events),
      studyRevision: 3,
      learnerKey: 'anon:test',
      generatedAt: '2026-11-21T10:00:00.000Z',
      bundle,
    });
    expect(document.observations?.active).toHaveLength(3);
    const timelineObservations = document.timeline.filter((item) => item.kind === 'observation');
    expect(timelineObservations).toHaveLength(3);
    expect(document.findings.join('')).toContain('第 1 次观察');
  });

  it('observation quotes truncate long text', () => {
    const quote = observationQuote({
      id: 'o-1',
      trialNo: 1,
      guess: 'g'.repeat(200),
      observation: 'o'.repeat(500),
      phaseRevision: 0,
      derivedFrom: null,
      superseded: false,
    });
    expect(quote.length).toBeLessThan(320);
    expect(quote).toContain('…');
  });

  it('activeObservations ignores superseded rows', () => {
    const driver = completedStudy(2);
    const evidencePhase = completedStudy(2).state.collected.evidence.observations;
    expect(evidencePhase).toHaveLength(2);
    expect(activeObservations(driver.state)).toHaveLength(2);
  });
});
