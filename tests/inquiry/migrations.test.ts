import { PGlite } from '@electric-sql/pglite';
import { splitSqlStatements } from '@openmaic/storage/pg-migrations';
import { describe, expect, it } from 'vitest';

import { INQUIRY_MIGRATIONS, ensureInquirySchema } from '@/lib/persistence/inquiry-tables';
import { APP_SCHEMA_STORES } from '@/lib/persistence/schema-stores';

describe('inquiry store migrations', () => {
  it('declares consecutive versions starting at 1', () => {
    expect(INQUIRY_MIGRATIONS.store).toBe('inquiry');
    INQUIRY_MIGRATIONS.migrations.forEach((migration, index) => {
      expect(migration.version).toBe(index + 1);
      expect(migration.name.length).toBeGreaterThan(0);
    });
  });

  it('is registered with the application schema stores', () => {
    const registered = APP_SCHEMA_STORES.find((set) => set.store === INQUIRY_MIGRATIONS.store);
    expect(registered).toBeDefined();
    expect(registered!.migrations).toBe(INQUIRY_MIGRATIONS.migrations);
  });

  it('provisions every table the P1 design requires', () => {
    const sql = INQUIRY_MIGRATIONS.migrations.map((migration) => migration.up).join('\n');
    for (const table of [
      'inquiry_tasks',
      'inquiry_studies',
      'inquiry_events',
      'inquiry_commands',
      'inquiry_evidence',
      'inquiry_experiments',
      'inquiry_evaluations',
      'inquiry_reports',
    ]) {
      expect(sql).toContain(`CREATE TABLE ${table}`);
    }
    expect(sql).toContain('PRIMARY KEY(study_id, sequence)');
    expect(sql).toContain('PRIMARY KEY(study_id, command_id)');
    expect(sql).toContain('revision INTEGER NOT NULL DEFAULT 0');
    expect(sql).toContain('superseded BOOLEAN NOT NULL DEFAULT false');
  });

  it('splits into non-empty statements with balanced basics', () => {
    for (const migration of INQUIRY_MIGRATIONS.migrations) {
      expect(typeof migration.up).toBe('string');
      const statements = splitSqlStatements(migration.up as string);
      expect(statements.length).toBeGreaterThanOrEqual(migration.version === 1 ? 8 : 1);
      for (const statement of statements) expect(statement.trim().length).toBeGreaterThan(0);
    }
    expect((INQUIRY_MIGRATIONS.migrations[0]!.up as string).includes('CREATE TABLE inquiry_studies'))
      .toBe(true);
  });

  it('exposes a bootstrap helper', () => {
    expect(typeof ensureInquirySchema).toBe('function');
  });

  it('applies to a clean database, enforces keys, and skips on a second boot', async () => {
    const db = new PGlite();
    await db.waitReady;
    try {
      await ensureInquirySchema(db);

      const tables = await db.query<{ table_name: string }>(
        `SELECT table_name FROM information_schema.tables
         WHERE table_schema = 'public' AND table_name LIKE 'inquiry_%'
         ORDER BY table_name`,
      );
      expect(tables.rows.map((row) => row.table_name)).toEqual([
        'inquiry_commands',
        'inquiry_evaluations',
        'inquiry_events',
        'inquiry_evidence',
        'inquiry_experiments',
        'inquiry_report_versions',
        'inquiry_reports',
        'inquiry_studies',
        'inquiry_task_drafts',
        'inquiry_tasks',
      ]);

      await db.query(
        `INSERT INTO inquiry_tasks
           (id,key,name,grade,version,goals,concepts,knowledge,materials,liquids,safety,phases)
         VALUES ('task-1','float-sink','沉浮','3-4','1.0.0','[]','[]','{}','[]','[]','[]','[]')`,
      );
      await db.query(
        `INSERT INTO inquiry_studies (id,task_id,owner_id,learner_key,state,status)
         VALUES ('study-1','task-1','owner-1','learner-1','{"status":"created"}','created')`,
      );
      const study = await db.query<{ revision: number }>(
        `SELECT revision FROM inquiry_studies WHERE id = 'study-1'`,
      );
      expect(study.rows).toEqual([{ revision: 0 }]);

      await db.query(
        `INSERT INTO inquiry_events (study_id, sequence, event)
         VALUES ('study-1', 1, '{"type":"session.started","taskId":"task-1"}')`,
      );
      await expect(
        db.query(
          `INSERT INTO inquiry_events (study_id, sequence, event)
           VALUES ('study-1', 1, '{"type":"session.started","taskId":"task-1"}')`,
        ),
      ).rejects.toThrow();

      await db.query(
        `INSERT INTO inquiry_commands (study_id, command_id, result)
         VALUES ('study-1', 'cmd-1', '{}')`,
      );
      await expect(
        db.query(
          `INSERT INTO inquiry_commands (study_id, command_id, result)
           VALUES ('study-1', 'cmd-1', '{}')`,
        ),
      ).rejects.toThrow();

      const definitionColumn = await db.query<{ column_name: string }>(
        `SELECT column_name FROM information_schema.columns
         WHERE table_schema = 'public' AND table_name = 'inquiry_tasks' AND column_name = 'definition'`,
      );
      expect(definitionColumn.rows).toEqual([{ column_name: 'definition' }]);

      // A second boot records nothing new and runs no statements twice.
      await ensureInquirySchema(db);
      const versions = await db.query<{ version: number; name: string }>(
        `SELECT version, name FROM openmaic_schema_migrations WHERE store = 'inquiry' ORDER BY version`,
      );
      expect(versions.rows).toEqual([
        { version: 1, name: 'inquiry-core' },
        { version: 2, name: 'task-definition' },
        { version: 3, name: 'study-creation-command' },
        { version: 4, name: 'evaluation-reports-and-review' },
        { version: 5, name: 'scope-projection-keys' },
        { version: 6, name: 'task-generation' },
      ]);
    } finally {
      await db.close();
    }
  });
});
