const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
  parseContractNumberFromPurpose,
  enrichPaymentInfo,
} = require('../../src/scanners/portfolio/univer-payment-info');

describe('parseContractNumberFromPurpose', () => {
  it('extracts contract number from UNIVER payment purpose text', () => {
    const text = 'Перерахування коштів згідно договору № БО-260731-6566806 від 2026-08-03 , платник- Петров Ростислав Олександрович';
    assert.equal(parseContractNumberFromPurpose(text), 'БО-260731-6566806');
  });

  it('returns empty string when contract is missing', () => {
    assert.equal(parseContractNumberFromPurpose(''), '');
    assert.equal(parseContractNumberFromPurpose('без договору'), '');
  });
});

describe('enrichPaymentInfo', () => {
  it('derives contract_number from payment purpose', () => {
    const info = enrichPaymentInfo({
      payment_purpose: 'Перерахування коштів згідно договору № БО-123 від 2026-01-01',
    });
    assert.equal(info.contract_number, 'БО-123');
  });
});
