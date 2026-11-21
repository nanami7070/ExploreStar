/**
 * Adaptive scaffolding engine.
 *
 * A hint decision is a pure function of (phase, difficulty type, attempts,
 * prior hint level). The escalation rules are deterministic and unit-tested;
 * a language model may classify the difficulty type (P2), but it never decides
 * the level, and a failed classification degrades to `null` without changing
 * the rules.
 *
 * Escalation (plan §3.5):
 * - explicit help request: +1 level;
 * - the same classified difficulty twice in a row, or the same soft check
 *   failing on two consecutive submissions: +1 level;
 * - the level is capped at L2 until the phase has 4 attempts; L3 (a direct
 *   explanation) is only reachable from the fourth attempt onward;
 * - a phase revert/reactivation resets the level (the hint log is kept as
 *   learning evidence).
 */
import type {
  DifficultyType,
  EvaluationRecord,
  HintLevel,
  PhaseCollected,
  ScaffoldDecision,
  ScaffoldInput,
} from './types';

function bump(level: HintLevel): HintLevel {
  return Math.min(level + 1, 3) as HintLevel;
}

/** Roll the consecutive-difficulty counter forward for a classified reply. */
export function nextConsecutive(
  current: ScaffoldInput['consecutiveType'],
  classified: DifficultyType | null | undefined,
): ScaffoldInput['consecutiveType'] {
  if (!classified) return current;
  return current.type === classified
    ? { type: classified, count: current.count + 1 }
    : { type: classified, count: 1 };
}

export function computeScaffold(input: ScaffoldInput): ScaffoldDecision {
  let level: HintLevel = input.currentLevel;
  const reasons: string[] = [];

  if (input.consecutiveType.count >= 2 && input.consecutiveType.type) {
    level = bump(level);
    reasons.push(`consecutive:${input.consecutiveType.type}`);
  }
  if (input.softFailStreak.count >= 2 && input.softFailStreak.checkId) {
    level = bump(level);
    reasons.push(`repeat:${input.softFailStreak.checkId}`);
  }
  if (input.explicitHelp) {
    level = bump(level);
    reasons.push('explicit-help');
  }

  const cap: HintLevel = input.attempts >= 4 ? 3 : 2;
  level = Math.min(level, cap) as HintLevel;

  const type = input.classifiedType ?? null;
  const providedExplanation = level === 3;
  if (providedExplanation) reasons.push('structured-support');

  return {
    level,
    type,
    templateKey: `${input.phaseId}.${type ?? 'default'}.L${level}`,
    reason: reasons.length ? reasons.join(';') : 'no-escalation',
    providedExplanation,
  };
}

function evaluationsBySubmission(
  collected: PhaseCollected,
): { order: string[]; bySubmission: Map<string, EvaluationRecord[]> } {
  const order: string[] = [];
  const bySubmission = new Map<string, EvaluationRecord[]>();
  for (const evaluation of collected.evaluations) {
    if (evaluation.kind !== 'soft-check' || !evaluation.submissionId) continue;
    let group = bySubmission.get(evaluation.submissionId);
    if (!group) {
      group = [];
      bySubmission.set(evaluation.submissionId, group);
      order.push(evaluation.submissionId);
    }
    group.push(evaluation);
  }
  return { order, bySubmission };
}

/**
 * How many consecutive submissions in a row had the same soft check failing.
 * `count >= 2` triggers one escalation step. Returns count 0 when the latest
 * submission had no failing soft checks.
 */
export function softFailStreak(collected: PhaseCollected): {
  checkId: string | null;
  count: number;
} {
  const { order, bySubmission } = evaluationsBySubmission(collected);
  if (!order.length) return { checkId: null, count: 0 };
  const latest = bySubmission.get(order[order.length - 1])!;
  const failing = latest
    .filter((evaluation) => !evaluation.verdict.passed)
    .map((evaluation) => evaluation.verdict.checkId);
  if (!failing.length) return { checkId: null, count: 0 };

  let best: { checkId: string | null; count: number } = { checkId: null, count: 0 };
  for (const checkId of new Set(failing)) {
    let count = 0;
    for (let i = order.length - 1; i >= 0; i -= 1) {
      const group = bySubmission.get(order[i])!;
      const failedHere = group.some(
        (evaluation) => evaluation.verdict.checkId === checkId && !evaluation.verdict.passed,
      );
      if (!failedHere) break;
      count += 1;
    }
    if (count > best.count) best = { checkId, count };
  }
  return best;
}
