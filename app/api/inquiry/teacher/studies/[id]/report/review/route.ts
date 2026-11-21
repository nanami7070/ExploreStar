/** POST …/report/review — teacher review of the current AI report. */
import type { NextRequest } from 'next/server';

import { isServerPersistenceConfigured } from '@/lib/config/feature-flags';
import { getInquiryDb } from '@/lib/inquiry/server/db';
import { reviewInquiryReport } from '@/lib/inquiry/server/reports';
import { InquiryStoreError } from '@/lib/inquiry/server/store';
import { teacherGuard } from '@/lib/inquiry/server/teacher-http';

export const runtime = 'nodejs';

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  if (!isServerPersistenceConfigured()) return new Response('Not found', { status: 404 });
  const denied = teacherGuard(req);
  if (denied) return denied;
  const { id } = await params;

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return Response.json({ errorCode: 'INVALID_REQUEST', error: '请求格式不正确' }, { status: 400 });
  }
  const reviewer = typeof body.reviewer === 'string' ? body.reviewer.trim() : '';
  const status = body.status === 'approved' || body.status === 'needs_revision' ? body.status : null;
  const comment = typeof body.comment === 'string' ? body.comment.trim() : '';
  if (!reviewer || !status) {
    return Response.json(
      { errorCode: 'INVALID_REQUEST', error: '需要审核人和审核结果' },
      { status: 400 },
    );
  }

  try {
    const db = await getInquiryDb();
    const report = await reviewInquiryReport(db, {
      studyId: id,
      reviewer,
      status,
      ...(comment ? { comment } : {}),
      reviewedAt: new Date().toISOString(),
    });
    return Response.json({ report });
  } catch (error) {
    if (error instanceof InquiryStoreError) {
      if (error.code === 'NOT_FOUND') {
        return Response.json(
          { errorCode: 'NOT_FOUND', error: '这次探究还没有生成报告' },
          { status: 404 },
        );
      }
      if (error.code === 'INVALID_PAYLOAD') {
        return Response.json({ errorCode: 'INVALID_PAYLOAD', error: error.message }, { status: 400 });
      }
    }
    return Response.json(
      { errorCode: 'INTERNAL_ERROR', error: '审核没有保存成功' },
      { status: 500 },
    );
  }
}
