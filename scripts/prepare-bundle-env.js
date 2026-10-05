#!/usr/bin/env node
/**
 * Copies release env into .env.bundle for electron-builder extraResources.
 * Source: .env.production if present, else .env (must exist for dist builds).
 */
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const out = path.join(root, '.env.bundle');
const production = path.join(root, '.env.production');
const dev = path.join(root, '.env');

let source = null;
if (fs.existsSync(production)) source = production;
else if (fs.existsSync(dev)) source = dev;

if (!source) {
  console.error(
    'Release build needs env vars. Create .env.production (recommended) or .env in the project root.',
  );
  process.exit(1);
}

fs.copyFileSync(source, out);
console.log(`Bundled ${path.basename(source)} → .env.bundle (packaged as Resources/.env)`);
