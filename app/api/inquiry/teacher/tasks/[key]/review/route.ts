/**
 * POST /api/inquiry/teacher/tasks/[key]/review — record the three review
 * verdicts. Publishing requires science, safety and age all approved; no AI
 * or seed path can publish a task.
 */
import type { NextRequest } from 'next/server';

import { isServerPersistenceConfigured } from '@/lib/config/feature-flags';
import { getInquiryDb } from '@/lib/inquiry/server/db';
import { InquiryStoreError } from '@/lib/inquiry/server/store';
import { reviewInquiryTask, type TaskReviewStatus } from '@/lib/inquiry/server/teacher';
import { teacherGuard } from '@/lib/inquiry/server/teacher-http';

export const runtime = 'nodejs';

type ReviewEntry = { status: TaskReviewStatus; note?: string };

function parseEntry(value: unknown): ReviewEntry | null {
  if (!value || typeof value !== 'object') return null;
  const entry = value as Record<string, unknown>;
  const status = entry.status;
  if (status !== 'pending' && status !== 'approved' && status !== 'rejected') return null;
  return {
    status,
    ...(typeof entry.note === 'string' && entry.note.trim() ? { note: entry.note.trim() } : {}),
  };
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ key: string }> },
) {
  if (!isServerPersistenceConfigured()) return new Response('Not found', { status: 404 });
  const denied = teacherGuard(req);
  if (denied) return denied;
  const { key } = await params;

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return Response.json({ errorCode: 'INVALID_REQUEST', error: '请求格式不正确' }, { status: 400 });
  }
  const reviewer = typeof body.reviewer === 'string' ? body.reviewer.trim() : '';
  const science = parseEntry(body.science);
  const safety = parseEntry(body.safety);
  const age = parseEntry(body.age);
  const publish = body.publish === true;
  if (!reviewer || !science || !safety || !age) {
    return Response.json(
      { errorCode: 'INVALID_REQUEST', error: '需要审核人和三项审核结果' },
      { status: 400 },
    );
  }

  try {
    const db = await getInquiryDb();
    const task = await reviewInquiryTask(db, {
      key,
      reviewer,
      science,
      safety,
      age,
      publish,
      reviewedAt: new Date().toISOString(),
    });
    return Response.json({ task });
  } catch (error) {
    if (error instanceof InquiryStoreError) {
      if (error.code === 'TASK_NOT_FOUND') return new Response('Not found', { status: 404 });
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
