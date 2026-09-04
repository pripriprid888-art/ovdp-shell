const CATALOG_URL = 'https://www.inzhur.reit/offer/ovdp';
const BOND_CATEGORY = 'Державні облігації';

// Ported from OVDP backend/scanners/inzhur.py (_EXTRACT_BONDS_JS)
const EXTRACT_BONDS_JS = `(() => {
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
})()`;

function isGovernmentBond(item) {
  const title = (item.title || '').toLowerCase();
  return title.includes('облігац') || !!item.isin;
}

function parseCount(value) {
  if (!value) return null;
  const digits = value.replace(/[^\d]/g, '');
  if (!digits) return null;
  const n = parseInt(digits, 10);
  return Number.isFinite(n) ? n : null;
}

function normalizeCount(value) {
  if (!value) return null;
  return value.replace(/\s+/g, '');
}

const { parsePrice, parseYield, toCalculatorFields, normalizeBuyPriceUah } = require('./utils');
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
    const digits = amount.replace(/[^\d]/g, '');
    const paymentType = digits.startsWith('1000') ? 'maturity' : 'coupon';
    return {
      date: item.date || '',
      amount,
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
  if (item.has_invest_button === false) return false;
  if (item.invest_button_disabled) return false;
  return true;
}

function processRawItems(rawItems) {
  const bonds = rawItems.filter(isGovernmentBond);

  return bonds.map((item) => {
    const schedule = buildPaymentSchedule(item.payment_schedule || []);
    const proposal = {
      site_id: 'inzhur',
      category: BOND_CATEGORY,
      title: item.title || 'Державні облігації України',
      isin: item.isin,
      yield_percent: item.yield_percent,
      maturity_date: normalizeMaturityDate(item.maturity_date),
      buy_price: normalizeBuyPriceUah(item.buy_price),
      sell_price: item.sell_price,
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
  processRawItems,
};
