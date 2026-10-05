const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');

describe('log-db toDbRow', () => {
  let logDb;

  before(() => {
    delete process.env.DATABASE_URL;
    logDb = require('../../src/automation/log-db');
  });

  after(() => {
    delete require.cache[require.resolve('../../src/automation/log-db')];
  });

  it('has no delete API (audit trail is append-only)', () => {
    assert.equal(logDb.deleteEntries, undefined);
    assert.equal(logDb.clearLogs, undefined);
    assert.equal(logDb.truncateEntries, undefined);
  });

  it('maps entry without context and keeps only error message', () => {
    const row = logDb.toDbRow({
      id: 'abc',
      at: '2026-01-01T12:00:00.000Z',
      level: 'error',
      siteId: 'univer',
      message: 'Failed',
      kind: 'background',
      category: 'scan',
      runId: 'run-1',
      context: { isin: 'UA123', secret: 'x' },
      error: { name: 'Error', message: 'boom', stack: 'long stack' },
    });

    assert.equal(row.id, 'abc');
    assert.equal(row.site_id, 'univer');
    assert.equal(row.error_message, 'boom');
    assert.equal('context' in row, false);
    assert.equal('stack' in row, false);
  });
});
