/**
 * NBU reference catalog data helpers (browser + Node).
 */
(function (root, factory) {
  const BondListGrouping = typeof module !== 'undefined' && module.exports
    ? require('./grouping')
    : root.BondListGrouping;
  const BondNbuCatalog = factory(BondListGrouping, root.BondDates);
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = BondNbuCatalog;
  } else {
    root.BondNbuCatalog = BondNbuCatalog;
  }
}(typeof window !== 'undefined' ? window : globalThis, function (BondListGrouping, BondDatesGlobal) {
  const BondDatesModule = BondDatesGlobal
    || (() => {
      try {
        return require('../bond-dates');
      } catch {
        return null;
      }
    })();

  const { normalizeIsin } = BondListGrouping;

  function getNbuRecords(data = {}) {
    const byIsin = data?.nbu_reference?.by_isin || {};
    const records = Object.values(byIsin).filter((record) => record.currency === 'UAH');
    return records.sort((a, b) => {
      const maturityDiff = String(a.maturity_date || '').localeCompare(String(b.maturity_date || ''));
      if (maturityDiff !== 0) return maturityDiff;
      return String(a.isin || '').localeCompare(String(b.isin || ''), 'uk');
    });
  }

  function buildBrokerAvailabilityIndex(proposals = []) {
    const index = {};
    proposals.forEach((bond) => {
      const isin = normalizeIsin(bond.isin);
      if (!isin) return;
      if (!index[isin]) index[isin] = new Set();
      index[isin].add(bond.site_id);
    });
    return index;
  }

  function matchesIsinOrTitleSearch(record, rawQuery) {
    const q = String(rawQuery || '').trim().toLowerCase();
    if (!q) return true;
    const qUpper = q.toUpperCase();
    const isin = normalizeIsin(record.isin);
    const title = String(record.bond_type || record.title || '').toLowerCase();
    return isin.includes(qUpper) || title.includes(q);
  }

  function filterNbuRecordsBySearch(records, query) {
    if (!String(query || '').trim()) return records;
    return records.filter((record) => matchesIsinOrTitleSearch(record, query));
  }

  function filterCatalogGroupsBySearch(groups, query) {
    if (!String(query || '').trim()) return groups;
    return groups.filter((group) => {
      if (matchesIsinOrTitleSearch({
        isin: group.isin,
        title: group.title,
        bond_type: group.title,
      }, query)) {
        return true;
      }
      return (group.listings || []).some((bond) => matchesIsinOrTitleSearch({
        isin: bond.isin,
        title: bond.title,
        bond_type: bond.title,
      }, query));
    });
  }

  function formatNbuYield(value) {
    if (value == null || value === '') return '—';
    const n = typeof value === 'number' ? value : parseFloat(String(value).replace(',', '.'));
    if (!Number.isFinite(n)) return '—';
    return `${n.toLocaleString('uk-UA', { maximumFractionDigits: 2 })} %`;
  }

  function startOfToday() {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    return today;
  }

  function parseNbuPaymentDate(dateStr) {
    return BondDatesModule?.parseBondDate?.(dateStr) ?? null;
  }

  function normalizeNbuPaymentEntry(payment = {}) {
    const rawType = payment.payment_type ?? payment.pay_type;
    const paymentType = rawType === 'maturity' || String(rawType) === '2' || String(rawType) === '3'
      ? 'maturity'
      : 'coupon';
    const rawDate = payment.date || payment.pay_date || null;
    const date = BondDatesModule?.normalizeMaturityDate?.(rawDate) || rawDate;
    const dateObj = parseNbuPaymentDate(date);

    return {
      date,
      dateObj,
      amount: payment.amount ?? payment.pay_val ?? null,
      payment_type: paymentType,
      isPast: dateObj ? dateObj < startOfToday() : false,
    };
  }

  function getNbuPaymentSchedule(record) {
    const payments = Array.isArray(record?.payments) ? record.payments : [];
    return payments
      .map(normalizeNbuPaymentEntry)
      .filter((payment) => payment.date && payment.dateObj)
      .sort((a, b) => a.dateObj - b.dateObj);
  }

  function getNbuCouponPayments(record) {
    return getNbuPaymentSchedule(record).filter((payment) => payment.payment_type === 'coupon');
  }

  const NBU_COUPONS_PER_COLUMN = 5;

  function chunkNbuCouponColumns(items, size = NBU_COUPONS_PER_COLUMN) {
    if (!items.length) return [];
    const columns = [];
    for (let i = 0; i < items.length; i += size) {
      columns.push(items.slice(i, i + size));
    }
    return columns;
  }

  function nbuCouponColumnCount(itemCount) {
    if (!itemCount) return 0;
    return Math.ceil(itemCount / NBU_COUPONS_PER_COLUMN);
  }

  function parseNbuPaymentAmount(amount) {
    if (amount == null || amount === '') return null;
    const n = typeof amount === 'number' ? amount : parseFloat(String(amount).replace(',', '.'));
    return Number.isFinite(n) ? n : null;
  }

  function formatNbuPaymentAmount(amount) {
    const n = parseNbuPaymentAmount(amount);
    if (n == null) return amount == null || amount === '' ? '—' : String(amount);
    return `${n.toLocaleString('uk-UA', { maximumFractionDigits: 4 })} ₴`;
  }

  function sumNbuSchedulePayments(schedule, options = {}) {
    const futureOnly = options.futureOnly === true;
    let total = 0;
    let hasValue = false;
    schedule.forEach((payment) => {
      if (futureOnly && payment.isPast) return;
      const n = parseNbuPaymentAmount(payment.amount);
      if (n != null) {
        total += n;
        hasValue = true;
      }
    });
    return hasValue ? total : null;
  }

  function isNbuRecordInactive(record) {
    const circulation = record?.circulation;
    if (circulation === 0 || circulation === '0') return true;

    const maturity = parseNbuPaymentDate(record?.maturity_date);
    if (!maturity) return false;

    const today = startOfToday();
    const maturityDay = new Date(maturity.getFullYear(), maturity.getMonth(), maturity.getDate());
    return maturityDay < today;
  }

  function getNextCouponPayment(record) {
    if (!record) return null;
    const today = startOfToday();
    return getNbuCouponPayments(record).find((payment) => payment.dateObj && payment.dateObj >= today) || null;
  }

  return {
    NBU_COUPONS_PER_COLUMN,
    getNbuRecords,
    buildBrokerAvailabilityIndex,
    matchesIsinOrTitleSearch,
    filterNbuRecordsBySearch,
    filterCatalogGroupsBySearch,
    formatNbuYield,
    startOfToday,
    parseNbuPaymentDate,
    normalizeNbuPaymentEntry,
    getNbuPaymentSchedule,
    getNbuCouponPayments,
    chunkNbuCouponColumns,
    nbuCouponColumnCount,
    parseNbuPaymentAmount,
    formatNbuPaymentAmount,
    sumNbuSchedulePayments,
    isNbuRecordInactive,
    getNextCouponPayment,
  };
}));
