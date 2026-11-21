'use client';

/**
 * 自主提问流程:提问 → AI 理解(必要时追问,≤3 轮)→ 生成六阶段方案 → 预览确认。
 *
 * 方案生成是一次结构化调用(非流式);失败随时可以重试,不会留下半成品。
 * 确认后由一个幂等命令创建学习会话并进入现有工作台。
 */
import { useRouter } from 'next/navigation';
import { ArrowLeft, GraduationCap, Lightbulb, Sparkles } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';

import type { InquiryTask } from '@/lib/inquiry/domain/types';

import { ExploreShell } from './exp-shell';
import { ExpButton, ExpPill, Note } from './exp-ui';
import { TaskPreview } from './task-preview';
import { rememberStudy } from './recent-studies';
import type { UnderstandResult } from '@/lib/inquiry/generation/understand';

/** Mirrors lib/inquiry/generation/understand.ts; kept local so the client
 *  bundle never imports the server-only generation module. */
const MAX_CLARIFY_ROUNDS = 3;

type Stage = 'asking' | 'generating' | 'preview';

const QUESTION_LIMIT = 300;

const GENERATING_STEPS = [
  '导师正在理解你的问题…',
  '正在设计六步探究地图…',
  '正在挑选材料和想好安全提醒…',
  '快好了，再等一下下…',
];

function newCommandId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  return `cmd-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export function NewInquiryFlow() {
  const router = useRouter();
  const [stage, setStage] = useState<Stage>('asking');
  const [question, setQuestion] = useState('');
  const [understanding, setUnderstanding] = useState<UnderstandResult | null>(null);
  const [clarifications, setClarifications] = useState<string[]>([]);
  const [answer, setAnswer] = useState('');
  const [refinedQuestion, setRefinedQuestion] = useState('');
  const [definition, setDefinition] = useState<InquiryTask | null>(null);
  const [draftId, setDraftId] = useState<string | null>(null);
  const [version, setVersion] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [generatingStep, setGeneratingStep] = useState(0);
  const startedRef = useRef(false);

  const generate = useCallback(
    async (
      questionText: string,
      refined: string,
      options?: { feedback?: string; existingDraftId?: string | null },
    ) => {
      setBusy(true);
      setError(null);
      setStage('generating');
      try {
        const response = await fetch('/api/inquiry/generate/task', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            originalQuestion: questionText,
            refinedQuestion: refined,
            ...(options?.feedback ? { feedback: options.feedback } : {}),
            ...(options?.existingDraftId ? { draftId: options.existingDraftId } : {}),
          }),
        });
        const body = (await response.json().catch(() => ({}))) as {
          draftId?: string;
          version?: number;
          definition?: InquiryTask;
          error?: string;
        };
        if (!response.ok || !body.definition || !body.draftId) {
          setError(body.error ?? '导师这次没有把方案整理好，请再试一次。');
          setStage(options?.existingDraftId ? 'preview' : 'asking');
          return;
        }
        setDraftId(body.draftId);
        setVersion(body.version ?? 1);
        setDefinition(body.definition);
        setStage('preview');
      } catch {
        setError('网络中断了，方案没有生成成功。请再试一次。');
        setStage(options?.existingDraftId ? 'preview' : 'asking');
      } finally {
        setBusy(false);
      }
    },
    [],
  );

  const understand = useCallback(
    async (questionText: string, answers: string[], round: number) => {
      setBusy(true);
      setError(null);
      try {
        const response = await fetch('/api/inquiry/generate/understand', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ question: questionText, clarifications: answers, round }),
        });
        const body = (await response.json().catch(() => ({}))) as {
          understanding?: UnderstandResult;
          error?: string;
        };
        if (!response.ok || !body.understanding) {
          setError(body.error ?? '导师暂时没有回应，请再试一次。');
          return;
        }
        setUnderstanding(body.understanding);
        if (body.understanding.status === 'ready') {
          const refined = body.understanding.clarifiedQuestion ?? questionText;
          setRefinedQuestion(refined);
          // Ready means the question is understood: generate straight away.
          void generate(questionText, refined);
        }
      } catch {
        setError('网络中断了，请再试一次。');
      } finally {
        setBusy(false);
      }
    },
    [generate],
  );

  // 从首页带着问题跳过来:自动开始理解
  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;
    const params = new URLSearchParams(window.location.search);
    const initial = (params.get('q') ?? '').trim().slice(0, QUESTION_LIMIT);
    if (initial) {
      setQuestion(initial);
      void understand(initial, [], 1);
    }
  }, [understand]);

  // 生成等待文案轮播
  useEffect(() => {
    if (stage !== 'generating') return;
    setGeneratingStep(0);
    const timer = setInterval(
      () => setGeneratingStep((step) => Math.min(step + 1, GENERATING_STEPS.length - 1)),
      2600,
    );
    return () => clearInterval(timer);
  }, [stage]);

  const submitQuestion = () => {
    const trimmed = question.trim();
    if (!trimmed || busy) return;
    setClarifications([]);
    setUnderstanding(null);
    setDefinition(null);
    setDraftId(null);
    setVersion(0);
    void understand(trimmed, [], 1);
  };

  const submitAnswer = () => {
    const trimmedAnswer = answer.trim();
    if (!trimmedAnswer || busy) return;
    const next = [...clarifications, trimmedAnswer];
    setClarifications(next);
    setAnswer('');
    void understand(question.trim(), next, next.length + 1);
  };

  const confirm = async () => {
    if (!draftId || busy) return;
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(
        `/api/inquiry/generate/${encodeURIComponent(draftId)}/confirm`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ commandId: newCommandId() }),
        },
      );
      const body = (await response.json().catch(() => ({}))) as {
        studyId?: string;
        error?: string;
      };
      if (!response.ok || !body.studyId) {
        setError(body.error ?? '暂时无法开始探究，请再试一次。');
        return;
      }
      rememberStudy({
        studyId: body.studyId,
        taskKey: 'generated',
        taskName: definition?.name ?? '我的探究',
      });
      router.push(`/inquiry/study/${body.studyId}`);
    } catch {
      setError('网络中断了，请再试一次。');
    } finally {
      setBusy(false);
    }
  };

  const backToQuestion = () => {
    setStage('asking');
    setDefinition(null);
    setDraftId(null);
    setVersion(0);
    setUnderstanding(null);
    setClarifications([]);
    setError(null);
  };

  const refine = (feedback: string) => {
    if (!definition) return;
    void generate(question.trim(), refinedQuestion, { feedback, existingDraftId: draftId });
  };

  const followUp =
    understanding && (understanding.status === 'clarify' || understanding.status === 'redirect')
      ? understanding.followUp
      : null;

  return (
    <ExploreShell>
      <main className="mx-auto max-w-3xl px-4 pb-4 pt-6">
        <button
          type="button"
          onClick={() => router.push('/inquiry')}
          className="inline-flex items-center gap-1.5 rounded-full px-2 py-1.5 text-[0.875rem] font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" aria-hidden />
          返回首页
        </button>

        {stage === 'preview' && definition ? (
          <>
            {error ? (
              <div className="mt-4">
                <Note tone="warn" title="刚才没有成功">
                  {error}
                </Note>
              </div>
            ) : null}
            <div className="mt-4">
              <TaskPreview
                definition={definition}
                originalQuestion={question.trim()}
                refinedQuestion={refinedQuestion}
                version={version}
                busy={busy}
                onConfirm={() => void confirm()}
                onRevise={refine}
                onBackToQuestion={backToQuestion}
              />
            </div>
          </>
        ) : stage === 'generating' ? (
          <section className="exp-card mt-6 flex flex-col items-center gap-4 px-6 py-12 text-center">
            <span className="grid h-16 w-16 place-items-center rounded-full bg-[var(--exp-teal-soft)] text-[var(--exp-teal)]">
              <Sparkles className="h-8 w-8 animate-pulse" aria-hidden />
            </span>
            <div>
              <p className="text-lg font-bold" role="status">
                {GENERATING_STEPS[generatingStep]}
              </p>
              <p className="mt-1 text-[0.875rem] text-muted-foreground">
                正在为「{refinedQuestion || question.trim()}」设计探究方案
              </p>
            </div>
            <div className="exp-loading">
              <span className="exp-loading-dot" />
              <span className="exp-loading-dot" />
              <span className="exp-loading-dot" />
            </div>
            <p className="max-w-md text-[0.75rem] text-muted-foreground">
              这一步需要和导师商量，通常要十几秒，请耐心等一等。
            </p>
          </section>
        ) : (
          <section className="exp-fade-up mt-4 space-y-4">
            {/* 问题输入 */}
            <div className="exp-card p-5 sm:p-6">
              <div className="flex items-center gap-2.5">
                <span className="grid h-10 w-10 place-items-center rounded-2xl bg-[var(--exp-sky-soft)] text-[var(--exp-sky)]">
                  <Lightbulb className="h-5 w-5" aria-hidden />
                </span>
                <div>
                  <h1 className="text-xl font-bold">今天，你想探究什么？</h1>
                  <p className="text-[0.8125rem] text-muted-foreground">
                    写下你的问题，导师会先理解它，再帮你设计探究方案。
                  </p>
                </div>
              </div>
              <textarea
                className="exp-textarea mt-4 text-[1.0625rem] leading-8"
                style={{ minHeight: 96 }}
                value={question}
                onChange={(event) => setQuestion(event.target.value)}
                maxLength={QUESTION_LIMIT}
                disabled={busy}
                placeholder="例如：为什么有些东西能浮在水面上？"
                aria-label="你想探究的问题"
              />
              <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
                <span className="text-[0.75rem] text-muted-foreground">
                  {busy ? (
                    <span className="inline-flex items-center gap-1.5 text-primary">
                      <span className="exp-typing-dot" />
                      <span className="exp-typing-dot" />
                      <span className="exp-typing-dot" />
                      导师正在理解你的问题…
                    </span>
                  ) : (
                    '写得越具体，导师越容易帮你设计探究'
                  )}
                </span>
                <ExpButton
                  onClick={submitQuestion}
                  disabled={busy || question.trim().length < 4}
                  size="lg"
                >
                  <GraduationCap className="h-5 w-5" aria-hidden />
                  {clarifications.length ? '重新开始理解' : '让导师理解我的问题'}
                </ExpButton>
              </div>
            </div>

            {/* 追问对话 */}
            {clarifications.length ? (
              <div className="space-y-2">
                {clarifications.map((item, index) => (
                  <div key={`${item}-${index}`} className="flex justify-end">
                    <p className="exp-bubble exp-bubble-student">{item}</p>
                  </div>
                ))}
              </div>
            ) : null}

            {followUp ? (
              <div className="exp-card p-5">
                <div className="flex items-start gap-3">
                  <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-[var(--exp-teal-soft)] text-[var(--exp-teal)]">
                    <GraduationCap className="h-5 w-5" aria-hidden />
                  </span>
                  <div className="min-w-0">
                    <p className="flex items-center gap-2 text-[0.8125rem] font-semibold text-[var(--exp-teal)]">
                      科学探究导师
                      {understanding?.status === 'redirect' ? (
                        <ExpPill tone="info">换一种探究方式</ExpPill>
                      ) : (
                        <ExpPill tone="warn">再问一句</ExpPill>
                      )}
                    </p>
                    <p className="mt-1 text-[0.9375rem] leading-7">{followUp}</p>
                  </div>
                </div>
                {understanding?.options?.length ? (
                  <div className="mt-3 flex flex-wrap gap-2">
                    {understanding.options.map((option) => (
                      <button
                        key={option}
                        type="button"
                        className="exp-prompt-chip"
                        disabled={busy}
                        onClick={() => setAnswer(option)}
                      >
                        {option}
                      </button>
                    ))}
                  </div>
                ) : null}
                <div className="mt-3">
                  <textarea
                    className="exp-textarea"
                    style={{ minHeight: 64 }}
                    value={answer}
                    onChange={(event) => setAnswer(event.target.value)}
                    maxLength={QUESTION_LIMIT}
                    disabled={busy}
                    placeholder="用你自己的话回答导师…"
                    aria-label="回答导师的追问"
                  />
                  <div className="mt-2 flex items-center justify-between gap-2">
                    <span className="text-[0.75rem] text-muted-foreground">
                      第 {clarifications.length + 1} / {MAX_CLARIFY_ROUNDS} 轮
                    </span>
                    <ExpButton size="sm" onClick={submitAnswer} disabled={busy || !answer.trim()}>
                      发送回答
                    </ExpButton>
                  </div>
                </div>
              </div>
            ) : null}

            {understanding?.status === 'refuse' ? (
              <Note tone="warn" title="这个方向我们先换个问题">
                <p className="text-[0.875rem] leading-6">
                  {understanding.followUp ?? understanding.reason}
                </p>
                <p className="mt-1 text-[0.8125rem] text-muted-foreground">
                  试试问一个观察得到、可以做实验的问题吧。
                </p>
              </Note>
            ) : null}

            {error ? (
              <Note tone="warn" title="刚才没有成功">
                <p className="text-[0.875rem]">{error}</p>
                <ExpButton
                  size="sm"
                  variant="soft"
                  className="mt-2"
                  disabled={busy}
                  onClick={submitQuestion}
                >
                  再试一次
                </ExpButton>
              </Note>
            ) : null}
          </section>
        )}
      </main>
    </ExploreShell>
  );
}
