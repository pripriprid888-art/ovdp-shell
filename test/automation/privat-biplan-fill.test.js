const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { normalizeTopUpAmount } = require('../../src/automation/privat-biplan-fill');

describe('normalizeTopUpAmount', () => {
  it('formats positive amounts with two decimals', () => {
    assert.equal(normalizeTopUpAmount('1500'), '1500.00');
    assert.equal(normalizeTopUpAmount('1 234,5'), '1234.50');
  });

  it('rejects invalid amounts', () => {
    assert.equal(normalizeTopUpAmount(''), '');
    assert.equal(normalizeTopUpAmount('0'), '');
    assert.equal(normalizeTopUpAmount('-10'), '');
    assert.equal(normalizeTopUpAmount('abc'), '');
  });
});
