/**
 * Query projections over the inquiry event log (plan §七).
 *
 * The authority is `inquiry_events`: `inquiry_experiments` and
 * `inquiry_evaluations` are derived tables, rewritten from the folded state
 * inside the same transaction as every command. `rebuildInquiryProjectionsFromEvents`
 * replays the log and rewrites both tables, which is what the tests use to
 * prove the projection is reproducible and never a second source of truth.
 */
import { createInquirySessionState, foldInquiryEvents } from '@/lib/inquiry/domain/state';
import type { InquiryEvent } from '@/lib/inquiry/domain/events';
import type { InquirySessionState, InquiryTask } from '@/lib/inquiry/domain/types';

import type { InquiryDb, InquiryQueryable } from './db';

export interface ProjectionCounts {
  experiments: number;
  evaluations: number;
}

/** Rewrite both projections for one study from the given (derived) state. */
export async function rebuildInquiryProjections(
  tx: InquiryQueryable,
  studyId: string,
  state: InquirySessionState,
): Promise<ProjectionCounts> {
  await tx.query(`DELETE FROM inquiry_experiments WHERE study_id = $1`, [studyId]);
  await tx.query(`DELETE FROM inquiry_evaluations WHERE study_id = $1`, [studyId]);

  let experiments = 0;
  let evaluations = 0;

  for (const phase of Object.values(state.collected)) {
    for (const experiment of phase.experiments) {
      await tx.query(
        `INSERT INTO inquiry_experiments
           (id, study_id, trial_no, material_id, liquid_id, source, params, result, derived_from, superseded)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
        [
          experiment.id,
          studyId,
          experiment.trialNo,
          experiment.materialId,
          experiment.liquidId,
          experiment.source,
          JSON.stringify({
            ...(experiment.studentPrediction
              ? { studentPrediction: experiment.studentPrediction }
              : {}),
            ...(experiment.note ? { note: experiment.note } : {}),
            ...(experiment.recordedAt ? { recordedAt: experiment.recordedAt } : {}),
            ...(experiment.phaseRevision !== undefined
              ? { phaseRevision: experiment.phaseRevision }
              : {}),
            ...(experiment.designSnapshot ? { designSnapshot: experiment.designSnapshot } : {}),
          }),
          JSON.stringify(experiment.result),
          experiment.derivedFrom ? JSON.stringify(experiment.derivedFrom) : null,
          experiment.superseded,
        ],
      );
      experiments += 1;
    }

    for (const evaluation of phase.evaluations) {
      await tx.query(
        `INSERT INTO inquiry_evaluations
           (id, study_id, phase, kind, rubric, verdict, evidence_refs, derived_from, superseded)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
        [
          evaluation.id,
          studyId,
          evaluation.phaseId,
          evaluation.kind,
          null,
          JSON.stringify(evaluation.verdict),
          evaluation.submissionId ? JSON.stringify({ submissionId: evaluation.submissionId }) : null,
          JSON.stringify({
            phaseRevision: evaluation.phaseRevision,
            submissionId: evaluation.submissionId,
          }),
          evaluation.superseded,
        ],
      );
      evaluations += 1;
    }
  }

  return { experiments, evaluations };
}

/**
 * Rebuild both projections purely from the event log. This is the recovery
 * path (and the projection-consistency test): the stored state is not read.
 */
export async function rebuildInquiryProjectionsFromEvents(
  db: InquiryDb,
  studyId: string,
  ownerId: string,
): Promise<ProjectionCounts> {
  return db.transaction(async (tx) => {
    const studyRow = await tx.query(
      `SELECT task_id FROM inquiry_studies WHERE id = $1 AND owner_id = $2`,
      [studyId, ownerId],
    );
    if (!studyRow.rows[0]) throw new Error('study not found');
    const taskRow = await tx.query(`SELECT definition FROM inquiry_tasks WHERE id = $1`, [
      studyRow.rows[0].task_id,
    ]);
    const task = readJson<InquiryTask>(taskRow.rows[0]?.definition);
    if (!task) throw new Error('task definition missing');

    const eventRows = await tx.query(
      `SELECT event FROM inquiry_events WHERE study_id = $1 ORDER BY sequence`,
      [studyId],
    );
    const events = eventRows.rows
      .map((row) => readJson<InquiryEvent>(row.event))
      .filter((event): event is InquiryEvent => event !== null);
    const state = foldInquiryEvents(createInquirySessionState(task), events);
    return rebuildInquiryProjections(tx, studyId, state);
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
