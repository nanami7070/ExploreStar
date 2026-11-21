import { describe, expect, it } from 'vitest';

import { parseDifficultyResponse } from '@/lib/inquiry/server/difficulty';

describe('difficulty response parsing', () => {
  it('accepts a plain JSON type', () => {
    expect(parseDifficultyResponse('{"type":"concept","confidence":0.9}')).toBe('concept');
  });

  it('accepts a fenced JSON block', () => {
    expect(parseDifficultyResponse('```json\n{"type":"method","confidence":0.7}\n```')).toBe(
      'method',
    );
  });

  it('treats "no difficulty" as null', () => {
    expect(parseDifficultyResponse('{"type":null}')).toBeNull();
  });

  it('drops a low-confidence guess', () => {
    expect(parseDifficultyResponse('{"type":"analysis","confidence":0.2}')).toBeNull();
  });

  it('rejects unknown types, bad JSON and prose', () => {
    expect(parseDifficultyResponse('{"type":"bored"}')).toBeNull();
    expect(parseDifficultyResponse('type: concept')).toBeNull();
    expect(parseDifficultyResponse('')).toBeNull();
    expect(parseDifficultyResponse('{"type":')).toBeNull();
  });

  it('repairs a nearly-valid object', () => {
    expect(parseDifficultyResponse('{"type":"expression", "confidence": 0.8,}')).toBe(
      'expression',
    );
  });
});
