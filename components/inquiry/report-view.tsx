'use client';

/**
 * 学习报告视图。
 *
 * variant="student"：适龄表达——六维等级条 + 友好等级名 + 折叠证据，
 * 隐藏技术元数据；variant="teacher"：保留全部技术信息。
 * 评价依据与原始证据在两种视图下都完整保留。
 */
import { ArrowRight, BookOpen, ChevronDown, Compass, Lightbulb, UserCheck } from 'lucide-react';
import { useState } from 'react';

import { cn } from '@/lib/utils';
import { rubricFor } from '@/lib/inquiry/evaluation/rubric';
import type { InquiryReportDocument } from '@/lib/inquiry/evaluation/report';
import type { DimensionEvaluation } from '@/lib/inquiry/evaluation/types';
import type { PhaseId } from '@/lib/inquiry/domain/types';

import { ExpPill, LEVEL_NAMES, PHASE_META, PhaseIconBadge } from './exp-ui';

const PHASE_ORDER: readonly PhaseId[] = [
  'question',
  'hypothesis',
  'experiment-design',
  'evidence',
  'analysis',
  'reflection',
];

export function ReportView({
  document,
  stale,
  variant = 'student',
}: {
  document: InquiryReportDocument;
  stale?: boolean;
  variant?: 'student' | 'teacher';
}) {
  const teacher = variant === 'teacher';
  return (
    <article data-testid="report-view" className="space-y-5">
      {/* 头部：状态 + 审核 */}
      <header className="exp-card p-5">
        <div className="flex flex-wrap items-center gap-2.5">
          <h2 className="text-lg font-bold">{document.task.name} · 学习报告</h2>
          <ReportStatusBadge status={document.status} />
          {stale ? <ExpPill tone="warn">报告已过期：探究内容在生成后有变化</ExpPill> : null}
        </div>
        <p className="mt-2 text-[0.8125rem] text-muted-foreground">
          生成时间：{new Date(document.generatedAt).toLocaleString('zh-CN')}
          {teacher ? (
            <>
              {' '}
              · 报告版本 r{document.studyRevision} · 评价版本 {document.evaluationVersion} · 匿名学习者{' '}
              {document.learnerKey}
            </>
          ) : null}
        </p>
        {document.review.status !== 'pending' ? (
          <div
            className={cn(
              'mt-3 flex flex-wrap items-center gap-2 rounded-xl px-3.5 py-2.5 text-[0.875rem]',
              document.review.status === 'approved'
                ? 'bg-[var(--primary-soft)] text-[var(--secondary-foreground)]'
                : 'bg-[var(--exp-sun-soft)]',
            )}
          >
            <UserCheck className="h-4 w-4 shrink-0" aria-hidden />
            <span className="font-semibold">
              {document.review.status === 'approved' ? '老师已审核通过' : '老师希望你再修改'}
            </span>
            {document.review.reviewer ? <span>· {document.review.reviewer}</span> : null}
            {document.review.reviewedAt ? (
              <span>· {new Date(document.review.reviewedAt).toLocaleString('zh-CN')}</span>
            ) : null}
            {document.review.comment ? <span>· 老师的话：{document.review.comment}</span> : null}
          </div>
        ) : null}
        {document.meta.notes.map((note) => (
          <p key={note} className="mt-2 text-[0.8125rem] text-[#b07000] dark:text-[#f0c26a]">
            {note}
          </p>
        ))}
      </header>

      {/* 探究过程时间线：按六阶段归组 */}
      <section>
        <SectionHeading icon={Compass} title={teacher ? '探究过程时间线' : '我的探究足迹'} />
        <ol className="mt-3 space-y-2.5">
          {PHASE_ORDER.map((phaseId) => {
            const meta = PHASE_META[phaseId];
            const events = document.timeline.filter((item) => item.phaseId === phaseId);
            const phaseTitle = phaseTitleOf(phaseId);
            return (
              <li key={phaseId} className="flex items-start gap-3">
                <span className="mt-0.5 shrink-0">
                  <PhaseIconBadge phaseId={phaseId} size={36} />
                </span>
                <div className="min-w-0 flex-1 rounded-2xl border border-border bg-card px-3.5 py-2.5">
                  <p className="flex items-center gap-2 text-[0.875rem] font-bold">
                    {phaseTitle}
                    <span className="text-[0.75rem] font-medium text-muted-foreground">
                      {events.length} 条记录
                    </span>
                  </p>
                  {events.length ? (
                    <ul className="mt-1.5 space-y-1">
                      {events.slice(0, teacher ? undefined : 3).map((item, index) => (
                        <li
                          key={`${item.kind}-${index}`}
                          className={cn(
                            'flex items-start gap-2 text-[0.8125rem] leading-5',
                            !item.active && 'text-muted-foreground line-through decoration-muted-foreground/40',
                          )}
                        >
                          <span
                            className="mt-1 shrink-0 rounded-md px-1.5 py-0.5 text-[0.6875rem] font-semibold"
                            style={{ background: `color-mix(in srgb, ${meta.color} 13%, transparent)`, color: meta.color }}
                          >
                            {timelineKindLabel(item.kind)}
                          </span>
                          <span className="min-w-0 flex-1 whitespace-pre-wrap break-words">
                            {item.summary}
                          </span>
                          {!item.active ? <span className="shrink-0 text-[0.6875rem]">历史</span> : null}
                        </li>
                      ))}
                      {!teacher && events.length > 3 ? (
                        <li className="text-[0.75rem] text-muted-foreground">
                          …还有 {events.length - 3} 条记录
                        </li>
                      ) : null}
                    </ul>
                  ) : (
                    <p className="text-[0.8125rem] text-muted-foreground">这一步没有留下记录。</p>
                  )}
                </div>
              </li>
            );
          })}
        </ol>
      </section>

      {/* 问题与假设的修改对比 */}
      <section className="grid gap-3 lg:grid-cols-2">
        <div className="exp-card p-4">
          <SectionHeading icon={PHASE_META.question.icon} color={PHASE_META.question.color} title="我的问题" compact />
          <div className="mt-3 space-y-2 text-[0.875rem] leading-6">
            <CompareLine label="最初" value={document.question.original ?? '—'} active={false} />
            <CompareLine label="现在" value={document.question.current ?? '—'} active />
          </div>
        </div>
        <div className="exp-card p-4">
          <SectionHeading
            icon={PHASE_META.hypothesis.icon}
            color={PHASE_META.hypothesis.color}
            title="我的猜想"
            compact
          />
          <ul className="mt-3 space-y-2">
            {document.hypotheses.submissions.length ? (
              document.hypotheses.submissions.map((hypothesis, index) => (
                <li key={hypothesis.id} className="rounded-xl bg-muted/60 px-3 py-2 text-[0.875rem] leading-6">
                  <span className="text-[0.75rem] font-semibold text-muted-foreground">
                    第 {index + 1} 稿{hypothesis.active ? '（现在的想法）' : '（当时的想法）'}：
                  </span>
                  <span className={cn(!hypothesis.active && 'text-muted-foreground')}>{hypothesis.text}</span>
                  {hypothesis.reason ? (
                    <span className="block text-[0.8125rem] text-muted-foreground">
                      理由：{hypothesis.reason}
                    </span>
                  ) : null}
                </li>
              ))
            ) : (
              <li className="text-[0.8125rem] text-muted-foreground">—</li>
            )}
          </ul>
        </div>
      </section>

      {/* 实验与预测对比 */}
      <section>
        <SectionHeading icon={PHASE_META.evidence.icon} color={PHASE_META.evidence.color} title="实验与预测对比" />
        <div className="mt-3 space-y-2.5">
          {document.experiments.active.map((row) => (
            <ExperimentCompareCard key={row.id} row={row} />
          ))}
          {(document.observations?.active ?? []).map((row) => (
            <ObservationCompareCard key={row.id} row={row} />
          ))}
          {!document.experiments.active.length && !(document.observations?.active?.length ?? 0) ? (
            <p className="text-[0.875rem] text-muted-foreground">还没有实验或观察记录。</p>
          ) : null}
        </div>
        {teacher && document.experiments.superseded.length ? (
          <>
            <h4 className="mt-4 text-[0.8125rem] font-semibold text-muted-foreground">
              历史失效记录（不参与评价）
            </h4>
            <div className="mt-2 space-y-2.5">
              {document.experiments.superseded.map((row) => (
                <ExperimentCompareCard key={row.id} row={row} muted />
              ))}
            </div>
          </>
        ) : null}
        {document.findings.length ? (
          <div className="mt-3 rounded-2xl bg-[var(--exp-teal-soft)] px-4 py-3.5">
            <p className="flex items-center gap-2 text-[0.875rem] font-bold text-[var(--exp-teal)]">
              <Lightbulb className="h-4 w-4" aria-hidden />
              我的实验发现
            </p>
            <ul className="mt-1.5 list-inside list-disc space-y-1 text-[0.875rem] leading-6">
              {document.findings.map((finding) => (
                <li key={finding}>{finding}</li>
              ))}
            </ul>
          </div>
        ) : null}
      </section>

      {/* 六维评价 */}
      <section>
        <SectionHeading icon={BookOpen} title={teacher ? '六维评价' : '我的科学家本领'} />
        <div className="mt-3 grid gap-3 lg:grid-cols-2">
          {document.dimensions.map((dimension) => (
            <DimensionCard key={dimension.dimension} dimension={dimension} teacher={teacher} />
          ))}
        </div>
      </section>

      {/* 支架使用与修正认识 */}
      {teacher ? (
        <section className="grid gap-3 sm:grid-cols-2">
          <div className="exp-card p-4">
            <h3 className="text-[0.9375rem] font-bold">困难与支架使用</h3>
            {document.scaffolding.hints.length ? (
              <ul className="mt-2 space-y-1 text-[0.8125rem] text-muted-foreground">
                {document.scaffolding.hints.map((hint, index) => (
                  <li key={`${hint.seq}-${index}`}>
                    {hint.phaseId} · L{hint.level} · {hint.explicit ? '主动求助' : '系统判断'}
                    {hint.type ? ` · ${hint.type}` : ''}
                    {hint.providedExplanation ? ' · 提供了解释' : ''}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-2 text-[0.8125rem] text-muted-foreground">没有使用提示。</p>
            )}
            {document.scaffolding.safetyFlags.length ? (
              <p className="mt-2 text-[0.8125rem] text-[#b07000] dark:text-[#f0c26a]">
                安全标记 {document.scaffolding.safetyFlags.length} 次（
                {document.scaffolding.safetyFlags
                  .map((flag) => (flag.kind === 'unsafe' ? '危险请求' : '提示注入'))
                  .join('、')}
                ）
              </p>
            ) : null}
          </div>
          <div className="exp-card p-4">
            <h3 className="text-[0.9375rem] font-bold">根据证据修正认识</h3>
            <ul className="mt-2 space-y-1 text-[0.8125rem] text-muted-foreground">
              <li>修改问题：{document.revisions.questionRevised ? '是' : '否'}</li>
              <li>修改假设：{document.revisions.hypothesisRevised ? '是' : '否'}</li>
              <li>修改实验设计：{document.revisions.designRevised ? '是' : '否'}</li>
              <li>重复实验：{document.revisions.evidenceRepeated ? '是' : '否'}</li>
              <li>修改结论：{document.revisions.conclusionRevised ? '是' : '否'}</li>
              <li>预测与观察不一致：{document.revisions.mismatchCount} 次</li>
              <li>针对不一致重复验证：{document.revisions.mismatchRetried ? '是' : '否'}</li>
            </ul>
          </div>
        </section>
      ) : (
        <section className="grid gap-3 sm:grid-cols-2">
          <div className="exp-card p-4">
            <h3 className="text-[0.9375rem] font-bold">我求助过几次？</h3>
            <p className="mt-2 text-[0.875rem] leading-6 text-muted-foreground">
              {document.scaffolding.hints.length
                ? `这次探究里你向导师求助了 ${document.scaffolding.hints.length} 次。主动求助、说清自己卡在哪里，本来就是科学家的重要本领。`
                : '这次探究里你一次都没有求助，很会自己思考！'}
            </p>
          </div>
          <div className="exp-card p-4">
            <h3 className="text-[0.9375rem] font-bold">我改过自己的想法吗？</h3>
            <ul className="mt-2 space-y-1 text-[0.875rem] leading-6 text-muted-foreground">
              <li>{document.revisions.hypothesisRevised ? '✓ 我修改过自己的猜想' : '· 我的猜想一直没变'}</li>
              <li>{document.revisions.conclusionRevised ? '✓ 我修改过自己的结论' : '· 我的结论没有改动'}</li>
              <li>
                {document.revisions.mismatchCount
                  ? `✓ 有 ${document.revisions.mismatchCount} 次预测和观察不一样，我当作新发现继续探究`
                  : '· 我的预测和观察每次都一致'}
              </li>
            </ul>
          </div>
        </section>
      )}

      {/* 下一步建议 */}
      {document.nextSteps.length ? (
        <section className="rounded-2xl border border-[color-mix(in_srgb,var(--primary)_35%,transparent)] bg-[var(--primary-soft)] p-4">
          <SectionHeading icon={Compass} title="下一步学习建议" compact />
          <ul className="mt-2 space-y-1.5">
            {document.nextSteps.map((step) => (
              <li key={step} className="flex items-start gap-2 text-[0.875rem] leading-6">
                <ArrowRight className="mt-1 h-4 w-4 shrink-0 text-primary" aria-hidden />
                {step}
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </article>
  );
}

/* ------------------------------------------------------------------ */
/* 子组件                                                              */
/* ------------------------------------------------------------------ */

function ReportStatusBadge({ status }: { status: InquiryReportDocument['status'] }) {
  const label =
    status === 'teacher_reviewed'
      ? '教师已审核'
      : status === 'needs_revision'
        ? '教师认为需要修改'
        : 'AI 生成 · 待教师审核';
  const tone =
    status === 'teacher_reviewed' ? 'success' : status === 'needs_revision' ? 'warn' : 'info';
  return <ExpPill tone={tone}>{label}</ExpPill>;
}

function SectionHeading({
  icon: Icon,
  color,
  title,
  compact,
}: {
  icon: typeof BookOpen;
  color?: string;
  title: string;
  compact?: boolean;
}) {
  return (
    <div className="flex items-center gap-2.5">
      <span
        className="grid h-8 w-8 shrink-0 place-items-center rounded-xl"
        style={{ background: `color-mix(in srgb, ${color ?? 'var(--primary)'} 14%, transparent)` }}
      >
        <Icon className="h-4.5 w-4.5" style={{ color: color ?? 'var(--primary)' }} aria-hidden />
      </span>
      <h3 className={cn('font-bold', compact ? 'text-[0.9375rem]' : 'text-lg')}>{title}</h3>
    </div>
  );
}

function CompareLine({ label, value, active }: { label: string; value: string; active: boolean }) {
  return (
    <p className={cn('rounded-xl px-3 py-2', active ? 'bg-[var(--primary-soft)] font-medium' : 'bg-muted/60 text-muted-foreground')}>
      <span className="mr-1.5 text-[0.75rem] font-semibold">{label}</span>
      {value}
    </p>
  );
}

function ExperimentCompareCard({
  row,
  muted,
}: {
  row: InquiryReportDocument['experiments']['active'][number];
  muted?: boolean;
}) {
  return (
    <div className={cn('flex flex-wrap items-center gap-3 rounded-2xl border border-border bg-card px-4 py-3', muted && 'opacity-60')}>
      <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-muted text-[0.8125rem] font-bold">
        {row.trialNo}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[0.875rem] font-semibold">
          {row.material} · {row.liquid}
        </span>
        {row.note ? (
          <span className="block truncate text-[0.75rem] text-muted-foreground">备注：{row.note}</span>
        ) : null}
      </span>
      <span className="text-[0.8125rem]">
        <span className="text-muted-foreground">预测</span> <strong>{row.prediction ?? '—'}</strong>
        <span className="mx-1.5 text-muted-foreground">→</span>
        <span className="text-muted-foreground">实际</span> <strong>{row.observed}</strong>
      </span>
      {row.mismatch === null ? null : row.mismatch ? (
        <ExpPill tone="warn">不一样 · 新发现</ExpPill>
      ) : (
        <ExpPill tone="success">一致</ExpPill>
      )}
    </div>
  );
}

function ObservationCompareCard({
  row,
}: {
  row: NonNullable<InquiryReportDocument['observations']>['active'][number];
}) {
  return (
    <div className="rounded-2xl border border-border bg-card px-4 py-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-[var(--exp-teal-soft)] text-[0.8125rem] font-bold text-[var(--exp-teal)]">
          {row.trialNo}
        </span>
        <ExpPill tone="neutral">真实观察</ExpPill>
        {row.recordedAt ? (
          <span className="text-[0.75rem] text-muted-foreground">
            {new Date(row.recordedAt).toLocaleString('zh-CN')}
          </span>
        ) : null}
      </div>
      <div className="mt-2 grid gap-2 sm:grid-cols-2">
        <p className="rounded-xl bg-muted/60 px-3 py-2 text-[0.8125rem] leading-5">
          <span className="mr-1 font-semibold text-muted-foreground">猜测</span>
          {row.guess}
        </p>
        <p className="rounded-xl bg-[var(--primary-soft)] px-3 py-2 text-[0.8125rem] leading-5">
          <span className="mr-1 font-semibold text-primary">观察到</span>
          {row.observation}
        </p>
      </div>
      {row.note ? (
        <p className="mt-1.5 text-[0.75rem] text-muted-foreground">备注：{row.note}</p>
      ) : null}
    </div>
  );
}

function DimensionCard({ dimension, teacher }: { dimension: DimensionEvaluation; teacher: boolean }) {
  const [open, setOpen] = useState(false);
  const rubric = rubricFor(dimension.dimension);
  const descriptor =
    dimension.level !== null
      ? rubric.levels.find((level) => level.level === dimension.level)?.descriptor
      : null;
  // 评价维度 'design' 对应阶段 'experiment-design'
  const phaseId = dimension.dimension === 'design' ? 'experiment-design' : dimension.dimension;
  const meta = PHASE_META[phaseId] ?? PHASE_META.question;
  const level = dimension.level;
  const levelName = level !== null ? LEVEL_NAMES[level] : null;
  const insufficient = dimension.status === 'insufficient_evidence';

  return (
    <div className="exp-card flex h-full flex-col p-4">
      <div className="flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2.5">
          <PhaseIconBadge phaseId={phaseId} size={36} />
          <div className="min-w-0">
            <h4 className="truncate text-[0.9375rem] font-bold">{dimension.title}</h4>
            {!insufficient && levelName ? (
              <p className="text-[0.75rem] font-medium" style={{ color: meta.color }}>
                {levelName.name} · {levelName.hint}
              </p>
            ) : null}
          </div>
        </div>
        {insufficient ? (
          <ExpPill tone="neutral">证据不足</ExpPill>
        ) : level !== null ? (
          <span className="shrink-0 text-[0.8125rem] font-bold" style={{ color: meta.color }}>
            {teacher ? `L${level}` : levelName?.name}
          </span>
        ) : null}
      </div>

      {/* 等级条（量规 L1–L4，学生友好） */}
      {level !== null ? (
        <div className="exp-level-track mt-3" role="img" aria-label={`评价等级 ${level} / 4`}>
          {[1, 2, 3, 4].map((segment) => (
            <span key={segment} className={cn('exp-level-seg', segment <= level && 'exp-level-seg-on')} />
          ))}
        </div>
      ) : null}

      {descriptor ? <p className="mt-2.5 text-[0.875rem] leading-6">{descriptor}</p> : null}

      {teacher ? (
        <p className="mt-1.5 text-[0.6875rem] uppercase tracking-wide text-muted-foreground">
          来源：{dimension.source === 'rules+semantic' ? '规则 + 语义' : '规则'}
          {dimension.ruleCap !== null ? ` · 结构上限 L${dimension.ruleCap}` : ''}
          {dimension.semanticLevel !== null ? ` · 语义 L${dimension.semanticLevel}` : ''}
        </p>
      ) : null}

      {/* 评价依据（折叠，保留原始证据） */}
      <button
        type="button"
        className="mt-2.5 flex items-center gap-1 text-[0.8125rem] font-semibold text-primary"
        onClick={() => setOpen((previous) => !previous)}
        aria-expanded={open}
      >
        <ChevronDown className={cn('h-4 w-4 transition-transform', open && 'rotate-180')} aria-hidden />
        为什么这样评价（{dimension.basis.length + dimension.evidenceRefs.length} 条依据）
      </button>
      {open ? (
        <div className="mt-2 space-y-1.5 rounded-xl bg-muted/60 p-3">
          <ul className="list-inside list-disc space-y-1 text-[0.8125rem] leading-5 text-muted-foreground">
            {dimension.basis.map((basis, index) => (
              <li key={`${basis}-${index}`}>{basis}</li>
            ))}
          </ul>
          {dimension.evidenceRefs.length ? (
            <ul className="space-y-1 border-t border-border pt-2">
              {dimension.evidenceRefs.map((ref) => (
                <li key={ref.id} className="text-[0.8125rem] leading-5 text-muted-foreground">
                  <span className="rounded bg-card px-1.5 py-0.5 text-[0.6875rem] font-semibold">
                    [{ref.kind}]
                  </span>{' '}
                  “{ref.quote}”
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}

      {dimension.suggestions.length ? (
        <p className="mt-2.5 rounded-xl bg-[var(--exp-sky-soft)] px-3 py-2 text-[0.8125rem] leading-5">
          <Lightbulb className="mr-1 inline h-3.5 w-3.5 text-[var(--exp-sky)]" aria-hidden />
          <strong>试试看：</strong>
          {dimension.suggestions.join('；')}
        </p>
      ) : null}
    </div>
  );
}

function timelineKindLabel(kind: string): string {
  switch (kind) {
    case 'submission':
      return '提交';
    case 'experiment':
      return '实验';
    case 'observation':
      return '观察';
    case 'hint':
      return '提示';
    case 'safety':
      return '安全';
    default:
      return kind;
  }
}

function phaseTitleOf(phaseId: PhaseId): string {
  switch (phaseId) {
    case 'question':
      return '提出问题';
    case 'hypothesis':
      return '猜想与假设';
    case 'experiment-design':
      return '设计实验';
    case 'evidence':
      return '收集证据';
    case 'analysis':
      return '分析结果';
    case 'reflection':
      return '反思与修正';
    default:
      return phaseId;
  }
}
