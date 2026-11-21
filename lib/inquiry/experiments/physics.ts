/**
 * Deterministic float/sink model for the MVP inquiry task.
 *
 * Scope (plan §3.6): a *solid, homogeneous object of fixed shape* placed in a
 * liquid floats when its density is lower than the liquid's, sinks when it is
 * higher, and is suspended when the two are equal within tolerance. The model
 * intentionally does **not** cover:
 *
 * - hollow objects (a ping-pong ball, whose average density includes air);
 * - shape changes (clay sculpted into a boat): the material density does not
 *   change — the boat floats because it displaces more water, so the overall
 *   effective density drops. That is the extended model, not this one;
 * - water-absorbing materials (the task config therefore specifies dry blocks).
 *
 * Teaching boundary: this module returns physical parameters for the record.
 * The student-facing wording never surfaces these formulas; grade 3–4 learners
 * compare objects and liquids qualitatively through the tutor's templates.
 */
import type { FloatSinkOutcome, TaskLiquid, TaskMaterial } from '@/lib/inquiry/domain/types';

/**
 * Relative density difference treated as "about equal". 2% is wide enough to
 * make the suspend state reachable if a task later adds a near-neutral
 * material, and narrow enough that none of the MVP materials are ambiguous.
 */
export const DENSITY_TOLERANCE = 0.02;

export class UnsupportedExperimentModelError extends Error {
  constructor(readonly materialId: string, detail: string) {
    super(detail);
    this.name = 'UnsupportedExperimentModelError';
  }
}

export interface DensityPrediction {
  outcome: FloatSinkOutcome;
  objectDensity: number;
  liquidDensity: number;
  relation: 'less' | 'equal' | 'greater';
  /** Internal, parameter-level note stored with the trial (not student text). */
  explanation: string;
}

export function predictFloatSink(objectDensity: number, liquidDensity: number): DensityPrediction {
  if (!Number.isFinite(objectDensity) || objectDensity <= 0) {
    throw new RangeError(`object density must be a positive number, got ${objectDensity}`);
  }
  if (!Number.isFinite(liquidDensity) || liquidDensity <= 0) {
    throw new RangeError(`liquid density must be a positive number, got ${liquidDensity}`);
  }
  const relative = (objectDensity - liquidDensity) / liquidDensity;
  if (Math.abs(relative) <= DENSITY_TOLERANCE) {
    return {
      outcome: 'suspend',
      objectDensity,
      liquidDensity,
      relation: 'equal',
      explanation: `object ${objectDensity.toFixed(2)} ≈ liquid ${liquidDensity.toFixed(2)}`,
    };
  }
  const relation = objectDensity < liquidDensity ? 'less' : 'greater';
  return {
    outcome: objectDensity < liquidDensity ? 'float' : 'sink',
    objectDensity,
    liquidDensity,
    relation,
    explanation: `object ${objectDensity.toFixed(2)} ${
      relation === 'less' ? '<' : '>'
    } liquid ${liquidDensity.toFixed(2)}`,
  };
}

/**
 * Predict one trial. Rejects materials outside the MVP model's scope instead
 * of inventing a plausible-looking answer.
 */
export function predictForMaterial(
  material: TaskMaterial,
  liquid: TaskLiquid,
): DensityPrediction {
  if (material.kind !== 'solid') {
    throw new UnsupportedExperimentModelError(
      material.id,
      `material ${material.id} is not a solid fixed-shape object; the MVP density model does not apply`,
    );
  }
  if (typeof material.density !== 'number' || !Number.isFinite(material.density)) {
    throw new UnsupportedExperimentModelError(
      material.id,
      `material ${material.id} has no density; it is not part of the density-compare catalog`,
    );
  }
  return predictFloatSink(material.density, liquid.density);
}
