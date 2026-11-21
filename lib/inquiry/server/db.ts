/**
 * The narrow database surface the inquiry store uses.
 *
 * Production adapts the shared pg pool; tests adapt PGlite. Keeping the seam
 * this small is what lets the store's transactions and row locks run in the
 * unit suite without a live database.
 */
import type { Pool, PoolClient } from 'pg';

import { getServerPersistenceProvider } from '@/lib/persistence/server-provider';

export interface InquiryQueryable {
  query(
    text: string,
    params?: unknown[],
  ): Promise<{ rows: Record<string, unknown>[] }>;
}

export interface InquiryDb extends InquiryQueryable {
  transaction<T>(body: (tx: InquiryQueryable) => Promise<T>): Promise<T>;
}

/** Adapt a node-postgres pool with explicit BEGIN/COMMIT/ROLLBACK handling. */
export function pgInquiryDb(pool: Pool): InquiryDb {
  const query = (text: string, params?: unknown[]) =>
    pool.query(text, params) as unknown as Promise<{ rows: Record<string, unknown>[] }>;
  return {
    query,
    async transaction<T>(body: (tx: InquiryQueryable) => Promise<T>): Promise<T> {
      const client: PoolClient = await pool.connect();
      try {
        await client.query('BEGIN');
        const tx: InquiryQueryable = {
          query: (text, params) =>
            client.query(text, params) as unknown as Promise<{
              rows: Record<string, unknown>[];
            }>,
        };
        const result = await body(tx);
        await client.query('COMMIT');
        return result;
      } catch (error) {
        await client.query('ROLLBACK').catch(() => undefined);
        throw error;
      } finally {
        client.release();
      }
    },
  };
}

let cached: InquiryDb | undefined;

/**
 * The process's inquiry database. Throws a typed store error when the
 * deployment has no DATABASE_URL — the API answers 404 in that mode.
 */
export async function getInquiryDb(): Promise<InquiryDb> {
  const connectionString = process.env.DATABASE_URL?.trim();
  if (!connectionString) {
    const { InquiryStoreError } = await import('./store');
    throw new InquiryStoreError('PERSISTENCE_UNAVAILABLE', 'DATABASE_URL is not configured');
  }
  if (!cached) {
    const { pool } = await getServerPersistenceProvider(connectionString);
    cached = pgInquiryDb(pool);
  }
  const { ensureInquiryReady } = await import('./store');
  await ensureInquiryReady(cached);
  return cached;
}
