import { describe, expect, it } from 'vitest';

import { replayInquiryEvents } from '@/lib/inquiry/domain/state';
import { activeExperiments } from '@/lib/inquiry/domain/gates';
import {
  ANALYSIS,
  DESIGN,
  HYPOTHESIS,
  QUESTION,
  REFLECTION,
  TASK,
  startedSession,
} from './_helpers';

describe('event sourcing', () => {
  it('keeps lastSequence equal to the number of applied events', () => {
    const driver = startedSession();
    expect(driver.state.lastSequence).toBe(driver.events.length);
    driver.submit('q-1', QUESTION);
    expect(driver.state.lastSequence).toBe(driver.events.length);
    driver.hint({ explicit: true, classifiedType: 'concept' });
    expect(driver.state.lastSequence).toBe(driver.events.length);
  });

  it('replays a full session with hints, experiments and a revert to the same state', () => {
    const driver = startedSession();

    driver.submit('q-1', QUESTION);
    driver.hint({ explicit: true });
    driver.complete();

    driver.submit('h-1', HYPOTHESIS);
    driver.complete();

    driver.submit('d-1', DESIGN);
    driver.complete();

    driver.experiment('t-1', 'wood-block', 'water');
    driver.experiment('t-2', 'stone-block', 'water');
    driver.hint({ explicit: false, classifiedType: 'method' });
    driver.complete();

    driver.revert({ targetPhaseIndex: 1, reason: '重新想想假设' });
    driver.confirm('h-1').complete();
    driver.confirm('d-1').complete();
    driver.experiment('t-3', 'wax-block', 'water').complete();

    driver.submit('a-1', ANALYSIS).complete();
    driver.submit('r-1', REFLECTION).complete();

    expect(driver.state.status).toBe('completed');
    expect(replayInquiryEvents(TASK, driver.events)).toEqual(driver.state);
  });

  it('reconstructs the pre-revert state from the event prefix', () => {
    const driver = startedSession();
    driver.submit('q-1', QUESTION).complete();
    driver.submit('h-1', HYPOTHESIS).complete();
    driver.submit('d-1', DESIGN).complete();
    driver.experiment('t-1', 'wood-block', 'water');
    driver.complete();

    const eventsBeforeRevert = [...driver.events];
    const beforeRevert = replayInquiryEvents(TASK, eventsBeforeRevert);
    expect(beforeRevert.position.phaseId).toBe('analysis');
    expect(activeExperiments(beforeRevert.collected.evidence).map((e) => e.id)).toEqual(['t-1']);

    driver.revert({ targetPhaseIndex: 1 });
    const afterRevert = replayInquiryEvents(TASK, driver.events);
    expect(afterRevert).toEqual(driver.state);
    // The old slice of history still exists in the database; the current
    // projection simply no longer treats it as live evidence.
    expect(activeExperiments(afterRevert.collected.evidence)).toEqual([]);
    expect(afterRevert.collected.evidence.experiments.map((e) => e.id)).toEqual(['t-1']);
  });

  it('replays every prefix identically (step-by-step)', () => {
    const driver = startedSession();
    const checkpoints: { count: number; state: unknown }[] = [];
    const step = () => {
      checkpoints.push({ count: driver.events.length, state: driver.state });
    };

    step();
    driver.submit('q-1', QUESTION);
    step();
    driver.hint({ explicit: true });
    step();
    driver.complete();
    step();
    driver.submit('h-1', HYPOTHESIS).complete();
    step();
    driver.revert({ targetPhaseIndex: 0 });
    step();
    driver.confirm('q-1').complete();
    step();

    // The state object is immutable across transitions, so the captured
    // references are snapshots, not views of the latest state.
    for (const { count, state } of checkpoints) {
      expect(replayInquiryEvents(TASK, driver.events.slice(0, count))).toEqual(state);
    }
    expect(replayInquiryEvents(TASK, driver.events)).toEqual(driver.state);
  });
});
