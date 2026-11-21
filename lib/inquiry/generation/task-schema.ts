/**
 * Structured schema for AI-generated inquiry tasks.
 *
 * The model returns one JSON object; this module validates it with zod and
 * never trusts anything the domain cannot express. Phase ids, order and the
 * hard/soft check lists are enforced later by `compile-task.ts` — the model
 * cannot add checks, drop phases, or gain a simulation the system lacks.
 */
import { jsonrepair } from 'jsonrepair';
import { z } from 'zod';

import { PHASE_IDS } from '@/lib/inquiry/domain/types';

/** Strip code fences and slice the first JSON object out of a reply. */
export function extractJsonObject(text: string): string | null {
  const cleaned = text
    .replace(/```(?:json)?/gi, '')
    .replace(/```/g, '')
    .trim();
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  return cleaned.slice(start, end + 1);
}

/** Parse a JSON reply defensively; returns null instead of throwing. */
export function parseJsonReply(text: string): unknown | null {
  const sliced = extractJsonObject(text);
  if (!sliced) return null;
  try {
    return JSON.parse(jsonrepair(sliced));
  } catch {
    return null;
  }
}

const phaseIdSchema = z.enum(PHASE_IDS);

const materialSchema = z.object({
  id: z.string().min(1).max(60),
  name: z.string().min(1).max(30),
});

const liquidSchema = z.object({
  id: z.string().min(1).max(40),
  name: z.string().min(1).max(20),
});

const phaseSchema = z.object({
  id: phaseIdSchema,
  title: z.string().min(2).max(30),
  goal: z.string().min(2).max(200),
  studentTasks: z.array(z.string().min(1).max(120)).min(1).max(4),
  tutorGuidance: z.string().min(2).max(300),
});

export const taskDefinitionDraftSchema = z.object({
  name: z.string().min(2).max(60),
  refinedQuestion: z.string().min(2).max(200),
  grade: z.string().max(10).default('3-4'),
  context: z.object({
    title: z.string().min(1).max(40),
    text: z.string().min(2).max(400),
  }),
  objectives: z.array(z.string().min(2).max(120)).min(2).max(5),
  concepts: z.array(z.string().min(2).max(120)).max(4).default([]),
  materials: z.array(materialSchema).min(1).max(6),
  liquids: z.array(liquidSchema).max(3).default([]),
  safety: z.array(z.string().min(2).max(120)).min(1).max(5),
  suggestedTrials: z.number().int().min(1).max(10).default(3),
  /**
   * The model's claim about experiment capability. The compiler re-validates
   * it against the deterministic catalog — a claim alone grants nothing.
   */
  experimentCapability: z.enum(['density-compare', 'observation']).default('observation'),
  phases: z.array(phaseSchema).length(6),
});

export type TaskDefinitionDraft = z.infer<typeof taskDefinitionDraftSchema>;

/** Parse + validate a model reply. Returns null when anything is off. */
export function parseTaskDefinitionDraft(text: string): TaskDefinitionDraft | null {
  const parsed = parseJsonReply(text);
  if (parsed === null) return null;
  const result = taskDefinitionDraftSchema.safeParse(parsed);
  return result.success ? result.data : null;
}
