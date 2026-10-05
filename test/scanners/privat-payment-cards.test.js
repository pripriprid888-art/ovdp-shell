const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
  normalizePaymentCardsState,
  parseBalanceAmount,
} = require('../../src/scanners/privat-payment-cards');

describe('normalizePaymentCardsState', () => {
  it('marks selected card and filters invalid entries', () => {
    const state = normalizePaymentCardsState({
      selectedValue: 'Картка для виплат',
      cards: [
        { value: 'Картка для виплат', title: 'Картка для виплат', balanceText: '38 163.17' },
        { value: '', title: 'broken' },
        { value: 'Картка', title: 'Картка', balanceText: '******' },
      ],
    });

    assert.equal(state.cards.length, 2);
    assert.equal(state.selectedValue, 'Картка для виплат');
    assert.equal(state.cards[0].selected, true);
    assert.equal(state.cards[1].selected, false);
  });
});

describe('parseBalanceAmount', () => {
  it('parses localized balances', () => {
    assert.equal(parseBalanceAmount('38 163.17'), 38163.17);
    assert.equal(parseBalanceAmount('******'), null);
  });
});
