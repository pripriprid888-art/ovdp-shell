/**
 * Append-only Neon Postgres log sink. Intentionally no UPDATE/DELETE APIs —
 * «Очистити» in the UI clears local action-log.json only.
 */
const { neon } = require('@neondatabase/serverless');

/** @type {import('@neondatabase/serverless').NeonQueryFunction<boolean, boolean> | null} */
let sql = null;

function getDatabaseUrl() {
  return String(process.env.DATABASE_URL || process.env.NEON_DATABASE_URL || '').trim();
}

function isLogDbConfigured() {
  return getDatabaseUrl().length > 0;
}

function getSql() {
  if (!isLogDbConfigured()) {
    throw new Error('DATABASE_URL is not set');
  }
  if (!sql) sql = neon(getDatabaseUrl());
  return sql;
}

/** Row shape persisted in Postgres (no context). */
function toDbRow(entry) {
  const errorMessage = entry.error?.message
    ? String(entry.error.message)
    : (entry.error && typeof entry.error === 'string' ? entry.error : null);

  return {
    id: String(entry.id),
    at: entry.at || new Date().toISOString(),
    level: String(entry.level || 'info'),
    site_id: entry.siteId || null,
    message: String(entry.message || ''),
    kind: String(entry.kind || 'automation'),
    category: entry.category || null,
    run_id: entry.runId || null,
    error_message: errorMessage,
  };
}

async function insertEntry(entry) {
  if (!isLogDbConfigured()) return false;
  const row = toDbRow(entry);
  const query = getSql();
  await query`
    INSERT INTO action_log_entries (
      id, at, level, site_id, message, kind, category, run_id, error_message
    ) VALUES (
      ${row.id},
      ${row.at},
      ${row.level},
      ${row.site_id},
      ${row.message},
      ${row.kind},
      ${row.category},
      ${row.run_id},
      ${row.error_message}
    )
    ON CONFLICT (id) DO NOTHING
  `;
  return true;
}

function insertEntryAsync(entry) {
  if (!isLogDbConfigured()) return;
  insertEntry(entry).catch(() => {});
}

module.exports = {
  isLogDbConfigured,
  toDbRow,
  insertEntry,
  insertEntryAsync,
};
