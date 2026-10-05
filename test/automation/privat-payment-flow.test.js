const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
  detectPrivatPaymentStep,
  paymentStepStatusMessage,
} = require('../../src/automation/privat-payment-flow');

describe('detectPrivatPaymentStep', () => {
  it('detects payment confirmation page after Продовжити', () => {
    const step = detectPrivatPaymentStep({
      title: 'Підтвердження платежу',
      serviceName: 'Брокерські послуги',
      total: '1 851 UAH',
      hasConfirmationChecks: true,
      buttons: ['Назад', 'Додати в кошик'],
    });

    assert.equal(step.step, 'confirmation');
    assert.equal(step.serviceName, 'Брокерські послуги');
    assert.match(step.total, /1\s*851/);
  });

  it('detects biplan payment form', () => {
    const step = detectPrivatPaymentStep({
      title: 'Оплата',
      hasFormFields: true,
      formFilled: true,
      buttons: ['Продовжити'],
    });

    assert.equal(step.step, 'form');
    assert.equal(step.formFilled, true);
  });
});

describe('paymentStepStatusMessage', () => {
  it('describes confirmation step with total', () => {
    const message = paymentStepStatusMessage(
      { step: 'confirmation', total: '1 851 UAH' },
      { amount: '1850.00' },
    );
    assert.match(message, /Підтвердження платежу/);
    assert.match(message, /1\s*851/);
  });

  it('describes form step with amount', () => {
    const message = paymentStepStatusMessage({ step: 'form' }, { amount: '1850.00' });
    assert.match(message, /1850\.00/);
  });
});
