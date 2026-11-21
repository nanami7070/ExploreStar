/**
 * Learning-report document (plan §六).
 *
 * The document is built from the folded state and the evaluation bundle only.
 * Active records and history invalidated by a revert are kept in separate
 * sections, AI evaluation is labelled as such, and every dimension carries
 * evidence references into the real records.
 */
import {
  predictionMismatch,
  type ExperimentRecord,
  type InquirySessionState,
  type ObservationRecord,
  type InquiryTask,
  type PhaseId,
  type SubmissionRecord,
} from '@/lib/inquiry/domain/types';

import {
  activeExperiments,
  activeObservations,
  currentRevisionSubmission,
  experimentQuote,
  observationQuote,
  submissionQuote,
} from './rules';
import type { DimensionEvaluation, EvaluationBundle } from './types';

export const REPORT_DOCUMENT_VERSION = 1;
export const REPORT_EVALUATION_VERSION = 'p4-v1';

export type ReportReviewStatus = 'pending' | 'approved' | 'needs_revision';

export interface ReportReview {
  status: ReportReviewStatus;
  reviewer?: string;
  reviewedAt?: string;
  comment?: string;
}

export interface ReportTimelineItem {
  phaseId: PhaseId;
  kind: 'submission' | 'experiment' | 'observation' | 'hint' | 'safety';
  summary: string;
  active: boolean;
  at?: string;
}

export interface ReportExperiment {
  id: string;
  trialNo: number;
  material: string;
  liquid: string;
  prediction?: string;
  predicted?: string;
  observed: string;
  note?: string;
  recordedAt?: string;
  mismatch: boolean | null;
  active: boolean;
}

/** A real-world observation record (tasks without a simulation model). */
export interface ReportObservation {
  id: string;
  trialNo: number;
  guess: string;
  observation: string;
  note?: string;
  recordedAt?: string;
  active: boolean;
}

export interface ReportHypothesis {
  id: string;
  phaseRevision: number;
  text: string;
  reason?: string;
  active: boolean;
  seq: number;
}

export interface InquiryReportDocument {
  documentVersion: typeof REPORT_DOCUMENT_VERSION;
  evaluationVersion: string;
  generatedAt: string;
  studyRevision: number;
  task: { id: string; key: string; name: string; grade: string; version: string };
  learnerKey: string;
  status: 'ai_generated' | 'teacher_reviewed' | 'needs_revision';
  review: ReportReview;
  timeline: ReportTimelineItem[];
  question: { original?: string; current?: string };
  hypotheses: { submissions: ReportHypothesis[]; currentId: string | null };
  design: {
    active?: { materials: string[]; changedCondition?: string; keptConditions?: string; observedTarget?: string };
    history: { id: string; phaseRevision: number; active: boolean; summary: string }[];
  };
  experiments: { active: ReportExperiment[]; superseded: ReportExperiment[] };
  /** Present for observation tasks; absent in reports written before P5. */
  observations?: { active: ReportObservation[]; superseded: ReportObservation[] };
  findings: string[];
  dimensions: DimensionEvaluation[];
  scaffolding: {
    hints: {
      phaseId: PhaseId;
      level: number;
      type: string | null;
      reason: string;
      explicit: boolean;
      providedExplanation: boolean;
      seq: number;
    }[];
    safetyFlags: { kind: 'unsafe' | 'injection'; phaseId: PhaseId; seq: number }[];
  };
  revisions: {
    questionRevised: boolean;
    hypothesisRevised: boolean;
    designRevised: boolean;
    evidenceRepeated: boolean;
    conclusionRevised: boolean;
    reflectionRevised: boolean;
    mismatchCount: number;
    mismatchRetried: boolean;
  };
  nextSteps: string[];
  meta: {
    activeEvidenceCount: number;
    supersededEvidenceCount: number;
    semanticStatus: EvaluationBundle['semanticStatus'];
    notes: string[];
  };
}

const PHASE_ORDER: readonly PhaseId[] = [
  'question',
  'hypothesis',
  'experiment-design',
  'evidence',
  'analysis',
  'reflection',
];

function materialName(task: InquiryTask, id: string): string {
  return task.materials.find((material) => material.id === id)?.name ?? id;
}

function liquidName(task: InquiryTask, id: string): string {
  return task.liquids.find((liquid) => liquid.id === id)?.name ?? id;
}

function outcomeLabel(outcome: string | undefined): string | undefined {
  if (outcome === 'float') return '浮起来';
  if (outcome === 'sink') return '沉下去';
  if (outcome === 'suspend') return '停在水中';
  return undefined;
}

function reportObservation(observation: ObservationRecord, active: boolean): ReportObservation {
  return {
    id: observation.id,
    trialNo: observation.trialNo,
    guess: observation.guess,
    observation: observation.observation,
    ...(observation.note ? { note: observation.note } : {}),
    ...(observation.recordedAt ? { recordedAt: observation.recordedAt } : {}),
    active,
  };
}

function reportExperiment(task: InquiryTask, experiment: ExperimentRecord, active: boolean): ReportExperiment {
  return {
    id: experiment.id,
    trialNo: experiment.trialNo,
    material: materialName(task, experiment.materialId),
    liquid: liquidName(task, experiment.liquidId),
    ...(experiment.studentPrediction
      ? { prediction: outcomeLabel(experiment.studentPrediction) }
      : {}),
    predicted: outcomeLabel(experiment.result.predicted),
    observed: outcomeLabel(experiment.result.observed) ?? experiment.result.observed,
    ...(experiment.note ? { note: experiment.note } : {}),
    ...(experiment.recordedAt ? { recordedAt: experiment.recordedAt } : {}),
    mismatch: predictionMismatch(experiment),
    active,
  };
}

function submissionHistory(
  state: InquirySessionState,
  phaseId: PhaseId,
): { submission: SubmissionRecord; active: boolean }[] {
  const current = currentRevisionSubmission(state, phaseId);
  return state.collected[phaseId].submissions.map((submission) => ({
    submission,
    active: current?.id === submission.id,
  }));
}

function buildTimeline(
  task: InquiryTask,
  state: InquirySessionState,
): ReportTimelineItem[] {
  const items: ReportTimelineItem[] = [];
  for (const phaseId of PHASE_ORDER) {
    const current = currentRevisionSubmission(state, phaseId);
    for (const submission of state.collected[phaseId].submissions) {
      items.push({
        phaseId,
        kind: 'submission',
        summary: submissionQuote(submission),
        active: current?.id === submission.id,
      });
    }
    if (phaseId === 'evidence') {
      for (const experiment of state.collected.evidence.experiments) {
        items.push({
          phaseId,
          kind: 'experiment',
          summary: `第 ${experiment.trialNo} 次：${experimentQuote(task, experiment)}`,
          active: !experiment.superseded,
          ...(experiment.recordedAt ? { at: experiment.recordedAt } : {}),
        });
      }
      for (const observation of state.collected.evidence.observations) {
        items.push({
          phaseId,
          kind: 'observation',
          summary: observationQuote(observation),
          active: !observation.superseded,
          ...(observation.recordedAt ? { at: observation.recordedAt } : {}),
        });
      }
    }
    for (const hint of state.phases[PHASE_ORDER.indexOf(phaseId)]!.hint.log) {
      items.push({
        phaseId,
        kind: 'hint',
        summary: `提示 L${hint.level}（${hint.explicit ? '主动求助' : '系统判断'}）${hint.reason ? `：${hint.reason}` : ''}`,
        active: true,
      });
    }
    for (const flag of state.safetyFlags.filter((candidate) => candidate.phaseId === phaseId)) {
      items.push({
        phaseId,
        kind: 'safety',
        summary: flag.kind === 'unsafe' ? '安全规则拦截了一次请求' : '拦截了一次提示注入尝试',
        active: true,
      });
    }
  }
  return items;
}

export interface BuildReportInput {
  task: InquiryTask;
  state: InquirySessionState;
  studyRevision: number;
  learnerKey: string;
  generatedAt: string;
  bundle: EvaluationBundle;
}

export function buildInquiryReport(input: BuildReportInput): InquiryReportDocument {
  const { task, state, bundle } = input;

  const questionHistory = submissionHistory(state, 'question');
  const originalQuestion = questionHistory[0]?.submission.content.text?.trim();
  const currentQuestion = currentRevisionSubmission(state, 'question')?.content.text?.trim();

  const hypotheses: ReportHypothesis[] = submissionHistory(state, 'hypothesis').map(
    ({ submission, active }) => ({
      id: submission.id,
      phaseRevision: submission.phaseRevision,
      text: submission.content.text?.trim() ?? '',
      ...(submission.content.reason?.trim() ? { reason: submission.content.reason.trim() } : {}),
      active,
      seq: submission.seq,
    }),
  );
  const currentHypothesis = currentRevisionSubmission(state, 'hypothesis');

  const designCurrent = currentRevisionSubmission(state, 'experiment-design');
  const designHistory = submissionHistory(state, 'experiment-design').map(
    ({ submission, active }) => ({
      id: submission.id,
      phaseRevision: submission.phaseRevision,
      active,
      summary: submissionQuote(submission),
    }),
  );

  const active = activeExperiments(state);
  const supersededExperiments = state.collected.evidence.experiments.filter(
    (experiment) => experiment.superseded,
  );
  const mismatches = active.filter((experiment) => predictionMismatch(experiment) === true);
  const mismatchRetried = mismatches.some((mismatch) =>
    active.some(
      (candidate) =>
        candidate.id !== mismatch.id &&
        candidate.materialId === mismatch.materialId &&
        candidate.liquidId === mismatch.liquidId &&
        candidate.trialNo > mismatch.trialNo,
    ),
  );

  const activeObservationRecords = activeObservations(state);
  const findings = active.length
    ? active.map((experiment) => {
        const line = `第 ${experiment.trialNo} 次：${materialName(task, experiment.materialId)} + ${liquidName(
          task,
          experiment.liquidId,
        )}，观察到 ${outcomeLabel(experiment.result.observed)}`;
        return predictionMismatch(experiment) === true
          ? `${line}（你的预测是 ${outcomeLabel(experiment.studentPrediction)}，和观察不一样）`
          : line;
      })
    : activeObservationRecords.length
      ? activeObservationRecords.map((observation) => observationQuote(observation))
      : ['还没有实验或观察记录。'];

  const hints = PHASE_ORDER.flatMap((phaseId) =>
    state.phases[PHASE_ORDER.indexOf(phaseId)]!.hint.log.map((hint) => ({
      phaseId,
      level: hint.level,
      type: hint.type,
      reason: hint.reason,
      explicit: hint.explicit,
      providedExplanation: hint.providedExplanation,
      seq: hint.seq,
    })),
  );

  const revisions = {
    questionRevised:
      state.phases[0]!.revision > 0 || state.collected.question.submissions.length > 1,
    hypothesisRevised:
      state.phases[1]!.revision > 0 || state.collected.hypothesis.submissions.length > 1,
    designRevised:
      state.phases[2]!.revision > 0 ||
      state.collected['experiment-design'].submissions.length > 1,
    evidenceRepeated: active.length > 1 || mismatchRetried,
    conclusionRevised:
      state.phases[4]!.revision > 0 || state.collected.analysis.submissions.length > 1,
    reflectionRevised:
      state.phases[5]!.revision > 0 || state.collected.reflection.submissions.length > 1,
    mismatchCount: mismatches.length,
    mismatchRetried,
  };

  const suggestions = new Set<string>();
  for (const dimension of bundle.dimensions) {
    if (dimension.status === 'insufficient_evidence') {
      suggestions.add(`${dimension.title}：还需要补充可评价的记录。`);
      continue;
    }
    if ((dimension.level ?? 0) < 3) {
      for (const suggestion of dimension.suggestions.slice(0, 2)) suggestions.add(suggestion);
    }
  }
  if (revisions.mismatchCount > 0 && !revisions.mismatchRetried) {
    suggestions.add('对预测和观察不一样的地方再试一次，看看是不是每次都这样。');
  }
  if (!suggestions.size) {
    suggestions.add('可以试着一个新的探究问题，或者换一种液体比较沉浮。');
  }

  const notes: string[] = [];
  if (bundle.semanticStatus !== 'merged') {
    notes.push('本次评价只包含规则评价，语义评价不可用；等级以记录结构上限为准。');
  }
  if (bundle.supersededEvidence.length) {
    notes.push('历史失效记录仅用于展示修改过程，不参与本次正式评价。');
  }

  return {
    documentVersion: REPORT_DOCUMENT_VERSION,
    evaluationVersion: bundle.evaluationVersion,
    generatedAt: input.generatedAt,
    studyRevision: input.studyRevision,
    task: {
      id: task.id,
      key: task.key,
      name: task.name,
      grade: task.grade,
      version: task.version,
    },
    learnerKey: input.learnerKey,
    status: 'ai_generated',
    review: { status: 'pending' },
    timeline: buildTimeline(task, state),
    question: {
      ...(originalQuestion ? { original: originalQuestion } : {}),
      ...(currentQuestion ? { current: currentQuestion } : {}),
    },
    hypotheses: {
      submissions: hypotheses,
      currentId: currentHypothesis?.id ?? null,
    },
    design: {
      ...(designCurrent
        ? {
            active: {
              materials: designCurrent.content.materialIds ?? [],
              ...(designCurrent.content.changedCondition
                ? { changedCondition: designCurrent.content.changedCondition }
                : {}),
              ...(designCurrent.content.keptConditions
                ? { keptConditions: designCurrent.content.keptConditions }
                : {}),
              ...(designCurrent.content.observedTarget
                ? { observedTarget: designCurrent.content.observedTarget }
                : {}),
            },
          }
        : {}),
      history: designHistory,
    },
    experiments: {
      active: active.map((experiment) => reportExperiment(task, experiment, true)),
      superseded: supersededExperiments.map((experiment) =>
        reportExperiment(task, experiment, false),
      ),
    },
    observations: {
      active: activeObservationRecords.map((observation) => reportObservation(observation, true)),
      superseded: state.collected.evidence.observations
        .filter((observation) => observation.superseded)
        .map((observation) => reportObservation(observation, false)),
    },
    findings,
    dimensions: bundle.dimensions,
    scaffolding: {
      hints,
      safetyFlags: state.safetyFlags.map((flag) => ({
        kind: flag.kind,
        phaseId: flag.phaseId,
        seq: flag.seq,
      })),
    },
    revisions,
    nextSteps: [...suggestions].slice(0, 6),
    meta: {
      activeEvidenceCount: bundle.activeEvidence.length,
      supersededEvidenceCount: bundle.supersededEvidence.length,
      semanticStatus: bundle.semanticStatus,
      notes,
    },
  };
}
