import { describe, expect, it } from 'vitest';

import { recordExperiment } from '@/lib/inquiry/domain/transition';
import { predictionMismatch } from '@/lib/inquiry/domain/types';
import { DESIGN, TASK, afterDesign } from './_helpers';

const RECORDED_AT = '2026-11-20T09:00:00.000Z';

describe('experiment evidence model', () => {
  it('saves the prediction, observation note, time, phase revision and design snapshot', () => {
    const driver = afterDesign().experimentEvidence('t-1', 'wood-block', 'water', {
      prediction: 'float',
      note: '木块浮在水面上',
      recordedAt: RECORDED_AT,
    });
    const record = driver.state.collected.evidence.experiments[0]!;
    expect(record.studentPrediction).toBe('float');
    expect(record.note).toBe('木块浮在水面上');
    expect(record.recordedAt).toBe(RECORDED_AT);
    expect(record.phaseRevision).toBe(0);
    expect(record.designSnapshot).toEqual({
      changedCondition: DESIGN.changedCondition,
      keptConditions: DESIGN.keptConditions,
      observedTarget: DESIGN.observedTarget,
    });
  });

  it('keeps a mismatch trial as valid evidence and lets the phase complete', () => {
    const driver = afterDesign().experimentEvidence('t-1', 'stone-block', 'water', {
      prediction: 'float',
      recordedAt: RECORDED_AT,
    });
    const record = driver.state.collected.evidence.experiments[0]!;
    expect(record.result.predicted).toBe('sink');
    expect(predictionMismatch(record)).toBe(true);

    driver.complete();
    expect(driver.state.position.phaseId).toBe('analysis');
  });

  it('records a real observation that differs from the model prediction', () => {
    const driver = afterDesign().experimentEvidence('t-1', 'plastic-block', 'water', {
      prediction: 'sink',
      source: 'real',
      observed: 'sink',
      note: '我试了两次，都是沉下去',
      recordedAt: RECORDED_AT,
    });
    const record = driver.state.collected.evidence.experiments[0]!;
    expect(record.result.predicted).toBe('float');
    expect(record.result.observed).toBe('sink');
    expect(predictionMismatch(record)).toBe(false);
    expect(record.source).toBe('real');
    driver.complete();
    expect(driver.state.position.phaseId).toBe('analysis');
  });

  it('returns null for a legacy trial without a prediction', () => {
    const driver = afterDesign().experiment('legacy', 'wood-block', 'water');
    expect(predictionMismatch(driver.state.collected.evidence.experiments[0]!)).toBeNull();
  });

  it('rejects an unknown prediction and an over-long note', () => {
    const driver = afterDesign();
    expect(() =>
      recordExperiment(TASK, driver.state, {
        trialId: 'bad',
        materialId: 'wood-block',
        liquidId: 'water',
        source: 'sim',
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        studentPrediction: 'melt' as any,
      }),
    ).toThrowError(/unknown predicted outcome/);
    expect(() =>
      recordExperiment(TASK, driver.state, {
        trialId: 'long-note',
        materialId: 'wood-block',
        liquidId: 'water',
        source: 'sim',
        studentPrediction: 'float',
        note: 'x'.repeat(301),
      }),
    ).toThrowError(/observation note exceeds/);
  });

  it('replays trials with prediction evidence exactly', () => {
    const driver = afterDesign()
      .experimentEvidence('t-1', 'wood-block', 'water', {
        prediction: 'float',
        note: '浮起来了',
        recordedAt: RECORDED_AT,
      })
      .experimentEvidence('t-2', 'stone-block', 'water', {
        prediction: 'sink',
        recordedAt: RECORDED_AT,
      });
    expect(driver.replay()).toEqual(driver.state);
  });
});
