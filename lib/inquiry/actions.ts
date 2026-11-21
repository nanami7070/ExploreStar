/**
 * The student-action payload the API accepts. Shared by the store, the routes
 * and the browser workbench; contains no server imports so the client can use
 * it without pulling the store's pg layer into the bundle.
 */
import type { DifficultyType, FloatSinkOutcome, SubmissionContent } from './domain/types';

export type InquiryStudyAction =
  | { action: 'submit'; content: SubmissionContent }
  | { action: 'requestHint'; explicit: boolean; classifiedType?: DifficultyType | null }
  | { action: 'confirmSubmission'; submissionId?: string }
  | { action: 'revert'; targetPhaseIndex: number; reason?: string }
  | { action: 'next' }
  | {
      action: 'recordExperiment';
      materialId: string;
      liquidId: string;
      source: 'sim' | 'real';
      /** The student's guess before seeing the result (required by the API). */
      studentPrediction: FloatSinkOutcome;
      /** Required for a real-world trial. */
      observed?: FloatSinkOutcome;
      note?: string;
    }
  // Real-world observation record for tasks without a simulation model.
  | { action: 'recordObservation'; guess: string; observation: string; note?: string };
