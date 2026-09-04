const EXTRACT_BONDS_LIST_JS = `(() => {
  const results = [];
  const seen = new Set();

  for (const bondEl of document.querySelectorAll('[data-qa-node="bond"]')) {
    const isin = (bondEl.querySelector('[data-qa-node="isin"]')?.innerText || '')
      .replace(/\\s+/g, ' ')
      .trim();
    if (!/^UA\\d{10}$/.test(isin) || seen.has(isin)) continue;
    seen.add(isin);

    const name = (bondEl.querySelector('[data-qa-node="name"]')?.innerText || '')
      .replace(/\\s+/g, ' ')
      .trim();
    const maturity = (bondEl.querySelector('[data-qa-node="date"]')?.innerText || '')
      .replace(/\\s+/g, ' ')
      .trim() || null;
    const priceRaw = (bondEl.querySelector('[data-qa-node="price"]')?.innerText || '')
      .replace(/\\u00a0/g, ' ')
      .replace(/\\s+/g, ' ')
      .trim();
    const yieldRaw = (bondEl.querySelector('[data-qa-node="yield"]')?.innerText || '')
      .replace(/\\s+/g, ' ')
      .trim();

    results.push({
      isin,
      name,
      maturity_date: maturity,
      price_raw: priceRaw,
      yield_raw: yieldRaw,
    });
  }

  return results;
})()`;

const PREPARE_BONDS_LIST_JS = `(() => {
  let dismissed = 0;
  for (let round = 0; round < 8; round += 1) {
    let closed = false;
    for (const sel of [
      '[data-qa-node*="cancel"]',
      '[data-qa-node*="close"]',
      '[data-qa-node*="skip"]',
    ]) {
      const node = document.querySelector(sel);
      if (node && node.offsetParent !== null) {
        node.click();
        closed = true;
        dismissed += 1;
        break;
      }
    }
    if (!closed) break;
  }

  for (const el of document.querySelectorAll('[data-qa-node="filter-currency"]')) {
    if ((el.innerText || '').trim() === 'UAH') {
      el.click();
      return { dismissed, uahFilter: true };
    }
  }

  return { dismissed, uahFilter: false };
})()`;

const CATALOG_URL = 'https://next.privat24.ua/bonds/list';
const BOND_CATEGORY = 'Державні облігації';

function formatYield(value) {
  if (!value) return null;
  const cleaned = String(value).trim().replace(',', '.');
  if (cleaned.endsWith('%')) return cleaned;
  return `${cleaned}%`;
}

function parsePrivatPrice(raw) {
  if (!raw) return { amount: null, currency: null };
  const text = String(raw).replace(/\u00a0/g, ' ').trim();
  const upper = text.toUpperCase();
  let currency = null;
  if (/\bUSD\b|\$/.test(upper)) currency = 'USD';
  else if (/\bEUR\b|€/.test(upper)) currency = 'EUR';
  else if (/\bUAH\b|₴|ГРН/.test(upper)) currency = 'UAH';

  const amountMatch = text.match(/([\d\s.,]+)/);
  if (!amountMatch) return { amount: null, currency };
  const amount = parseFloat(amountMatch[1].replace(/\s/g, '').replace(',', '.'));
  return {
    amount: Number.isFinite(amount) ? amount : null,
    currency,
  };
}

const { normalizeMaturityDate } = require('../bond-dates');

function privatPurchaseUrl(isin) {
  return `https://next.privat24.ua/bonds/purchase/${encodeURIComponent(isin)}`;
}

const { toCalculatorFields, normalizeBuyPriceUah } = require('./utils');

function processRawItems(rawItems) {
  const seen = new Set();
  const proposals = [];

  for (const item of rawItems || []) {
    const isin = item.isin;
    if (!isin || seen.has(isin)) continue;

    const { amount, currency } = parsePrivatPrice(item.price_raw);
    if (currency !== 'UAH' || amount == null) continue;

    seen.add(isin);
    const yieldPercent = formatYield(item.yield_raw);
    const title = item.name ? `${item.name} ${isin}` : `ОВДП ${isin}`;

    const proposal = {
      site_id: 'privat',
      category: BOND_CATEGORY,
      title,
      isin,
      yield_percent: yieldPercent,
      maturity_date: normalizeMaturityDate(item.maturity_date),
      buy_price: normalizeBuyPriceUah(amount),
      sell_price: null,
      source_url: CATALOG_URL,
      buy_url: privatPurchaseUrl(isin),
      tag: 'UAH',
      nominal_value: '1000 ₴',
      raw_fields: {
        currency: 'UAH',
        price_raw: item.price_raw || '',
        yield_raw: item.yield_raw || '',
        name: item.name || '',
      },
      is_buyable: true,
      scanned_at: new Date().toISOString(),
    };
    proposal.calculator = toCalculatorFields(proposal, 1000);
    proposals.push(proposal);
  }

  return proposals;
}

module.exports = {
  CATALOG_URL,
  EXTRACT_BONDS_LIST_JS,
  PREPARE_BONDS_LIST_JS,
  privatPurchaseUrl,
  processRawItems,
};
