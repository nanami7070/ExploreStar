/** A fresh PGlite database with the inquiry schema and seeds, for store tests. */
import { PGlite } from '@electric-sql/pglite';

import type { InquiryDb } from '@/lib/inquiry/server/db';
import { ensureInquiryReady } from '@/lib/inquiry/server/store';

export interface StoreHarness {
  pglite: PGlite;
  db: InquiryDb;
  close(): Promise<void>;
}

function pgliteInquiryDb(db: PGlite): InquiryDb {
  const rows = (text: string, params?: unknown[]) =>
    db.query(text, params as unknown[]) as unknown as Promise<{
      rows: Record<string, unknown>[];
    }>;
  return {
    query: rows,
    transaction: (body) =>
      db.transaction((tx) =>
        body({
          query: (text, params) =>
            tx.query(text, params as unknown[]) as unknown as Promise<{
              rows: Record<string, unknown>[];
            }>,
        }),
      ),
  };
}

export async function createStoreHarness(): Promise<StoreHarness> {
  const pglite = new PGlite();
  await pglite.waitReady;
  const db = pgliteInquiryDb(pglite);
  await ensureInquiryReady(db);
  return { pglite, db, close: () => pglite.close() };
}
