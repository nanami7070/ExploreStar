/** GET /api/inquiry/teacher/studies — all studies, teacher token required. */
import type { NextRequest } from 'next/server';

import { isServerPersistenceConfigured } from '@/lib/config/feature-flags';
import { getInquiryDb } from '@/lib/inquiry/server/db';
import { listStudiesForTeacher } from '@/lib/inquiry/server/teacher';
import { teacherGuard } from '@/lib/inquiry/server/teacher-http';

export const runtime = 'nodejs';

export async function GET(req: NextRequest) {
  if (!isServerPersistenceConfigured()) return new Response('Not found', { status: 404 });
  const denied = teacherGuard(req);
  if (denied) return denied;
  try {
    const db = await getInquiryDb();
    const limit = Number(new URL(req.url).searchParams.get('limit') ?? 100);
    const studies = await listStudiesForTeacher(db, Number.isFinite(limit) ? limit : 100);
    return Response.json({ studies });
  } catch {
    return Response.json(
      { errorCode: 'INTERNAL_ERROR', error: '暂时无法读取学生记录' },
      { status: 503 },
    );
  }
}
