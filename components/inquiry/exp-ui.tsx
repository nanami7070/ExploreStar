'use client';

/**
 * 探知星设计系统基础组件：按钮 / 徽章 / 提示条 / 空状态 / 加载态，
 * 以及六阶段与评价等级的共享元数据。全部样式来自 explore-theme.css。
 */
import {
  ChartNoAxesColumn,
  CircleCheck,
  FlaskConical,
  Info,
  Lightbulb,
  type LucideIcon,
  PencilRuler,
  RefreshCcw,
  Search,
  Sparkles,
  TriangleAlert,
} from 'lucide-react';
import type { CSSProperties, ReactNode } from 'react';

import { cn } from '@/lib/utils';
import type { PhaseId } from '@/lib/inquiry/domain/types';

/* ------------------------------------------------------------------ */
/* 六阶段元数据                                                        */
/* ------------------------------------------------------------------ */

export const PHASE_META: Record<
  PhaseId,
  { icon: LucideIcon; color: string; short: string }
> = {
  question: { icon: Search, color: 'var(--phase-question)', short: '问题' },
  hypothesis: { icon: Lightbulb, color: 'var(--phase-hypothesis)', short: '假设' },
  'experiment-design': { icon: PencilRuler, color: 'var(--phase-design)', short: '设计' },
  evidence: { icon: FlaskConical, color: 'var(--phase-evidence)', short: '证据' },
  analysis: { icon: ChartNoAxesColumn, color: 'var(--phase-analysis)', short: '分析' },
  reflection: { icon: RefreshCcw, color: 'var(--phase-reflection)', short: '反思' },
};

/** 适龄评价等级表达（量规 L1–L4） */
export const LEVEL_NAMES: Record<number, { name: string; hint: string }> = {
  1: { name: '刚起步', hint: '再试一次会更好' },
  2: { name: '有进展', hint: '已经迈出第一步' },
  3: { name: '很不错', hint: '思考得越来越清楚' },
  4: { name: '小科学家', hint: '做得很出色' },
};

/* ------------------------------------------------------------------ */
/* 按钮                                                                */
/* ------------------------------------------------------------------ */

export function ExpButton({
  variant = 'primary',
  size = 'md',
  className,
  ...props
}: {
  variant?: 'primary' | 'secondary' | 'outline' | 'ghost' | 'soft';
  size?: 'sm' | 'md' | 'lg';
} & React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type="button"
      className={cn(
        'exp-btn',
        `exp-btn-${variant}`,
        size === 'sm' && 'exp-btn-sm',
        size === 'lg' && 'exp-btn-lg',
        className,
      )}
      {...props}
    />
  );
}

/* ------------------------------------------------------------------ */
/* 徽章                                                                */
/* ------------------------------------------------------------------ */

export function ExpPill({
  tone = 'neutral',
  className,
  children,
}: {
  tone?: 'success' | 'info' | 'warn' | 'danger' | 'neutral';
  className?: string;
  children: ReactNode;
}) {
  return <span className={cn('exp-pill', `exp-pill-${tone}`, className)}>{children}</span>;
}

/* ------------------------------------------------------------------ */
/* 提示条                                                              */
/* ------------------------------------------------------------------ */

const NOTE_ICONS: Record<string, LucideIcon> = {
  info: Info,
  warn: TriangleAlert,
  success: CircleCheck,
  danger: TriangleAlert,
  sparkle: Sparkles,
};

export function Note({
  tone = 'info',
  icon,
  title,
  children,
  className,
}: {
  tone?: 'info' | 'warn' | 'success' | 'danger' | 'sparkle';
  icon?: LucideIcon;
  title?: ReactNode;
  children?: ReactNode;
  className?: string;
}) {
  const Icon = icon ?? NOTE_ICONS[tone];
  return (
    <div className={cn('exp-note', `exp-note-${tone === 'sparkle' ? 'warn' : tone}`, className)}>
      <Icon className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
      <div className="min-w-0">
        {title ? <p className="font-semibold">{title}</p> : null}
        {children}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* 空状态与加载态                                                      */
/* ------------------------------------------------------------------ */

export function EmptyState({
  icon: Icon = Search,
  title,
  hint,
  action,
}: {
  icon?: LucideIcon;
  title: string;
  hint?: string;
  action?: ReactNode;
}) {
  return (
    <div className="exp-empty">
      <div className="exp-empty-icon">
        <Icon className="h-6 w-6" aria-hidden />
      </div>
      <p className="font-semibold text-foreground">{title}</p>
      {hint ? <p className="max-w-md">{hint}</p> : null}
      {action}
    </div>
  );
}

export function Loading({ text = '正在加载…' }: { text?: string }) {
  return (
    <span className="exp-loading" role="status">
      <span className="exp-loading-dot" />
      <span className="exp-loading-dot" />
      <span className="exp-loading-dot" />
      <span className="ml-1">{text}</span>
    </span>
  );
}

/* ------------------------------------------------------------------ */
/* 小组件                                                              */
/* ------------------------------------------------------------------ */

/** 带图标的小节标题 */
export function SectionTitle({
  icon: Icon,
  color,
  title,
  hint,
  className,
}: {
  icon?: LucideIcon;
  color?: string;
  title: ReactNode;
  hint?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('flex items-center gap-2.5', className)}>
      {Icon ? (
        <span
          className="grid h-8 w-8 shrink-0 place-items-center rounded-xl"
          style={{ background: `color-mix(in srgb, ${color ?? 'var(--primary)'} 16%, transparent)` }}
        >
          <Icon className="h-4.5 w-4.5" style={{ color }} aria-hidden />
        </span>
      ) : null}
      <div className="min-w-0">
        <h3 className="text-[1.0625rem] font-bold leading-tight">{title}</h3>
        {hint ? <p className="text-[0.8125rem] text-muted-foreground">{hint}</p> : null}
      </div>
    </div>
  );
}

/** 阶段图标徽章（圆形，带阶段色） */
export function PhaseIconBadge({
  phaseId,
  size = 40,
  style,
}: {
  phaseId: PhaseId;
  size?: number;
  style?: CSSProperties;
}) {
  const meta = PHASE_META[phaseId];
  const Icon = meta.icon;
  return (
    <span
      className="grid shrink-0 place-items-center rounded-full"
      style={{
        width: size,
        height: size,
        background: `color-mix(in srgb, ${meta.color} 15%, transparent)`,
        color: meta.color,
        ...style,
      }}
    >
      <Icon style={{ width: size * 0.52, height: size * 0.52 }} aria-hidden />
    </span>
  );
}
