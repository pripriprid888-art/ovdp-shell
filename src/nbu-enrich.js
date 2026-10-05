/**
 * Merge NBU depo_securities reference data into broker catalog proposals.
 */

function normalizeIsin(value) {
  const raw = String(value || '').trim().toUpperCase();
  return /^UA\d{10}$/.test(raw) ? raw : raw || null;
}

function formatScheduleDate(value) {
  if (typeof BondDates !== 'undefined') {
    return BondDates.formatMaturityDate(value);
  }
  return value || '';
}

function formatScheduleAmount(value) {
  if (value == null || value === '') return null;
  const n = typeof value === 'number' ? value : parseFloat(String(value).replace(',', '.'));
  if (!Number.isFinite(n)) return String(value);
  return `${n.toLocaleString('uk-UA', { maximumFractionDigits: 4 })} ₴`;
}

function buildPaymentSchedule(reference) {
  if (!Array.isArray(reference?.payments) || !reference.payments.length) return null;
  return reference.payments.map((entry) => {
    const rawType = entry.payment_type ?? entry.pay_type;
    const paymentType = rawType === 'maturity' || String(rawType) === '2' || String(rawType) === '3'
      ? 'maturity'
      : 'coupon';
    const rawDate = entry.date || entry.pay_date || null;
    return {
      date: formatScheduleDate(rawDate),
      amount: formatScheduleAmount(entry.amount ?? entry.pay_val),
      payment_type: paymentType,
    };
  });
}

function enrichProposal(proposal, byIsin = {}) {
  if (!proposal) return proposal;

  const isin = normalizeIsin(proposal.isin);
  const reference = isin ? byIsin[isin] : null;
  if (!reference) return proposal;

  const paymentSchedule = Array.isArray(proposal.payment_schedule) && proposal.payment_schedule.length
    ? proposal.payment_schedule
    : buildPaymentSchedule(reference);

  const enriched = {
    ...proposal,
    maturity_date: proposal.maturity_date || reference.maturity_date || null,
    issue_date: proposal.issue_date || reference.issue_date || null,
    nominal_value: proposal.nominal_value || reference.nominal || null,
    nbu_reference: reference,
  };

  if (paymentSchedule?.length) {
    enriched.payment_schedule = paymentSchedule;
  }

  if (window.BondCalculator?.toCalculatorFields) {
    enriched.calculator = window.BondCalculator.toCalculatorFields(enriched);
  }

  return enriched;
}

function enrichProposals(proposals = [], byIsin = {}) {
  if (!Array.isArray(proposals) || !Object.keys(byIsin || {}).length) {
    return proposals;
  }
  return proposals.map((proposal) => enrichProposal(proposal, byIsin));
}

function pickBondTitle(proposal, reference) {
  if (reference?.bond_type) return reference.bond_type;
  const title = String(proposal?.title || '').trim();
  const genericTitle = /^державні облігації/i.test(title);
  if (title && !genericTitle) return title;
  if (proposal?.isin) return `ОВДП ${proposal.isin}`;
  return title || '—';
}

const NbuEnrich = {
  normalizeIsin,
  enrichProposal,
  enrichProposals,
  pickBondTitle,
};

if (typeof module !== 'undefined' && module.exports) {
  module.exports = NbuEnrich;
}

if (typeof window !== 'undefined') {
  window.NbuEnrich = NbuEnrich;
}
