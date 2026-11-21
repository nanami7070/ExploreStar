/**
 * Problem understanding for student-initiated inquiries.
 *
 * A deterministic safety rule runs first (the model is never asked about
 * dangerous or prompt-injecting text). The model then classifies the question
 * as ready / clarify / redirect / refuse. Every failure degrades to `null` so
 * the route can fall back to a friendly retry message.
 */
import { z } from 'zod';

import { callLLM } from '@/lib/ai/llm';
import { screenStudentMessage } from '@/lib/inquiry/safety';
import type { ResolvedModel } from '@/lib/server/resolve-model';

import { parseJsonReply } from './task-schema';

const STAGE = 'inquiry-tutor' as const;
const DISABLED_THINKING = { mode: 'disabled' } as const;
export const MAX_CLARIFY_ROUNDS = 3;

export interface UnderstandResult {
  status: 'ready' | 'clarify' | 'redirect' | 'refuse';
  clarifiedQuestion?: string;
  followUp?: string;
  reason?: string;
  options?: string[];
}

export interface UnderstandInput {
  question: string;
  /** The student's answers to earlier follow-ups, oldest first. */
  clarifications: string[];
  round: number;
}

// The model sometimes returns an empty string for the field that does not
// apply to its chosen status (e.g. clarifiedQuestion on a clarify reply).
// `.catch(undefined)` turns such a field into "absent" instead of failing the
// whole reply; the status-specific checks below still enforce what matters.
const responseSchema = z.object({
  status: z.enum(['ready', 'clarify', 'redirect', 'refuse']),
  clarifiedQuestion: z.string().min(2).max(200).optional().catch(undefined),
  followUp: z.string().min(2).max(200).optional().catch(undefined),
  reason: z.string().min(1).max(300).optional().catch(undefined),
  options: z.array(z.string().min(1).max(60)).max(3).optional().catch(undefined),
});

/** Parse + validate a model reply; each status needs its key field. */
export function parseUnderstandResponse(text: string): UnderstandResult | null {
  const parsed = parseJsonReply(text);
  if (parsed === null) return null;
  const result = responseSchema.safeParse(parsed);
  if (!result.success) return null;
  const data = result.data;
  if (data.status === 'ready' && !data.clarifiedQuestion) return null;
  if ((data.status === 'clarify' || data.status === 'redirect') && !data.followUp) return null;
  if (data.status === 'refuse' && !data.reason) return null;
  return data;
}

/**
 * Deterministic pre-screen. A flagged message never reaches the model; the
 * fixed reply is returned as a refusal so the UI can show it as-is.
 */
export function screenQuestion(text: string): UnderstandResult | null {
  const screen = screenStudentMessage(text);
  if (!screen.kind || !screen.reply) return null;
  return { status: 'refuse', followUp: screen.reply, reason: 'safety-rule' };
}

export function buildUnderstandPrompt(input: UnderstandInput): { system: string; prompt: string } {
  const system = [
    '你是小学三~四年级科学探究课的探究导师。学生想提出一个可以动手探究的科学问题。',
    '判断学生的问题,只输出一个 JSON 对象,不要输出任何其他文字或代码块标记。',
    '',
    '判定规则:',
    '- ready: 问题清晰、属于科学、适合小学中年级、可以用观察/比较/小实验探究。',
    '  给出 clarifiedQuestion:保留学生原意、表述更清楚的探究问题(不超过80字)。',
    '- clarify: 问题太宽泛或缺研究对象/条件。用 followUp 提一个孩子能回答的具体追问,',
    '  并给 2-3 个简短 options(每个不超过20字)供选择。',
    '- redirect: 问题无法用手边材料实验(如天文、历史、纯想象)。友好解释,并把问题转换为',
    '  可以观察或验证的方向;followUp 说明理由,options 给 2-3 个可转换的探究方向。',
    '- refuse: 不是科学问题(闲聊、非科学诉求)。reason 用一句孩子能懂的话说明,',
    '  followUp 给一句鼓励他提出科学问题的话。',
    '',
    '语言:面向 9-10 岁,简单、温暖,不用公式和术语。',
    'JSON 格式: {"status":"ready|clarify|redirect|refuse","clarifiedQuestion":"...","followUp":"...","options":["..."],"reason":"..."}',
  ].join('\n');

  const lines = [`学生的问题:「${input.question}」`];
  if (input.clarifications.length) {
    lines.push('之前的追问与学生的回答:');
    input.clarifications.forEach((answer, index) => {
      lines.push(`  第 ${index + 1} 轮回答:「${answer}」`);
    });
  }
  if (input.round >= MAX_CLARIFY_ROUNDS) {
    lines.push(
      `这已经是第 ${input.round} 轮。不能再继续追问:请直接给出 ready(把已有信息整理成探究问题)、`,
      'redirect 或 refuse 的最终判断。',
    );
  } else {
    lines.push(`这是第 ${input.round} 轮。`);
  }
  return { system, prompt: lines.join('\n') };
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
        temperature: 0.3,
        maxOutputTokens: 600,
        maxRetries: 0,
        timeout: 45_000,
      },
      STAGE,
      undefined,
      DISABLED_THINKING,
      { serverManaged: resolved.serverManaged },
    );
    return result.text;
  };
}

export function createUnderstander(
  complete: Completion,
): (input: UnderstandInput) => Promise<UnderstandResult | null> {
  return async (input) => {
    try {
      const { system, prompt } = buildUnderstandPrompt(input);
      const raw = await complete(system, prompt);
      const parsed = parseUnderstandResponse(raw);
      if (!parsed) {
        console.warn('[inquiry-understand] unparseable reply:', raw.slice(0, 800));
      }
      return parsed;
    } catch (error) {
      console.warn('[inquiry-understand] model call failed:', error);
      return null;
    }
  };
}
