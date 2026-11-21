'use client';

/**
 * 探知星页面壳：作用域主题 + 顶栏 + 页脚。
 * 学生端（variant="student"）与教师端（variant="teacher"）共用。
 */
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';

import { cn } from '@/lib/utils';

import { BrandMark } from './exp-icons';
import './explore-theme.css';

export function ExploreShell({
  variant = 'student',
  children,
  wide = false,
}: {
  variant?: 'student' | 'teacher';
  children: ReactNode;
  wide?: boolean;
}) {
  const pathname = usePathname();
  const onTeacher = pathname?.startsWith('/teacher');
  const isInquiryHome = pathname === '/inquiry';

  return (
    <div className={cn('explore-theme exp-sky min-h-dvh', variant === 'teacher' && 'exp-teacher')}>
      <header className="exp-topbar">
        <div className={cn('mx-auto flex items-center justify-between gap-3 px-4 py-2.5', wide ? 'max-w-[1400px]' : 'max-w-6xl')}>
          <div className="flex min-w-0 items-center gap-3">
            <Link href="/inquiry" className="exp-brand shrink-0" aria-label="探知星首页">
              <span className="exp-brand-mark">
                <BrandMark size={26} />
              </span>
              <span className="hidden sm:inline">探知星</span>
              {isInquiryHome && !onTeacher ? (
                <h1 className="hidden text-[0.8125rem] font-medium text-muted-foreground md:inline">
                  小学科学探究
                </h1>
              ) : (
                <span className="hidden text-[0.8125rem] font-medium text-muted-foreground md:inline">
                  {onTeacher ? '教师工作台' : '小学科学探究'}
                </span>
              )}
            </Link>
          </div>
          <nav className="flex shrink-0 items-center gap-2">
            {onTeacher ? (
              <Link
                href="/inquiry"
                className="exp-pill exp-pill-neutral hover:bg-muted"
              >
                学生端 →
              </Link>
            ) : (
              <Link
                href="/teacher"
                className="rounded-full px-3 py-1.5 text-[0.8125rem] font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              >
                教师入口
              </Link>
            )}
          </nav>
        </div>
      </header>
      {children}
      <footer className="mx-auto max-w-6xl px-4 pb-8 pt-10">
        <div className="border-t border-border/70 pt-4 text-center text-[0.75rem] leading-relaxed text-muted-foreground">
          探知星 ExploreStar · 小学科学探究智能助教
        </div>
      </footer>
    </div>
  );
}
