/**
 * LLM semantic evaluation (plan §四).
 *
 * The model chooses rubric levels and cites evidence IDs from a supplied
 * whitelist. It never supplies quotes — refs are rebuilt from the actual
 * records, so a hallucinated id is dropped and an evaluation with no valid
 * reference is downgraded to `insufficient_evidence`. Any parse failure
 * degrades to rules-only evaluation.
 */
import { jsonrepair } from 'jsonrepair';
import { z } from 'zod';

import { callLLM } from '@/lib/ai/llm';
import type { InquirySessionState, InquiryTask } from '@/lib/inquiry/domain/types';
import type { ResolvedModel } from '@/lib/server/resolve-model';

import { INQUIRY_RUBRIC } from './rubric';
import { phaseRevisionSummary } from './rules';
import {
  EVALUATION_DIMENSIONS,
  type EvidenceItem,
  type EvidenceRef,
  type SemanticEvaluation,
  type SemanticDimensionResult,
} from './types';

const EVALUATION_STAGE = 'inquiry-evaluation' as const;
const DISABLED_THINKING = { mode: 'disabled' } as const;

const dimensionSchema = z.enum(EVALUATION_DIMENSIONS);
const levelSchema = z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4)]);

const responseSchema = z.object({
  evaluations: z
    .array(
      z.object({
        dimension: dimensionSchema,
        status: z.enum(['evaluated', 'insufficient_evidence']),
        level: levelSchema.nullable(),
        basis: z.array(z.string()).max(6).default([]),
        suggestions: z.array(z.string()).max(4).default([]),
        evidenceIds: z.array(z.string()).max(8).default([]),
      }),
    )
    .max(6),
});

const SYSTEM_PROMPT = `你是小学三、四年级科学探究的学习评价助手。你只能依据用户消息中给出的“学生证据”评价，不得编造学生没有做过的实验、没有写过的内容或没有说过的理由。
按量规评价六个维度（question 科学问题提出、hypothesis 猜想与假设、design 实验设计、evidence 证据收集、analysis 分析与解释、reflection 反思与修正），等级为 1–4。
规则：
- 每条评价必须引用 evidenceIds 中至少一个真实 id；没有足够证据时输出 status="insufficient_evidence" 且 level=null，不要强行给分。
- 学生是否猜中实验结果不是评分标准；实验次数多不等于能力强。
- 表达简短、口语化、有错别字或使用方言，不代表科学理解差，不要因此降级。
- 学生的预测与观察不一致是学习机会，不是错误。
- 不要因为学生没有使用“变量”“假设”等术语而降级。
- 只输出 JSON：{"evaluations":[{"dimension":"question","status":"evaluated","level":3,"basis":["..."],"suggestions":["..."],"evidenceIds":["sub-..."]}]}
- 不得输出 JSON 以外的文字；不得引用列表之外的 id。`;

const EVIDENCE_KIND_LABEL: Record<EvidenceItem['kind'], string> = {
  submission: '阶段提交',
  experiment: '实验记录',
  observation: '观察记录',
  chat: '导师对话',
};

export interface SemanticEvaluationInput {
  task: InquiryTask;
  state: InquirySessionState;
  /** Active, current-revision evidence only. */
  evidence: EvidenceItem[];
}

export type SemanticEvaluator = (
  input: SemanticEvaluationInput,
) => Promise<SemanticEvaluation | null>;

export interface SemanticPrompt {
  system: string;
  prompt: string;
  allowed: Map<string, EvidenceItem>;
}

export function buildSemanticPrompt(input: SemanticEvaluationInput): SemanticPrompt {
  const allowed = new Map(input.evidence.map((item) => [item.id, item]));
  const rubric = INQUIRY_RUBRIC.map((dimension) => ({
    dimension: dimension.dimension,
    title: dimension.title,
    objective: dimension.objective,
    indicators: dimension.indicators,
    levels: dimension.levels,
    avoid: dimension.avoid,
  }));
  const payload = {
    task: { name: input.task.name, grade: input.task.grade, key: input.task.key },
    phaseRevisions: phaseRevisionSummary(input.state),
    submissionCounts: Object.fromEntries(
      Object.entries(input.state.collected).map(([phaseId, collected]) => [
        phaseId,
        collected.submissions.length,
      ]),
    ),
    rubric,
    evidence: input.evidence.map((item) => ({
      id: item.id,
      kind: EVIDENCE_KIND_LABEL[item.kind],
      phase: item.phaseId,
      quote: item.quote,
    })),
  };
  return {
    system: SYSTEM_PROMPT,
    prompt: JSON.stringify(payload),
    allowed,
  };
}

/**
 * Parse the model's JSON against the evidence whitelist. Unknown ids are
 * dropped; an "evaluated" result with no valid id is downgraded to
 * insufficient evidence. Returns null when no usable dimension remains.
 */
export function parseSemanticEvaluation(
  text: string,
  allowed: ReadonlyMap<string, EvidenceItem>,
): SemanticEvaluation | null {
  try {
    const cleaned = text
      .trim()
      .replace(/^```(?:json)?\s*/i, '')
      .replace(/\s*```$/, '');
    const start = cleaned.indexOf('{');
    const end = cleaned.lastIndexOf('}');
    if (start < 0 || end <= start) return null;
    const parsed = JSON.parse(jsonrepair(cleaned.slice(start, end + 1))) as unknown;
    const result = responseSchema.safeParse(parsed);
    if (!result.success) return null;

    const seen = new Set<string>();
    const dimensions: SemanticDimensionResult[] = [];
    for (const entry of result.data.evaluations) {
      if (seen.has(entry.dimension)) continue;
      seen.add(entry.dimension);
      const refs: EvidenceRef[] = [];
      for (const id of entry.evidenceIds) {
        const item = allowed.get(id);
        if (!item) continue;
        if (refs.some((ref) => ref.id === item.id)) continue;
        refs.push({
          id: item.id,
          kind: item.kind,
          ...(item.phaseId ? { phaseId: item.phaseId } : {}),
          quote: item.quote,
        });
      }
      let status = entry.status;
      let level = entry.level;
      if (status === 'evaluated' && (level === null || refs.length === 0)) {
        // No evidence the level can be tied to: never let an unsupported
        // score through.
        status = 'insufficient_evidence';
        level = null;
      }
      if (status === 'insufficient_evidence') level = null;
      dimensions.push({
        dimension: entry.dimension,
        status,
        level,
        basis: entry.basis.slice(0, 6),
        suggestions: entry.suggestions.slice(0, 4),
        evidenceRefs: refs,
      });
    }
    return dimensions.length ? { dimensions } : null;
  } catch {
    return null;
  }
}

export function createSemanticEvaluator(resolved: ResolvedModel): SemanticEvaluator {
  return async function evaluate(input) {
    try {
      const { system, prompt, allowed } = buildSemanticPrompt(input);
      const result = await callLLM(
        {
          model: resolved.model,
          system,
          prompt,
          maxOutputTokens: 1800,
          maxRetries: 0,
          timeout: 60_000,
        },
        EVALUATION_STAGE,
        undefined,
        DISABLED_THINKING,
        { serverManaged: resolved.serverManaged },
      );
      return parseSemanticEvaluation(result.text, allowed);
    } catch {
      return null;
    }
  };
}
