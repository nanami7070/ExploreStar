import { describe, expect, it } from 'vitest';

import {
  activeExperiments,
  collectEvidence,
  currentRevisionSubmission,
  evaluateRules,
} from '@/lib/inquiry/evaluation/rules';
import {
  ANALYSIS,
  DESIGN,
  HYPOTHESIS,
  QUESTION,
  REFLECTION,
  TASK,
  afterDesign,
  afterEvidence,
  startedSession,
} from './_helpers';

function ruleFor(state: ReturnType<typeof startedSession>['state'], dimension: string) {
  return evaluateRules(TASK, state).find((rule) => rule.dimension === dimension)!;
}

function completed() {
  return startedSession()
    .submit('q-1', QUESTION)
    .complete()
    .submit('h-1', HYPOTHESIS)
    .complete()
    .submit('d-1', DESIGN)
    .complete()
    .experimentEvidence('t-1', 'stone-block', 'water', {
      prediction: 'float',
      note: '我猜错了，石头沉下去了',
    })
    .experimentEvidence('t-2', 'wood-block', 'water', { prediction: 'float' })
    .complete()
    .submit('a-1', ANALYSIS)
    .complete()
    .submit('r-1', REFLECTION)
    .complete();
}

describe('rule evaluation', () => {
  it('evaluates a complete inquiry at the structural ceiling', () => {
    const rules = evaluateRules(TASK, completed().state);
    expect(rules.map((rule) => rule.dimension)).toEqual([
      'question',
      'hypothesis',
      'design',
      'evidence',
      'analysis',
      'reflection',
    ]);
    for (const rule of rules) {
      expect(rule.sufficient, rule.dimension).toBe(true);
      expect(rule.cap, rule.dimension).toBe(3);
      expect(rule.evidenceRefs.length, rule.dimension).toBeGreaterThan(0);
      for (const ref of rule.evidenceRefs) {
        expect(ref.quote.length).toBeGreaterThan(0);
      }
    }
  });

  it('never raises the evidence cap from trial count alone', () => {
    const driver = afterDesign();
    for (let index = 0; index < 5; index += 1) {
      driver.experimentEvidence(`t-${index}`, 'wood-block', 'water', {
        prediction: 'float',
      });
    }
    const rule = ruleFor(driver.state, 'evidence');
    expect(rule.sufficient).toBe(true);
    expect(rule.cap).toBe(2);
    expect(rule.suggestions.join('')).toContain('比较一种材料');
  });

  it('reaches cap 4 when a prediction mismatch was retried', () => {
    const driver = afterDesign()
      .experimentEvidence('t-1', 'stone-block', 'water', { prediction: 'float' })
      .experimentEvidence('t-2', 'stone-block', 'water', { prediction: 'sink' });
    const rule = ruleFor(driver.state, 'evidence');
    expect(rule.cap).toBe(4);
    expect(rule.findings.join('')).toContain('针对不一致的结果主动重复');
  });

  it('treats a reverted phase without a current submission as insufficient', () => {
    const driver = afterEvidence().revert({ targetPhaseIndex: 1 });
    const hypothesis = ruleFor(driver.state, 'hypothesis');
    expect(hypothesis.sufficient).toBe(false);
    expect(hypothesis.cap).toBeNull();
    // The old draft is still history, but not current evidence.
    expect(currentRevisionSubmission(driver.state, 'hypothesis')).toBeNull();
    expect(driver.state.collected.hypothesis.submissions.length).toBe(1);
    expect(ruleFor(driver.state, 'design').sufficient).toBe(false);
    expect(ruleFor(driver.state, 'evidence').sufficient).toBe(false);
    expect(ruleFor(driver.state, 'analysis').sufficient).toBe(false);
  });

  it('accepts a confirmed submission after a revert and caps the revised dimension at 4', () => {
    const driver = afterEvidence().revert({ targetPhaseIndex: 2 });
    driver.confirm('d-1');
    const design = ruleFor(driver.state, 'design');
    expect(design.sufficient).toBe(true);
    expect(design.cap).toBe(4);
    expect(design.findings.join('')).toContain('修改过实验设计');
  });

  it('marks evidence insufficient with no current trial', () => {
    const rule = ruleFor(afterDesign().state, 'evidence');
    expect(rule.sufficient).toBe(false);
    expect(rule.cap).toBeNull();
    expect(rule.evidenceRefs).toEqual([]);
  });

  it('separates active evidence from superseded history', () => {
    const driver = afterEvidence().revert({ targetPhaseIndex: 2 });
    const evidence = collectEvidence(TASK, driver.state);
    expect(evidence.active.some((item) => item.kind === 'experiment')).toBe(false);
    expect(evidence.superseded.some((item) => item.kind === 'experiment')).toBe(true);
    expect(activeExperiments(driver.state)).toEqual([]);
  });

  it('does not score a correct guess higher than a reasonable wrong one', () => {
    const right = afterDesign()
      .experimentEvidence('t-1', 'wood-block', 'water', { prediction: 'float' })
      .experimentEvidence('t-2', 'stone-block', 'water', { prediction: 'sink' });
    const wrong = afterDesign()
      .experimentEvidence('t-1', 'wood-block', 'water', { prediction: 'sink' })
      .experimentEvidence('t-2', 'stone-block', 'water', { prediction: 'float' });
    expect(ruleFor(right.state, 'evidence').cap).toBe(ruleFor(wrong.state, 'evidence').cap);
  });

  it('uses the current revision of the question only', () => {
    const driver = startedSession().submit('q-1', QUESTION).complete();
    // The hypothesis phase is active; the question is still current there.
    expect(ruleFor(driver.state, 'question').sufficient).toBe(true);
    const revised = startedSession().submit('q-1', QUESTION).complete();
    revised.revert({ targetPhaseIndex: 0 });
    // Re-entered question with no submission for the new revision.
    expect(ruleFor(revised.state, 'question').sufficient).toBe(false);
    revised.submit('q-2', { text: '换一种液体，木块还会浮吗？' });
    const rule = ruleFor(revised.state, 'question');
    expect(rule.sufficient).toBe(true);
    expect(rule.cap).toBe(4);
  });
});
