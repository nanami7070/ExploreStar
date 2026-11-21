'use client';

/**
 * 实验操作台：材料卡片 → 图形化预测 → 模拟/真实实验 → 结果对比 → 记录卡片。
 *
 * 关键约束（遵守，不改动）：
 * - 结果只来自后端确定性计算（latest.result.observed），动画仅作呈现；
 * - 预测错误不阻止记录，反而突出「新发现」；
 * - 模拟 / 真实实验的来源标记保留；
 * - 实验安全规则文案保留。
 */
import { CircleCheck, FlaskConical, ShieldCheck, Sparkles } from 'lucide-react';
import { useRef, useState } from 'react';

import { cn } from '@/lib/utils';
import type { FloatSinkOutcome, InquirySessionState, InquiryTask } from '@/lib/inquiry/domain/types';
import { predictionMismatch } from '@/lib/inquiry/domain/types';
import type { InquiryStudyAction } from '@/lib/inquiry/actions';

import { LiquidGlyph, MaterialGlyph, OutcomeGlyph } from './exp-icons';
import { ExpButton, ExpPill, Note } from './exp-ui';
import { OUTCOME_LABEL } from './labels';

/** 预测结果在水箱中的停靠位置（只用于动画呈现） */
const SPLASH_Y: Record<FloatSinkOutcome, number> = {
  float: 16,
  suspend: 64,
  sink: 112,
};

export function ExperimentLab({
  task,
  state,
  disabled,
  onAct,
}: {
  task: InquiryTask;
  state: InquirySessionState;
  disabled: boolean;
  onAct: (action: InquiryStudyAction) => void;
}) {
  const [materialId, setMaterialId] = useState(task.materials[0]?.id ?? '');
  const [liquidId, setLiquidId] = useState(task.liquids[0]?.id ?? '');
  const [source, setSource] = useState<'sim' | 'real'>('sim');
  const [prediction, setPrediction] = useState<FloatSinkOutcome | null>(null);
  const [observed, setObserved] = useState<FloatSinkOutcome>('float');
  const [note, setNote] = useState('');
  const [justDropped, setJustDropped] = useState<string | null>(null);
  const dropTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const experiments = state.collected.evidence.experiments.filter(
    (experiment) => !experiment.superseded,
  );
  const latest = experiments[experiments.length - 1];
  const materialName = (id: string) => task.materials.find((item) => item.id === id)?.name ?? id;
  const liquidName = (id: string) => task.liquids.find((item) => item.id === id)?.name ?? id;
  const design = latest?.designSnapshot;

  const canRun = prediction !== null && !disabled;
  const latestMismatch = latest ? predictionMismatch(latest) : null;

  const run = () => {
    if (!prediction || !canRun) return;
    onAct({
      action: 'recordExperiment',
      materialId,
      liquidId,
      source,
      studentPrediction: prediction,
      ...(source === 'real' ? { observed } : {}),
      ...(note.trim() ? { note: note.trim() } : {}),
    });
    setNote('');
    // 结果返回后触发落水动画（以 latest 变化为准，在渲染层处理）
    setJustDropped(`${materialId}:${Date.now()}`);
    if (dropTimer.current) clearTimeout(dropTimer.current);
    dropTimer.current = setTimeout(() => setJustDropped(null), 1300);
  };

  const outcomeOptions: FloatSinkOutcome[] = ['float', 'sink', 'suspend'];

  return (
    <div className="space-y-4">
      <p className="text-[0.9375rem] leading-6 text-muted-foreground">
        先猜一猜会发生什么，再动手做实验。猜对猜错都没关系——不一样的结果往往藏着新发现。
      </p>

      {design ? (
        <div className="rounded-xl bg-muted/70 px-3.5 py-2.5 text-[0.8125rem] leading-6 text-muted-foreground">
          <span className="font-semibold text-foreground">你设计的实验条件</span>
          ：改变「{design.changedCondition ?? '—'}」；保持「{design.keptConditions ?? '—'}」不变；
          观察「{design.observedTarget ?? '—'}」
        </div>
      ) : null}

      {/* ① 选择材料与液体 */}
      <div className="space-y-3">
        <StepBadge n={1} label="选择材料" />
        <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3">
          {task.materials.map((material) => (
            <label
              key={material.id}
              className={cn(
                'flex cursor-pointer flex-col items-center gap-1.5 rounded-2xl border-2 bg-card px-2 py-3 text-center transition-colors',
                materialId === material.id
                  ? 'border-primary bg-[var(--primary-soft)]'
                  : 'border-border hover:border-ring',
                disabled && 'cursor-not-allowed opacity-55',
              )}
            >
              <MaterialGlyph materialId={material.id} size={40} />
              <span className="text-[0.875rem] font-semibold leading-tight">{material.name}</span>
              <input
                type="radio"
                name="experiment-material"
                className="h-3.5 w-3.5 accent-[var(--primary)]"
                checked={materialId === material.id}
                onChange={() => setMaterialId(material.id)}
                disabled={disabled}
                aria-label={material.name}
              />
            </label>
          ))}
        </div>
        <div className="flex flex-wrap gap-2.5">
          {task.liquids.map((liquid) => (
            <label
              key={liquid.id}
              className={cn(
                'flex cursor-pointer items-center gap-2 rounded-full border-2 bg-card px-3.5 py-2 text-[0.875rem] font-semibold transition-colors',
                liquidId === liquid.id ? 'border-primary bg-[var(--primary-soft)] text-primary' : 'border-border hover:border-ring',
                disabled && 'cursor-not-allowed opacity-55',
              )}
            >
              <LiquidGlyph liquidId={liquid.id} />
              {liquid.name}
              <input
                type="radio"
                name="experiment-liquid"
                className="h-3.5 w-3.5 accent-[var(--primary)]"
                checked={liquidId === liquid.id}
                onChange={() => setLiquidId(liquid.id)}
                disabled={disabled}
                aria-label={liquid.name}
              />
            </label>
          ))}
        </div>
      </div>

      {/* ② 预测（图形化浮/沉/悬浮） */}
      <div className="space-y-3">
        <StepBadge n={2} label="先预测：它放进去会怎样？" />
        <div className="grid grid-cols-3 gap-2.5" role="radiogroup" aria-label="预测结果">
          {outcomeOptions.map((outcome) => (
            <label
              key={outcome}
              className={cn(
                'flex cursor-pointer flex-col items-center gap-1.5 rounded-2xl border-2 bg-card px-2 py-3 text-center transition-colors',
                prediction === outcome
                  ? 'border-[var(--exp-sun)] bg-[var(--exp-sun-soft)]'
                  : 'border-border hover:border-ring',
                disabled && 'cursor-not-allowed opacity-55',
              )}
            >
              <OutcomeGlyph outcome={outcome} size={52} />
              <span className="text-[0.875rem] font-semibold">{OUTCOME_LABEL[outcome]}</span>
              <input
                type="radio"
                name="prediction"
                className="h-3.5 w-3.5 accent-[var(--exp-sun)]"
                checked={prediction === outcome}
                onChange={() => setPrediction(outcome)}
                disabled={disabled}
                aria-label={OUTCOME_LABEL[outcome]}
              />
            </label>
          ))}
        </div>
      </div>

      {/* ③ 做实验：来源 + 水箱 / 真实观察 */}
      <div className="space-y-3">
        <StepBadge n={3} label="做实验" />
        <div className="flex flex-wrap gap-2.5" role="radiogroup" aria-label="实验方式">
          <label
            className={cn(
              'flex cursor-pointer items-center gap-2 rounded-full border-2 bg-card px-3.5 py-2 text-[0.875rem] font-semibold transition-colors',
              source === 'sim' ? 'border-primary bg-[var(--primary-soft)] text-primary' : 'border-border hover:border-ring',
              disabled && 'cursor-not-allowed opacity-55',
            )}
          >
            <FlaskConical className="h-4 w-4" aria-hidden />
            在模拟水箱里做
            <input
              type="radio"
              name="experiment-source"
              className="h-3.5 w-3.5 accent-[var(--primary)]"
              checked={source === 'sim'}
              onChange={() => setSource('sim')}
              disabled={disabled}
              aria-label="在模拟水箱里做"
            />
          </label>
          <label
            className={cn(
              'flex cursor-pointer items-center gap-2 rounded-full border-2 bg-card px-3.5 py-2 text-[0.875rem] font-semibold transition-colors',
              source === 'real' ? 'border-primary bg-[var(--primary-soft)] text-primary' : 'border-border hover:border-ring',
              disabled && 'cursor-not-allowed opacity-55',
            )}
          >
            我做了真实实验，来记录观察
            <input
              type="radio"
              name="experiment-source"
              className="h-3.5 w-3.5 accent-[var(--primary)]"
              checked={source === 'real'}
              onChange={() => setSource('real')}
              disabled={disabled}
              aria-label="我做了真实实验，来记录观察"
            />
          </label>
        </div>

        {source === 'sim' ? (
          <WaterTank
            materialName={materialName(materialId)}
            liquidName={liquidName(liquidId)}
            latestObserved={latest?.result.observed}
            latestPrediction={latest?.studentPrediction}
            dropKey={justDropped}
          />
        ) : (
          <div className="space-y-2.5">
            <p className="text-[0.875rem] font-semibold text-muted-foreground">
              我看到它……
            </p>
            <div className="grid grid-cols-3 gap-2.5" role="radiogroup" aria-label="观察到的结果">
              {outcomeOptions.map((outcome) => (
                <label
                  key={outcome}
                  className={cn(
                    'flex cursor-pointer flex-col items-center gap-1.5 rounded-2xl border-2 bg-card px-2 py-3 text-center transition-colors',
                    observed === outcome
                      ? 'border-[var(--exp-teal)] bg-[var(--exp-teal-soft)]'
                      : 'border-border hover:border-ring',
                    disabled && 'cursor-not-allowed opacity-55',
                  )}
                >
                  <OutcomeGlyph outcome={outcome} size={52} />
                  <span className="text-[0.875rem] font-semibold">{OUTCOME_LABEL[outcome]}</span>
                  <input
                    type="radio"
                    name="real-observed"
                    className="h-3.5 w-3.5 accent-[var(--exp-teal)]"
                    checked={observed === outcome}
                    onChange={() => setObserved(outcome)}
                    disabled={disabled}
                    aria-label={`我看到：${OUTCOME_LABEL[outcome]}`}
                  />
                </label>
              ))}
            </div>
          </div>
        )}

        <textarea
          className="exp-textarea"
          style={{ minHeight: 64 }}
          value={note}
          onChange={(event) => setNote(event.target.value)}
          maxLength={300}
          disabled={disabled}
          placeholder="观察备注（可不填），例如：它慢慢沉下去，还冒了几个小气泡"
          aria-label="观察备注"
        />
        <ExpButton variant="secondary" disabled={!canRun} onClick={run} className="w-full sm:w-auto">
          {prediction ? '完成并记录这次实验' : '请先选择你的预测'}
        </ExpButton>
      </div>

      {/* ④ 最新结果对比 */}
      {latest ? (
        <div
          data-testid="latest-experiment"
          className={cn(
            'rounded-2xl border-2 p-4',
            latestMismatch === true
              ? 'border-[var(--exp-sun)] bg-[var(--exp-sun-soft)]'
              : 'border-[color-mix(in_srgb,var(--primary)_35%,transparent)] bg-[var(--primary-soft)]',
          )}
        >
          <div className="flex flex-wrap items-center gap-2">
            <ExpPill tone="info">第 {latest.trialNo} 次实验</ExpPill>
            {latestMismatch === true ? <ExpPill tone="warn">预测和观察不一样 · 新发现！</ExpPill> : null}
            {latest.source === 'real' ? <ExpPill tone="neutral">真实实验</ExpPill> : <ExpPill tone="neutral">模拟结果</ExpPill>}
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-3 text-[0.9375rem]">
            <span className="inline-flex items-center gap-1.5 font-semibold">
              <MaterialGlyph materialId={latest.materialId} size={28} />
              {materialName(latest.materialId)}
            </span>
            <span className="text-muted-foreground">放进{liquidName(latest.liquidId)}</span>
          </div>
          <div className="mt-3 grid grid-cols-2 gap-3">
            <div className="rounded-xl bg-card/80 px-3 py-2.5 text-center">
              <p className="text-[0.75rem] font-semibold text-muted-foreground">你的预测</p>
              <p className="mt-1 text-[0.9375rem] font-bold">
                {latest.studentPrediction ? OUTCOME_LABEL[latest.studentPrediction] : '未记录'}
              </p>
            </div>
            <div className="rounded-xl bg-card/80 px-3 py-2.5 text-center">
              <p className="text-[0.75rem] font-semibold text-muted-foreground">实际观察</p>
              <p className="mt-1 text-[0.9375rem] font-bold">{OUTCOME_LABEL[latest.result.observed]}</p>
            </div>
          </div>
          <p className="mt-3 text-[0.9375rem] leading-6">
            {latestMismatch === true
              ? '你的预测和观察不一样！这不是做错了，而是一个值得再试一次的新发现。'
              : latestMismatch === false
                ? '你的预测和观察一致。可以再看看其他材料，验证这个规律。'
                : '这次实验没有记录预测。'}
          </p>
          {latest.note ? (
            <p className="mt-2 text-[0.8125rem] text-muted-foreground">你的备注：{latest.note}</p>
          ) : null}
          {latest.recordedAt ? (
            <p className="mt-1 text-[0.75rem] text-muted-foreground">
              记录时间：{new Date(latest.recordedAt).toLocaleString('zh-CN')}
            </p>
          ) : null}
        </div>
      ) : (
        <p className="text-[0.875rem] text-muted-foreground">
          还没有实验记录，先选择预测并完成至少一次实验。
        </p>
      )}

      {/* ⑤ 实验记录卡片 */}
      {experiments.length > 0 ? (
        <div className="space-y-2.5">
          <p className="text-[0.875rem] font-semibold text-muted-foreground">
            我的实验记录（{experiments.length} 次）
          </p>
          {experiments.map((experiment) => {
            const mismatch = predictionMismatch(experiment);
            return (
              <div
                key={experiment.id}
                className="flex flex-wrap items-center gap-2.5 rounded-2xl border border-border bg-card px-3.5 py-3 shadow-[var(--exp-shadow-sm)]"
              >
                <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-muted text-[0.8125rem] font-bold">
                  {experiment.trialNo}
                </span>
                <MaterialGlyph materialId={experiment.materialId} size={30} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[0.875rem] font-semibold">
                    {materialName(experiment.materialId)} · {liquidName(experiment.liquidId)}
                  </span>
                  <span className="block text-[0.75rem] text-muted-foreground">
                    {experiment.source === 'real' ? '真实实验记录' : '模拟实验'}
                    {experiment.note ? ` · ${experiment.note}` : ''}
                  </span>
                </span>
                <span className="flex items-center gap-1.5 text-[0.8125rem]">
                  <span className="text-muted-foreground">预测</span>
                  {experiment.studentPrediction ? (
                    <OutcomeGlyph outcome={experiment.studentPrediction} size={30} />
                  ) : (
                    '—'
                  )}
                  <span className="text-muted-foreground">→ 实际</span>
                  <OutcomeGlyph outcome={experiment.result.observed} size={30} />
                </span>
                {mismatch === null ? null : mismatch ? (
                  <ExpPill tone="warn">
                    <Sparkles className="h-3 w-3" aria-hidden />
                    新发现
                  </ExpPill>
                ) : (
                  <ExpPill tone="success">
                    <CircleCheck className="h-3 w-3" aria-hidden />
                    一致
                  </ExpPill>
                )}
              </div>
            );
          })}
        </div>
      ) : null}

      <Note tone="warn" icon={ShieldCheck} title="安全提醒">
        <p className="text-[0.8125rem]">
          实验材料不能吃；铁钉等尖锐材料小心取放；真实实验需要老师或家长陪同。
        </p>
      </Note>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* 子组件                                                              */
/* ------------------------------------------------------------------ */

function StepBadge({ n, label }: { n: number; label: string }) {
  return (
    <p className="flex items-center gap-2 text-[0.9375rem] font-bold">
      <span className="grid h-6 w-6 place-items-center rounded-full bg-primary text-[0.75rem] font-bold text-primary-foreground">
        {n}
      </span>
      {label}
    </p>
  );
}

/** 模拟水箱：动画只呈现后端返回的实际结果（latest.result.observed） */
function WaterTank({
  materialName,
  liquidName,
  latestObserved,
  latestPrediction,
  dropKey,
}: {
  materialName: string;
  liquidName: string;
  latestObserved?: FloatSinkOutcome;
  latestPrediction?: FloatSinkOutcome | null;
  dropKey: string | null;
}) {
  const observed = latestObserved;
  return (
    <div className="exp-tank h-48" role="img" aria-label={`模拟水箱：${materialName}在${liquidName}中`}>
      <div className="exp-tank-water" aria-hidden />
      {dropKey ? <span className="exp-tank-ripple" aria-hidden /> : null}
      {dropKey ? (
        <span className="exp-tank-bubbles" aria-hidden>
          <span className="exp-tank-bubble block" />
          <span className="exp-tank-bubble block" style={{ marginTop: 4, marginLeft: 8 }} />
        </span>
      ) : null}
      {/* 落物：动画终点由后端结果决定 */}
      <div
        key={dropKey ?? observed ?? 'idle'}
        className={cn('exp-tank-item bg-[#C98F5A] text-[#5C3A1E] shadow-md', dropKey && 'exp-tank-drop')}
        style={
          dropKey
            ? { ['--exp-splash-y' as never]: `${SPLASH_Y[observed ?? 'float']}px` }
            : observed
              ? { transform: `translateY(${SPLASH_Y[observed]}px)`, top: 0 }
              : { transform: 'translateY(-8px)', top: 0 }
        }
      >
        {latestObserved ? materialName.slice(0, 2) : '？'}
      </div>
      <span className="absolute bottom-1.5 left-3 text-[0.75rem] font-medium text-[#2b5d7e] dark:text-sky-200">
        {observed ? `${materialName} · ${liquidName}` : `${materialName} · ${liquidName}（等待实验）`}
      </span>
      <span className="absolute right-3 top-2 flex items-center gap-1.5 text-[0.75rem] font-medium text-[#2b5d7e] dark:text-sky-200">
        {latestPrediction && observed ? (
          <>
            你猜 {OUTCOME_LABEL[latestPrediction]} · 实际 {OUTCOME_LABEL[observed]}
          </>
        ) : observed ? (
          <>结果：{OUTCOME_LABEL[observed]}</>
        ) : (
          '按下「完成并记录这次实验」看结果'
        )}
      </span>
      {!latestObserved ? (
        <span className="absolute inset-x-0 top-8 text-center text-[0.8125rem] text-[#2b5d7e]/70 dark:text-sky-200/70">
          {materialName} 正等在水箱上方
        </span>
      ) : null}
    </div>
  );
}
