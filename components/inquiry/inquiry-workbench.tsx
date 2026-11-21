'use client';

/**
 * 探究工作台：响应式三栏。
 *
 * - 桌面（≥1280px）：左进度栏 | 中活动区 | 右导师（单实例、CSS 网格）。
 * - 平板/手机：横向进度条 + 「探究活动 / 科学导师」标签切换。
 * - 阶段推进、回退、报告全部来自服务端真实状态。
 */
import Link from 'next/link';
import {
  ArrowLeft,
  ClipboardCheck,
  type LucideIcon,
  MessageCircleQuestion,
  PartyPopper,
} from 'lucide-react';
import { useEffect, useState } from 'react';

import { cn } from '@/lib/utils';
import type { PhaseId } from '@/lib/inquiry/domain/types';

import { ExploreShell } from './exp-shell';
import { ExpPill, Loading } from './exp-ui';
import { PhaseHistoryDrawer, PhaseSidebar } from './phase-sidebar';
import { PhasePanel } from './phase-panel';
import { PhaseStepper } from './phase-stepper';
import { InquiryReportPanel } from './report-panel';
import { rememberStudy } from './recent-studies';
import { TutorChat } from './tutor-chat';
import { useInquiryStudy } from './use-inquiry-study';

export function InquiryWorkbench({ studyId }: { studyId: string }) {
  const {
    snapshot,
    loading,
    error,
    notice,
    busy,
    streaming,
    streamingText,
    pending,
    act,
    send,
    retrySend,
  } = useInquiryStudy(studyId);

  const [tab, setTab] = useState<'activity' | 'tutor'>('activity');
  const [historyPhase, setHistoryPhase] = useState<PhaseId | null>(null);

  // 记住本次探究，供首页「继续探究」使用（副作用放 effect）
  useEffect(() => {
    if (snapshot) {
      rememberStudy({
        studyId: snapshot.studyId,
        taskKey: snapshot.task.key,
        taskName: snapshot.task.name,
      });
    }
  }, [snapshot]);

  if (loading) {
    return (
      <ExploreShell>
        <main className="mx-auto max-w-5xl px-4 py-16 text-center">
          <Loading text="正在打开你的探究记录…" />
        </main>
      </ExploreShell>
    );
  }
  if (error || !snapshot) {
    return (
      <ExploreShell>
        <main className="mx-auto max-w-5xl px-4 py-10">
          <p className="text-[0.9375rem] text-destructive">{error ?? '没有找到这次探究。'}</p>
          <Link
            href="/inquiry"
            className="mt-4 inline-flex items-center gap-1.5 rounded-full bg-primary px-4 py-2 text-[0.875rem] font-semibold text-primary-foreground"
          >
            <ArrowLeft className="h-4 w-4" aria-hidden />
            返回探究任务列表
          </Link>
        </main>
      </ExploreShell>
    );
  }

  const { task, state, revision, status } = snapshot;
  const completed = status === 'completed';
  const currentPhaseId = state.position.phaseId;

  const revertPhase = (phaseIndex: number) => {
    const target = task.phases[phaseIndex];
    if (!target) return;
    void act({ action: 'revert', targetPhaseIndex: phaseIndex, reason: '学生选择重做' });
  };

  const inspectPhase = (phaseIndex: number) => {
    const phase = task.phases[phaseIndex];
    if (phase) setHistoryPhase(phase.id);
  };

  return (
    <ExploreShell wide>
      <main className="mx-auto max-w-[1400px] px-4 pb-6 pt-4">
        {/* 头部 */}
        <header className="flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <Link
                href="/inquiry"
                className="inline-flex items-center gap-1 text-[0.8125rem] text-muted-foreground hover:text-foreground"
              >
                <ArrowLeft className="h-3.5 w-3.5" aria-hidden />
                探究任务
              </Link>
              {task.published ? null : <ExpPill tone="warn">试测版 · 尚未完成教研审核</ExpPill>}
            </div>
            <h1 className="mt-0.5 truncate text-xl font-bold sm:text-2xl">{task.name}</h1>
            <p className="text-[0.8125rem] text-muted-foreground">
              适合 {task.grade} 年级 · 跟着六步探究地图，完成你的科学发现
            </p>
          </div>
          <div className="flex items-center gap-2">
            {completed ? <ExpPill tone="success">探究已完成</ExpPill> : null}
            {!completed && !busy ? (
              <ExpPill tone="info">正在「{task.phases[state.position.phaseIndex]?.title}」</ExpPill>
            ) : null}
          </div>
        </header>

        {/* 平板/手机：标签切换 + 横向进度条 */}
        <div className="mt-3 xl:hidden">
          <div className="flex gap-2" role="tablist" aria-label="工作台区域">
            <TabButton
              active={tab === 'activity'}
              icon={ClipboardCheck}
              label="探究活动"
              onClick={() => setTab('activity')}
            />
            <TabButton
              active={tab === 'tutor'}
              icon={MessageCircleQuestion}
              label="科学导师"
              badge={streaming}
              onClick={() => setTab('tutor')}
            />
          </div>
          <div className="mt-3">
            <PhaseStepper task={task} state={state} disabled={busy || completed} onInspect={inspectPhase} />
          </div>
        </div>

        {/* 完成横幅 */}
        {completed ? (
          <div className="exp-congrats mt-4 flex flex-wrap items-center gap-4 px-5 py-4">
            <span className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-card/80">
              <PartyPopper className="h-6 w-6 text-[var(--exp-sun)]" aria-hidden />
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-[1.0625rem] font-bold">太棒了，你走完了六个探究阶段！</p>
              <p className="text-[0.875rem] leading-6 text-muted-foreground">
                问题、假设、实验设计和每一次实验，都是你亲手完成的。下方可以生成你的学习报告。
              </p>
            </div>
          </div>
        ) : null}

        {/* 三栏主体：单一实例，CSS 响应式（xl 三栏 / 以下标签切换） */}
        <div className="mt-4 grid items-start gap-4 xl:grid-cols-[270px_minmax(0,1fr)_390px]">
          <div className="hidden xl:block">
            <div className="sticky top-[4.5rem] max-h-[calc(100dvh-6rem)]">
              <PhaseSidebar task={task} state={state} onInspect={inspectPhase} />
            </div>
          </div>

          {/* 中栏：活动 + 报告 */}
          <div className={cn('min-w-0', tab !== 'activity' && 'hidden xl:block')}>
            {completed ? (
              <div className="mb-4">
                <InquiryReportPanel studyId={studyId} completed={completed} />
              </div>
            ) : null}
            <PhasePanel task={task} state={state} busy={busy || completed} onAct={act} />
          </div>

          {/* 右栏：导师 */}
          <div className={cn('min-w-0', tab !== 'tutor' && 'hidden xl:block')}>
            <div className="sticky top-[4.5rem] max-h-[calc(100dvh-6rem)]">
              <TutorChat
                conversation={state.conversation}
                streaming={streaming}
                streamingText={streamingText}
                disabled={busy || completed}
                phaseId={currentPhaseId}
                notice={notice}
                canRetry={pending !== null && !streaming}
                onSend={send}
                onRetry={retrySend}
                onHelp={() => void act({ action: 'requestHint', explicit: true })}
              />
            </div>
          </div>
        </div>

        {/* 技术信息下移到此，学生区不再展示 */}
        <p className="mt-6 text-center text-[0.6875rem] text-muted-foreground/70">
          探知星 · 探究记录版本 r{revision}
        </p>
      </main>

      {historyPhase ? (
        <PhaseHistoryDrawer
          task={task}
          state={state}
          phaseId={historyPhase}
          disabled={busy || completed}
          onClose={() => setHistoryPhase(null)}
          onRevert={() => {
            const index = task.phases.findIndex((phase) => phase.id === historyPhase);
            if (index >= 0) revertPhase(index);
          }}
        />
      ) : null}
    </ExploreShell>
  );
}

function TabButton({
  active,
  icon: Icon,
  label,
  badge,
  onClick,
}: {
  active: boolean;
  icon: LucideIcon;
  label: string;
  badge?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className={cn(
        'flex min-h-11 flex-1 items-center justify-center gap-2 rounded-2xl border-2 text-[0.9375rem] font-semibold transition-colors',
        active
          ? 'border-primary bg-card text-primary shadow-[var(--exp-shadow-sm)]'
          : 'border-border bg-card/60 text-muted-foreground',
      )}
    >
      <span className="relative">
        <Icon className="h-4.5 w-4.5" aria-hidden />
        {badge ? (
          <span className="absolute -right-1 -top-1 h-2 w-2 animate-pulse rounded-full bg-primary" />
        ) : null}
      </span>
      {label}
    </button>
  );
}
