/**
 * Report persistence and versioning (plan §六).
 *
 * `inquiry_reports` keeps the current report for a study; every generation and
 * every teacher review appends an immutable row to `inquiry_report_versions`,
 * so an earlier report is never silently overwritten. The stored
 * `study_revision` lets readers detect a stale report after the inquiry
 * changes.
 */
import type { InquiryReportDocument, ReportReviewStatus } from '@/lib/inquiry/evaluation/report';

import type { InquiryDb, InquiryQueryable } from './db';
import { InquiryStoreError } from './store';

export interface StoredReport {
  studyId: string;
  revision: number;
  status: string;
  document: InquiryReportDocument;
  studyRevision: number;
  evaluationVersion: string;
  updatedAt?: string;
}

export interface CurrentReport extends StoredReport {
  /** True when the inquiry has changed since this report was generated. */
  stale: boolean;
  currentStudyRevision: number;
}

function readJson<T>(value: unknown): T | null {
  if (value === null || value === undefined) return null;
  if (typeof value === 'string') {
    try {
      return JSON.parse(value) as T;
    } catch {
      return null;
    }
  }
  return value as T;
}

interface StudyRow {
  revision: number;
  learner_key: string;
}

async function lockStudy(
  tx: InquiryQueryable,
  studyId: string,
  ownerId: string | undefined,
): Promise<StudyRow> {
  const result = await tx.query(
    `SELECT revision, learner_key FROM inquiry_studies
     WHERE id = $1${ownerId ? ' AND owner_id = $2' : ''} FOR UPDATE`,
    ownerId ? [studyId, ownerId] : [studyId],
  );
  const row = result.rows[0];
  if (!row) throw new InquiryStoreError('NOT_FOUND', 'study not found');
  return { revision: Number(row.revision), learner_key: String(row.learner_key) };
}

async function nextRevision(tx: InquiryQueryable, studyId: string): Promise<number> {
  const result = await tx.query(
    `SELECT COALESCE(MAX(revision), 0) + 1 AS next FROM inquiry_report_versions WHERE study_id = $1`,
    [studyId],
  );
  return Number(result.rows[0]?.next ?? 1);
}

async function writeReport(
  tx: InquiryQueryable,
  studyId: string,
  revision: number,
  document: InquiryReportDocument,
): Promise<void> {
  await tx.query(
    `INSERT INTO inquiry_report_versions
       (study_id, revision, evaluation_version, study_revision, status, document)
     VALUES ($1,$2,$3,$4,$5,$6)`,
    [
      studyId,
      revision,
      document.evaluationVersion,
      document.studyRevision,
      document.status,
      JSON.stringify(document),
    ],
  );
  await tx.query(
    `INSERT INTO inquiry_reports
       (study_id, revision, status, document, study_revision, evaluation_version, updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,now())
     ON CONFLICT (study_id) DO UPDATE SET
       revision = EXCLUDED.revision,
       status = EXCLUDED.status,
       document = EXCLUDED.document,
       study_revision = EXCLUDED.study_revision,
       evaluation_version = EXCLUDED.evaluation_version,
       updated_at = now()`,
    [
      studyId,
      revision,
      document.status,
      JSON.stringify(document),
      document.studyRevision,
      document.evaluationVersion,
    ],
  );
}

/** Append one generated report. A retry of the same generation appends a new
 * version by design — reports are immutable snapshots, not idempotent rows. */
export async function saveInquiryReport(
  db: InquiryDb,
  input: {
    studyId: string;
    ownerId?: string;
    document: InquiryReportDocument;
  },
): Promise<StoredReport> {
  return db.transaction(async (tx) => {
    await lockStudy(tx, input.studyId, input.ownerId);
    const revision = await nextRevision(tx, input.studyId);
    await writeReport(tx, input.studyId, revision, input.document);
    return {
      studyId: input.studyId,
      revision,
      status: input.document.status,
      document: input.document,
      studyRevision: input.document.studyRevision,
      evaluationVersion: input.document.evaluationVersion,
    };
  });
}

export async function loadCurrentReport(
  db: InquiryQueryable,
  studyId: string,
  ownerId?: string,
): Promise<CurrentReport | null> {
  const result = await db.query(
    `SELECT r.revision, r.status, r.document, r.study_revision, r.evaluation_version,
            r.updated_at, s.revision AS current_study_revision
     FROM inquiry_reports r
     JOIN inquiry_studies s ON s.id = r.study_id
     WHERE r.study_id = $1${ownerId ? ' AND s.owner_id = $2' : ''}`,
    ownerId ? [studyId, ownerId] : [studyId],
  );
  const row = result.rows[0];
  if (!row) return null;
  const document = readJson<InquiryReportDocument>(row.document);
  if (!document) return null;
  const studyRevision = Number(row.study_revision ?? document.studyRevision);
  const currentStudyRevision = Number(row.current_study_revision);
  return {
    studyId,
    revision: Number(row.revision),
    status: String(row.status),
    document,
    studyRevision,
    evaluationVersion: String(row.evaluation_version ?? document.evaluationVersion),
    ...(row.updated_at ? { updatedAt: String(row.updated_at) } : {}),
    stale: studyRevision !== currentStudyRevision,
    currentStudyRevision,
  };
}

export interface ReportVersionSummary {
  revision: number;
  status: string;
  studyRevision: number;
  evaluationVersion: string;
  generatedAt?: string;
}

export async function listReportVersions(
  db: InquiryQueryable,
  studyId: string,
  ownerId?: string,
): Promise<ReportVersionSummary[]> {
  const result = await db.query(
    `SELECT v.revision, v.status, v.study_revision, v.evaluation_version, v.generated_at
     FROM inquiry_report_versions v
     JOIN inquiry_studies s ON s.id = v.study_id
     WHERE v.study_id = $1${ownerId ? ' AND s.owner_id = $2' : ''}
     ORDER BY v.revision DESC`,
    ownerId ? [studyId, ownerId] : [studyId],
  );
  return result.rows.map((row) => ({
    revision: Number(row.revision),
    status: String(row.status),
    studyRevision: Number(row.study_revision),
    evaluationVersion: String(row.evaluation_version),
    ...(row.generated_at ? { generatedAt: String(row.generated_at) } : {}),
  }));
}

/**
 * Teacher review. The review is appended as a new report version so the AI
 * report it reviewed remains retrievable, and the current row is pointed at
 * the reviewed document.
 */
export async function reviewInquiryReport(
  db: InquiryDb,
  input: {
    studyId: string;
    reviewer: string;
    status: Extract<ReportReviewStatus, 'approved' | 'needs_revision'>;
    comment?: string;
    reviewedAt: string;
  },
): Promise<StoredReport> {
  return db.transaction(async (tx) => {
    await lockStudy(tx, input.studyId, undefined);
    const current = await tx.query(
      `SELECT revision, status, document, study_revision, evaluation_version
       FROM inquiry_reports WHERE study_id = $1`,
      [input.studyId],
    );
    const row = current.rows[0];
    if (!row) throw new InquiryStoreError('NOT_FOUND', 'this study has no report yet');
    const document = readJson<InquiryReportDocument>(row.document);
    if (!document) throw new InquiryStoreError('INVALID_PAYLOAD', 'stored report is unreadable');
    const updated: InquiryReportDocument = {
      ...document,
      status: input.status === 'approved' ? 'teacher_reviewed' : 'needs_revision',
      review: {
        status: input.status,
        reviewer: input.reviewer,
        reviewedAt: input.reviewedAt,
        ...(input.comment ? { comment: input.comment } : {}),
      },
    };
    const revision = await nextRevision(tx, input.studyId);
    await writeReport(tx, input.studyId, revision, updated);
    return {
      studyId: input.studyId,
      revision,
      status: updated.status,
      document: updated,
      studyRevision: updated.studyRevision,
      evaluationVersion: updated.evaluationVersion,
    };
  });
}
