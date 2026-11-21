/**
 * GET /api/inquiry/generate/[draftId] — reload a generated task draft.
 *
 * Used after a refresh on the preview page: the definition comes from the
 * stored snapshot, never from a second model call.
 */
import type { NextRequest } from 'next/server';

import { isServerPersistenceConfigured } from '@/lib/config/feature-flags';
import { getInquiryDb } from '@/lib/inquiry/server/db';
import { getTaskDraft } from '@/lib/inquiry/server/store';
import { ownerJson, ownerNotFound } from '@/lib/server/agent-runtime/route-response';
import { withRequestOwner } from '@/lib/server/identity/with-owner';

export const runtime = 'nodejs';

export async function GET(req: NextRequest, { params }: { params: Promise<{ draftId: string }> }) {
  if (!isServerPersistenceConfigured()) return new Response('Not found', { status: 404 });

  return withRequestOwner(req, async (principal, responseHeaders) => {
    const { draftId } = await params;
    try {
      const db = await getInquiryDb();
      const draft = await getTaskDraft(db, draftId, principal.ownerId);
      if (!draft) return ownerNotFound(responseHeaders);
      return ownerJson(
        {
          draftId: draft.id,
          version: draft.version,
          status: draft.status,
          originalQuestion: draft.originalQuestion,
          refinedQuestion: draft.refinedQuestion,
          definition: draft.definition,
          confirmedStudyId: draft.confirmedStudyId,
        },
        200,
        responseHeaders,
      );
    } catch {
      return ownerNotFound(responseHeaders);
    }
  });
}
