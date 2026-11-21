import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { compileTask } from '@/lib/inquiry/generation/compile-task';
import { listTasksForTeacher } from '@/lib/inquiry/server/teacher';
import {
  confirmDraftStudy,
  getTaskDraft,
  listInquiryTasks,
  loadInquiryStudy,
  saveTaskDraft,
} from '@/lib/inquiry/server/store';

import { observationDraft } from './_generation-fixtures';
import { createStoreHarness, type StoreHarness } from './_store-harness';

const TASK = compileTask(observationDraft());

describe('task drafts and personal tasks', () => {
  let harness: StoreHarness;

  beforeEach(async () => {
    harness = await createStoreHarness();
  });

  afterEach(async () => {
    await harness.close();
  });

  async function createDraft(ownerId = 'anon:student-1') {
    return saveTaskDraft(harness.db, {
      ownerId,
      originalQuestion: '植物为什么向着太阳生长？',
      refinedQuestion: '放在窗边的绿豆苗会朝什么方向生长？',
      definition: TASK,
    });
  }

  it('stores a new draft at version 1 and reloads it for its owner', async () => {
    const draft = await createDraft();
    expect(draft.version).toBe(1);
    expect(draft.status).toBe('draft');
    const loaded = await getTaskDraft(harness.db, draft.id, 'anon:student-1');
    expect(loaded?.definition.name).toBe('植物向着太阳生长');
    expect(loaded?.definition.phases).toHaveLength(6);
  });

  it('regeneration bumps the version of the same draft', async () => {
    const draft = await createDraft();
    const bumped = await saveTaskDraft(harness.db, {
      ownerId: 'anon:student-1',
      draftId: draft.id,
      originalQuestion: draft.originalQuestion,
      refinedQuestion: draft.refinedQuestion ?? '',
      definition: { ...TASK, name: '植物向光生长（第二版）' },
      feedback: '材料少一点',
    });
    expect(bumped.id).toBe(draft.id);
    expect(bumped.version).toBe(2);
    const loaded = await getTaskDraft(harness.db, draft.id, 'anon:student-1');
    expect(loaded?.definition.name).toBe('植物向光生长（第二版）');
  });

  it('isolates drafts between owners', async () => {
    const draft = await createDraft();
    expect(await getTaskDraft(harness.db, draft.id, 'anon:student-2')).toBeNull();
  });

  it('confirming creates a personal task plus a study; repeats are idempotent', async () => {
    const draft = await createDraft();
    const first = await confirmDraftStudy(harness.db, {
      draftId: draft.id,
      ownerId: 'anon:student-1',
      commandId: 'confirm-1',
    });
    expect(first.replayed).toBe(false);
    expect(first.study.task.phases).toHaveLength(6);
    expect(first.study.task.ownerId).toBe('anon:student-1');
    expect(first.study.task.key).toMatch(/^gen-/);

    // Same command id replays the same study.
    const replay = await confirmDraftStudy(harness.db, {
      draftId: draft.id,
      ownerId: 'anon:student-1',
      commandId: 'confirm-1',
    });
    expect(replay.study.id).toBe(first.study.id);

    // A different command id after confirmation still returns the same study.
    const again = await confirmDraftStudy(harness.db, {
      draftId: draft.id,
      ownerId: 'anon:student-1',
      commandId: 'confirm-2',
    });
    expect(again.study.id).toBe(first.study.id);
    expect(again.replayed).toBe(true);

    // Regenerating a confirmed draft is refused.
    await expect(
      saveTaskDraft(harness.db, {
        ownerId: 'anon:student-1',
        draftId: draft.id,
        originalQuestion: draft.originalQuestion,
        refinedQuestion: draft.refinedQuestion ?? '',
        definition: TASK,
      }),
    ).rejects.toMatchObject({ code: 'CONFLICT' });
  });

  it('another owner cannot confirm the draft', async () => {
    const draft = await createDraft();
    await expect(
      confirmDraftStudy(harness.db, {
        draftId: draft.id,
        ownerId: 'anon:student-2',
        commandId: 'confirm-x',
      }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('the study survives a reload with its task snapshot', async () => {
    const draft = await createDraft();
    const outcome = await confirmDraftStudy(harness.db, {
      draftId: draft.id,
      ownerId: 'anon:student-1',
      commandId: 'confirm-1',
    });
    const loaded = await loadInquiryStudy(harness.db, outcome.study.id, 'anon:student-1');
    expect(loaded?.task.name).toBe('植物向着太阳生长');
    expect(loaded?.task.phases[3]?.experiment).toBeUndefined();
    expect(loaded?.state.position.phaseId).toBe('question');
  });

  it('personal tasks never appear in the shared student task list', async () => {
    const draft = await createDraft();
    await confirmDraftStudy(harness.db, {
      draftId: draft.id,
      ownerId: 'anon:student-1',
      commandId: 'confirm-1',
    });
    const list = await listInquiryTasks(harness.db);
    expect(list.every((task) => !task.key.startsWith('gen-'))).toBe(true);
    expect(list.some((task) => task.key === 'float-sink')).toBe(true);
  });

  it('personal tasks never appear in the teacher review list', async () => {
    const draft = await createDraft();
    await confirmDraftStudy(harness.db, {
      draftId: draft.id,
      ownerId: 'anon:student-1',
      commandId: 'confirm-1',
    });
    const teacherTasks = await listTasksForTeacher(harness.db);
    expect(teacherTasks.every((task) => !task.key.startsWith('gen-'))).toBe(true);
  });
});
