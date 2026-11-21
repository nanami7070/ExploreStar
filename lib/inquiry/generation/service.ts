/**
 * Orchestrates one task-definition generation: prompt → model → zod → compile.
 *
 * The caller receives a domain `InquiryTask` or `null`. Nothing from the
 * model reaches the state machine without passing the schema and the
 * compiler — phase structure, checks, experiment capability and provenance
 * are all assigned server-side.
 */
import { callLLM } from '@/lib/ai/llm';
import type { InquiryTask } from '@/lib/inquiry/domain/types';
import {
  LIQUID_CATALOG,
  MATERIAL_CATALOG,
} from '@/lib/inquiry/experiments/catalog';
import type { ResolvedModel } from '@/lib/server/resolve-model';

import { compileTask } from './compile-task';
import { parseTaskDefinitionDraft } from './task-schema';

const STAGE = 'inquiry-tutor' as const;
const DISABLED_THINKING = { mode: 'disabled' } as const;

export interface GenerateTaskInput {
  /** The student's own words. */
  originalQuestion: string;
  /** The refined question agreed during understanding. */
  refinedQuestion: string;
  /** Optional feedback used to regenerate a version. */
  feedback?: string;
}

function systemPrompt(): string {
  const catalog = MATERIAL_CATALOG.map(
    (material) => `${material.name}(${material.id}, ${material.density})`,
  ).join('、');
  const liquids = LIQUID_CATALOG.map(
    (liquid) => `${liquid.name}(${liquid.id}, ${liquid.density})`,
  ).join('、');
  return [
    '你是一名小学科学教研员,要为一个三~四年级学生设计完整的六阶段科学探究任务。',
    '只输出一个 JSON 对象,不要 markdown 代码块,不要解释。',
    '',
    'JSON 结构:',
    '{',
    '  "name": "探究任务名称,不超过20字",',
    '  "refinedQuestion": "规范化后的探究问题,不超过80字",',
    '  "context": {"title": "情境标题,不超过15字", "text": "贴近生活的情境描述,不超过150字"},',
    '  "objectives": ["本次探究目标,3条左右,每条不超过50字"],',
    '  "concepts": ["涉及的简单科学概念,2-3条"],',
    '  "materials": [{"id": "英文小写短横线id", "name": "材料中文名"}],',
    '  "liquids": [{"id": "water", "name": "清水"}],',
    '  "safety": ["安全提醒,2-4条"],',
    '  "suggestedTrials": 3,',
    '  "experimentCapability": "observation 或 density-compare",',
    '  "phases": [',
    '    {"id":"question","title":"提出问题","goal":"本阶段学习目标","studentTasks":["学生要完成的操作"],"tutorGuidance":"导师在这个阶段的引导问题"},',
    '    {"id":"hypothesis","title":"猜想与假设","goal":"...","studentTasks":["..."],"tutorGuidance":"..."},',
    '    {"id":"experiment-design","title":"设计实验","goal":"...","studentTasks":["..."],"tutorGuidance":"..."},',
    '    {"id":"evidence","title":"收集证据","goal":"...","studentTasks":["..."],"tutorGuidance":"..."},',
    '    {"id":"analysis","title":"分析结果","goal":"...","studentTasks":["..."],"tutorGuidance":"..."},',
    '    {"id":"reflection","title":"反思与修正","goal":"...","studentTasks":["..."],"tutorGuidance":"..."}',
    '  ]',
    '}',
    '',
    '规则:',
    '1. phases 必须恰好 6 个,id 与顺序固定为 question,hypothesis,experiment-design,evidence,analysis,reflection,不能增删、改名或调换顺序。',
    '2. materials 至少 1 种。即使是观察类任务,也要列出观察所需的材料或对象(例如绿豆、花盆、水)。',
    '3. experimentCapability 默认填 "observation"。只有问题明确关于物体在水中浮沉、',
    '   并且 materials/liquids 全部使用下面目录里的 id 时,才可以填 "density-compare":',
    `   固体目录: ${catalog}; 液体目录: ${liquids}。`,
    '   填 observation 时,不要在任务里声称有模拟实验;evidence 阶段应写成"做真实的观察并记录"。',
    '4. 绝不能建议危险操作:不用火、不碰电、不品尝实验材料、不用化学药品、不用尖锐物对着人。',
    '   需要成人陪同的真实实验,必须在 safety 里写明。',
    '5. 语言面向 9-10 岁学生:句子短、具体、可操作;不用公式、不用专业术语。',
    '6. 整份 JSON 不超过 1800 字,每个字段简洁;不要输出超出结构之外的字段。',
  ].join('\n');
}

function userPrompt(input: GenerateTaskInput): string {
  const lines = [
    `学生的原始问题:「${input.originalQuestion}」`,
    `商定的探究问题:「${input.refinedQuestion}」`,
  ];
  if (input.feedback?.trim()) {
    lines.push(`学生对上一版方案的修改意见:「${input.feedback.trim()}」请按这个意见调整。`);
  }
  return lines.join('\n');
}

/** One model completion; injected so tests never call a provider. */
export interface Completion {
  (system: string, prompt: string): Promise<string>;
}

export function modelCompletion(resolved: ResolvedModel): Completion {
  return async (system, prompt) => {
    const result = await callLLM(
      {
        model: resolved.model,
        system,
        prompt,
        temperature: 0.5,
        maxOutputTokens: 3000,
        maxRetries: 0,
        timeout: 90_000,
      },
      STAGE,
      undefined,
      DISABLED_THINKING,
      { serverManaged: resolved.serverManaged },
    );
    return result.text;
  };
}

export async function generateTaskDefinition(
  complete: Completion,
  input: GenerateTaskInput,
): Promise<InquiryTask | null> {
  try {
    const raw = await complete(systemPrompt(), userPrompt(input));
    const draft = parseTaskDefinitionDraft(raw);
    if (!draft) {
      // Server-side diagnostics only; the student sees a friendly retry.
      console.warn('[inquiry-generation] unparseable task draft:', raw.slice(0, 1500));
      return null;
    }
    return compileTask(draft);
  } catch (error) {
    console.warn('[inquiry-generation] generation failed:', error);
    return null;
  }
}
