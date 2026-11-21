/**
 * Inquiry state machine.
 *
 * Every exported transition is pure and returns `{ state, events }`. The state
 * is produced by folding the emitted events through `foldInquiryEvents`, which
 * guarantees event replay reproduces the exact same state (tested in
 * tests/inquiry/event-replay.test.ts).
 *
 * Design boundary (supplementary principle #1): the machine constrains task
 * progression and record keeping — not the tutor's conversation. `chat` is
 * always an allowed action, and the tutor may answer cross-phase questions;
 * only `completePhase`/`revertPhase` change position, and only the student's
 * explicit submissions advance the record.
 */
import type { InquiryEvent } from './events';
import { buildGateContext, runHardChecks, runSoftChecks } from './gates';
import {
  computeScaffold,
  nextConsecutive,
  softFailStreak,
} from './scaffolding';
import { createInquirySessionState, foldInquiryEvents } from './state';
import { predictForMaterial, UnsupportedExperimentModelError } from '@/lib/inquiry/experiments/physics';
import {
  PHASE_IDS,
  InquiryTransitionError,
  currentPhaseConfig,
  currentPhaseProgress,
  effectiveSubmission,
  findPhaseConfig,
  submissionHasContent,
  type DerivedFrom,
  type DifficultyType,
  type EvaluationRecord,
  type ExperimentDesignSnapshot,
  type FloatSinkOutcome,
  type InquirySessionState,
  type ChatMessageRecord,
  type ChatMessageRole,
  type HintLevel,
  type InquiryTask,
  type PhaseCollected,
  type PhaseProgress,
  type SafetyFlagKind,
  type StudentAction,
  type SubmissionContent,
} from './types';

export interface InquiryTransition {
  state: InquirySessionState;
  events: InquiryEvent[];
}

function build(state: InquirySessionState, events: InquiryEvent[]): InquiryTransition {
  return { state: foldInquiryEvents(state, events), events };
}

function ensureActive(state: InquirySessionState): void {
  if (state.status !== 'running' && state.status !== 'waiting_for_student') {
    throw new InquiryTransitionError(
      'SESSION_NOT_ACTIVE',
      `session is ${state.status}; the action needs an active session`,
    );
  }
}

function ensurePhaseActive(state: InquirySessionState): void {
  ensureActive(state);
  const progress = currentPhaseProgress(state);
  if (progress.status !== 'active') {
    throw new InquiryTransitionError(
      'PHASE_NOT_ACTIVE',
      `phase ${progress.phaseId} is ${progress.status}; the action needs the active phase`,
    );
  }
}

/**
 * After a revert a phase has a new revision. Its historical submissions stay
 * in the record, but completing it again requires either a submission made in
 * the new revision or an explicit `confirmSubmission` of the old one — data
 * corrected upstream should not be re-approved silently.
 */
function submissionReadyForCompletion(
  progress: PhaseProgress,
  collected: PhaseCollected,
): boolean {
  // Evidence is gated by its experiment records, not by a free-text note; a
  // stale note must not block a phase that never needed one.
  if (progress.phaseId === 'evidence') return true;
  const effective = effectiveSubmission(collected);
  if (!effective) return true;
  return effective.phaseRevision === progress.revision || collected.confirmedSubmissionId !== null;
}

export function startSession(
  task: InquiryTask,
  state: InquirySessionState = createInquirySessionState(task),
): InquiryTransition {
  if (state.status !== 'created') {
    throw new InquiryTransitionError('SESSION_ALREADY_STARTED', 'session already started');
  }
  const first = PHASE_IDS[0];
  return build(state, [
    { type: 'session.started', taskId: task.id },
    { type: 'phase.entered', phaseIndex: 0, phaseId: first },
  ]);
}

export interface SubmitInput {
  /** Server-generated id; the domain never invents ids. */
  submissionId: string;
  content: SubmissionContent;
}

/**
 * Record a submission. Structural problems are not rejected here — they are
 * reported by the hard checks when the student tries to complete the phase —
 * except for a completely empty submission, which has nothing to record.
 */
export function submitSubmission(
  task: InquiryTask,
  state: InquirySessionState,
  input: SubmitInput,
): InquiryTransition {
  ensurePhaseActive(state);
  if (!submissionHasContent(input.content)) {
    throw new InquiryTransitionError('SUBMISSION_EMPTY', 'the submission is empty');
  }
  const progress = currentPhaseProgress(state);
  const phase = currentPhaseConfig(task, state);
  const submission = {
    id: input.submissionId,
    phaseId: progress.phaseId,
    phaseRevision: progress.revision,
    content: input.content,
    seq: state.lastSequence + 1,
  };
  const collectedWithSubmission = {
    ...state.collected[progress.phaseId],
    submissions: [...state.collected[progress.phaseId].submissions, submission],
  };
  const softResults = runSoftChecks(buildGateContext(task, phase, collectedWithSubmission));
  const evaluations: EvaluationRecord[] = softResults.map((result) => ({
    id: `${input.submissionId}:soft:${result.id}`,
    phaseId: progress.phaseId,
    phaseRevision: progress.revision,
    kind: 'soft-check',
    verdict: { checkId: result.id, passed: result.passed, detail: result.detail },
    submissionId: input.submissionId,
    superseded: false,
  }));

  return build(state, [
    {
      type: 'submission.recorded',
      phaseId: progress.phaseId,
      phaseRevision: progress.revision,
      submission,
    },
    ...evaluations.map((evaluation): InquiryEvent => ({
      type: 'evaluation.recorded',
      phaseId: progress.phaseId,
      evaluation,
    })),
  ]);
}

export interface HintInput {
  explicit: boolean;
  /** The P2 classifier's output; P1 accepts it as an input and never calls a model. */
  classifiedType?: DifficultyType | null;
}

export function requestHint(
  state: InquirySessionState,
  input: HintInput,
): InquiryTransition {
  ensurePhaseActive(state);
  const progress = currentPhaseProgress(state);
  const consecutive = nextConsecutive(progress.hint.consecutive, input.classifiedType ?? null);
  const decision = computeScaffold({
    phaseId: progress.phaseId,
    attempts: progress.attempts,
    explicitHelp: input.explicit,
    classifiedType: input.classifiedType ?? null,
    currentLevel: progress.hint.level,
    consecutiveType: consecutive,
    softFailStreak: softFailStreak(state.collected[progress.phaseId]),
  });

  const events: InquiryEvent[] = [
    {
      type: 'hint.requested',
      phaseId: progress.phaseId,
      entry: {
        level: decision.level,
        type: decision.type,
        reason: decision.reason,
        providedExplanation: decision.providedExplanation,
        explicit: input.explicit,
        seq: state.lastSequence + 1,
      },
      consecutive,
    },
  ];
  if (decision.level !== progress.hint.level) {
    events.push({
      type: 'hint.levelChanged',
      phaseId: progress.phaseId,
      from: progress.hint.level,
      to: decision.level,
      reason: decision.reason,
    });
  }
  return build(state, events);
}

export interface ConfirmInput {
  /** Defaults to the latest submission of the current revision. */
  submissionId?: string;
}

/**
 * Reuse an earlier submission after a revert instead of retyping it. The
 * historical submissions stay in the record; hard checks read the confirmed
 * one (see `effectiveSubmission`).
 */
export function confirmSubmission(
  state: InquirySessionState,
  input: ConfirmInput = {},
): InquiryTransition {
  ensurePhaseActive(state);
  const progress = currentPhaseProgress(state);
  const collected = state.collected[progress.phaseId];
  if (!collected.submissions.length) {
    throw new InquiryTransitionError(
      'NO_SUBMISSION_TO_CONFIRM',
      `phase ${progress.phaseId} has no earlier submission to confirm`,
    );
  }
  const submissionId = input.submissionId ?? collected.submissions[collected.submissions.length - 1]!.id;
  if (!collected.submissions.some((submission) => submission.id === submissionId)) {
    throw new InquiryTransitionError(
      'UNKNOWN_SUBMISSION',
      `phase ${progress.phaseId} has no submission ${submissionId}`,
    );
  }
  return build(state, [
    {
      type: 'submission.confirmed',
      phaseId: progress.phaseId,
      phaseRevision: progress.revision,
      submissionId,
    },
  ]);
}

export interface RecordDifficultyInput {
  /** The classifier's output; the level is never derived from this alone. */
  type: DifficultyType;
}

/**
 * Store a classified difficulty on the active phase. The deterministic
 * scaffolding engine reads the resulting streak the next time the student
 * asks for help; this transition never changes the hint level itself.
 */
export function recordDifficulty(
  state: InquirySessionState,
  input: RecordDifficultyInput,
): InquiryTransition {
  ensurePhaseActive(state);
  const progress = currentPhaseProgress(state);
  const consecutive = nextConsecutive(progress.hint.consecutive, input.type);
  return build(state, [
    {
      type: 'hint.classified',
      phaseId: progress.phaseId,
      classifiedType: input.type,
      consecutive,
    },
  ]);
}

export interface RecordSafetyFlagInput {
  kind: SafetyFlagKind;
}

/**
 * Record that a deterministic safety rule intercepted a student message.
 * This is evidence for the learning record and the teacher view; it does not
 * move the phase or otherwise penalise the student.
 */
export function recordSafetyFlag(
  state: InquirySessionState,
  input: RecordSafetyFlagInput,
): InquiryTransition {
  ensureActive(state);
  const progress = currentPhaseProgress(state);
  return build(state, [
    { type: 'safety.flagged', phaseId: progress.phaseId, kind: input.kind },
  ]);
}

export interface ChatMessageInput {
  /** Server-generated id; the domain never invents ids. */
  messageId: string;
  role: ChatMessageRole;
  text: string;
  /** Tutor turns record the scaffold level that shaped the reply. */
  hintLevel?: HintLevel;
}

/**
 * Record one chat turn. This never changes the position, the phase status or
 * any collected work — the machine records conversation, the student's
 * explicit submissions advance it (supplementary principle #1).
 */
export function recordChatMessage(
  state: InquirySessionState,
  input: ChatMessageInput,
): InquiryTransition {
  ensureActive(state);
  const text = input.text.trim();
  if (!text) {
    throw new InquiryTransitionError('CHAT_EMPTY', 'the chat message is empty');
  }
  const progress = currentPhaseProgress(state);
  const message: ChatMessageRecord = {
    id: input.messageId,
    role: input.role,
    text,
    phaseId: progress.phaseId,
    phaseRevision: progress.revision,
    seq: state.lastSequence + 1,
    ...(input.hintLevel === undefined ? {} : { hintLevel: input.hintLevel }),
  };
  return build(state, [
    {
      type: 'chat.recorded',
      phaseId: progress.phaseId,
      phaseRevision: progress.revision,
      message,
    },
  ]);
}

export interface RecordExperimentInput {
  trialId: string;
  materialId: string;
  liquidId: string;
  source: 'sim' | 'real';
  /** Required for `real`: what the student actually observed. */
  observed?: FloatSinkOutcome;
  /** What the student guessed before the trial; required by the server action. */
  studentPrediction?: FloatSinkOutcome;
  /** The student's observation note (plan §二). */
  note?: string;
  /** Server timestamp; tests pass a fixed value for deterministic replay. */
  recordedAt?: string;
}

/** A real-world observation for tasks without a simulation model. */
export interface RecordObservationInput {
  observationId: string;
  /** The student's guess before observing. */
  guess: string;
  /** What the student actually observed. */
  observation: string;
  note?: string;
  recordedAt?: string;
}

const OUTCOMES: readonly FloatSinkOutcome[] = ['float', 'sink', 'suspend'];
const NOTE_LIMIT = 300;
const GUESS_LIMIT = 300;
const OBSERVATION_LIMIT = 1000;

/**
 * Record one trial. The predicted outcome is computed here from the reviewed
 * task constants, so neither the client nor a language model can invent it.
 */
export function recordExperiment(
  task: InquiryTask,
  state: InquirySessionState,
  input: RecordExperimentInput,
): InquiryTransition {
  ensureActive(state);
  const progress = currentPhaseProgress(state);
  if (progress.phaseId !== 'evidence' || progress.status !== 'active') {
    throw new InquiryTransitionError(
      'INVALID_EXPERIMENT_PHASE',
      `experiments are recorded in the active evidence phase, not ${progress.phaseId}`,
    );
  }
  const evidencePhase = currentPhaseConfig(task, state);
  if (!evidencePhase.experiment) {
    // Tasks without a deterministic model record real observations instead —
    // the system never fakes a simulation it does not have.
    throw new InquiryTransitionError(
      'NO_EXPERIMENT_CONFIG',
      'this task has no simulation model; record real observations instead',
    );
  }
  const collected = state.collected.evidence;
  if (collected.experiments.some((experiment) => experiment.id === input.trialId)) {
    // Idempotent: a retried request returns the state unchanged.
    return { state, events: [] };
  }
  const material = task.materials.find((candidate) => candidate.id === input.materialId);
  if (!material) {
    throw new InquiryTransitionError('UNKNOWN_MATERIAL', `unknown material ${input.materialId}`);
  }
  const liquid = task.liquids.find((candidate) => candidate.id === input.liquidId);
  if (!liquid) {
    throw new InquiryTransitionError('UNKNOWN_LIQUID', `unknown liquid ${input.liquidId}`);
  }
  if (
    !evidencePhase.experiment.materialIds.includes(material.id) ||
    !evidencePhase.experiment.liquidIds.includes(liquid.id)
  ) {
    throw new InquiryTransitionError(
      'UNSUPPORTED_MATERIAL',
      'this material or liquid is not part of the task\'s simulation model',
    );
  }

  let prediction;
  try {
    prediction = predictForMaterial(material, liquid);
  } catch (error) {
    if (error instanceof UnsupportedExperimentModelError) {
      throw new InquiryTransitionError('UNSUPPORTED_MATERIAL', error.message);
    }
    throw error;
  }

  let observed = prediction.outcome;
  if (input.source === 'real') {
    if (!input.observed) {
      throw new InquiryTransitionError(
        'OBSERVED_RESULT_REQUIRED',
        'a real-world trial needs the observed outcome',
      );
    }
    observed = input.observed;
  }
  if (input.studentPrediction !== undefined && !OUTCOMES.includes(input.studentPrediction)) {
    throw new InquiryTransitionError(
      'INVALID_EXPERIMENT_PAYLOAD',
      `unknown predicted outcome ${String(input.studentPrediction)}`,
    );
  }
  const note = input.note?.trim();
  if (note && note.length > NOTE_LIMIT) {
    throw new InquiryTransitionError(
      'INVALID_EXPERIMENT_PAYLOAD',
      `the observation note exceeds ${NOTE_LIMIT} characters`,
    );
  }

  const design = phaseDesignContext(state);

  return build(state, [
    {
      type: 'experiment.recorded',
      phaseId: 'evidence',
      experiment: {
        id: input.trialId,
        trialNo: collected.experiments.length + 1,
        materialId: material.id,
        liquidId: liquid.id,
        source: input.source,
        ...(input.studentPrediction === undefined
          ? {}
          : { studentPrediction: input.studentPrediction }),
        result: {
          predicted: prediction.outcome,
          observed,
          explanation: prediction.explanation,
        },
        ...(note ? { note } : {}),
        ...(input.recordedAt ? { recordedAt: input.recordedAt } : {}),
        phaseRevision: progress.revision,
        ...(design.designSnapshot ? { designSnapshot: design.designSnapshot } : {}),
        derivedFrom: design.derivedFrom,
        superseded: false,
      },
    },
  ]);
}

/**
 * The design phase's effective submission, snapshotted into each evidence
 * record. Shared by simulated experiments and real observations so both point
 * back at the same design.
 */
function phaseDesignContext(state: InquirySessionState): {
  designSnapshot?: ExperimentDesignSnapshot;
  derivedFrom: DerivedFrom;
} {
  const designSubmission = effectiveSubmission(state.collected['experiment-design']);
  const designProgress = state.phases[PHASE_IDS.indexOf('experiment-design')]!;
  const content = designSubmission?.content;
  const designSnapshot =
    content &&
    (content.changedCondition?.trim() ||
      content.keptConditions?.trim() ||
      content.observedTarget?.trim())
      ? {
          ...(content.changedCondition?.trim()
            ? { changedCondition: content.changedCondition.trim() }
            : {}),
          ...(content.keptConditions?.trim()
            ? { keptConditions: content.keptConditions.trim() }
            : {}),
          ...(content.observedTarget?.trim()
            ? { observedTarget: content.observedTarget.trim() }
            : {}),
        }
      : undefined;
  const derivedFrom: DerivedFrom = designSubmission
    ? {
        phaseId: 'experiment-design',
        phaseRevision: designSubmission.phaseRevision,
        submissionId: designSubmission.id,
      }
    : {
        phaseId: 'experiment-design',
        phaseRevision: designProgress.revision,
        submissionId: null,
      };
  return {
    ...(designSnapshot ? { designSnapshot } : {}),
    derivedFrom,
  };
}

/**
 * Record one real-world observation. Used by tasks without a simulation
 * model: the student writes down what they guessed and what they actually
 * saw. The system never computes or fabricates the observation.
 */
export function recordObservation(
  task: InquiryTask,
  state: InquirySessionState,
  input: RecordObservationInput,
): InquiryTransition {
  ensureActive(state);
  const progress = currentPhaseProgress(state);
  if (progress.phaseId !== 'evidence' || progress.status !== 'active') {
    throw new InquiryTransitionError(
      'INVALID_EXPERIMENT_PHASE',
      `observations are recorded in the active evidence phase, not ${progress.phaseId}`,
    );
  }
  const phase = currentPhaseConfig(task, state);
  if (phase.experiment) {
    throw new InquiryTransitionError(
      'INVALID_OBSERVATION_PAYLOAD',
      'this task has a simulation model; record an experiment instead',
    );
  }
  const collected = state.collected.evidence;
  if (collected.observations.some((observation) => observation.id === input.observationId)) {
    // Idempotent: a retried request returns the state unchanged.
    return { state, events: [] };
  }
  const guess = input.guess?.trim();
  const observation = input.observation?.trim();
  if (!guess) {
    throw new InquiryTransitionError('INVALID_OBSERVATION_PAYLOAD', 'a guess is required before observing');
  }
  if (guess.length > GUESS_LIMIT) {
    throw new InquiryTransitionError(
      'INVALID_OBSERVATION_PAYLOAD',
      `the guess exceeds ${GUESS_LIMIT} characters`,
    );
  }
  if (!observation) {
    throw new InquiryTransitionError(
      'INVALID_OBSERVATION_PAYLOAD',
      'an observation record needs what the student saw',
    );
  }
  if (observation.length > OBSERVATION_LIMIT) {
    throw new InquiryTransitionError(
      'INVALID_OBSERVATION_PAYLOAD',
      `the observation exceeds ${OBSERVATION_LIMIT} characters`,
    );
  }
  const note = input.note?.trim();
  if (note && note.length > NOTE_LIMIT) {
    throw new InquiryTransitionError(
      'INVALID_OBSERVATION_PAYLOAD',
      `the observation note exceeds ${NOTE_LIMIT} characters`,
    );
  }

  const design = phaseDesignContext(state);
  return build(state, [
    {
      type: 'observation.recorded',
      phaseId: 'evidence',
      observation: {
        id: input.observationId,
        trialNo: collected.observations.length + 1,
        guess,
        observation,
        ...(note ? { note } : {}),
        ...(input.recordedAt ? { recordedAt: input.recordedAt } : {}),
        phaseRevision: progress.revision,
        ...(design.designSnapshot ? { designSnapshot: design.designSnapshot } : {}),
        derivedFrom: design.derivedFrom,
        superseded: false,
      },
    },
  ]);
}

/**
 * Complete the current phase. Only hard checks block; soft-check results have
 * already been recorded as feedback by `submitSubmission`.
 */
export function completePhase(
  task: InquiryTask,
  state: InquirySessionState,
): InquiryTransition {
  ensurePhaseActive(state);
  const progress = currentPhaseProgress(state);
  const phase = currentPhaseConfig(task, state);
  const collected = state.collected[progress.phaseId];
  if (!submissionReadyForCompletion(progress, collected)) {
    throw new InquiryTransitionError(
      'SUBMISSION_NOT_CONFIRMED',
      `phase ${progress.phaseId} was re-entered; confirm the earlier submission or submit again`,
    );
  }
  const gateContext = buildGateContext(task, phase, collected);
  const hard = runHardChecks(gateContext);
  const failing = hard.filter((result) => !result.passed);
  if (failing.length) {
    throw new InquiryTransitionError(
      'HARD_CHECKS_FAILED',
      `hard checks failed: ${failing.map((result) => result.id).join(', ')}`,
      failing,
    );
  }

  // Soft checks normally run on submission. A phase can be completed without
  // one (evidence is gated by experiment records), so completion records them
  // when this revision has no soft-check history yet.
  const hasRevisionSoftChecks = collected.evaluations.some(
    (evaluation) =>
      evaluation.kind === 'soft-check' &&
      evaluation.phaseRevision === progress.revision &&
      !evaluation.superseded,
  );
  const softEvaluationEvents: InquiryEvent[] = hasRevisionSoftChecks
    ? []
    : runSoftChecks(gateContext).map((result): InquiryEvent => ({
        type: 'evaluation.recorded',
        phaseId: progress.phaseId,
        evaluation: {
          id: `complete:${progress.phaseId}:r${progress.revision}:${result.id}`,
          phaseId: progress.phaseId,
          phaseRevision: progress.revision,
          kind: 'soft-check',
          verdict: { checkId: result.id, passed: result.passed, detail: result.detail },
          submissionId: null,
          superseded: false,
        },
      }));

  const events: InquiryEvent[] = [
    ...softEvaluationEvents,
    {
      type: 'phase.completed',
      phaseId: progress.phaseId,
      phaseRevision: progress.revision,
      hardCheckIds: hard.map((result) => result.id),
    },
  ];

  const nextIndex = state.position.phaseIndex + 1;
  if (nextIndex < state.phases.length) {
    events.push({
      type: 'phase.entered',
      phaseIndex: nextIndex,
      phaseId: state.phases[nextIndex]!.phaseId,
    });
    return build(state, events);
  }

  // Last phase: no other phase may still be invalidated or pending.
  const incomplete = state.phases.filter(
    (candidate) => candidate.phaseId !== progress.phaseId && candidate.status !== 'completed',
  );
  if (incomplete.length) {
    throw new InquiryTransitionError(
      'PHASES_NOT_COMPLETE',
      `cannot complete the session while phases remain ${incomplete
        .map((candidate) => `${candidate.phaseId}:${candidate.status}`)
        .join(', ')}`,
    );
  }
  events.push({ type: 'session.completed' });
  return build(state, events);
}

export interface RevertInput {
  targetPhaseIndex: number;
  reason?: string;
}

/**
 * Return to an earlier completed phase.
 *
 * History is kept: earlier submissions stay in the record. Everything derived
 * downstream — later phases, their experiments and their evaluations — is
 * marked invalidated/superseded so reports never mix a corrected hypothesis
 * with evidence collected under the old one (plan §3.3.4).
 */
export function revertPhase(
  task: InquiryTask,
  state: InquirySessionState,
  input: RevertInput,
): InquiryTransition {
  ensureActive(state);
  const { targetPhaseIndex } = input;
  const targetProgress = state.phases[targetPhaseIndex];
  if (
    !Number.isInteger(targetPhaseIndex) ||
    targetPhaseIndex < 0 ||
    targetPhaseIndex >= state.position.phaseIndex ||
    !targetProgress
  ) {
    throw new InquiryTransitionError(
      'REVERT_TARGET_NOT_COMPLETED',
      `phase index ${targetPhaseIndex} is not an earlier phase of the current one`,
    );
  }
  if (targetProgress.status !== 'completed') {
    throw new InquiryTransitionError(
      'REVERT_TARGET_NOT_COMPLETED',
      `phase ${targetProgress.phaseId} is ${targetProgress.status}, not completed`,
    );
  }

  const invalidatedPhaseIds = state.phases
    .slice(targetPhaseIndex + 1)
    .filter((candidate) => candidate.status === 'completed' || candidate.status === 'active')
    .map((candidate) => candidate.phaseId);

  return build(state, [
    {
      type: 'phase.reverted',
      phaseId: targetProgress.phaseId,
      phaseRevision: targetProgress.revision + 1,
      ...(input.reason ? { reason: input.reason } : {}),
    },
    {
      type: 'phase.reactivated',
      phaseId: targetProgress.phaseId,
      phaseRevision: targetProgress.revision + 1,
    },
    {
      type: 'artifacts.invalidated',
      phaseIds: invalidatedPhaseIds,
      causedBy: targetProgress.phaseId,
    },
  ]);
}

export function failSession(state: InquirySessionState, reason: string): InquiryTransition {
  ensureActive(state);
  return build(state, [{ type: 'session.failed', reason }]);
}

/**
 * Which actions the UI may offer. `chat` is always available — the tutor
 * answers cross-phase questions without moving the state machine. `next` only
 * appears when the hard checks pass; soft checks never remove it.
 */
export function allowedStudentActions(
  task: InquiryTask,
  state: InquirySessionState,
): StudentAction[] {
  if (state.status === 'created' || state.status === 'completed' || state.status === 'failed') {
    return [];
  }
  const progress = currentPhaseProgress(state);
  const actions: StudentAction[] = ['chat'];
  if (progress.status !== 'active') return actions;

  const phase = findPhaseConfig(task, progress.phaseId);
  const collected = state.collected[phase.id];
  actions.push('submit', 'requestHint');
  if (phase.id === 'evidence') {
    actions.push(phase.experiment ? 'recordExperiment' : 'recordObservation');
  }
  if (collected.submissions.length > 0) actions.push('confirmSubmission');
  if (state.position.phaseIndex > 0) actions.push('revert');
  const hard = runHardChecks(buildGateContext(task, phase, collected));
  if (hard.every((result) => result.passed) && submissionReadyForCompletion(progress, collected)) {
    actions.push('next');
  }
  return actions;
}
