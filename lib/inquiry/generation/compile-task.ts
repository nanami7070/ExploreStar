/**
 * Compile a validated AI draft into a domain `InquiryTask`.
 *
 * Everything the state machine relies on is assigned HERE, never by the
 * model: the six phases (ids and order), the hard/soft check lists, the
 * density-compare experiment config (only when the catalog fully covers the
 * materials), and the knowledge provenance. Reusing the standard check lists
 * means dynamic tasks cannot bypass validation or safety rules.
 */
import {
  PHASE_IDS,
  type HintTriple,
  type InquiryTask,
  type PhaseConfig,
  type PhaseHintTemplates,
  type PhaseId,
  type TaskMaterial,
} from '@/lib/inquiry/domain/types';
import {
  catalogLiquid,
  catalogMaterial,
  LIQUID_CATALOG_IDS,
  MATERIAL_CATALOG_IDS,
} from '@/lib/inquiry/experiments/catalog';

import type { TaskDefinitionDraft } from './task-schema';

const NO_EXPERIMENT_HARD = ['evidence.min-observation-records'];
const NO_EXPERIMENT_SOFT = ['evidence.suggested-count'];

const EXPERIMENT_HARD = ['evidence.min-records'];
const EXPERIMENT_SOFT = ['evidence.suggested-count', 'evidence.control'];

/** The reviewed check lists every task must carry. */
const STANDARD_CHECKS: Record<PhaseId, { hard: readonly string[]; soft: readonly string[] }> = {
  question: { hard: ['question.text-valid'], soft: ['question.form', 'question.relevance'] },
  hypothesis: {
    hard: ['hypothesis.text-present'],
    soft: ['hypothesis.reason', 'hypothesis.relevance'],
  },
  'experiment-design': {
    hard: ['design.materials', 'design.changed-condition', 'design.safety-confirmed'],
    soft: ['design.variables', 'design.single-variable'],
  },
  evidence: { hard: EXPERIMENT_HARD, soft: EXPERIMENT_SOFT },
  analysis: { hard: ['analysis.text-present'], soft: ['analysis.evidence-link'] },
  reflection: { hard: ['reflection.text-present'], soft: ['reflection.depth'] },
};

/** Generic hint triples used when the model's guidance is missing. */
const FALLBACK_HINTS: Record<PhaseId, HintTriple> = {
  question: [
    '你观察到了什么现象？试着用“为什么”或“怎样”把它变成一个可以研究的问题。',
    '想一想：这个问题里，你要研究的对象是什么？你想知道它和什么有关系？',
    '可以试试这个句式：“________ 会怎样，是不是和 ________ 有关系？”',
  ],
  hypothesis: [
    '你觉得答案可能是什么？大胆猜一猜，猜错也没关系。',
    '说说看：你这样猜的理由是什么？',
    '试试这个句式：“我认为________，因为________。”',
  ],
  'experiment-design': [
    '要验证你的猜想，需要准备哪些材料？',
    '想一想：你打算改变哪个条件？哪些条件要保持一样？',
    '照这个格式设计：改变________；保持________不变；观察________。',
  ],
  evidence: [
    '动手做一做，把你观察到的现象记下来。',
    '看看记录表：你已经观察了哪几种情况？还想比较什么？',
    '按这个格式记录：我猜________；我观察到________。',
  ],
  analysis: [
    '你手上的记录支持哪个说法？',
    '能不能引用一次具体的观察结果来说明？',
    '试试这个句式：“我发现________，因为第____次观察中________。”',
  ],
  reflection: [
    '这次探究里，你最满意的地方是什么？',
    '如果再做一次，你会怎么改进？',
    '可以从这些角度写：材料够不够、观察次数多不多、条件控制得怎么样。',
  ],
};

const HINT_TEXT_LIMIT = 300;

function hintTemplatesFor(phaseId: PhaseId, guidance: string): PhaseHintTemplates {
  const text = guidance.trim().slice(0, HINT_TEXT_LIMIT);
  const fallback = FALLBACK_HINTS[phaseId];
  const triple: HintTriple = text
    ? [text, fallback[1], fallback[2]]
    : fallback;
  return { default: triple };
}

/**
 * Only claim a simulation when the question is about floating/sinking AND
 * every material and liquid comes from the deterministic catalog. Anything
 * else becomes a real-observation task — the system never fakes a model it
 * does not have.
 */
function experimentConfigFor(draft: TaskDefinitionDraft): PhaseConfig['experiment'] {
  if (draft.experimentCapability !== 'density-compare') return undefined;
  if (!draft.liquids.length) return undefined;
  const materialIds = draft.materials.map((material) => material.id);
  const liquidIds = draft.liquids.map((liquid) => liquid.id);
  const covered =
    materialIds.every((id) => MATERIAL_CATALOG_IDS.includes(id)) &&
    liquidIds.every((id) => LIQUID_CATALOG_IDS.includes(id));
  if (!covered) return undefined;
  return { model: 'density-compare', materialIds, liquidIds };
}

function compiledMaterials(draft: TaskDefinitionDraft): TaskMaterial[] {
  return draft.materials.map((material) => {
    const known = catalogMaterial(material.id);
    return known
      ? { ...known, name: material.name || known.name }
      : { id: material.id, name: material.name, kind: 'solid' as const };
  });
}

/**
 * Words used by the relevance soft checks. The check is advisory only, so a
 * simple derivation is fine — but it must never be an empty list, or every
 * relevance check would fail.
 */
export function inferTopicKeywords(draft: TaskDefinitionDraft): string[] {
  const keywords = new Set<string>();
  for (const material of draft.materials) {
    const trimmed = material.name.trim();
    if (trimmed.length >= 2) keywords.add(trimmed);
  }
  for (const concept of draft.concepts) {
    for (const token of concept.split(/[，。、；,.;：:！!？?\s]+/)) {
      const trimmed = token.trim();
      if (trimmed.length >= 2 && trimmed.length <= 12) keywords.add(trimmed);
    }
  }
  // The refined question's core noun phrase, minus common question openers.
  const core = draft.refinedQuestion
    .replace(/^(为什么|怎么样|怎样|如何|是不是|能不能|会不会)/, '')
    .replace(/[？?。！!]+$/, '')
    .trim();
  if (core.length >= 2 && core.length <= 20) keywords.add(core);
  if (!keywords.size) keywords.add(draft.name.slice(0, 10));
  return [...keywords].slice(0, 12);
}

/**
 * Compile the draft. Throws when the six phases are missing, duplicated or
 * out of order — the model may not restructure the inquiry flow.
 */
export function compileTask(draft: TaskDefinitionDraft): InquiryTask {
  if (draft.phases.length !== PHASE_IDS.length) {
    throw new Error(`generated task needs exactly ${PHASE_IDS.length} phases`);
  }
  const byId = new Map<PhaseId, TaskDefinitionDraft['phases'][number]>();
  for (const phase of draft.phases) {
    if (byId.has(phase.id)) throw new Error(`duplicate phase ${phase.id}`);
    byId.set(phase.id, phase);
  }
  for (const phaseId of PHASE_IDS) {
    if (!byId.has(phaseId)) throw new Error(`missing phase ${phaseId}`);
  }

  const experiment = experimentConfigFor(draft);
  const liquids = experiment
    ? draft.liquids.map((liquid) => {
        const known = catalogLiquid(liquid.id);
        return known ? { ...known } : { id: liquid.id, name: liquid.name, density: 1.0 };
      })
    : [];

  const phases: PhaseConfig[] = PHASE_IDS.map((phaseId) => {
    const source = byId.get(phaseId)!;
    const checks =
      phaseId === 'evidence' && !experiment
        ? { hard: NO_EXPERIMENT_HARD, soft: NO_EXPERIMENT_SOFT }
        : STANDARD_CHECKS[phaseId];
    return {
      id: phaseId,
      title: source.title,
      goal: source.goal,
      studentTasks: [...source.studentTasks],
      hardChecks: [...checks.hard],
      softChecks: [...checks.soft],
      hintTemplates: hintTemplatesFor(phaseId, source.tutorGuidance),
      ...(phaseId === 'evidence' && experiment ? { experiment } : {}),
    };
  });

  return {
    // id/key are placeholders; confirming the draft assigns the real ones.
    id: 'task-pending',
    key: 'gen-pending',
    name: draft.name,
    grade: '3-4',
    version: 'gen-1',
    goals: draft.objectives.slice(0, 5),
    concepts: draft.concepts.length
      ? draft.concepts.slice(0, 4)
      : [draft.context.text.slice(0, 60)],
    knowledge: {
      source: 'AI 生成（未经教研审核）',
      reviewer: '待教研审核',
      reviewedAt: null,
    },
    intro: draft.context,
    topicKeywords: inferTopicKeywords(draft),
    materials: compiledMaterials(draft),
    liquids,
    safety: draft.safety.slice(0, 5),
    suggestedTrials: Math.min(6, Math.max(2, draft.suggestedTrials)),
    phases,
    published: true,
  };
}
