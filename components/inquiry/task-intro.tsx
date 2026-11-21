'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ArrowLeft, MessageCircleQuestion, ShieldCheck, Star } from 'lucide-react';
import { useEffect, useState } from 'react';

import { FLOAT_SINK_TASK } from '@/lib/inquiry/tasks/float-sink';

import { ExploreShell } from './exp-shell';
import { LiquidGlyph, MaterialGlyph, TankScene } from './exp-icons';
import { ExpButton, ExpPill, Loading, PHASE_META } from './exp-ui';
import { rememberStudy } from './recent-studies';

interface TaskSummary {
  key: string;
  name: string;
  grade: string;
  goals: string[];
  intro: { title: string; text: string };
  published: boolean;
  draft: boolean;
}

export function TaskIntro({ taskKey }: { taskKey: string }) {
  const router = useRouter();
  const [task, setTask] = useState<TaskSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);

  // 任务配置（材料、安全提醒）来自已教研审核的静态任务定义，不是模型输出。
  const taskConfig = taskKey === FLOAT_SINK_TASK.key ? FLOAT_SINK_TASK : null;

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const response = await fetch('/api/inquiry/tasks', { cache: 'no-store' });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const body = (await response.json()) as { tasks: TaskSummary[] };
        if (cancelled) return;
        const found = body.tasks.find((candidate) => candidate.key === taskKey) ?? null;
        setTask(found);
        if (!found) setError('没有找到这个探究任务。');
      } catch {
        if (!cancelled) setError('暂时无法读取任务，请稍后刷新。');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [taskKey]);

  const start = async () => {
    if (!task || starting) return;
    setStarting(true);
    setError(null);
    try {
      const commandId =
        typeof crypto !== 'undefined' && 'randomUUID' in crypto
          ? crypto.randomUUID()
          : `create-${Date.now()}`;
      const response = await fetch('/api/inquiry/study', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ taskKey: task.key, commandId }),
      });
      const body = (await response.json().catch(() => ({}))) as Record<string, unknown>;
      if (!response.ok || typeof body.studyId !== 'string') {
        setError(typeof body.error === 'string' ? body.error : '暂时无法开始探究，请稍后再试。');
        return;
      }
      rememberStudy({ studyId: body.studyId, taskKey: task.key, taskName: task.name });
      router.push(`/inquiry/study/${body.studyId}`);
    } catch {
      setError('网络中断了，请再试一次。');
    } finally {
      setStarting(false);
    }
  };

  return (
    <ExploreShell>
      <main className="mx-auto max-w-3xl px-4 pb-4 pt-6">
        <Link
          href="/inquiry"
          className="inline-flex items-center gap-1.5 rounded-full px-2 py-1.5 text-[0.875rem] font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" aria-hidden />
          返回探究任务
        </Link>

        {!task && !error ? (
          <div className="mt-8">
            <Loading text="正在准备任务…" />
          </div>
        ) : null}
        {error ? <p className="mt-6 text-[0.9375rem] text-destructive">{error}</p> : null}

        {task ? (
          <article className="exp-fade-up mt-4 space-y-5">
            {/* 标题区 */}
            <section className="exp-card overflow-hidden">
              <div className="flex flex-col gap-4 p-6 sm:flex-row sm:items-center sm:gap-6 sm:p-8">
                <div className="shrink-0 self-start rounded-3xl bg-[var(--exp-sky-soft)] p-3 sm:self-center">
                  <TankScene size={110} />
                </div>
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <ExpPill tone="info">适合 {task.grade} 年级</ExpPill>
                    {task.draft ? <ExpPill tone="warn">试测版 · 尚未完成教研审核</ExpPill> : null}
                  </div>
                  <h1 className="mt-2 text-2xl font-bold leading-snug sm:text-3xl">{task.name}</h1>
                  <p className="mt-2 text-[0.9375rem] leading-6 text-muted-foreground">
                    跟着下面的步骤，当一次真正的小科学家。
                  </p>
                </div>
              </div>
            </section>

            {/* 情境问题 */}
            <section className="exp-card p-6 sm:p-8">
              <div className="flex items-start gap-4">
                <span className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-[var(--exp-sun-soft)] text-[var(--exp-sun)]">
                  <MessageCircleQuestion className="h-6 w-6" aria-hidden />
                </span>
                <div className="min-w-0">
                  <h2 className="text-[0.8125rem] font-semibold tracking-wide text-[var(--exp-sun)]">
                    一个生活中的问题
                  </h2>
                  <h3 className="mt-1 text-lg font-bold leading-snug">{task.intro?.title || '情境导入'}</h3>
                  <p className="mt-2 text-[1rem] leading-8 text-muted-foreground">{task.intro?.text}</p>
                </div>
              </div>
            </section>

            {/* 探究目标 */}
            {task.goals.length > 0 ? (
              <section className="exp-card p-6 sm:p-8">
                <h2 className="text-lg font-bold">这次探究你要做到</h2>
                <ul className="mt-3 space-y-2.5">
                  {task.goals.map((goal, index) => (
                    <li key={goal} className="flex items-start gap-3">
                      <span className="mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-full bg-[var(--primary-soft)] text-[0.75rem] font-bold text-primary">
                        {index + 1}
                      </span>
                      <span className="text-[0.9375rem] leading-6">{goal}</span>
                    </li>
                  ))}
                </ul>
              </section>
            ) : null}

            {/* 实验材料（真实任务数据） */}
            {taskConfig ? (
              <section className="exp-card p-6 sm:p-8">
                <h2 className="text-lg font-bold">实验室里有什么</h2>
                <p className="mt-1 text-[0.8125rem] text-muted-foreground">
                  两种液体和六种材料，已经摆在实验台上了。
                </p>
                <div className="mt-4 space-y-3">
                  <div>
                    <p className="mb-2 text-[0.8125rem] font-semibold text-muted-foreground">液体</p>
                    <div className="flex flex-wrap gap-2.5">
                      {taskConfig.liquids.map((liquid) => (
                        <span
                          key={liquid.id}
                          className="inline-flex items-center gap-2 rounded-xl border border-border bg-muted/60 px-3 py-2 text-[0.9375rem] font-medium"
                        >
                          <LiquidGlyph liquidId={liquid.id} />
                          {liquid.name}
                        </span>
                      ))}
                    </div>
                  </div>
                  <div>
                    <p className="mb-2 text-[0.8125rem] font-semibold text-muted-foreground">材料</p>
                    <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3">
                      {taskConfig.materials.map((material) => (
                        <span
                          key={material.id}
                          className="flex items-center gap-2.5 rounded-xl border border-border bg-card px-3 py-2.5 text-[0.9375rem] font-medium shadow-[var(--exp-shadow-sm)]"
                        >
                          <MaterialGlyph materialId={material.id} />
                          {material.name}
                        </span>
                      ))}
                    </div>
                  </div>
                </div>
              </section>
            ) : null}

            {/* 探究流程 */}
            <section className="exp-card p-6 sm:p-8">
              <h2 className="text-lg font-bold">探究地图</h2>
              <p className="mt-1 text-[0.8125rem] text-muted-foreground">
                六步走完，你就是完成了一次完整科学探究的小科学家。
              </p>
              <ol className="mt-4 space-y-2.5">
                {taskConfig?.phases.map((phase, index) => {
                  const meta = PHASE_META[phase.id];
                  const Icon = meta.icon;
                  return (
                    <li key={phase.id} className="flex items-center gap-3">
                      <span
                        className="grid h-9 w-9 shrink-0 place-items-center rounded-xl"
                        style={{
                          background: `color-mix(in srgb, ${meta.color} 14%, transparent)`,
                          color: meta.color,
                        }}
                      >
                        <Icon className="h-4.5 w-4.5" aria-hidden />
                      </span>
                      <span className="text-[0.9375rem]">
                        <strong className="font-semibold">
                          {index + 1}. {phase.title}
                        </strong>
                        <span className="ml-2 text-muted-foreground">{phase.goal}</span>
                      </span>
                    </li>
                  );
                })}
              </ol>
              <p className="mt-4 rounded-xl bg-muted/70 px-4 py-3 text-[0.875rem] leading-6 text-muted-foreground">
                在每一步，导师都会用问题帮助你思考，但不会直接告诉你结论。
              </p>
            </section>

            {/* 安全提醒 */}
            {taskConfig ? (
              <section className="exp-note exp-note-warn">
                <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-[var(--exp-sun)]" aria-hidden />
                <div>
                  <p className="font-semibold">实验安全提醒（请先读一读）</p>
                  <ul className="mt-1 list-inside list-disc space-y-0.5">
                    {taskConfig.safety.map((item) => (
                      <li key={item}>{item}</li>
                    ))}
                  </ul>
                </div>
              </section>
            ) : null}

            {/* 开始按钮 */}
            <div className="flex flex-col items-center gap-3 py-4">
              <ExpButton size="lg" onClick={start} disabled={starting} className="px-10 text-lg">
                {starting ? '正在准备实验室…' : (
                  <>
                    <Star className="h-5 w-5" aria-hidden />
                    开始我的探究
                  </>
                )}
              </ExpButton>
              <p className="text-[0.8125rem] text-muted-foreground">
                开始后可以随时退出，下次回来从离开的地方继续。
              </p>
            </div>
          </article>
        ) : null}
      </main>
    </ExploreShell>
  );
}
