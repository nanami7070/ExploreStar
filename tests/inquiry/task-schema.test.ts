import { describe, expect, it } from 'vitest';

import {
  extractJsonObject,
  parseTaskDefinitionDraft,
} from '@/lib/inquiry/generation/task-schema';

import { floatSinkDraft, observationDraft } from './_generation-fixtures';

describe('task definition schema', () => {
  it('parses a valid draft wrapped in a code fence', () => {
    const text = `好的，这是方案：\n\`\`\`json\n${JSON.stringify(observationDraft())}\n\`\`\``;
    const draft = parseTaskDefinitionDraft(text);
    expect(draft).not.toBeNull();
    expect(draft!.phases).toHaveLength(6);
    expect(draft!.materials.length).toBeGreaterThanOrEqual(1);
  });

  it('repairs trailing commentary around the JSON object', () => {
    const text = `这是方案 ${JSON.stringify(floatSinkDraft())} 希望有帮助`;
    expect(parseTaskDefinitionDraft(text)).not.toBeNull();
  });

  it('returns null for non-JSON text', () => {
    expect(parseTaskDefinitionDraft('对不起，我无法完成这个请求。')).toBeNull();
  });

  it('returns null when a phase is missing', () => {
    const draft = observationDraft();
    const broken = { ...draft, phases: draft.phases.slice(0, 5) };
    expect(parseTaskDefinitionDraft(JSON.stringify(broken))).toBeNull();
  });

  it('returns null when the model invents an unknown phase id', () => {
    const draft = observationDraft();
    const broken = {
      ...draft,
      phases: draft.phases.map((phase, index) =>
        index === 2 ? { ...phase, id: 'experiment' } : phase,
      ),
    };
    expect(parseTaskDefinitionDraft(JSON.stringify(broken))).toBeNull();
  });

  it('returns null when a field exceeds its limit', () => {
    const draft = observationDraft();
    const broken = { ...draft, name: '很'.repeat(80) };
    expect(parseTaskDefinitionDraft(JSON.stringify(broken))).toBeNull();
  });

  it('returns null when materials are empty', () => {
    const draft = observationDraft();
    const broken = { ...draft, materials: [] };
    expect(parseTaskDefinitionDraft(JSON.stringify(broken))).toBeNull();
  });

  it('extracts the first JSON object from prose', () => {
    expect(extractJsonObject('说明 {"a":1} 结束')).toBe('{"a":1}');
    expect(extractJsonObject('没有对象')).toBeNull();
  });
});
