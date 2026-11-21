'use client';

/**
 * 桌面端左侧探究进度栏。
 *
 * 进度完全来自服务端状态（state.phases），前端不能推动阶段；
 * 点击已完成/需重做的阶段打开「历史记录」抽屉（只读查看），
 * 回退操作是抽屉里的显式按钮，不再藏在点击里。
 */
import { Check, CircleAlert, History, RotateCcw, X } from 'lucide-react';
import { useEffect, useRef } from 'react';

import { cn } from '@/lib/utils';
import { effectiveSubmission } from '@/lib/inquiry/domain/types';
import type { InquirySessionState, InquiryTask, PhaseId } from '@/lib/inquiry/domain/types';

import { MaterialGlyph } from './exp-icons';
import { ExpButton, ExpPill, PHASE_META } from './exp-ui';

const STATUS_LABEL: Record<string, string> = {
  pending: '待完成',
  active: '进行中',
  completed: '已完成',
  invalidated: '需要重做',
};

export function PhaseSidebar({
  task,
  state,
  onInspect,
}: {
  task: InquiryTask;
  state: InquirySessionState;
  onInspect: (phaseIndex: number) => void;
}) {
  const currentIndex = state.position.phaseIndex;

  const openable = (index: number, status: string) =>
    status === 'completed' || (status === 'invalidated' && index < currentIndex);

  const doneCount = state.phases.filter((phase) => phase.status === 'completed').length;

  return (
    <aside className="flex min-h-0 flex-col gap-3" aria-label="探究进度">
      <div className="exp-card p-4">
        <p className="text-[0.8125rem] font-semibold text-muted-foreground">探究进度</p>
        <div className="mt-2 flex items-end gap-1.5">
          <span className="text-3xl font-bold leading-none text-primary">{doneCount}</span>
          <span className="pb-0.5 text-[0.8125rem] text-muted-foreground">/ 6 步已完成</span>
        </div>
        {/* 进度条：服务端状态驱动 */}
        <div className="mt-3 h-2.5 overflow-hidden rounded-full bg-muted">
          <div
            className="h-full rounded-full bg-gradient-to-r from-[var(--phase-question)] to-[var(--phase-evidence)] transition-all duration-500"
            style={{ width: `${(doneCount / 6) * 100}%` }}
          />
        </div>
      </div>

      <ol className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto pb-2">
        {task.phases.map((phase, index) => {
          const progress = state.phases[index];
          const status = progress?.status ?? 'pending';
          const meta = PHASE_META[phase.id];
          const Icon = meta.icon;
          const isCurrent = index === currentIndex;
          const canOpen = openable(index, status);
          return (
            <li key={phase.id}>
              <button
                type="button"
                disabled={!canOpen}
                onClick={() => canOpen && onInspect(index)}
                title={canOpen ? '查看这一步的记录' : undefined}
                className={cn(
                  'flex w-full items-center gap-3 rounded-2xl border px-3 py-2.5 text-left transition-colors',
                  isCurrent
                    ? 'exp-phase-active border-transparent bg-card shadow-[var(--exp-shadow)]'
                    : 'border-transparent hover:bg-card/70',
                  status === 'pending' && !isCurrent && 'opacity-60',
                  status === 'invalidated' && 'border-[color-mix(in_srgb,var(--destructive)_35%,transparent)]',
                  canOpen && 'cursor-pointer',
                  !canOpen && 'cursor-default',
                )}
                style={isCurrent ? { ['--phase-current' as never]: meta.color } : undefined}
              >
                <span
                  className="grid h-10 w-10 shrink-0 place-items-center rounded-xl"
                  style={{
                    background: `color-mix(in srgb, ${meta.color} ${isCurrent ? 18 : 12}%, transparent)`,
                    color: meta.color,
                  }}
                >
                  {status === 'completed' ? (
                    <Check className="h-5 w-5" aria-hidden />
                  ) : status === 'invalidated' ? (
                    <CircleAlert className="h-5 w-5" aria-hidden />
                  ) : (
                    <Icon className="h-5 w-5" aria-hidden />
                  )}
                </span>
                <span className="min-w-0 flex-1">
                  <span
                    className={cn(
                      'block truncate text-[0.9375rem] font-semibold',
                      isCurrent && 'text-primary',
                    )}
                  >
                    {index + 1}. {phase.title}
                  </span>
                  <span className="block text-[0.75rem] text-muted-foreground">
                    {isCurrent ? (
                      <span className="inline-flex items-center gap-1 font-medium text-primary">
                        <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-primary" />
                        正在这里
                      </span>
                    ) : (
                      STATUS_LABEL[status]
                    )}
                  </span>
                </span>
                {canOpen ? (
                  <History className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
                ) : null}
              </button>
            </li>
          );
        })}
      </ol>
    </aside>
  );
}

/* ------------------------------------------------------------------ */
/* 历史记录抽屉（只读）                                                */
/* ------------------------------------------------------------------ */

export function PhaseHistoryDrawer({
  task,
  state,
  phaseId,
  disabled,
  onClose,
  onRevert,
}: {
  task: InquiryTask;
  state: InquirySessionState;
  phaseId: PhaseId;
  disabled: boolean;
  onClose: () => void;
  onRevert: () => void;
}) {
  const phase = task.phases.find((candidate) => candidate.id === phaseId);
  const collected = state.collected[phaseId];
  const meta = PHASE_META[phaseId];
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  if (!phase) return null;

  const submissions = collected?.submissions ?? [];
  const effectiveId = effectiveSubmission(collected)?.id;
  const experiments = collected?.experiments ?? [];
  const hintCount = state.phases[task.phases.findIndex((p) => p.id === phaseId)]?.hint.log.length ?? 0;

  return (
    <div
      className="fixed inset-0 z-50 flex justify-end bg-black/25 backdrop-blur-[2px]"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label={`${phase.title}的历史记录`}
    >
      <div
        ref={panelRef}
        className="flex h-full w-full max-w-md flex-col overflow-hidden bg-background shadow-2xl"
        onClick={(event) => event.stopPropagation()}
      >
        <header className="flex items-center justify-between gap-2 border-b border-border px-5 py-4">
          <div className="flex items-center gap-3">
            <span
              className="grid h-10 w-10 place-items-center rounded-xl"
              style={{ background: `color-mix(in srgb, ${meta.color} 14%, transparent)`, color: meta.color }}
            >
              <History className="h-5 w-5" aria-hidden />
            </span>
            <div>
              <h2 className="text-lg font-bold">「{phase.title}」记录</h2>
              <p className="text-[0.8125rem] text-muted-foreground">这里只能查看，不会改变你的探究。</p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="grid h-10 w-10 place-items-center rounded-full text-muted-foreground transition-colors hover:bg-muted"
            aria-label="关闭"
          >
            <X className="h-5 w-5" aria-hidden />
          </button>
        </header>

        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-5 py-4">
          {submissions.length === 0 && experiments.length === 0 ? (
            <div className="exp-empty">
              <p className="font-semibold text-foreground">这一步还没有留下记录</p>
            </div>
          ) : null}

          {submissions.map((submission, index) => (
            <div key={submission.id} className="exp-card p-4">
              <div className="flex items-center justify-between gap-2">
                <ExpPill tone={submission.id === effectiveId ? 'success' : 'neutral'}>
                  {submission.id === effectiveId ? '当前记录' : '历史记录'}
                </ExpPill>
                <span className="text-[0.75rem] text-muted-foreground">第 {index + 1} 次提交</span>
              </div>
              <SubmissionBody content={submission.content} task={task} phaseId={phaseId} />
            </div>
          ))}

          {phaseId === 'evidence' && experiments.length > 0 ? (
            <div className="exp-card p-4">
              <ExpPill tone="info">实验记录（{experiments.length} 次）</ExpPill>
              <ul className="mt-3 space-y-2">
                {experiments.map((experiment) => (
                  <li key={experiment.id} className="flex items-center gap-2 text-[0.875rem]">
                    <span className="font-semibold">第 {experiment.trialNo} 次</span>
                    <MaterialGlyph materialId={experiment.materialId} size={26} />
                    <span>{task.materials.find((m) => m.id === experiment.materialId)?.name ?? experiment.materialId}</span>
                    <span className="text-muted-foreground">
                      · {task.liquids.find((l) => l.id === experiment.liquidId)?.name ?? experiment.liquidId}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          {hintCount > 0 ? (
            <p className="text-[0.8125rem] text-muted-foreground">
              这一步里你向导师求助了 {hintCount} 次。
            </p>
          ) : null}
        </div>

        <footer className="border-t border-border px-5 py-4">
          <ExpButton
            variant="outline"
            className="w-full"
            disabled={disabled}
            onClick={() => {
              if (
                window.confirm(
                  `回到「${phase.title}」重新探究吗？后面的记录会保留，但需要重新完成并确认。`,
                )
              ) {
                onRevert();
                onClose();
              }
            }}
          >
            <RotateCcw className="h-4 w-4" aria-hidden />
            回到这一步重新探究
          </ExpButton>
        </footer>
      </div>
    </div>
  );
}

/** 按阶段渲染提交内容（只读） */
function SubmissionBody({
  content,
  task,
  phaseId,
}: {
  content: {
    text?: string;
    reason?: string;
    materialIds?: string[];
    changedCondition?: string;
    keptConditions?: string;
    observedTarget?: string;
    safetyConfirmed?: boolean;
  };
  task: InquiryTask;
  phaseId: PhaseId;
}) {
  if (phaseId === 'experiment-design') {
    return (
      <div className="mt-3 space-y-2 text-[0.9375rem]">
        <p>
          <span className="text-muted-foreground">选择的材料：</span>
          <span className="mt-1 flex flex-wrap gap-1.5">
            {(content.materialIds ?? []).map((id) => (
              <span key={id} className="inline-flex items-center gap-1 rounded-lg bg-muted px-2 py-1 text-[0.8125rem]">
                <MaterialGlyph materialId={id} size={20} />
                {task.materials.find((m) => m.id === id)?.name ?? id}
              </span>
            ))}
          </span>
        </p>
        <p><span className="text-muted-foreground">要改变的条件：</span>{content.changedCondition || '—'}</p>
        <p><span className="text-muted-foreground">保持不变的条件：</span>{content.keptConditions || '—'}</p>
        <p><span className="text-muted-foreground">要观察什么：</span>{content.observedTarget || '—'}</p>
        <p><span className="text-muted-foreground">安全确认：</span>{content.safetyConfirmed ? '已确认' : '未确认'}</p>
      </div>
    );
  }
  return (
    <div className="mt-3 space-y-2 text-[0.9375rem] leading-7">
      {content.text ? <p className="whitespace-pre-wrap">{content.text}</p> : null}
      {content.reason ? (
        <p className="text-muted-foreground">
          <span className="font-medium text-foreground">理由：</span>
          {content.reason}
        </p>
      ) : null}
    </div>
  );
}
