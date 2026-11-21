import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createInquiryStudy, loadInquiryStudy } from '@/lib/inquiry/server/store';
import {
  isTeacherRequestAuthorized,
  listStudiesForTeacher,
  listTasksForTeacher,
  reviewInquiryTask,
  teacherAccessConfigured,
} from '@/lib/inquiry/server/teacher';
import { teacherGuard } from '@/lib/inquiry/server/teacher-http';
import { createStoreHarness, type StoreHarness } from './_store-harness';

let harness: StoreHarness;
const OWNER = 'owner-a';

beforeEach(async () => {
  harness = await createStoreHarness();
  vi.stubEnv('INQUIRY_TEACHER_TOKEN', 'secret-teacher-token');
});

afterEach(async () => {
  vi.unstubAllEnvs();
  await harness.close();
});

function requestWith(headers: Record<string, string> = {}): Request {
  return new Request('http://localhost/api/inquiry/teacher/studies', { headers });
}

describe('teacher access', () => {
  it('requires the configured token in constant-time-safe form', () => {
    expect(teacherAccessConfigured()).toBe(true);
    expect(isTeacherRequestAuthorized(requestWith({ Authorization: 'Bearer secret-teacher-token' }))).toBe(true);
    expect(isTeacherRequestAuthorized(requestWith({ 'x-inquiry-teacher-token': 'secret-teacher-token' }))).toBe(true);
    expect(isTeacherRequestAuthorized(requestWith({ Authorization: 'Bearer wrong' }))).toBe(false);
    expect(isTeacherRequestAuthorized(requestWith())).toBe(false);
  });

  it('is disabled entirely when no token is configured', () => {
    vi.stubEnv('INQUIRY_TEACHER_TOKEN', '');
    expect(teacherAccessConfigured()).toBe(false);
    const guard = teacherGuard(requestWith({ Authorization: 'Bearer anything' }));
    expect(guard?.status).toBe(404);
  });

  it('rejects an unauthorized request with 401', () => {
    const guard = teacherGuard(requestWith({ Authorization: 'Bearer wrong' }));
    expect(guard?.status).toBe(401);
    expect(teacherGuard(requestWith({ Authorization: 'Bearer secret-teacher-token' }))).toBeNull();
  });

  it('lists studies with the anonymous learner key only', async () => {
    await createInquiryStudy(harness.db, {
      ownerId: OWNER,
      taskKey: 'float-sink',
      commandId: 'create-1',
    });
    const studies = await listStudiesForTeacher(harness.db);
    expect(studies).toHaveLength(1);
    expect(studies[0]).toMatchObject({
      learnerKey: OWNER,
      taskName: '影响物体在水中沉浮的因素',
      status: 'waiting_for_student',
    });
    expect(JSON.stringify(studies)).not.toContain('owner_id');
  });
});

describe('task review and publish', () => {
  it('starts unpublished with no review', async () => {
    const tasks = await listTasksForTeacher(harness.db);
    expect(tasks).toHaveLength(1);
    expect(tasks[0]).toMatchObject({ key: 'float-sink', published: false, review: null });
  });

  it('refuses to publish until all three reviews are approved', async () => {
    await expect(
      reviewInquiryTask(harness.db, {
        key: 'float-sink',
        reviewer: '王老师',
        science: { status: 'approved' },
        safety: { status: 'pending' },
        age: { status: 'approved' },
        publish: true,
        reviewedAt: '2026-11-20T12:00:00.000Z',
      }),
    ).rejects.toMatchObject({ code: 'INVALID_PAYLOAD' });
    const task = (await listTasksForTeacher(harness.db))[0]!;
    expect(task.published).toBe(false);
    expect(task.review).toBeNull();
  });

  it('records a reviewer and publishes when all three pass', async () => {
    const task = await reviewInquiryTask(harness.db, {
      key: 'float-sink',
      reviewer: '王老师',
      science: { status: 'approved', note: '与教材一致' },
      safety: { status: 'approved' },
      age: { status: 'approved' },
      publish: true,
      reviewedAt: '2026-11-20T12:00:00.000Z',
    });
    expect(task.published).toBe(true);
    expect(task.review).toMatchObject({
      reviewer: '王老师',
      reviewedAt: '2026-11-20T12:00:00.000Z',
      science: { status: 'approved', note: '与教材一致' },
      safety: { status: 'approved' },
      age: { status: 'approved' },
    });
    const rows = await harness.db.query(`SELECT published, review FROM inquiry_tasks WHERE key = $1`, [
      'float-sink',
    ]);
    expect(rows.rows[0]?.published).toBe(true);
  });

  it('leaves an already published task untouched when a later review is invalid', async () => {
    await reviewInquiryTask(harness.db, {
      key: 'float-sink',
      reviewer: '王老师',
      science: { status: 'approved' },
      safety: { status: 'approved' },
      age: { status: 'approved' },
      publish: true,
    });
    await expect(
      reviewInquiryTask(harness.db, {
        key: 'float-sink',
        reviewer: '王老师',
        science: { status: 'approved' },
        safety: { status: 'rejected' },
        age: { status: 'approved' },
        publish: true,
      }),
    ).rejects.toMatchObject({ code: 'INVALID_PAYLOAD' });
    expect((await listTasksForTeacher(harness.db))[0]!.published).toBe(true);
  });

  it('requires a reviewer and a known task', async () => {
    await expect(
      reviewInquiryTask(harness.db, {
        key: 'float-sink',
        reviewer: '   ',
        science: { status: 'approved' },
        safety: { status: 'approved' },
        age: { status: 'approved' },
        publish: false,
      }),
    ).rejects.toMatchObject({ code: 'INVALID_PAYLOAD' });
    await expect(
      reviewInquiryTask(harness.db, {
        key: 'no-such-task',
        reviewer: '王老师',
        science: { status: 'approved' },
        safety: { status: 'approved' },
        age: { status: 'approved' },
        publish: false,
      }),
    ).rejects.toMatchObject({ code: 'TASK_NOT_FOUND' });
  });

  it('does not let a study change task publish state', async () => {
    await createInquiryStudy(harness.db, {
      ownerId: OWNER,
      taskKey: 'float-sink',
      commandId: 'create-1',
    });
    const study = await loadInquiryStudy(
      harness.db,
      (await listStudiesForTeacher(harness.db))[0]!.id,
      OWNER,
    );
    expect(study).not.toBeNull();
    expect((await listTasksForTeacher(harness.db))[0]!.published).toBe(false);
  });
});
