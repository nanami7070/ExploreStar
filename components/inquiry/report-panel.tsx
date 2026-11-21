'use client';

/**
 * 学生学习报告面板：生成 / 刷新 / 版本历史（学生版）。
 * 报告生成是服务端行为（规则评价 + 模型评价 + 版本化），前端只触发。
 */
import { FileText, RefreshCw } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';

import type { InquiryReportDocument } from '@/lib/inquiry/evaluation/report';

import { ExpButton, Loading } from './exp-ui';
import { ReportView } from './report-view';

interface CurrentReportPayload {
  revision: number;
  status: string;
  document: InquiryReportDocument;
  studyRevision: number;
  evaluationVersion: string;
  stale: boolean;
  currentStudyRevision: number;
}

interface VersionSummary {
  revision: number;
  status: string;
  studyRevision: number;
  evaluationVersion: string;
  generatedAt?: string;
}

export function InquiryReportPanel({
  studyId,
  completed,
}: {
  studyId: string;
  completed: boolean;
}) {
  const [report, setReport] = useState<CurrentReportPayload | null>(null);
  const [versions, setVersions] = useState<VersionSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!completed) return;
    setLoading(true);
    try {
      const response = await fetch(`/api/inquiry/study/${encodeURIComponent(studyId)}/report`, {
        cache: 'no-store',
      });
      const body = (await response.json().catch(() => ({}))) as {
        report?: CurrentReportPayload | null;
        versions?: VersionSummary[];
      };
      if (!response.ok) throw new Error('load failed');
      setReport(body.report ?? null);
      setVersions(body.versions ?? []);
      setError(null);
    } catch {
      setError('暂时无法读取学习报告。');
    } finally {
      setLoading(false);
    }
  }, [completed, studyId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const generate = async () => {
    if (generating) return;
    setGenerating(true);
    setError(null);
    try {
      const response = await fetch(`/api/inquiry/study/${encodeURIComponent(studyId)}/report`, {
        method: 'POST',
      });
      const body = (await response.json().catch(() => ({}))) as {
        report?: { document: InquiryReportDocument };
        versions?: VersionSummary[];
        error?: string;
      };
      if (!response.ok || !body.report) {
        setError(body.error ?? '学习报告没有生成成功，请稍后再试。');
        return;
      }
      await refresh();
    } catch {
      setError('网络中断了，学习报告没有生成成功。');
    } finally {
      setGenerating(false);
    }
  };

  if (!completed) return null;

  return (
    <section data-testid="student-report" className="exp-card p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <h2 className="flex items-center gap-2 text-lg font-bold">
            <FileText className="h-5 w-5 text-primary" aria-hidden />
            科学探究学习报告
          </h2>
          <p className="mt-1 text-[0.8125rem] text-muted-foreground">
            基于你这次探究的真实记录生成；老师审核后这里会显示审核结果。
          </p>
        </div>
        <ExpButton
          variant={report ? 'outline' : 'primary'}
          size="sm"
          onClick={generate}
          disabled={generating || loading}
        >
          <RefreshCw className={generating ? 'h-3.5 w-3.5 animate-spin' : 'h-3.5 w-3.5'} aria-hidden />
          {generating ? '正在生成…' : report ? '重新生成报告' : '生成学习报告'}
        </ExpButton>
      </div>
      {error ? <p className="mt-3 text-[0.875rem] text-destructive">{error}</p> : null}
      {loading ? (
        <div className="mt-4">
          <Loading text="正在读取报告…" />
        </div>
      ) : null}
      {report ? (
        <div className="mt-5">
          <ReportView document={report.document} stale={report.stale} variant="student" />
          {versions.length > 1 ? (
            <p className="mt-4 text-[0.75rem] text-muted-foreground">
              历史报告版本：{versions.map((version) => `r${version.revision}`).join('、')}（每次重新生成都会保留旧版本）
            </p>
          ) : null}
        </div>
      ) : !loading ? (
        <p className="mt-4 rounded-2xl border border-dashed border-border px-4 py-6 text-center text-[0.875rem] text-muted-foreground">
          还没有生成报告。点击上方按钮，系统会先检查你的记录，再给出六维评价。
        </p>
      ) : null}
    </section>
  );
}
