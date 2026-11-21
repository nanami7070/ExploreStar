/**
 * POST /api/inquiry/study/[id]/chat — one tutor turn over SSE.
 *
 * The request carries the client's command id (idempotent send) and its
 * `expectedRevision` (compare-and-swap); `lastSeq` makes the stream replay
 * events the client has not seen yet. Frames:
 *
 *   data: {type:'replay', event}         — missed events, before the turn
 *   data: {type:'student.recorded', …}   — durable before generation
 *   data: {type:'tutor.start'|'tutor.delta'|'tutor.done'}
 *   data: {type:'tutor.error', code, …}  — also carries state on CONFLICT
 *   :heartbeat                           — every 15 s
 *
 * Model resolution and streamLLM are the shared OpenMAIC path; only the
 * prompt is inquiry-specific.
 */
import type { NextRequest } from 'next/server';

import { isServerPersistenceConfigured } from '@/lib/config/feature-flags';
import { getInquiryDb } from '@/lib/inquiry/server/db';
import { createDifficultyClassifier } from '@/lib/inquiry/server/difficulty';
import {
  getInquiryCommandResult,
  loadInquiryStudy,
  loadInquiryStudyEvents,
} from '@/lib/inquiry/server/store';
import { runTutorTurn } from '@/lib/inquiry/server/tutor-turn';
import { streamTutorReply } from '@/lib/inquiry/server/tutor-llm';
import {
  ownerApiError,
  ownerJson,
  ownerNotFound,
} from '@/lib/server/agent-runtime/route-response';
import { withRequestOwner } from '@/lib/server/identity/with-owner';
import { resolveModelFromHeaders } from '@/lib/server/resolve-model';

export const runtime = 'nodejs';

const HEARTBEAT_MS = 15_000;

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  if (!isServerPersistenceConfigured()) return new Response('Not found', { status: 404 });

  return withRequestOwner(req, async (principal, responseHeaders) => {
    const { id } = await params;
    let body: Record<string, unknown>;
    try {
      body = (await req.json()) as Record<string, unknown>;
    } catch {
      return ownerApiError('INVALID_REQUEST', 400, '请求格式不正确', responseHeaders);
    }

    const commandId = typeof body.commandId === 'string' ? body.commandId.trim() : '';
    const text = typeof body.text === 'string' ? body.text : '';
    const expectedRevision =
      typeof body.expectedRevision === 'number' && Number.isInteger(body.expectedRevision)
        ? body.expectedRevision
        : undefined;
    const lastSeq =
      typeof body.lastSeq === 'number' && Number.isInteger(body.lastSeq) ? body.lastSeq : undefined;
    if (!commandId || !text.trim()) {
      return ownerApiError('INVALID_REQUEST', 400, '缺少 commandId 或 text', responseHeaders);
    }

    let db;
    try {
      db = await getInquiryDb();
    } catch {
      return new Response('Not found', { status: 404, headers: responseHeaders });
    }
    const study = await loadInquiryStudy(db, id, principal.ownerId);
    if (!study) return ownerNotFound(responseHeaders);
    // A retried send must reach the idempotent command check even though its
    // original expectedRevision is now stale; only a NEW command with a stale
    // revision is refused here.
    const alreadySent = await getInquiryCommandResult(
      db,
      id,
      principal.ownerId,
      `msg:${commandId}`,
    );
    if (
      !alreadySent &&
      expectedRevision !== undefined &&
      expectedRevision !== study.revision
    ) {
      return ownerJson(
        {
          errorCode: 'REVISION_CONFLICT',
          error: '这次探究在别处有了新的进展，请刷新后再试。',
          revision: study.revision,
          state: study.state,
        },
        409,
        responseHeaders,
      );
    }

    let generate;
    let classify;
    try {
      const resolved = await resolveModelFromHeaders(req, 'inquiry-tutor');
      generate = streamTutorReply(resolved);
      classify = createDifficultyClassifier(resolved);
    } catch {
      return ownerApiError('MODEL_CONFIG_INVALID', 400, '导师模型还没有配置好', responseHeaders);
    }

    const encoder = new TextEncoder();
    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        let closed = false;
        const send = (event: unknown) => {
          if (closed) return;
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
        };
        const heartbeat = setInterval(() => {
          if (closed) return;
          try {
            controller.enqueue(encoder.encode(':heartbeat\n\n'));
          } catch {
            // The client went away; the stream closes below.
          }
        }, HEARTBEAT_MS);

        try {
          if (lastSeq !== undefined) {
            const missed = await loadInquiryStudyEvents(db, id, principal.ownerId, lastSeq);
            for (const event of missed ?? []) send({ type: 'replay', event });
          }
          for await (const event of runTutorTurn(
            { db, generate, classify },
            {
              studyId: id,
              ownerId: principal.ownerId,
              commandId,
              text,
              ...(expectedRevision === undefined ? {} : { expectedRevision }),
            },
          )) {
            send(event);
          }
        } catch {
          send({
            type: 'tutor.error',
            code: 'STORE_FAILED',
            message: '导师暂时没有回应，请稍后再试一次。',
          });
        } finally {
          closed = true;
          clearInterval(heartbeat);
          try {
            controller.close();
          } catch {
            // Already closed by the consumer.
          }
        }
      },
    });

    const headers = new Headers(responseHeaders);
    headers.set('Content-Type', 'text/event-stream; charset=utf-8');
    headers.set('Cache-Control', 'no-cache, no-transform');
    headers.set('Connection', 'keep-alive');
    headers.set('X-Accel-Buffering', 'no');
    return new Response(stream, { headers });
  });
}
