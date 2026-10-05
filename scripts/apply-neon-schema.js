#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const { loadDotEnv } = require('../src/config/load-env');
const { Pool } = require('@neondatabase/serverless');

loadDotEnv();

const url = String(process.env.DATABASE_URL || '').trim();
if (!url) {
  console.error('DATABASE_URL is not set. Run `neon link` or set .env first.');
  process.exit(1);
}

const schemaPath = path.join(__dirname, 'neon-schema.sql');
const text = fs.readFileSync(schemaPath, 'utf8');
const statements = text
  .split(';')
  .map((chunk) => chunk.replace(/^\s*--[^\n]*\n?/gm, '').trim())
  .filter(Boolean);

async function main() {
  const pool = new Pool({ connectionString: url });
  try {
    for (const statement of statements) {
      await pool.query(statement);
    }
    console.log(`Applied ${statements.length} statements from neon-schema.sql`);
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
