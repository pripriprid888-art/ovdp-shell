/**
 * OVDP / bond hold-to-maturity calculator (browser + Node).
 *
 * Data model:
 * - Security (ISIN, nominal, NBU payment schedule) — shared across sellers.
 * - Seller quote (site_id, unit buy price, listed yield) — per listing row.
 * - Cash flows — future schedule rows only; coupon and principal kept separate.
 *
 * Coupon rate is inferred from schedules, NBU nominal yield, or titles — not from listed YTM.
 */

function parsePrice(value) {
  if (value == null || value === '') return null;
  const cleaned = String(value).replace(/[^\d.,-]/g, '').replace(',', '.');
  const n = parseFloat(cleaned);
  return Number.isFinite(n) ? n : null;
}

function parseYield(value) {
  if (value == null || value === '') return null;
  const cleaned = String(value).replace(/[^\d.,-]/g, '').replace(',', '.');
  const n = parseFloat(cleaned);
  return Number.isFinite(n) ? n : null;
}

const nodeBondDates = typeof require !== 'undefined'
  ? require('./bond-dates')
  : null;

function parseUkDate(dateStr) {
  if (typeof BondDates !== 'undefined') {
    return BondDates.parseBondDate(dateStr);
  }
  if (nodeBondDates) {
    return nodeBondDates.parseBondDate(dateStr);
  }
  if (!dateStr) return null;
  const parts = String(dateStr).match(/(\d{1,2})[./-](\d{1,2})[./-](\d{2,4})/);
  if (!parts) return null;
  const day = parseInt(parts[1], 10);
  const month = parseInt(parts[2], 10);
  let year = parseInt(parts[3], 10);
  if (year < 100) year += 2000;
  const date = new Date(year, month - 1, day);
  return Number.isNaN(date.getTime()) ? null : date;
}

function yearsToMaturity(maturityDate) {
  if (!maturityDate) return null;
  const maturity = parseUkDate(maturityDate);
  if (!maturity) return null;
  const diffMs = maturity.getTime() - Date.now();
  if (diffMs <= 0) return null;
  return diffMs / (365.25 * 24 * 60 * 60 * 1000);
}

function resolveUnitBuyPrice(proposal, nominal) {
  const buyPrice = parsePrice(proposal.buy_price);
  if (!buyPrice || !nominal) return buyPrice;

  const quantity = Math.max(1, parseInt(proposal.quantity, 10) || 1);
  if (quantity <= 1) return buyPrice;

  const pctAsSingleUnit = (buyPrice / nominal) * 100;
  const unitIfTotal = buyPrice / quantity;
  const pctIfTotal = (unitIfTotal / nominal) * 100;

  if (pctAsSingleUnit > 150 && pctIfTotal >= 40 && pctIfTotal <= 160) {
    return unitIfTotal;
  }

  return buyPrice;
}

function inferPaymentsPerYear(proposal) {
  const schedule = proposal.payment_schedule;
  if (!Array.isArray(schedule) || !schedule.length) return 2;

  const couponDates = schedule
    .filter((p) => p.payment_type === 'coupon')
    .map((p) => parseUkDate(p.date))
    .filter(Boolean)
    .sort((a, b) => a - b);

  if (couponDates.length < 2) return 2;

  const msYear = 365.25 * 24 * 60 * 60 * 1000;
  const spanYears = (couponDates[couponDates.length - 1] - couponDates[0]) / msYear;
  if (spanYears <= 0.1) return 2;

  const perYear = Math.round((couponDates.length - 1) / spanYears);
  if (perYear >= 1 && perYear <= 12) return perYear;
  return 2;
}

function inferCouponFromText(text) {
  if (!text) return null;
  const normalized = String(text).replace(/\u00a0/g, ' ');
  const patterns = [
    /(\d+[.,]\d+|\d+)\s*%\s*(річн|р\.?\s*р\.?|annual)/i,
    /купон[^\d]*(\d+[.,]\d+|\d+)\s*%/i,
    /ставк[^\d]*(\d+[.,]\d+|\d+)\s*%/i,
    /(\d+[.,]\d+|\d+)\s*%(?!\d)/,
  ];

  for (const re of patterns) {
    const match = normalized.match(re);
    if (!match) continue;
    const rate = parseFloat(match[1].replace(',', '.'));
    if (Number.isFinite(rate) && rate > 0 && rate <= 50) return rate;
  }
  return null;
}

function normalizeScheduleEntry(entry, nominal) {
  const face = Math.max(0, Number(nominal) || 0);
  const date = parseUkDate(entry?.date);
  const explicitCoupon = parsePrice(entry?.coupon);
  const explicitPrincipal = parsePrice(entry?.principal);
  if (date && (explicitCoupon != null || explicitPrincipal != null)) {
    return {
      date,
      coupon: Math.max(0, explicitCoupon ?? 0),
      principal: Math.max(0, explicitPrincipal ?? 0),
      paymentType: (explicitPrincipal ?? 0) > 0 ? 'maturity' : 'coupon',
    };
  }

  const amount = parsePrice(entry?.amount);
  const isMaturity = entry?.payment_type === 'maturity';
  if (!date) return null;

  if (!isMaturity) {
    return {
      date,
      coupon: Math.max(0, amount ?? 0),
      principal: 0,
      paymentType: 'coupon',
    };
  }

  if (amount != null && face > 0 && amount > face) {
    return {
      date,
      coupon: amount - face,
      principal: face,
      paymentType: 'maturity',
    };
  }

  const principal = amount != null && amount > 0 ? amount : face;
  return {
    date,
    coupon: 0,
    principal: Math.max(0, principal),
    paymentType: 'maturity',
  };
}

function normalizePaymentSchedule(schedule, nominal) {
  if (!Array.isArray(schedule)) return [];
  return schedule
    .map((entry) => normalizeScheduleEntry(entry, nominal))
    .filter(Boolean);
}

function filterFutureScheduleEntries(schedule, nominal, settle = new Date()) {
  const settleDay = startOfDay(settle);
  return normalizePaymentSchedule(schedule, nominal)
    .filter((entry) => startOfDay(entry.date) > settleDay)
    .sort((a, b) => a.date - b.date);
}

function inferCouponFromSchedule(proposal, nominal) {
  const schedule = proposal.payment_schedule;
  if (!Array.isArray(schedule) || !nominal) return null;

  const couponAmounts = normalizePaymentSchedule(schedule, nominal)
    .map((entry) => entry.coupon)
    .filter((n) => n > 0);

  if (!couponAmounts.length) return null;

  const avgCoupon = couponAmounts.reduce((sum, n) => sum + n, 0) / couponAmounts.length;
  const paymentsPerYear = inferPaymentsPerYear(proposal);
  return (avgCoupon * paymentsPerYear / nominal) * 100;
}

function inferCouponRate(proposal, nominal) {
  const fromSchedule = inferCouponFromSchedule(proposal, nominal);
  if (fromSchedule != null) return fromSchedule;

  const fromTitle = inferCouponFromText(proposal.title);
  if (fromTitle != null) return fromTitle;

  const bondCode = proposal.raw_fields?.bond_code
    || proposal.raw_fields?.name
    || proposal.raw_fields?.section;
  return inferCouponFromText(bondCode);
}

const DAY_MS = 24 * 60 * 60 * 1000;
const YEAR_BASIS_DAYS = 365;

function startOfDay(date = new Date()) {
  const parsed = date instanceof Date ? date : parseUkDate(date);
  const base = parsed || new Date();
  return new Date(base.getFullYear(), base.getMonth(), base.getDate());
}

function daysBetween(from, to) {
  return (startOfDay(to).getTime() - startOfDay(from).getTime()) / DAY_MS;
}

function yearsAct365(from, to) {
  const days = daysBetween(from, to);
  return days > 0 ? days / YEAR_BASIS_DAYS : 0;
}

function addMonths(date, months) {
  const next = new Date(date);
  next.setMonth(next.getMonth() + months);
  return startOfDay(next);
}

function resolveMaturityDate(inputs, settle) {
  const explicit = inputs.maturityDate ? startOfDay(parseUkDate(inputs.maturityDate)) : null;
  if (explicit && explicit > settle) return explicit;

  const years = Math.max(0, Number(inputs.years) || 0);
  if (years <= 0) return null;

  const maturity = startOfDay(settle);
  maturity.setFullYear(maturity.getFullYear() + Math.floor(years));
  maturity.setDate(maturity.getDate() + Math.round((years - Math.floor(years)) * YEAR_BASIS_DAYS));
  return maturity;
}

function resolveMaturityFromSchedule(schedule) {
  if (!Array.isArray(schedule) || !schedule.length) return null;
  const dates = schedule
    .map((entry) => parseUkDate(entry.date))
    .filter(Boolean)
    .map((date) => startOfDay(date));
  if (!dates.length) return null;
  return new Date(Math.max(...dates.map((date) => date.getTime())));
}

function buildCouponPaymentDates(settle, maturity, paymentsPerYear) {
  const monthsStep = Math.max(1, Math.round(12 / paymentsPerYear));
  const dates = [];
  let cursor = startOfDay(maturity);
  while (cursor > settle) {
    dates.push(new Date(cursor));
    cursor = addMonths(cursor, -monthsStep);
  }
  return dates.reverse();
}

function formatCashFlowDate(date) {
  if (typeof BondDates !== 'undefined') {
    return BondDates.formatMaturityDate(date);
  }
  if (nodeBondDates?.formatMaturityDate) {
    return nodeBondDates.formatMaturityDate(date);
  }
  const day = String(date.getDate()).padStart(2, '0');
  const month = String(date.getMonth() + 1).padStart(2, '0');
  return `${day}.${month}.${date.getFullYear()}`;
}

function buildCashFlows(inputs) {
  const settle = startOfDay(inputs.settleDate || new Date());
  const nominal = Math.max(0, Number(inputs.nominal) || 0);
  const quantity = Math.max(0, Number(inputs.quantity) || 0);
  const couponRate = Math.max(0, Number(inputs.couponRate) || 0);
  const pricePct = Math.max(0, Number(inputs.pricePct) || 0);
  const paymentsPerYear = Math.max(1, parseInt(inputs.paymentsPerYear, 10) || 1);
  const faceTotal = nominal * quantity;
  const purchaseTotal = faceTotal * (pricePct / 100);
  const couponPerPayment = faceTotal * couponRate / 100 / paymentsPerYear;
  const schedule = Array.isArray(inputs.paymentSchedule) ? inputs.paymentSchedule : [];
  const maturity = resolveMaturityDate(inputs, settle) || resolveMaturityFromSchedule(schedule);
  const flows = [];

  if (schedule.length && maturity) {
    const sorted = filterFutureScheduleEntries(schedule, nominal, settle);

    for (const entry of sorted) {
      const couponPart = entry.coupon * quantity;
      const principalPart = entry.principal * quantity;
      const amount = couponPart + principalPart;
      if (!(amount > 0)) continue;

      let label = 'Купон';
      let kind = 'coupon';
      if (principalPart > 0 && couponPart > 0) {
        label = 'Купон + номінал';
        kind = 'final';
      } else if (principalPart > 0) {
        label = 'Номінал';
        kind = 'final';
      }

      flows.push({
        date: entry.date,
        years: yearsAct365(settle, entry.date),
        amount,
        couponPart,
        principalPart,
        label,
        kind,
      });
    }

    if (!flows.some((flow) => flow.principalPart > 0)) {
      flows.push({
        date: maturity,
        years: yearsAct365(settle, maturity),
        amount: faceTotal + couponPerPayment,
        couponPart: couponPerPayment,
        principalPart: faceTotal,
        label: 'Купон + номінал',
        kind: 'final',
      });
    }
  } else if (maturity && maturity > settle && couponRate > 0) {
    const dates = buildCouponPaymentDates(settle, maturity, paymentsPerYear);
    dates.forEach((date, index) => {
      const isLast = index === dates.length - 1;
      const couponPart = couponPerPayment;
      const principalPart = isLast ? faceTotal : 0;
      flows.push({
        date,
        years: yearsAct365(settle, date),
        amount: couponPart + principalPart,
        couponPart,
        principalPart,
        label: isLast ? 'Купон + номінал' : `Купон ${index + 1}`,
        kind: isLast ? 'final' : 'coupon',
      });
    });
  } else if (maturity && maturity > settle) {
    flows.push({
      date: maturity,
      years: yearsAct365(settle, maturity),
      amount: faceTotal,
      couponPart: 0,
      principalPart: faceTotal,
      label: 'Погашення',
      kind: 'final',
    });
  }

  return {
    settle,
    maturity,
    faceTotal,
    purchaseTotal,
    couponPerPayment,
    paymentsPerYear,
    flows,
  };
}

/**
 * YTM (annual, %) via act/365 cash-flow discounting: PV = Σ CF / (1+r)^t.
 */
function calcYtmFromCashFlows(purchaseTotal, flows) {
  if (!(purchaseTotal > 0) || !flows.length) return 0;

  const presentValue = (rate) => flows.reduce(
    (sum, flow) => sum + flow.amount / ((1 + rate) ** flow.years),
    0,
  );

  if (presentValue(0) < purchaseTotal) return 0;

  let lo = 0;
  let hi = 0.5;
  while (presentValue(hi) > purchaseTotal && hi < 8) hi *= 2;

  for (let i = 0; i < 100; i += 1) {
    const mid = (lo + hi) / 2;
    if (presentValue(mid) > purchaseTotal) lo = mid;
    else hi = mid;
  }

  return ((lo + hi) / 2) * 100;
}

/** @deprecated Use calcYtmFromCashFlows — kept for compatibility. */
function calcYTM(faceValue, couponRate, years, purchasePrice, paymentsPerYear) {
  if (years <= 0 || purchasePrice <= 0 || faceValue <= 0) return 0;
  const flows = buildCashFlows({
    nominal: faceValue,
    quantity: 1,
    couponRate,
    pricePct: (purchasePrice / faceValue) * 100,
    years,
    paymentsPerYear,
    settleDate: new Date(),
  }).flows;
  return calcYtmFromCashFlows(purchasePrice, flows);
}

function computeProjection(inputs) {
  const built = buildCashFlows(inputs);
  const {
    settle,
    maturity,
    faceTotal,
    purchaseTotal,
    couponPerPayment,
    paymentsPerYear,
    flows,
  } = built;

  const annualCoupon = couponPerPayment * paymentsPerYear;
  const totalCoupons = flows.reduce(
    (sum, flow) => sum + (flow.couponPart != null ? flow.couponPart : 0),
    0,
  );
  const capitalGainAbs = faceTotal - purchaseTotal;
  const capitalGainPctOfPurchase = purchaseTotal > 0 ? (capitalGainAbs / purchaseTotal) * 100 : 0;
  const premiumDiscountPctOfNominal = faceTotal > 0 ? (capitalGainAbs / faceTotal) * 100 : 0;
  const totalReturn = totalCoupons + capitalGainAbs;
  const years = maturity ? yearsAct365(settle, maturity) : Math.max(0, Number(inputs.years) || 0);

  const simpleYield = purchaseTotal > 0 ? (annualCoupon / purchaseTotal) * 100 : 0;
  const ytm = calcYtmFromCashFlows(purchaseTotal, flows);
  const totalReturnPct = purchaseTotal > 0 ? (totalReturn / purchaseTotal) * 100 : 0;
  const annualizedReturnPct = years > 0 && purchaseTotal > 0
    ? ((1 + totalReturn / purchaseTotal) ** (1 / years) - 1) * 100
    : 0;

  const cashFlows = [
    {
      date: settle,
      years: 0,
      amount: -purchaseTotal,
      label: 'Купівля',
      kind: 'purchase',
    },
    ...flows.map((flow) => ({
      ...flow,
      dateLabel: formatCashFlowDate(flow.date),
    })),
  ];

  return {
    faceTotal,
    purchaseTotal,
    couponPerPayment,
    annualCoupon,
    totalCoupons,
    capitalGainAbs,
    capitalGainPctOfPurchase,
    premiumDiscountPctOfNominal,
    totalReturn,
    ytm,
    currentYield: simpleYield,
    simpleYield,
    totalReturnPct,
    annualizedReturnPct,
    years,
    cashFlows,
    settle,
    maturity,
  };
}

function normalizeListedYieldTypeLabel(raw) {
  const text = String(raw || '').replace(/\s+/g, ' ').trim();
  if (!text) return null;
  const upper = text.toUpperCase();
  if (/^YTM\b|YTM\s*ДО|ДО\s*ПОГАШ|YTM\s*TO/i.test(text)) return 'YTM';
  if (/^SIM\b|ПОТОЧ|ПРОСТ|CURRENT/i.test(text)) return 'SIM';
  if (upper === 'YTM') return 'YTM';
  if (upper === 'SIM') return 'SIM';
  return null;
}

function inferListedYieldType(proposal, fieldsOverride = null) {
  const listed = parseYield(proposal.yield_percent);
  if (listed == null || listed <= 0) return null;

  const fields = fieldsOverride || {
    nominal: parsePrice(proposal.nominal_value) || 1000,
    couponRate: inferCouponRate(proposal, parsePrice(proposal.nominal_value) || 1000)
      ?? parseYield(proposal.yield_percent)
      ?? 0,
    pricePct: (() => {
      const nominal = parsePrice(proposal.nominal_value) || 1000;
      const buyPrice = resolveUnitBuyPrice(proposal, nominal);
      return buyPrice && nominal ? (buyPrice / nominal) * 100 : 100;
    })(),
    years: yearsToMaturity(proposal.maturity_date) || 1,
    payments: inferPaymentsPerYear(proposal),
    maturityDate: proposal.maturity_date || null,
    paymentSchedule: proposal.payment_schedule || null,
  };

  const projection = computeProjection({
    nominal: fields.nominal,
    quantity: 1,
    couponRate: fields.couponRate,
    pricePct: fields.pricePct,
    years: fields.years,
    paymentsPerYear: fields.payments,
    maturityDate: fields.maturityDate,
    paymentSchedule: fields.paymentSchedule,
    settleDate: new Date(),
  });

  const simDiff = Math.abs(projection.simpleYield - listed);
  const ytmDiff = Math.abs(projection.ytm - listed);
  if (Math.min(simDiff, ytmDiff) > 2.5) return 'YTM';
  return simDiff <= ytmDiff ? 'SIM' : 'YTM';
}

function toCalculatorFields(proposal, nominalFallback = 1000) {
  const isPrivatCatalog = typeof PlatformRegistry !== 'undefined'
    ? PlatformRegistry.isCatalogBondMissingBuyPrice(proposal)
    : proposal?.site_id === 'privat' && proposal?.kind !== 'holding';
  const nominal = parsePrice(proposal.nominal_value) || nominalFallback;
  const years = yearsToMaturity(proposal.maturity_date) || 1;
  const payments = inferPaymentsPerYear(proposal);
  const buyPriceEarly = resolveUnitBuyPrice(proposal, nominal);

  if (isPrivatCatalog && !buyPriceEarly) {
    return {
      nominal,
      quantity: 1,
      couponRate: 0,
      listedYtm: null,
      couponFromListedYtm: false,
      pricePct: null,
      unitPriceUah: null,
      years,
      payments,
      maturityDate: proposal.maturity_date || null,
      paymentSchedule: proposal.payment_schedule || null,
      listedYieldType: null,
    };
  }

  const buyPrice = buyPriceEarly ?? resolveUnitBuyPrice(proposal, nominal);
  const quantity = Math.max(1, parseInt(proposal.quantity, 10) || 1);
  const hasSchedule = Array.isArray(proposal.payment_schedule) && proposal.payment_schedule.length > 0;
  const inferredCoupon = inferCouponRate(proposal, nominal);
  const listedYtm = parseYield(proposal.yield_percent);
  const nbuNominalYield = hasSchedule ? parseYield(proposal.nbu_reference?.nominal_yield) : null;
  const couponRate = inferredCoupon ?? nbuNominalYield ?? 0;
  const pricePct = buyPrice && nominal ? (buyPrice / nominal) * 100 : 100;
  const fields = {
    nominal,
    quantity: proposal.kind === 'holding' ? quantity : 1,
    couponRate,
    listedYtm,
    couponFromListedYtm: false,
    couponFromNbuNominalYield: inferredCoupon == null && nbuNominalYield != null && nbuNominalYield > 0,
    pricePct,
    unitPriceUah: buyPrice ?? null,
    years,
    payments,
    maturityDate: proposal.maturity_date || null,
    paymentSchedule: proposal.payment_schedule || null,
  };
  const skipListedYieldType = typeof PlatformRegistry !== 'undefined'
    ? !PlatformRegistry.catalogHasListedYield(proposal.site_id)
    : proposal.site_id === 'privat';
  fields.listedYieldType = proposal.listed_yield_type
    ?? (skipListedYieldType ? null : inferListedYieldType(proposal, fields));
  return fields;
}

function toCalculatorQuoteContext(proposal, options = {}) {
  const nominalFallback = options.nominalFallback ?? 1000;
  const fields = toCalculatorFields(proposal, nominalFallback);
  const isin = String(proposal?.isin || '').trim().toUpperCase();
  const siteId = proposal?.site_id || null;
  const scheduleSource = options.scheduleSource || 'none';
  return {
    ...fields,
    isin: isin || null,
    siteId,
    quoteKey: isin && siteId ? `${siteId}:${isin}` : null,
    scheduleSource,
    usesActualSchedule: scheduleSource !== 'none' && !!(fields.paymentSchedule?.length),
  };
}

function sumScheduleReceipts(schedule, nominal, quantity, options = {}) {
  const qty = Math.max(0, Number(quantity) || 0);
  const settle = options.settle ?? new Date();
  const entries = options.futureOnly
    ? filterFutureScheduleEntries(schedule, nominal, settle)
    : normalizePaymentSchedule(schedule, nominal);
  return entries.reduce(
    (sum, entry) => sum + (entry.coupon + entry.principal) * qty,
    0,
  );
}

function buildScheduleDisplayRows(schedule, nominal, quantity, settle = new Date()) {
  const qty = Math.max(0, Number(quantity) || 0);
  const rows = [];
  for (const entry of filterFutureScheduleEntries(schedule, nominal, settle)) {
    if (entry.coupon > 0) {
      rows.push({
        date: entry.date,
        unitAmount: entry.coupon,
        totalAmount: entry.coupon * qty,
        label: 'Купон',
        isMaturity: false,
      });
    }
    if (entry.principal > 0) {
      rows.push({
        date: entry.date,
        unitAmount: entry.principal,
        totalAmount: entry.principal * qty,
        label: 'Погашення',
        isMaturity: true,
      });
    }
  }
  return rows;
}

const BondCalculator = {
  parsePrice,
  parseYield,
  parseUkDate,
  startOfDay,
  yearsToMaturity,
  resolveUnitBuyPrice,
  inferPaymentsPerYear,
  inferCouponRate,
  normalizeScheduleEntry,
  normalizePaymentSchedule,
  filterFutureScheduleEntries,
  sumScheduleReceipts,
  buildScheduleDisplayRows,
  buildCashFlows,
  calcYtmFromCashFlows,
  calcYTM,
  computeProjection,
  inferListedYieldType,
  normalizeListedYieldTypeLabel,
  toCalculatorFields,
  toCalculatorQuoteContext,
};

if (typeof module !== 'undefined' && module.exports) {
  module.exports = BondCalculator;
}

if (typeof window !== 'undefined') {
  window.BondCalculator = BondCalculator;
}
