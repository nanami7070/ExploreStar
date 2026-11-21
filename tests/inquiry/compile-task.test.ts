import { describe, expect, it } from 'vitest';

import { compileTask } from '@/lib/inquiry/generation/compile-task';
import { parseTaskDefinitionDraft } from '@/lib/inquiry/generation/task-schema';
import { PHASE_IDS } from '@/lib/inquiry/domain/types';

import {
  fakeSimulationDraft,
  floatSinkDraft,
  observationDraft,
} from './_generation-fixtures';

describe('compileTask', () => {
  it('keeps the canonical six phases in order', () => {
    const task = compileTask(observationDraft());
    expect(task.phases.map((phase) => phase.id)).toEqual([...PHASE_IDS]);
    expect(task.phases).toHaveLength(6);
  });

  it('rejects a draft with duplicate phases', () => {
    const draft = observationDraft();
    const broken = {
      ...draft,
      phases: draft.phases.map((phase, index) =>
        index === 3 ? { ...phase, id: 'question' as const } : phase,
      ),
    };
    expect(() => compileTask(broken)).toThrow(/duplicate|missing/);
  });

  it('injects the standard check lists and never trusts model checks', () => {
    const task = compileTask(observationDraft());
    const question = task.phases[0]!;
    expect(question.hardChecks).toEqual(['question.text-valid']);
    expect(question.softChecks).toEqual(['question.form', 'question.relevance']);
    const design = task.phases[2]!;
    expect(design.hardChecks).toContain('design.safety-confirmed');
  });

  it('uses tutor guidance as the default hint triple with fallbacks', () => {
    const task = compileTask(observationDraft());
    const hypothesis = task.phases[1]!;
    expect(hypothesis.hintTemplates.default[0]).toContain('朝着光长');
    expect(hypothesis.hintTemplates.default).toHaveLength(3);
  });

  it('observation tasks carry no experiment config and the observation check', () => {
    const task = compileTask(observationDraft());
    const evidence = task.phases.find((phase) => phase.id === 'evidence')!;
    expect(evidence.experiment).toBeUndefined();
    expect(evidence.hardChecks).toEqual(['evidence.min-observation-records']);
    expect(task.liquids).toEqual([]);
  });

  it('float/sink drafts with catalog ids gain the density-compare model', () => {
    const task = compileTask(floatSinkDraft());
    const evidence = task.phases.find((phase) => phase.id === 'evidence')!;
    expect(evidence.experiment).toEqual({
      model: 'density-compare',
      materialIds: ['wood-block', 'stone-block', 'iron-nail'],
      liquidIds: ['water', 'salt-water'],
    });
    expect(evidence.hardChecks).toEqual(['evidence.min-records']);
    const wood = task.materials.find((material) => material.id === 'wood-block')!;
    expect(wood.density).toBe(0.5);
    expect(task.liquids).toHaveLength(2);
  });

  it('a simulation claim with non-catalog materials is downgraded to observation', () => {
    const task = compileTask(fakeSimulationDraft());
    const evidence = task.phases.find((phase) => phase.id === 'evidence')!;
    expect(evidence.experiment).toBeUndefined();
    expect(evidence.hardChecks).toEqual(['evidence.min-observation-records']);
    // Unknown materials keep no density so they can never enter the physics.
    expect(task.materials.every((material) => material.density === undefined)).toBe(true);
  });

  it('clamps suggestedTrials into the supported range', () => {
    const draft = { ...observationDraft(), suggestedTrials: 10 };
    expect(compileTask(draft).suggestedTrials).toBe(6);
    expect(compileTask({ ...draft, suggestedTrials: 1 }).suggestedTrials).toBe(2);
  });

  it('derives non-empty topic keywords for the relevance checks', () => {
    const task = compileTask(observationDraft());
    expect(task.topicKeywords.length).toBeGreaterThan(0);
  });

  it('marks AI tasks as not教研审核 and re-parses as a valid task definition', () => {
    const task = compileTask(observationDraft());
    expect(task.knowledge.reviewedAt).toBeNull();
    expect(task.knowledge.source).toContain('AI');
    // The composer output must satisfy the store's parseTaskDefinition shape.
    const parsed = parseTaskDefinitionDraft(JSON.stringify(observationDraft()));
    expect(parsed).not.toBeNull();
  });

  it('end-to-end: JSON reply → parse → compile', () => {
    const reply = '```json\n' + JSON.stringify(observationDraft()) + '\n```';
    const draft = parseTaskDefinitionDraft(reply)!;
    const task = compileTask(draft);
    expect(task.phases).toHaveLength(6);
    expect(task.name).toBe('植物向着太阳生长');
  });
});
