'use client';

/**
 * 横向探究进度条（平板与手机使用；桌面端由 PhaseSidebar 承担）。
 * 当前阶段高亮，已完成阶段可点击查看历史（打开抽屉），
 * 阶段推进完全由服务端状态驱动。
 */
import { Check, CircleAlert, History } from 'lucide-react';

import { cn } from '@/lib/utils';
import type { InquirySessionState, InquiryTask } from '@/lib/inquiry/domain/types';

import { PHASE_META } from './exp-ui';

export function PhaseStepper({
  task,
  state,
  disabled,
  onInspect,
}: {
  task: InquiryTask;
  state: InquirySessionState;
  disabled: boolean;
  onInspect: (phaseIndex: number) => void;
}) {
  const currentIndex = state.position.phaseIndex;
  return (
    <ol className="flex gap-2 overflow-x-auto pb-2" aria-label="探究进度">
      {task.phases.map((phase, index) => {
        const progress = state.phases[index];
        const status = progress?.status ?? 'pending';
        const meta = PHASE_META[phase.id];
        const Icon = meta.icon;
        const isCurrent = index === currentIndex;
        const canOpen = !disabled && (status === 'completed' || status === 'invalidated');
        return (
          <li key={phase.id} className="shrink-0">
            <button
              type="button"
              disabled={!canOpen}
              onClick={() => canOpen && onInspect(index)}
              title={canOpen ? '查看这一步的记录' : undefined}
              className={cn(
                'flex items-center gap-2 rounded-2xl border px-3 py-2 text-left transition-colors',
                isCurrent
                  ? 'exp-phase-active border-transparent bg-card shadow-[var(--exp-shadow)]'
                  : 'border-border bg-card/60',
                status === 'pending' && !isCurrent && 'opacity-60',
                status === 'invalidated' && 'border-[color-mix(in_srgb,var(--destructive)_40%,transparent)]',
                canOpen && 'cursor-pointer hover:border-primary/50',
                !canOpen && 'cursor-default',
              )}
              style={isCurrent ? { ['--phase-current' as never]: meta.color } : undefined}
            >
              <span
                className="grid h-8 w-8 shrink-0 place-items-center rounded-lg"
                style={{
                  background: `color-mix(in srgb, ${meta.color} ${isCurrent ? 20 : 12}%, transparent)`,
                  color: meta.color,
                }}
              >
                {status === 'completed' ? (
                  <Check className="h-4 w-4" aria-hidden />
                ) : status === 'invalidated' ? (
                  <CircleAlert className="h-4 w-4" aria-hidden />
                ) : (
                  <Icon className="h-4 w-4" aria-hidden />
                )}
              </span>
              <span className="pr-1">
                <span className={cn('block whitespace-nowrap text-[0.875rem] font-semibold', isCurrent && 'text-primary')}>
                  {index + 1}. {phase.title}
                </span>
                <span className="block text-[0.6875rem] text-muted-foreground">
                  {isCurrent ? '正在这里' : canOpen ? '查看记录' : '待完成'}
                </span>
              </span>
              {canOpen ? <History className="ml-1 h-3.5 w-3.5 text-muted-foreground" aria-hidden /> : null}
            </button>
          </li>
        );
      })}
    </ol>
  );
}
