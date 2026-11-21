import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { InquiryStudyAction } from '@/lib/inquiry/actions';
import { collectEvidence } from '@/lib/inquiry/evaluation/rules';
import type { SemanticEvaluator } from '@/lib/inquiry/evaluation/semantic';
import { generateInquiryReport } from '@/lib/inquiry/server/report-service';
import {
  listReportVersions,
  loadCurrentReport,
  reviewInquiryReport,
} from '@/lib/inquiry/server/reports';
import {
  applyInquiryStudyAction,
  createInquiryStudy,
  loadInquiryStudy,
} from '@/lib/inquiry/server/store';
import { DESIGN, QUESTION, REFLECTION, TASK } from './_helpers';
import { createStoreHarness, type StoreHarness } from './_store-harness';

let harness: StoreHarness;
const OWNER = 'owner-a';
const GENERATED_AT = '2026-11-20T12:00:00.000Z';

beforeEach(async () => {
  harness = await createStoreHarness();
});

afterEach(async () => {
  await harness.close();
});

async function completedStudy() {
  const { study } = await createInquiryStudy(harness.db, {
    ownerId: OWNER,
    taskKey: 'float-sink',
    commandId: 'create-1',
  });
  const actions: InquiryStudyAction[] = [
    { action: 'submit', content: QUESTION },
    { action: 'next' },
    { action: 'submit', content: { text: '我觉得石头会浮起来。', reason: '石头看起来不重' } },
    { action: 'next' },
    { action: 'submit', content: DESIGN },
    { action: 'next' },
    {
      action: 'recordExperiment',
      materialId: 'stone-block',
      liquidId: 'water',
      source: 'sim',
      studentPrediction: 'float',
      note: '石头沉下去了',
    },
    { action: 'next' },
    { action: 'revert', targetPhaseIndex: 1 },
    {
      action: 'submit',
      content: { text: '我改变想法：石块是实心的，可能比较重。', reason: '摸起来很沉' },
    },
    { action: 'next' },
    { action: 'confirmSubmission' },
    { action: 'next' },
    {
      action: 'recordExperiment',
      materialId: 'stone-block',
      liquidId: 'water',
      source: 'sim',
      studentPrediction: 'float',
      note: '第二次还是沉下去',
    },
    {
      action: 'recordExperiment',
      materialId: 'stone-block',
      liquidId: 'salt-water',
      source: 'sim',
      studentPrediction: 'sink',
      note: '换成盐水也沉下去',
    },
    { action: 'next' },
    { action: 'submit', content: { text: '我发现石块在清水里沉下去，因为第 2 次实验也一样。' } },
    { action: 'next' },
    { action: 'submit', content: REFLECTION },
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
  const loaded = await loadInquiryStudy(harness.db, study.id, OWNER);
  expect(loaded?.state.status).toBe('completed');
  return loaded!;
}

const semantic: SemanticEvaluator = async (input) => {
  const question = input.evidence.find(
    (item) => item.kind === 'submission' && item.phaseId === 'question',
  );
  return {
    dimensions: question
      ? [
          {
            dimension: 'question',
            status: 'evaluated',
            level: 4,
            basis: ['问题可以动手探究'],
            suggestions: [],
            evidenceRefs: [
              { id: question.id, kind: question.kind, phaseId: question.phaseId, quote: question.quote },
            ],
          },
        ]
      : [],
  };
};

describe('learning report', () => {
  it('builds a complete, evidence-cited report from the effective records', async () => {
    const study = await completedStudy();
    const { report } = await generateInquiryReport(harness.db, {
      studyId: study.id,
      ownerId: OWNER,
      semantic,
      generatedAt: GENERATED_AT,
    });
    const document = report.document;

    expect(document.status).toBe('ai_generated');
    expect(document.review.status).toBe('pending');
    expect(document.studyRevision).toBe(study.revision);
    expect(document.task.key).toBe('float-sink');
    expect(document.learnerKey).toBe(OWNER);
    expect(document.dimensions).toHaveLength(6);
    expect(document.timeline.length).toBeGreaterThan(0);

    // Hypothesis revisions and superseded trials are separated from current data.
    expect(document.hypotheses.submissions).toHaveLength(2);
    expect(document.hypotheses.submissions[1]!.active).toBe(true);
    expect(document.experiments.active).toHaveLength(2);
    expect(document.experiments.superseded).toHaveLength(1);
    expect(document.revisions.hypothesisRevised).toBe(true);
    expect(document.revisions.evidenceRepeated).toBe(true);

    // Every dimension carries evidence refs that point at real active records.
    const activeIds = new Set(collectEvidence(TASK, study.state).active.map((item) => item.id));
    for (const dimension of document.dimensions) {
      expect(dimension.status).toBe('evaluated');
      expect(dimension.level).not.toBeNull();
      expect(dimension.evidenceRefs.length).toBeGreaterThan(0);
      for (const ref of dimension.evidenceRefs) expect(activeIds.has(ref.id)).toBe(true);
      if (dimension.ruleCap !== null && dimension.level !== null) {
        expect(dimension.level).toBeLessThanOrEqual(dimension.ruleCap);
      }
    }
    const question = document.dimensions.find((dimension) => dimension.dimension === 'question')!;
    expect(question.source).toBe('rules+semantic');
    expect(question.level).toBe(3); // semantic 4 capped at the rule ceiling

    const current = await loadCurrentReport(harness.db, study.id, OWNER);
    expect(current?.revision).toBe(1);
    expect(current?.stale).toBe(false);
  });

  it('labels a rules-only report when semantic evaluation is unavailable', async () => {
    const study = await completedStudy();
    const { report } = await generateInquiryReport(harness.db, {
      studyId: study.id,
      ownerId: OWNER,
      semantic: null,
      generatedAt: GENERATED_AT,
    });
    expect(report.document.meta.semanticStatus).toBe('skipped');
    expect(report.document.meta.notes.join('')).toContain('只包含规则评价');
    expect(report.document.dimensions.every((dimension) => dimension.source === 'rules')).toBe(true);
  });

  it('appends versions on regeneration and keeps the old document', async () => {
    const study = await completedStudy();
    const first = await generateInquiryReport(harness.db, {
      studyId: study.id,
      ownerId: OWNER,
      semantic,
      generatedAt: GENERATED_AT,
    });
    const second = await generateInquiryReport(harness.db, {
      studyId: study.id,
      ownerId: OWNER,
      semantic,
      generatedAt: GENERATED_AT,
    });
    expect(first.report.revision).toBe(1);
    expect(second.report.revision).toBe(2);
    expect(second.report.document).toEqual(first.report.document);

    const versions = await listReportVersions(harness.db, study.id, OWNER);
    expect(versions.map((version) => version.revision)).toEqual([2, 1]);
    const versionOne = await harness.db.query(
      `SELECT status, document FROM inquiry_report_versions WHERE study_id = $1 AND revision = 1`,
      [study.id],
    );
    expect(versionOne.rows[0]?.status).toBe('ai_generated');
  });

  it('treats a report whose study changed afterwards as stale', async () => {
    const study = await completedStudy();
    await generateInquiryReport(harness.db, {
      studyId: study.id,
      ownerId: OWNER,
      generatedAt: GENERATED_AT,
    });
    await harness.db.query(`UPDATE inquiry_studies SET revision = revision + 1 WHERE id = $1`, [
      study.id,
    ]);
    const current = await loadCurrentReport(harness.db, study.id, OWNER);
    expect(current?.stale).toBe(true);
    expect(current?.currentStudyRevision).toBe(study.revision + 1);
  });

  it('records a teacher review as a new version, preserving the AI report', async () => {
    const study = await completedStudy();
    await generateInquiryReport(harness.db, {
      studyId: study.id,
      ownerId: OWNER,
      semantic,
      generatedAt: GENERATED_AT,
    });
    const reviewed = await reviewInquiryReport(harness.db, {
      studyId: study.id,
      reviewer: '王老师',
      status: 'approved',
      comment: '记录完整',
      reviewedAt: GENERATED_AT,
    });
    expect(reviewed.revision).toBe(2);
    expect(reviewed.document.status).toBe('teacher_reviewed');
    expect(reviewed.document.review).toMatchObject({
      status: 'approved',
      reviewer: '王老师',
      comment: '记录完整',
    });
    const versions = await listReportVersions(harness.db, study.id, OWNER);
    expect(versions.map((version) => version.revision)).toEqual([2, 1]);
    expect(versions[1]!.status).toBe('ai_generated');
  });

  it('keeps reports owner-scoped while teacher reads have no owner filter', async () => {
    const study = await completedStudy();
    await generateInquiryReport(harness.db, {
      studyId: study.id,
      ownerId: OWNER,
      generatedAt: GENERATED_AT,
    });
    expect(await loadCurrentReport(harness.db, study.id, 'someone-else')).toBeNull();
    const teacherView = await loadCurrentReport(harness.db, study.id);
    expect(teacherView?.document.task.key).toBe('float-sink');
  });

  it('refuses to generate a report before the inquiry is completed', async () => {
    const { study } = await createInquiryStudy(harness.db, {
      ownerId: OWNER,
      taskKey: 'float-sink',
      commandId: 'create-early',
    });
    await expect(
      generateInquiryReport(harness.db, { studyId: study.id, ownerId: OWNER }),
    ).rejects.toMatchObject({ code: 'REPORT_NOT_READY' });
  });
});
