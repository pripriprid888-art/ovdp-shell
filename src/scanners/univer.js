const CABINET_CATALOG_URL = 'https://univer.1b.app/client/custompage/38/';
const PRODUCTS_URL = 'https://www.univer.ua/products';
const BOND_CATEGORY = 'Державні облігації';
const OVDP_ISIN_RE = /^UA4000\d{6}$/;

const EXTRACT_PRODUCTS_CATALOG_JS = `(() => {
  const ISIN_RE = /UA4000\\d{6}/;

  function parseRow(row) {
    const paragraphs = [...row.querySelectorAll('p.paragraph18-copy')];
    const texts = paragraphs.map((node) => node.innerText.replace(/\\u00a0/g, ' ').trim());
    if (texts.length < 6) return null;

    const [name, currency, isin, price, maturity_date, yield_percent] = texts;
    if (!ISIN_RE.test(isin) || currency !== 'UAH') return null;

    return {
      isin,
      name,
      currency,
      price,
      maturity_date,
      yield_percent,
      yield_type: null,
      productid: name || null,
    };
  }

  const root = document.querySelector('.investdataovdp, #oblovdp_products');
  const rows = root
    ? [...root.querySelectorAll('.w-dyn-item .writem')]
    : [...document.querySelectorAll('.investdataovdp .writem, #oblovdp_products .writem')];

  const results = [];
  const seen = new Set();
  for (const row of rows) {
    const item = parseRow(row);
    if (!item || seen.has(item.isin)) continue;
    seen.add(item.isin);
    results.push(item);
  }

  return results;
})()`;

const WAIT_FOR_UNIVER_PRODUCTS_READY_JS = `(() => {
  const root = document.querySelector('.investdataovdp, #oblovdp_products');
  if (!root) return false;

  const rows = [...root.querySelectorAll('.w-dyn-item .writem, .writem')];
  if (!rows.length) return false;

  return rows.some((row) => {
    const texts = [...row.querySelectorAll('p.paragraph18-copy')]
      .map((node) => node.innerText.replace(/\\u00a0/g, ' ').trim());
    const isin = texts.find((text) => /^UA4000\\d{6}$/.test(text));
    const price = texts.find((text) => /^\\d+(?:\\.\\d+)?$/.test(text) && parseFloat(text) > 100);
    return Boolean(isin && price);
  });
})()`;

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
    const priceFromInput = priceInput?.value?.replace(/\\u00a0/g, ' ').trim() || '';
    const priceFromBuyCol = cellText(tr, 'cusstomproduct_TSnavikupUK')
      || cellText(tr, 'custom_TSnavikupUK')
      || '';
    const priceFromGenericCol = cellText(tr, 'price') || '';
    const price = priceFromInput || priceFromBuyCol || priceFromGenericCol || null;

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

const WAIT_FOR_UNIVER_CATALOG_READY_JS = `(() => {
  const rows = [...document.querySelectorAll('tr[data-productid]')];
  if (!rows.length) return false;

  function cellText(tr, key) {
    const cell = tr.querySelector(
      'td[data-keycol="' + key + '"], td[data-key="' + key + '"]',
    );
    if (!cell) return '';
    return cell.innerText.replace(/\\u00a0/g, ' ').replace(/\\s+/g, ' ').trim();
  }

  function hasMoney(text) {
    if (!text) return false;
    const n = parseFloat(String(text).replace(/[^\\d.,-]/g, '').replace(',', '.'));
    return Number.isFinite(n) && n > 0;
  }

  return rows.every((tr) => {
    const inputVal = tr.querySelector('.js-client-buy-price')?.value?.trim();
    if (hasMoney(inputVal)) return true;
    return hasMoney(cellText(tr, 'cusstomproduct_TSnavikupUK'))
      || hasMoney(cellText(tr, 'custom_TSnavikupUK'));
  });
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
      buy_price: resolveCatalogBuyPrice(item),
      source_url: PRODUCTS_URL,
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

function resolveCatalogBuyPrice(item) {
  const candidates = [
    item?.price,
    item?.buy_price,
  ];
  for (const candidate of candidates) {
    const parsed = parsePrice(candidate);
    if (parsed != null && parsed > 0) {
      return formatPrice(String(parsed));
    }
  }
  return null;
}

module.exports = {
  CABINET_CATALOG_URL,
  PRODUCTS_URL,
  EXTRACT_CABINET_CATALOG_JS,
  EXTRACT_PRODUCTS_CATALOG_JS,
  WAIT_FOR_UNIVER_CATALOG_READY_JS,
  WAIT_FOR_UNIVER_PRODUCTS_READY_JS,
  resolveCatalogBuyPrice,
  processRawItems,
};
