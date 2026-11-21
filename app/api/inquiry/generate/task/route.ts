/**
 * POST /api/inquiry/generate/task — generate (or regenerate) a task draft.
 *
 * The reply carries the compiled definition for preview plus the draft id the
 * confirm step needs. Regenerating with `draftId` + `feedback` stores a new
 * version of the same draft; no study exists yet.
 */
import type { NextRequest } from 'next/server';

import { isServerPersistenceConfigured } from '@/lib/config/feature-flags';
import { generateTaskDefinition, modelCompletion } from '@/lib/inquiry/generation/service';
import { screenQuestion } from '@/lib/inquiry/generation/understand';
import { getInquiryDb } from '@/lib/inquiry/server/db';
import { saveTaskDraft } from '@/lib/inquiry/server/store';
import { ownerApiError, ownerJson } from '@/lib/server/agent-runtime/route-response';
import { withRequestOwner } from '@/lib/server/identity/with-owner';
import { resolveModelFromHeaders } from '@/lib/server/resolve-model';

export const runtime = 'nodejs';

const QUESTION_LIMIT = 300;
const FEEDBACK_LIMIT = 300;

export async function POST(req: NextRequest) {
  if (!isServerPersistenceConfigured()) return new Response('Not found', { status: 404 });

  return withRequestOwner(req, async (principal, responseHeaders) => {
    let body: Record<string, unknown>;
    try {
      body = (await req.json()) as Record<string, unknown>;
    } catch {
      return ownerApiError('INVALID_REQUEST', 400, '请求格式不正确', responseHeaders);
    }

    const originalQuestion =
      typeof body.originalQuestion === 'string' ? body.originalQuestion.trim() : '';
    const refinedQuestion =
      typeof body.refinedQuestion === 'string' ? body.refinedQuestion.trim() : '';
    const feedback =
      typeof body.feedback === 'string' ? body.feedback.trim().slice(0, FEEDBACK_LIMIT) : '';
    const draftId = typeof body.draftId === 'string' && body.draftId ? body.draftId : undefined;

    if (!originalQuestion || !refinedQuestion) {
      return ownerApiError('MISSING_REQUIRED_FIELD', 400, '缺少探究问题', responseHeaders);
    }
    if (originalQuestion.length > QUESTION_LIMIT || refinedQuestion.length > QUESTION_LIMIT) {
      return ownerApiError('INVALID_REQUEST', 400, '问题太长了，请精简一下', responseHeaders);
    }
    if (screenQuestion(`${originalQuestion}\n${feedback}`)) {
      return ownerApiError(
        'CONTENT_SENSITIVE',
        400,
        '这个话题不安全，我们不能这样探究。换一个安全的问题试试吧。',
        responseHeaders,
      );
    }

    let resolved;
    try {
      resolved = await resolveModelFromHeaders(req, 'inquiry-tutor');
    } catch {
      return ownerApiError('MODEL_CONFIG_INVALID', 400, '探究导师暂时不在线', responseHeaders);
    }

    const definition = await generateTaskDefinition(modelCompletion(resolved), {
      originalQuestion,
      refinedQuestion,
      ...(feedback ? { feedback } : {}),
    });
    if (!definition) {
      return ownerApiError(
        'GENERATION_FAILED',
        502,
        '导师这次没有把方案整理好，请再试一次',
        responseHeaders,
      );
    }

    try {
      const db = await getInquiryDb();
      const draft = await saveTaskDraft(db, {
        ownerId: principal.ownerId,
        ...(draftId ? { draftId } : {}),
        originalQuestion,
        refinedQuestion,
        definition,
        ...(feedback ? { feedback } : {}),
      });
      return ownerJson(
        {
          draftId: draft.id,
          version: draft.version,
          definition: draft.definition,
          originalQuestion: draft.originalQuestion,
          refinedQuestion: draft.refinedQuestion,
        },
        draft.version > 1 ? 200 : 201,
        responseHeaders,
      );
    } catch (error) {
      if ((error as { code?: string })?.code === 'CONFLICT') {
        return ownerApiError('RUN_STATE_CONFLICT', 409, '这个方案已经确认开始了', responseHeaders);
      }
      return ownerApiError('INTERNAL_ERROR', 503, '暂时无法保存方案，请稍后再试', responseHeaders);
    }
  });
}
