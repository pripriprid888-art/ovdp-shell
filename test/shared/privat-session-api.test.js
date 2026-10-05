const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { readXref } = require('../../src/shared/privat-session-api');

describe('readXref', () => {
  it('returns valid 32-char hex xref', () => {
    const xref = 'a1b2c3d4e5f6789012345678abcdef01';
    assert.equal(readXref({ data: { xref } }), xref);
  });

  it('rejects invalid xref values', () => {
    assert.equal(readXref({ data: { xref: 'too-short' } }), '');
    assert.equal(readXref({ data: { xref: 'zzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzz' } }), '');
    assert.equal(readXref({ data: {} }), '');
    assert.equal(readXref(null), '');
  });
});
