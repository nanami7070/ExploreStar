import { applySchemaMigrations } from '@openmaic/storage/pg-migrations';
import type { Queryable } from '@openmaic/storage/document/pg';

/**
 * Inquiry store: tasks, sessions, the append-only event log, and the
 * projections reports and the teacher view read from.
 *
 * The domain state is event-sourced (lib/inquiry/domain/state.ts); `state` is
 * the folded snapshot for fast reads, while `inquiry_events` stays the source
 * of truth. `revision` is the compare-and-swap token the API layer uses
 * (plan §3.10) — it lives here, not in the domain state, so event replay stays
 * byte-identical.
 */
export const INQUIRY_MIGRATIONS = {
  store: 'inquiry',
  migrations: [
    {
      version: 1,
      name: 'inquiry-core',
      transaction: true,
      up: `
CREATE TABLE inquiry_tasks (
 id TEXT PRIMARY KEY,
 key TEXT NOT NULL UNIQUE,
 name TEXT NOT NULL,
 grade TEXT NOT NULL,
 version TEXT NOT NULL,
 goals JSONB NOT NULL,
 concepts JSONB NOT NULL,
 knowledge JSONB NOT NULL,
 intro JSONB,
 materials JSONB NOT NULL,
 liquids JSONB NOT NULL,
 safety JSONB NOT NULL,
 phases JSONB NOT NULL,
 rubric JSONB,
 published BOOLEAN NOT NULL DEFAULT false,
 created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE inquiry_studies (
 id TEXT PRIMARY KEY,
 task_id TEXT NOT NULL REFERENCES inquiry_tasks(id),
 owner_id TEXT NOT NULL,
 learner_key TEXT NOT NULL,
 state JSONB NOT NULL,
 status TEXT NOT NULL,
 revision INTEGER NOT NULL DEFAULT 0,
 created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX inquiry_studies_owner_idx ON inquiry_studies(owner_id, task_id);
CREATE INDEX inquiry_studies_learner_idx ON inquiry_studies(learner_key);

CREATE TABLE inquiry_events (
 study_id TEXT NOT NULL REFERENCES inquiry_studies(id) ON DELETE CASCADE,
 sequence INTEGER NOT NULL,
 event JSONB NOT NULL,
 recorded_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(study_id, sequence)
);

CREATE TABLE inquiry_commands (
 study_id TEXT NOT NULL REFERENCES inquiry_studies(id) ON DELETE CASCADE,
 command_id TEXT NOT NULL,
 result JSONB,
 created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 PRIMARY KEY(study_id, command_id)
);

CREATE TABLE inquiry_evidence (
 id BIGSERIAL PRIMARY KEY,
 study_id TEXT NOT NULL REFERENCES inquiry_studies(id) ON DELETE CASCADE,
 phase TEXT NOT NULL,
 kind TEXT NOT NULL,
 actor TEXT NOT NULL,
 detail JSONB NOT NULL,
 created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX inquiry_evidence_study_idx ON inquiry_evidence(study_id, id);

CREATE TABLE inquiry_experiments (
 id TEXT PRIMARY KEY,
 study_id TEXT NOT NULL REFERENCES inquiry_studies(id) ON DELETE CASCADE,
 trial_no INTEGER NOT NULL,
 material_id TEXT NOT NULL,
 liquid_id TEXT NOT NULL,
 source TEXT NOT NULL,
 params JSONB NOT NULL,
 result JSONB NOT NULL,
 derived_from JSONB,
 superseded BOOLEAN NOT NULL DEFAULT false,
 created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
 UNIQUE(study_id, id)
);
CREATE INDEX inquiry_experiments_study_idx ON inquiry_experiments(study_id, trial_no);

CREATE TABLE inquiry_evaluations (
 id TEXT PRIMARY KEY,
 study_id TEXT NOT NULL REFERENCES inquiry_studies(id) ON DELETE CASCADE,
 phase TEXT NOT NULL,
 kind TEXT NOT NULL,
 rubric JSONB,
 verdict JSONB NOT NULL,
 evidence_refs JSONB,
 derived_from JSONB,
 superseded BOOLEAN NOT NULL DEFAULT false,
 created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX inquiry_evaluations_study_idx ON inquiry_evaluations(study_id, phase);

CREATE TABLE inquiry_reports (
 study_id TEXT PRIMARY KEY REFERENCES inquiry_studies(id) ON DELETE CASCADE,
 revision INTEGER NOT NULL,
 status TEXT NOT NULL,
 document JSONB,
 updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);`,
    },
    {
      version: 2,
      name: 'task-definition',
      // The canonical task config (phases, hint templates, materials, review
      // provenance) as one JSONB document; the individual columns stay for
      // listing queries. Seeded from lib/inquiry/tasks/*.
      transaction: true,
      up: 'ALTER TABLE inquiry_tasks ADD COLUMN definition JSONB;',
    },
    {
      version: 3,
      name: 'study-creation-command',
      // Idempotent study creation: a retried create command finds the study it
      // already made instead of creating a second one.
      transaction: true,
      up: `
ALTER TABLE inquiry_studies ADD COLUMN creation_command_id TEXT;
CREATE UNIQUE INDEX inquiry_studies_creation_cmd
  ON inquiry_studies(owner_id, creation_command_id)
  WHERE creation_command_id IS NOT NULL;`,
    },
    {
      version: 4,
      name: 'evaluation-reports-and-review',
      transaction: true,
      up: `
ALTER TABLE inquiry_tasks ADD COLUMN review JSONB;
ALTER TABLE inquiry_reports
  ADD COLUMN study_revision INTEGER,
  ADD COLUMN evaluation_version TEXT;
CREATE TABLE inquiry_report_versions (
 study_id TEXT NOT NULL REFERENCES inquiry_studies(id) ON DELETE CASCADE,
 revision INTEGER NOT NULL,
 evaluation_version TEXT NOT NULL,
 study_revision INTEGER NOT NULL,
 status TEXT NOT NULL,
 document JSONB NOT NULL,
 generated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 PRIMARY KEY (study_id, revision)
);`,
    },
    {
      version: 5,
      name: 'scope-projection-keys',
      // Deterministic evaluation ids (e.g. a completion-time soft check) are
      // only unique within a study; the projection key must say so too.
      transaction: true,
      up: `
ALTER TABLE inquiry_evaluations DROP CONSTRAINT inquiry_evaluations_pkey;
ALTER TABLE inquiry_evaluations ADD PRIMARY KEY (study_id, id);
ALTER TABLE inquiry_experiments DROP CONSTRAINT inquiry_experiments_study_id_id_key;
ALTER TABLE inquiry_experiments DROP CONSTRAINT inquiry_experiments_pkey;
ALTER TABLE inquiry_experiments ADD PRIMARY KEY (study_id, id);`,
    },
    {
      version: 6,
      name: 'task-generation',
      // Student-initiated tasks: an AI-generated definition lives in a draft
      // (versioned, owner-scoped) until the student confirms it, at which
      // point it becomes a personal row in inquiry_tasks (owner_id set).
      transaction: true,
      up: `
ALTER TABLE inquiry_tasks ADD COLUMN owner_id TEXT;
CREATE TABLE inquiry_task_drafts (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  original_question TEXT NOT NULL,
  refined_question TEXT,
  definition JSONB NOT NULL,
  version INTEGER NOT NULL DEFAULT 1,
  status TEXT NOT NULL DEFAULT 'draft',
  feedback TEXT,
  confirmed_study_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX inquiry_task_drafts_owner_idx
  ON inquiry_task_drafts(owner_id, updated_at DESC);`,
    },
  ],
};

export const ensureInquirySchema = (db: Queryable) => applySchemaMigrations(db, INQUIRY_MIGRATIONS);
