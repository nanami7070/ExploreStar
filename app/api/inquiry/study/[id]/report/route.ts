/**
 * Student report route.
 *
 * GET returns the current report (or null) and flags a report whose inquiry
 * has changed since it was generated. POST generates a new immutable report
 * version; the semantic evaluator is best-effort, so a missing model yields a
 * clearly-labelled rules-only report instead of a failure.
 */
import type { NextRequest } from 'next/server';

import { isServerPersistenceConfigured } from '@/lib/config/feature-flags';
import { createSemanticEvaluator } from '@/lib/inquiry/evaluation/semantic';
import { getInquiryDb } from '@/lib/inquiry/server/db';
import { generateInquiryReport } from '@/lib/inquiry/server/report-service';
import { listReportVersions, loadCurrentReport } from '@/lib/inquiry/server/reports';
import { InquiryStoreError } from '@/lib/inquiry/server/store';
import {
  ownerApiError,
  ownerJson,
  ownerNotFound,
} from '@/lib/server/agent-runtime/route-response';
import { withRequestOwner } from '@/lib/server/identity/with-owner';
import { resolveModelFromHeaders } from '@/lib/server/resolve-model';

export const runtime = 'nodejs';

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  if (!isServerPersistenceConfigured()) return new Response('Not found', { status: 404 });
  return withRequestOwner(req, async (principal, responseHeaders) => {
    const { id } = await params;
    try {
      const db = await getInquiryDb();
      const report = await loadCurrentReport(db, id, principal.ownerId);
      const versions = await listReportVersions(db, id, principal.ownerId);
      return ownerJson({ report, versions }, 200, responseHeaders);
    } catch {
      return ownerApiError('INTERNAL_ERROR', 503, '暂时无法读取学习报告', responseHeaders);
    }
  });
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  if (!isServerPersistenceConfigured()) return new Response('Not found', { status: 404 });
  return withRequestOwner(req, async (principal, responseHeaders) => {
    const { id } = await params;
    let db;
    try {
      db = await getInquiryDb();
    } catch {
      return new Response('Not found', { status: 404, headers: responseHeaders });
    }

    let semantic = null;
    try {
      const resolved = await resolveModelFromHeaders(req, 'inquiry-evaluation');
      semantic = createSemanticEvaluator(resolved);
    } catch {
      // Rules-only report; the document records that semantic evaluation was
      // unavailable.
    }

    try {
      const { report } = await generateInquiryReport(db, {
        studyId: id,
        ownerId: principal.ownerId,
        semantic,
      });
      const versions = await listReportVersions(db, id, principal.ownerId);
      return ownerJson({ report, versions }, 201, responseHeaders);
    } catch (error) {
      if (error instanceof InquiryStoreError) {
        if (error.code === 'NOT_FOUND') return ownerNotFound(responseHeaders);
        if (error.code === 'REPORT_NOT_READY') {
          return ownerApiError('INVALID_REQUEST', 409, '完成六个探究阶段后才能生成学习报告', responseHeaders);
        }
      }
      return ownerApiError('INTERNAL_ERROR', 500, '学习报告没有生成成功，请稍后再试', responseHeaders);
    }
  });
}
