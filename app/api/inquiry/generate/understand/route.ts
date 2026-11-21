/**
 * POST /api/inquiry/generate/understand — classify a student's question.
 *
 * Deterministic safety rules run first; a flagged message never reaches the
 * model. The reply is one of ready / clarify / redirect / refuse. Nothing is
 * persisted — the client keeps the clarifications and draft state.
 */
import type { NextRequest } from 'next/server';

import { isServerPersistenceConfigured } from '@/lib/config/feature-flags';
import {
  createUnderstander,
  MAX_CLARIFY_ROUNDS,
  modelCompletion,
  screenQuestion,
} from '@/lib/inquiry/generation/understand';
import { ownerApiError, ownerJson } from '@/lib/server/agent-runtime/route-response';
import { withRequestOwner } from '@/lib/server/identity/with-owner';
import { resolveModelFromHeaders } from '@/lib/server/resolve-model';

export const runtime = 'nodejs';

const QUESTION_LIMIT = 300;

export async function POST(req: NextRequest) {
  if (!isServerPersistenceConfigured()) return new Response('Not found', { status: 404 });

  return withRequestOwner(req, async (_principal, responseHeaders) => {
    let body: Record<string, unknown>;
    try {
      body = (await req.json()) as Record<string, unknown>;
    } catch {
      return ownerApiError('INVALID_REQUEST', 400, '请求格式不正确', responseHeaders);
    }

    const question = typeof body.question === 'string' ? body.question.trim() : '';
    if (!question) {
      return ownerApiError('INVALID_REQUEST', 400, '请先写下你想探究的问题', responseHeaders);
    }
    if (question.length > QUESTION_LIMIT) {
      return ownerApiError(
        'INVALID_REQUEST',
        400,
        `问题太长了，请精简到 ${QUESTION_LIMIT} 字以内`,
        responseHeaders,
      );
    }
    const clarifications = Array.isArray(body.clarifications)
      ? body.clarifications
          .filter((item): item is string => typeof item === 'string')
          .map((item) => item.slice(0, QUESTION_LIMIT))
          .slice(0, MAX_CLARIFY_ROUNDS)
      : [];
    const round = Number.isInteger(body.round) ? Number(body.round) : clarifications.length + 1;

    // Deterministic safety first: a fixed refusal, never a model call.
    const screened = screenQuestion(question);
    if (screened) {
      return ownerJson({ understanding: screened, fallback: false }, 200, responseHeaders);
    }
    if (screenQuestion(clarifications.join('；'))) {
      return ownerJson(
        {
          understanding: {
            status: 'refuse',
            reason: '安全提醒',
            followUp: '这个话题不安全，我们不能这样探究。换一个安全的问题试试吧。',
          },
          fallback: false,
        },
        200,
        responseHeaders,
      );
    }

    let resolved;
    try {
      resolved = await resolveModelFromHeaders(req, 'inquiry-tutor');
    } catch {
      return ownerApiError('MODEL_CONFIG_INVALID', 400, '探究导师暂时不在线', responseHeaders);
    }

    const understand = createUnderstander(modelCompletion(resolved));
    let understanding = await understand({ question, clarifications, round });
    let fallback = false;
    if (!understanding) {
      // The model failed: fall back to treating the question as ready so the
      // student is never blocked. The generator still validates the output.
      understanding = {
        status: 'ready',
        clarifiedQuestion: question.slice(0, QUESTION_LIMIT),
      };
      fallback = true;
    }
    if (understanding.status === 'clarify' && round >= MAX_CLARIFY_ROUNDS) {
      understanding = {
        status: 'ready',
        clarifiedQuestion:
          understanding.clarifiedQuestion ?? `${question}（${clarifications.join('；')}）`.slice(0, QUESTION_LIMIT),
      };
    }

    return ownerJson({ understanding, fallback }, 200, responseHeaders);
  });
}
