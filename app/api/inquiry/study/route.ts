/**
 * POST /api/inquiry/study — start a new inquiry.
 *
 * The client sends its own command id; a retried create returns the same
 * study instead of making a second one. Unreviewed drafts are refused in
 * production through the same visibility rule as the task list.
 */
import type { NextRequest } from 'next/server';

import { isServerPersistenceConfigured } from '@/lib/config/feature-flags';
import { getInquiryDb } from '@/lib/inquiry/server/db';
import { createInquiryStudy, getInquiryTask } from '@/lib/inquiry/server/store';
import { isTaskVisibleToStudents } from '@/lib/inquiry/server/visibility';
import {
  ownerApiError,
  ownerJson,
  ownerNotFound,
} from '@/lib/server/agent-runtime/route-response';
import { withRequestOwner } from '@/lib/server/identity/with-owner';

export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  if (!isServerPersistenceConfigured()) return new Response('Not found', { status: 404 });

  return withRequestOwner(req, async (principal, responseHeaders) => {
    let body: Record<string, unknown>;
    try {
      body = (await req.json()) as Record<string, unknown>;
    } catch {
      return ownerApiError('INVALID_REQUEST', 400, '请求格式不正确', responseHeaders);
    }
    const taskKey = typeof body.taskKey === 'string' ? body.taskKey.trim() : '';
    const commandId = typeof body.commandId === 'string' ? body.commandId.trim() : '';
    if (!taskKey || !commandId) {
      return ownerApiError('MISSING_REQUIRED_FIELD', 400, '缺少 taskKey 或 commandId', responseHeaders);
    }

    try {
      const db = await getInquiryDb();
      const task = await getInquiryTask(db, taskKey);
      if (!task || !isTaskVisibleToStudents(task)) return ownerNotFound(responseHeaders);

      const outcome = await createInquiryStudy(db, {
        ownerId: principal.ownerId,
        taskKey,
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
      if ((error as Error)?.name === 'InquiryStoreError') {
        return ownerApiError('INTERNAL_ERROR', 503, '暂时无法创建探究，请稍后再试', responseHeaders);
      }
      return ownerApiError('INTERNAL_ERROR', 500, '创建探究失败', responseHeaders);
    }
  });
}
