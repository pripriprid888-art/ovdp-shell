const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
  normalizeInzhurPhone,
  SIGNIN_URL,
} = require('../../src/automation/flows/inzhur-signin');

describe('normalizeInzhurPhone', () => {
  it('keeps +380 numbers', () => {
    assert.equal(normalizeInzhurPhone('+380671234567'), '+380671234567');
  });

  it('converts local 0-prefix numbers', () => {
    assert.equal(normalizeInzhurPhone('0671234567'), '+380671234567');
  });
});

describe('Inzhur sign-in URL', () => {
  it('uses dashboard sign-in path', () => {
    assert.equal(SIGNIN_URL, 'https://www.inzhur.reit/dashboard/signin');
  });
});
