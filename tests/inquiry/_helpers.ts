/**
 * Shared fixtures for the inquiry engine tests. Not a test file itself
 * (vitest only picks up `*.test.ts`).
 */
import type { InquiryEvent } from '@/lib/inquiry/domain/events';
import { replayInquiryEvents, createInquirySessionState } from '@/lib/inquiry/domain/state';
import {
  completePhase,
  confirmSubmission,
  recordChatMessage,
  recordExperiment,
  requestHint,
  revertPhase,
  startSession,
  submitSubmission,
  type HintInput,
  type InquiryTransition,
  type RevertInput,
} from '@/lib/inquiry/domain/transition';
import type {
  ChatMessageRole,
  FloatSinkOutcome,
  HintLevel,
  InquirySessionState,
  SubmissionContent,
} from '@/lib/inquiry/domain/types';
import { FLOAT_SINK_TASK } from '@/lib/inquiry/tasks/float-sink';

export const TASK = FLOAT_SINK_TASK;

export const QUESTION: SubmissionContent = {
  text: '为什么木块能浮在水面上，而石头会沉下去？',
};

export const YES_NO_QUESTION: SubmissionContent = {
  text: '木块会浮在水面上吗？',
};

export const HYPOTHESIS: SubmissionContent = {
  text: '我认为木头做的物体会浮起来，因为木块拿在手里比较轻。',
  reason: '木块比较轻',
};

export const DESIGN: SubmissionContent = {
  materialIds: ['wood-block', 'stone-block'],
  changedCondition: '物体的材料',
  keptConditions: '都用清水，放进去的方式一样',
  observedTarget: '物体是浮还是沉',
  safetyConfirmed: true,
};

export const ANALYSIS: SubmissionContent = {
  text: '我发现木块在清水里浮起来，石头却沉下去，因为它们的轻重不同。',
};

export const REFLECTION: SubmissionContent = {
  text: '这次实验次数有点少，下次我想多试几种材料，也想再试试盐水。',
};

export class InquiryDriver {
  state: InquirySessionState = createInquirySessionState(TASK);
  events: InquiryEvent[] = [];

  apply(transition: InquiryTransition): this {
    this.state = transition.state;
    this.events.push(...transition.events);
    return this;
  }

  submit(id: string, content: SubmissionContent): this {
    return this.apply(submitSubmission(TASK, this.state, { submissionId: id, content }));
  }

  complete(): this {
    return this.apply(completePhase(TASK, this.state));
  }

  hint(input: HintInput): this {
    return this.apply(requestHint(this.state, input));
  }

  revert(input: RevertInput): this {
    return this.apply(revertPhase(TASK, this.state, input));
  }

  confirm(submissionId?: string): this {
    return this.apply(confirmSubmission(this.state, submissionId ? { submissionId } : {}));
  }

  experiment(
    id: string,
    materialId: string,
    liquidId: string,
    source: 'sim' | 'real' = 'sim',
    observed?: FloatSinkOutcome,
  ): this {
    return this.apply(
      recordExperiment(TASK, this.state, { trialId: id, materialId, liquidId, source, observed }),
    );
  }

  /** A P3 trial: prediction before the run, optional note, fixed timestamp. */
  experimentEvidence(
    id: string,
    materialId: string,
    liquidId: string,
    options: {
      prediction: FloatSinkOutcome;
      source?: 'sim' | 'real';
      observed?: FloatSinkOutcome;
      note?: string;
      recordedAt?: string;
    },
  ): this {
    return this.apply(
      recordExperiment(TASK, this.state, {
        trialId: id,
        materialId,
        liquidId,
        source: options.source ?? 'sim',
        studentPrediction: options.prediction,
        ...(options.observed ? { observed: options.observed } : {}),
        ...(options.note ? { note: options.note } : {}),
        ...(options.recordedAt ? { recordedAt: options.recordedAt } : {}),
      }),
    );
  }

  chat(
    id: string,
    text: string,
    role: ChatMessageRole = 'student',
    hintLevel?: HintLevel,
  ): this {
    return this.apply(
      recordChatMessage(this.state, {
        messageId: id,
        role,
        text,
        ...(hintLevel === undefined ? {} : { hintLevel }),
      }),
    );
  }

  replay(): InquirySessionState {
    return replayInquiryEvents(TASK, this.events);
  }
}

export function startedSession(): InquiryDriver {
  return new InquiryDriver().apply(startSession(TASK));
}

/** question → hypothesis phase active. */
export function afterQuestion(): InquiryDriver {
  return startedSession().submit('q-1', QUESTION).complete();
}

/** question → hypothesis → experiment-design phase active. */
export function afterHypothesis(): InquiryDriver {
  return afterQuestion().submit('h-1', HYPOTHESIS).complete();
}

/** … → evidence phase active. */
export function afterDesign(): InquiryDriver {
  return afterHypothesis().submit('d-1', DESIGN).complete();
}

/** … → analysis phase active, with two simulation trials recorded. */
export function afterEvidence(): InquiryDriver {
  return afterDesign()
    .experiment('t-1', 'wood-block', 'water')
    .experiment('t-2', 'stone-block', 'water')
    .complete();
}
