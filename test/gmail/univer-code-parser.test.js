const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
  buildUniverGmailQuery,
  extractVerificationCode,
  isUniverOtpSender,
  UNIVER_OTP_FROM,
} = require('../../src/gmail/univer-code-parser');

describe('buildUniverGmailQuery', () => {
  it('searches noreply@univer.ua from the last day only', () => {
    const q = buildUniverGmailQuery();
    assert.match(q, /newer_than:1d/);
    assert.match(q, new RegExp(`from:${UNIVER_OTP_FROM.replace('.', '\\.')}`));
    assert.doesNotMatch(q, /765257/);
  });
});

describe('isUniverOtpSender', () => {
  it('accepts UNIVER display name with noreply address', () => {
    assert.equal(isUniverOtpSender('УНІВЕР <noreply@univer.ua>'), true);
    assert.equal(isUniverOtpSender('noreply@univer.ua'), true);
    assert.equal(isUniverOtpSender('other@univer.ua'), false);
  });
});

describe('extractVerificationCode', () => {
  it('extracts code from Ukrainian label', () => {
    assert.equal(
      extractVerificationCode('Ваш код підтвердження: 482916. Дійсний 5 хвилин.'),
      '482916',
    );
  });

  it('extracts code from English label', () => {
    assert.equal(extractVerificationCode('Verification code: 123456'), '123456');
  });

  it('returns null when ambiguous', () => {
    assert.equal(extractVerificationCode('123456 654321'), null);
  });
});

