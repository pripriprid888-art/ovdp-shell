const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');

describe('db/neon', () => {
  let neonDb;
  let savedUrl;

  before(() => {
    savedUrl = process.env.DATABASE_URL;
    delete process.env.DATABASE_URL;
    delete process.env.NEON_DATABASE_URL;
    neonDb = require('../../src/db/neon');
  });

  after(() => {
    if (savedUrl != null) process.env.DATABASE_URL = savedUrl;
  });

  it('isNeonConfigured is false without DATABASE_URL', () => {
    assert.equal(neonDb.isNeonConfigured(), false);
  });

  it('getSql throws when not configured', () => {
    assert.throws(() => neonDb.getSql(), /DATABASE_URL/);
  });
});
