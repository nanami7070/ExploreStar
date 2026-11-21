/**
 * GET /api/inquiry/study/[id] — the restorable workbench snapshot.
 *
 * Returns the folded state (including the conversation), the reviewed task
 * config and the event log after `after` so a refreshed or reconnecting
 * client can rebuild exactly what it saw (plan §3.10).
 */
import type { NextRequest } from 'next/server';

import { isServerPersistenceConfigured } from '@/lib/config/feature-flags';
import { getInquiryDb } from '@/lib/inquiry/server/db';
import { loadInquiryStudy, loadInquiryStudyEvents } from '@/lib/inquiry/server/store';
import {
  ownerApiError,
  ownerJson,
  ownerNotFound,
} from '@/lib/server/agent-runtime/route-response';
import { withRequestOwner } from '@/lib/server/identity/with-owner';

export const runtime = 'nodejs';

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  if (!isServerPersistenceConfigured()) return new Response('Not found', { status: 404 });

  return withRequestOwner(req, async (principal, responseHeaders) => {
    const { id } = await params;
    const rawAfter = new URL(req.url).searchParams.get('after');
    const after = rawAfter === null ? 0 : Number(rawAfter);
    const afterSequence = Number.isInteger(after) && after >= 0 ? after : 0;

    try {
      const db = await getInquiryDb();
      const study = await loadInquiryStudy(db, id, principal.ownerId);
      if (!study) return ownerNotFound(responseHeaders);
      const events = await loadInquiryStudyEvents(db, id, principal.ownerId, afterSequence);
      if (!events) return ownerNotFound(responseHeaders);
      return ownerJson(
        {
          studyId: study.id,
          revision: study.revision,
          status: study.status,
          state: study.state,
          task: study.task,
          events,
        },
        200,
        responseHeaders,
      );
    } catch {
      return ownerApiError('INTERNAL_ERROR', 503, '暂时无法读取探究记录', responseHeaders);
    }
  });
}
