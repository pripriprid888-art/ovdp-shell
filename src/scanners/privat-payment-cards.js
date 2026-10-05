const EXTRACT_PRIVAT_PAYMENT_CARDS_JS = String.raw`(() => {
  function norm(el) {
    return (el?.innerText || el?.textContent || '').replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim();
  }

  function parseBalance(text, ariaLabel) {
    const direct = String(text || '').trim();
    if (direct && !/^\*+$/.test(direct.replace(/\s/g, ''))) return direct;
    const match = String(ariaLabel || '').match(/PAYMENT_CARD_ARIA_BALANCE\s+([\d\s.,]+)\s*UAH/i);
    return match ? match[1].trim() : '';
  }

  function parseCard(root, valueHint) {
    if (!root) return null;
    const ariaLabel = root.getAttribute('aria-label') || '';
    const title = norm(root.querySelector('.sc-gZnPbQ'))
      || valueHint
      || '';
    const balanceText = parseBalance(norm(root.querySelector('.sc-bYHUQc')), ariaLabel);
    const ibanMask = norm(root.querySelector('.sc-zlUcK'));
    const numberMask = norm(root.querySelector('.sc-ecTevR'));
    const value = valueHint || title;
    if (!value) return null;
    return {
      value,
      title,
      balanceText: balanceText || null,
      ibanMask: ibanMask || null,
      numberMask: numberMask || null,
      selected: /ARIA_SELECTED/i.test(ariaLabel),
    };
  }

  const selector = document.querySelector('[data-qa-node="cardIddebitSource"]');
  const selectedValue = selector?.getAttribute('data-qa-value') || '';
  let cards = [];

  if (selector) {
    const list = document.querySelector('[data-qa-node="cardIddebitSource-list"]');
    const listVisible = list && list.getBoundingClientRect().height > 0;
    if (!listVisible) selector.click();
  }

  const options = [...document.querySelectorAll('[data-qa-node="cardIddebitSource-option"]')];
  if (options.length) {
    cards = options.map((option) => {
      const root = option.querySelector('[role="button"], [role="listitem"]') || option;
      const card = parseCard(root, option.getAttribute('data-qa-value'));
      if (card && card.value === selectedValue) card.selected = true;
      return card;
    }).filter(Boolean);
  } else if (selector) {
    const root = selector.querySelector('[role="listitem"], [role="button"]') || selector;
    const card = parseCard(root, selectedValue);
    if (card) {
      card.selected = true;
      cards = [card];
    }
  }

  return {
    cards,
    selectedValue: cards.find((card) => card.selected)?.value || selectedValue || null,
  };
})()`;

function buildSelectPrivatPaymentCardScript(cardValue) {
  const value = JSON.stringify(String(cardValue || '').trim());
  return `(() => {
    const VALUE = ${value};
    if (!VALUE) return { ok: false, reason: 'empty_value' };

    const selector = document.querySelector('[data-qa-node="cardIddebitSource"]');
    if (selector?.getAttribute('data-qa-value') === VALUE) {
      return { ok: true, already: true };
    }

    if (selector) selector.click();

    const option = [...document.querySelectorAll('[data-qa-node="cardIddebitSource-option"]')]
      .find((node) => node.getAttribute('data-qa-value') === VALUE);
    if (!option) return { ok: false, reason: 'option_not_found' };

    option.click();
    return { ok: true };
  })()`;
}

function normalizePaymentCardsState(raw = {}) {
  const cards = Array.isArray(raw.cards)
    ? raw.cards.filter((card) => card && card.value)
    : [];
  const selectedValue = raw.selectedValue
    || cards.find((card) => card.selected)?.value
    || null;

  return {
    cards: cards.map((card) => ({
      ...card,
      selected: card.value === selectedValue || Boolean(card.selected),
    })),
    selectedValue,
  };
}

function parseBalanceAmount(balanceText) {
  if (!balanceText) return null;
  const cleaned = String(balanceText).replace(/\s/g, '').replace(',', '.');
  const n = parseFloat(cleaned);
  return Number.isFinite(n) ? n : null;
}

module.exports = {
  EXTRACT_PRIVAT_PAYMENT_CARDS_JS,
  buildSelectPrivatPaymentCardScript,
  normalizePaymentCardsState,
  parseBalanceAmount,
};
