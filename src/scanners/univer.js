const CABINET_CATALOG_URL = 'https://univer.1b.app/client/custompage/38/';
const PRODUCTS_URL = 'https://www.univer.ua/products';
const BOND_CATEGORY = 'Державні облігації';
const OVDP_ISIN_RE = /^UA4000\d{6}$/;

const EXTRACT_CABINET_CATALOG_JS = `(() => {
  const ISIN_RE = /UA4000\\d{6}/;

  function cellText(tr, key) {
    const cell = tr.querySelector(
      'td[data-keycol="' + key + '"], td[data-key="' + key + '"]',
    );
    if (!cell) return '';
    return cell.innerText.replace(/\\u00a0/g, ' ').replace(/\\s+/g, ' ').trim();
  }

  const tables = [...document.querySelectorAll('table.os-table, table.js-product-table, table')];
  let catalogTable = null;
  for (const table of tables) {
    if (table.querySelector('[data-keycol="custom_TippributkovostOK"]')) {
      catalogTable = table;
      break;
    }
  }

  const results = [];
  const seen = new Set();
  const rows = catalogTable
    ? [...catalogTable.querySelectorAll('tr[data-productid]')]
    : [...document.querySelectorAll('tr[data-productid]')];

  for (const tr of rows) {
    let isin = cellText(tr, 'custom_ISIN') || cellText(tr, 'cusstomproduct_ISIN');
    if (!isin) {
      const match = (tr.innerText || '').match(ISIN_RE);
      isin = match ? match[0] : '';
    }
    if (!ISIN_RE.test(isin) || seen.has(isin)) continue;
    seen.add(isin);

    const priceInput = tr.querySelector('.js-client-buy-price');
    const price = priceInput?.value
      || cellText(tr, 'price')
      || cellText(tr, 'cusstomproduct_TSnavikupUK')
      || null;

    const codeCell = tr.querySelector('td[data-keycol="code"], td[data-key="code"]');
    const bondCode = codeCell?.innerText?.replace(/\\s+/g, ' ').trim() || null;

    results.push({
      isin,
      name: bondCode || cellText(tr, 'productname') || cellText(tr, 'cusstomproduct_Nazva') || null,
      maturity_date: cellText(tr, 'custom_Datapogashennya')
        || cellText(tr, 'cusstomproduct_Datapogashennya')
        || null,
      yield_percent: cellText(tr, 'custom_Dohdnstprodazhu')
        || cellText(tr, 'cusstomproduct_Dohdnstkupvlya')
        || null,
      yield_type: cellText(tr, 'custom_TippributkovostOK') || null,
      price,
      productid: tr.getAttribute('data-productid') || null,
    });
  }

  return results;
})()`;

const {
  parsePrice,
  toCalculatorFields,
  normalizeBuyPriceUah,
} = require('./utils');
const { normalizeListedYieldTypeLabel } = require('../bond-calculator');
const { normalizeMaturityDate } = require('../bond-dates');

function formatYield(value) {
  if (!value) return null;
  const cleaned = String(value).trim().replace(',', '.');
  if (cleaned.endsWith('%')) return cleaned;
  return `${cleaned}%`;
}

function formatPrice(price) {
  if (!price) return null;
  return normalizeBuyPriceUah(price);
}

function bondTitle(item) {
  const isin = item.isin || '';
  const name = (item.name || '').trim();
  if (name && name !== isin) return `ОВДП ${name}`;
  return `ОВДП ${isin}`;
}

function processRawItems(rawItems) {
  const bonds = (rawItems || []).filter((item) => OVDP_ISIN_RE.test(item.isin || ''));

  return bonds.map((item) => {
    const listedYieldType = normalizeListedYieldTypeLabel(item.yield_type);
    const proposal = {
      site_id: 'univer',
      category: BOND_CATEGORY,
      title: bondTitle(item),
      isin: item.isin,
      yield_percent: formatYield(item.yield_percent),
      listed_yield_type: listedYieldType,
      maturity_date: normalizeMaturityDate(item.maturity_date),
      buy_price: formatPrice(item.price),
      source_url: CABINET_CATALOG_URL,
      buy_url: CABINET_CATALOG_URL,
      tag: null,
      nominal_value: '1000 ₴',
      raw_fields: {
        currency: 'UAH',
        bond_code: item.name || '',
        yield_type: item.yield_type || '',
        productid: item.productid || '',
      },
      is_buyable: true,
      scanned_at: new Date().toISOString(),
    };
    proposal.calculator = toCalculatorFields(proposal, 1000);
    return proposal;
  });
}

module.exports = {
  CABINET_CATALOG_URL,
  PRODUCTS_URL,
  EXTRACT_CABINET_CATALOG_JS,
  processRawItems,
};
