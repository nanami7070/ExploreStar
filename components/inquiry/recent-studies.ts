/**
 * 最近探究索引：纯前端 localStorage 记录本浏览器参与过的探究会话，
 * 供学生首页提供「继续探究」入口。服务端数据仍以
 * GET /api/inquiry/study/[id] 为准（快照校验所有权与存在性）。
 */
export interface RecentStudy {
  studyId: string;
  taskKey: string;
  taskName: string;
  updatedAt: string;
}

const STORAGE_KEY = 'exp:recent-studies';

function safeGet(): RecentStudy[] {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (item): item is RecentStudy =>
        typeof item === 'object' &&
        item !== null &&
        typeof (item as RecentStudy).studyId === 'string' &&
        typeof (item as RecentStudy).taskKey === 'string',
    );
  } catch {
    return [];
  }
}

function safeSet(list: RecentStudy[]) {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(list.slice(0, 12)));
  } catch {
    // 存储不可用（隐私模式等）时静默降级：首页没有「继续探究」入口而已。
  }
}

export function readRecentStudies(): RecentStudy[] {
  if (typeof window === 'undefined') return [];
  return safeGet().sort((a, b) => (b.updatedAt ?? '').localeCompare(a.updatedAt ?? ''));
}

export function rememberStudy(study: Omit<RecentStudy, 'updatedAt'>) {
  if (typeof window === 'undefined') return;
  const list = safeGet().filter((item) => item.studyId !== study.studyId);
  safeSet([{ ...study, updatedAt: new Date().toISOString() }, ...list]);
}

export function forgetStudy(studyId: string) {
  if (typeof window === 'undefined') return;
  safeSet(safeGet().filter((item) => item.studyId !== studyId));
}
