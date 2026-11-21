/**
 * Report generation: rules + optional semantic evaluation → report document →
 * a new immutable report version.
 */
import { evaluateInquiry } from '@/lib/inquiry/evaluation/evaluate';
import { buildInquiryReport, REPORT_EVALUATION_VERSION } from '@/lib/inquiry/evaluation/report';
import type { SemanticEvaluator } from '@/lib/inquiry/evaluation/semantic';
import type { InquiryStudy } from './store';
import { InquiryStoreError, loadInquiryStudy, loadInquiryStudyForTeacher } from './store';
import { saveInquiryReport, type StoredReport } from './reports';
import type { InquiryDb } from './db';

export interface GenerateReportInput {
  studyId: string;
  /** Owner-scoped student request; omit for a teacher request. */
  ownerId?: string;
  semantic?: SemanticEvaluator | null;
  /** Injected in tests for deterministic timestamps. */
  generatedAt?: string;
}

export interface GenerateReportOutcome {
  report: StoredReport;
  study: InquiryStudy;
}

export async function generateInquiryReport(
  db: InquiryDb,
  input: GenerateReportInput,
): Promise<GenerateReportOutcome> {
  const study = input.ownerId
    ? await loadInquiryStudy(db, input.studyId, input.ownerId)
    : await loadInquiryStudyForTeacher(db, input.studyId);
  if (!study) throw new InquiryStoreError('NOT_FOUND', 'study not found');
  if (study.state.status !== 'completed') {
    throw new InquiryStoreError(
      'REPORT_NOT_READY',
      'the inquiry is not completed yet; finish all six phases before generating a report',
    );
  }

  const bundle = await evaluateInquiry({
    task: study.task,
    state: study.state,
    evaluationVersion: REPORT_EVALUATION_VERSION,
    semantic: input.semantic ?? null,
  });
  const document = buildInquiryReport({
    task: study.task,
    state: study.state,
    studyRevision: study.revision,
    learnerKey: study.learnerKey,
    generatedAt: input.generatedAt ?? new Date().toISOString(),
    bundle,
  });
  const report = await saveInquiryReport(db, {
    studyId: study.id,
    ...(input.ownerId ? { ownerId: input.ownerId } : {}),
    document,
  });
  return { report, study };
}
