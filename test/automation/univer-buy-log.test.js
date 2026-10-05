const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { sanitizeBuyLogContext } = require('../../src/automation/flows/univer-buy');

describe('Univer buy audit logging', () => {
  it('strips OTP code from log context but keeps length', () => {
    const sanitized = sanitizeBuyLogContext({
      step: 'Підтвердження коду',
      action: 'fill',
      otpCode: '123456',
      selector: 'input[name="customorder_Kodperevrkiklnt"]',
    });

    assert.equal(sanitized.otpLength, 6);
    assert.equal(sanitized.otpCode, undefined);
    assert.equal(sanitized.selector, 'input[name="customorder_Kodperevrkiklnt"]');
  });
});
