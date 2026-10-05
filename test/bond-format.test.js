const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
  parsePctNumber,
  formatPctCompact,
  formatYieldDisplay,
  parseBondMoney,
} = require('../src/bond-format');

describe('parsePctNumber', () => {
  it('parses localized percentage strings', () => {
    assert.equal(parsePctNumber('16,5 %'), 16.5);
    assert.equal(parsePctNumber('18.25'), 18.25);
    assert.equal(parsePctNumber(''), null);
  });
});

describe('formatPctCompact', () => {
  it('compacts trailing zeros', () => {
    assert.match(formatPctCompact(16), /16/);
    assert.match(formatPctCompact('18,50'), /18/);
  });
});

describe('formatYieldDisplay', () => {
  it('preserves percent suffix style', () => {
    assert.match(formatYieldDisplay('16,5%'), /16/);
    assert.equal(formatYieldDisplay(''), '—');
  });
});

describe('parseBondMoney', () => {
  it('parses UAH-like strings', () => {
    assert.equal(parseBondMoney('1 234,56'), 1234.56);
    assert.equal(parseBondMoney('bad'), null);
  });
});
