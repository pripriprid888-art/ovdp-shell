const { parsePrice, toCalculatorFields, normalizeBuyPriceUah, resolveUnitBuyPrice } = require('../utils');
const { normalizeMaturityDate } = require('../../bond-dates');
const { extractPurchaseDate, portfolioLotKey } = require('./lot-utils');

const BOND_CATEGORY = 'Державні облігації';

function processPortfolioItems(rawItems, siteId, sourceUrl) {
  const seen = new Set();
  const holdings = [];

  for (const item of rawItems || []) {
    const isin = item.isin;
    if (!isin) continue;

    const lotKey = portfolioLotKey(item, siteId);
    if (seen.has(lotKey)) continue;
    seen.add(lotKey);

    const purchaseDate = extractPurchaseDate(item);

    const proposal = {
      site_id: siteId,
      kind: 'holding',
      category: BOND_CATEGORY,
      title: item.title || `ОВДП ${isin}`,
      isin,
      lot_id: lotKey,
      purchase_date: purchaseDate,
      quantity: item.quantity ?? null,
      yield_percent: item.yield_percent || null,
      maturity_date: normalizeMaturityDate(item.maturity_date),
      nominal_value: item.nominal_value || null,
      buy_price: normalizeBuyPriceUah(item.current_value || item.buy_price),
      sell_price: null,
      source_url: sourceUrl,
      buy_url: null,
      asset_id: item.asset_id || null,
      tag: 'Портфель',
      raw_fields: item.raw_fields || {},
      is_buyable: false,
      scanned_at: new Date().toISOString(),
    };

    proposal.calculator = toCalculatorFields(proposal);

    const qty = Math.max(1, parseInt(item.quantity, 10) || 1);
    const nominal = proposal.calculator?.nominal || parsePrice(proposal.nominal_value) || 1000;
    const unitBuy = proposal.calculator?.unitPriceUah
      ?? resolveUnitBuyPrice(proposal, nominal);
    const rawBuy = parsePrice(proposal.buy_price);

    if (item.portfolio_value != null) {
      proposal.portfolio_value = normalizeBuyPriceUah(item.portfolio_value);
    } else if (unitBuy != null && qty > 0) {
      proposal.portfolio_value = normalizeBuyPriceUah(unitBuy * qty);
    } else if (rawBuy != null) {
      proposal.portfolio_value = normalizeBuyPriceUah(rawBuy);
    }

    holdings.push(proposal);
  }

  return holdings;
}

module.exports = {
  processPortfolioItems,
};
