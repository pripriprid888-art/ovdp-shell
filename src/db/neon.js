const { neon } = require('@neondatabase/serverless');

function getDatabaseUrl() {
  const url = process.env.DATABASE_URL || process.env.NEON_DATABASE_URL || '';
  return String(url).trim();
}

function isNeonConfigured() {
  return getDatabaseUrl().length > 0;
}

function getSql() {
  const url = getDatabaseUrl();
  if (!url) {
    throw new Error('DATABASE_URL is not set (see .env.example)');
  }
  return neon(url);
}

/** @returns {Promise<boolean>} */
async function pingNeon() {
  const sql = getSql();
  const rows = await sql`SELECT 1 AS ok`;
  return Number(rows[0]?.ok) === 1;
}

module.exports = {
  getDatabaseUrl,
  isNeonConfigured,
  getSql,
  pingNeon,
};
