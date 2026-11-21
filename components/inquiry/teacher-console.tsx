'use client';

/**
 * 教师端工作台：数据总览 + 学生记录（可筛选）+ 任务审核。
 * 教师端更重信息密度：字号回到 13-14px，但保留清晰的视觉层级。
 */
import Link from 'next/link';
import {
  ArrowRight,
  BookOpenCheck,
  CircleCheck,
  GraduationCap,
  KeyRound,
  LoaderCircle,
  LogOut,
  Search,
  ShieldCheck,
  Users,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';

import { cn } from '@/lib/utils';

import { ExploreShell } from './exp-shell';
import { EmptyState, ExpButton, ExpPill, Loading } from './exp-ui';
import { readTeacherToken, saveTeacherToken, teacherHeaders } from './teacher-token';

interface StudySummary {
  id: string;
  taskKey: string;
  taskName: string;
  learnerKey: string;
  status: string;
  revision: number;
  updatedAt?: string;
  reportRevision?: number;
  reportStatus?: string;
}

type ReviewStatus = 'pending' | 'approved' | 'rejected';

interface TaskReview {
  reviewer: string;
  reviewedAt: string;
  science: { status: ReviewStatus; note?: string };
  safety: { status: ReviewStatus; note?: string };
  age: { status: ReviewStatus; note?: string };
}

interface TaskSummary {
  id: string;
  key: string;
  name: string;
  grade: string;
  version: string;
  published: boolean;
  review: TaskReview | null;
}

const STATUS_LABEL: Record<string, string> = {
  created: '刚创建',
  running: '进行中',
  waiting_for_student: '等待学生',
  completed: '已完成',
  failed: '异常',
};

export function TeacherConsole() {
  const [token, setToken] = useState('');
  const [tokenDraft, setTokenDraft] = useState('');
  const [studies, setStudies] = useState<StudySummary[] | null>(null);
  const [tasks, setTasks] = useState<TaskSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [reviewer, setReviewer] = useState('');

  // 学生记录筛选（纯前端）
  const [taskFilter, setTaskFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState('all');
  const [query, setQuery] = useState('');

  useEffect(() => {
    const stored = readTeacherToken();
    setToken(stored);
    setTokenDraft(stored);
  }, []);

  const load = useCallback(async (activeToken: string) => {
    if (!activeToken) return;
    setLoading(true);
    setError(null);
    try {
      const headers = teacherHeaders(activeToken);
      const [studiesResponse, tasksResponse] = await Promise.all([
        fetch('/api/inquiry/teacher/studies', { headers, cache: 'no-store' }),
        fetch('/api/inquiry/teacher/tasks', { headers, cache: 'no-store' }),
      ]);
      if (studiesResponse.status === 404) {
        setError('教师端未启用：请先在服务端设置 INQUIRY_TEACHER_TOKEN。');
        return;
      }
      if (studiesResponse.status === 401 || tasksResponse.status === 401) {
        setError('教师口令不正确。');
        return;
      }
      const studyBody = (await studiesResponse.json()) as { studies: StudySummary[] };
      const taskBody = (await tasksResponse.json()) as { tasks: TaskSummary[] };
      setStudies(studyBody.studies);
      setTasks(taskBody.tasks);
    } catch {
      setError('暂时无法读取教师端数据。');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (token) void load(token);
  }, [load, token]);

  const enter = () => {
    const trimmed = tokenDraft.trim();
    saveTeacherToken(trimmed);
    setToken(trimmed);
  };

  const reviewTask = async (
    task: TaskSummary,
    science: ReviewStatus,
    safety: ReviewStatus,
    age: ReviewStatus,
    publish: boolean,
  ) => {
    if (!reviewer.trim()) {
      setError('请先填写审核人姓名。');
      return;
    }
    setError(null);
    try {
      const response = await fetch(
        `/api/inquiry/teacher/tasks/${encodeURIComponent(task.key)}/review`,
        {
          method: 'POST',
          headers: { ...teacherHeaders(token), 'Content-Type': 'application/json' },
          body: JSON.stringify({
            reviewer: reviewer.trim(),
            science: { status: science },
            safety: { status: safety },
            age: { status: age },
            publish,
          }),
        },
      );
      const body = (await response.json().catch(() => ({}))) as { error?: string };
      if (!response.ok) {
        setError(body.error ?? '审核没有保存成功。');
        return;
      }
      await load(token);
    } catch {
      setError('网络中断，审核没有保存成功。');
    }
  };

  /* ---------------- 数据总览（hooks 必须在所有条件返回之前） ---------------- */
  const stats = useMemo(() => {
    const list = studies ?? [];
    return {
      total: list.length,
      running: list.filter((s) => s.status === 'running' || s.status === 'waiting_for_student').length,
      completed: list.filter((s) => s.status === 'completed').length,
      pendingReports: list.filter((s) => s.reportRevision && s.reportStatus === 'pending').length,
      pendingTasks: (tasks ?? []).filter((t) => !t.published).length,
    };
  }, [studies, tasks]);

  const filteredStudies = useMemo(() => {
    const list = studies ?? [];
    return list.filter((study) => {
      if (taskFilter !== 'all' && study.taskKey !== taskFilter) return false;
      if (statusFilter !== 'all' && study.status !== statusFilter) return false;
      if (query.trim() && !study.learnerKey.toLowerCase().includes(query.trim().toLowerCase())) return false;
      return true;
    });
  }, [studies, taskFilter, statusFilter, query]);

  /* ---------------- 口令门 ---------------- */
  if (!token) {
    return (
      <ExploreShell variant="teacher">
        <main className="mx-auto max-w-md px-4 py-16">
          <div className="exp-card p-6">
            <div className="flex items-center gap-3">
              <span className="grid h-11 w-11 place-items-center rounded-2xl bg-[var(--primary-soft)] text-primary">
                <KeyRound className="h-5 w-5" aria-hidden />
              </span>
              <div>
                <h1 className="text-lg font-bold">教师工作台</h1>
                <p className="text-[0.8125rem] text-muted-foreground">
                  需要服务端配置的访问口令（INQUIRY_TEACHER_TOKEN）
                </p>
              </div>
            </div>
            <div className="mt-5 flex gap-2">
              <input
                type="password"
                className="exp-input"
                value={tokenDraft}
                onChange={(event) => setTokenDraft(event.target.value)}
                placeholder="输入教师口令"
                onKeyDown={(event) => {
                  if (event.key === 'Enter') enter();
                }}
              />
              <ExpButton onClick={enter} disabled={!tokenDraft.trim()}>
                进入
              </ExpButton>
            </div>
            <p className="mt-3 text-[0.75rem] text-muted-foreground">
              学生端无法访问这里的数据。
            </p>
          </div>
        </main>
      </ExploreShell>
    );
  }

  const selectCls =
    'h-10 rounded-xl border-[1.5px] border-input bg-card px-3 text-[0.8125rem] font-medium text-foreground';

  return (
    <ExploreShell variant="teacher" wide>
      <main className="mx-auto max-w-[1400px] px-4 pb-6 pt-4">
        <header className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-xl font-bold sm:text-2xl">教师工作台</h1>
            <p className="text-[0.8125rem] text-muted-foreground">
              查看学生探究记录、审核学习报告与探究任务（发布任务需要三项审核全部通过）
            </p>
          </div>
          <ExpButton
            variant="ghost"
            size="sm"
            onClick={() => {
              saveTeacherToken('');
              setToken('');
              setStudies(null);
              setTasks(null);
            }}
          >
            <LogOut className="h-4 w-4" aria-hidden />
            退出教师端
          </ExpButton>
        </header>

        {error ? (
          <div className="exp-note exp-note-danger mt-4 text-[0.875rem]">{error}</div>
        ) : null}

        {/* 统计卡 */}
        <div className="mt-5 grid grid-cols-2 gap-3 lg:grid-cols-5">
          <StatCard icon={Users} label="学生探究记录" value={stats.total} />
          <StatCard icon={LoaderCircle} label="进行中" value={stats.running} tone="info" />
          <StatCard icon={CircleCheck} label="已完成" value={stats.completed} tone="success" />
          <StatCard icon={GraduationCap} label="待审核报告" value={stats.pendingReports} tone="warn" />
          <StatCard icon={BookOpenCheck} label="待审核/未发布任务" value={stats.pendingTasks} tone="warn" />
        </div>

        {loading ? (
          <div className="mt-6">
            <Loading text="正在加载…" />
          </div>
        ) : null}

        {/* 学生记录 */}
        <section className="mt-7">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-lg font-bold">学生探究记录</h2>
            <div className="flex flex-wrap gap-2">
              <div className="relative">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
                <input
                  className={cn(selectCls, 'pl-9')}
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="搜索学习者标识"
                  aria-label="搜索学习者标识"
                />
              </div>
              <select
                className={selectCls}
                value={taskFilter}
                onChange={(event) => setTaskFilter(event.target.value)}
                aria-label="按任务筛选"
              >
                <option value="all">全部任务</option>
                {tasks?.map((task) => (
                  <option key={task.key} value={task.key}>
                    {task.name}
                  </option>
                ))}
              </select>
              <select
                className={selectCls}
                value={statusFilter}
                onChange={(event) => setStatusFilter(event.target.value)}
                aria-label="按状态筛选"
              >
                <option value="all">全部状态</option>
                <option value="running">进行中</option>
                <option value="waiting_for_student">等待学生</option>
                <option value="completed">已完成</option>
                <option value="failed">异常</option>
              </select>
            </div>
          </div>

          {studies && studies.length === 0 ? (
            <div className="exp-card mt-3">
              <EmptyState icon={Users} title="还没有学生探究记录" hint="学生开始探究后，记录会出现在这里。" />
            </div>
          ) : null}

          {filteredStudies.length > 0 ? (
            <ul className="mt-3 overflow-hidden rounded-2xl border border-border bg-card shadow-[var(--exp-shadow-sm)]">
              {filteredStudies.map((study, index) => (
                <li
                  key={study.id}
                  className={cn('flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-3', index > 0 && 'border-t border-border')}
                >
                  <div className="min-w-0 flex-1">
                    <Link
                      href={`/teacher/study/${study.id}`}
                      className="font-semibold text-primary underline-offset-4 hover:underline"
                    >
                      {study.taskName}
                    </Link>
                    <p className="text-[0.75rem] text-muted-foreground">
                      匿名学习者 {study.learnerKey}
                      {study.updatedAt
                        ? ` · 最近活动 ${new Date(study.updatedAt).toLocaleString('zh-CN')}`
                        : ''}
                    </p>
                  </div>
                  <StudyStatusPill status={study.status} />
                  <ReportStatusPill reportStatus={study.reportStatus} hasReport={Boolean(study.reportRevision)} />
                  <Link
                    href={`/teacher/study/${study.id}`}
                    className="inline-flex items-center gap-1 text-[0.8125rem] font-medium text-muted-foreground hover:text-primary"
                  >
                    查看
                    <ArrowRight className="h-3.5 w-3.5" aria-hidden />
                  </Link>
                </li>
              ))}
            </ul>
          ) : studies && studies.length > 0 && filteredStudies.length === 0 ? (
            <div className="exp-card mt-3">
              <EmptyState icon={Search} title="没有匹配的记录" hint="换个筛选条件试试。" />
            </div>
          ) : null}
        </section>

        {/* 任务审核 */}
        <section className="mt-8">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-lg font-bold">探究任务审核</h2>
            <label className="flex items-center gap-2 text-[0.8125rem] font-medium text-muted-foreground">
              <ShieldCheck className="h-4 w-4" aria-hidden />
              审核人
              <input
                className="h-10 rounded-xl border-[1.5px] border-input bg-card px-3 text-[0.8125rem]"
                value={reviewer}
                onChange={(event) => setReviewer(event.target.value)}
                placeholder="你的姓名"
              />
            </label>
          </div>
          {tasks?.map((task) => (
            <TaskReviewCard
              key={task.key}
              task={task}
              onSave={(science, safety, age, publish) =>
                void reviewTask(task, science, safety, age, publish)
              }
            />
          ))}
        </section>
      </main>
    </ExploreShell>
  );
}

/* ------------------------------------------------------------------ */
/* 子组件                                                              */
/* ------------------------------------------------------------------ */

function StatCard({
  icon: Icon,
  label,
  value,
  tone = 'success',
}: {
  icon: typeof Users;
  label: string;
  value: number;
  tone?: 'success' | 'info' | 'warn';
}) {
  const color = tone === 'info' ? 'var(--exp-sky)' : tone === 'warn' ? 'var(--exp-sun)' : 'var(--primary)';
  return (
    <div className="exp-card flex items-center gap-3 p-4">
      <span
        className="grid h-10 w-10 shrink-0 place-items-center rounded-xl"
        style={{ background: `color-mix(in srgb, ${color} 14%, transparent)`, color }}
      >
        <Icon className="h-5 w-5" aria-hidden />
      </span>
      <div className="min-w-0">
        <p className="text-2xl font-bold leading-none">{value}</p>
        <p className="mt-1 truncate text-[0.75rem] text-muted-foreground">{label}</p>
      </div>
    </div>
  );
}

function StudyStatusPill({ status }: { status: string }) {
  const tone = status === 'completed' ? 'success' : status === 'failed' ? 'danger' : 'info';
  return <ExpPill tone={tone}>{STATUS_LABEL[status] ?? status}</ExpPill>;
}

function ReportStatusPill({
  reportStatus,
  hasReport,
}: {
  reportStatus?: string;
  hasReport: boolean;
}) {
  if (!hasReport) return <ExpPill tone="neutral">暂无报告</ExpPill>;
  if (reportStatus === 'approved') return <ExpPill tone="success">报告已审核</ExpPill>;
  if (reportStatus === 'needs_revision') return <ExpPill tone="warn">报告需修改</ExpPill>;
  return <ExpPill tone="warn">报告待审核</ExpPill>;
}

function TaskReviewCard({
  task,
  onSave,
}: {
  task: TaskSummary;
  onSave: (science: ReviewStatus, safety: ReviewStatus, age: ReviewStatus, publish: boolean) => void;
}) {
  const [science, setScience] = useState<ReviewStatus>(task.review?.science.status ?? 'pending');
  const [safety, setSafety] = useState<ReviewStatus>(task.review?.safety.status ?? 'pending');
  const [age, setAge] = useState<ReviewStatus>(task.review?.age.status ?? 'pending');
  const [publish, setPublish] = useState(task.published);

  return (
    <div className="exp-card mt-3 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <p className="text-[0.9375rem] font-bold">
            {task.name}{' '}
            <span className="text-[0.75rem] font-medium text-muted-foreground">
              v{task.version} · {task.grade}年级
            </span>
          </p>
          <p className="text-[0.75rem] text-muted-foreground">
            {task.review
              ? `上次审核：${task.review.reviewer}（${new Date(task.review.reviewedAt).toLocaleString('zh-CN')}）`
              : '尚无审核记录'}
          </p>
        </div>
        <ExpPill tone={task.published ? 'success' : 'neutral'}>
          {task.published ? '学生可见' : '草稿'}
        </ExpPill>
      </div>
      <div className="mt-3 grid gap-3 sm:grid-cols-3">
        <ReviewSelect label="科学知识" value={science} onChange={setScience} />
        <ReviewSelect label="实验安全" value={safety} onChange={setSafety} />
        <ReviewSelect label="教学适龄性" value={age} onChange={setAge} />
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-3">
        <label className="flex cursor-pointer items-center gap-2 text-[0.8125rem]">
          <input
            type="checkbox"
            className="h-4 w-4 accent-[var(--primary)]"
            checked={publish}
            onChange={(event) => setPublish(event.target.checked)}
          />
          三项审核全部通过后发布给学生
        </label>
        <ExpButton size="sm" onClick={() => onSave(science, safety, age, publish)}>
          保存审核
        </ExpButton>
        <span className="text-[0.75rem] text-muted-foreground">保存后列表会刷新并记录审核历史</span>
      </div>
    </div>
  );
}

function ReviewSelect({
  label,
  value,
  onChange,
}: {
  label: string;
  value: ReviewStatus;
  onChange: (value: ReviewStatus) => void;
}) {
  const tone =
    value === 'approved' ? 'text-[var(--primary)]' : value === 'rejected' ? 'text-[var(--destructive)]' : 'text-[var(--exp-sun)]';
  return (
    <label className="space-y-1">
      <span className="block text-[0.75rem] font-semibold text-muted-foreground">{label}</span>
      <select
        className={cn(
          'h-10 w-full rounded-xl border-[1.5px] border-input bg-card px-3 text-[0.8125rem] font-semibold',
          tone,
        )}
        value={value}
        onChange={(event) => onChange(event.target.value as ReviewStatus)}
      >
        <option value="pending">待审核</option>
        <option value="approved">通过</option>
        <option value="rejected">驳回</option>
      </select>
    </label>
  );
}
