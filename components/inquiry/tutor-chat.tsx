'use client';

/**
 * 科学探究导师对话区。
 *
 * 友好、可信赖、不过度拟人化：圆标头像 + 引导问题芯片 + 可读气泡。
 * 保留 SSE 流式展示、断线提示与重试（逻辑在 useInquiryStudy）。
 */
import { GraduationCap, Lightbulb, SendHorizontal, WifiOff } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

import { cn } from '@/lib/utils';
import type { ChatMessageRecord, PhaseId } from '@/lib/inquiry/domain/types';

import { ExpButton } from './exp-ui';

/** 每个阶段的引导问题（点击填入输入框，不自动发送） */
const GUIDED_QUESTIONS: Record<PhaseId, string[]> = {
  question: ['为什么有的东西会浮起来？', '怎样判断一个东西会不会沉？'],
  hypothesis: ['我觉得重的东西会沉，因为……', '把木块放进盐水里会怎样？'],
  'experiment-design': ['一次只改变一个条件为什么更好？', '哪些条件需要保持不变？'],
  evidence: ['你观察到了什么新现象？', '预测和结果一样吗？'],
  analysis: ['几次实验的结果有什么规律？', '哪种材料最容易浮起来？'],
  reflection: ['如果再做一次，你会改哪里？', '你最有把握的结论是什么？'],
};

export function TutorChat({
  conversation,
  streaming,
  streamingText,
  disabled,
  phaseId,
  notice,
  canRetry,
  onSend,
  onRetry,
  onHelp,
}: {
  conversation: ChatMessageRecord[];
  streaming: boolean;
  streamingText: string;
  disabled: boolean;
  phaseId: PhaseId;
  notice: string | null;
  canRetry: boolean;
  onSend: (text: string) => void;
  onRetry: () => void;
  onHelp: () => void;
}) {
  const [draft, setDraft] = useState('');
  const scrollRef = useRef<HTMLDivElement>(null);
  const questions = GUIDED_QUESTIONS[phaseId] ?? [];

  useEffect(() => {
    const element = scrollRef.current;
    if (element) element.scrollTop = element.scrollHeight;
  }, [conversation.length, streamingText]);

  const submit = () => {
    const text = draft.trim();
    if (!text || disabled || streaming) return;
    onSend(text);
    setDraft('');
  };

  return (
    <section className="flex min-h-0 flex-col rounded-3xl border border-border bg-card shadow-[var(--exp-shadow-sm)]">
      {/* 导师身份 */}
      <header className="flex items-center gap-3 border-b border-border px-4 py-3.5">
        <span className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-[var(--exp-teal-soft)] text-[var(--exp-teal)]">
          <GraduationCap className="h-6 w-6" aria-hidden />
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="text-[1rem] font-bold">科学探究导师</h2>
          <p className="truncate text-[0.75rem] text-muted-foreground">
            会启发你思考，不会直接告诉你答案
          </p>
        </div>
        {streaming ? (
          <span className="flex items-center gap-1.5 text-[0.75rem] font-medium text-primary" role="status">
            <span className="exp-typing-dot" />
            <span className="exp-typing-dot" />
            <span className="exp-typing-dot" />
          </span>
        ) : null}
      </header>

      {/* 对话历史 */}
      <div
        ref={scrollRef}
        className="min-h-0 flex-1 space-y-3 overflow-y-auto px-4 py-4"
        style={{ maxHeight: '52vh' }}
        aria-live="polite"
      >
        {conversation.length === 0 && !streaming ? (
          <div className="rounded-2xl border border-dashed border-border px-4 py-6 text-center">
            <p className="text-[0.9375rem] text-muted-foreground">
              你好呀！我是你的探究导师。
              <br />
              卡住的时候，点下面的问题或「求助」告诉我。
            </p>
          </div>
        ) : null}
        {conversation.map((message) => (
          <div
            key={message.id}
            className={cn('flex gap-2', message.role === 'student' ? 'justify-end' : 'justify-start')}
          >
            {message.role === 'tutor' ? (
              <span className="mt-1 grid h-7 w-7 shrink-0 place-items-center rounded-full bg-[var(--exp-teal-soft)] text-[var(--exp-teal)]">
                <GraduationCap className="h-4 w-4" aria-hidden />
              </span>
            ) : null}
            <div
              data-testid="chat-message"
              data-role={message.role}
              className={cn(
                'exp-bubble',
                message.role === 'student' ? 'exp-bubble-student' : 'exp-bubble-tutor',
              )}
            >
              {message.text}
            </div>
          </div>
        ))}
        {streaming ? (
          <div className="flex gap-2">
            <span className="mt-1 grid h-7 w-7 shrink-0 place-items-center rounded-full bg-[var(--exp-teal-soft)] text-[var(--exp-teal)]">
              <GraduationCap className="h-4 w-4" aria-hidden />
            </span>
            <div data-testid="chat-streaming" className="exp-bubble exp-bubble-tutor">
              {streamingText ? (
                streamingText
              ) : (
                <span className="flex items-center gap-1.5" aria-label="导师正在思考">
                  <span className="exp-typing-dot" />
                  <span className="exp-typing-dot" />
                  <span className="exp-typing-dot" />
                </span>
              )}
            </div>
          </div>
        ) : null}
      </div>

      {/* 网络 / 服务提示 */}
      {notice ? (
        <div className="mx-4 mb-2">
          <div className="exp-note exp-note-warn text-[0.875rem]" role="status">
            <WifiOff className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
            <div className="min-w-0 flex-1">
              {notice}
              {canRetry ? (
                <ExpButton variant="soft" size="sm" className="mt-1.5" onClick={onRetry}>
                  重试发送
                </ExpButton>
              ) : null}
            </div>
          </div>
        </div>
      ) : null}

      {/* 引导问题 */}
      <div className="flex gap-1.5 overflow-x-auto px-4 pb-2">
        {questions.map((question) => (
          <button
            key={question}
            type="button"
            className="exp-prompt-chip shrink-0"
            onClick={() => !disabled && setDraft(question)}
          >
            <Lightbulb className="h-3.5 w-3.5" aria-hidden />
            {question}
          </button>
        ))}
      </div>

      {/* 输入区 */}
      <div className="border-t border-border p-3">
        <textarea
          className="exp-textarea"
          style={{ minHeight: 68 }}
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.shiftKey) {
              event.preventDefault();
              submit();
            }
          }}
          placeholder="把你的想法告诉导师……（Enter 发送，Shift+Enter 换行）"
          rows={2}
          maxLength={1000}
          disabled={disabled}
          aria-label="给导师发消息"
        />
        <div className="mt-2 flex items-center justify-between gap-2">
          <ExpButton variant="ghost" size="sm" onClick={onHelp} disabled={disabled}>
            <Lightbulb className="h-4 w-4" aria-hidden />
            向导师求助
          </ExpButton>
          <ExpButton size="sm" onClick={submit} disabled={disabled || streaming || !draft.trim()}>
            <SendHorizontal className="h-4 w-4" aria-hidden />
            {streaming ? '导师回复中…' : '发送'}
          </ExpButton>
        </div>
      </div>
    </section>
  );
}
