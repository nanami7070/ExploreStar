'use client';

/**
 * 当前阶段活动区。
 *
 * 业务规则完全保留：硬校验（block 推进）、软建议（只反馈）、
 * 提交/继续/求助/沿用上次提交四种动作与后端约束一致。
 */
import { CircleCheck, Lightbulb, MessageCircleQuestion, RotateCcw } from 'lucide-react';
import { useEffect, useState } from 'react';

import { cn } from '@/lib/utils';
import { buildGateContext, runHardChecks } from '@/lib/inquiry/domain/gates';
import {
  effectiveSubmission,
  findPhaseConfig,
  type InquirySessionState,
  type InquiryTask,
  type SubmissionContent,
} from '@/lib/inquiry/domain/types';
import { hintTemplateFor } from '@/lib/inquiry/prompts/tutor';
import type { InquiryStudyAction } from '@/lib/inquiry/actions';

import { ExperimentLab } from './experiment-lab';
import { RealObservationLab } from './real-observation-lab';
import { ExpButton, Note, PHASE_META, PhaseIconBadge } from './exp-ui';

/** 句子开头芯片（点击插入输入框，帮助低年级学生组织语言） */
const SENTENCE_STARTERS: Record<string, string[]> = {
  question: ['为什么……', '怎样……', '如果……会怎样？'],
  hypothesis: ['我认为……', '我觉得……因为……'],
  analysis: ['我发现……因为……', '第 1 次实验里……'],
  reflection: ['我做得好的地方是……', '下次我想改进……'],
};

export function PhasePanel({
  task,
  state,
  busy,
  onAct,
}: {
  task: InquiryTask;
  state: InquirySessionState;
  busy: boolean;
  onAct: (action: InquiryStudyAction) => void;
}) {
  const phase = findPhaseConfig(task, state.position.phaseId);
  const progress = state.phases[state.position.phaseIndex]!;
  const collected = state.collected[phase.id];
  const effective = effectiveSubmission(collected);
  const hard = runHardChecks(buildGateContext(task, phase, collected));
  const failingHard = hard.filter((result) => !result.passed);
  const softSuggestions = collected.evaluations.filter(
    (evaluation) =>
      evaluation.kind === 'soft-check' &&
      evaluation.phaseRevision === progress.revision &&
      !evaluation.superseded &&
      !evaluation.verdict.passed,
  );
  const lastHint = progress.hint.log[progress.hint.log.length - 1];
  const hintText = hintTemplateFor(phase, lastHint?.type ?? null, progress.hint.level);

  const [text, setText] = useState('');
  const [reason, setReason] = useState('');
  const [materialIds, setMaterialIds] = useState<string[]>([]);
  const [changedCondition, setChangedCondition] = useState('');
  const [keptConditions, setKeptConditions] = useState('');
  const [observedTarget, setObservedTarget] = useState('');
  const [safetyConfirmed, setSafetyConfirmed] = useState(false);

  useEffect(() => {
    setText(effective?.content.text ?? '');
    setReason(effective?.content.reason ?? '');
    setMaterialIds(effective?.content.materialIds ?? []);
    setChangedCondition(effective?.content.changedCondition ?? '');
    setKeptConditions(effective?.content.keptConditions ?? '');
    setObservedTarget(effective?.content.observedTarget ?? '');
    setSafetyConfirmed(effective?.content.safetyConfirmed === true);
    // Re-seed the form when the phase or its revision changes, or a different
    // submission becomes the effective one.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase.id, progress.revision, effective?.id]);

  const buildContent = (): SubmissionContent => {
    if (phase.id === 'experiment-design') {
      return {
        materialIds,
        changedCondition,
        keptConditions,
        observedTarget,
        safetyConfirmed,
      };
    }
    if (phase.id === 'hypothesis') return { text, reason };
    return { text };
  };

  const canSubmit =
    !busy &&
    (phase.id === 'experiment-design'
      ? materialIds.length > 0 || Boolean(changedCondition.trim()) || safetyConfirmed
      : text.trim().length > 0);

  const toggleMaterial = (id: string) => {
    setMaterialIds((previous) =>
      previous.includes(id) ? previous.filter((item) => item !== id) : [...previous, id],
    );
  };

  const meta = PHASE_META[phase.id];
  const starters = SENTENCE_STARTERS[phase.id] ?? [];
  const isTextPhase =
    phase.id === 'question' || phase.id === 'hypothesis' || phase.id === 'analysis' || phase.id === 'reflection';

  return (
    <section className="flex min-h-0 flex-col gap-4 rounded-3xl border border-border bg-card p-5 shadow-[var(--exp-shadow-sm)] sm:p-6">
      {/* 阶段头部 */}
      <header>
        <div className="flex items-center gap-3">
          <PhaseIconBadge phaseId={phase.id} size={46} />
          <div className="min-w-0">
            <p className="text-[0.8125rem] font-semibold" style={{ color: meta.color }}>
              第 {state.position.phaseIndex + 1} 步 · 共 6 步
            </p>
            <h2 data-testid="phase-title" className="text-xl font-bold leading-snug sm:text-2xl">
              {phase.title}
            </h2>
          </div>
        </div>
        <p className="mt-3 rounded-2xl bg-muted/70 px-4 py-3 text-[0.9375rem] leading-7">
          <span className="font-semibold">这一步要做什么：</span>
          {phase.goal}
        </p>
        {phase.studentTasks.length > 0 ? (
          <ul className="mt-3 flex flex-wrap gap-2">
            {phase.studentTasks.map((taskItem, index) => (
              <li
                key={taskItem}
                className="inline-flex items-center gap-1.5 rounded-full bg-[var(--exp-sky-soft)] px-3 py-1.5 text-[0.8125rem] font-medium text-[var(--accent-foreground)]"
              >
                <span className="grid h-4.5 w-4.5 place-items-center rounded-full bg-[var(--exp-sky)] text-[0.6875rem] font-bold text-white">
                  {index + 1}
                </span>
                {taskItem}
              </li>
            ))}
          </ul>
        ) : null}
      </header>

      {/* 文本类阶段：问题 / 假设 / 结论 / 反思 */}
      {isTextPhase ? (
        <div className="space-y-3">
          {starters.length > 0 ? (
            <div className="flex flex-wrap gap-2">
              <span className="self-center text-[0.8125rem] text-muted-foreground">不会开头？试试：</span>
              {starters.map((starter) => (
                <button
                  key={starter}
                  type="button"
                  className="exp-prompt-chip"
                  disabled={busy}
                  onClick={() => setText((previous) => (previous ? `${previous}${starter}` : starter))}
                >
                  {starter}
                </button>
              ))}
            </div>
          ) : null}
          <textarea
            className="exp-textarea"
            style={{ minHeight: 132 }}
            value={text}
            onChange={(event) => setText(event.target.value)}
            maxLength={phase.id === 'question' ? 200 : 1000}
            disabled={busy}
            placeholder={
              phase.id === 'question'
                ? '写下你想研究的问题，例如“为什么……”或“怎样……”'
                : phase.id === 'hypothesis'
                  ? '我认为……'
                  : phase.id === 'analysis'
                    ? '我发现……因为第几次实验中……'
                    : '这次探究里，我做得好的地方是……下次我想改进……'
            }
          />
          {phase.id === 'hypothesis' ? (
            <div>
              <label className="exp-field-label" htmlFor="hypothesis-reason">
                说说你的理由（可以先不写）
              </label>
              <input
                id="hypothesis-reason"
                className="exp-input"
                value={reason}
                onChange={(event) => setReason(event.target.value)}
                maxLength={300}
                disabled={busy}
                placeholder="因为……"
              />
            </div>
          ) : null}
        </div>
      ) : null}

      {/* 设计实验 */}
      {phase.id === 'experiment-design' ? (
        <div className="space-y-5">
          <div>
            <p className="exp-field-label">① 选择要用的材料（可以多选）</p>
            <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3">
              {task.materials.map((material) => (
                <label
                  key={material.id}
                  className={cn(
                    'flex cursor-pointer items-center gap-2.5 rounded-2xl border-2 bg-card px-3 py-2.5 transition-colors',
                    materialIds.includes(material.id)
                      ? 'border-primary bg-[var(--primary-soft)]'
                      : 'border-border hover:border-ring',
                    busy && 'cursor-not-allowed opacity-55',
                  )}
                >
                  <input
                    type="checkbox"
                    className="h-4 w-4 shrink-0 accent-[var(--primary)]"
                    checked={materialIds.includes(material.id)}
                    onChange={() => toggleMaterial(material.id)}
                    disabled={busy}
                    aria-label={material.name}
                  />
                  <span className="truncate text-[0.875rem] font-semibold">{material.name}</span>
                </label>
              ))}
            </div>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className="exp-field-label" htmlFor="changed-condition">
                ② 我打算改变的条件
              </label>
              <input
                id="changed-condition"
                className="exp-input"
                value={changedCondition}
                onChange={(event) => setChangedCondition(event.target.value)}
                maxLength={200}
                disabled={busy}
                placeholder="例如：物体的材料"
              />
            </div>
            <div>
              <label className="exp-field-label" htmlFor="kept-conditions">
                ③ 要保持不变的条件
              </label>
              <input
                id="kept-conditions"
                className="exp-input"
                value={keptConditions}
                onChange={(event) => setKeptConditions(event.target.value)}
                maxLength={200}
                disabled={busy}
                placeholder="例如：都用清水，放进去的方式一样"
              />
            </div>
          </div>
          <div>
            <label className="exp-field-label" htmlFor="observed-target">
              ④ 我要观察什么
            </label>
            <input
              id="observed-target"
              className="exp-input"
              value={observedTarget}
              onChange={(event) => setObservedTarget(event.target.value)}
              maxLength={200}
              disabled={busy}
              placeholder="例如：物体是浮还是沉"
            />
          </div>
          <div className="rounded-2xl border-2 border-[color-mix(in_srgb,var(--exp-sun)_45%,transparent)] bg-[var(--exp-sun-soft)] p-4">
            <p className="mb-2 flex items-center gap-2 font-bold">
              <Lightbulb className="h-5 w-5 text-[var(--exp-sun)]" aria-hidden />
              实验安全提示
            </p>
            <ul className="list-inside list-disc space-y-1 text-[0.875rem] leading-6">
              {task.safety.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
            <label className="mt-3 flex cursor-pointer items-center gap-2.5 rounded-xl bg-card/80 px-3 py-2.5">
              <input
                type="checkbox"
                className="h-4 w-4 accent-[var(--primary)]"
                checked={safetyConfirmed}
                onChange={(event) => setSafetyConfirmed(event.target.checked)}
                disabled={busy}
              />
              <span className="text-[0.875rem] font-semibold">我已经阅读并确认安全提示</span>
            </label>
          </div>
        </div>
      ) : null}

      {/* 收集证据 */}
      {phase.id === 'evidence' ? (
        <div className="space-y-3">
          {phase.experiment ? (
            <ExperimentLab task={task} state={state} disabled={busy} onAct={onAct} />
          ) : (
            <RealObservationLab task={task} state={state} disabled={busy} onAct={onAct} />
          )}
          <div>
            <label className="exp-field-label" htmlFor="evidence-note">
              补充说明（可不填）
            </label>
            <textarea
              id="evidence-note"
              className="exp-textarea"
              style={{ minHeight: 72 }}
              value={text}
              onChange={(event) => setText(event.target.value)}
              maxLength={500}
              disabled={busy}
              placeholder="例如：我发现同一种材料换一种液体，结果不一样……"
            />
          </div>
        </div>
      ) : null}

      {/* 软性建议（不阻断） */}
      {softSuggestions.length ? (
        <Note tone="info" icon={CircleCheck} title="小建议（不影响继续探究）">
          <ul className="mt-1 list-inside list-disc space-y-1 text-[0.875rem]">
            {softSuggestions.slice(-3).map((evaluation) => (
              <li key={evaluation.id}>{evaluation.verdict.detail}</li>
            ))}
          </ul>
        </Note>
      ) : null}

      {/* 导师提示 */}
      {hintText ? (
        <Note tone="sparkle" icon={Lightbulb} title="导师小提示">
          <p className="text-[0.875rem]">{hintText}</p>
        </Note>
      ) : null}

      {/* 完成这一步还差什么（硬校验） */}
      {failingHard.length ? (
        <div className="rounded-2xl border border-border bg-muted/50 px-4 py-3">
          <p className="flex items-center gap-2 text-[0.875rem] font-bold">
            <MessageCircleQuestion className="h-4 w-4 text-primary" aria-hidden />
            完成这一步还差
          </p>
          <ul className="mt-1.5 space-y-1">
            {failingHard.map((result) => (
              <li key={result.id} className="flex items-start gap-2 text-[0.875rem] text-muted-foreground">
                <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-muted-foreground" />
                {result.detail}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {/* 操作区 */}
      <div className="mt-auto flex flex-wrap items-center gap-2.5 border-t border-border pt-4">
        {phase.id !== 'evidence' || text.trim() ? (
          <ExpButton
            variant="secondary"
            size="sm"
            disabled={!canSubmit}
            onClick={() => onAct({ action: 'submit', content: buildContent() })}
          >
            提交这一步
          </ExpButton>
        ) : null}
        <ExpButton
          size="sm"
          disabled={busy || failingHard.length > 0}
          onClick={() => onAct({ action: 'next' })}
          className="px-5"
        >
          完成本阶段，继续下一步
        </ExpButton>
        <ExpButton
          variant="outline"
          size="sm"
          disabled={busy}
          onClick={() => onAct({ action: 'requestHint', explicit: true })}
        >
          <Lightbulb className="h-4 w-4" aria-hidden />
          求助
        </ExpButton>
        {collected.submissions.length > 0 ? (
          <ExpButton
            variant="ghost"
            size="sm"
            disabled={busy}
            onClick={() => onAct({ action: 'confirmSubmission' })}
          >
            <RotateCcw className="h-3.5 w-3.5" aria-hidden />
            沿用上次提交
          </ExpButton>
        ) : null}
      </div>
    </section>
  );
}
