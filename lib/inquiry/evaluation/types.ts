/**
 * Evaluation vocabulary shared by the rule engine, the semantic evaluator,
 * the report builder and the teacher view.
 */
import type { PhaseId } from '@/lib/inquiry/domain/types';

export const EVALUATION_DIMENSIONS = [
  'question',
  'hypothesis',
  'design',
  'evidence',
  'analysis',
  'reflection',
] as const;
export type EvaluationDimension = (typeof EVALUATION_DIMENSIONS)[number];

export type EvaluationLevel = 1 | 2 | 3 | 4;

export type EvaluationStatus = 'evaluated' | 'insufficient_evidence';

export interface RubricLevel {
  level: EvaluationLevel;
  descriptor: string;
}

export interface RubricDimension {
  dimension: EvaluationDimension;
  title: string;
  objective: string;
  indicators: string[];
  levels: RubricLevel[];
  evidenceTypes: string[];
  avoid: string[];
}

/** A reference to one real record the student produced. */
export interface EvidenceRef {
  /** The submission / experiment / chat record id. */
  id: string;
  kind: 'submission' | 'experiment' | 'observation' | 'chat';
  phaseId?: PhaseId;
  /** A short excerpt of the actual student record, never model prose. */
  quote: string;
}

export interface EvidenceItem extends EvidenceRef {
  /** False for records invalidated by a revert (history only). */
  active: boolean;
}

export interface RuleDimensionResult {
  dimension: EvaluationDimension;
  /** False when there is no current-revision evidence to evaluate. */
  sufficient: boolean;
  /** Structural ceiling the semantic level may not exceed. */
  cap: EvaluationLevel | null;
  findings: string[];
  suggestions: string[];
  evidenceRefs: EvidenceRef[];
}

export interface DimensionEvaluation {
  dimension: EvaluationDimension;
  title: string;
  status: EvaluationStatus;
  /** Final level; null when evidence is insufficient. */
  level: EvaluationLevel | null;
  /** Structural ceiling from the rules (null when insufficient). */
  ruleCap: EvaluationLevel | null;
  /** The model's level, if a valid semantic evaluation was merged. */
  semanticLevel: EvaluationLevel | null;
  source: 'rules' | 'rules+semantic';
  basis: string[];
  evidenceRefs: EvidenceRef[];
  suggestions: string[];
}

export type SemanticEvaluationStatus = 'merged' | 'unavailable' | 'invalid' | 'skipped';

export interface EvaluationBundle {
  evaluationVersion: string;
  dimensions: DimensionEvaluation[];
  semanticStatus: SemanticEvaluationStatus;
  activeEvidence: EvidenceItem[];
  supersededEvidence: EvidenceItem[];
}

/** What the semantic evaluator returns for one dimension (before merging). */
export interface SemanticDimensionResult {
  dimension: EvaluationDimension;
  status: EvaluationStatus;
  level: EvaluationLevel | null;
  basis: string[];
  suggestions: string[];
  evidenceRefs: EvidenceRef[];
}

export interface SemanticEvaluation {
  dimensions: SemanticDimensionResult[];
}
