const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

function isPostOtpComplete(body, { hasOtpField = false } = {}) {
  const accepted =
    /замовлення\s+прийняте/i.test(body)
    || /очікуйте\s+повідомлення\s+про\s+виконання/i.test(body);
  const blockedFunds = /Заблоковано\s+Баланс\s+БО/i.test(body);
  const orderDocument = /Client_Order_/i.test(body) && /Завантажити\s+PDF/i.test(body);
  return accepted || orderDocument || (blockedFunds && !hasOtpField);
}

describe('univer post-otp order state', () => {
  it('treats auto-accepted order as complete without Прийняти', () => {
    const body = 'Шановний клієнт Ваше замовлення прийняте, очікуйте повідомлення про виконання.';
    assert.equal(isPostOtpComplete(body), true);
  });

  it('treats blocked funds without OTP field as complete', () => {
    const body = 'Заблоковано Баланс БО 2 007,80 ₴';
    assert.equal(isPostOtpComplete(body, { hasOtpField: false }), true);
    assert.equal(isPostOtpComplete(body, { hasOtpField: true }), false);
  });

  it('treats generated order PDF as complete', () => {
    const body = 'Client_Order_765257 Завантажити PDF';
    assert.equal(isPostOtpComplete(body), true);
  });
});
