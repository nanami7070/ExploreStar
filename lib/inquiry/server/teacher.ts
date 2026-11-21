/**
 * Teacher-only reads and the task review/publish workflow.
 *
 * Every caller must first pass `isTeacherRequestAuthorized`. Students never
 * reach these functions: their API is owner-scoped and has no listing.
 */
import { timingSafeEqual } from 'node:crypto';

import type { InquiryDb, InquiryQueryable } from './db';
import { InquiryStoreError } from './store';

export type TaskReviewStatus = 'pending' | 'approved' | 'rejected';

export interface TaskReview {
  reviewer: string;
  reviewedAt: string;
  science: { status: TaskReviewStatus; note?: string };
  safety: { status: TaskReviewStatus; note?: string };
  age: { status: TaskReviewStatus; note?: string };
}

export interface TeacherStudySummary {
  id: string;
  taskKey: string;
  taskName: string;
  learnerKey: string;
  status: string;
  revision: number;
  createdAt?: string;
  updatedAt?: string;
  reportRevision?: number;
  reportStatus?: string;
}

export interface TeacherTaskSummary {
  id: string;
  key: string;
  name: string;
  grade: string;
  version: string;
  published: boolean;
  review: TaskReview | null;
}

const TEACHER_TOKEN_ENV = 'INQUIRY_TEACHER_TOKEN';

/** The teacher surface is off unless an operator configures a token. */
export function teacherAccessConfigured(env: NodeJS.ProcessEnv = process.env): boolean {
  return Boolean(env[TEACHER_TOKEN_ENV]?.trim());
}

/**
 * Constant-time token comparison. A missing or empty configured token never
 * authorizes; a missing/incorrect request token never authorizes.
 */
export function isTeacherRequestAuthorized(
  req: Request,
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  const expected = env[TEACHER_TOKEN_ENV]?.trim();
  if (!expected) return false;
  const header = req.headers.get('authorization') ?? '';
  const bearer = header.toLowerCase().startsWith('bearer ') ? header.slice(7).trim() : '';
  const provided = bearer || (req.headers.get('x-inquiry-teacher-token') ?? '').trim();
  if (!provided) return false;
  const expectedBuffer = Buffer.from(expected, 'utf8');
  const providedBuffer = Buffer.from(provided, 'utf8');
  if (expectedBuffer.length !== providedBuffer.length) return false;
  return timingSafeEqual(expectedBuffer, providedBuffer);
}

export async function listStudiesForTeacher(
  db: InquiryQueryable,
  limit = 100,
): Promise<TeacherStudySummary[]> {
  const result = await db.query(
    `SELECT s.id, s.learner_key, s.status, s.revision, s.created_at, s.updated_at,
            t.key AS task_key, t.name AS task_name,
            r.revision AS report_revision, r.status AS report_status
     FROM inquiry_studies s
     JOIN inquiry_tasks t ON t.id = s.task_id
     LEFT JOIN inquiry_reports r ON r.study_id = s.id
     ORDER BY s.updated_at DESC
     LIMIT $1`,
    [Math.max(1, Math.min(500, limit))],
  );
  return result.rows.map((row) => ({
    id: String(row.id),
    taskKey: String(row.task_key),
    taskName: String(row.task_name),
    learnerKey: String(row.learner_key),
    status: String(row.status),
    revision: Number(row.revision),
    ...(row.created_at ? { createdAt: String(row.created_at) } : {}),
    ...(row.updated_at ? { updatedAt: String(row.updated_at) } : {}),
    ...(row.report_revision !== null && row.report_revision !== undefined
      ? { reportRevision: Number(row.report_revision) }
      : {}),
    ...(row.report_status ? { reportStatus: String(row.report_status) } : {}),
  }));
}

export async function listTasksForTeacher(
  db: InquiryQueryable,
): Promise<TeacherTaskSummary[]> {
  const result = await db.query(
    // Personal (AI-generated) tasks are not part of the review workflow.
    `SELECT id, key, name, grade, version, published, review FROM inquiry_tasks
     WHERE owner_id IS NULL ORDER BY created_at, key`,
  );
  return result.rows.map((row) => ({
    id: String(row.id),
    key: String(row.key),
    name: String(row.name),
    grade: String(row.grade),
    version: String(row.version),
    published: row.published === true,
    review: readJson<TaskReview>(row.review),
  }));
}

export interface ReviewTaskInput {
  key: string;
  reviewer: string;
  science: { status: TaskReviewStatus; note?: string };
  safety: { status: TaskReviewStatus; note?: string };
  age: { status: TaskReviewStatus; note?: string };
  publish: boolean;
  reviewedAt?: string;
}

/**
 * Record the three review verdicts. Publishing requires all three approved;
 * the AI and the task config can never publish themselves.
 */
export async function reviewInquiryTask(
  db: InquiryDb,
  input: ReviewTaskInput,
): Promise<TeacherTaskSummary> {
  const reviewer = input.reviewer.trim();
  if (!reviewer) {
    throw new InquiryStoreError('INVALID_PAYLOAD', 'a reviewer name is required');
  }
  const allowed: TaskReviewStatus[] = ['pending', 'approved', 'rejected'];
  for (const [label, entry] of [
    ['science', input.science],
    ['safety', input.safety],
    ['age', input.age],
  ] as const) {
    if (!entry || !allowed.includes(entry.status)) {
      throw new InquiryStoreError('INVALID_PAYLOAD', `invalid ${label} review status`);
    }
  }
  const allApproved =
    input.science.status === 'approved' &&
    input.safety.status === 'approved' &&
    input.age.status === 'approved';
  if (input.publish && !allApproved) {
    throw new InquiryStoreError(
      'INVALID_PAYLOAD',
      'a task can be published only after science, safety and age reviews are all approved',
    );
  }

  return db.transaction(async (tx) => {
    const existing = await tx.query(
      `SELECT published FROM inquiry_tasks WHERE key = $1 FOR UPDATE`,
      [input.key],
    );
    if (!existing.rows[0]) throw new InquiryStoreError('TASK_NOT_FOUND', 'unknown task');
    const review: TaskReview = {
      reviewer,
      reviewedAt: input.reviewedAt ?? new Date().toISOString(),
      science: input.science,
      safety: input.safety,
      age: input.age,
    };
    const published = input.publish && allApproved;
    await tx.query(
      `UPDATE inquiry_tasks SET review = $2, published = $3, updated_at = now() WHERE key = $1`,
      [input.key, JSON.stringify(review), published],
    );
    const row = await tx.query(
      `SELECT id, key, name, grade, version, published, review FROM inquiry_tasks WHERE key = $1`,
      [input.key],
    );
    const updated = row.rows[0]!;
    return {
      id: String(updated.id),
      key: String(updated.key),
      name: String(updated.name),
      grade: String(updated.grade),
      version: String(updated.version),
      published: updated.published === true,
      review: readJson<TaskReview>(updated.review),
    };
  });
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
