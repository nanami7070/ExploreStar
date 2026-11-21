import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { InquiryStudyAction } from '@/lib/inquiry/actions';
import { rebuildInquiryProjectionsFromEvents } from '@/lib/inquiry/server/projections';
import {
  applyInquiryStudyAction,
  createInquiryStudy,
  loadInquiryStudy,
} from '@/lib/inquiry/server/store';
import { DESIGN, QUESTION } from './_helpers';
import { createStoreHarness, type StoreHarness } from './_store-harness';

let harness: StoreHarness;
const OWNER = 'owner-a';

beforeEach(async () => {
  harness = await createStoreHarness();
});

afterEach(async () => {
  await harness.close();
});

function readJson<T>(value: unknown): T {
  return typeof value === 'string' ? (JSON.parse(value) as T) : (value as T);
}

async function rows(studyId: string) {
  const experiments = await harness.db.query(
    `SELECT id, source, params, result, superseded FROM inquiry_experiments WHERE study_id = $1 ORDER BY id`,
    [studyId],
  );
  const evaluations = await harness.db.query(
    `SELECT id, phase, superseded FROM inquiry_evaluations WHERE study_id = $1 ORDER BY id`,
    [studyId],
  );
  return {
    experiments: experiments.rows.map((row) => ({
      id: row.id,
      source: row.source,
      params: readJson<Record<string, unknown>>(row.params),
      result: readJson<Record<string, unknown>>(row.result),
      superseded: row.superseded,
    })),
    evaluations: evaluations.rows.map((row) => ({
      id: row.id,
      phase: row.phase,
      superseded: row.superseded,
    })),
  };
}

async function runFlow(creationCommand = 'create-1'): Promise<string> {
  const { study } = await createInquiryStudy(harness.db, {
    ownerId: OWNER,
    taskKey: 'float-sink',
    commandId: creationCommand,
  });
  const actions: InquiryStudyAction[] = [
    { action: 'submit', content: QUESTION },
    { action: 'next' },
    { action: 'submit', content: { text: '我觉得木块会浮起来。' } },
    { action: 'next' },
    { action: 'submit', content: DESIGN },
    { action: 'next' },
    {
      action: 'recordExperiment',
      materialId: 'wood-block',
      liquidId: 'water',
      source: 'sim',
      studentPrediction: 'sink',
      note: '我猜错了，木块浮起来了',
    },
    { action: 'next' },
    { action: 'revert', targetPhaseIndex: 2 },
    { action: 'confirmSubmission' },
    { action: 'next' },
  ];
  let revision = 1;
  for (const [index, action] of actions.entries()) {
    const outcome = await applyInquiryStudyAction(harness.db, {
      studyId: study.id,
      ownerId: OWNER,
      commandId: `step-${index}`,
      expectedRevision: revision,
      action,
    });
    revision = outcome.study.revision;
  }
  return study.id;
}

describe('inquiry projections', () => {
  it('projects experiments and evaluations from the folded state', async () => {
    const studyId = await runFlow();
    const projected = await rows(studyId);
    const study = await loadInquiryStudy(harness.db, studyId, OWNER);

    const expectedExperiments = Object.values(study!.state.collected)
      .flatMap((phase) => phase.experiments)
      .map((experiment) => experiment.id)
      .sort();
    expect(projected.experiments.map((row) => row.id)).toEqual(expectedExperiments);

    const trial = projected.experiments[0]!;
    expect(trial.params.studentPrediction).toBe('sink');
    expect(trial.params.note).toBe('我猜错了，木块浮起来了');
    expect(trial.params.phaseRevision).toBe(0);
    expect(trial.result).toMatchObject({ predicted: 'float', observed: 'float' });
    // The revert to the design invalidated the trial.
    expect(trial.superseded).toBe(true);

    const expectedEvaluations = Object.values(study!.state.collected)
      .flatMap((phase) => phase.evaluations)
      .map((evaluation) => evaluation.id)
      .sort();
    expect(projected.evaluations.map((row) => row.id)).toEqual(expectedEvaluations);
    // The reverted-to design keeps its earlier suggestions as history (the
    // submission may be re-confirmed) and gains fresh completion-time
    // suggestions for the new revision; downstream evidence is superseded.
    const designRows = projected.evaluations.filter(
      (row) => row.phase === 'experiment-design',
    );
    expect(designRows.length).toBeGreaterThan(0);
    expect(designRows.every((row) => !row.superseded)).toBe(true);
    const evidenceRows = projected.evaluations.filter((row) => row.phase === 'evidence');
    expect(evidenceRows.length).toBeGreaterThan(0);
    expect(evidenceRows.every((row) => row.superseded)).toBe(true);
  });

  it('rebuilds identical tables from the event log alone', async () => {
    const studyId = await runFlow();
    const before = await rows(studyId);
    expect(before.experiments.length).toBeGreaterThan(0);
    expect(before.evaluations.length).toBeGreaterThan(0);

    await harness.db.query(`DELETE FROM inquiry_experiments WHERE study_id = $1`, [studyId]);
    await harness.db.query(`DELETE FROM inquiry_evaluations WHERE study_id = $1`, [studyId]);
    expect((await rows(studyId)).experiments).toHaveLength(0);

    const counts = await rebuildInquiryProjectionsFromEvents(harness.db, studyId, OWNER);
    expect(counts).toEqual({
      experiments: before.experiments.length,
      evaluations: before.evaluations.length,
    });

    const after = await rows(studyId);
    expect(after).toEqual(before);
  });

  it('projects two studies that share deterministic evaluation ids', async () => {
    const first = await runFlow('create-a');
    const second = await runFlow('create-b');
    const rowsA = await rows(first);
    const rowsB = await rows(second);
    const deterministic = (batch: typeof rowsA) =>
      batch.evaluations
        .map((row) => String(row.id))
        .filter((id) => id.startsWith('complete:'))
        .sort();
    expect(deterministic(rowsA).length).toBeGreaterThan(0);
    // Completion-time soft checks use ids like `complete:evidence:r0:...`,
    // identical across studies; the projection key is scoped by study so both
    // rows can exist.
    expect(deterministic(rowsA)).toEqual(deterministic(rowsB));
  });

  it('rebuilds only for the owning student', async () => {
    const studyId = await runFlow();
    await expect(
      rebuildInquiryProjectionsFromEvents(harness.db, studyId, 'someone-else'),
    ).rejects.toThrow(/study not found/);
  });
});
