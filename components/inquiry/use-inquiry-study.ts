'use client';

/**
 * Client state for one inquiry study.
 *
 * The server is authoritative: every action refreshes from its response, a
 * stale revision refreshes from the 409 body, and a dropped chat stream is
 * recovered by reloading the snapshot and retrying the SAME command id — the
 * server then replays the persisted half instead of duplicating it.
 */
import { useCallback, useEffect, useRef, useState } from 'react';

import type { InquiryEvent } from '@/lib/inquiry/domain/events';
import type {
  ChatMessageRecord,
  InquirySessionState,
  InquiryTask,
} from '@/lib/inquiry/domain/types';
import type { InquiryStudyAction } from '@/lib/inquiry/actions';

export interface StudySnapshot {
  studyId: string;
  revision: number;
  status: string;
  state: InquirySessionState;
  task: InquiryTask;
  events: InquiryEvent[];
}

interface PendingSend {
  commandId: string;
  text: string;
}

function newCommandId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  return `cmd-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export function useInquiryStudy(studyId: string) {
  const [snapshot, setSnapshot] = useState<StudySnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [streaming, setStreaming] = useState(false);
  const [streamingText, setStreamingText] = useState('');
  const [pending, setPending] = useState<PendingSend | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const refresh = useCallback(async () => {
    try {
      const response = await fetch(`/api/inquiry/study/${encodeURIComponent(studyId)}`, {
        cache: 'no-store',
      });
      if (response.status === 404) {
        setError('没有找到这次探究。');
        return;
      }
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const body = (await response.json()) as StudySnapshot;
      setSnapshot(body);
      setError(null);
    } catch {
      setError('暂时无法读取探究记录，请稍后刷新。');
    } finally {
      setLoading(false);
    }
  }, [studyId]);

  useEffect(() => {
    void refresh();
    return () => abortRef.current?.abort();
  }, [refresh]);

  const mergeFromResponse = useCallback(
    (body: { revision?: number; status?: string; state?: InquirySessionState }) => {
      if (!body.state) return;
      setSnapshot((previous) =>
        previous
          ? {
              ...previous,
              revision: body.revision ?? previous.revision,
              status: body.status ?? previous.status,
              state: body.state!,
            }
          : previous,
      );
    },
    [],
  );

  const act = useCallback(
    async (action: InquiryStudyAction) => {
      if (!snapshot || busy) return;
      setBusy(true);
      setNotice(null);
      try {
        const response = await fetch(
          `/api/inquiry/study/${encodeURIComponent(studyId)}/action`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              commandId: newCommandId(),
              expectedRevision: snapshot.revision,
              action,
            }),
          },
        );
        const body = (await response.json().catch(() => ({}))) as Record<string, unknown>;
        if (response.status === 409) {
          mergeFromResponse(body as never);
          setNotice('这次探究在别处有了新的进展，已为你刷新。请再试一次。');
          return;
        }
        if (!response.ok) {
          const message = typeof body.error === 'string' ? body.error : '这一步没有完成。';
          setNotice(message);
          return;
        }
        mergeFromResponse(body as never);
        if (body.replayed === true) setNotice('这一步之前已经提交过，已恢复记录。');
      } catch {
        setNotice('网络中断了，刚才这一步可能没有完成，请刷新后再试。');
        void refresh();
      } finally {
        setBusy(false);
      }
    },
    [busy, mergeFromResponse, refresh, snapshot, studyId],
  );

  const runChat = useCallback(
    async (pendingSend: PendingSend) => {
      if (!snapshot) return;
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;
      setStreaming(true);
      setStreamingText('');
      setNotice(null);
      setPending(pendingSend);

      try {
        const response = await fetch(`/api/inquiry/study/${encodeURIComponent(studyId)}/chat`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          signal: controller.signal,
          body: JSON.stringify({
            commandId: pendingSend.commandId,
            text: pendingSend.text,
            expectedRevision: snapshot.revision,
            lastSeq: snapshot.state.lastSequence,
          }),
        });
        if (!response.ok || !response.body) {
          const body = (await response.json().catch(() => ({}))) as Record<string, unknown>;
          if (response.status === 409) {
            mergeFromResponse(body as never);
            setNotice('这次探究在别处有了新的进展，已为你刷新。请再发一次。');
          } else {
            setNotice(typeof body.error === 'string' ? body.error : '导师暂时没有回应。');
          }
          return;
        }

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        let done = false;
        while (!done) {
          const chunk = await reader.read();
          if (chunk.done) break;
          buffer += decoder.decode(chunk.value, { stream: true });
          let boundary = buffer.indexOf('\n\n');
          while (boundary >= 0) {
            const frame = buffer.slice(0, boundary);
            buffer = buffer.slice(boundary + 2);
            boundary = buffer.indexOf('\n\n');
            if (frame.startsWith(':')) continue;
            const data = frame
              .split('\n')
              .filter((line) => line.startsWith('data: '))
              .map((line) => line.slice(6))
              .join('\n');
            if (!data) continue;
            let event: Record<string, unknown>;
            try {
              event = JSON.parse(data) as Record<string, unknown>;
            } catch {
              continue;
            }
            if (event.type === 'student.recorded' && event.message) {
              const message = event.message as ChatMessageRecord;
              setSnapshot((previous) =>
                previous && !previous.state.conversation.some((m) => m.id === message.id)
                  ? {
                      ...previous,
                      state: {
                        ...previous.state,
                        conversation: [...previous.state.conversation, message],
                      },
                    }
                  : previous,
              );
            } else if (event.type === 'tutor.delta' && typeof event.text === 'string') {
              setStreamingText((previous) => previous + event.text);
            } else if (event.type === 'tutor.done') {
              done = true;
              setPending(null);
              await refresh();
            } else if (event.type === 'tutor.error') {
              done = true;
              setNotice(typeof event.message === 'string' ? event.message : '导师暂时没有回应。');
              if (event.code === 'CONFLICT') await refresh();
            }
          }
        }
        if (!done) {
          // The stream ended without a completed turn: reconcile with the
          // durable half and offer the same command id again.
          setNotice('连接中断了，已恢复已保存的记录。可以点“重试发送”。');
          await refresh();
        }
      } catch (caught) {
        if ((caught as Error)?.name !== 'AbortError') {
          setNotice('连接中断了，已恢复已保存的记录。可以点“重试发送”。');
          await refresh();
        }
      } finally {
        setStreaming(false);
        setStreamingText('');
      }
    },
    [mergeFromResponse, refresh, snapshot, studyId],
  );

  const send = useCallback(
    (text: string) => {
      const trimmed = text.trim();
      if (!trimmed || streaming) return;
      void runChat({ commandId: newCommandId(), text: trimmed });
    },
    [runChat, streaming],
  );

  const retrySend = useCallback(() => {
    if (!pending || streaming) return;
    void runChat(pending);
  }, [pending, runChat, streaming]);

  return {
    snapshot,
    loading,
    error,
    notice,
    busy,
    streaming,
    streamingText,
    pending,
    refresh,
    act,
    send,
    retrySend,
    clearNotice: () => setNotice(null),
  };
}
