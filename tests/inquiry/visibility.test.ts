import { describe, expect, it } from 'vitest';

import {
  isDraftPreview,
  isTaskVisibleToStudents,
} from '@/lib/inquiry/server/visibility';

describe('task visibility', () => {
  it('always shows a reviewed, published task', () => {
    expect(isTaskVisibleToStudents({ published: true }, { NODE_ENV: 'production' })).toBe(true);
    expect(isTaskVisibleToStudents({ published: true }, { NODE_ENV: 'development' })).toBe(true);
  });

  it('never shows an unreviewed draft in production', () => {
    expect(isTaskVisibleToStudents({ published: false }, { NODE_ENV: 'production' })).toBe(false);
    expect(isDraftPreview({ published: false }, { NODE_ENV: 'production' })).toBe(false);
  });

  it('shows a draft in development for prototype demonstration', () => {
    expect(isTaskVisibleToStudents({ published: false }, { NODE_ENV: 'development' })).toBe(true);
    expect(isDraftPreview({ published: false }, { NODE_ENV: 'development' })).toBe(true);
  });

  it('honours the explicit hide switch on a development host', () => {
    expect(
      isTaskVisibleToStudents(
        { published: false },
        { NODE_ENV: 'development', INQUIRY_HIDE_DRAFT_TASKS: 'true' },
      ),
    ).toBe(false);
  });
});
