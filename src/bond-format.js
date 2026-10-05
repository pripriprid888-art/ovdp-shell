function parsePctNumber(value) {
  if (value == null || value === '') return null;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  const cleaned = String(value).replace(/[^\d.,-]/g, '').replace(',', '.');
  const n = parseFloat(cleaned);
  return Number.isFinite(n) ? n : null;
}

/** Percentage trimmed to the last meaningful digit (16.00 → 16, 18.50 → 18,5). */
function formatPctCompact(value) {
  const n = parsePctNumber(value);
  if (n == null) {
    const str = String(value ?? '').trim();
    return str || '—';
  }
  return `${n.toLocaleString('uk-UA', { maximumFractionDigits: 4, minimumFractionDigits: 0 })} %`;
}

function isCatalogBondMissingListedYield(bond) {
  if (typeof PlatformRegistry !== 'undefined') {
    return PlatformRegistry.isCatalogBondMissingListedYield(bond);
  }
  return bond?.kind !== 'holding' && bond?.site_id === 'privat';
}

function isCatalogBondMissingBuyPrice(bond) {
  if (typeof PlatformRegistry !== 'undefined') {
    return PlatformRegistry.isCatalogBondMissingBuyPrice(bond);
  }
  return bond?.kind !== 'holding' && bond?.site_id === 'privat';
}

/** Catalog yield strings — preserves % suffix, compacts the number. */
function formatYieldDisplay(value) {
  if (value == null || value === '') return '—';
  const str = String(value).trim();
  const n = parsePctNumber(str);
  if (n == null) return str;
  const compact = n.toLocaleString('uk-UA', { maximumFractionDigits: 4, minimumFractionDigits: 0 });
  return str.includes('%') ? `${compact}%` : `${compact} %`;
}

function parseBondMoney(value) {
  if (value == null || value === '') return null;
  const cleaned = String(value).replace(/[^\d.,-]/g, '').replace(',', '.');
  const n = parseFloat(cleaned);
  return Number.isFinite(n) ? n : null;
}

function formatYieldForBond(bond) {
  if (isCatalogBondMissingListedYield(bond) && (bond?.yield_percent == null || bond?.yield_percent === '')) {
    return '—';
  }
  return formatYieldDisplay(bond?.yield_percent);
}

function resolveBondUnitPriceUah(bond) {
  const calc = bond?.calculator;
  const nominal = calc?.nominal ?? parseBondMoney(bond?.nominal_value) ?? 1000;
  if (typeof BondCalculator !== 'undefined' && BondCalculator.resolveUnitBuyPrice) {
    const unit = BondCalculator.resolveUnitBuyPrice(bond, nominal);
    if (unit != null) return unit;
  }
  return parseBondMoney(bond?.buy_price);
}

function formatBondCostUah(bond) {
  if (isCatalogBondMissingBuyPrice(bond) && parseBondMoney(bond?.buy_price) == null) {
    return '—';
  }

  const unitPrice = resolveBondUnitPriceUah(bond);
  if (unitPrice != null) {
    return new Intl.NumberFormat('uk-UA', {
      style: 'currency',
      currency: 'UAH',
      maximumFractionDigits: 2,
    }).format(unitPrice);
  }

  const calc = bond?.calculator;
  if (calc?.nominal != null && calc.pricePct != null) {
    const cost = calc.nominal * (calc.pricePct / 100);
    if (cost > 0) {
      return new Intl.NumberFormat('uk-UA', {
        style: 'currency',
        currency: 'UAH',
        maximumFractionDigits: 2,
      }).format(cost);
    }
  }

  return '—';
}

function bondCostMetaHtml(bond) {
  return `<span class="bond-cost">Вартість: ${formatBondCostUah(bond)}</span>`;
}

function formatAccountBalanceUah(amount, fallbackText) {
  if (amount != null && Number.isFinite(amount)) {
    return new Intl.NumberFormat('uk-UA', {
      style: 'currency',
      currency: 'UAH',
      maximumFractionDigits: 2,
    }).format(amount);
  }
  if (fallbackText) return String(fallbackText).trim();
  return '—';
}

function formatMaturityDate(value) {
  if (typeof BondDates !== 'undefined') {
    return BondDates.formatMaturityDate(value);
  }
  const trimmed = String(value ?? '').trim();
  return trimmed || '—';
}

const BondFormat = {
  parsePctNumber,
  formatPctCompact,
  isCatalogBondMissingListedYield,
  isCatalogBondMissingBuyPrice,
  formatYieldDisplay,
  parseBondMoney,
  formatYieldForBond,
  formatBondCostUah,
  bondCostMetaHtml,
  formatAccountBalanceUah,
  formatMaturityDate,
};

if (typeof module !== 'undefined' && module.exports) {
  module.exports = BondFormat;
}

if (typeof window !== 'undefined') {
  window.BondFormat = BondFormat;
}
