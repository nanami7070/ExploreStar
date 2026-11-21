/**
 * The bridge from the injected tutor generator (tutor-turn.ts) to the shared
 * LLM stack. Model resolution stays where every other route keeps it:
 * `resolveModelFromHeaders` → `streamLLM`, so the deployment's slots,
 * fallbacks, usage accounting and retry rules all apply unchanged.
 */
import { streamLLM } from '@/lib/ai/llm';
import type { TutorPrompt } from '@/lib/inquiry/prompts/tutor';
import type { ResolvedModel } from '@/lib/server/resolve-model';

export function streamTutorReply(
  resolved: ResolvedModel,
): (prompt: TutorPrompt) => AsyncIterable<string> {
  return async function* generate(prompt: TutorPrompt) {
    const result = streamLLM(
      {
        model: resolved.model,
        system: prompt.system,
        messages: prompt.messages,
        temperature: 0.6,
        // A tutor turn is a short, guided reply. Thinking-capable models spend
        // the output budget on reasoning before any text and can finish with
        // an empty reply on a long prompt (observed with glm-5.3-flash), so
        // reasoning is disabled for this stage; the budget is still generous.
        maxOutputTokens: 1600,
      },
      'inquiry-tutor',
      { enabled: false },
    );
    for await (const part of result.fullStream) {
      if (part.type === 'error') throw part.error;
      if (part.type === 'text-delta') yield part.text;
    }
  };
}
