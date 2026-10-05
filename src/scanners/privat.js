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

const {
  FETCH_BARGAINING_BONDS_JS,
  FETCH_AUTH_BARGAINING_BONDS_JS,
  parseBargainingApiResponse,
} = require('./privat-api');

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
const { normalizeListedYieldTypeLabel } = require('../bond-calculator');

function processRawItems(rawItems) {
  const seen = new Set();
  const proposals = [];

  for (const item of rawItems || []) {
    const isin = item.isin;
    if (!isin || seen.has(isin)) continue;

    const { amount, currency: parsedCurrency } = parsePrivatPrice(item.price_raw);
    const currency = parsedCurrency || item.currency || item.raw_fields?.currency || null;
    if (currency !== 'UAH' || amount == null) continue;

    seen.add(isin);
    const apiRaw = item.raw_fields && typeof item.raw_fields === 'object' ? item.raw_fields : {};
    const yieldPercent = formatYield(item.yield_raw ?? apiRaw.buyYield);
    const title = item.name ? `${item.name} ${isin}` : `ОВДП ${isin}`;
    const listedYieldType = normalizeListedYieldTypeLabel(apiRaw.yieldType || item.yieldType);

    const proposal = {
      site_id: 'privat',
      category: BOND_CATEGORY,
      title,
      isin,
      yield_percent: yieldPercent,
      listed_yield_type: listedYieldType,
      maturity_date: normalizeMaturityDate(item.maturity_date || apiRaw.maturity),
      buy_price: normalizeBuyPriceUah(amount),
      sell_price: null,
      source_url: CATALOG_URL,
      buy_url: privatPurchaseUrl(isin),
      tag: 'UAH',
      nominal_value: '1000 ₴',
      raw_fields: {
        ...apiRaw,
        currency: 'UAH',
        price_raw: item.price_raw ?? apiRaw.buyPrice ?? '',
        yield_raw: item.yield_raw ?? apiRaw.buyYield ?? '',
        name: item.name || apiRaw.name || '',
      },
      is_buyable: true,
      scanned_at: new Date().toISOString(),
    };
    proposal.calculator = toCalculatorFields(proposal, 1000);
    proposals.push(proposal);
  }

  return proposals;
}

function processApiCatalogResult(apiResult) {
  const parsed = parseBargainingApiResponse(apiResult);
  return {
    ...parsed,
    items: processRawItems(parsed.items),
  };
}

function normalizePrivatIsin(isin) {
  return String(isin || '').trim().toUpperCase();
}

/**
 * Catalog = ISINs visible on bonds/list (UAH). API enriches rows; API-only rows are dropped.
 */
function mergeDomWithApiCatalog(domRawItems, apiResult) {
  const parsed = apiResult ? parseBargainingApiResponse(apiResult) : { items: [], xref: null };
  const apiItems = parsed.items || [];
  const apiByIsin = new Map();
  apiItems.forEach((item) => {
    const isin = normalizePrivatIsin(item.isin);
    if (isin) apiByIsin.set(isin, item);
  });

  const mergedRaw = [];
  const domIsins = new Set();

  for (const dom of domRawItems || []) {
    const isin = normalizePrivatIsin(dom.isin);
    if (!isin) continue;
    domIsins.add(isin);
    const api = apiByIsin.get(isin);
    const apiRaw = api?.raw_fields && typeof api.raw_fields === 'object' ? api.raw_fields : {};

    mergedRaw.push({
      isin,
      name: dom.name || api?.name || null,
      maturity_date: dom.maturity_date || api?.maturity_date || apiRaw.maturity || null,
      price_raw: dom.price_raw ?? api?.price_raw ?? apiRaw.buyPrice ?? null,
      yield_raw: dom.yield_raw ?? api?.yield_raw ?? apiRaw.buyYield ?? null,
      currency: 'UAH',
      raw_fields: {
        ...apiRaw,
        listed_on_bonds_page: true,
        dom_maturity: dom.maturity_date || '',
        dom_price: dom.price_raw || '',
        dom_yield: dom.yield_raw || '',
      },
    });
  }

  const droppedApiOnlyCount = apiItems.filter(
    (item) => !domIsins.has(normalizePrivatIsin(item.isin)),
  ).length;

  return {
    proposals: processRawItems(mergedRaw),
    domCount: mergedRaw.length,
    apiCount: apiItems.length,
    droppedApiOnlyCount,
    xref: parsed.xref || null,
    apiError: parsed.error || null,
  };
}

module.exports = {
  CATALOG_URL,
  EXTRACT_BONDS_LIST_JS,
  PREPARE_BONDS_LIST_JS,
  FETCH_BARGAINING_BONDS_JS,
  FETCH_AUTH_BARGAINING_BONDS_JS,
  processApiCatalogResult,
  mergeDomWithApiCatalog,
  privatPurchaseUrl,
  processRawItems,
};
