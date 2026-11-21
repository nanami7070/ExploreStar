/**
 * POST /api/inquiry/teacher/studies/[id]/report — generate or regenerate the
 * learning report for a completed inquiry. Every call appends a version.
 */
import type { NextRequest } from 'next/server';

import { isServerPersistenceConfigured } from '@/lib/config/feature-flags';
import { createSemanticEvaluator } from '@/lib/inquiry/evaluation/semantic';
import { getInquiryDb } from '@/lib/inquiry/server/db';
import { generateInquiryReport } from '@/lib/inquiry/server/report-service';
import { listReportVersions } from '@/lib/inquiry/server/reports';
import { InquiryStoreError } from '@/lib/inquiry/server/store';
import { teacherGuard } from '@/lib/inquiry/server/teacher-http';
import { resolveModelFromHeaders } from '@/lib/server/resolve-model';

export const runtime = 'nodejs';

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  if (!isServerPersistenceConfigured()) return new Response('Not found', { status: 404 });
  const denied = teacherGuard(req);
  if (denied) return denied;
  const { id } = await params;
  const db = await getInquiryDb();

  let semantic = null;
  try {
    const resolved = await resolveModelFromHeaders(req, 'inquiry-evaluation');
    semantic = createSemanticEvaluator(resolved);
  } catch {
    // Rules-only report; the document labels the missing semantic evaluation.
  }

  try {
    const { report } = await generateInquiryReport(db, { studyId: id, semantic });
    const versions = await listReportVersions(db, id);
    return Response.json({ report, versions }, { status: 201 });
  } catch (error) {
    if (error instanceof InquiryStoreError) {
      if (error.code === 'NOT_FOUND') return new Response('Not found', { status: 404 });
      if (error.code === 'REPORT_NOT_READY') {
        return Response.json(
          { errorCode: 'REPORT_NOT_READY', error: '探究尚未完成，不能生成报告' },
          { status: 409 },
        );
      }
    }
    return Response.json(
      { errorCode: 'INTERNAL_ERROR', error: '报告生成失败' },
      { status: 500 },
    );
  }
}
