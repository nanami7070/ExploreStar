/**
 * Types for the six-phase science-inquiry flow engine.
 *
 * The engine is a pure domain module: no React, DOM, network, timers or
 * randomness. Every transition takes the current state plus an input and
 * returns `{ state, events }`; events are the single source of truth, so a
 * session can be replayed from its event log (see ./state.ts).
 */

/** The six inquiry phases, in flow order. */
export const PHASE_IDS = [
  'question',
  'hypothesis',
  'experiment-design',
  'evidence',
  'analysis',
  'reflection',
] as const;
export type PhaseId = (typeof PHASE_IDS)[number];

/**
 * Difficulty categories the scaffolding engine distinguishes. `expression` is
 * the common grade 3–4 case of knowing the answer but not being able to say
 * it; `off-task` marks a reply that does not address the current phase goal.
 */
export const DIFFICULTY_TYPES = [
  'concept',
  'method',
  'analysis',
  'expression',
  'off-task',
] as const;
export type DifficultyType = (typeof DIFFICULTY_TYPES)[number];

/** L0 autonomous · L1 light prompt · L2 explicit hint · L3 structured support. */
export type HintLevel = 0 | 1 | 2 | 3;

export type SessionStatus =
  | 'created'
  | 'running'
  | 'waiting_for_student'
  | 'completed'
  | 'failed';

export type PhaseStatus = 'pending' | 'active' | 'completed' | 'invalidated';

/** Actions a student may take in the current state (derived, never stored). */
export type StudentAction =
  | 'submit'
  | 'requestHint'
  | 'chat'
  | 'revert'
  | 'confirmSubmission'
  | 'recordExperiment'
  | 'recordObservation'
  | 'next';

// ---------------------------------------------------------------------------
// Task configuration
// ---------------------------------------------------------------------------

/**
 * Provenance for every scientific claim a task ships. Tasks are reviewed
 * against the textbook before `reviewedAt` is set; the LLM never generates
 * concepts, densities or judgement rules at runtime.
 */
export interface TaskKnowledge {
  source: string;
  reviewer: string;
  reviewedAt: string | null;
}

/**
 * An object the student can test. Only `solid` objects are supported by the
 * MVP density-comparison model: hollow objects (a ping-pong ball) and
 * shape-changing objects (clay sculpted into a boat) need the extended model
 * described in the plan (§3.6) and are rejected by the physics module.
 */
export interface TaskMaterial {
  id: string;
  name: string;
  /**
   * Density is only required — and only read — when the evidence phase carries
   * a `density-compare` experiment config. AI-generated observation tasks use
   * materials that never enter the physics model, so the value stays absent.
   */
  density?: number;
  kind: 'solid';
  hazard?: string;
}

export interface TaskLiquid {
  id: string;
  name: string;
  density: number;
}

/** Three template strings, one per level L1/L2/L3. */
export type HintTriple = readonly [string, string, string];

export type PhaseHintTemplates = { default: HintTriple } & Partial<
  Record<DifficultyType, HintTriple>
>;

export interface PhaseExperimentConfig {
  /** MVP only supports the deterministic density-comparison model. */
  model: 'density-compare';
  materialIds: readonly string[];
  liquidIds: readonly string[];
}

export interface PhaseConfig {
  id: PhaseId;
  title: string;
  goal: string;
  studentTasks: readonly string[];
  /**
   * Hard checks block `completePhase`; every other requirement belongs in
   * `softChecks` and is feedback only (plan §3.3.1).
   */
  hardChecks: readonly string[];
  softChecks: readonly string[];
  hintTemplates: PhaseHintTemplates;
  experiment?: PhaseExperimentConfig;
}

export interface InquiryTask {
  id: string;
  key: string;
  name: string;
  grade: string;
  version: string;
  goals: readonly string[];
  concepts: readonly string[];
  knowledge: TaskKnowledge;
  /** Situation opener shown before the inquiry starts. */
  intro: { title: string; text: string };
  /** Words used by the relevance soft checks. */
  topicKeywords: readonly string[];
  materials: readonly TaskMaterial[];
  liquids: readonly TaskLiquid[];
  safety: readonly string[];
  /** Suggested number of trials before the evidence soft check is satisfied. */
  suggestedTrials: number;
  phases: readonly PhaseConfig[];
  published: boolean;
  /**
   * Set for student-generated personal tasks. Absent for preset tasks.
   * Personal tasks are only visible to their owner.
   */
  ownerId?: string;
}

// ---------------------------------------------------------------------------
// Session state
// ---------------------------------------------------------------------------

/** Everything a student submits in one phase. Fields are phase-specific. */
export interface SubmissionContent {
  text?: string;
  reason?: string;
  materialIds?: string[];
  changedCondition?: string;
  keptConditions?: string;
  observedTarget?: string;
  safetyConfirmed?: boolean;
  declaration?: 'finished' | 'best-effort';
}

export interface SubmissionRecord {
  id: string;
  phaseId: PhaseId;
  /** The phase revision this submission was made against. */
  phaseRevision: number;
  content: SubmissionContent;
  /** Sequence number of the `submission.recorded` event. */
  seq: number;
}

export type FloatSinkOutcome = 'float' | 'sink' | 'suspend';

export interface ExperimentResult {
  /** Deterministic outcome of the density model (simulation truth). */
  predicted: FloatSinkOutcome;
  /** What the student recorded; equals `predicted` in simulation mode. */
  observed: FloatSinkOutcome;
  /**
   * Internal parameter relation, e.g. `object 0.50 < liquid 1.00`. This is a
   * diagnostic string for the record — never a student-facing explanation.
   * Tutor wording comes from task text and scaffolding templates, which do not
   * introduce formulas at grade 3–4.
   */
  explanation: string;
}

export interface DerivedFrom {
  phaseId: PhaseId;
  phaseRevision: number;
  submissionId: string | null;
}

/** The design the experiment was run under, snapshotted at trial time. */
export interface ExperimentDesignSnapshot {
  changedCondition?: string;
  keptConditions?: string;
  observedTarget?: string;
}

export interface ExperimentRecord {
  id: string;
  trialNo: number;
  materialId: string;
  liquidId: string;
  source: 'sim' | 'real';
  /**
   * What the student predicted BEFORE seeing the result. Optional only for
   * records written before P3; every new trial carries it.
   */
  studentPrediction?: FloatSinkOutcome;
  result: ExperimentResult;
  /** The student's own observation note. */
  note?: string;
  /** ISO timestamp of the trial, supplied by the server. */
  recordedAt?: string;
  /** The evidence phase revision the trial belongs to. */
  phaseRevision?: number;
  designSnapshot?: ExperimentDesignSnapshot;
  derivedFrom: DerivedFrom | null;
  /** A revert replaces the experiment; the historical row is kept but ignored. */
  superseded: boolean;
}

/**
 * Whether the student's prediction differs from the observation. `null` when
 * the trial predates prediction recording. A mismatch is a learning
 * opportunity, never an error.
 */
export function predictionMismatch(experiment: ExperimentRecord): boolean | null {
  if (!experiment.studentPrediction) return null;
  return experiment.studentPrediction !== experiment.result.observed;
}

/**
 * A recorded real-world observation for tasks without a simulation model.
 *
 * The AI may generate observation-based inquiries (plants, ice melting, paper
 * planes) but the system has no simulation for them, so the student records
 * what they actually saw. Nothing here is computed by a model.
 */
export interface ObservationRecord {
  id: string;
  /** 1-based order within the evidence phase. */
  trialNo: number;
  /** The student's guess BEFORE observing. */
  guess: string;
  /** What the student observed. */
  observation: string;
  note?: string;
  /** ISO timestamp supplied by the server. */
  recordedAt?: string;
  /** The evidence phase revision the observation belongs to. */
  phaseRevision: number;
  designSnapshot?: ExperimentDesignSnapshot;
  derivedFrom: DerivedFrom | null;
  /** A revert replaces the record; the historical row is kept but ignored. */
  superseded: boolean;
}

export interface SoftCheckVerdict {
  checkId: string;
  passed: boolean;
  detail: string;
}

export interface EvaluationRecord {
  id: string;
  phaseId: PhaseId;
  phaseRevision: number;
  kind: 'soft-check';
  verdict: SoftCheckVerdict;
  submissionId: string | null;
  superseded: boolean;
}

export interface CheckResult {
  id: string;
  passed: boolean;
  detail: string;
}

export interface HintLogEntry {
  level: HintLevel;
  type: DifficultyType | null;
  reason: string;
  providedExplanation: boolean;
  explicit: boolean;
  seq: number;
}

export interface ScaffoldState {
  level: HintLevel;
  log: HintLogEntry[];
  /** Consecutive classified replies of the same difficulty type. */
  consecutive: { type: DifficultyType | null; count: number };
}

export interface PhaseProgress {
  phaseId: PhaseId;
  status: PhaseStatus;
  /** Incremented whenever the phase is re-entered after a revert. */
  revision: number;
  /** Submission attempts in the current revision. */
  attempts: number;
  hint: ScaffoldState;
}

export interface PhaseCollected {
  submissions: SubmissionRecord[];
  confirmedSubmissionId: string | null;
  experiments: ExperimentRecord[];
  /** Real-world observations (tasks without a simulation model). */
  observations: ObservationRecord[];
  evaluations: EvaluationRecord[];
}

export type ChatMessageRole = 'student' | 'tutor';

/**
 * One tutor/student turn. Chat is recorded as events like everything else, so
 * a refresh replays the conversation from the same log (plan §3.4). Chat never
 * advances the phase — only submissions and `next` do.
 */
export interface ChatMessageRecord {
  id: string;
  role: ChatMessageRole;
  text: string;
  /** The phase the conversation happened in (kept for the learning record). */
  phaseId: PhaseId;
  phaseRevision: number;
  /** Sequence number of the `chat.recorded` event. */
  seq: number;
  /** Tutor turns record the scaffold level that shaped the reply. */
  hintLevel?: HintLevel;
}

export type SafetyFlagKind = 'unsafe' | 'injection';

export interface SafetyFlag {
  kind: SafetyFlagKind;
  phaseId: PhaseId;
  seq: number;
}

export interface InquirySessionState {
  status: SessionStatus;
  position: { phaseIndex: number; phaseId: PhaseId };
  phases: PhaseProgress[];
  collected: Record<PhaseId, PhaseCollected>;
  conversation: ChatMessageRecord[];
  /** Messages a deterministic safety rule intercepted (never model-judged). */
  safetyFlags: SafetyFlag[];
  /** Sequence of the last applied event; the next event takes +1. */
  lastSequence: number;
}

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

export type InquiryTransitionCode =
  | 'SESSION_ALREADY_STARTED'
  | 'SESSION_NOT_ACTIVE'
  | 'PHASE_NOT_ACTIVE'
  | 'SUBMISSION_NOT_CONFIRMED'
  | 'SUBMISSION_EMPTY'
  | 'CHAT_EMPTY'
  | 'HARD_CHECKS_FAILED'
  | 'PHASES_NOT_COMPLETE'
  | 'REVERT_TARGET_NOT_COMPLETED'
  | 'NO_SUBMISSION_TO_CONFIRM'
  | 'UNKNOWN_SUBMISSION'
  | 'INVALID_EXPERIMENT_PHASE'
  | 'UNKNOWN_MATERIAL'
  | 'UNKNOWN_LIQUID'
  | 'UNSUPPORTED_MATERIAL'
  | 'OBSERVED_RESULT_REQUIRED'
  | 'INVALID_EXPERIMENT_PAYLOAD'
  | 'NO_EXPERIMENT_CONFIG'
  | 'INVALID_OBSERVATION_PAYLOAD';

export class InquiryTransitionError extends Error {
  constructor(
    readonly code: InquiryTransitionCode,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = 'InquiryTransitionError';
  }
}

// ---------------------------------------------------------------------------
// Scaffolding
// ---------------------------------------------------------------------------

export interface ScaffoldInput {
  phaseId: PhaseId;
  /** Submission attempts in the current phase revision. */
  attempts: number;
  explicitHelp: boolean;
  classifiedType?: DifficultyType | null;
  currentLevel: HintLevel;
  consecutiveType: { type: DifficultyType | null; count: number };
  /** Consecutive submissions on which the same soft check failed. */
  softFailStreak: { checkId: string | null; count: number };
}

export interface ScaffoldDecision {
  level: HintLevel;
  type: DifficultyType | null;
  /** `<phaseId>.<type|default>.L<level>`; render falls back to `default`. */
  templateKey: string;
  /** Audit string for why the level moved; stored in the hint log. */
  reason: string;
  /** True when L3 supplies a direct explanation; always logged. */
  providedExplanation: boolean;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

export function findPhaseConfig(task: InquiryTask, phaseId: PhaseId): PhaseConfig {
  return task.phases.find((phase) => phase.id === phaseId) ?? task.phases[0]!;
}

export function currentPhaseConfig(task: InquiryTask, state: InquirySessionState): PhaseConfig {
  return findPhaseConfig(task, state.position.phaseId);
}

export function currentPhaseProgress(state: InquirySessionState): PhaseProgress {
  return state.phases[state.position.phaseIndex]!;
}

/** The submission hard checks should read: a confirmed one wins, else the latest. */
export function effectiveSubmission(collected: PhaseCollected): SubmissionRecord | null {
  if (collected.confirmedSubmissionId) {
    const confirmed = collected.submissions.find(
      (submission) => submission.id === collected.confirmedSubmissionId,
    );
    if (confirmed) return confirmed;
  }
  return collected.submissions[collected.submissions.length - 1] ?? null;
}

/** True when the content carries anything a student could have meant to submit. */
export function submissionHasContent(content: SubmissionContent): boolean {
  return Boolean(
    content.text?.trim() ||
      content.reason?.trim() ||
      content.changedCondition?.trim() ||
      content.keptConditions?.trim() ||
      content.observedTarget?.trim() ||
      content.declaration ||
      content.safetyConfirmed ||
      (content.materialIds && content.materialIds.length > 0),
  );
}
