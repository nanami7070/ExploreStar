/**
 * Phase gates.
 *
 * Hard checks (data completeness) block `completePhase`. Soft checks (teaching
 * reasonableness) never block: their results are recorded as feedback, fed to
 * the tutor context, and shown on the phase card as suggestions. A yes/no
 * question, an incomplete hypothesis, or a single experiment trial can all
 * continue the inquiry and be revised later (plan §3.3.1).
 *
 * Every implementation is pure and deterministic. The one heuristic that a
 * language model refines later — the question-form classification — is a
 * conservative regex here, so P1 needs no model at all.
 */
import {
  effectiveSubmission,
  submissionHasContent,
  type CheckResult,
  type ExperimentRecord,
  type InquiryTask,
  type ObservationRecord,
  type PhaseCollected,
  type PhaseConfig,
  type SubmissionRecord,
} from './types';

export interface GateContext {
  task: InquiryTask;
  phase: PhaseConfig;
  collected: PhaseCollected;
  /** Confirmed submission if any, else the latest one. */
  submission: SubmissionRecord | null;
}

type Check = (ctx: GateContext) => CheckResult;

const YES_NO_QUESTION =
  /(吗|是不是|会不会|是否|能不能|可不可以|对不对|好不好|行不行)\s*[？?。！!]*\s*$/;
const REASON_MARKERS = /(因为|由于|所以|是为了|是因为)/;
const NUMBER_MARKER = /\d/;
const LIMITATION_MARKERS = /(局限|不足|不够|改进|下次|误差|没想|再试|问题|困难)/;

function textOf(ctx: GateContext): string {
  return ctx.submission?.content.text?.trim() ?? '';
}

/** Experiments that still count after a revert (historically kept, but ignored). */
export function activeExperiments(collected: PhaseCollected): ExperimentRecord[] {
  return collected.experiments.filter((experiment) => !experiment.superseded);
}

/** Real-world observations that still count after a revert. */
export function activeObservations(collected: PhaseCollected): ObservationRecord[] {
  return collected.observations.filter((observation) => !observation.superseded);
}

function containsTopicKeyword(task: InquiryTask, text: string): boolean {
  return task.topicKeywords.some((keyword) => text.includes(keyword));
}

const HARD_CHECKS: Record<string, Check> = {
  'submission.non-empty': (ctx) => ({
    id: 'submission.non-empty',
    passed: Boolean(ctx.submission && submissionHasContent(ctx.submission.content)),
    detail: ctx.submission && submissionHasContent(ctx.submission.content)
      ? '已提交内容'
      : '还没有提交内容',
  }),

  'question.text-valid': (ctx) => {
    const text = textOf(ctx);
    if (!text) return { id: 'question.text-valid', passed: false, detail: '请先写下你的问题' };
    if (text.length > 200)
      return { id: 'question.text-valid', passed: false, detail: '问题太长了，请精简到 200 字以内' };
    return { id: 'question.text-valid', passed: true, detail: '问题已提交' };
  },

  'hypothesis.text-present': (ctx) => {
    const text = textOf(ctx);
    return {
      id: 'hypothesis.text-present',
      passed: Boolean(text),
      detail: text ? '假设已提交' : '请先写下你的猜想',
    };
  },

  'design.materials': (ctx) => {
    const ids = ctx.submission?.content.materialIds ?? [];
    const known = new Set(ctx.task.materials.map((material) => material.id));
    const unknown = ids.filter((id) => !known.has(id));
    if (!ids.length)
      return { id: 'design.materials', passed: false, detail: '请选择至少一种实验材料' };
    if (unknown.length)
      return {
        id: 'design.materials',
        passed: false,
        detail: `任务里没有这些材料：${unknown.join('、')}`,
      };
    return { id: 'design.materials', passed: true, detail: '实验材料已选择' };
  },

  'design.changed-condition': (ctx) => {
    const value = ctx.submission?.content.changedCondition?.trim();
    return {
      id: 'design.changed-condition',
      passed: Boolean(value),
      detail: value ? '已填写要改变的条件' : '请想一想：你打算改变哪一个条件？',
    };
  },

  'design.safety-confirmed': (ctx) => {
    const confirmed = ctx.submission?.content.safetyConfirmed === true;
    return {
      id: 'design.safety-confirmed',
      passed: confirmed,
      detail: confirmed ? '已确认安全提示' : '请先阅读并确认实验安全提示',
    };
  },

  'evidence.min-records': (ctx) => {
    const count = activeExperiments(ctx.collected).length;
    return {
      id: 'evidence.min-records',
      passed: count >= 1,
      detail: count >= 1 ? `已记录 ${count} 次实验结果` : '请至少完成并记录 1 次实验',
    };
  },

  // Used by tasks without a simulation model: the student records what they
  // really observed instead of running the density experiment.
  'evidence.min-observation-records': (ctx) => {
    const count = activeObservations(ctx.collected).length;
    return {
      id: 'evidence.min-observation-records',
      passed: count >= 1,
      detail: count >= 1 ? `已记录 ${count} 次观察` : '请至少完成并记录 1 次观察',
    };
  },

  'analysis.text-present': (ctx) => {
    const text = textOf(ctx);
    return {
      id: 'analysis.text-present',
      passed: Boolean(text),
      detail: text ? '结论已提交' : '请先写下你的结论',
    };
  },

  'reflection.text-present': (ctx) => {
    const text = textOf(ctx);
    return {
      id: 'reflection.text-present',
      passed: Boolean(text),
      detail: text ? '反思已提交' : '请先写下你的回顾与反思',
    };
  },
};

const SOFT_CHECKS: Record<string, Check> = {
  'question.form': (ctx) => {
    const text = textOf(ctx);
    if (!text) return { id: 'question.form', passed: false, detail: '尚未提交问题' };
    const yesNo = YES_NO_QUESTION.test(text) || /^(是否|是不是|会不会|能不能)/.test(text);
    return yesNo
      ? {
          id: 'question.form',
          passed: false,
          detail: '这个问题像“是不是”的判断题，试试问成“怎样/为什么”的探究问题',
        }
      : { id: 'question.form', passed: true, detail: '这是一个适合动手探究的问题' };
  },

  'question.relevance': (ctx) => {
    const text = textOf(ctx);
    const relevant = containsTopicKeyword(ctx.task, text);
    return relevant
      ? { id: 'question.relevance', passed: true, detail: '问题与沉浮主题相关' }
      : { id: 'question.relevance', passed: false, detail: '问题似乎与本主题关系不大，可以再想一想' };
  },

  'hypothesis.reason': (ctx) => {
    const content = ctx.submission?.content;
    const hasReason = Boolean(content?.reason?.trim()) || REASON_MARKERS.test(textOf(ctx));
    return hasReason
      ? { id: 'hypothesis.reason', passed: true, detail: '假设说出了理由' }
      : { id: 'hypothesis.reason', passed: false, detail: '可以用“因为……”补充一下你的理由' };
  },

  'hypothesis.relevance': (ctx) => {
    const text = `${textOf(ctx)} ${ctx.submission?.content.reason ?? ''}`.trim();
    const relevant = containsTopicKeyword(ctx.task, text);
    return relevant
      ? { id: 'hypothesis.relevance', passed: true, detail: '假设围绕沉浮主题' }
      : { id: 'hypothesis.relevance', passed: false, detail: '假设再贴近一点“沉下去还是浮起来”会更好' };
  },

  'design.variables': (ctx) => {
    const kept = ctx.submission?.content.keptConditions?.trim();
    const observed = ctx.submission?.content.observedTarget?.trim();
    const passed = Boolean(kept && observed);
    return {
      id: 'design.variables',
      passed,
      detail: passed
        ? '保持不变的条件和观察目标都写清楚了'
        : '再补一补：哪些条件要保持不变？你要观察什么？',
    };
  },

  'design.single-variable': (ctx) => {
    const changed = ctx.submission?.content.changedCondition?.trim();
    return {
      id: 'design.single-variable',
      passed: Boolean(changed),
      detail: changed
        ? '每次实验先只改变一个条件，会更公平'
        : '先确定唯一要改变的条件，再开始实验',
    };
  },

  'evidence.suggested-count': (ctx) => {
    const count =
      activeExperiments(ctx.collected).length + activeObservations(ctx.collected).length;
    const suggested = ctx.task.suggestedTrials;
    return {
      id: 'evidence.suggested-count',
      passed: count >= suggested,
      detail:
        count >= suggested
          ? `记录数量充足（${count} 次）`
          : `建议多试几次（当前 ${count} 次，建议至少 ${suggested} 次），不做强制要求`,
    };
  },

  'evidence.control': (ctx) => {
    // Observation tasks have no liquids to compare; the check is not
    // applicable and must not nag.
    if (!ctx.task.liquids.length) {
      return { id: 'evidence.control', passed: true, detail: '这个探究不需要比较液体' };
    }
    const liquids = new Set(activeExperiments(ctx.collected).map((experiment) => experiment.liquidId));
    const target = Math.min(2, ctx.task.liquids.length);
    return {
      id: 'evidence.control',
      passed: liquids.size >= target,
      detail:
        liquids.size >= target
          ? '比较了不同液体的情况'
          : '可以试试换一种液体（例如清水和盐水）再比较一次',
    };
  },

  'analysis.evidence-link': (ctx) => {
    const text = textOf(ctx);
    const mentionsMaterial = ctx.task.materials.some((material) => text.includes(material.name));
    const mentionsLiquid = ctx.task.liquids.some((liquid) => text.includes(liquid.name));
    const mentionsNumber = NUMBER_MARKER.test(text);
    const passed = text.length > 0 && (mentionsMaterial || mentionsLiquid || mentionsNumber);
    return {
      id: 'analysis.evidence-link',
      passed,
      detail: passed
        ? '结论提到了实验中的具体现象或数据'
        : '试着引用一次具体实验的结果来支持你的结论',
    };
  },

  'reflection.depth': (ctx) => {
    const text = textOf(ctx);
    const passed = LIMITATION_MARKERS.test(text);
    return {
      id: 'reflection.depth',
      passed,
      detail: passed
        ? '反思提到了可以改进的地方'
        : '可以想一想：这次实验还有哪些不够的地方？下次会怎么改进？',
    };
  },
};

const IMPLEMENTED_CHECK_IDS = new Set([...Object.keys(HARD_CHECKS), ...Object.keys(SOFT_CHECKS)]);

function runCheck(
  registry: Record<string, Check>,
  id: string,
  ctx: GateContext,
): CheckResult {
  const check = registry[id];
  if (!check) throw new Error(`inquiry gate: unknown check id ${JSON.stringify(id)}`);
  return check(ctx);
}

export function buildGateContext(
  task: InquiryTask,
  phase: PhaseConfig,
  collected: PhaseCollected,
): GateContext {
  return { task, phase, collected, submission: effectiveSubmission(collected) };
}

/** Hard checks in the order the phase declares them. */
export function runHardChecks(ctx: GateContext): CheckResult[] {
  return ctx.phase.hardChecks.map((id) => runCheck(HARD_CHECKS, id, ctx));
}

/** Soft checks in the order the phase declares them. Never blocking. */
export function runSoftChecks(ctx: GateContext): CheckResult[] {
  return ctx.phase.softChecks.map((id) => runCheck(SOFT_CHECKS, id, ctx));
}

/** Task-authoring guard used by tests: every referenced id must exist. */
export function isImplementedCheckId(id: string): boolean {
  return IMPLEMENTED_CHECK_IDS.has(id);
}
