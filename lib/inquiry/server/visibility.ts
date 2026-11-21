/**
 * Who may see a task.
 *
 * A task becomes public to students only after a human review sets
 * `published` (the seeded task ships with `reviewedAt: null`, so it is a
 * draft). Drafts stay reachable in development so the prototype can be
 * demonstrated; production never lists or starts them, and
 * `INQUIRY_HIDE_DRAFT_TASKS=true` hides them on a development host as well.
 */

export interface TaskVisibility {
  published: boolean;
}

export interface TaskVisibilityEnv {
  NODE_ENV?: string;
  INQUIRY_HIDE_DRAFT_TASKS?: string;
}

export function isTaskVisibleToStudents(
  task: TaskVisibility,
  env: TaskVisibilityEnv = process.env,
): boolean {
  if (task.published) return true;
  const production = env.NODE_ENV === 'production';
  const forceHide = env.INQUIRY_HIDE_DRAFT_TASKS === 'true';
  return !production && !forceHide;
}

/** True when the task is shown although no reviewer has signed it off yet. */
export function isDraftPreview(task: TaskVisibility, env: TaskVisibilityEnv = process.env): boolean {
  return !task.published && isTaskVisibleToStudents(task, env);
}
