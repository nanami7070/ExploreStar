'use client';

/**
 * 学生首页:核心入口是「今天,你想探究什么?」。
 * 学生写下一个科学问题 → 进入 AI 理解与方案生成流程。
 * 预设任务作为「示例探究任务」弱化保留;「我的探究」保留继续入口。
 */
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ArrowRight, Compass, FlaskConical, Lightbulb, Sparkles } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

import { ExploreShell } from './exp-shell';
import { TankScene, TelescopeMascot } from './exp-icons';
import { EmptyState, ExpButton, ExpPill, Loading, PHASE_META } from './exp-ui';
import { forgetStudy, readRecentStudies, type RecentStudy } from './recent-studies';

interface TaskCard {
  id: string;
  key: string;
  name: string;
  grade: string;
  goals: string[];
  intro: { title: string; text: string };
  published: boolean;
  draft: boolean;
}

interface ContinueInfo extends RecentStudy {
  ok: boolean;
  phaseIndex: number;
  phaseTitle: string;
  status: string;
}

/** 灵感问题:只是打开思路,点击后填入输入框。 */
const INSPIRATION = [
  '为什么彩虹有不同的颜色？',
  '植物为什么向着太阳生长？',
  '怎样让纸飞机飞得更远？',
  '冰块为什么会融化？',
  '为什么有些物体能浮在水面上？',
];

const QUESTION_LIMIT = 300;

export function InquiryHome() {
  const router = useRouter();
  const [question, setQuestion] = useState('');
  const [tasks, setTasks] = useState<TaskCard[] | null>(null);
  const [continues, setContinues] = useState<ContinueInfo[]>([]);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const response = await fetch('/api/inquiry/tasks', { cache: 'no-store' });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const body = (await response.json()) as { tasks: TaskCard[] };
        if (!cancelled) setTasks(body.tasks);
      } catch {
        if (!cancelled) setError('暂时无法读取示例任务，不影响你自己提问。');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // 「继续探究」以服务端快照为准
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const recent = readRecentStudies();
      const results = await Promise.allSettled(
        recent.map(async (item): Promise<ContinueInfo> => {
          const response = await fetch(`/api/inquiry/study/${encodeURIComponent(item.studyId)}`, {
            cache: 'no-store',
          });
          if (response.status === 404) {
            forgetStudy(item.studyId);
            return { ...item, ok: false, phaseIndex: 0, phaseTitle: '', status: 'missing' };
          }
          if (!response.ok) throw new Error(`HTTP ${response.status}`);
          const body = (await response.json()) as {
            status: string;
            state: { position: { phaseIndex: number } };
            task: { phases: { title: string }[] };
          };
          return {
            ...item,
            ok: true,
            phaseIndex: body.state.position.phaseIndex,
            phaseTitle: body.task.phases[body.state.position.phaseIndex]?.title ?? '',
            status: body.status,
          };
        }),
      );
      if (cancelled) return;
      setContinues(
        results
          .filter((r): r is PromiseFulfilledResult<ContinueInfo> => r.status === 'fulfilled')
          .map((r) => r.value)
          .filter((info) => info.ok),
      );
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const trimmed = question.trim();
  const canStart = trimmed.length >= 4;

  const start = () => {
    if (!canStart) {
      inputRef.current?.focus();
      return;
    }
    router.push(`/inquiry/new?q=${encodeURIComponent(trimmed)}`);
  };

  const continueList = continues.filter((info) => info.status !== 'completed');
  const finishedList = continues.filter((info) => info.status === 'completed');
  const presets = tasks ?? [];

  return (
    <ExploreShell>
      <main className="mx-auto max-w-5xl px-4 pb-4 pt-8">
        {/* 欢迎 + 提问区 */}
        <section className="exp-fade-up relative overflow-hidden rounded-3xl border border-border bg-card p-6 shadow-[var(--exp-shadow-sm)] sm:p-8">
          <div className="relative z-10">
            <p className="text-[0.8125rem] font-semibold tracking-wide text-primary">
              探知星 ExploreStar
            </p>
            <h1 className="mt-1 text-3xl font-bold leading-tight sm:text-4xl">
              你好，小科学家！
            </h1>
            <p className="mt-3 max-w-2xl text-[1rem] leading-7 text-muted-foreground">
              从生活中的好奇开始，提出你的问题，AI 探究导师会陪你把它变成一次真正的科学探究。
            </p>

            <div className="mt-6 rounded-3xl border-2 border-primary/30 bg-background p-4 shadow-[var(--exp-shadow-sm)] sm:p-5">
              <label htmlFor="inquiry-question" className="text-lg font-bold">
                今天，你想探究什么？
              </label>
              <p className="mt-0.5 text-[0.8125rem] text-muted-foreground">
                一个科学问题、一个观察到的现象、一个想验证的猜想，都可以。
              </p>
              <textarea
                id="inquiry-question"
                ref={inputRef}
                className="exp-textarea mt-3 text-[1.0625rem] leading-8"
                style={{ minHeight: 110 }}
                value={question}
                onChange={(event) => setQuestion(event.target.value)}
                maxLength={QUESTION_LIMIT}
                placeholder="例如：为什么有些东西能浮在水面上？"
                onKeyDown={(event) => {
                  if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
                    event.preventDefault();
                    start();
                  }
                }}
              />
              <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
                <span className="text-[0.75rem] text-muted-foreground">
                  {question.length > 0 ? `${question.length} / ${QUESTION_LIMIT}` : '写完后点右边的按钮'}
                </span>
                <ExpButton size="lg" onClick={start} disabled={!canStart} className="px-8">
                  <Compass className="h-5 w-5" aria-hidden />
                  开始探索
                  <ArrowRight className="h-4 w-4" aria-hidden />
                </ExpButton>
              </div>
            </div>

            {/* 灵感问题 */}
            <div className="mt-4">
              <p className="flex items-center gap-1.5 text-[0.8125rem] font-semibold text-muted-foreground">
                <Lightbulb className="h-4 w-4 text-[var(--exp-sun)]" aria-hidden />
                没有头绪？点一个试试（会填入上面的输入框）
              </p>
              <div className="mt-2 flex flex-wrap gap-2">
                {INSPIRATION.map((idea) => (
                  <button
                    key={idea}
                    type="button"
                    className="exp-prompt-chip"
                    onClick={() => {
                      setQuestion(idea);
                      inputRef.current?.focus();
                    }}
                  >
                    {idea}
                  </button>
                ))}
              </div>
            </div>
          </div>
          <div className="pointer-events-none absolute -right-2 bottom-0 hidden opacity-80 lg:block">
            <TelescopeMascot size={120} />
          </div>
        </section>

        {/* 我的探究 */}
        {(continueList.length > 0 || finishedList.length > 0) && (
          <section className="mt-8">
            <h2 className="flex items-center gap-2 text-lg font-bold">
              <Sparkles className="h-5 w-5 text-[var(--exp-sun)]" aria-hidden />
              我的探究
            </h2>
            {continueList.length > 0 ? (
              <ul className="mt-3 grid gap-3 sm:grid-cols-2">
                {continueList.map((info) => (
                  <li key={info.studyId}>
                    <Link
                      href={`/inquiry/study/${info.studyId}`}
                      className="exp-card exp-card-hover flex h-full items-center gap-3 p-4"
                    >
                      <span
                        className="grid h-11 w-11 shrink-0 place-items-center rounded-full text-white"
                        style={{
                          background: `linear-gradient(135deg, ${PHASE_META.question.color}, #3fa5a0)`,
                        }}
                      >
                        <span className="text-[0.8125rem] font-bold">
                          {Math.min(info.phaseIndex + 1, 6)}/6
                        </span>
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[0.9375rem] font-semibold">
                          {info.taskName}
                        </span>
                        <span className="block text-[0.8125rem] text-muted-foreground">
                          正在「{info.phaseTitle}」
                        </span>
                      </span>
                      <span className="exp-pill exp-pill-success shrink-0">继续探究</span>
                    </Link>
                  </li>
                ))}
              </ul>
            ) : null}
            {finishedList.length > 0 ? (
              <div className="mt-3 flex flex-wrap gap-2">
                {finishedList.map((info) => (
                  <Link
                    key={info.studyId}
                    href={`/inquiry/study/${info.studyId}`}
                    className="exp-pill exp-pill-neutral hover:bg-muted"
                  >
                    ✓ 已完成：{info.taskName} · 查看报告
                  </Link>
                ))}
              </div>
            ) : null}
          </section>
        )}

        {/* 示例探究任务（弱化） */}
        <section className="mt-8">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="flex items-center gap-2 text-lg font-bold">
              <FlaskConical className="h-5 w-5 text-primary" aria-hidden />
              示例探究任务
            </h2>
            <span className="text-[0.8125rem] text-muted-foreground">
              想先看看完整的探究长什么样，可以从这个任务开始
            </span>
          </div>
          {error ? <p className="mt-2 text-[0.875rem] text-muted-foreground">{error}</p> : null}
          {tasks === null && !error ? (
            <div className="mt-3">
              <Loading text="正在读取示例任务…" />
            </div>
          ) : null}
          {tasks !== null && presets.length === 0 ? (
            <div className="exp-card mt-3">
              <EmptyState title="还没有可用的示例任务" hint="直接在上面提出问题就能开始探究。" />
            </div>
          ) : null}
          <ul className="mt-3 grid gap-3 sm:grid-cols-2">
            {presets.map((task) => (
              <li key={task.key}>
                <Link
                  href={`/inquiry/${task.key}`}
                  className="exp-card exp-card-hover group flex items-center gap-4 p-4"
                >
                  <span className="shrink-0 rounded-2xl bg-[var(--exp-sky-soft)] p-1.5">
                    <TankScene size={64} />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex flex-wrap items-center gap-1.5">
                      <span className="text-[0.9375rem] font-bold">{task.name}</span>
                      {task.draft ? <ExpPill tone="warn">试测版</ExpPill> : null}
                    </span>
                    <span className="mt-0.5 block text-[0.8125rem] text-muted-foreground">
                      适合 {task.grade} 年级 · 体验完整的六步探究
                    </span>
                  </span>
                  <ArrowRight
                    className="h-4 w-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5"
                    aria-hidden
                  />
                </Link>
              </li>
            ))}
          </ul>
        </section>
      </main>
    </ExploreShell>
  );
}
