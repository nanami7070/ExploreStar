'use client';

/**
 * AI 生成方案的预览卡。
 *
 * 学生在这里确认方案、和 AI 讨论修改,或者返回修改自己的问题。
 * 实验方式如实说明:有确定性模型的任务才能模拟;其余是真实观察任务,
 * 需要材料与成人陪同,系统不会伪造模拟结果。
 */
import {
  Compass,
  FlaskConical,
  MessageCircleQuestion,
  RotateCcw,
  ShieldCheck,
  Sparkles,
  Telescope,
} from 'lucide-react';
import { useState } from 'react';

import type { InquiryTask } from '@/lib/inquiry/domain/types';

import { LiquidGlyph, MaterialGlyph } from './exp-icons';
import { ExpButton, ExpPill, Note, PHASE_META } from './exp-ui';

export function TaskPreview({
  definition,
  originalQuestion,
  refinedQuestion,
  version,
  busy,
  onConfirm,
  onRevise,
  onBackToQuestion,
}: {
  definition: InquiryTask;
  originalQuestion: string;
  refinedQuestion: string;
  version: number;
  busy: boolean;
  onConfirm: () => void;
  onRevise: (feedback: string) => void;
  onBackToQuestion: () => void;
}) {
  const [showFeedback, setShowFeedback] = useState(false);
  const [feedback, setFeedback] = useState('');

  const evidencePhase = definition.phases.find((phase) => phase.id === 'evidence');
  const hasSimulation = Boolean(evidencePhase?.experiment);
  const materialNames = definition.materials.map((material) => material.name).join('、');

  return (
    <article className="exp-fade-up space-y-4">
      {/* 标题 */}
      <section className="exp-card p-5 sm:p-6">
        <div className="flex flex-wrap items-center gap-2">
          <ExpPill tone="success">AI 为你设计的探究方案</ExpPill>
          <ExpPill tone="neutral">第 {version} 版</ExpPill>
        </div>
        <h1 className="mt-2 text-2xl font-bold leading-snug">{definition.name}</h1>

        <div className="mt-4 grid gap-2.5">
          <div className="rounded-xl bg-muted/60 px-3.5 py-2.5">
            <p className="text-[0.75rem] font-semibold text-muted-foreground">你提出的问题</p>
            <p className="mt-0.5 text-[0.9375rem] leading-6">{originalQuestion}</p>
          </div>
          <div className="rounded-xl bg-[var(--primary-soft)] px-3.5 py-2.5">
            <p className="text-[0.75rem] font-semibold text-primary">导师帮你整理成可以探究的问题</p>
            <p className="mt-0.5 text-[0.9375rem] font-semibold leading-6">{refinedQuestion}</p>
          </div>
        </div>
        <p className="mt-3 flex items-start gap-2 text-[0.875rem] leading-6 text-muted-foreground">
          <Telescope className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
          {definition.intro.text}
        </p>
      </section>

      {/* 目标 */}
      <section className="exp-card p-5">
        <h2 className="text-lg font-bold">这次探究你要做到</h2>
        <ul className="mt-2.5 space-y-2">
          {definition.goals.map((goal, index) => (
            <li key={goal} className="flex items-start gap-2.5">
              <span className="mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-full bg-[var(--primary-soft)] text-[0.75rem] font-bold text-primary">
                {index + 1}
              </span>
              <span className="text-[0.9375rem] leading-6">{goal}</span>
            </li>
          ))}
        </ul>
      </section>

      {/* 六阶段预览 */}
      <section className="exp-card p-5">
        <h2 className="text-lg font-bold">六步探究地图</h2>
        <ol className="mt-3 space-y-2.5">
          {definition.phases.map((phase, index) => {
            const meta = PHASE_META[phase.id];
            const Icon = meta.icon;
            return (
              <li key={phase.id} className="flex items-start gap-3">
                <span
                  className="grid h-9 w-9 shrink-0 place-items-center rounded-xl"
                  style={{
                    background: `color-mix(in srgb, ${meta.color} 14%, transparent)`,
                    color: meta.color,
                  }}
                >
                  <Icon className="h-4.5 w-4.5" aria-hidden />
                </span>
                <div className="min-w-0">
                  <p className="text-[0.9375rem] font-semibold">
                    {index + 1}. {phase.title}
                  </p>
                  <p className="text-[0.875rem] leading-6 text-muted-foreground">{phase.goal}</p>
                  {phase.studentTasks.length ? (
                    <div className="mt-1 flex flex-wrap gap-1.5">
                      {phase.studentTasks.slice(0, 3).map((taskItem) => (
                        <span
                          key={taskItem}
                          className="rounded-full bg-muted px-2 py-0.5 text-[0.75rem] text-muted-foreground"
                        >
                          {taskItem}
                        </span>
                      ))}
                    </div>
                  ) : null}
                </div>
              </li>
            );
          })}
        </ol>
      </section>

      {/* 材料 */}
      <section className="exp-card p-5">
        <h2 className="text-lg font-bold">要准备的材料</h2>
        <div className="mt-2.5 grid grid-cols-2 gap-2 sm:grid-cols-3">
          {definition.materials.map((material) => (
            <span
              key={material.id}
              className="flex items-center gap-2 rounded-xl border border-border bg-card px-2.5 py-2 text-[0.875rem] font-medium"
            >
              <MaterialGlyph materialId={material.id} size={26} />
              {material.name}
            </span>
          ))}
        </div>
        {definition.liquids.length ? (
          <div className="mt-2 flex flex-wrap gap-2">
            {definition.liquids.map((liquid) => (
              <span
                key={liquid.id}
                className="inline-flex items-center gap-1.5 rounded-full bg-muted px-2.5 py-1 text-[0.8125rem] font-medium"
              >
                <LiquidGlyph liquidId={liquid.id} size={20} />
                {liquid.name}
              </span>
            ))}
          </div>
        ) : null}
      </section>

      {/* 实验方式(如实说明能力边界) */}
      {hasSimulation ? (
        <Note tone="success" icon={FlaskConical} title="实验方式：模拟水箱实验">
          <p className="text-[0.875rem]">
            这个任务可以在模拟水箱里动手做：先猜一猜，再把物体放进水里看结果。模拟结果是系统按科学规律算出来的。
          </p>
        </Note>
      ) : (
        <Note tone="info" icon={Telescope} title="实验方式：真实观察">
          <p className="text-[0.875rem]">
            这是一个真实观察任务。需要准备：{materialNames}。请在老师或家长陪同下按上面的方法观察，
            并把看到的现象记录下来——系统会保存你的记录，但不会替你模拟实验结果。
          </p>
        </Note>
      )}

      {/* 安全 */}
      {definition.safety.length ? (
        <Note tone="warn" icon={ShieldCheck} title="实验安全提醒">
          <ul className="list-inside list-disc space-y-0.5 text-[0.875rem]">
            {definition.safety.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </Note>
      ) : null}

      {/* 操作 */}
      <section className="exp-card p-5">
        {showFeedback ? (
          <div className="mb-4 rounded-2xl bg-muted/60 p-3.5">
            <label htmlFor="plan-feedback" className="flex items-center gap-1.5 text-[0.875rem] font-semibold">
              <MessageCircleQuestion className="h-4 w-4 text-primary" aria-hidden />
              想怎么改这个方案？告诉导师，他会重新设计一版。
            </label>
            <textarea
              id="plan-feedback"
              className="exp-textarea mt-2"
              style={{ minHeight: 72 }}
              value={feedback}
              onChange={(event) => setFeedback(event.target.value)}
              maxLength={300}
              placeholder="例如：我想先研究塑料块；材料能不能少一点？"
            />
            <div className="mt-2 flex flex-wrap gap-2">
              <ExpButton
                size="sm"
                variant="secondary"
                disabled={busy || !feedback.trim()}
                onClick={() => onRevise(feedback.trim())}
              >
                <Sparkles className="h-4 w-4" aria-hidden />
                按我的想法重新生成
              </ExpButton>
              <ExpButton size="sm" variant="ghost" onClick={() => setShowFeedback(false)} disabled={busy}>
                取消
              </ExpButton>
            </div>
          </div>
        ) : null}

        <div className="flex flex-wrap items-center gap-2.5">
          <ExpButton size="lg" onClick={onConfirm} disabled={busy} className="px-8">
            <Compass className="h-5 w-5" aria-hidden />
            {busy ? '正在准备你的探究…' : '确认并开始探究'}
          </ExpButton>
          {!showFeedback ? (
            <ExpButton variant="outline" onClick={() => setShowFeedback(true)} disabled={busy}>
              <MessageCircleQuestion className="h-4 w-4" aria-hidden />
              和导师讨论修改
            </ExpButton>
          ) : null}
          <ExpButton variant="ghost" onClick={onBackToQuestion} disabled={busy}>
            <RotateCcw className="h-4 w-4" aria-hidden />
            返回修改我的问题
          </ExpButton>
        </div>
        <p className="mt-3 text-[0.75rem] text-muted-foreground">
          确认后,方案会保存成你专属的探究任务,六步探究随时可以接着做。
        </p>
      </section>
    </article>
  );
}

