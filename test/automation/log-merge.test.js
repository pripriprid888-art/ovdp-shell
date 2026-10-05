const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { mergeLogEntries } = require('../../src/automation/log-merge');

describe('log-merge', () => {
  it('merges by id keeping newest at timestamp', () => {
    const local = [{ id: 'a', at: '2026-01-02T10:00:00.000Z', message: 'local' }];
    const remote = [{ id: 'a', at: '2026-01-01T10:00:00.000Z', message: 'remote' }];
    const merged = mergeLogEntries(local, remote, 100);
    assert.equal(merged.length, 1);
    assert.equal(merged[0].message, 'local');
  });

  it('sorts descending by at and respects max', () => {
    const merged = mergeLogEntries(
      [{ id: '1', at: '2026-01-01' }, { id: '2', at: '2026-01-03' }],
      [{ id: '3', at: '2026-01-02' }],
      2,
    );
    assert.deepEqual(merged.map((e) => e.id), ['2', '3']);
  });
});
