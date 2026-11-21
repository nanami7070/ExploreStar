import { describe, expect, it } from 'vitest';

import {
  DENSITY_TOLERANCE,
  UnsupportedExperimentModelError,
  predictFloatSink,
  predictForMaterial,
} from '@/lib/inquiry/experiments/physics';
import type { TaskMaterial } from '@/lib/inquiry/domain/types';
import { FLOAT_SINK_TASK } from '@/lib/inquiry/tasks/float-sink';

const material = (id: string) => FLOAT_SINK_TASK.materials.find((candidate) => candidate.id === id)!;
const liquid = (id: string) => FLOAT_SINK_TASK.liquids.find((candidate) => candidate.id === id)!;

describe('float/sink density model', () => {
  it('predicts the full MVP material × liquid matrix', () => {
    const expected: Record<string, Record<string, string>> = {
      'wood-block': { water: 'float', 'salt-water': 'float' },
      'plastic-block': { water: 'float', 'salt-water': 'float' },
      'wax-block': { water: 'float', 'salt-water': 'float' },
      'stone-block': { water: 'sink', 'salt-water': 'sink' },
      'iron-nail': { water: 'sink', 'salt-water': 'sink' },
      // Solid clay is denser than both liquids — the boat version is out of scope.
      'clay-ball': { water: 'sink', 'salt-water': 'sink' },
    };
    for (const [materialId, byLiquid] of Object.entries(expected)) {
      for (const [liquidId, outcome] of Object.entries(byLiquid)) {
        expect(predictForMaterial(material(materialId), liquid(liquidId)).outcome).toBe(outcome);
      }
    }
  });

  it('treats densities within tolerance as suspended', () => {
    expect(predictFloatSink(1.0, 1.0).outcome).toBe('suspend');
    expect(predictFloatSink(1.0 + DENSITY_TOLERANCE / 2, 1.0).outcome).toBe('suspend');
    expect(predictFloatSink(1.0 + DENSITY_TOLERANCE * 2, 1.0).outcome).toBe('sink');
    expect(predictFloatSink(1.0 - DENSITY_TOLERANCE * 2, 1.0).outcome).toBe('float');
  });

  it('records parameters, not a student-facing formula', () => {
    const prediction = predictForMaterial(material('wood-block'), liquid('water'));
    expect(prediction.relation).toBe('less');
    expect(prediction.explanation).toBe('object 0.50 < liquid 1.00');
    expect(prediction.explanation).not.toMatch(/浮力|公式|F\s*=/);
  });

  it('rejects non-positive densities', () => {
    expect(() => predictFloatSink(0, 1)).toThrow(RangeError);
    expect(() => predictFloatSink(1, Number.NaN)).toThrow(RangeError);
  });

  it('rejects objects outside the solid fixed-shape model', () => {
    const hollow = {
      id: 'ping-pong-ball',
      name: '乒乓球',
      density: 0.08,
      kind: 'hollow',
    } as unknown as TaskMaterial;
    expect(() => predictForMaterial(hollow, liquid('water'))).toThrow(
      UnsupportedExperimentModelError,
    );
  });
});
