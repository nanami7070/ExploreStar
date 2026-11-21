/**
 * POST /api/inquiry/generate/[draftId]/confirm — turn the draft into a study.
 *
 * One transaction inserts the personal task row (a full definition snapshot)
 * and the study. Repeating the call — or the same command id — returns the
 * existing study instead of creating another.
 */
import type { NextRequest } from 'next/server';

import { isServerPersistenceConfigured } from '@/lib/config/feature-flags';
import { getInquiryDb } from '@/lib/inquiry/server/db';
import { confirmDraftStudy } from '@/lib/inquiry/server/store';
import { ownerApiError, ownerJson, ownerNotFound } from '@/lib/server/agent-runtime/route-response';
import { withRequestOwner } from '@/lib/server/identity/with-owner';

export const runtime = 'nodejs';

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ draftId: string }> },
) {
  if (!isServerPersistenceConfigured()) return new Response('Not found', { status: 404 });

  return withRequestOwner(req, async (principal, responseHeaders) => {
    const { draftId } = await params;
    let body: Record<string, unknown>;
    try {
      body = (await req.json()) as Record<string, unknown>;
    } catch {
      return ownerApiError('INVALID_REQUEST', 400, '请求格式不正确', responseHeaders);
    }
    const commandId = typeof body.commandId === 'string' ? body.commandId.trim() : '';
    if (!commandId) {
      return ownerApiError('MISSING_REQUIRED_FIELD', 400, '缺少 commandId', responseHeaders);
    }

    try {
      const db = await getInquiryDb();
      const outcome = await confirmDraftStudy(db, {
        draftId,
        ownerId: principal.ownerId,
        commandId,
      });
      return ownerJson(
        {
          studyId: outcome.study.id,
          revision: outcome.study.revision,
          status: outcome.study.status,
          state: outcome.study.state,
          replayed: outcome.replayed,
        },
        outcome.replayed ? 200 : 201,
        responseHeaders,
      );
    } catch (error) {
      const code = (error as { code?: string })?.code;
      if (code === 'NOT_FOUND') return ownerNotFound(responseHeaders);
      if (code === 'CONFLICT') {
        return ownerApiError('RUN_STATE_CONFLICT', 409, '这个方案已经确认开始了', responseHeaders);
      }
      return ownerApiError('INTERNAL_ERROR', 503, '暂时无法开始探究，请稍后再试', responseHeaders);
    }
  });
}
