/** GET /api/inquiry/teacher/tasks — tasks with review and publish state. */
import type { NextRequest } from 'next/server';

import { isServerPersistenceConfigured } from '@/lib/config/feature-flags';
import { getInquiryDb } from '@/lib/inquiry/server/db';
import { listTasksForTeacher } from '@/lib/inquiry/server/teacher';
import { teacherGuard } from '@/lib/inquiry/server/teacher-http';

export const runtime = 'nodejs';

export async function GET(req: NextRequest) {
  if (!isServerPersistenceConfigured()) return new Response('Not found', { status: 404 });
  const denied = teacherGuard(req);
  if (denied) return denied;
  try {
    const db = await getInquiryDb();
    return Response.json({ tasks: await listTasksForTeacher(db) });
  } catch {
    return Response.json(
      { errorCode: 'INTERNAL_ERROR', error: '暂时无法读取任务' },
      { status: 503 },
    );
  }
}
