'use client';

/**
 * 真实观察记录台(没有模拟实验能力的任务使用)。
 *
 * 学生先写下自己的猜测,再记录真实观察到的现象。系统只保存学生自己的
 * 记录,不计算、不伪造任何结果。安全提醒按任务快照展示。
 */
import { CircleCheck, Eye, ShieldCheck } from 'lucide-react';
import { useState } from 'react';

import type { InquirySessionState, InquiryTask } from '@/lib/inquiry/domain/types';
import type { InquiryStudyAction } from '@/lib/inquiry/actions';

import { ExpButton, ExpPill, Note } from './exp-ui';

export function RealObservationLab({
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
  const [guess, setGuess] = useState('');
  const [observation, setObservation] = useState('');
  const [note, setNote] = useState('');

  const records = state.collected.evidence.observations;
  const active = records.filter((observationRecord) => !observationRecord.superseded);
  const evidencePhase = task.phases.find((phase) => phase.id === 'evidence');
  const design = state.collected['experiment-design'];
  const designSubmission = design.submissions[design.submissions.length - 1];

  const canRecord = !disabled && guess.trim().length > 0 && observation.trim().length > 0;

  const record = () => {
    if (!canRecord) return;
    onAct({
      action: 'recordObservation',
      guess: guess.trim(),
      observation: observation.trim(),
      ...(note.trim() ? { note: note.trim() } : {}),
    });
    setGuess('');
    setObservation('');
    setNote('');
  };

  return (
    <div className="space-y-4">
      <Note tone="info" icon={Eye} title="这是一个真实观察任务">
        <p className="text-[0.8125rem] leading-6">
          准备好材料后,按本阶段的观察方法认真观察。先把你的猜测写下来,再如实记录你看到的现象——
          不管和猜测是否一样,都是宝贵的证据。
        </p>
        {evidencePhase?.studentTasks.length ? (
          <ul className="mt-1.5 list-inside list-disc space-y-0.5 text-[0.8125rem]">
            {evidencePhase.studentTasks.map((taskItem) => (
              <li key={taskItem}>{taskItem}</li>
            ))}
          </ul>
        ) : null}
      </Note>

      {designSubmission?.content.observedTarget ? (
        <div className="rounded-xl bg-muted/70 px-3.5 py-2.5 text-[0.8125rem] leading-6 text-muted-foreground">
          <span className="font-semibold text-foreground">你要观察的重点</span>
          ：{designSubmission.content.observedTarget}
        </div>
      ) : null}

      {/* 记录表单 */}
      <div className="space-y-3 rounded-2xl border border-border p-4">
        <div>
          <label className="exp-field-label" htmlFor="observation-guess">
            ① 先猜一猜：你觉得会发生什么？
          </label>
          <textarea
            id="observation-guess"
            className="exp-textarea"
            style={{ minHeight: 60 }}
            value={guess}
            onChange={(event) => setGuess(event.target.value)}
            maxLength={300}
            disabled={disabled}
            placeholder="我猜……"
          />
        </div>
        <div>
          <label className="exp-field-label" htmlFor="observation-seen">
            ② 我观察到了什么？
          </label>
          <textarea
            id="observation-seen"
            className="exp-textarea"
            style={{ minHeight: 88 }}
            value={observation}
            onChange={(event) => setObservation(event.target.value)}
            maxLength={1000}
            disabled={disabled}
            placeholder="例如：绿豆苗的茎朝着窗户的方向弯过去了……"
          />
        </div>
        <div>
          <label className="exp-field-label" htmlFor="observation-note">
            ③ 补充说明（可不填）
          </label>
          <input
            id="observation-note"
            className="exp-input"
            value={note}
            onChange={(event) => setNote(event.target.value)}
            maxLength={300}
            disabled={disabled}
            placeholder="例如：这是第 3 天的观察"
          />
        </div>
        <ExpButton variant="secondary" disabled={!canRecord} onClick={record} className="w-full sm:w-auto">
          {guess.trim() && observation.trim() ? '记录这次观察' : '先写下猜测和观察'}
        </ExpButton>
      </div>

      {/* 记录列表 */}
      {active.length ? (
        <div className="space-y-2.5">
          <p className="text-[0.875rem] font-semibold text-muted-foreground">
            我的观察记录（{active.length} 次）
          </p>
          {active.map((recordItem) => (
            <div
              key={recordItem.id}
              className="rounded-2xl border border-border bg-card px-4 py-3 shadow-[var(--exp-shadow-sm)]"
            >
              <div className="flex flex-wrap items-center gap-2">
                <span className="grid h-8 w-8 place-items-center rounded-full bg-[var(--exp-teal-soft)] text-[0.8125rem] font-bold text-[var(--exp-teal)]">
                  {recordItem.trialNo}
                </span>
                <ExpPill tone="neutral">真实观察</ExpPill>
                {recordItem.recordedAt ? (
                  <span className="text-[0.75rem] text-muted-foreground">
                    {new Date(recordItem.recordedAt).toLocaleString('zh-CN')}
                  </span>
                ) : null}
              </div>
              <div className="mt-2 grid gap-2 sm:grid-cols-2">
                <p className="rounded-xl bg-muted/60 px-3 py-2 text-[0.875rem] leading-6">
                  <span className="mr-1 text-[0.75rem] font-semibold text-muted-foreground">我的猜测</span>
                  {recordItem.guess}
                </p>
                <p className="rounded-xl bg-[var(--primary-soft)] px-3 py-2 text-[0.875rem] leading-6">
                  <span className="mr-1 text-[0.75rem] font-semibold text-primary">我观察到</span>
                  {recordItem.observation}
                </p>
              </div>
              {recordItem.note ? (
                <p className="mt-1.5 text-[0.8125rem] text-muted-foreground">备注：{recordItem.note}</p>
              ) : null}
            </div>
          ))}
          <p className="flex items-center gap-1.5 text-[0.8125rem] text-muted-foreground">
            <CircleCheck className="h-3.5 w-3.5 text-primary" aria-hidden />
            猜测和观察不一样也没关系——记录下来,它就是你的新发现。
          </p>
        </div>
      ) : (
        <p className="text-[0.875rem] text-muted-foreground">
          还没有观察记录。和老师一起准备好材料后,写下第一次观察吧。
        </p>
      )}

      {/* 安全提醒(任务快照) */}
      {task.safety.length ? (
        <Note tone="warn" icon={ShieldCheck} title="安全提醒">
          <ul className="list-inside list-disc space-y-0.5 text-[0.8125rem]">
            {task.safety.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </Note>
      ) : null}
    </div>
  );
}
