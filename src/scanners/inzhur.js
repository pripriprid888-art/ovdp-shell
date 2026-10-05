const CATALOG_URL = 'https://www.inzhur.reit/offer/ovdp';
const BOND_CATEGORY = 'Державні облігації';
const {
  deepResolveRoot,
  parseFlightCatalogRoot,
  decodeFlightChunk,
  mergeCatalogByIsin,
} = require('./inzhur-catalog-parse');

const EXTRACT_LEGACY_CARDS_JS = `function extractLegacyInzhurCards() {
  const cards = [...document.querySelectorAll('.investment-unit[data-asset-id]')];
  return cards.map((card) => {
    const investBtn = card.querySelector('.unit-footer button');
    const fields = {};
    const mapped = {
      isin: null,
      yield_percent: null,
      maturity_date: null,
      buy_price: null,
      sell_price: null,
      available_count: null,
    };

    card.querySelectorAll('.unit-values').forEach((row) => {
      const labelEl = row.querySelector('.up_case');
      const valueEl = row.querySelector('strong');
      if (!labelEl || !valueEl) return;
      const label = labelEl.innerText.replace(/\\s+/g, ' ').trim();
      const norm = label.toLowerCase();
      const value = valueEl.innerText.replace(/\\u00a0/g, ' ').trim();
      fields[label] = value;

      if (norm.includes('isin')) mapped.isin = value;
      else if (norm.includes('дохідність')) mapped.yield_percent = value;
      else if (norm.includes('дата погашення')) mapped.maturity_date = value;
      else if (norm.includes('вартість купівлі')) mapped.buy_price = value;
      else if (norm.includes('вартість продажу')) mapped.sell_price = value;
      else if (norm.includes('доступно облігацій')) mapped.available_count = value;
    });

    const paymentSchedule = [];
    const paymentBlocks = card.innerHTML.split('class="payment disp_row"').slice(1);
    for (const block of paymentBlocks) {
      const date = block.match(/class="title"[^>]*>([^<]+)</)?.[1]?.trim();
      const amount = block.match(/class="value"[^>]*>([^<]+)</)?.[1]?.replace(/\\u00a0/g, ' ').trim();
      if (date && amount) paymentSchedule.push({ date, amount });
    }

    return {
      asset_id: card.getAttribute('data-asset-id'),
      tag: card.querySelector('.tag')?.innerText?.trim() || null,
      title: (card.querySelector('.title')?.innerText || '').replace(/\\s+/g, ' ').trim(),
      description: card.querySelector('.description')?.innerText?.trim() || null,
      is_special_offer: !!card.querySelector('.gallery-wrapper img[src*="plashka"]'),
      has_invest_button: !!investBtn,
      invest_button_disabled: investBtn ? !!investBtn.disabled : true,
      invest_button_text: investBtn?.innerText?.trim() || null,
      ...mapped,
      payment_schedule: paymentSchedule,
      raw_fields: fields,
    };
  });
}`;

const EXTRACT_DOM_CARDS_JS = `function extractDomInzhurBondCards() {
  function cleanText(value) {
    return String(value || '').replace(/\\u00a0/g, ' ').replace(/\\s+/g, ' ').trim();
  }

  function parseCard(card, source) {
    const isin = (card.innerText.match(/UA4000\\d{6}/) || [])[0] || null;
    if (!isin) return null;

    const columns = [...card.querySelectorAll(':scope > div.shrink-0.h-76')];
    const priceFromColumn = (index) => {
      const text = cleanText(columns[index]?.innerText || '');
      const match = text.match(/([\\d\\s]+,\\d{2})\\s*₴/);
      return match ? cleanText(match[0]) : null;
    };
    const qtyText = cleanText(columns[5]?.innerText || '');
    const qtyMatch = qtyText.match(/^([\\d\\s]+)$/);
    const investBtn = card.querySelector('[data-testid="bond-units-invest-button"]');
    const href = investBtn?.getAttribute('href') || '';
    const assetMatch = href.match(/assetId=(\\d+)/i);
    const isSpecial = /Спеціальна пропозиція/i.test(card.innerText);

    return {
      asset_id: assetMatch ? assetMatch[1] : null,
      isin,
      yield_percent: cleanText(card.querySelector('[data-testid="bond-units-yield-value"]')?.innerText),
      maturity_date: cleanText(card.querySelector('[data-testid="bond-units-maturity-value"]')?.innerText),
      buy_price: priceFromColumn(3),
      sell_price: priceFromColumn(4),
      available_count: qtyMatch ? qtyMatch[1] : qtyText.replace(/[^\\d]/g, '') || null,
      payment_schedule: [],
      status: investBtn && !investBtn.disabled ? 'active' : null,
      tag: isSpecial ? 'Спеціальна пропозиція' : null,
      title: 'ОВДП ' + isin,
      has_invest_button: !!investBtn,
      invest_button_disabled: investBtn ? !!investBtn.disabled : true,
      is_special_offer: isSpecial,
      raw_fields: { source },
    };
  }

  const desktop = [...document.querySelectorAll('[data-testid="bond-units-desktop-card"]')]
    .map((card) => parseCard(card, 'dom-desktop-card'))
    .filter(Boolean);
  if (desktop.length) return desktop;

  return [...document.querySelectorAll('[data-testid="bond-units-mobile-card"]')]
    .map((card) => parseCard(card, 'dom-mobile-card'))
    .filter(Boolean);
}`;

const EXTRACT_BONDS_JS = `(() => {
  ${deepResolveRoot.toString()}
  ${parseFlightCatalogRoot.toString()}
  ${decodeFlightChunk.toString()}
  ${mergeCatalogByIsin.toString()}
  ${EXTRACT_LEGACY_CARDS_JS}
  ${EXTRACT_DOM_CARDS_JS}

  function extractEmbeddedInzhurCatalog() {
    const scripts = [...document.querySelectorAll('script')].map((el) => el.textContent || '');
    const html = document.documentElement.innerHTML;
    for (const text of scripts) {
      if (!text.includes('[["Map"') || !text.includes('UA4000')) continue;
      const root = decodeFlightChunk(text);
      const items = parseFlightCatalogRoot(root);
      if (!items.length) continue;
      return items.map((item) => {
        const special = new RegExp(
          item.isin.replace(/[.*+?^\\u0024{}()|[\\]\\\\]/g, '\\\\$&') + '[\\\\s\\\\S]{0,240}Спеціальна',
          'i',
        ).test(html);
        return {
          ...item,
          tag: special ? 'Спеціальна пропозиція' : item.tag,
          is_special_offer: special,
          description: null,
          invest_button_text: null,
          raw_fields: { source: 'embedded-catalog', status: item.status || '' },
        };
      });
    }
    return [];
  }

  const legacy = extractLegacyInzhurCards();
  if (legacy.length) return legacy;

  const embedded = extractEmbeddedInzhurCatalog();
  const dom = extractDomInzhurBondCards();
  if (embedded.length || dom.length) {
    return mergeCatalogByIsin(embedded, dom);
  }
  return [];
})()`;

const WAIT_FOR_INZHUR_CATALOG_READY_JS = `(() => {
  if (document.querySelector('.investment-unit[data-asset-id]')) return true;
  if (document.querySelector('[data-testid="bond-units-desktop-card"], [data-testid="bond-units-mobile-card"]')) {
    return true;
  }
  const html = document.documentElement.innerHTML;
  return html.includes('[["Map"') && /UA4000\\d{6}/.test(html);
})()`;

function isGovernmentBond(item) {
  const title = (item.title || '').toLowerCase();
  return title.includes('облігац') || !!item.isin;
}

function parseCount(value) {
  if (value == null || value === '') return null;
  if (typeof value === 'number' && Number.isFinite(value)) return Math.trunc(value);
  const digits = String(value).replace(/[^\d]/g, '');
  if (!digits) return null;
  const n = parseInt(digits, 10);
  return Number.isFinite(n) ? n : null;
}

function normalizeCount(value) {
  if (value == null || value === '') return null;
  return String(value).replace(/\s+/g, '');
}

function formatYield(value) {
  if (value == null || value === '') return null;
  if (typeof value === 'number' && Number.isFinite(value)) {
    return `${String(value).replace('.', ',')}%`;
  }
  const cleaned = String(value).trim().replace(',', '.');
  if (cleaned.endsWith('%')) return cleaned.replace('.', ',');
  return `${cleaned.replace('.', ',')}%`;
}

const { parsePrice, toCalculatorFields, normalizeBuyPriceUah } = require('./utils');
const { normalizeMaturityDate } = require('../bond-dates');

function computeSpread(buyPrice, sellPrice) {
  const buy = parsePrice(buyPrice);
  const sell = parsePrice(sellPrice);
  if (buy === null || sell === null) return null;
  return `${(buy - sell).toFixed(2)} ₴`;
}

function buildPaymentSchedule(items) {
  return items.map((item) => {
    const amount = item.amount || '';
    const digits = String(amount).replace(/[^\d]/g, '');
    const paymentType = digits.startsWith('1000') ? 'maturity' : 'coupon';
    return {
      date: item.date || '',
      amount: String(amount),
      payment_type: paymentType,
    };
  });
}

function extractNominal(schedule) {
  for (let i = schedule.length - 1; i >= 0; i -= 1) {
    if (schedule[i].payment_type === 'maturity') {
      return schedule[i].amount;
    }
  }
  return null;
}

function isBuyable(item) {
  const count = parseCount(item.available_count);
  if (count === null || count <= 0) return false;
  if (!item.buy_price || !item.asset_id) return false;
  if (item.status && item.status !== 'active') return false;
  if (item.has_invest_button === false) return false;
  if (item.invest_button_disabled) return false;
  return true;
}

function processRawItems(rawItems) {
  const bonds = rawItems.filter(isGovernmentBond).filter(isBuyable);

  return bonds.map((item) => {
    const schedule = buildPaymentSchedule(item.payment_schedule || []);
    const proposal = {
      site_id: 'inzhur',
      category: BOND_CATEGORY,
      title: item.title || `ОВДП ${item.isin || ''}`.trim(),
      isin: item.isin,
      yield_percent: formatYield(item.yield_percent),
      maturity_date: normalizeMaturityDate(item.maturity_date),
      buy_price: normalizeBuyPriceUah(item.buy_price),
      sell_price: item.sell_price != null ? normalizeBuyPriceUah(item.sell_price) : null,
      available_count: normalizeCount(item.available_count),
      description: item.description,
      source_url: CATALOG_URL,
      buy_url: CATALOG_URL,
      asset_id: item.asset_id,
      tag: item.tag,
      is_special_offer: !!item.is_special_offer,
      spread: computeSpread(item.buy_price, item.sell_price),
      nominal_value: extractNominal(schedule),
      payment_schedule: schedule,
      raw_fields: item.raw_fields || {},
      is_buyable: isBuyable(item),
      scanned_at: new Date().toISOString(),
    };
    proposal.calculator = toCalculatorFields(proposal);
    return proposal;
  });
}

module.exports = {
  CATALOG_URL,
  EXTRACT_BONDS_JS,
  WAIT_FOR_INZHUR_CATALOG_READY_JS,
  processRawItems,
};
