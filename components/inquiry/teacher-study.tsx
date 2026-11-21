'use client';

/**
 * 教师端学生详情：原始记录 / 导师对话 / 学习报告 三段式，
 * 保留全部原始数据与审核操作；报告使用技术版视图。
 */
import Link from 'next/link';
import {
  ArrowLeft,
  CircleAlert,
  FileText,
  GraduationCap,
  Lightbulb,
  MessageCircleQuestion,
  ScrollText,
  ShieldAlert,
  UserCheck,
} from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';

import { cn } from '@/lib/utils';
import type { InquirySessionState, InquiryTask } from '@/lib/inquiry/domain/types';
import type { InquiryReportDocument } from '@/lib/inquiry/evaluation/report';

import { ExploreShell } from './exp-shell';
import { ExpButton, ExpPill, Loading, PHASE_META } from './exp-ui';
import { ReportView } from './report-view';
import { readTeacherToken, teacherHeaders } from './teacher-token';

interface StudyDetail {
  studyId: string;
  revision: number;
  status: string;
  learnerKey: string;
  task: InquiryTask;
  state: InquirySessionState;
  report: {
    revision: number;
    status: string;
    document: InquiryReportDocument;
    studyRevision: number;
    stale: boolean;
    currentStudyRevision: number;
  } | null;
  versions: { revision: number; status: string; studyRevision: number }[];
}

type Section = 'records' | 'chat' | 'report';

export function TeacherStudy({ studyId }: { studyId: string }) {
  const [token, setToken] = useState('');
  const [detail, setDetail] = useState<StudyDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [reviewer, setReviewer] = useState('');
  const [comment, setComment] = useState('');
  const [section, setSection] = useState<Section>('records');
  const recordsRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setToken(readTeacherToken());
  }, []);

  const load = useCallback(
    async (activeToken: string) => {
      if (!activeToken) return;
      try {
        const response = await fetch(
          `/api/inquiry/teacher/studies/${encodeURIComponent(studyId)}`,
          { headers: teacherHeaders(activeToken), cache: 'no-store' },
        );
        if (response.status === 404) {
          setError('教师端未启用，或没有这条记录。');
          return;
        }
        if (response.status === 401) {
          setError('教师口令不正确。');
          return;
        }
        setDetail((await response.json()) as StudyDetail);
        setError(null);
      } catch {
        setError('暂时无法读取学生记录。');
      }
    },
    [studyId],
  );

  useEffect(() => {
    void load(token);
  }, [load, token]);

  const generate = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(
        `/api/inquiry/teacher/studies/${encodeURIComponent(studyId)}/report`,
        { method: 'POST', headers: teacherHeaders(token) },
      );
      const body = (await response.json().catch(() => ({}))) as { error?: string };
      if (!response.ok) {
        setError(body.error ?? '报告生成失败。');
        return;
      }
      await load(token);
    } catch {
      setError('网络中断，报告生成失败。');
    } finally {
      setBusy(false);
    }
  };

  const review = async (status: 'approved' | 'needs_revision') => {
    if (!reviewer.trim()) {
      setError('请填写审核人姓名。');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(
        `/api/inquiry/teacher/studies/${encodeURIComponent(studyId)}/report/review`,
        {
          method: 'POST',
          headers: { ...teacherHeaders(token), 'Content-Type': 'application/json' },
          body: JSON.stringify({
            reviewer: reviewer.trim(),
            status,
            ...(comment.trim() ? { comment: comment.trim() } : {}),
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
    } finally {
      setBusy(false);
    }
  };

  const jumpTo = (target: Section) => {
    setSection(target);
    if (target === 'records') {
      recordsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  };

  if (!token) {
    return (
      <ExploreShell variant="teacher">
        <main className="mx-auto max-w-3xl px-4 py-16 text-[0.9375rem]">
          请先在{' '}
          <Link href="/teacher" className="text-primary underline-offset-4 hover:underline">
            教师端首页
          </Link>{' '}
          输入教师口令。
        </main>
      </ExploreShell>
    );
  }

  const sectionTabs: { key: Section; label: string; icon: typeof ScrollText }[] = [
    { key: 'records', label: '原始记录', icon: ScrollText },
    { key: 'chat', label: '导师对话', icon: MessageCircleQuestion },
    { key: 'report', label: '学习报告', icon: FileText },
  ];

  return (
    <ExploreShell variant="teacher" wide>
      <main className="mx-auto max-w-[1400px] px-4 pb-6 pt-4">
        <Link
          href="/teacher"
          className="inline-flex items-center gap-1 text-[0.8125rem] text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-3.5 w-3.5" aria-hidden />
          教师工作台
        </Link>
        {error ? (
          <div className="exp-note exp-note-danger mt-4 text-[0.875rem]">{error}</div>
        ) : null}
        {!detail ? (
          <div className="mt-8">
            <Loading text="正在读取学生记录…" />
          </div>
        ) : (
          <>
            {/* 摘要条 */}
            <header className="exp-card mt-2 flex flex-wrap items-center justify-between gap-3 p-4">
              <div className="min-w-0">
                <h1 className="text-xl font-bold">{detail.task.name}</h1>
                <p className="mt-1 text-[0.8125rem] text-muted-foreground">
                  匿名学习者 {detail.learnerKey} · 状态 {detail.status}
                  {detail.report
                    ? ` · 报告 r${detail.report.revision}（${detail.report.status}）`
                    : ' · 暂无报告'}
                </p>
              </div>
              <ExpButton size="sm" onClick={generate} disabled={busy || detail.status !== 'completed'}>
                {busy ? '请稍候…' : detail.report ? '重新生成报告' : '生成学习报告'}
              </ExpButton>
            </header>
            {detail.status !== 'completed' ? (
              <p className="mt-2 text-[0.8125rem] text-muted-foreground">
                学生尚未完成全部六个阶段，暂不能生成正式报告。
              </p>
            ) : null}

            {/* 区块导航 */}
            <nav className="mt-4 flex gap-2" aria-label="内容区块">
              {sectionTabs.map((tab) => (
                <button
                  key={tab.key}
                  type="button"
                  onClick={() => jumpTo(tab.key)}
                  className={cn(
                    'flex min-h-10 items-center gap-2 rounded-xl border-2 px-3.5 text-[0.8125rem] font-semibold transition-colors',
                    section === tab.key
                      ? 'border-primary bg-[var(--primary-soft)] text-primary'
                      : 'border-border bg-card text-muted-foreground hover:border-ring',
                  )}
                >
                  <tab.icon className="h-4 w-4" aria-hidden />
                  {tab.label}
                </button>
              ))}
            </nav>

            <div ref={recordsRef} className="scroll-mt-24">
              {/* 原始记录 */}
              <section className="mt-5">
                <h2 className="flex items-center gap-2 text-lg font-bold">
                  <ScrollText className="h-5 w-5 text-primary" aria-hidden />
                  学生原始记录
                </h2>
                <div className="mt-3 grid gap-3 lg:grid-cols-2">
                  {detail.task.phases.map((phase, index) => {
                    const progress = detail.state.phases[index];
                    const collected = detail.state.collected[phase.id];
                    const latest = collected.submissions[collected.submissions.length - 1];
                    const meta = PHASE_META[phase.id];
                    const Icon = meta.icon;
                    return (
                      <div key={phase.id} className="exp-card p-4">
                        <div className="flex items-center justify-between gap-2">
                          <p className="flex items-center gap-2 text-[0.875rem] font-bold">
                            <Icon className="h-4 w-4" style={{ color: meta.color }} aria-hidden />
                            {index + 1}. {phase.title}
                          </p>
                          <ExpPill tone={progress?.status === 'completed' ? 'success' : progress?.status === 'invalidated' ? 'danger' : 'neutral'}>
                            {progress?.status ?? 'pending'}
                          </ExpPill>
                        </div>
                        <p className="mt-2 whitespace-pre-wrap rounded-xl bg-muted/60 px-3 py-2 text-[0.8125rem] leading-5 text-muted-foreground">
                          {latest ? (
                            <>
                              {latest.content.text
                                ? latest.content.text
                                : `材料：${(latest.content.materialIds ?? []).join('、') || '—'}；改变：${latest.content.changedCondition || '—'}；保持：${latest.content.keptConditions || '—'}；观察：${latest.content.observedTarget || '—'}`}
                            </>
                          ) : (
                            '（尚无提交）'
                          )}
                        </p>
                        {phase.id === 'evidence' ? (
                          <p className="mt-2 text-[0.75rem] text-muted-foreground">
                            实验 {collected.experiments.length} 次
                            {collected.experiments.length
                              ? `：${collected.experiments
                                  .map((experiment) => `${experiment.materialId}/${experiment.liquidId}→${experiment.result.observed}`)
                                  .join('、')}`
                              : ''}
                          </p>
                        ) : null}
                      </div>
                    );
                  })}
                </div>

                <div className="mt-3 grid gap-3 lg:grid-cols-2">
                  <div className="exp-card p-4">
                    <p className="flex items-center gap-2 text-[0.875rem] font-bold">
                      <Lightbulb className="h-4 w-4 text-[var(--exp-sun)]" aria-hidden />
                      提示与求助
                    </p>
                    <p className="mt-2 text-[0.8125rem] text-muted-foreground">
                      求助次数：
                      {detail.state.phases.reduce((total, phase) => total + phase.hint.log.length, 0)} ·
                      导师对话：{detail.state.conversation.length} 条
                    </p>
                    <ul className="mt-2 space-y-1 text-[0.75rem] text-muted-foreground">
                      {detail.state.phases.flatMap((phase, phaseIndex) =>
                        phase.hint.log.map((hint) => (
                          <li key={hint.seq}>
                            {detail.task.phases[phaseIndex]?.id ?? ''} · L{hint.level} ·{' '}
                            {hint.type ?? '未分类'}
                            {hint.explicit ? ' · 主动求助' : ''}
                          </li>
                        )),
                      )}
                    </ul>
                  </div>
                  <div className="exp-card p-4">
                    <p className="flex items-center gap-2 text-[0.875rem] font-bold">
                      <ShieldAlert className="h-4 w-4 text-[var(--destructive)]" aria-hidden />
                      安全标记
                    </p>
                    {detail.state.safetyFlags.length ? (
                      detail.state.safetyFlags.map((flag, index) => (
                        <p key={`${flag.seq}-${index}`} className="mt-1 text-[0.8125rem] text-[#b07000] dark:text-[#f0c26a]">
                          <CircleAlert className="mr-1 inline h-3.5 w-3.5" aria-hidden />
                          {flag.phaseId} · {flag.kind === 'unsafe' ? '危险请求' : '提示注入'}（seq {flag.seq}）
                        </p>
                      ))
                    ) : (
                      <p className="mt-2 text-[0.8125rem] text-muted-foreground">无安全标记。</p>
                    )}
                  </div>
                </div>
              </section>

              {/* 导师对话 */}
              <section className="mt-8">
                <h2 className="flex items-center gap-2 text-lg font-bold">
                  <GraduationCap className="h-5 w-5 text-[var(--exp-teal)]" aria-hidden />
                  导师对话记录（{detail.state.conversation.length} 条）
                </h2>
                {detail.state.conversation.length ? (
                  <div className="exp-card mt-3 space-y-2.5 p-4">
                    {detail.state.conversation.map((message) => (
                      <div
                        key={message.id}
                        className={cn('flex gap-2', message.role === 'student' && 'flex-row-reverse')}
                      >
                        <span
                          className={cn(
                            'mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-full text-[0.6875rem] font-bold',
                            message.role === 'student' ? 'bg-[var(--primary-soft)] text-primary' : 'bg-[var(--exp-teal-soft)] text-[var(--exp-teal)]',
                          )}
                        >
                          {message.role === 'student' ? '生' : '导'}
                        </span>
                        <p
                          className={cn(
                            'max-w-[75%] whitespace-pre-wrap rounded-2xl px-3 py-2 text-[0.8125rem] leading-5',
                            message.role === 'student'
                              ? 'bg-[var(--primary-soft)] text-[var(--secondary-foreground)]'
                              : 'bg-muted',
                          )}
                        >
                          {message.text}
                        </p>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="mt-3 text-[0.8125rem] text-muted-foreground">还没有对话记录。</p>
                )}
              </section>

              {/* 学习报告 */}
              <section className="mt-8">
                <div className="flex flex-wrap items-center gap-2">
                  <h2 className="flex items-center gap-2 text-lg font-bold">
                    <FileText className="h-5 w-5 text-primary" aria-hidden />
                    学习报告
                  </h2>
                  {detail.report ? (
                    <span className="text-[0.75rem] text-muted-foreground">
                      版本 r{detail.report.revision} · 关联记录 r{detail.report.studyRevision}
                      {detail.report.stale ? ' · 报告已过期' : ''}
                    </span>
                  ) : null}
                </div>
                {detail.report ? (
                  <>
                    {/* 审核操作 */}
                    <div className="exp-card mt-3 flex flex-wrap items-end gap-3 p-4">
                      <label className="space-y-1">
                        <span className="block text-[0.75rem] font-semibold text-muted-foreground">审核人</span>
                        <input
                          className="h-10 w-32 rounded-xl border-[1.5px] border-input bg-card px-3 text-[0.8125rem]"
                          value={reviewer}
                          onChange={(event) => setReviewer(event.target.value)}
                          placeholder="你的姓名"
                        />
                      </label>
                      <label className="min-w-52 flex-1 space-y-1">
                        <span className="block text-[0.75rem] font-semibold text-muted-foreground">审核备注</span>
                        <input
                          className="h-10 w-full rounded-xl border-[1.5px] border-input bg-card px-3 text-[0.8125rem]"
                          value={comment}
                          onChange={(event) => setComment(event.target.value)}
                          placeholder="可选"
                        />
                      </label>
                      <ExpButton size="sm" disabled={busy} onClick={() => void review('approved')}>
                        <UserCheck className="h-4 w-4" aria-hidden />
                        审核通过
                      </ExpButton>
                      <ExpButton size="sm" variant="outline" disabled={busy} onClick={() => void review('needs_revision')}>
                        需要修改
                      </ExpButton>
                      <span className="text-[0.75rem] text-muted-foreground">
                        本报告由 AI 生成；审核结果会保留为新的报告版本。
                      </span>
                    </div>
                    <div className="exp-card mt-4 p-4 sm:p-5">
                      <ReportView document={detail.report.document} stale={detail.report.stale} variant="teacher" />
                    </div>
                    {detail.versions.length > 1 ? (
                      <p className="mt-3 text-[0.75rem] text-muted-foreground">
                        历史报告版本：{detail.versions.map((version) => `r${version.revision}`).join('、')}
                      </p>
                    ) : null}
                  </>
                ) : (
                  <p className="mt-3 text-[0.8125rem] text-muted-foreground">还没有生成学习报告。</p>
                )}
              </section>
            </div>
          </>
        )}
      </main>
    </ExploreShell>
  );
}
