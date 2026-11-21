import { describe, expect, it } from 'vitest';

import { evaluateInquiry } from '@/lib/inquiry/evaluation/evaluate';
import {
  buildSemanticPrompt,
  parseSemanticEvaluation,
  type SemanticEvaluator,
} from '@/lib/inquiry/evaluation/semantic';
import type { EvidenceItem } from '@/lib/inquiry/evaluation/types';
import { collectEvidence } from '@/lib/inquiry/evaluation/rules';
import {
  ANALYSIS,
  DESIGN,
  HYPOTHESIS,
  QUESTION,
  REFLECTION,
  TASK,
  afterEvidence,
  startedSession,
} from './_helpers';

const EVIDENCE: EvidenceItem[] = [
  { id: 'sub-1', kind: 'submission', phaseId: 'question', quote: '为什么木块会浮？', active: true },
  { id: 'trial-1', kind: 'experiment', phaseId: 'evidence', quote: '木块 + 清水：浮起来', active: true },
];
const ALLOWED = new Map(EVIDENCE.map((item) => [item.id, item]));

describe('semantic evaluation parsing', () => {
  it('accepts cited evaluations from the whitelist', () => {
    const parsed = parseSemanticEvaluation(
      JSON.stringify({
        evaluations: [
          {
            dimension: 'question',
            status: 'evaluated',
            level: 3,
            basis: ['问题可以动手研究'],
            suggestions: ['再具体一点'],
            evidenceIds: ['sub-1'],
          },
        ],
      }),
      ALLOWED,
    );
    expect(parsed?.dimensions[0]).toMatchObject({
      dimension: 'question',
      status: 'evaluated',
      level: 3,
      evidenceRefs: [{ id: 'sub-1', quote: '为什么木块会浮？' }],
    });
  });

  it('drops unknown ids and downgrades an uncited evaluation', () => {
    const parsed = parseSemanticEvaluation(
      JSON.stringify({
        evaluations: [
          {
            dimension: 'hypothesis',
            status: 'evaluated',
            level: 4,
            evidenceIds: ['made-up-id'],
          },
        ],
      }),
      ALLOWED,
    );
    expect(parsed?.dimensions[0]).toMatchObject({
      status: 'insufficient_evidence',
      level: null,
      evidenceRefs: [],
    });
  });

  it('rejects invalid JSON, out-of-range levels and unknown types', () => {
    expect(parseSemanticEvaluation('not json', ALLOWED)).toBeNull();
    expect(
      parseSemanticEvaluation(
        JSON.stringify({
          evaluations: [{ dimension: 'question', status: 'evaluated', level: 9, evidenceIds: ['sub-1'] }],
        }),
        ALLOWED,
      ),
    ).toBeNull();
    expect(
      parseSemanticEvaluation(
        JSON.stringify({ evaluations: [{ dimension: 'boredom', status: 'evaluated', level: 3 }] }),
        ALLOWED,
      ),
    ).toBeNull();
  });

  it('keeps the first entry when a dimension is repeated', () => {
    const parsed = parseSemanticEvaluation(
      JSON.stringify({
        evaluations: [
          { dimension: 'question', status: 'evaluated', level: 2, evidenceIds: ['sub-1'] },
          { dimension: 'question', status: 'evaluated', level: 4, evidenceIds: ['sub-1'] },
        ],
      }),
      ALLOWED,
    );
    expect(parsed?.dimensions).toHaveLength(1);
    expect(parsed?.dimensions[0]!.level).toBe(2);
  });

  it('builds a prompt containing only the supplied evidence', () => {
    const driver = startedSession().submit('q-1', QUESTION);
    const evidence = collectEvidence(TASK, driver.state);
    const { prompt, system } = buildSemanticPrompt({
      task: TASK,
      state: driver.state,
      evidence: evidence.active,
    });
    expect(prompt).toContain('为什么木块能浮在水面上');
    expect(prompt).toContain('rubric');
    expect(system).toContain('insufficient_evidence');
  });
});

function completedDriver() {
  return startedSession()
    .submit('q-1', QUESTION)
    .complete()
    .submit('h-1', HYPOTHESIS)
    .complete()
    .submit('d-1', DESIGN)
    .complete()
    .experimentEvidence('t-1', 'stone-block', 'water', { prediction: 'float' })
    .experimentEvidence('t-2', 'wood-block', 'water', { prediction: 'float' })
    .complete()
    .submit('a-1', ANALYSIS)
    .complete()
    .submit('r-1', REFLECTION)
    .complete();
}

describe('merging rules and semantics', () => {
  it('caps the semantic level at the rule ceiling', async () => {
    const state = completedDriver().state;
    const semantic: SemanticEvaluator = async (input) => {
      const item = input.evidence.find(
        (candidate) => candidate.kind === 'submission' && candidate.phaseId === 'question',
      )!;
      return {
        dimensions: [
          {
            dimension: 'question',
            status: 'evaluated',
            level: 4,
            basis: ['模型认为很深入'],
            suggestions: [],
            evidenceRefs: [
              {
                id: item.id,
                kind: item.kind,
                phaseId: item.phaseId,
                quote: item.quote,
              },
            ],
          },
        ],
      };
    };
    const bundle = await evaluateInquiry({
      task: TASK,
      state,
      evaluationVersion: 'test-v1',
      semantic,
    });
    const question = bundle.dimensions.find((dimension) => dimension.dimension === 'question')!;
    expect(question.ruleCap).toBe(3);
    expect(question.semanticLevel).toBe(4);
    expect(question.level).toBe(3);
    expect(question.source).toBe('rules+semantic');
    expect(bundle.semanticStatus).toBe('merged');
  });

  it('falls back to rule levels when the evaluator fails or returns null', async () => {
    const state = completedDriver().state;
    const failed = await evaluateInquiry({
      task: TASK,
      state,
      evaluationVersion: 'test-v1',
      semantic: async () => {
        throw new Error('model down');
      },
    });
    expect(failed.semanticStatus).toBe('invalid');
    expect(failed.dimensions.every((dimension) => dimension.source === 'rules')).toBe(true);
    expect(failed.dimensions.find((dimension) => dimension.dimension === 'question')!.level).toBe(3);

    const rulesOnly = await evaluateInquiry({ task: TASK, state, evaluationVersion: 'test-v1' });
    expect(rulesOnly.semanticStatus).toBe('skipped');
  });

  it('never scores an insufficient dimension even if the model tries', async () => {
    const state = afterEvidence().revert({ targetPhaseIndex: 1 }).state;
    let received = 0;
    const bundle = await evaluateInquiry({
      task: TASK,
      state,
      evaluationVersion: 'test-v1',
      semantic: async (input) => {
        received += 1;
        const any = input.evidence[0];
        return {
          dimensions: [
            {
              dimension: 'hypothesis',
              status: 'evaluated',
              level: 4,
              basis: ['x'],
              suggestions: [],
              evidenceRefs: any
                ? [{ id: any.id, kind: any.kind, phaseId: any.phaseId, quote: any.quote }]
                : [],
            },
          ],
        };
      },
    });
    expect(received).toBe(1);
    const hypothesis = bundle.dimensions.find((dimension) => dimension.dimension === 'hypothesis')!;
    expect(hypothesis.status).toBe('insufficient_evidence');
    expect(hypothesis.level).toBeNull();
  });

  it('sends only active evidence to the evaluator', async () => {
    const state = afterEvidence().revert({ targetPhaseIndex: 2 }).state;
    let seenIds: string[] = [];
    await evaluateInquiry({
      task: TASK,
      state,
      evaluationVersion: 'test-v1',
      semantic: async (input) => {
        seenIds = input.evidence.map((item) => item.id);
        return null;
      },
    });
    const evidence = collectEvidence(TASK, state);
    expect(seenIds).toEqual(evidence.active.map((item) => item.id));
    expect(evidence.superseded.length).toBeGreaterThan(0);
  });
});
