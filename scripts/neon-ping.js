#!/usr/bin/env node
const path = require('path');
const { loadDotEnv } = require('../src/config/load-env');
const { isNeonConfigured, pingNeon } = require('../src/db/neon');

loadDotEnv();

async function main() {
  if (!isNeonConfigured()) {
    console.error('DATABASE_URL is empty. Copy .env.example → .env and paste your Neon connection string.');
    process.exit(1);
  }

  const ok = await pingNeon();
  if (!ok) {
    console.error('Neon ping failed.');
    process.exit(1);
  }
  console.log('Neon OK (SELECT 1).');
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
