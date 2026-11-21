/**
 * Session state and the event reducer.
 *
 * Transitions in ./transition.ts always build their result by folding the
 * events they emit through `foldInquiryEvents`, which makes replay an exact
 * reconstruction by construction (a P1 acceptance test asserts it).
 */
import type { InquiryEvent } from './events';
import {
  PHASE_IDS,
  type InquirySessionState,
  type InquiryTask,
  type PhaseCollected,
  type PhaseId,
  type PhaseProgress,
  type ScaffoldState,
} from './types';

export function emptyCollected(): PhaseCollected {
  return {
    submissions: [],
    confirmedSubmissionId: null,
    experiments: [],
    observations: [],
    evaluations: [],
  };
}

export function emptyScaffold(): ScaffoldState {
  return { level: 0, log: [], consecutive: { type: null, count: 0 } };
}

export function createInquirySessionState(task: InquiryTask): InquirySessionState {
  // The task declares the phase order; the task-config test locks it to the
  // canonical six. Using it here keeps one source of truth for the flow.
  const phaseIds: PhaseId[] = task.phases.length
    ? task.phases.map((phase) => phase.id)
    : [...PHASE_IDS];
  return {
    status: 'created',
    position: { phaseIndex: 0, phaseId: phaseIds[0]! },
    phases: phaseIds.map<PhaseProgress>((phaseId) => ({
      phaseId,
      status: 'pending',
      revision: 0,
      attempts: 0,
      hint: emptyScaffold(),
    })),
    collected: Object.fromEntries(phaseIds.map((phaseId) => [phaseId, emptyCollected()])) as Record<
      PhaseId,
      PhaseCollected
    >,
    conversation: [],
    safetyFlags: [],
    lastSequence: 0,
  };
}

function updatePhase(
  state: InquirySessionState,
  phaseId: PhaseId,
  update: (progress: PhaseProgress) => PhaseProgress,
): InquirySessionState {
  const index = state.phases.findIndex((phase) => phase.phaseId === phaseId);
  if (index < 0) return state;
  return {
    ...state,
    phases: state.phases.map((phase, i) => (i === index ? update(phase) : phase)),
  };
}

function updateCollected(
  state: InquirySessionState,
  phaseId: PhaseId,
  update: (collected: PhaseCollected) => PhaseCollected,
): InquirySessionState {
  return {
    ...state,
    collected: { ...state.collected, [phaseId]: update(state.collected[phaseId]) },
  };
}

/**
 * Apply one event. Pure: the returned state is a new object graph where
 * anything the event touches was copied, and untouched branches are shared.
 */
export function applyInquiryEvent(
  state: InquirySessionState,
  event: InquiryEvent,
): InquirySessionState {
  const next = applyEffect(state, event);
  return { ...next, lastSequence: state.lastSequence + 1 };
}

function applyEffect(state: InquirySessionState, event: InquiryEvent): InquirySessionState {
  switch (event.type) {
    case 'session.started':
      return { ...state, status: 'waiting_for_student' };

    case 'phase.entered': {
      const index = state.phases.findIndex((phase) => phase.phaseId === event.phaseId);
      if (index < 0) return state;
      const withRevision = updatePhase(state, event.phaseId, (progress) => ({
        ...progress,
        status: 'active',
        // A phase re-entered after a revert starts a new revision; its earlier
        // submissions remain as history but the new revision gets a fresh
        // attempt counter and hint level.
        revision: progress.status === 'invalidated' ? progress.revision + 1 : progress.revision,
        attempts: 0,
        hint: { ...progress.hint, level: 0, consecutive: { type: null, count: 0 } },
      }));
      return {
        ...withRevision,
        status: state.status === 'completed' || state.status === 'failed' ? state.status : 'waiting_for_student',
        position: { phaseIndex: event.phaseIndex, phaseId: event.phaseId },
      };
    }

    case 'submission.recorded':
      return updatePhase(
        updateCollected(state, event.phaseId, (collected) => ({
          ...collected,
          submissions: [...collected.submissions, event.submission],
          // A new submission supersedes an earlier confirmation of the same
          // phase revision.
          confirmedSubmissionId: null,
        })),
        event.phaseId,
        (progress) => ({ ...progress, attempts: progress.attempts + 1 }),
      );

    case 'submission.confirmed':
      return updateCollected(state, event.phaseId, (collected) => ({
        ...collected,
        confirmedSubmissionId: event.submissionId,
      }));

    case 'phase.completed':
      return updatePhase(state, event.phaseId, (progress) => ({
        ...progress,
        status: 'completed',
      }));

    case 'phase.reverted': {
      const index = state.phases.findIndex((phase) => phase.phaseId === event.phaseId);
      const withRevision = updatePhase(state, event.phaseId, (progress) => ({
        ...progress,
        status: 'active',
        revision: event.phaseRevision,
        attempts: 0,
        // The hint log is learning evidence and is kept; only the level and
        // difficulty streak restart.
        hint: { ...progress.hint, level: 0, consecutive: { type: null, count: 0 } },
      }));
      return {
        ...updateCollected(withRevision, event.phaseId, (collected) => ({
          ...collected,
          confirmedSubmissionId: null,
        })),
        status: 'waiting_for_student',
        position:
          index >= 0
            ? { phaseIndex: index, phaseId: event.phaseId }
            : state.position,
      };
    }

    case 'phase.reactivated':
      // `phase.reverted` already set the target active; this event records the
      // semantic step explicitly so replays read the same way.
      return state;

    case 'artifacts.invalidated': {
      let next = state;
      for (const phaseId of event.phaseIds) {
        next = updatePhase(next, phaseId, (progress) =>
          progress.status === 'completed' || progress.status === 'active'
            ? { ...progress, status: 'invalidated' }
            : progress,
        );
        next = updateCollected(next, phaseId, (collected) => ({
          ...collected,
          experiments: collected.experiments.map((experiment) =>
            experiment.superseded ? experiment : { ...experiment, superseded: true },
          ),
          observations: collected.observations.map((observation) =>
            observation.superseded ? observation : { ...observation, superseded: true },
          ),
          evaluations: collected.evaluations.map((evaluation) =>
            evaluation.superseded ? evaluation : { ...evaluation, superseded: true },
          ),
          confirmedSubmissionId: null,
        }));
      }
      return next;
    }

    case 'hint.requested':
      return updatePhase(state, event.phaseId, (progress) => ({
        ...progress,
        hint: {
          level: event.entry.level,
          log: [...progress.hint.log, event.entry],
          consecutive: event.consecutive,
        },
      }));

    case 'hint.levelChanged':
      // Informational; the level itself was applied by `hint.requested`.
      return state;

    case 'hint.classified':
      return updatePhase(state, event.phaseId, (progress) => ({
        ...progress,
        hint: { ...progress.hint, consecutive: event.consecutive },
      }));

    case 'experiment.recorded':
      return updateCollected(state, event.phaseId, (collected) => ({
        ...collected,
        experiments: [...collected.experiments, event.experiment],
      }));

    case 'observation.recorded':
      return updateCollected(state, event.phaseId, (collected) => ({
        ...collected,
        observations: [...collected.observations, event.observation],
      }));

    case 'evaluation.recorded':
      return updateCollected(state, event.phaseId, (collected) => ({
        ...collected,
        evaluations: [...collected.evaluations, event.evaluation],
      }));

    case 'chat.recorded':
      return { ...state, conversation: [...state.conversation, event.message] };

    case 'safety.flagged':
      return {
        ...state,
        safetyFlags: [
          ...state.safetyFlags,
          { kind: event.kind, phaseId: event.phaseId, seq: state.lastSequence + 1 },
        ],
      };

    case 'report.generated':
      // The report is a projection; state only needs the event for history.
      return state;

    case 'session.completed':
      return { ...state, status: 'completed' };

    case 'session.failed':
      return { ...state, status: 'failed' };

    default:
      return assertNever(event);
  }
}

export function foldInquiryEvents(
  state: InquirySessionState,
  events: readonly InquiryEvent[],
): InquirySessionState {
  return events.reduce(applyInquiryEvent, state);
}

/** Rebuild a session from its event log alone. */
export function replayInquiryEvents(
  task: InquiryTask,
  events: readonly InquiryEvent[],
): InquirySessionState {
  return foldInquiryEvents(createInquirySessionState(task), events);
}

function assertNever(value: never): never {
  throw new Error(`unhandled inquiry event: ${JSON.stringify(value)}`);
}
