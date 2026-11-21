/**
 * POST /api/inquiry/study/[id]/action — one student action.
 *
 * `expectedRevision` is the browser's compare-and-swap token: a concurrent
 * tab or a stale page fails with 409 and the latest state instead of
 * overwriting. `commandId` makes a network retry idempotent.
 */
import type { NextRequest } from 'next/server';

import { isServerPersistenceConfigured } from '@/lib/config/feature-flags';
import { InquiryTransitionError } from '@/lib/inquiry/domain/types';
import { getInquiryDb } from '@/lib/inquiry/server/db';
import {
  InquiryStoreError,
  applyInquiryStudyAction,
  type InquiryStudyAction,
} from '@/lib/inquiry/server/store';
import {
  ownerApiError,
  ownerJson,
  ownerNotFound,
} from '@/lib/server/agent-runtime/route-response';
import { withRequestOwner } from '@/lib/server/identity/with-owner';

export const runtime = 'nodejs';

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  if (!isServerPersistenceConfigured()) return new Response('Not found', { status: 404 });

  return withRequestOwner(req, async (principal, responseHeaders) => {
    const { id } = await params;
    let body: Record<string, unknown>;
    try {
      body = (await req.json()) as Record<string, unknown>;
    } catch {
      return ownerApiError('INVALID_REQUEST', 400, '请求格式不正确', responseHeaders);
    }

    const commandId = typeof body.commandId === 'string' ? body.commandId.trim() : '';
    const action = body.action as InquiryStudyAction | undefined;
    const rawRevision = body.expectedRevision;
    const expectedRevision =
      typeof rawRevision === 'number' && Number.isInteger(rawRevision) ? rawRevision : undefined;
    if (!commandId || !action || typeof action !== 'object' || typeof action.action !== 'string') {
      return ownerApiError('INVALID_REQUEST', 400, '缺少 commandId 或 action', responseHeaders);
    }

    try {
      const db = await getInquiryDb();
      const outcome = await applyInquiryStudyAction(db, {
        studyId: id,
        ownerId: principal.ownerId,
        commandId,
        ...(expectedRevision === undefined ? {} : { expectedRevision }),
        action,
      });
      return ownerJson(
        {
          revision: outcome.study.revision,
          status: outcome.study.status,
          state: outcome.study.state,
          events: outcome.events,
          replayed: outcome.replayed,
        },
        200,
        responseHeaders,
      );
    } catch (error) {
      if (error instanceof InquiryStoreError) {
        if (error.code === 'NOT_FOUND') return ownerNotFound(responseHeaders);
        if (error.code === 'CONFLICT') {
          return ownerJson(
            {
              errorCode: 'REVISION_CONFLICT',
              error: error.message,
              revision: error.study?.revision,
              state: error.study?.state,
            },
            409,
            responseHeaders,
          );
        }
        return ownerApiError('INVALID_REQUEST', 400, error.message, responseHeaders);
      }
      if (error instanceof InquiryTransitionError) {
        return ownerJson(
          {
            errorCode: error.code,
            error: error.message,
            details: error.details,
            revision: undefined,
          },
          400,
          responseHeaders,
        );
      }
      console.error('[inquiry-action] the action failed', error);
      return ownerApiError('INTERNAL_ERROR', 500, '操作没有完成，请稍后再试', responseHeaders);
    }
  });
}
