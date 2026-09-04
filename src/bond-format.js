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

function isPrivatCatalogBond(bond) {
  return bond?.site_id === 'privat' && bond?.kind !== 'holding';
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
  if (isPrivatCatalogBond(bond) && (bond?.yield_percent == null || bond?.yield_percent === '')) {
    return '—';
  }
  return formatYieldDisplay(bond?.yield_percent);
}

function formatBondCostUah(bond) {
  if (isPrivatCatalogBond(bond) && parseBondMoney(bond?.buy_price) == null) {
    return '—';
  }

  const fromBuy = parseBondMoney(bond?.buy_price);
  if (fromBuy != null) {
    return new Intl.NumberFormat('uk-UA', {
      style: 'currency',
      currency: 'UAH',
      maximumFractionDigits: 2,
    }).format(fromBuy);
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
