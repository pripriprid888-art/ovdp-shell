-- Run once in Neon SQL Editor or: psql "$DATABASE_URL" -f scripts/neon-schema.sql

CREATE TABLE IF NOT EXISTS app_meta (
  key TEXT PRIMARY KEY,
  value JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS scan_snapshots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  kind TEXT NOT NULL CHECK (kind IN ('catalog', 'portfolio', 'orders', 'nbu')),
  site_id TEXT,
  isin_count INT,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS scan_snapshots_created_at_idx ON scan_snapshots (created_at DESC);
CREATE INDEX IF NOT EXISTS scan_snapshots_kind_site_idx ON scan_snapshots (kind, site_id);

-- Action log (minimal columns, no context)
CREATE TABLE IF NOT EXISTS action_log_entries (
  id TEXT PRIMARY KEY,
  at TIMESTAMPTZ NOT NULL,
  level TEXT NOT NULL,
  site_id TEXT,
  message TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'automation',
  category TEXT,
  run_id TEXT,
  error_message TEXT
);

CREATE INDEX IF NOT EXISTS action_log_entries_at_idx ON action_log_entries (at DESC);
CREATE INDEX IF NOT EXISTS action_log_entries_level_idx ON action_log_entries (level);
