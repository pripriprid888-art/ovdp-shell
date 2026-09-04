const BondCalculator = require('../bond-calculator');

function formatUah(value) {
  if (value == null || !Number.isFinite(value)) return null;
  return new Intl.NumberFormat('uk-UA', {
    style: 'currency',
    currency: 'UAH',
    maximumFractionDigits: 2,
  }).format(value);
}

function formatBondCostUah(proposal) {
  if (proposal?.site_id === 'privat' && proposal?.kind !== 'holding' && parsePrice(proposal.buy_price) == null) {
    return null;
  }

  const fromBuy = BondCalculator.parsePrice(proposal.buy_price);
  if (fromBuy != null) return formatUah(fromBuy);

  const calc = proposal.calculator;
  if (calc?.nominal != null && calc.pricePct != null) {
    const cost = calc.nominal * (calc.pricePct / 100);
    if (cost > 0) return formatUah(cost);
  }

  return null;
}

function normalizeBuyPriceUah(value) {
  const parsed = BondCalculator.parsePrice(value);
  if (parsed != null) return formatUah(parsed);
  return value || null;
}

module.exports = {
  parsePrice: BondCalculator.parsePrice,
  parseYield: BondCalculator.parseYield,
  yearsToMaturity: BondCalculator.yearsToMaturity,
  resolveUnitBuyPrice: BondCalculator.resolveUnitBuyPrice,
  toCalculatorFields: BondCalculator.toCalculatorFields,
  formatUah,
  formatBondCostUah,
  normalizeBuyPriceUah,
};
