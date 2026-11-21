/**
 * Merge deterministic rules with the optional semantic evaluation.
 *
 * - No current-revision evidence → `insufficient_evidence`, never a forced
 *   low score.
 * - Otherwise the final level is `min(semantic, rule cap)`: semantics judge
 *   quality, rules cap what the recorded structure can support.
 * - Without a usable semantic result the rule cap is shown, clearly sourced
 *   as rules-only.
 */
import type { InquirySessionState, InquiryTask } from '@/lib/inquiry/domain/types';

import { rubricFor } from './rubric';
import { collectEvidence, evaluateRules } from './rules';
import type { SemanticEvaluator } from './semantic';
import type {
  DimensionEvaluation,
  EvaluationBundle,
  EvidenceRef,
} from './types';

export interface EvaluateInquiryInput {
  task: InquiryTask;
  state: InquirySessionState;
  evaluationVersion: string;
  /** Omitted in rules-only mode (tests, or a deployment without a model). */
  semantic?: SemanticEvaluator | null;
}

function dedupeRefs(refs: readonly EvidenceRef[]): EvidenceRef[] {
  const seen = new Set<string>();
  const result: EvidenceRef[] = [];
  for (const ref of refs) {
    if (seen.has(ref.id)) continue;
    seen.add(ref.id);
    result.push(ref);
  }
  return result;
}

export async function evaluateInquiry(input: EvaluateInquiryInput): Promise<EvaluationBundle> {
  const { task, state } = input;
  const evidence = collectEvidence(task, state);
  const rules = evaluateRules(task, state);

  let semantic = null;
  let semanticStatus: EvaluationBundle['semanticStatus'] = 'skipped';
  if (input.semantic) {
    try {
      semantic = await input.semantic({ task, state, evidence: evidence.active });
      semanticStatus = semantic ? 'merged' : 'invalid';
    } catch {
      semantic = null;
      semanticStatus = 'invalid';
    }
  }

  const dimensions: DimensionEvaluation[] = rules.map((rule) => {
    const rubric = rubricFor(rule.dimension);
    if (!rule.sufficient || rule.cap === null) {
      return {
        dimension: rule.dimension,
        title: rubric.title,
        status: 'insufficient_evidence',
        level: null,
        ruleCap: null,
        semanticLevel: null,
        source: 'rules',
        basis: rule.findings,
        evidenceRefs: [],
        suggestions: rule.suggestions,
      };
    }

    const semanticDimension = semantic?.dimensions.find(
      (entry) => entry.dimension === rule.dimension,
    );
    if (
      semanticDimension &&
      semanticDimension.status === 'evaluated' &&
      semanticDimension.level !== null
    ) {
      const level = Math.min(semanticDimension.level, rule.cap) as 1 | 2 | 3 | 4;
      return {
        dimension: rule.dimension,
        title: rubric.title,
        status: 'evaluated',
        level,
        ruleCap: rule.cap,
        semanticLevel: semanticDimension.level,
        source: 'rules+semantic',
        basis: [...rule.findings, ...semanticDimension.basis],
        evidenceRefs: dedupeRefs([...rule.evidenceRefs, ...semanticDimension.evidenceRefs]),
        suggestions: [...rule.suggestions, ...semanticDimension.suggestions],
      };
    }

    return {
      dimension: rule.dimension,
      title: rubric.title,
      status: 'evaluated',
      level: rule.cap,
      ruleCap: rule.cap,
      semanticLevel: null,
      source: 'rules',
      basis: rule.findings,
      evidenceRefs: rule.evidenceRefs,
      suggestions: rule.suggestions,
    };
  });

  return {
    evaluationVersion: input.evaluationVersion,
    dimensions,
    semanticStatus,
    activeEvidence: evidence.active,
    supersededEvidence: evidence.superseded,
  };
}
