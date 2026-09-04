/**
 * OVDP / bond hold-to-maturity calculator (browser + Node).
 * Coupon rate is inferred from schedules or titles — not from listed YTM.
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

function inferCouponFromSchedule(proposal, nominal) {
  const schedule = proposal.payment_schedule;
  if (!Array.isArray(schedule) || !nominal) return null;

  const couponAmounts = schedule
    .filter((p) => p.payment_type === 'coupon')
    .map((p) => parsePrice(p.amount))
    .filter((n) => n != null && n > 0);

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
  const maturity = resolveMaturityDate(inputs, settle);
  const flows = [];

  const schedule = Array.isArray(inputs.paymentSchedule) ? inputs.paymentSchedule : [];
  if (schedule.length && maturity) {
    const sorted = [...schedule]
      .map((entry) => ({
        date: parseUkDate(entry.date),
        amount: parsePrice(entry.amount),
        paymentType: entry.payment_type || 'coupon',
      }))
      .filter((entry) => entry.date && startOfDay(entry.date) > settle)
      .sort((a, b) => a.date - b.date);

    for (const entry of sorted) {
      let amount = entry.amount != null ? entry.amount * quantity : null;
      if (amount == null) {
        amount = entry.paymentType === 'maturity'
          ? faceTotal
          : couponPerPayment;
      }
      flows.push({
        date: entry.date,
        years: yearsAct365(settle, entry.date),
        amount,
        label: entry.paymentType === 'maturity' ? 'Номінал' : 'Купон',
        kind: entry.paymentType === 'maturity' ? 'final' : 'coupon',
      });
    }

    const maturityFlow = flows.find((flow) => flow.kind === 'final');
    const lastCoupon = [...flows].reverse().find((flow) => flow.kind === 'coupon');
    if (maturityFlow && lastCoupon && daysBetween(lastCoupon.date, maturityFlow.date) === 0) {
      maturityFlow.amount += lastCoupon.amount;
      maturityFlow.label = 'Купон + номінал';
      const index = flows.indexOf(lastCoupon);
      if (index >= 0) flows.splice(index, 1);
    } else if (!maturityFlow) {
      flows.push({
        date: maturity,
        years: yearsAct365(settle, maturity),
        amount: faceTotal + couponPerPayment,
        label: 'Купон + номінал',
        kind: 'final',
      });
    }
  } else if (maturity && maturity > settle && couponRate > 0) {
    const dates = buildCouponPaymentDates(settle, maturity, paymentsPerYear);
    dates.forEach((date, index) => {
      const isLast = index === dates.length - 1;
      flows.push({
        date,
        years: yearsAct365(settle, date),
        amount: couponPerPayment + (isLast ? faceTotal : 0),
        label: isLast ? 'Купон + номінал' : `Купон ${index + 1}`,
        kind: isLast ? 'final' : 'coupon',
      });
    });
  } else if (maturity && maturity > settle) {
    flows.push({
      date: maturity,
      years: yearsAct365(settle, maturity),
      amount: faceTotal,
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
  const totalCoupons = couponPerPayment * flows.length;
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
  const isPrivatCatalog = proposal?.site_id === 'privat' && proposal?.kind !== 'holding';
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
      years,
      payments,
      maturityDate: proposal.maturity_date || null,
      paymentSchedule: proposal.payment_schedule || null,
      listedYieldType: null,
    };
  }

  const buyPrice = buyPriceEarly ?? resolveUnitBuyPrice(proposal, nominal);
  const quantity = Math.max(1, parseInt(proposal.quantity, 10) || 1);
  const inferredCoupon = inferCouponRate(proposal, nominal);
  const listedYtm = parseYield(proposal.yield_percent);
  const couponRate = inferredCoupon ?? listedYtm ?? 0;
  const pricePct = buyPrice && nominal ? (buyPrice / nominal) * 100 : 100;
  const fields = {
    nominal,
    quantity: proposal.kind === 'holding' ? quantity : 1,
    couponRate,
    listedYtm,
    couponFromListedYtm: inferredCoupon == null && listedYtm != null && listedYtm > 0,
    pricePct,
    years,
    payments,
    maturityDate: proposal.maturity_date || null,
    paymentSchedule: proposal.payment_schedule || null,
  };
  fields.listedYieldType = proposal.listed_yield_type
    ?? (proposal.site_id === 'privat' ? null : inferListedYieldType(proposal, fields));
  return fields;
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
  buildCashFlows,
  calcYtmFromCashFlows,
  calcYTM,
  computeProjection,
  inferListedYieldType,
  normalizeListedYieldTypeLabel,
  toCalculatorFields,
};

if (typeof module !== 'undefined' && module.exports) {
  module.exports = BondCalculator;
}

if (typeof window !== 'undefined') {
  window.BondCalculator = BondCalculator;
}
