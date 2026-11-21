/**
 * The inquiry event log. Events are append-only, sequence-numbered by the
 * server, and are the source of truth: `applyInquiryEvent` in ./state.ts
 * rebuilds the session state from them, so a refresh (or a database restore)
 * replays the same history.
 *
 * Ordering guarantees produced by ./transition.ts:
 * - `submission.recorded` precedes the `evaluation.recorded` rows it produced;
 * - `phase.completed` precedes the `phase.entered` of the next phase;
 * - `phase.reverted` → `phase.reactivated` → `artifacts.invalidated` are
 *   emitted together by one revert call;
 * - `hint.levelChanged` (when present) follows its `hint.requested`.
 */
import type {
  ChatMessageRecord,
  DifficultyType,
  EvaluationRecord,
  ExperimentRecord,
  HintLevel,
  HintLogEntry,
  ObservationRecord,
  PhaseId,
  ScaffoldState,
  SubmissionRecord,
} from './types';

export type InquiryEvent =
  | { type: 'session.started'; taskId: string }
  | { type: 'phase.entered'; phaseIndex: number; phaseId: PhaseId }
  | { type: 'submission.recorded'; phaseId: PhaseId; phaseRevision: number; submission: SubmissionRecord }
  | { type: 'submission.confirmed'; phaseId: PhaseId; phaseRevision: number; submissionId: string }
  | {
      type: 'phase.completed';
      phaseId: PhaseId;
      phaseRevision: number;
      /** Ids of the hard checks that passed; soft checks never appear here. */
      hardCheckIds: readonly string[];
    }
  | { type: 'phase.reverted'; phaseId: PhaseId; phaseRevision: number; reason?: string }
  | { type: 'phase.reactivated'; phaseId: PhaseId; phaseRevision: number }
  | {
      type: 'artifacts.invalidated';
      phaseIds: readonly PhaseId[];
      causedBy: PhaseId;
    }
  | {
      type: 'hint.requested';
      phaseId: PhaseId;
      entry: HintLogEntry;
      /** Consecutive difficulty tracking after this hint request. */
      consecutive: ScaffoldState['consecutive'];
    }
  | {
      type: 'hint.levelChanged';
      phaseId: PhaseId;
      from: HintLevel;
      to: HintLevel;
      reason: string;
    }
  /**
   * A classifier recognised a difficulty type in a student turn. It never
   * changes the hint level — only `hint.requested` does (supplementary
   * principle: classification ≠ level decision).
   */
  | {
      type: 'hint.classified';
      phaseId: PhaseId;
      classifiedType: DifficultyType;
      consecutive: ScaffoldState['consecutive'];
    }
  | { type: 'experiment.recorded'; phaseId: PhaseId; experiment: ExperimentRecord }
  /** A real-world observation for tasks without a simulation model. */
  | { type: 'observation.recorded'; phaseId: PhaseId; observation: ObservationRecord }
  | { type: 'evaluation.recorded'; phaseId: PhaseId; evaluation: EvaluationRecord }
  /** A tutor or student chat turn. Never changes the position or phase status. */
  | {
      type: 'chat.recorded';
      phaseId: PhaseId;
      phaseRevision: number;
      message: ChatMessageRecord;
    }
  /** A deterministic safety rule intercepted a student message. */
  | { type: 'safety.flagged'; phaseId: PhaseId; kind: 'unsafe' | 'injection' }
  | { type: 'report.generated'; reportRevision: number }
  | { type: 'session.completed' }
  | { type: 'session.failed'; reason: string };

/** Convenience: the classification carried on a hint request, if any. */
export interface HintRequestInput {
  explicit: boolean;
  classifiedType?: DifficultyType | null;
}
