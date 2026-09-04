const { parsePrice, parseYield, toCalculatorFields, normalizeBuyPriceUah } = require('../utils');
const { normalizeMaturityDate } = require('../../bond-dates');

const BOND_CATEGORY = 'Державні облігації';

function processPortfolioItems(rawItems, siteId, sourceUrl) {
  const seen = new Set();
  const holdings = [];

  for (const item of rawItems || []) {
    const isin = item.isin;
    if (!isin || seen.has(isin)) continue;
    seen.add(isin);

    const proposal = {
      site_id: siteId,
      kind: 'holding',
      category: BOND_CATEGORY,
      title: item.title || `ОВДП ${isin}`,
      isin,
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
    if (item.quantity && proposal.calculator?.nominal) {
      const unitBuy = parsePrice(proposal.buy_price);
      if (unitBuy) {
        proposal.portfolio_value = normalizeBuyPriceUah(unitBuy * item.quantity);
      }
    }

    holdings.push(proposal);
  }

  return holdings;
}

module.exports = {
  processPortfolioItems,
};
