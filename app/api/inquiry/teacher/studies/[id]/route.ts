/**
 * GET /api/inquiry/teacher/studies/[id] — one student's inquiry, read-only.
 * The state carries the full record (timeline evidence, hints, safety flags,
 * conversation) so the teacher can inspect the evidence behind a report.
 */
import type { NextRequest } from 'next/server';

import { isServerPersistenceConfigured } from '@/lib/config/feature-flags';
import { getInquiryDb } from '@/lib/inquiry/server/db';
import { listReportVersions, loadCurrentReport } from '@/lib/inquiry/server/reports';
import { loadInquiryStudyForTeacher } from '@/lib/inquiry/server/store';
import { teacherGuard } from '@/lib/inquiry/server/teacher-http';

export const runtime = 'nodejs';

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  if (!isServerPersistenceConfigured()) return new Response('Not found', { status: 404 });
  const denied = teacherGuard(req);
  if (denied) return denied;
  const { id } = await params;
  try {
    const db = await getInquiryDb();
    const study = await loadInquiryStudyForTeacher(db, id);
    if (!study) return new Response('Not found', { status: 404 });
    const report = await loadCurrentReport(db, id);
    const versions = await listReportVersions(db, id);
    return Response.json({
      studyId: study.id,
      revision: study.revision,
      status: study.status,
      learnerKey: study.learnerKey,
      task: study.task,
      state: study.state,
      report,
      versions,
    });
  } catch {
    return Response.json(
      { errorCode: 'INTERNAL_ERROR', error: '暂时无法读取学生记录' },
      { status: 503 },
    );
  }
}
