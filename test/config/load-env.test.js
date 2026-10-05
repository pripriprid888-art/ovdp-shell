const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { loadDotEnv } = require('../../src/config/load-env');

describe('loadDotEnv', () => {
  it('loads KEY=VALUE pairs without overwriting existing env', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ovdp-env-'));
    const prev = process.env.OVDP_ENV_TEST_KEY;
    delete process.env.OVDP_ENV_TEST_KEY;
    fs.writeFileSync(path.join(dir, '.env'), 'OVDP_ENV_TEST_KEY=from_file\n', 'utf8');
    const cwd = process.cwd();
    try {
      process.chdir(dir);
      loadDotEnv();
      assert.equal(process.env.OVDP_ENV_TEST_KEY, 'from_file');
    } finally {
      process.chdir(cwd);
      if (prev == null) delete process.env.OVDP_ENV_TEST_KEY;
      else process.env.OVDP_ENV_TEST_KEY = prev;
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
