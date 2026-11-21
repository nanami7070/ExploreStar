import { describe, expect, it } from 'vitest';

import { isImplementedCheckId } from '@/lib/inquiry/domain/gates';
import { PHASE_IDS } from '@/lib/inquiry/domain/types';
import { FLOAT_SINK_TASK } from '@/lib/inquiry/tasks/float-sink';

describe('float-sink task configuration', () => {
  it('declares the six phases in inquiry order', () => {
    expect(FLOAT_SINK_TASK.phases.map((phase) => phase.id)).toEqual([...PHASE_IDS]);
  });

  it('references only implemented gate ids', () => {
    for (const phase of FLOAT_SINK_TASK.phases) {
      for (const id of [...phase.hardChecks, ...phase.softChecks]) {
        expect(isImplementedCheckId(id), `${phase.id} references ${id}`).toBe(true);
      }
    }
  });

  it('keeps blocking checks to data completeness and puts teaching judgement in soft checks', () => {
    const question = FLOAT_SINK_TASK.phases.find((phase) => phase.id === 'question')!;
    // A yes/no question is a soft-check judgement, never a hard block.
    expect(question.hardChecks).not.toContain('question.form');
    expect(question.softChecks).toContain('question.form');

    const evidence = FLOAT_SINK_TASK.phases.find((phase) => phase.id === 'evidence')!;
    // One trial is enough to complete; the suggested count is soft.
    expect(evidence.hardChecks).toEqual(['evidence.min-records']);
    expect(evidence.softChecks).toContain('evidence.suggested-count');
  });

  it('ships a default trio of hint templates for every phase', () => {
    for (const phase of FLOAT_SINK_TASK.phases) {
      expect(phase.hintTemplates.default).toHaveLength(3);
      for (const template of phase.hintTemplates.default) {
        expect(template.trim().length).toBeGreaterThan(0);
      }
    }
  });

  it('keeps every material inside the MVP solid fixed-shape model', () => {
    expect(FLOAT_SINK_TASK.materials.length).toBeGreaterThan(0);
    for (const material of FLOAT_SINK_TASK.materials) {
      expect(material.kind).toBe('solid');
      expect(material.density).toBeGreaterThan(0);
    }
    for (const liquid of FLOAT_SINK_TASK.liquids) {
      expect(liquid.density).toBeGreaterThan(0);
    }
  });

  it('wires the evidence experiment to the declared materials and liquids', () => {
    const evidence = FLOAT_SINK_TASK.phases.find((phase) => phase.id === 'evidence')!;
    expect(evidence.experiment?.model).toBe('density-compare');
    const materialIds = new Set(FLOAT_SINK_TASK.materials.map((material) => material.id));
    const liquidIds = new Set(FLOAT_SINK_TASK.liquids.map((liquid) => liquid.id));
    for (const id of evidence.experiment?.materialIds ?? []) expect(materialIds.has(id)).toBe(true);
    for (const id of evidence.experiment?.liquidIds ?? []) expect(liquidIds.has(id)).toBe(true);
  });

  it('carries knowledge provenance and stays unpublished until reviewed', () => {
    expect(FLOAT_SINK_TASK.knowledge.source.length).toBeGreaterThan(0);
    expect(FLOAT_SINK_TASK.knowledge.reviewer.length).toBeGreaterThan(0);
    expect(FLOAT_SINK_TASK.knowledge.reviewedAt).toBeNull();
    expect(FLOAT_SINK_TASK.published).toBe(false);
    expect(FLOAT_SINK_TASK.safety.length).toBeGreaterThan(0);
  });
});
