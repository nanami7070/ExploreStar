/**
 * GET /api/inquiry/tasks — the student task list.
 *
 * Only tasks a human reviewer has published are public; drafts stay visible on
 * a development host for the prototype (labelled `draft`), and
 * INQUIRY_HIDE_DRAFT_TASKS=true hides them there too.
 */
import type { NextRequest } from 'next/server';

import { isServerPersistenceConfigured } from '@/lib/config/feature-flags';
import { getInquiryDb } from '@/lib/inquiry/server/db';
import { listInquiryTasks } from '@/lib/inquiry/server/store';
import { isDraftPreview, isTaskVisibleToStudents } from '@/lib/inquiry/server/visibility';
import { ownerApiError, ownerJson } from '@/lib/server/agent-runtime/route-response';
import { withRequestOwner } from '@/lib/server/identity/with-owner';

export const runtime = 'nodejs';

export async function GET(req: NextRequest) {
  if (!isServerPersistenceConfigured()) return new Response('Not found', { status: 404 });

  return withRequestOwner(req, async (_principal, responseHeaders) => {
    try {
      const db = await getInquiryDb();
      const tasks = (await listInquiryTasks(db))
        .filter((task) => isTaskVisibleToStudents(task))
        .map((task) => ({
          id: task.id,
          key: task.key,
          name: task.name,
          grade: task.grade,
          goals: task.goals,
          intro: task.intro,
          published: task.published,
          draft: isDraftPreview(task),
        }));
      return ownerJson({ tasks }, 200, responseHeaders);
    } catch {
      return ownerApiError('INTERNAL_ERROR', 503, '任务列表暂时不可用，请稍后再试', responseHeaders);
    }
  });
}
