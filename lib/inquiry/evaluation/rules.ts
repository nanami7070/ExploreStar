/**
 * Deterministic rule evaluation (plan §三).
 *
 * Rules decide what the student's current-revision records can structurally
 * support: whether a dimension has evidence at all, and a ceiling (`cap`) the
 * semantic level may not exceed. They never score by counting alone, never
 * reward a correct guess, and never treat expression length as ability.
 */
import {
  effectiveSubmission,
  predictionMismatch,
  type ExperimentRecord,
  type InquirySessionState,
  type InquiryTask,
  type ObservationRecord,
  type PhaseId,
  type PhaseProgress,
  type SubmissionRecord,
} from '@/lib/inquiry/domain/types';

import type {
  EvidenceItem,
  EvidenceRef,
  RuleDimensionResult,
} from './types';

const QUOTE_LIMIT = 300;

const PHASE_ORDER: readonly PhaseId[] = [
  'question',
  'hypothesis',
  'experiment-design',
  'evidence',
  'analysis',
  'reflection',
];

function progressOf(state: InquirySessionState, phaseId: PhaseId): PhaseProgress {
  return state.phases[PHASE_ORDER.indexOf(phaseId)]!;
}

/**
 * The submission that is valid for the phase's current revision: either made
 * in this revision, or explicitly confirmed after a revert. Older drafts are
 * history and never feed a formal evaluation.
 */
export function currentRevisionSubmission(
  state: InquirySessionState,
  phaseId: PhaseId,
): SubmissionRecord | null {
  const progress = progressOf(state, phaseId);
  // A phase invalidated by a revert has no current evidence until it is
  // re-entered and re-submitted/confirmed; its old submission is history.
  if (progress.status !== 'completed' && progress.status !== 'active') return null;
  const collected = state.collected[phaseId];
  const effective = effectiveSubmission(collected);
  if (!effective) return null;
  if (effective.phaseRevision === progress.revision) return effective;
  if (collected.confirmedSubmissionId === effective.id) return effective;
  return null;
}

export function activeExperiments(state: InquirySessionState): ExperimentRecord[] {
  return state.collected.evidence.experiments.filter((experiment) => !experiment.superseded);
}

function materialName(task: InquiryTask, id: string): string {
  return task.materials.find((material) => material.id === id)?.name ?? id;
}

function liquidName(task: InquiryTask, id: string): string {
  return task.liquids.find((liquid) => liquid.id === id)?.name ?? id;
}

function truncate(text: string, limit = QUOTE_LIMIT): string {
  return text.length <= limit ? text : `${text.slice(0, limit)}…`;
}

export function submissionQuote(submission: SubmissionRecord): string {
  const content = submission.content;
  const parts: string[] = [];
  if (content.text?.trim()) parts.push(content.text.trim());
  if (content.reason?.trim()) parts.push(`理由：${content.reason.trim()}`);
  if (content.changedCondition?.trim()) parts.push(`改变的条件：${content.changedCondition.trim()}`);
  if (content.keptConditions?.trim()) parts.push(`保持不变：${content.keptConditions.trim()}`);
  if (content.observedTarget?.trim()) parts.push(`观察目标：${content.observedTarget.trim()}`);
  if (content.materialIds?.length) parts.push(`材料：${content.materialIds.join('、')}`);
  if (content.declaration) parts.push(`声明：${content.declaration}`);
  return truncate(parts.join('；') || '（提交了内容）');
}

export function experimentQuote(task: InquiryTask, experiment: ExperimentRecord): string {
  const prediction = experiment.studentPrediction
    ? outcomeLabel(experiment.studentPrediction)
    : '未记录';
  const note = experiment.note?.trim() ? `；备注：${truncate(experiment.note.trim(), 80)}` : '';
  return `${materialName(task, experiment.materialId)} + ${liquidName(
    task,
    experiment.liquidId,
  )}：预测 ${prediction}，实际观察 ${outcomeLabel(experiment.result.observed)}${note}`;
}

function outcomeLabel(outcome: string): string {
  if (outcome === 'float') return '浮起来';
  if (outcome === 'sink') return '沉下去';
  return '停在水中';
}

/** Real-world observations valid after a revert. */
export function activeObservations(state: InquirySessionState): ObservationRecord[] {
  return state.collected.evidence.observations.filter((observation) => !observation.superseded);
}

export function observationQuote(observation: ObservationRecord): string {
  const note = observation.note?.trim()
    ? `；备注：${truncate(observation.note.trim(), 80)}`
    : '';
  return `第 ${observation.trialNo} 次观察：猜测「${truncate(
    observation.guess,
    60,
  )}」；观察到「${truncate(observation.observation, 120)}」${note}`;
}

function isSoftPassed(
  state: InquirySessionState,
  phaseId: PhaseId,
  checkId: string,
): boolean | null {
  const progress = progressOf(state, phaseId);
  const evaluation = state.collected[phaseId].evaluations.find(
    (candidate) =>
      candidate.kind === 'soft-check' &&
      candidate.phaseRevision === progress.revision &&
      !candidate.superseded &&
      candidate.verdict.checkId === checkId,
  );
  return evaluation ? evaluation.verdict.passed : null;
}

function softDetail(
  state: InquirySessionState,
  phaseId: PhaseId,
  checkId: string,
): string | null {
  const progress = progressOf(state, phaseId);
  const evaluation = state.collected[phaseId].evaluations.find(
    (candidate) =>
      candidate.kind === 'soft-check' &&
      candidate.phaseRevision === progress.revision &&
      !candidate.superseded &&
      candidate.verdict.checkId === checkId,
  );
  return evaluation && !evaluation.verdict.passed ? evaluation.verdict.detail : null;
}

function hasRevisionActivity(state: InquirySessionState, phaseId: PhaseId): boolean {
  const progress = progressOf(state, phaseId);
  return progress.revision > 0 || state.collected[phaseId].submissions.length > 1;
}

/**
 * All evidence the student has produced, split into what is valid now and
 * what a revert superseded. Only `active` may feed an evaluation.
 */
export function collectEvidence(
  task: InquiryTask,
  state: InquirySessionState,
): { active: EvidenceItem[]; superseded: EvidenceItem[] } {
  const active: EvidenceItem[] = [];
  const superseded: EvidenceItem[] = [];
  const activeSubmissionIds = new Set<string>();
  const activeExperimentIds = new Set<string>();
  const activeObservationIds = new Set<string>();

  for (const phaseId of PHASE_ORDER) {
    const submission = currentRevisionSubmission(state, phaseId);
    if (submission) {
      activeSubmissionIds.add(submission.id);
      active.push({
        id: submission.id,
        kind: 'submission',
        phaseId,
        quote: submissionQuote(submission),
        active: true,
      });
    }
  }

  for (const experiment of state.collected.evidence.experiments) {
    const item: EvidenceItem = {
      id: experiment.id,
      kind: 'experiment',
      phaseId: 'evidence',
      quote: experimentQuote(task, experiment),
      active: !experiment.superseded,
    };
    if (item.active) {
      activeExperimentIds.add(item.id);
      active.push(item);
    } else {
      superseded.push(item);
    }
  }

  for (const observation of state.collected.evidence.observations) {
    const item: EvidenceItem = {
      id: observation.id,
      kind: 'observation',
      phaseId: 'evidence',
      quote: observationQuote(observation),
      active: !observation.superseded,
    };
    if (item.active) {
      activeObservationIds.add(item.id);
      active.push(item);
    } else {
      superseded.push(item);
    }
  }

  for (const phaseId of PHASE_ORDER) {
    for (const submission of state.collected[phaseId].submissions) {
      if (activeSubmissionIds.has(submission.id)) continue;
      superseded.push({
        id: submission.id,
        kind: 'submission',
        phaseId,
        quote: submissionQuote(submission),
        active: false,
      });
    }
  }

  for (const experiment of state.collected.evidence.experiments) {
    if (activeExperimentIds.has(experiment.id)) continue;
    if (!superseded.some((item) => item.id === experiment.id)) {
      superseded.push({
        id: experiment.id,
        kind: 'experiment',
        phaseId: 'evidence',
        quote: experimentQuote(task, experiment),
        active: false,
      });
    }
  }

  // Observation tasks have no experiments; superseded observations were
  // already pushed above, so nothing further is needed here.

  return { active, superseded };
}

/** Short labels used by the report and the semantic prompt. */
export function phaseRevisionSummary(state: InquirySessionState): Record<PhaseId, number> {
  return Object.fromEntries(
    PHASE_ORDER.map((phaseId) => [phaseId, progressOf(state, phaseId).revision]),
  ) as Record<PhaseId, number>;
}

export function evaluateRules(
  task: InquiryTask,
  state: InquirySessionState,
): RuleDimensionResult[] {
  const revisions = phaseRevisionSummary(state);
  const experiments = activeExperiments(state);
  const observations = activeObservations(state);
  const mismatches = experiments.filter((experiment) => predictionMismatch(experiment) === true);
  const mismatchRetried = mismatches.some((mismatch) =>
    experiments.some(
      (candidate) =>
        candidate.id !== mismatch.id &&
        candidate.materialId === mismatch.materialId &&
        candidate.liquidId === mismatch.liquidId &&
        candidate.trialNo > mismatch.trialNo,
    ),
  );

  return [
    evaluateQuestion(state),
    evaluateHypothesis(state),
    evaluateDesign(state),
    evaluateEvidence(task, experiments, observations, mismatches, mismatchRetried),
    evaluateAnalysis(task, state, experiments, observations, revisions),
    evaluateReflection(task, state, experiments, observations, revisions, mismatchRetried),
  ];
}

function refOf(submission: SubmissionRecord, phaseId: PhaseId): EvidenceRef {
  return {
    id: submission.id,
    kind: 'submission',
    phaseId,
    quote: submissionQuote(submission),
  };
}

function evaluateQuestion(state: InquirySessionState): RuleDimensionResult {
  const submission = currentRevisionSubmission(state, 'question');
  const text = submission?.content.text?.trim();
  if (!submission || !text) {
    return {
      dimension: 'question',
      sufficient: false,
      cap: null,
      findings: ['还没有属于当前版本的有效问题记录。'],
      suggestions: ['先写下一个你想研究的问题。'],
      evidenceRefs: [],
    };
  }

  const formPassed = isSoftPassed(state, 'question', 'question.form');
  const relevancePassed = isSoftPassed(state, 'question', 'question.relevance');
  let cap: 1 | 2 | 3 | 4 = 2;
  const findings = [`问题原文：“${truncate(text, 160)}”`];
  const suggestions: string[] = [];
  if (formPassed === true) {
    findings.push('问题形式适合动手探究。');
    cap = 3;
  } else if (formPassed === false) {
    suggestions.push(softDetail(state, 'question', 'question.form') ?? '试着把“是不是”的问题改成“为什么/怎样”。');
  }
  if (relevancePassed === false) {
    suggestions.push(softDetail(state, 'question', 'question.relevance') ?? '问题可以和沉浮主题更贴近一点。');
  }
  if (hasRevisionActivity(state, 'question')) {
    findings.push('学生对问题做过修改，体现了主动改进。');
    cap = 4;
  }
  const refs: EvidenceRef[] = [refOf(submission, 'question')];
  return { dimension: 'question', sufficient: true, cap, findings, suggestions, evidenceRefs: refs };
}

function evaluateHypothesis(state: InquirySessionState): RuleDimensionResult {
  const submission = currentRevisionSubmission(state, 'hypothesis');
  if (!submission || !submission.content.text?.trim()) {
    return {
      dimension: 'hypothesis',
      sufficient: false,
      cap: null,
      findings: ['还没有属于当前版本的有效假设记录。'],
      suggestions: ['先写下你的猜想，再补充一个理由。'],
      evidenceRefs: [],
    };
  }

  let cap: 1 | 2 | 3 | 4 = 2;
  const findings = [`假设原文：“${truncate(submission.content.text.trim(), 160)}”`];
  const suggestions: string[] = [];
  if (submission.content.reason?.trim()) {
    findings.push(`给出了理由：“${truncate(submission.content.reason.trim(), 100)}”`);
    cap = 3;
  } else {
    suggestions.push('可以用“因为……”补充一下你的理由。');
  }
  if (revisionsOf(state, 'hypothesis') > 0) {
    findings.push('在探究过程中修改过假设，体现了根据新想法调整。');
    cap = 4;
  }
  return {
    dimension: 'hypothesis',
    sufficient: true,
    cap,
    findings,
    suggestions,
    evidenceRefs: [refOf(submission, 'hypothesis')],
  };
}

function revisionsOf(state: InquirySessionState, phaseId: PhaseId): number {
  return progressOf(state, phaseId).revision;
}

function evaluateDesign(state: InquirySessionState): RuleDimensionResult {
  const submission = currentRevisionSubmission(state, 'experiment-design');
  if (!submission) {
    return {
      dimension: 'design',
      sufficient: false,
      cap: null,
      findings: ['还没有属于当前版本的有效实验设计。'],
      suggestions: ['选择材料，写下要改变和保持不变的条件。'],
      evidenceRefs: [],
    };
  }

  const content = submission.content;
  const complete = Boolean(
    content.materialIds?.length &&
      content.changedCondition?.trim() &&
      content.keptConditions?.trim() &&
      content.observedTarget?.trim() &&
      content.safetyConfirmed,
  );
  let cap: 1 | 2 | 3 | 4 = complete ? 3 : 2;
  const findings = [
    `实验设计：“${truncate(
      [
        content.materialIds?.length ? `材料 ${content.materialIds.join('、')}` : '',
        content.changedCondition?.trim() ? `改变 ${content.changedCondition.trim()}` : '',
        content.keptConditions?.trim() ? `保持 ${content.keptConditions.trim()}` : '',
        content.observedTarget?.trim() ? `观察 ${content.observedTarget.trim()}` : '',
      ]
        .filter(Boolean)
        .join('；') || '（内容较少）',
      200,
    )}”`,
  ];
  const suggestions: string[] = [];
  if (!content.keptConditions?.trim()) suggestions.push('想一想：哪些条件要保持一样，比较才公平？');
  if (!content.observedTarget?.trim()) suggestions.push('补充一下你要观察什么。');
  if (!content.safetyConfirmed) suggestions.push('别忘了阅读并确认实验安全提示。');
  if (revisionsOf(state, 'experiment-design') > 0) {
    findings.push('修改过实验设计，体现了对公平比较的再思考。');
    cap = 4;
  }
  return {
    dimension: 'design',
    sufficient: true,
    cap,
    findings,
    suggestions,
    evidenceRefs: [refOf(submission, 'experiment-design')],
  };
}

function evaluateEvidence(
  task: InquiryTask,
  experiments: ExperimentRecord[],
  observations: ObservationRecord[],
  mismatches: ExperimentRecord[],
  mismatchRetried: boolean,
): RuleDimensionResult {
  if (!experiments.length) {
    if (observations.length) {
      return evaluateObservationEvidence(observations);
    }
    return {
      dimension: 'evidence',
      sufficient: false,
      cap: null,
      findings: ['还没有当前有效的实验或观察记录。'],
      suggestions: ['先完成至少一次实验或观察，并记录预测和结果。'],
      evidenceRefs: [],
    };
  }

  const withPrediction = experiments.filter((experiment) => experiment.studentPrediction);
  const materials = new Set(experiments.map((experiment) => experiment.materialId));
  const liquids = new Set(experiments.map((experiment) => experiment.liquidId));
  let cap: 1 | 2 | 3 | 4 = 2;
  const findings: string[] = [`已完成 ${experiments.length} 次有效实验记录。`];
  const suggestions: string[] = [];

  if (withPrediction.length === experiments.length) {
    findings.push('每次实验都先记录了预测。');
    if (materials.size >= 2 || liquids.size >= 2) {
      findings.push(`比较了 ${materials.size} 种材料、${liquids.size} 种液体。`);
      cap = 3;
    } else {
      suggestions.push('可以再比较一种材料或换一种液体，让证据更充分。');
      cap = 2;
    }
  } else {
    suggestions.push('每次实验前先记下你的预测，再做实验。');
  }
  if (mismatches.length) {
    findings.push(`记录了 ${mismatches.length} 次预测与观察不一致的情况。`);
    suggestions.push('对不一致的情况可以再试一次，看看是不是每次都一样。');
  }
  if (mismatchRetried) {
    findings.push('针对不一致的结果主动重复了实验。');
    cap = 4;
  }

  return {
    dimension: 'evidence',
    sufficient: true,
    cap,
    findings,
    suggestions,
    evidenceRefs: experiments.slice(-8).map((experiment) => ({
      id: experiment.id,
      kind: 'experiment' as const,
      phaseId: 'evidence' as const,
      quote: experimentQuote(task, experiment),
    })),
  };
}

/**
 * Rule ceiling for real-observation tasks. Observations always carry a guess,
 * so a correct guess is never rewarded; the ceiling rises with comparison
 * (more than one observation) and repeated verification.
 */
function evaluateObservationEvidence(
  observations: ObservationRecord[],
): RuleDimensionResult {
  const findings = [`已完成 ${observations.length} 次真实观察记录。`];
  const suggestions: string[] = [];
  let cap: 1 | 2 | 3 | 4 = 2;
  if (observations.length >= 2) {
    findings.push('对不同情况做了多次观察，能进行比较。');
    cap = 3;
  } else {
    suggestions.push('可以在不同条件或不同时间再观察一次，让证据更充分。');
  }
  const withNote = observations.filter((observation) => observation.note?.trim());
  if (observations.length >= 3 || (cap === 3 && withNote.length >= 2)) {
    findings.push('多次观察并记录了细节，证据比较完整。');
    cap = 4;
  }
  return {
    dimension: 'evidence',
    sufficient: true,
    cap,
    findings,
    suggestions,
    evidenceRefs: observations.slice(-8).map((observation) => ({
      id: observation.id,
      kind: 'observation' as const,
      phaseId: 'evidence' as const,
      quote: observationQuote(observation),
    })),
  };
}

function evaluateAnalysis(
  task: InquiryTask,
  state: InquirySessionState,
  experiments: ExperimentRecord[],
  observations: ObservationRecord[],
  revisions: Record<PhaseId, number>,
): RuleDimensionResult {
  const submission = currentRevisionSubmission(state, 'analysis');
  const text = submission?.content.text?.trim();
  if (!submission || !text) {
    return {
      dimension: 'analysis',
      sufficient: false,
      cap: null,
      findings: ['还没有属于当前版本的有效结论。'],
      suggestions: ['看看记录表，写下你发现什么，并说明是哪次实验支持它。'],
      evidenceRefs: [],
    };
  }

  const linkPassed = isSoftPassed(state, 'analysis', 'analysis.evidence-link');
  let cap: 1 | 2 | 3 | 4 = 2;
  const findings = [`结论原文：“${truncate(text, 180)}”`];
  const suggestions: string[] = [];
  if (linkPassed === true) {
    findings.push('结论引用了具体的实验现象或数据。');
    cap = 3;
  } else if (linkPassed === false) {
    suggestions.push(
      softDetail(state, 'analysis', 'analysis.evidence-link') ??
        '试着引用第几次实验的结果来支持你的结论。',
    );
  }
  if (revisions.analysis > 0) {
    findings.push('在探究中修改过结论。');
    cap = 4;
  }
  const refs: EvidenceRef[] = [refOf(submission, 'analysis')];
  for (const experiment of experiments.slice(0, 5)) {
    refs.push({
      id: experiment.id,
      kind: 'experiment',
      phaseId: 'evidence',
      quote: experimentQuote(task, experiment),
    });
  }
  for (const observation of observations.slice(0, 5)) {
    refs.push({
      id: observation.id,
      kind: 'observation',
      phaseId: 'evidence',
      quote: observationQuote(observation),
    });
  }
  return { dimension: 'analysis', sufficient: true, cap, findings, suggestions, evidenceRefs: refs };
}

function evaluateReflection(
  task: InquiryTask,
  state: InquirySessionState,
  experiments: ExperimentRecord[],
  observations: ObservationRecord[],
  revisions: Record<PhaseId, number>,
  mismatchRetried: boolean,
): RuleDimensionResult {
  const submission = currentRevisionSubmission(state, 'reflection');
  const text = submission?.content.text?.trim();
  if (!submission || !text) {
    return {
      dimension: 'reflection',
      sufficient: false,
      cap: null,
      findings: ['还没有属于当前版本的有效反思。'],
      suggestions: ['回顾这次探究，说说可以改进的地方。'],
      evidenceRefs: [],
    };
  }

  const depthPassed = isSoftPassed(state, 'reflection', 'reflection.depth');
  let cap: 1 | 2 | 3 | 4 = 2;
  const findings = [`反思原文：“${truncate(text, 180)}”`];
  const suggestions: string[] = [];
  if (depthPassed === true) {
    findings.push('反思提到了可以改进的地方。');
    cap = 3;
  } else {
    suggestions.push(
      softDetail(state, 'reflection', 'reflection.depth') ??
        '可以想一想：这次实验还有哪些不够的地方？',
    );
  }
  const revised =
    revisions.hypothesis > 0 ||
    revisions['experiment-design'] > 0 ||
    revisions.analysis > 0 ||
    revisions.reflection > 0 ||
    mismatchRetried;
  if (revised) {
    findings.push('探究中出现了根据证据调整假设、设计或结论的修正行为。');
    cap = 4;
  }
  const refs: EvidenceRef[] = [refOf(submission, 'reflection')];
  for (const experiment of experiments.filter(
    (candidate) => predictionMismatch(candidate) === true,
  )) {
    refs.push({
      id: experiment.id,
      kind: 'experiment',
      phaseId: 'evidence',
      quote: experimentQuote(task, experiment),
    });
  }
  for (const observation of observations.slice(-3)) {
    refs.push({
      id: observation.id,
      kind: 'observation',
      phaseId: 'evidence',
      quote: observationQuote(observation),
    });
  }
  return { dimension: 'reflection', sufficient: true, cap, findings, suggestions, evidenceRefs: refs };
}
