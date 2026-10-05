let currentSource = 'all';
let catalogViewMode = 'available';
let nbuCatalogSearch = '';
let availableCatalogSearch = '';
let calendarActiveIsins = new Set();
let calendarActiveScopeKey = '';
let calendarBondQty = {};
let currentListKind = 'catalog';

let currentPortfolioView = 'positions';
let sessionStates = {};
let onboardingAppState = { sites: {} };
let cachedData = { proposals: [], inzhur: {}, univer: {} };
let localScanBusy = false;
let remoteScanBusy = false;
let lastScanOverlayMessage = '';
const scanFailuresByKind = {
  catalog: {},
  portfolio: {},
  orders: {},
};
let listKindRequestId = 0;
let listSortKey = null;
let listSortDir = 'desc';
let calculatorBond = null;
let calculatorSchedule = [];
let calculatorScheduleSource = 'none';
let calculatorQuoteContext = null;
let calculatorNominal = 1000;

/** UNIVER buy succeeded but order not yet in scanned list */
let pendingUniverOrders = [];
const PENDING_UNIVER_ORDER_TTL_MS = 15 * 60 * 1000;

const blg = BondListGrouping;
const bnc = BondNbuCatalog;

function groupingOptions() {
  return {
    currentSource,
    siteOrder: typeof SITE_ORDER !== 'undefined' ? SITE_ORDER : [],
    pickBondTitle: window.NbuEnrich?.pickBondTitle,
  };
}

function pickPrimaryListing(listings) {
  return blg.pickPrimaryListing(listings, groupingOptions());
}

function groupProposals(proposals, nbuByIsin = {}) {
  return blg.groupProposals(proposals, nbuByIsin, groupingOptions());
}

function defaultGroupCompare(a, b) {
  return String(a.isin || a.title).localeCompare(String(b.isin || b.title), 'uk');
}

function defaultListSortDir(key) {
  return key === 'price' ? 'asc' : 'desc';
}

function sortGroupsForDisplay(groups) {
  if (!listSortKey) return groups;
  return blg.sortBondGroups(groups, {
    key: listSortKey,
    dir: listSortDir,
    parseYield: (value) => window.BondCalculator?.parseYield?.(value) ?? null,
    parsePrice: (value) => parseMoneyValue(value),
    parseTotalReturn: (bond) => computeBondTotalReturnPct(bond),
    fallbackCompare: defaultGroupCompare,
  });
}

function applyListSortUi() {
  document.querySelectorAll('.bond-col-sort[data-sort-key]').forEach((btn) => {
    const key = btn.dataset.sortKey;
    const active = listSortKey === key;
    btn.classList.toggle('is-sort-active', active);
    btn.setAttribute('aria-sort', active ? (listSortDir === 'asc' ? 'ascending' : 'descending') : 'none');
    const indicator = btn.querySelector('.bond-col-sort-indicator');
    if (indicator) {
      indicator.textContent = active ? (listSortDir === 'asc' ? '↑' : '↓') : '';
    }
  });
}

function toggleListSort(key) {
  if (!['yield', 'price', 'totalReturn'].includes(key)) return;
  if (listSortKey === key) {
    listSortDir = listSortDir === 'asc' ? 'desc' : 'asc';
  } else {
    listSortKey = key;
    listSortDir = defaultListSortDir(key);
  }
  applyListSortUi();
  renderBondLists(cachedData);
}

function formatMoney(n) {
  return n.toLocaleString('uk-UA', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function formatPct(n) {
  return formatPctCompact(n).replace(/ %$/, '');
}

function formatProfitPct(value) {
  if (value == null || !Number.isFinite(value)) return '—';
  const rounded = Math.round(value * 100) / 100;
  const compact = rounded.toLocaleString('uk-UA', {
    maximumFractionDigits: 2,
    minimumFractionDigits: 0,
  });
  return `${compact}%`;
}

function resolveCalculatorNominal(bond, fields = {}) {
  const parsed = window.BondCalculator?.parsePrice?.(bond?.nominal_value)
    ?? parseBondMoney(bond?.nominal_value);
  return parsed > 0 ? parsed : (fields.nominal > 0 ? fields.nominal : 1000);
}

function setOut(id, text) {
  const el = document.getElementById(id);
  if (el) el.textContent = text;
}

function parseCalcNumber(id) {
  const raw = document.getElementById(id)?.value;
  if (raw == null || raw === '') return null;
  const n = parseFloat(String(raw).replace(',', '.'));
  return Number.isFinite(n) ? n : null;
}

function bondHasPaymentSchedule(schedule = calculatorSchedule) {
  return Array.isArray(schedule) && schedule.length > 0;
}

function resolveBondPaymentSchedule(bond) {
  return resolveBondPaymentScheduleDetailed(bond).schedule;
}

function resolveBondPaymentScheduleDetailed(bond) {
  if (!bond) return { schedule: [], source: 'none' };
  if (Array.isArray(bond.payment_schedule) && bond.payment_schedule.length) {
    return { schedule: bond.payment_schedule, source: 'listing' };
  }

  const isin = blg.normalizeIsin(bond.isin);
  if (!isin) return { schedule: [], source: 'none' };

  const nbuRecord = bond.nbu_reference || cachedData?.nbu_reference?.by_isin?.[isin];
  if (!nbuRecord) return { schedule: [], source: 'none' };

  const enriched = window.NbuEnrich?.enrichProposal(
    { isin, site_id: bond.site_id || 'nbu' },
    { [isin]: nbuRecord },
  );
  const schedule = enriched?.payment_schedule || [];
  return { schedule, source: schedule.length ? 'nbu' : 'none' };
}

function countFutureSchedulePayments(schedule, settle = new Date()) {
  const today = window.BondDates?.startOfDay?.(settle)
    ?? new Date(settle.getFullYear(), settle.getMonth(), settle.getDate());
  return schedule.filter((entry) => {
    const date = window.BondDates?.parseBondDate?.(entry.date)
      ?? window.BondCalculator?.parseUkDate?.(entry.date);
    return date && date > today;
  }).length;
}

function deriveScheduleMaturityDate(schedule, bond) {
  if (bond?.maturity_date) return bond.maturity_date;
  if (!schedule.length) return null;
  const dates = schedule
    .map((entry) => entry?.date)
    .filter(Boolean)
    .sort((a, b) => String(a).localeCompare(String(b)));
  return dates[dates.length - 1] || null;
}

function resolveCalculatorPricePct(nominal, unitPriceUah) {
  if (!(nominal > 0) || unitPriceUah == null || !(unitPriceUah >= 0)) return null;
  return (unitPriceUah / nominal) * 100;
}

function formatCalcDeltaPct(value) {
  if (value == null || !Number.isFinite(value)) return '—';
  const sign = value > 0 ? '+' : '';
  return `${sign}${formatProfitPct(value)}`;
}

function updateCalculatorScheduleUi(bond, schedule = calculatorSchedule) {
  const noScheduleNote = document.getElementById('calc-no-schedule-note');
  const scheduleWrap = document.querySelector('.calc-schedule-wrap');
  const hasSchedule = bondHasPaymentSchedule(schedule);

  if (noScheduleNote) {
    if (!bond) {
      noScheduleNote.hidden = false;
      noScheduleNote.textContent = 'Оберіть облігацію зі списку — розрахунок базується на офіційному графіку виплат НБУ.';
    } else if (!hasSchedule) {
      noScheduleNote.hidden = false;
      noScheduleNote.textContent = 'Графік виплат для цієї облігації недоступний — завантажте довідник НБУ або оберіть іншу позицію.';
    } else {
      noScheduleNote.hidden = true;
      noScheduleNote.textContent = '';
    }
  }

  if (scheduleWrap) {
    scheduleWrap.hidden = !hasSchedule;
  }
}

function renderCouponSchedule(schedule, quantity, nominal) {
  const body = document.getElementById('calc-schedule-body');
  const foot = document.getElementById('calc-schedule-foot');
  if (!body || !foot) return;

  const calc = window.BondCalculator;
  const settle = window.BondDates?.startOfDay?.() ?? new Date();
  const qty = Math.max(0, Number(quantity) || 0);
  const face = Math.max(0, Number(nominal) || 0);

  if (!bondHasPaymentSchedule(schedule) || !(qty > 0) || !(face > 0) || !calc?.buildScheduleDisplayRows) {
    body.innerHTML = '';
    foot.innerHTML = '';
    return;
  }

  const displayRows = calc.buildScheduleDisplayRows(schedule, face, qty, settle);
  if (!displayRows.length) {
    body.innerHTML = '<tr><td colspan="4" class="calc-schedule-empty">Немає майбутніх виплат у графіку.</td></tr>';
    foot.innerHTML = '';
    return;
  }

  let couponTotal = 0;
  let maturityTotal = 0;
  body.innerHTML = displayRows.map((row) => {
    if (row.isMaturity) maturityTotal += row.totalAmount;
    else couponTotal += row.totalAmount;
    const dateLabel = formatMaturityDate(row.date instanceof Date ? row.date : row.date);
    return `
    <tr${row.isMaturity ? ' class="calc-schedule-maturity"' : ''}>
      <td>${blg.escapeHtml(dateLabel)}</td>
      <td>${blg.escapeHtml(row.label)}</td>
      <td>${formatMoney(row.unitAmount)} ₴</td>
      <td>${formatMoney(row.totalAmount)} ₴</td>
    </tr>`;
  }).join('');

  const allReceipts = calc.sumScheduleReceipts?.(schedule, face, qty, { settle }) ?? 0;
  const upcomingReceipts = calc.sumScheduleReceipts?.(schedule, face, qty, { settle, futureOnly: true }) ?? 0;
  const grandTotalCell = scheduleGrandTotalValuesHtml(
    allReceipts,
    upcomingReceipts,
    (amount) => `${formatMoney(amount)} ₴`,
  );

  foot.innerHTML = `
    <tr class="calc-schedule-total">
      <td colspan="3">Усього купонів</td>
      <td>${formatMoney(couponTotal)} ₴</td>
    </tr>
    ${maturityTotal > 0 ? `
      <tr class="calc-schedule-total">
        <td colspan="3">Погашення номіналу</td>
        <td>${formatMoney(maturityTotal)} ₴</td>
      </tr>
    ` : ''}
    <tr class="calc-schedule-total calc-schedule-grand-total">
      <td colspan="3">Разом (купони + погашення)</td>
      <td>${grandTotalCell}</td>
    </tr>
  `;
}

function scheduleSourceLabel(source) {
  if (source === 'nbu') return 'офіційний графік НБУ';
  if (source === 'listing') return 'графік з картки пропозиції';
  return '';
}

function updateCalculatorQuoteContext(bond, quoteContext) {
  const el = document.getElementById('calc-quote-context');
  if (!el) return;

  if (!bond || !quoteContext) {
    el.hidden = true;
    el.textContent = '';
    return;
  }

  const platform = SITE_LABELS[bond.site_id] || bond.site_id || '—';
  const schedulePart = scheduleSourceLabel(calculatorScheduleSource);
  const parts = [`Котирування: ${platform}`];
  if (schedulePart) parts.push(`графік: ${schedulePart}`);
  el.hidden = false;
  el.textContent = parts.join(' · ');
}

function updateCalculatorYieldCompare(result, quoteContext) {
  const listedEl = document.getElementById('out-listed-yield');
  const computedEl = document.getElementById('out-computed-ytm');
  if (!listedEl || !computedEl) return;

  const listed = quoteContext?.listedYtm;
  const listedType = quoteContext?.listedYieldType;
  if (listed != null && listed > 0) {
    const typeLabel = listedType === 'SIM' ? 'поточна' : (listedType === 'YTM' ? 'YTM' : 'на сайті');
    listedEl.hidden = false;
    listedEl.textContent = `Дохідність ${typeLabel}: ${formatProfitPct(listed)} (котирування брокера, не використовується для купонів)`;
  } else {
    listedEl.hidden = true;
    listedEl.textContent = '';
  }

  if (result && Number.isFinite(result.ytm) && result.ytm > 0 && result.purchaseTotal > 0) {
    computedEl.hidden = false;
    computedEl.textContent = `YTM за графіком і ціною: ${formatProfitPct(result.ytm)}`;
  } else {
    computedEl.hidden = true;
    computedEl.textContent = '';
  }
}

function updateCalculatorPriceHint(nominal, quantity, unitPriceUah) {
  const hint = document.getElementById('calc-price-hint');
  if (!hint) return;
  if (!(quantity > 1) || unitPriceUah == null || !(unitPriceUah >= 0)) {
    hint.hidden = true;
    hint.textContent = '';
    return;
  }
  hint.hidden = false;
  hint.textContent = `Разом за ${quantity} шт.: ${formatMoney(unitPriceUah * quantity)} ₴`;
}

function updateCalculatorPrivatNote(bond, fields) {
  const note = document.getElementById('calc-privat-price-note');
  if (!note) return;
  const missingPrice = bond?.site_id === 'privat'
    && (fields?.unitPriceUah == null || fields?.pricePct == null);
  note.hidden = !missingPrice;
}

function resetCalculatorBlank() {
  calculatorSchedule = [];
  calculatorScheduleSource = 'none';
  calculatorQuoteContext = null;
  calculatorNominal = 1000;
  ['quantity', 'price-uah'].forEach((id) => {
    const el = document.getElementById(id);
    if (el) el.value = '';
  });
  updateCalculatorScheduleUi(null, []);
  renderCouponSchedule([], 0, calculatorNominal);
  updateCalculatorPriceHint(null, null, null);
  updateCalculatorPrivatNote(null, {});
  updateCalculatorQuoteContext(null, null);
  updateCalculatorYieldCompare(null, null);
}

function calculate() {
  const calc = window.BondCalculator;
  if (!calc) return;

  const nominal = calculatorNominal;
  const quantity = parseCalcNumber('quantity') ?? 0;
  const unitPriceUah = parseCalcNumber('price-uah');
  const pricePct = resolveCalculatorPricePct(nominal, unitPriceUah) ?? 0;
  const schedule = calculatorSchedule;
  const hasSchedule = bondHasPaymentSchedule(schedule);
  const scheduleBond = hasSchedule
    ? { payment_schedule: schedule, maturity_date: deriveScheduleMaturityDate(schedule, calculatorBond) }
    : null;
  const couponRate = scheduleBond
    ? (calc.inferCouponRate?.(scheduleBond, nominal) ?? 0)
    : 0;
  const paymentsPerYear = hasSchedule
    ? (calc.inferPaymentsPerYear?.(scheduleBond) || 2)
    : 2;

  updateCalculatorPriceHint(nominal, quantity, unitPriceUah);
  renderCouponSchedule(schedule, quantity, nominal);

  const hasInputs = nominal > 0 && quantity > 0 && pricePct > 0 && hasSchedule;

  if (!hasInputs) {
    const capitalLabel = document.getElementById('out-capital-label');
    if (capitalLabel) capitalLabel.textContent = 'Дисконт / премія';
    setOut('out-purchase', '—');
    setOut('out-total', '—');
    setOut('out-total-coupons', '—');
    setOut('out-capital', '—');
    setOut('out-total-return-pct', '—');
    updateCalculatorYieldCompare(null, calculatorQuoteContext);
    return;
  }

  const result = calc.computeProjection({
    nominal,
    quantity,
    couponRate,
    pricePct,
    years: 0,
    paymentsPerYear,
    maturityDate: deriveScheduleMaturityDate(schedule, calculatorBond),
    paymentSchedule: schedule,
    settleDate: new Date(),
  });

  const totalSign = result.totalReturn >= 0 ? '+' : '−';
  const capitalMagnitude = Math.abs(result.capitalGainAbs);
  let capitalOut = `${formatMoney(capitalMagnitude)} ₴`;
  if (result.capitalGainAbs > 0) capitalOut = `+${capitalOut}`;
  const capitalLabel = document.getElementById('out-capital-label');
  if (capitalLabel) {
    if (result.capitalGainAbs > 0) capitalLabel.textContent = 'Дисконт';
    else if (result.capitalGainAbs < 0) capitalLabel.textContent = 'Премія';
    else capitalLabel.textContent = 'Дисконт / премія';
  }
  setOut('out-purchase', `${formatMoney(result.purchaseTotal)} ₴`);
  setOut('out-total', `${totalSign}${formatMoney(Math.abs(result.totalReturn))} ₴`);
  setOut('out-total-coupons', `${formatMoney(result.totalCoupons)} ₴`);
  setOut('out-capital', capitalOut);
  setOut('out-total-return-pct', formatProfitPct(result.totalReturnPct));
  updateCalculatorYieldCompare(result, calculatorQuoteContext);
}

function resolveCalculatorFields(bond, scheduleSource = calculatorScheduleSource) {
  if (window.BondCalculator?.toCalculatorQuoteContext) {
    return window.BondCalculator.toCalculatorQuoteContext(bond, { scheduleSource });
  }
  if (window.BondCalculator?.toCalculatorFields) {
    return window.BondCalculator.toCalculatorFields(bond);
  }
  const fields = bond.calculator || {};
  const listedYtm = fields.listedYtm ?? window.BondCalculator?.parseYield?.(bond.yield_percent) ?? null;
  const couponRate = fields.couponRate > 0 ? fields.couponRate : 0;
  return { ...fields, listedYtm, couponRate };
}

function fillCalculatorFields(bond) {
  calculatorBond = bond || null;
  const resolvedSchedule = bond
    ? resolveBondPaymentScheduleDetailed(bond)
    : { schedule: [], source: 'none' };
  calculatorSchedule = resolvedSchedule.schedule;
  calculatorScheduleSource = resolvedSchedule.source;
  const isinEl = document.getElementById('calc-isin');
  if (isinEl) isinEl.textContent = bond?.isin || '—';

  if (!bond) {
    resetCalculatorBlank();
    calculate();
    return;
  }

  const scheduleBond = calculatorSchedule.length
    ? { ...bond, payment_schedule: calculatorSchedule, maturity_date: deriveScheduleMaturityDate(calculatorSchedule, bond) || bond.maturity_date }
    : bond;
  calculatorQuoteContext = resolveCalculatorFields(scheduleBond, calculatorScheduleSource);
  const fields = calculatorQuoteContext;
  const unitPrice = fields.unitPriceUah ?? (
    fields.pricePct != null && fields.nominal
      ? (fields.pricePct * fields.nominal) / 100
      : null
  );

  calculatorNominal = resolveCalculatorNominal(bond, fields);
  document.getElementById('quantity').value = fields.quantity ?? '';
  document.getElementById('price-uah').value = unitPrice != null ? unitPrice : '';
  updateCalculatorScheduleUi(bond, calculatorSchedule);
  updateCalculatorPrivatNote(bond, { ...fields, unitPriceUah: unitPrice });
  updateCalculatorQuoteContext(bond, calculatorQuoteContext);
  calculate();
}

function fillCalculatorFromBond(bond) {
  window.openCalcDrawer?.(bond);
}

window.fillCalculatorFields = fillCalculatorFields;
window.calculate = calculate;

function formatScanTime(iso) {
  if (!iso) return '';
  try {
    return new Date(iso).toLocaleString('uk-UA');
  } catch {
    return iso;
  }
}

function persistListCache(listKind, data) {
  window.ListCache?.writeListCacheEntry(listKind, data);
}

function hydrateListCache(listKind) {
  return window.ListCache?.readListCacheEntry(listKind) || null;
}

function scanTimeForActiveView(data) {
  if (isOrdersView()) return data?.orders_scanned_at;
  if (isHoldingView()) return data?.holdings_scanned_at;
  return data?.scanned_at;
}

function scanFailureStorageKind(listKind = activeListKind()) {
  if (listKind === 'holdings') return 'portfolio';
  if (listKind === 'orders') return 'orders';
  return 'catalog';
}

function activeScanFailureKind() {
  if (isOrdersView()) return 'orders';
  if (isHoldingView()) return 'portfolio';
  return 'catalog';
}

function getScanFailures(kind = activeScanFailureKind()) {
  return scanFailuresByKind[kind] || {};
}

function isSiteScanFailed(siteId, kind = activeScanFailureKind()) {
  return Boolean(getScanFailures(kind)[siteId]);
}

function setScanFailure(listKind, siteId, message) {
  if (!siteId || siteId === 'all') return;
  const kind = scanFailureStorageKind(listKind);
  scanFailuresByKind[kind][siteId] = message;
}

function clearScanFailure(listKind, siteId) {
  if (!siteId || siteId === 'all') return;
  const kind = scanFailureStorageKind(listKind);
  delete scanFailuresByKind[kind][siteId];
}

function updateScanFailures(listKind, scanResult) {
  if (!scanResult) return;
  const kind = scanFailureStorageKind(listKind);
  for (const entry of scanResult.results || []) {
    delete scanFailuresByKind[kind][entry.siteId];
  }
  for (const entry of scanResult.errors || []) {
    scanFailuresByKind[kind][entry.siteId] = entry.message;
  }
}

function scanSiteRowHtml(siteId, { time, failedMessage, prefix = '' }) {
  const label = SITE_LABELS[siteId] || siteId;
  if (failedMessage) {
    return `
      <span class="scan-site-row scan-site-row-failed" title="${blg.escapeHtml(failedMessage)}">
        ${prefix}${label}: помилка
      </span>
    `;
  }
  if (time) {
    return `<span class="scan-site-row">${prefix}${label}: ${formatScanTime(time)}</span>`;
  }
  return `<span class="scan-site-row scan-site-row-missing">${prefix}${label}: —</span>`;
}

function buildScanSiteRowsMeta(data, { fromCache = false } = {}) {
  const prefix = fromCache ? 'Кеш · ' : '';
  const failures = getScanFailures(activeScanFailureKind());

  if (isOrdersView()) {
    const failedMessage = failures.univer;
    return scanSiteRowHtml('univer', {
      time: data?.univer?.orders_scanned_at || data?.orders_scanned_at,
      failedMessage,
      prefix,
    });
  }

  if (isHoldingView()) {
    return SITE_ORDER.map((siteId) => scanSiteRowHtml(siteId, {
      time: data?.[siteId]?.holdings_scanned_at,
      failedMessage: failures[siteId],
      prefix,
    })).join('');
  }

  return SITE_ORDER.map((siteId) => scanSiteRowHtml(siteId, {
    time: data?.[siteId]?.scanned_at,
    failedMessage: failures[siteId],
    prefix,
  })).join('');
}

function setScanStatusFromData(data, { fromCache = false } = {}) {
  const scanTime = scanTimeForActiveView(data);
  if (scanTime) {
    const prefix = fromCache ? 'Кеш · ' : '';
    if (isOrdersView()) {
      setScanStatus(`${prefix}Замовлення оновлено`, false, {
        metaHtml: `<div class="scan-site-rows">${buildScanSiteRowsMeta(data, { fromCache })}</div>`,
      });
      return;
    }
    if (isHoldingView()) {
      setScanStatus(`${prefix}Портфель оновлено`, false, {
        metaHtml: `<div class="scan-site-rows">${buildScanSiteRowsMeta(data, { fromCache })}</div>`,
      });
      return;
    }
    const inzhurTime = data.inzhur?.scanned_at;
    const univerTime = data.univer?.scanned_at;
    const privatTime = data.privat?.scanned_at;
    if (inzhurTime || univerTime || privatTime || Object.keys(getScanFailures('catalog')).length) {
      setScanStatus(`${prefix}Каталог оновлено`, false, {
        metaHtml: `<div class="scan-site-rows">${buildScanSiteRowsMeta(data, { fromCache })}</div>`,
      });
      return;
    }
    setScanStatus(`${prefix}Каталог оновлено`, false, {
      meta: formatScanTime(scanTime),
    });
    return;
  }

  if (isPortfolioSection() && !(data?.proposals || []).length) {
    setScanStatus(portfolioTabHintText());
    return;
  }

  if (!(data?.proposals || []).length) {
    setScanStatus('');
  }
}

function filteredProposals(data, source) {
  const proposals = data?.proposals || [];
  if (source === 'all') return proposals;
  return proposals.filter((bond) => bond.site_id === source);
}

function isNbuCatalogView() {
  return currentListKind === 'catalog' && catalogViewMode === 'nbu';
}

function isCalendarMode() {
  return currentListKind === 'calendar';
}

function applyCatalogViewUi() {
  const panel = document.getElementById('panel-bonds');
  if (panel) {
    panel.dataset.catalogView = catalogViewMode;
  }

  document.querySelectorAll('.catalog-view-btn').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.catalogView === catalogViewMode);
  });

  document.querySelectorAll('[data-catalog-filter]').forEach((el) => {
    el.hidden = el.dataset.catalogFilter !== catalogViewMode;
  });

  document.querySelectorAll('[data-nbu-refresh]').forEach((el) => {
    el.hidden = !isNbuCatalogView();
  });

  const nbuSearchInput = document.getElementById('nbu-catalog-search');
  if (nbuSearchInput && nbuSearchInput.value !== nbuCatalogSearch) {
    nbuSearchInput.value = nbuCatalogSearch;
  }

  const availableSearchInput = document.getElementById('available-catalog-search');
  if (availableSearchInput && availableSearchInput.value !== availableCatalogSearch) {
    availableSearchInput.value = availableCatalogSearch;
  }

  applyListSortUi();
}

function getPortfolioIsins(data, source = 'all') {
  const isins = new Set();
  (data?.proposals || []).forEach((bond) => {
    if (bond.kind !== 'holding') return;
    if (source !== 'all' && bond.site_id !== source) return;
    const isin = blg.normalizeIsin(bond.isin);
    if (isin) isins.add(isin);
  });
  return isins;
}

function buildHoldingsQtyIndex(data, source = 'all') {
  const index = {};
  (data?.proposals || []).forEach((bond) => {
    if (bond.kind !== 'holding') return;
    if (source !== 'all' && bond.site_id !== source) return;
    const isin = blg.normalizeIsin(bond.isin);
    if (!isin) return;
    const qty = typeof bond.quantity === 'number'
      ? bond.quantity
      : parseFloat(String(bond.quantity ?? '').replace(/\s/g, '').replace(',', '.'));
    if (!Number.isFinite(qty)) return;
    index[isin] = (index[isin] || 0) + qty;
  });
  return index;
}

function buildCalendarMergedData(catalogData = {}, holdingsData = {}) {
  const holdingsProposals = holdingsData?.proposals || [];
  const catalogProposals = (catalogData?.proposals || []).filter((bond) => bond.kind !== 'holding');
  const byKey = new Map();

  // Holdings win over catalog for the same platform + ISIN so kind: 'holding' is preserved.
  holdingsProposals.forEach((bond) => {
    byKey.set(`${bond.site_id}:${blg.normalizeIsin(bond.isin)}`, bond);
  });
  catalogProposals.forEach((bond) => {
    const key = `${bond.site_id}:${blg.normalizeIsin(bond.isin)}`;
    if (!byKey.has(key)) byKey.set(key, bond);
  });

  return {
    ...catalogData,
    proposals: [...byKey.values()],
    holdings_scanned_at: holdingsData?.holdings_scanned_at || catalogData?.holdings_scanned_at || null,
  };
}

async function loadCalendarData() {
  const shell = requireShell();
  const [catalog, holdings] = await Promise.all([
    shell.getSecurities('all', 'catalog'),
    shell.getSecurities('all', 'holdings'),
  ]);
  const holdingsCache = hydrateListCache('holdings');
  const holdingsData = (holdings?.proposals || []).length
    ? holdings
    : (holdingsCache || { proposals: [] });
  return buildCalendarMergedData(catalog, holdingsData);
}

function calendarScopeKey(data, allRecords = []) {
  return `${allRecords.length}:${data?.holdings_scanned_at || ''}:${data?.scanned_at || ''}`;
}

function getCalendarDefaultIsins(allRecords) {
  return new Set(allRecords.map((record) => blg.normalizeIsin(record.isin)).filter(Boolean));
}

function syncCalendarActiveIsins(allRecords, scopeKey, data) {
  const allIsins = allRecords.map((record) => blg.normalizeIsin(record.isin)).filter(Boolean);
  const holdingsQty = buildHoldingsQtyIndex(data, 'all');

  if (scopeKey !== calendarActiveScopeKey) {
    calendarActiveScopeKey = scopeKey;
    calendarActiveIsins = getCalendarDefaultIsins(allRecords);
    if (!calendarActiveIsins.size && allIsins.length) {
      calendarActiveIsins = new Set(allIsins);
    }
    syncCalendarBondQty(allIsins, holdingsQty, true);
    return;
  }

  calendarActiveIsins = new Set(
    [...calendarActiveIsins].filter((isin) => allIsins.includes(isin)),
  );
  if (!calendarActiveIsins.size && allIsins.length) {
    calendarActiveIsins = new Set(allIsins);
  }
  syncCalendarBondQty(allIsins, holdingsQty, false);
}

function syncCalendarBondQty(allIsins, holdingsQty = {}, resetScope = false) {
  const next = resetScope ? {} : { ...calendarBondQty };
  allIsins.forEach((isin) => {
    if (!resetScope && next[isin] != null) return;
    if (holdingsQty[isin] != null && holdingsQty[isin] > 0) {
      next[isin] = Math.round(holdingsQty[isin]);
      return;
    }
    next[isin] = next[isin] != null ? next[isin] : 1;
  });
  Object.keys(next).forEach((isin) => {
    if (!allIsins.includes(isin)) delete next[isin];
  });
  calendarBondQty = next;
}

function resolveCalendarBondQty(isin, holdingsQty = {}) {
  const key = blg.normalizeIsin(isin);
  const raw = calendarBondQty[key];
  if (raw != null && Number.isFinite(Number(raw))) {
    return Math.max(0, Math.floor(Number(raw)));
  }
  if (holdingsQty[key] != null && holdingsQty[key] > 0) {
    return Math.max(0, Math.floor(Number(holdingsQty[key])));
  }
  return 1;
}

function applyCalendarActiveFilter(records) {
  if (!calendarActiveIsins.size) return [];
  return records.filter((record) => calendarActiveIsins.has(blg.normalizeIsin(record.isin)));
}

function resetCalendarActiveIsins() {
  calendarActiveIsins = new Set();
  calendarActiveScopeKey = '';
  calendarBondQty = {};
}

function bondNbuRecord(bond) {
  return bond?.nbu_reference || null;
}

function groupNbuRecord(group) {
  if (group?.nbu_reference) return group.nbu_reference;
  for (const bond of group?.listings || []) {
    const record = bondNbuRecord(bond);
    if (record) return record;
  }
  return null;
}

function formatNominalYieldCell(record) {
  if (!record || record.nominal_yield == null || record.nominal_yield === '') return '—';
  return blg.escapeHtml(bnc.formatNbuYield(record.nominal_yield));
}

function formatNextCouponCell(record) {
  const next = bnc.getNextCouponPayment(record);
  if (!next) return '—';
  return `
    <span class="bond-next-coupon">
      <span class="nbu-coupon-date">${blg.escapeHtml(formatMaturityDate(next.date))}</span>
      <span class="nbu-coupon-amount">${blg.escapeHtml(bnc.formatNbuPaymentAmount(next.amount))}</span>
    </span>
  `;
}

function catalogHasExpandPanel(group) {
  const multi = (group?.listings || []).length > 1;
  const nbu = groupNbuRecord(group);
  const hasSchedule = Boolean(nbu && bnc.getNbuPaymentSchedule(nbu).length);
  return multi || hasSchedule;
}

function nbuAvailabilityHtml(isin, availabilityIndex) {
  const sites = SITE_ORDER.filter((siteId) => availabilityIndex[isin]?.has(siteId));
  if (!sites.length) {
    return '<span class="bond-availability-none">—</span>';
  }
  return sites.map((siteId) => (
    `<span class="bond-badge ${siteBadgeClass(siteId)}">${SITE_LABELS[siteId] || siteId}</span>`
  )).join('');
}

function scheduleGrandTotalValuesHtml(allTotal, upcomingTotal, formatAmount) {
  if (allTotal == null && upcomingTotal == null) return '';
  const allText = allTotal != null ? formatAmount(allTotal) : '—';
  const upcomingText = upcomingTotal != null ? formatAmount(upcomingTotal) : '—';
  return `
    <span class="schedule-grand-total-values">
      <span class="schedule-grand-total-part" title="Усі виплати за графіком">
        <span class="schedule-grand-total-key">усього</span>
        <span class="schedule-grand-total-amount">${blg.escapeHtml(allText)}</span>
      </span>
      <span class="schedule-grand-total-part" title="Майбутні виплати (з погашенням)">
        <span class="schedule-grand-total-key">майбутні</span>
        <span class="schedule-grand-total-amount">${blg.escapeHtml(upcomingText)}</span>
      </span>
    </span>
  `;
}

function nbuScheduleTotalHtml(schedule) {
  const allTotal = bnc.sumNbuSchedulePayments(schedule);
  const upcomingTotal = bnc.sumNbuSchedulePayments(schedule, { futureOnly: true });
  if (allTotal == null && upcomingTotal == null) return '';
  return `
    <div class="nbu-coupon-total">
      <span class="nbu-coupon-total-label">Разом (купони + погашення)</span>
      ${scheduleGrandTotalValuesHtml(allTotal, upcomingTotal, bnc.formatNbuPaymentAmount)}
    </div>
  `;
}

function nbuPaymentTypeLabel(paymentType) {
  return paymentType === 'maturity' ? 'Погашення' : 'Купон';
}

function nbuCouponLineHtml(payment) {
  const pastClass = payment.isPast ? ' nbu-coupon-past' : '';
  return `<span class="nbu-coupon-line${pastClass}">`
    + `<span class="nbu-coupon-date">${blg.escapeHtml(formatMaturityDate(payment.date))}</span>`
    + `<span class="nbu-coupon-amount">${blg.escapeHtml(bnc.formatNbuPaymentAmount(payment.amount))}</span>`
    + `</span>`;
}

function nbuCouponColumnsHtml(items, { compact = false, limit = null } = {}) {
  if (!items.length) {
    return '<span class="bond-availability-none">—</span>';
  }

  const previewLimit = compact ? (limit ?? bnc.NBU_COUPONS_PER_COLUMN) : null;
  const visibleItems = previewLimit != null ? items.slice(0, previewLimit) : items;
  const hiddenCount = previewLimit != null ? Math.max(0, items.length - visibleItems.length) : 0;
  const columns = previewLimit != null ? [visibleItems] : bnc.chunkNbuCouponColumns(items);
  const columnClass = compact ? 'nbu-coupon-columns nbu-coupon-columns-compact' : 'nbu-coupon-columns';
  const moreHint = hiddenCount > 0
    ? `<span class="nbu-coupon-more-hint">+${hiddenCount} ще · розгорнути графік</span>`
    : '';

  return `
    <div class="nbu-coupon-preview">
      <div class="${columnClass}" style="--nbu-coupon-cols: ${columns.length}">
        ${columns.map((column) => `
          <div class="nbu-coupon-column">
            ${column.map((payment) => nbuCouponLineHtml(payment)).join('')}
          </div>
        `).join('')}
      </div>
      ${moreHint}
    </div>
  `;
}

function nbuCouponPanelHtml(schedule) {
  if (!schedule.length) {
    return '<p class="nbu-coupon-empty">Немає даних про виплати</p>';
  }

  const coupons = schedule.filter((payment) => payment.payment_type === 'coupon');
  const maturity = schedule.filter((payment) => payment.payment_type === 'maturity');

  return `
    <div class="nbu-coupon-panel-body">
      ${coupons.length ? nbuCouponColumnsHtml(coupons) : ''}
      ${maturity.length ? `
        <div class="nbu-coupon-maturity-block">
          ${maturity.map((payment) => `
            <div class="nbu-coupon-row${payment.isPast ? ' nbu-coupon-past' : ''}">
              <span class="nbu-coupon-type">${blg.escapeHtml(nbuPaymentTypeLabel(payment.payment_type))}</span>
              <span class="nbu-coupon-date">${blg.escapeHtml(formatMaturityDate(payment.date))}</span>
              <span class="nbu-coupon-amount">${blg.escapeHtml(bnc.formatNbuPaymentAmount(payment.amount))}</span>
            </div>
          `).join('')}
        </div>
      ` : ''}
      ${nbuScheduleTotalHtml(schedule)}
    </div>
  `;
}

function nbuRecordToProposal(record) {
  const base = {
    isin: record.isin,
    title: record.bond_type,
    site_id: 'nbu',
    kind: 'reference',
  };
  const byIsin = { [record.isin]: record };
  return window.NbuEnrich?.enrichProposal(base, byIsin) || base;
}

function nbuBondRowHtml(record, availabilityIndex) {
  const isin = blg.normalizeIsin(record.isin);
  const inactiveClass = bnc.isNbuRecordInactive(record) ? ' bond-card-nbu-inactive' : '';
  const coupons = bnc.getNbuCouponPayments(record);
  const schedule = bnc.getNbuPaymentSchedule(record);
  const couponColumns = bnc.nbuCouponColumnCount(coupons.length);
  const expandable = schedule.length > 0;
  const expandLabel = `Графік виплат (${schedule.length})`;
  return `
    <article class="bond-card bond-card-row bond-card-nbu${inactiveClass}${expandable ? ' bond-card-expandable' : ''}" style="--nbu-coupon-cols: ${couponColumns || 1}">
      <div class="bond-row bond-nbu-grid${expandable ? ' bond-row-expandable' : ''}"${expandable ? bondRowExpandAttrs(expandLabel) : ''}>
        <div class="bond-col bond-col-ident">${bondIdentHtml(isin, record.bond_type || '—', { expandable })}</div>
        <div class="bond-col bond-col-nbu-yield">${blg.escapeHtml(bnc.formatNbuYield(record.nominal_yield))}</div>
        <div class="bond-col bond-col-issue">${blg.escapeHtml(formatMaturityDate(record.issue_date))}</div>
        <div class="bond-col bond-col-maturity">${blg.escapeHtml(formatMaturityDate(record.maturity_date))}</div>
        <div class="bond-col bond-col-nbu-coupons">${nbuCouponColumnsHtml(coupons, { compact: true })}</div>
        <div class="bond-col bond-col-nbu-circulation">${blg.escapeHtml(formatQuantity(record.circulation))}</div>
        <div class="bond-col bond-col-badges">
          <div class="bond-site-chips">${nbuAvailabilityHtml(isin, availabilityIndex)}</div>
        </div>
        <div class="bond-col bond-col-actions bond-actions bond-row-actions">
          <button type="button" class="action" data-action="calc" data-isin="${blg.escapeHtml(isin || '')}">Калькулятор</button>
        </div>
      </div>
      ${schedule.length ? `<div class="nbu-coupon-panel" hidden>${nbuCouponPanelHtml(schedule)}</div>` : ''}
    </article>
  `;
}

function emptyNbuListMessage() {
  return `
    <div class="empty-state-panel">
      <p class="empty-state-title">Довідник НБУ недоступний</p>
      <p class="empty-state-lead">Потрібне з’єднання з інтернетом, щоб завантажити офіційний довідник ОВДП.</p>
      <button type="button" class="action primary" data-nbu-refresh>Завантажити довідник</button>
    </div>
  `;
}

function attachNbuCatalogActions(listEl, records) {
  listEl.querySelectorAll('[data-action="calc"]').forEach((btn) => {
    btn.addEventListener('click', (event) => {
      event.stopPropagation();
      const isin = blg.normalizeIsin(btn.getAttribute('data-isin'));
      const record = records.find((entry) => blg.normalizeIsin(entry.isin) === isin);
      if (record) fillCalculatorFromBond(nbuRecordToProposal(record));
    });
  });

  listEl.querySelectorAll('[data-nbu-refresh]').forEach((btn) => {
    btn.addEventListener('click', (event) => {
      event.preventDefault();
      refreshNbuCatalog({ force: true });
    });
  });

  attachExpandRowActions(listEl);
}

function renderBondCalendarList(listEl, titleEl, data = cachedData) {
  const allRecords = bnc.getNbuRecords(data);
  syncCalendarActiveIsins(allRecords, calendarScopeKey(data, allRecords), data);
  const records = applyCalendarActiveFilter(allRecords);
  const ownedIsins = getPortfolioIsins(data, 'all');
  const availabilityIndex = bnc.buildBrokerAvailabilityIndex(
    (data?.proposals || []).filter((bond) => bond.kind !== 'holding'),
  );
  const fetchedAt = data?.nbu_reference?.fetched_at;

  if (titleEl) {
    titleEl.textContent = 'Календар';
  }

  if (!allRecords.length) {
    listEl.innerHTML = emptyNbuListMessage();
    listEl.querySelectorAll('[data-nbu-refresh]').forEach((btn) => {
      btn.addEventListener('click', (event) => {
        event.preventDefault();
        refreshNbuCatalog({ force: true });
      });
    });
    if (!data?.nbu_reference?.count) {
      setScanStatus('Завантаження довідника НБУ…', false, { scanning: true });
      refreshNbuCatalog({ quiet: true }).catch(() => {
        setScanStatus('Не вдалося завантажити довідник НБУ', true);
      });
    }
    return;
  }

  const staleScheduleCache = allRecords.every((record) => !Array.isArray(record.payments) || !record.payments.length);
  if (staleScheduleCache && data?.nbu_reference?.count) {
    refreshNbuCatalog({ quiet: true }).catch(() => {});
  }

  const holdingsQty = buildHoldingsQtyIndex(data, 'all');
  window.renderBondCalendar?.(listEl, {
    records,
    allRecords,
    activeIsins: calendarActiveIsins,
    ownedIsins,
    availabilityIndex,
    holdingsQty,
    bondQty: calendarBondQty,
    onActiveIsinsChange: (isins) => {
      calendarActiveIsins = isins;
      renderBondCalendarList(listEl, titleEl, cachedData);
    },
    onBondQtyChange: (isin, qty) => {
      const key = blg.normalizeIsin(isin);
      if (!key) return;
      calendarBondQty[key] = qty;
      renderBondCalendarList(listEl, titleEl, cachedData);
    },
  });

  const scopeMeta = `${calendarActiveIsins.size} з ${allRecords.length} облігацій`;
  setScanStatus('Календар', false, {
    meta: [scopeMeta, fetchedAt ? `НБУ ${formatScanTime(fetchedAt)}` : null].filter(Boolean).join(' · '),
  });
}

function renderNbuCatalogList(listEl, titleEl, data = cachedData) {
  const allRecords = bnc.getNbuRecords(data);
  const records = bnc.filterNbuRecordsBySearch(allRecords, nbuCatalogSearch);
  const availabilityIndex = bnc.buildBrokerAvailabilityIndex(data?.proposals || []);
  const fetchedAt = data?.nbu_reference?.fetched_at;
  const searchActive = Boolean(nbuCatalogSearch.trim());

  if (titleEl) {
    if (!allRecords.length) {
      titleEl.textContent = 'Довідник НБУ';
    } else if (searchActive) {
      titleEl.textContent = `Довідник НБУ (${records.length} з ${allRecords.length})`;
    } else {
      titleEl.textContent = `Довідник НБУ (${allRecords.length})`;
    }
  }

  if (!allRecords.length) {
    listEl.innerHTML = emptyNbuListMessage();
    attachNbuCatalogActions(listEl, allRecords);
    if (!data?.nbu_reference?.count) {
      setScanStatus('Завантаження довідника НБУ…', false, { scanning: true });
      refreshNbuCatalog({ quiet: true }).catch(() => {
        setScanStatus('Не вдалося завантажити довідник НБУ', true);
      });
    } else {
      setScanStatus('За обраним фільтром облігацій не знайдено');
    }
    return;
  }

  if (!records.length) {
    listEl.innerHTML = '<p class="empty-state">За запитом нічого не знайдено</p>';
    attachNbuCatalogActions(listEl, allRecords);
    setScanStatus('Довідник НБУ', false, {
      meta: fetchedAt ? `Оновлено ${formatScanTime(fetchedAt)}` : undefined,
    });
    return;
  }

  const staleScheduleCache = records.length > 0
    && records.every((record) => !Array.isArray(record.payments) || !record.payments.length);
  if (staleScheduleCache && data?.nbu_reference?.count) {
    refreshNbuCatalog({ quiet: true }).catch(() => {});
  }

  listEl.innerHTML = records.map((record) => nbuBondRowHtml(record, availabilityIndex)).join('');
  attachNbuCatalogActions(listEl, records);
  setScanStatus('Довідник НБУ', false, {
    meta: fetchedAt ? `Оновлено ${formatScanTime(fetchedAt)}` : undefined,
  });
}

async function refreshNbuCatalog(options = {}) {
  const shell = requireShell();
  if (!shell?.refreshNbuReference) return;
  if (!options.quiet) {
    setScanStatus('Оновлення довідника НБУ…', false, { scanning: true });
  }
  try {
    const snapshot = await shell.refreshNbuReference();
    renderBondLists({ ...cachedData, nbu_reference: snapshot });
    if (!options.quiet) {
      setScanStatus(`Довідник НБУ: ${snapshot.count || 0} ОВДП`, false, {
        meta: snapshot.fetched_at ? formatScanTime(snapshot.fetched_at) : undefined,
      });
    }
  } catch (err) {
    if (!options.quiet) {
      setScanStatus(err.message || 'Не вдалося оновити довідник НБУ', true);
    }
    throw err;
  }
}

async function setCatalogViewMode(mode) {
  if (!['available', 'nbu'].includes(mode) || catalogViewMode === mode) return;
  if (mode === 'nbu') {
    availableCatalogSearch = '';
    const availableSearchInput = document.getElementById('available-catalog-search');
    if (availableSearchInput) availableSearchInput.value = '';
  } else {
    nbuCatalogSearch = '';
    const nbuSearchInput = document.getElementById('nbu-catalog-search');
    if (nbuSearchInput) nbuSearchInput.value = '';
  }
  catalogViewMode = mode;
  applyCatalogViewUi();
  if (mode === 'nbu' && !cachedData?.nbu_reference?.count) {
    try {
      await refreshNbuCatalog({ quiet: true });
      return;
    } catch {
      renderBondLists(cachedData);
      return;
    }
  }
  renderBondLists(cachedData);
  if (catalogViewMode === 'available') {
    setScanStatusFromData(cachedData);
  }
}

function siteBadgeHtml(siteId, { failureKind = activeScanFailureKind() } = {}) {
  const failedMessage = getScanFailures(failureKind)[siteId];
  const failedClass = failedMessage ? ' bond-badge-scan-failed' : '';
  const title = failedMessage ? ` title="${blg.escapeHtml(failedMessage)}"` : '';
  return `<span class="bond-badge ${siteBadgeClass(siteId)}${failedClass}"${title}>${SITE_LABELS[siteId] || siteId}</span>`;
}

function siteChipsHtml(listings) {
  const failureKind = isHoldingView() ? 'portfolio' : 'catalog';
  const counts = new Map();
  listings.forEach((bond) => {
    counts.set(bond.site_id, (counts.get(bond.site_id) || 0) + 1);
  });
  return [...counts.entries()].map(([siteId, count]) => {
    const title = count > 1 ? ` title="${count} поз."` : '';
    return `<span class="bond-site-chip-wrap"${title}>${siteBadgeHtml(siteId, { failureKind })}</span>`;
  }).join('');
}

function bondActionKey(bond) {
  return `${bond.site_id}:${bond.isin || ''}:${bond.lot_id || bond.purchase_date || ''}`;
}

function sortPortfolioLots(listings) {
  return [...listings].sort((a, b) => {
    const db = Date.parse(b.purchase_date || '') || 0;
    const da = Date.parse(a.purchase_date || '') || 0;
    if (db !== da) return db - da;
    const siteDiff = SITE_ORDER.indexOf(a.site_id) - SITE_ORDER.indexOf(b.site_id);
    if (siteDiff !== 0) return siteDiff;
    return String(a.lot_id || '').localeCompare(String(b.lot_id || ''), 'uk');
  });
}

function formatPurchaseDateCell(bond) {
  const formatted = window.BondDates?.formatPurchaseDate?.(bond.purchase_date);
  if (!formatted || formatted === '—') return '';
  return blg.escapeHtml(formatted);
}

function activeListKind() {
  if (currentListKind === 'calendar') return 'catalog';
  if (currentListKind === 'holdings' && currentPortfolioView === 'orders') return 'orders';
  return currentListKind;
}

function isPortfolioSection() {
  return currentListKind === 'holdings';
}

function isHoldingView() {
  return isPortfolioSection() && currentPortfolioView === 'positions';
}

function isOrdersView() {
  return isPortfolioSection() && currentPortfolioView === 'orders';
}

function listItemLabel(count = 2) {
  if (isOrdersView()) return 'замовлень';
  return isHoldingView() ? 'позицій' : 'пропозицій';
}

function formatQuantity(qty) {
  if (qty == null || qty === '') return '—';
  const n = typeof qty === 'number'
    ? qty
    : parseFloat(String(qty).replace(/\s/g, '').replace(',', '.'));
  if (!Number.isFinite(n)) return String(qty);
  return n.toLocaleString('uk-UA', { maximumFractionDigits: 4, minimumFractionDigits: 0 });
}

function formatPortfolioValue(bond) {
  if (bond.portfolio_value) {
    return formatBondCostUah({ buy_price: bond.portfolio_value });
  }
  return formatBondCostUah(bond);
}

function holdingMetaBadge(bond) {
  if (bond.kind !== 'holding' || isHoldingView()) return '';
  const qty = bond.quantity
    ? `<span class="bond-badge holding-qty">${blg.escapeHtml(String(bond.quantity))} шт.</span>`
    : '';
  return `<span class="bond-badge holding">Портфель</span>${qty}`;
}

function bondRowChevronHtml() {
  return '<span class="bond-row-chevron" aria-hidden="true"></span>';
}

function bondIdentHtml(isin, title, { expandable = false } = {}) {
  const chevron = expandable ? bondRowChevronHtml() : '';
  return `
    <span class="bond-ident-head">
      ${chevron}
      <span class="bond-isin">${blg.escapeHtml(isin || '—')}</span>
    </span>
    <span class="bond-title">${blg.escapeHtml(title || '')}</span>
  `;
}

function bondRowExpandAttrs(label) {
  return ` data-expand-row tabindex="0" role="button" aria-expanded="false" aria-label="${blg.escapeHtml(label)}"`;
}

function toggleBondCardExpand(card, forceOpen) {
  if (!card) return;
  const panel = card.querySelector('.bond-catalog-expand, .bond-site-offers, .nbu-coupon-panel');
  const row = card.querySelector('[data-expand-row]');
  if (!panel || !row) return;
  const nextOpen = forceOpen !== undefined ? forceOpen : panel.hidden;
  panel.hidden = !nextOpen;
  card.classList.toggle('expanded', nextOpen);
  row.setAttribute('aria-expanded', String(nextOpen));
  syncPanelLayoutSoon();
}

function attachExpandRowActions(listEl) {
  listEl.querySelectorAll('[data-expand-row]').forEach((row) => {
    const toggle = () => {
      const card = row.closest('.bond-card');
      const panel = card?.querySelector('.bond-catalog-expand, .bond-site-offers, .nbu-coupon-panel');
      if (!card || !panel) return;
      toggleBondCardExpand(card, panel.hidden);
    };

    row.addEventListener('click', (event) => {
      if (event.target.closest('button, a, input, select, textarea, label')) return;
      toggle();
    });

    row.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter' && event.key !== ' ') return;
      event.preventDefault();
      toggle();
    });
  });
}

function bestYieldListing(listings) {
  let best = null;
  let bestVal = -Infinity;
  listings.forEach((bond) => {
    const yieldVal = window.BondCalculator?.parseYield?.(bond.yield_percent);
    if (yieldVal != null && yieldVal > bestVal) {
      bestVal = yieldVal;
      best = bond;
    }
  });
  return best;
}

function bestPriceListing(listings) {
  let best = null;
  let bestVal = Infinity;
  listings.forEach((bond) => {
    const priceVal = parseMoneyValue(bond.buy_price);
    if (priceVal != null && priceVal < bestVal) {
      bestVal = priceVal;
      best = bond;
    }
  });
  return best;
}

function bestTotalReturnListing(listings) {
  let best = null;
  let bestVal = -Infinity;
  listings.forEach((bond) => {
    const pct = computeBondTotalReturnPct(bond);
    if (pct != null && pct > bestVal) {
      bestVal = pct;
      best = bond;
    }
  });
  return best;
}

function enrichBondForProjection(bond) {
  if (!bond) return null;
  const { schedule } = resolveBondPaymentScheduleDetailed(bond);
  const isin = blg.normalizeIsin(bond.isin);
  const nbuRef = bond.nbu_reference || cachedData?.nbu_reference?.by_isin?.[isin] || null;
  return {
    ...bond,
    nbu_reference: nbuRef,
    payment_schedule: schedule.length ? schedule : bond.payment_schedule,
  };
}

function computeBondTotalReturnPct(bond) {
  const calc = window.BondCalculator;
  if (!calc?.computeProjection || !calc.toCalculatorFields || !bond) return null;

  const enriched = enrichBondForProjection(bond);
  const schedule = enriched.payment_schedule;
  if (!Array.isArray(schedule) || !schedule.length) return null;

  const fields = calc.toCalculatorFields(enriched);
  if (fields.pricePct == null || fields.pricePct <= 0) return null;
  if (fields.unitPriceUah == null && enriched.site_id === 'privat' && enriched.kind !== 'holding') {
    return null;
  }

  const result = calc.computeProjection({
    nominal: fields.nominal,
    quantity: 1,
    couponRate: fields.couponRate,
    pricePct: fields.pricePct,
    years: fields.years,
    paymentsPerYear: fields.payments,
    maturityDate: fields.maturityDate || deriveScheduleMaturityDate(schedule, enriched),
    paymentSchedule: fields.paymentSchedule || schedule,
    settleDate: new Date(),
  });

  return Number.isFinite(result.totalReturnPct) ? result.totalReturnPct : null;
}

function resolveBondListedYieldType(bond) {
  if (bond?.listed_yield_type) {
    return window.BondCalculator?.normalizeListedYieldTypeLabel?.(bond.listed_yield_type)
      ?? bond.listed_yield_type;
  }
  const enriched = enrichBondForProjection(bond);
  const fields = window.BondCalculator?.toCalculatorFields?.(enriched);
  return fields?.listedYieldType ?? null;
}

function resolveCatalogYieldTypeLabel(listings) {
  const bonds = Array.isArray(listings) ? listings.filter(Boolean) : [listings].filter(Boolean);
  if (!bonds.length) return '—';

  const types = new Set();
  bonds.forEach((bond) => {
    const label = resolveBondListedYieldType(bond);
    if (label) types.add(label);
  });
  if (types.size === 1) return [...types][0];
  if (types.size > 1) {
    if (types.has('YTM')) return 'YTM';
    if (types.has('SIM')) return 'SIM';
  }

  const primary = pickPrimaryListing(bonds);
  return resolveBondListedYieldType(primary) || '—';
}

function catalogBondIdentHtml(isin, listings, { expandable = false } = {}) {
  return bondIdentHtml(isin, resolveCatalogYieldTypeLabel(listings), { expandable });
}

function catalogGroupMetricsColumns(listings, nbuReference = null) {
  if (listings.length <= 1) {
    return bondMetricsColumns(listings[0]);
  }

  const sorted = [...listings].sort(
    (a, b) => SITE_ORDER.indexOf(a.site_id) - SITE_ORDER.indexOf(b.site_id),
  );
  const bestYield = bestYieldListing(listings);
  const bestPrice = bestPriceListing(listings);
  const bestTotalReturn = bestTotalReturnListing(listings);

  const renderLines = (renderValue, bestBond) => sorted.map((bond) => {
    const isBest = bestBond && bond.site_id === bestBond.site_id && (bond.isin || '') === (bestBond.isin || '');
    return `
    <div class="group-metric-line${isBest ? ' is-best-offer' : ''}">
      <span class="bond-badge ${siteBadgeClass(bond.site_id)}">${SITE_LABELS[bond.site_id] || bond.site_id}</span>
      <span class="group-metric-value">${renderValue(bond)}</span>
      ${isBest ? '<span class="best-offer-badge">найкраща</span>' : ''}
    </div>
  `;
  }).join('');

  return {
    yield: renderLines((bond) => formatYieldCell(bond), bestYield),
    price: renderLines((bond) => blg.escapeHtml(formatBondCostUah(bond)), bestPrice),
    totalReturn: renderLines((bond) => formatTotalReturnCell(bond), bestTotalReturn),
    maturity: formatGroupMaturityCell(listings),
  };
}

function holdingValueMetaHtml(bond) {
  if (bond.kind !== 'holding' || !bond.portfolio_value || isHoldingView()) return '';
  return `<span class="bond-portfolio-value">Сума: ${blg.escapeHtml(formatBondCostUah({ buy_price: bond.portfolio_value }))}</span>`;
}

function expandedSiteActions(bond) {
  const isin = bond.isin || '';

  if (bond.kind === 'holding') {
    return `<button type="button" class="action" data-action="site" data-site="${bond.site_id}" data-isin="${isin}">Портфель</button>`;
  }

  const buyDisabled = bond.is_buyable === false ? 'disabled' : '';
  return `<button type="button" class="action primary" data-action="buy" data-site="${bond.site_id}" data-isin="${isin}" ${buyDisabled}>Купити</button>`;
}

function primaryBondActions(bond) {
  const isin = bond.isin || '';
  const key = bondActionKey(bond);
  const buyDisabled = bond.kind === 'holding' || bond.is_buyable === false ? 'disabled' : '';

  if (bond.kind === 'holding') {
    return `
      <button type="button" class="action" data-action="calc" data-key="${key}">Калькулятор</button>
      <button type="button" class="action" data-action="site" data-site="${bond.site_id}" data-isin="${isin}">Портфель</button>
    `;
  }

  return `
    <button type="button" class="action" data-action="calc" data-key="${key}">Калькулятор</button>
    <button type="button" class="action primary" data-action="buy" data-site="${bond.site_id}" data-isin="${isin}" ${buyDisabled}>Купити</button>
  `;
}

function formatYieldCell(bond) {
  const value = formatYieldForBond(bond);
  return value === '—' ? value : blg.escapeHtml(value);
}

function formatTotalReturnCell(bond) {
  const pct = computeBondTotalReturnPct(bond);
  return pct == null ? '—' : blg.escapeHtml(formatProfitPct(pct));
}

function bondMaturityDate(bond) {
  return bond?.maturity_date || bond?.nbu_reference?.maturity_date || null;
}

function bondIssueDate(bond) {
  return bond?.issue_date || bond?.nbu_reference?.issue_date || null;
}

function pickGroupBondDate(listings, pickDate) {
  for (const bond of listings) {
    const refDate = pickDate(bond?.nbu_reference);
    if (refDate) return refDate;
  }
  for (const bond of listings) {
    const date = pickDate(bond);
    if (date) return date;
  }
  return null;
}

function pickGroupMaturityDate(listings) {
  return pickGroupBondDate(listings, (entry) => entry?.maturity_date || null);
}

function pickGroupIssueDate(listings) {
  return pickGroupBondDate(listings, (entry) => entry?.issue_date || null);
}

function formatMaturityDateCell(bond) {
  return blg.escapeHtml(formatMaturityDate(bondMaturityDate(bond)));
}

function formatIssueDateCell(bond) {
  return blg.escapeHtml(formatMaturityDate(bondIssueDate(bond)));
}

function formatGroupMaturityCell(listings) {
  return blg.escapeHtml(formatMaturityDate(pickGroupMaturityDate(listings)));
}

function formatGroupIssueCell(listings) {
  return blg.escapeHtml(formatMaturityDate(pickGroupIssueDate(listings)));
}

function bondMetricsColumns(bond) {
  return {
    yield: formatYieldCell(bond),
    price: blg.escapeHtml(formatBondCostUah(bond)),
    totalReturn: formatTotalReturnCell(bond),
    maturity: formatMaturityDateCell(bond),
  };
}

function catalogSiteOfferHtml(bond) {
  const offerBadge = holdingMetaBadge(bond);
  const buyDisabled = bond.is_buyable === false ? 'disabled' : '';
  const scanFailed = isSiteScanFailed(bond.site_id, 'catalog');
  const failedClass = scanFailed ? ' bond-site-offer-failed' : '';
  const failedTitle = scanFailed
    ? ` title="${blg.escapeHtml(getScanFailures('catalog')[bond.site_id])}"`
    : '';
  const listedType = resolveBondListedYieldType(bond);
  const yieldTypeHint = listedType
    ? ` <span class="bond-yield-type-hint">${blg.escapeHtml(listedType)}</span>`
    : '';
  return `
    <div class="bond-site-offer${failedClass}"${failedTitle}>
      <div class="bond-site-offer-head">
        <span class="bond-badge ${siteBadgeClass(bond.site_id)}">${SITE_LABELS[bond.site_id] || bond.site_id}</span>
        ${offerBadge}
      </div>
      <div class="bond-site-offer-meta">
        ${bondCostMetaHtml(bond)}
        ${holdingValueMetaHtml(bond)}
        <span>Дохідність: ${blg.escapeHtml(formatYieldForBond(bond))}${yieldTypeHint}</span>
        <span>Ціна: ${blg.escapeHtml(formatBondCostUah(bond))}</span>
        <span class="bond-scan-meta">Скан: ${blg.escapeHtml(formatScanTime(bond.scanned_at) || '—')}</span>
      </div>
      <div class="bond-actions bond-actions-inline">
        <button type="button" class="action primary" data-action="buy" data-site="${bond.site_id}" data-isin="${bond.isin || ''}" ${buyDisabled}>Купити</button>
      </div>
    </div>
  `;
}

function catalogExpandedPanelHtml(group) {
  const { listings } = group;
  const nbuRecord = groupNbuRecord(group);
  const schedule = nbuRecord ? bnc.getNbuPaymentSchedule(nbuRecord) : [];
  const siteOffers = listings.map((bond) => catalogSiteOfferHtml(bond)).join('');
  const scheduleHtml = schedule.length
    ? nbuCouponPanelHtml(schedule)
    : '<p class="nbu-coupon-empty">Немає даних про виплати</p>';

  return `
    <div class="bond-catalog-expand" hidden>
      <div class="bond-catalog-expand-layout">
        <div class="bond-catalog-expand-offers">
          <p class="bond-catalog-expand-label">Пропозиції по платформах</p>
          <div class="bond-catalog-expand-offers-list">${siteOffers}</div>
        </div>
        <div class="bond-catalog-expand-schedule">
          <p class="bond-catalog-expand-label">Графік виплат</p>
          ${scheduleHtml}
        </div>
      </div>
    </div>
  `;
}

function portfolioBondMetricsColumns(bond) {
  return {
    qty: blg.escapeHtml(formatQuantity(bond.quantity)),
    yield: formatYieldCell(bond),
    price: blg.escapeHtml(formatBondCostUah(bond)),
    totalValue: blg.escapeHtml(formatPortfolioValue(bond)),
    maturity: formatMaturityDateCell(bond),
    issue: formatIssueDateCell(bond),
  };
}

function portfolioSiteBadge(bond) {
  return siteBadgeHtml(bond.site_id, { failureKind: 'portfolio' });
}

function orderStageBadge(order) {
  const stage = blg.escapeHtml(order.stage || '—');
  const color = String(order.stage_color || '').trim();
  const style = color ? ` style="background-color: ${blg.escapeHtml(color)}"` : '';
  return `<span class="order-stage-badge"${style}>${stage}</span>`;
}

function isUniverOrderPdfAvailable(order) {
  if (order.site_id !== 'univer') return false;
  if (order.document_downloadable) return true;
  return !!String(order.document_id || '').trim();
}

function isUniverOrderAwaitingSignature(order) {
  if (order.site_id !== 'univer') return false;
  const stage = String(order.stage || '').replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim();
  return stage.toLowerCase() === 'підписати';
}

function orderCancelButtonHtml(order) {
  if (!isUniverOrderAwaitingSignature(order)) return '';
  const univerSignedIn = isSiteAuthenticated('univer');
  const disabled = univerSignedIn ? '' : ' disabled';
  const title = univerSignedIn
    ? ' title="Скасувати замовлення на UNIVER"'
    : ' title="Спочатку увійдіть на UNIVER"';
  return `<button type="button" class="action"${disabled}${title} data-action="order-cancel" data-order-id="${blg.escapeHtml(order.order_id || '')}">Скасувати</button>`;
}

function orderDownloadButtonHtml(order) {
  if (!isUniverOrderPdfAvailable(order)) return '';
  const univerSignedIn = isSiteAuthenticated('univer');
  const disabled = univerSignedIn ? '' : ' disabled';
  const title = univerSignedIn
    ? ''
    : ' title="Спочатку увійдіть на UNIVER"';
  return `<button type="button" class="action"${disabled}${title} data-action="order-pdf" data-order-id="${blg.escapeHtml(order.order_id || '')}" data-document-id="${blg.escapeHtml(order.document_id || '')}">PDF</button>`;
}

function pruneExpiredPendingUniverOrders() {
  const cutoff = Date.now() - PENDING_UNIVER_ORDER_TTL_MS;
  pendingUniverOrders = pendingUniverOrders.filter((item) => item.createdAt > cutoff);
}

function dropPendingUniverOrdersPresentIn(proposals) {
  const ids = new Set(
    (proposals || [])
      .map((order) => String(order.order_id || '').trim())
      .filter(Boolean),
  );
  if (!ids.size) return;
  pendingUniverOrders = pendingUniverOrders.filter(
    (item) => !ids.has(String(item.orderId)),
  );
}

function addPendingUniverOrder({ orderId, isin, quantity }) {
  const id = String(orderId || '').trim();
  if (!id) return;
  pruneExpiredPendingUniverOrders();
  pendingUniverOrders = pendingUniverOrders.filter((item) => String(item.orderId) !== id);
  pendingUniverOrders.unshift({
    orderId: id,
    isin: isin ? String(isin).trim().toUpperCase() : '',
    quantity: Math.max(1, Number(quantity) || 1),
    createdAt: Date.now(),
  });
  if (isOrdersView()) {
    renderBondLists(cachedData);
  }
}

function pendingUniverOrdersForDisplay(proposals) {
  pruneExpiredPendingUniverOrders();
  dropPendingUniverOrdersPresentIn(proposals);
  const ids = new Set(
    (proposals || [])
      .map((order) => String(order.order_id || '').trim())
      .filter(Boolean),
  );
  return pendingUniverOrders.filter((item) => !ids.has(String(item.orderId)));
}

function orderGridSkeletonCells() {
  return `
        <div class="bond-col bond-col-order-doc"><span class="skeleton-block skeleton-line short"></span></div>
        <div class="bond-col bond-col-service"><span class="skeleton-block skeleton-line short"></span></div>
        <div class="bond-col bond-col-params"><span class="skeleton-block skeleton-line"></span></div>
        <div class="bond-col bond-col-stage"><span class="skeleton-block skeleton-badge"></span></div>
        <div class="bond-col bond-col-created"><span class="skeleton-block skeleton-line short"></span></div>
        <div class="bond-col bond-col-total"><span class="skeleton-block skeleton-line short"></span></div>
        <div class="bond-col bond-col-badges"><span class="skeleton-block skeleton-badge"></span></div>
        <div class="bond-col bond-col-actions"><span class="skeleton-block skeleton-btn"></span></div>
  `;
}

function pendingOrderCardHtml(pending) {
  const orderId = blg.escapeHtml(String(pending.orderId || ''));
  const paramsHint = pending.isin
    ? blg.escapeHtml(`${pending.isin} × ${pending.quantity || 1}`)
    : '';
  const paramsCol = paramsHint
    ? `<div class="bond-col bond-col-params"><span class="bond-order-pending-params">${paramsHint}</span></div>`
    : '<div class="bond-col bond-col-params"><span class="skeleton-block skeleton-line"></span></div>';
  return `
    <article class="bond-card bond-card-row bond-card-skeleton bond-order-pending" data-pending-order-id="${orderId}">
      <div class="bond-row bond-orders-grid">
        <div class="bond-col bond-col-order-id">
          <span class="bond-isin bond-order-pending-id">${orderId}</span>
          <span class="bond-order-pending-hint">Очікуємо в списку…</span>
        </div>
        <div class="bond-col bond-col-order-doc"><span class="skeleton-block skeleton-line short"></span></div>
        <div class="bond-col bond-col-service"><span class="skeleton-block skeleton-line short"></span></div>
        ${paramsCol}
        <div class="bond-col bond-col-stage"><span class="skeleton-block skeleton-badge"></span></div>
        <div class="bond-col bond-col-created"><span class="skeleton-block skeleton-line short"></span></div>
        <div class="bond-col bond-col-total"><span class="skeleton-block skeleton-line short"></span></div>
        <div class="bond-col bond-col-badges"><span class="skeleton-block skeleton-badge"></span></div>
        <div class="bond-col bond-col-actions"><span class="skeleton-block skeleton-btn"></span></div>
      </div>
    </article>
  `;
}

function orderCardHtml(order) {
  return `
    <article class="bond-card bond-card-row">
      <div class="bond-row bond-orders-grid">
        <div class="bond-col bond-col-order-id">
          <span class="bond-isin">${blg.escapeHtml(order.order_id || '—')}</span>
        </div>
        <div class="bond-col bond-col-order-doc">${blg.escapeHtml(order.document_id || '—')}</div>
        <div class="bond-col bond-col-service">${blg.escapeHtml(order.service_type || '—')}</div>
        <div class="bond-col bond-col-params">${blg.escapeHtml(order.parameters || '—')}</div>
        <div class="bond-col bond-col-stage">${orderStageBadge(order)}</div>
        <div class="bond-col bond-col-created">${blg.escapeHtml(order.created_at || '—')}</div>
        <div class="bond-col bond-col-total">${blg.escapeHtml(order.total || '—')}</div>
        <div class="bond-col bond-col-badges">${portfolioSiteBadge(order)}</div>
        <div class="bond-col bond-col-actions bond-actions bond-row-actions">
          ${orderCancelButtonHtml(order)}
          <button type="button" class="action" data-action="order" data-site="${order.site_id}" data-url="${blg.escapeHtml(order.source_url || '')}">Відкрити</button>
          ${orderDownloadButtonHtml(order)}
        </div>
      </div>
    </article>
  `;
}

function attachOrderActions(listEl, orders) {
  listEl.querySelectorAll('[data-action="order"]').forEach((btn) => {
    btn.addEventListener('click', (event) => {
      event.stopPropagation();
      const siteId = btn.getAttribute('data-site') || 'univer';
      const url = btn.getAttribute('data-url') || '';
      if (url) {
        window.inzhurShell.switchSite(siteId, url);
        return;
      }
      const order = orders.find((item) => String(item.order_id) === btn.closest('.bond-card')?.querySelector('.bond-isin')?.textContent);
      if (order?.source_url) {
        window.inzhurShell.switchSite(siteId, order.source_url);
      }
    });
  });

  listEl.querySelectorAll('[data-action="order-cancel"]').forEach((btn) => {
    btn.addEventListener('click', async (event) => {
      event.stopPropagation();
      const orderId = btn.getAttribute('data-order-id') || '';
      if (!orderId || btn.disabled) return;

      btn.disabled = true;
      const priorLabel = btn.textContent;
      btn.textContent = '…';
      setScanStatus(`Скасування замовлення #${orderId}…`, false, { scanning: true });

      try {
        const result = await window.inzhurShell.cancelUniverOrder(orderId);
        if (!result?.ok) {
          setScanStatus(result?.error || 'Не вдалося скасувати замовлення', true);
          return;
        }
        setScanStatus(`Замовлення #${orderId} скасовано`, false);
      } catch (err) {
        setScanStatus(err?.message || 'Не вдалося скасувати замовлення', true);
      } finally {
        btn.disabled = !isSiteAuthenticated('univer');
        btn.textContent = priorLabel;
      }
    });
  });

  listEl.querySelectorAll('[data-action="order-pdf"]').forEach((btn) => {
    btn.addEventListener('click', async (event) => {
      event.stopPropagation();
      const orderId = btn.getAttribute('data-order-id') || '';
      const documentId = btn.getAttribute('data-document-id') || '';
      if ((!orderId && !documentId) || btn.disabled) return;

      btn.disabled = true;
      const priorLabel = btn.textContent;
      btn.textContent = '…';
      setScanStatus(
        documentId
          ? `Завантаження PDF документа #${documentId}…`
          : `Завантаження PDF для #${orderId}…`,
        false,
        { scanning: true },
      );

      try {
        const result = await window.inzhurShell.downloadUniverOrderPdf(orderId, documentId);
        if (result?.canceled) {
          setScanStatus('');
          return;
        }
        if (!result?.ok) {
          setScanStatus(result?.error || 'Не вдалося завантажити PDF', true);
          return;
        }
        setScanStatus(`PDF збережено: ${result.savedPath}`, false);
      } catch (err) {
        setScanStatus(err?.message || 'Не вдалося завантажити PDF', true);
      } finally {
        btn.disabled = !isSiteAuthenticated('univer');
        btn.textContent = priorLabel;
      }
    });
  });
}

function parseMoneyValue(value) {
  if (value == null || value === '') return null;
  const cleaned = String(value).replace(/[^\d.,-]/g, '').replace(',', '.');
  const n = parseFloat(cleaned);
  return Number.isFinite(n) ? n : null;
}

function portfolioGroupMetrics(listings) {
  let totalQty = 0;
  let hasQty = false;
  let totalValue = 0;
  let hasValue = false;

  listings.forEach((bond) => {
    const qty = typeof bond.quantity === 'number'
      ? bond.quantity
      : parseFloat(String(bond.quantity ?? '').replace(/\s/g, '').replace(',', '.'));
    if (Number.isFinite(qty)) {
      totalQty += qty;
      hasQty = true;
    }

    const portfolioVal = parseMoneyValue(bond.portfolio_value);
    if (portfolioVal != null) {
      totalValue += portfolioVal;
      hasValue = true;
      return;
    }

    const nominal = parseMoneyValue(bond.nominal_value)
      || parseMoneyValue(bond.calculator?.nominal)
      || 1000;
    const unit = parseMoneyValue(bond.calculator?.unitPriceUah)
      ?? parseMoneyValue(window.BondCalculator?.resolveUnitBuyPrice?.(bond, nominal))
      ?? parseMoneyValue(bond.buy_price);
    if (unit != null && Number.isFinite(qty)) {
      totalValue += unit * qty;
      hasValue = true;
    }
  });

  const primary = pickPrimaryListing(listings);
  const primaryMetrics = portfolioBondMetricsColumns(primary);

  return {
    qty: hasQty ? blg.escapeHtml(formatQuantity(totalQty)) : primaryMetrics.qty,
    yield: primaryMetrics.yield,
    price: primaryMetrics.price,
    totalValue: hasValue
      ? blg.escapeHtml(formatBondCostUah({ buy_price: totalValue }))
      : primaryMetrics.totalValue,
    maturity: formatGroupMaturityCell(listings),
    issue: formatGroupIssueCell(listings),
  };
}

function portfolioLotOfferHtml(bond) {
  const metrics = portfolioBondMetricsColumns(bond);
  const purchaseDate = formatPurchaseDateCell(bond);
  const scanFailed = isSiteScanFailed(bond.site_id, 'portfolio');
  const failedClass = scanFailed ? ' bond-site-offer-failed' : '';
  const failedTitle = scanFailed
    ? ` title="${blg.escapeHtml(getScanFailures('portfolio')[bond.site_id])}"`
    : '';

  return `
    <div class="bond-site-offer${failedClass}"${failedTitle}>
      <div class="bond-site-offer-head">
        ${portfolioSiteBadge(bond)}
        ${purchaseDate ? `<span class="bond-lot-date">Купівля: ${purchaseDate}</span>` : ''}
      </div>
      <div class="bond-site-offer-meta">
        <span>Кількість: ${metrics.qty}</span>
        <span>Ціна: ${metrics.price}</span>
        <span class="bond-portfolio-value">Сума: ${metrics.totalValue}</span>
        <span>Дохідність: ${metrics.yield}</span>
      </div>
      <div class="bond-actions bond-actions-inline">${expandedSiteActions(bond)}</div>
    </div>
  `;
}

function portfolioBondCardHtml(group) {
  const listings = sortPortfolioLots(group.listings || []);
  const multi = listings.length > 1;
  const primary = group.primary || listings[0];

  if (!multi) {
    const bond = listings[0];
    const metrics = portfolioBondMetricsColumns(bond);

    return `
      <article class="bond-card bond-card-row">
        <div class="bond-row bond-portfolio-grid">
          <div class="bond-col bond-col-ident">${bondIdentHtml(bond.isin, bond.title)}</div>
          <div class="bond-col bond-col-qty">${metrics.qty}</div>
          <div class="bond-col bond-col-yield">${metrics.yield}</div>
          <div class="bond-col bond-col-price bond-cost">${metrics.price}</div>
          <div class="bond-col bond-col-value">${metrics.totalValue}</div>
          <div class="bond-col bond-col-issue">${metrics.issue}</div>
          <div class="bond-col bond-col-maturity">${metrics.maturity}</div>
          <div class="bond-col bond-col-badges">${portfolioSiteBadge(bond)}</div>
          <div class="bond-col bond-col-actions bond-actions bond-row-actions">${primaryBondActions(bond)}</div>
        </div>
      </article>
    `;
  }

  const siteOffers = listings.map((bond) => portfolioLotOfferHtml(bond)).join('');

  const primaryKey = bondActionKey(primary);
  const metrics = portfolioGroupMetrics(listings);

  const expandLabel = `Окремі позиції (${listings.length})`;

  return `
    <article class="bond-card bond-card-row bond-card-multi bond-card-expandable">
      <div class="bond-row bond-portfolio-grid bond-row-expandable"${bondRowExpandAttrs(expandLabel)}>
        <div class="bond-col bond-col-ident">${bondIdentHtml(group.isin || primary.isin, group.title || primary.title, { expandable: true })}</div>
        <div class="bond-col bond-col-qty">${metrics.qty}</div>
        <div class="bond-col bond-col-yield">${metrics.yield}</div>
        <div class="bond-col bond-col-price bond-cost">${metrics.price}</div>
        <div class="bond-col bond-col-value">${metrics.totalValue}</div>
        <div class="bond-col bond-col-issue">${metrics.issue}</div>
        <div class="bond-col bond-col-maturity">${metrics.maturity}</div>
        <div class="bond-col bond-col-badges">
          <div class="bond-site-chips">${siteChipsHtml(listings)}</div>
        </div>
        <div class="bond-col bond-col-actions bond-actions bond-row-actions bond-actions-shared">
          <button type="button" class="action" data-action="calc" data-key="${primaryKey}">Калькулятор</button>
          <button type="button" class="action" data-action="site" data-site="${primary.site_id}" data-isin="${primary.isin || ''}">Портфель</button>
        </div>
      </div>
      <div class="bond-site-offers" hidden>${siteOffers}</div>
    </article>
  `;
}

function catalogBondColumnsHtml(metrics, extras = {}) {
  const {
    identHtml,
    badgesHtml,
    actionsHtml,
  } = extras;

  return `
    <div class="bond-col bond-col-ident">${identHtml}</div>
    <div class="bond-col bond-col-yield">${metrics.yield}</div>
    <div class="bond-col bond-col-price bond-cost">${metrics.price}</div>
    <div class="bond-col bond-col-total-return">${metrics.totalReturn}</div>
    <div class="bond-col bond-col-maturity">${metrics.maturity}</div>
    <div class="bond-col bond-col-badges">${badgesHtml}</div>
    <div class="bond-col bond-col-actions bond-actions bond-row-actions bond-actions-shared">${actionsHtml}</div>
  `;
}

function catalogBondCardHtml(group) {
  const { listings } = group;
  const multi = listings.length > 1;
  const primary = group.primary || listings[0];
  const buyable = !isHoldingView() && group.is_buyable ? 'buyable' : '';
  const metaBadge = holdingMetaBadge(listings[0]);
  const hasExpand = catalogHasExpandPanel(group);
  const expandLabel = multi ? 'Пропозиції та графік' : 'Графік виплат';

  if (!multi) {
    const bond = listings[0];
    const metrics = bondMetricsColumns(bond);
    const cardClass = hasExpand ? ' bond-card-expandable' : '';

    return `
      <article class="bond-card bond-card-row${cardClass} ${buyable}">
        <div class="bond-row bond-catalog-grid${hasExpand ? ' bond-row-expandable' : ''}"${hasExpand ? bondRowExpandAttrs(expandLabel) : ''}>
          ${catalogBondColumnsHtml(metrics, {
            identHtml: catalogBondIdentHtml(bond.isin, [bond], { expandable: hasExpand }),
            badgesHtml: `
              ${siteBadgeHtml(bond.site_id, { failureKind: 'catalog' })}
              ${metaBadge}
              ${holdingValueMetaHtml(bond)}
            `,
            actionsHtml: primaryBondActions(bond),
          })}
        </div>
        ${hasExpand ? catalogExpandedPanelHtml(group) : ''}
      </article>
    `;
  }

  const primaryKey = `${primary.site_id}:${primary.isin || ''}`;
  const metrics = catalogGroupMetricsColumns(listings, group.nbu_reference);
  const anyBuyable = listings.some((bond) => bond.is_buyable !== false);

  return `
    <article class="bond-card bond-card-row bond-card-multi bond-card-expandable ${buyable}">
      <div class="bond-row bond-catalog-grid bond-row-expandable"${bondRowExpandAttrs(expandLabel)}>
        ${catalogBondColumnsHtml(metrics, {
          identHtml: catalogBondIdentHtml(group.isin || primary.isin, listings, { expandable: true }),
          badgesHtml: `<div class="bond-site-chips">${siteChipsHtml(listings)}</div>`,
          actionsHtml: `
            <button type="button" class="action" data-action="calc" data-key="${primaryKey}">Калькулятор</button>
            <button type="button" class="action primary" data-action="buy-pick" data-isin="${blg.escapeHtml(primary.isin || '')}" ${anyBuyable ? '' : 'disabled'}>Купити</button>
          `,
        })}
      </div>
      ${catalogExpandedPanelHtml(group)}
    </article>
  `;
}

function bondCardHtml(group) {
  if (isHoldingView()) return portfolioBondCardHtml(group);
  return catalogBondCardHtml(group);
}

function attachBondActions(listEl, proposals) {
  attachExpandRowActions(listEl);

  listEl.querySelectorAll('[data-action="calc"]').forEach((btn) => {
    btn.addEventListener('click', (event) => {
      event.stopPropagation();
      const key = btn.getAttribute('data-key');
      const bond = proposals.find((p) => bondActionKey(p) === key)
        || proposals.find((p) => `${p.site_id}:${p.isin}` === key);
      if (bond) fillCalculatorFromBond(bond);
    });
  });

  listEl.querySelectorAll('[data-action="site"]').forEach((btn) => {
    btn.addEventListener('click', (event) => {
      event.stopPropagation();
      const siteId = btn.getAttribute('data-site') || 'inzhur';
      const isin = btn.getAttribute('data-isin') || '';
      const bond = proposals.find((p) => p.site_id === siteId && (p.isin || '') === isin);
      if (bond?.kind === 'holding' && bond.source_url) {
        window.inzhurShell.switchSite(siteId, bond.source_url);
        return;
      }
      if (bond?.kind === 'holding') {
        const openPortfolio = {
          inzhur: () => window.inzhurShell.goInzhurDashboard(),
          univer: () => window.inzhurShell.goUniverPortfolio(),
          privat: () => window.inzhurShell.goPrivatBonds(),
        };
        if (openPortfolio[siteId]) {
          openPortfolio[siteId]();
          return;
        }
      }
      window.inzhurShell.openCatalog(siteId);
    });
  });

  listEl.querySelectorAll('[data-action="buy"]').forEach((btn) => {
    btn.addEventListener('click', async (event) => {
      event.stopPropagation();
      if (btn.disabled) return;
      const siteId = btn.getAttribute('data-site') || 'inzhur';
      const isin = btn.getAttribute('data-isin') || '';
      const bond = proposals.find((p) => p.site_id === siteId && (p.isin || '') === isin);
      if (bond) await window.openBuyDrawer?.(bond);
    });
  });

  listEl.querySelectorAll('[data-action="buy-pick"]').forEach((btn) => {
    btn.addEventListener('click', async (event) => {
      event.stopPropagation();
      if (btn.disabled) return;
      const isin = blg.normalizeIsin(btn.getAttribute('data-isin'));
      const listings = proposals.filter(
        (p) => blg.normalizeIsin(p.isin) === isin && p.kind !== 'holding',
      );
      if (!listings.length) return;
      await window.openPlatformBuyPicker?.(listings);
    });
  });
}

function portfolioTabHintText() {
  if (isOrdersView()) {
    return 'Замовлення доступні лише після входу на UNIVER. Після входу натисніть «Сканувати».';
  }
  if (isHoldingView()) {
    return 'Позиції доступні лише після входу на платформу. Після входу натисніть «Сканувати».';
  }
  return '';
}

function emptyListMessage() {
  const portfolioHint = portfolioTabHintText();
  if (isOrdersView()) {
    return `
      <div class="empty-state-panel">
        <p class="empty-state-title">Немає замовлень</p>
        <p class="empty-state-lead">${portfolioHint || 'Увійдіть на UNIVER і натисніть «Сканувати», щоб завантажити замовлення.'}</p>
        <button type="button" class="action primary portfolio-scan-btn" data-portfolio-scan="all">Сканувати замовлення</button>
      </div>
    `;
  }
  if (isHoldingView()) {
    return `
      <div class="empty-state-panel">
        <p class="empty-state-title">Портфель порожній</p>
        <p class="empty-state-lead">${portfolioHint || 'Увійдіть на платформу і натисніть «Сканувати», щоб завантажити позиції.'}</p>
        <button type="button" class="action primary portfolio-scan-btn" data-portfolio-scan="all">Сканувати портфель</button>
      </div>
    `;
  }
  return `
    <div class="empty-state-panel">
      <p class="empty-state-title">Немає пропозицій</p>
      <p class="empty-state-lead">Увійдіть на Inzhur, UNIVER або Privat і натисніть «Сканувати», щоб завантажити каталог ОВДП.</p>
      <button type="button" class="action primary scan-btn" data-scan="all">Сканувати каталог</button>
    </div>
  `;
}

function loadingSkeletonHtml(rows = 6) {
  const gridClass = isOrdersView()
    ? 'bond-orders-grid'
    : isHoldingView()
      ? 'bond-portfolio-grid'
      : 'bond-catalog-grid';
  return Array.from({ length: rows }, () => {
    if (gridClass === 'bond-orders-grid') {
      return `
    <article class="bond-card bond-card-row bond-card-skeleton">
      <div class="bond-row ${gridClass}">
        <div class="bond-col bond-col-order-id"><span class="skeleton-block skeleton-line"></span></div>
        ${orderGridSkeletonCells()}
      </div>
    </article>
  `;
    }
    return `
    <article class="bond-card bond-card-row bond-card-skeleton">
      <div class="bond-row ${gridClass}">
        <div class="bond-col bond-col-ident"><span class="skeleton-block skeleton-line"></span><span class="skeleton-block skeleton-line short"></span></div>
        <div class="bond-col bond-col-yield"><span class="skeleton-block skeleton-line short"></span></div>
        <div class="bond-col bond-col-price"><span class="skeleton-block skeleton-line short"></span></div>
        ${gridClass === 'bond-catalog-grid' ? `
        <div class="bond-col bond-col-total-return"><span class="skeleton-block skeleton-line short"></span></div>
        <div class="bond-col bond-col-maturity"><span class="skeleton-block skeleton-line short"></span></div>
        ` : ''}
        ${gridClass === 'bond-portfolio-grid' ? `
        <div class="bond-col bond-col-issue"><span class="skeleton-block skeleton-line short"></span></div>
        <div class="bond-col bond-col-maturity"><span class="skeleton-block skeleton-line short"></span></div>
        ` : ''}
        <div class="bond-col bond-col-badges"><span class="skeleton-block skeleton-badge"></span></div>
        <div class="bond-col bond-col-actions"><span class="skeleton-block skeleton-btn"></span></div>
      </div>
    </article>
  `;
  }).join('');
}

function showBondListLoading() {
  const listEl = document.getElementById('bond-list-manual');
  if (!listEl) return;
  if (isCalendarMode()) {
    listEl.innerHTML = '<div class="bond-cal-loading">Завантаження календаря…</div>';
  } else {
    listEl.innerHTML = loadingSkeletonHtml();
  }
  syncPanelLayoutSoon();
}

function applyNbuReference(data = {}) {
  const byIsin = data?.nbu_reference?.by_isin || {};
  if (!Object.keys(byIsin).length) return data;
  const enrich = window.NbuEnrich?.enrichProposals;
  if (!enrich) return data;
  return {
    ...data,
    proposals: enrich(data.proposals || [], byIsin),
  };
}

function renderBondLists(data = cachedData) {
  cachedData = applyNbuReference(data);
  if (!isCalendarMode()) {
    if (data?.listKind) {
      persistListCache(data.listKind, cachedData);
    } else {
      persistListCache(activeListKind(), cachedData);
    }
  }
  window.renderBalanceStrip?.();
  const proposals = filteredProposals(cachedData, currentSource);
  const nbuByIsin = cachedData?.nbu_reference?.by_isin || {};

  const listEl = document.getElementById('bond-list-manual');
  if (!listEl) return;

  const titleEl = document.getElementById('bond-list-title-manual');
  const itemLabel = listItemLabel();

  if (isCalendarMode()) {
    renderBondCalendarList(listEl, titleEl, cachedData);
    syncPanelLayoutSoon();
    return;
  }

  if (isNbuCatalogView()) {
    renderNbuCatalogList(listEl, titleEl, cachedData);
    syncPanelLayoutSoon();
    return;
  }

  if (isOrdersView()) {
    const listTitle = 'Замовлення';
    const pendingRows = pendingUniverOrdersForDisplay(proposals);
    const totalCount = proposals.length + pendingRows.length;
    const countLabel = `${totalCount}`;

    if (titleEl) {
      titleEl.textContent = totalCount ? `${listTitle} (${countLabel})` : listTitle;
    }

    if (!proposals.length && !pendingRows.length) {
      listEl.innerHTML = emptyListMessage();
      syncPanelLayoutSoon();
      return;
    }

    listEl.innerHTML = [
      ...pendingRows.map((pending) => pendingOrderCardHtml(pending)),
      ...proposals.map((order) => orderCardHtml(order)),
    ].join('');
    attachOrderActions(listEl, proposals);
    syncPanelLayoutSoon();
    return;
  }

  const allGroups = sortGroupsForDisplay(groupProposals(proposals, nbuByIsin));
  const searchActive = !isHoldingView() && Boolean(availableCatalogSearch.trim());
  const groups = isHoldingView()
    ? allGroups
    : bnc.filterCatalogGroupsBySearch(allGroups, availableCatalogSearch);

  const countLabel = allGroups.length !== proposals.length
    ? `${allGroups.length} ISIN · ${proposals.length} ${itemLabel}`
    : `${allGroups.length}`;

  const listTitle = isHoldingView() ? 'Портфель' : 'Пропозиції';

  if (titleEl) {
    if (!allGroups.length) {
      titleEl.textContent = listTitle;
    } else if (searchActive && groups.length !== allGroups.length) {
      titleEl.textContent = `${listTitle} (${groups.length} з ${allGroups.length})`;
    } else {
      titleEl.textContent = `${listTitle} (${countLabel})`;
    }
  }

  if (!allGroups.length) {
    listEl.innerHTML = emptyListMessage();
    syncPanelLayoutSoon();
    return;
  }

  if (!groups.length) {
    listEl.innerHTML = '<p class="empty-state">За запитом нічого не знайдено</p>';
    syncPanelLayoutSoon();
    return;
  }

  listEl.innerHTML = groups.map((group) => bondCardHtml(group)).join('');
  attachBondActions(listEl, proposals);
  syncPanelLayoutSoon();
}

function setScanStatus(message, isError = false, options = {}) {
  const el = document.getElementById('scan-status-manual');
  const msgEl = document.getElementById('scan-status-message');
  const metaEl = document.getElementById('scan-status-meta');
  if (!el) return;
  if (!message) {
    el.hidden = true;
    el.classList.remove('error', 'scanning');
    if (metaEl) {
      metaEl.hidden = true;
      metaEl.textContent = '';
      metaEl.innerHTML = '';
    }
    return;
  }
  el.hidden = false;
  el.classList.toggle('error', isError);
  el.classList.toggle('scanning', Boolean(options.scanning));
  if (msgEl) msgEl.textContent = message;
  if (metaEl) {
    if (options.metaHtml) {
      metaEl.innerHTML = options.metaHtml;
      metaEl.hidden = false;
    } else if (options.meta) {
      metaEl.textContent = options.meta;
      metaEl.hidden = false;
    } else {
      metaEl.hidden = true;
      metaEl.textContent = '';
      metaEl.innerHTML = '';
    }
  }
}

function setScanStatusBoth(message, isError = false, options = {}) {
  setScanStatus(message, isError, options);
}

function syncPanelLayoutSoon() {
  requestAnimationFrame(() => {
    window.inzhurShell?.syncLayout?.();
  });
}

function syncToolbarNavActive() {
  const calcOpen = window.isCalcDrawerOpen?.() === true;
  const currentKind = currentListKind;

  document.querySelectorAll('.list-kind-btn[data-list-kind]').forEach((el) => {
    el.classList.toggle('active', !calcOpen && el.dataset.listKind === currentKind);
  });

  document.getElementById('btn-toolbar-calculator')
    ?.classList.toggle('active', calcOpen);
}

function applyPortfolioViewUi() {
  document.querySelectorAll('.portfolio-view-btn').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.portfolioView === currentPortfolioView);
  });

  const bondsPanel = document.getElementById('panel-bonds');
  if (!bondsPanel) return;
  if (currentListKind === 'holdings') {
    bondsPanel.dataset.portfolioView = currentPortfolioView;
  } else {
    delete bondsPanel.dataset.portfolioView;
  }
}

async function switchPortfolioView(view) {
  if (!['positions', 'orders'].includes(view)) return;
  if (!isPortfolioSection() || currentPortfolioView === view) return;

  currentPortfolioView = view;
  applyPortfolioViewUi();

  const cached = hydrateListCache(activeListKind());
  if (cached?.proposals?.length) {
    renderBondLists(cached);
    setScanStatusFromData(cached, { fromCache: true });
  }

  const requestId = ++listKindRequestId;
  try {
    const data = await requireShell().getSecurities('all', activeListKind());
    if (requestId !== listKindRequestId) return;
    renderBondLists(data);
    if (isOrdersView()) {
      if (data.orders_scanned_at) {
        setScanStatusFromData(data, { fromCache: Boolean(data.fromCache) });
      } else {
        setScanStatus(portfolioTabHintText());
      }
    } else if (isHoldingView() && !data.holdings_scanned_at) {
      setScanStatus(portfolioTabHintText());
    }
  } catch (err) {
    if (requestId !== listKindRequestId) return;
    showPanelError(err.message);
  }
  syncPanelLayoutSoon();
}

function applyListKind(listKind) {
  if (!['catalog', 'holdings', 'calendar', 'setup', 'log'].includes(listKind)) return;
  currentListKind = listKind;

  const bondsPanel = document.getElementById('panel-bonds');
  if (bondsPanel) {
    bondsPanel.dataset.listKind = currentListKind;
  }

  syncToolbarNavActive();

  const bondsView = document.getElementById('market-view-bonds');
  const setupView = document.getElementById('market-view-setup');
  const logView = document.getElementById('market-view-log');
  if (bondsView) bondsView.hidden = currentListKind === 'setup' || currentListKind === 'log';
  if (setupView) setupView.hidden = currentListKind !== 'setup';
  if (logView) logView.hidden = currentListKind !== 'log';

  if (currentListKind === 'setup') {
    window.refreshSetupView?.();
  }
  if (currentListKind === 'log') {
    window.loadAutomationData?.();
  }
  if (currentListKind === 'holdings') {
    applyPortfolioViewUi();
  }
  applyCatalogViewUi();
  refreshScanButtonState();
  syncPanelLayoutSoon();
}

function isScanBusy() {
  return localScanBusy || remoteScanBusy;
}

function refreshScanButtonState() {
  const busy = isScanBusy();
  document.querySelectorAll('.scan-btn, .portfolio-scan-btn, .scan-banner-rescan').forEach((btn) => {
    btn.disabled = busy;
  });
}

function portfolioScanAllowed(siteId) {
  if (siteId === 'all') {
    return SITE_ORDER.some((id) => isSiteAuthenticated(id));
  }
  return isSiteAuthenticated(siteId);
}

function setScanBusy(disabled) {
  localScanBusy = disabled;
  syncScanBusyOverlay();
  refreshScanButtonState();
}

function syncScanBusyOverlay() {
  window.BusyOverlay?.set(
    'scan',
    localScanBusy,
    lastScanOverlayMessage || 'Сканування…',
  );
}

async function ensureListKind(listKind) {
  if (listKind === 'setup' || listKind === 'log') {
    applyListKind(listKind);
    return cachedData;
  }
  if (listKind === 'orders') {
    applyListKind('holdings');
    currentPortfolioView = 'orders';
    applyPortfolioViewUi();
    const requestId = ++listKindRequestId;
    const data = await requireShell().getSecurities('all', 'orders');
    if (requestId !== listKindRequestId) return cachedData;
    renderBondLists(data);
    return data;
  }
  if (listKind !== 'catalog' && listKind !== 'holdings') return cachedData;
  applyListKind(listKind);
  const requestId = ++listKindRequestId;
  const data = await requireShell().getSecurities('all', activeListKind());
  if (requestId !== listKindRequestId) return cachedData;
  renderBondLists(data);
  return data;
}

async function switchListKind(listKind) {
  if (!['catalog', 'holdings', 'calendar', 'setup', 'log'].includes(listKind)) return;
  if (listKind === currentListKind) return;

  if (listKind === 'calendar') {
    window.BondCalendar?.reset?.();
    resetCalendarActiveIsins();
  }

  applyListKind(listKind);

  if (listKind === 'setup') {
    window.applyPanelTab?.('bonds');
    requireShell().setPanelTab('bonds');
    return;
  }

  if (listKind === 'log') {
    window.applyPanelTab?.('bonds');
    requireShell().setPanelTab('bonds');
    window.loadBackgroundLog?.();
    return;
  }

  const requestId = ++listKindRequestId;

  try {
    let data;
    if (listKind === 'calendar') {
      data = await loadCalendarData();
    } else {
      data = await requireShell().getSecurities('all', listKind === 'holdings' ? activeListKind() : listKind);
    }
    if (requestId !== listKindRequestId) return;
    renderBondLists(data);
  } catch (err) {
    if (requestId !== listKindRequestId) return;
    showPanelError(err.message);
  }
}

function normalizeSessionStates(states) {
  if (Array.isArray(states)) {
    return Object.fromEntries(states.map((state) => [state.siteId, state]));
  }
  return states || {};
}

function isSiteAuthenticated(siteId) {
  return sessionStates[siteId]?.status === 'authenticated';
}

async function reloadSecuritiesList() {
  if (isCalendarMode()) {
    const data = await loadCalendarData();
    renderBondLists(data);
    return data;
  }
  const shell = requireShell();
  const data = await shell.getSecurities('all', activeListKind());
  renderBondLists(data);
  return data;
}

function mergeBackgroundSecuritiesMeta(data) {
  if (!data) return;
  for (const siteId of SITE_ORDER) {
    if (data[siteId]) {
      cachedData[siteId] = { ...cachedData[siteId], ...data[siteId] };
    }
  }
  if (data.holdings_scanned_at) cachedData.holdings_scanned_at = data.holdings_scanned_at;
  if (data.orders_scanned_at) cachedData.orders_scanned_at = data.orders_scanned_at;
}

async function applyBackgroundSecuritiesUpdate(data) {
  const kind = data?.listKind;
  if (!kind) {
    await reloadSecuritiesList();
    return;
  }

  persistListCache(kind, data);
  mergeBackgroundSecuritiesMeta(data);
  window.renderBalanceStrip?.();

  if (kind === 'holdings' && isHoldingView() && currentPortfolioView === 'positions') {
    renderBondLists(data);
    if (data.holdings_scanned_at) {
      setScanStatusFromData(data);
    }
    return;
  }

  if (kind === 'orders' && isOrdersView()) {
    renderBondLists(data);
    if (data.orders_scanned_at) {
      setScanStatusFromData(data);
    }
    return;
  }
}

const SCAN_LABELS = {
  all: 'усі сайти',
  inzhur: 'Inzhur',
  univer: 'UNIVER',
  privat: 'Privat',
};

function runScanBySite(siteId) {
  const shell = requireShell();
  const scanFns = {
    all: () => shell.scanAllCatalogs(),
    inzhur: () => shell.scanInzhurCatalog(),
    univer: () => shell.scanUniverCatalog(),
    privat: () => shell.scanPrivatCatalog(),
  };
  const scanFn = scanFns[siteId];
  if (!scanFn) return;
  runScan(SCAN_LABELS[siteId] || siteId, scanFn, 'catalog', siteId);
}

function setBackgroundScanHint(message) {
  setScanStatusBoth(message || 'Оновлення каталогу в фоні…', false, {
    scanning: true,
    metaHtml: `<div class="scan-site-rows">${buildScanSiteRowsMeta(cachedData)}</div>`,
  });
}

const PORTFOLIO_SCAN_LABELS = {
  all: 'усі сайти',
  inzhur: 'Inzhur',
  univer: 'UNIVER',
  privat: 'Privat',
};

function runPortfolioScanBySite(siteId) {
  if (isOrdersView()) {
    if (siteId !== 'all' && siteId !== 'univer') {
      setScanStatusBoth('Замовлення доступні лише для UNIVER', true);
      return;
    }
    if (!isSiteAuthenticated('univer')) {
      setScanStatusBoth('Спочатку увійдіть на UNIVER', true);
      return;
    }
    runScan('замовлення UNIVER', () => requireShell().scanUniverOrders(), 'orders');
    return;
  }

  if (!portfolioScanAllowed(siteId)) {
    setScanStatusBoth('Спочатку увійдіть на платформу (зелена точка в toolbar)', true);
    return;
  }
  const shell = requireShell();
  const scanFns = {
    all: () => shell.scanAllPortfolios(),
    inzhur: () => shell.scanInzhurPortfolio(),
    univer: () => shell.scanUniverPortfolio(),
    privat: () => shell.scanPrivatPortfolio(),
  };
  const scanFn = scanFns[siteId];
  if (!scanFn) return;
  runScan(`портфель ${PORTFOLIO_SCAN_LABELS[siteId] || siteId}`, scanFn, 'holdings', siteId);
}

function applySourceFilter(source) {
  if (!['all', 'inzhur', 'univer', 'privat'].includes(source)) return;
  currentSource = source;
  const select = document.getElementById('source-filter');
  if (select && select.value !== source) {
    select.value = source;
    window.StyledSelect?.get('source-filter')?.refresh();
  }
  renderBondLists(cachedData);
  window.renderBalanceStrip?.();
  syncPanelLayoutSoon();
}

async function navigateToPortfolioSource(siteId) {
  if (!['inzhur', 'univer', 'privat'].includes(siteId)) return;
  if (currentListKind !== 'holdings') {
    await switchListKind('holdings');
  }
  if (currentPortfolioView !== 'positions') {
    await switchPortfolioView('positions');
  }
  applySourceFilter(siteId);
}

async function navigateToOrdersAfterUniverBuy() {
  if (currentListKind !== 'holdings') {
    await switchListKind('holdings');
  }
  if (currentPortfolioView !== 'orders') {
    await switchPortfolioView('orders');
  } else {
    renderBondLists(cachedData);
  }
}

function wireSidePanelActions() {
  document.querySelectorAll('.list-kind-btn[data-list-kind]').forEach((btn) => {
    btn.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      switchListKind(btn.dataset.listKind || 'catalog');
    });
  });

  document.querySelectorAll('.portfolio-view-btn').forEach((btn) => {
    btn.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      switchPortfolioView(btn.dataset.portfolioView || 'positions');
    });
  });

  document.getElementById('source-filter')?.addEventListener('change', (event) => {
    currentSource = event.target.value || 'all';
    renderBondLists(cachedData);
    syncPanelLayoutSoon();
  });

  document.querySelectorAll('.catalog-view-btn').forEach((btn) => {
    btn.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      setCatalogViewMode(btn.dataset.catalogView || 'available');
    });
  });

  document.querySelectorAll('.bond-col-sort[data-sort-key]').forEach((btn) => {
    btn.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      toggleListSort(btn.dataset.sortKey || '');
    });
  });

  document.getElementById('nbu-catalog-search')?.addEventListener('input', (event) => {
    nbuCatalogSearch = event.target.value || '';
    if (!isNbuCatalogView()) return;
    renderNbuCatalogList(
      document.getElementById('bond-list-manual'),
      document.getElementById('bond-list-title-manual'),
      cachedData,
    );
    syncPanelLayoutSoon();
  });

  document.getElementById('available-catalog-search')?.addEventListener('input', (event) => {
    availableCatalogSearch = event.target.value || '';
    if (isNbuCatalogView() || isHoldingView() || isCalendarMode()) return;
    renderBondLists(cachedData);
  });

  document.querySelectorAll('[data-nbu-refresh]').forEach((btn) => {
    btn.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      refreshNbuCatalog();
    });
  });

  const panel = document.getElementById('cabinet-screen');
  if (!panel) return;

  panel.addEventListener('click', (event) => {
    const rescanCatalog = event.target.closest('#scan-status-rescan-catalog');
    if (rescanCatalog && !rescanCatalog.disabled) {
      event.preventDefault();
      runScanBySite('all');
      return;
    }

    const rescanPortfolio = event.target.closest('#scan-status-rescan-portfolio');
    if (rescanPortfolio && !rescanPortfolio.disabled) {
      event.preventDefault();
      runPortfolioScanBySite('all');
      return;
    }

    const rescanBtn = event.target.closest('#scan-status-rescan');
    if (rescanBtn && !rescanBtn.disabled) {
      event.preventDefault();
      if (isPortfolioSection() || isCalendarMode()) {
        runPortfolioScanBySite('all');
      } else {
        runScanBySite('all');
      }
      return;
    }

    const portfolioScanBtn = event.target.closest('.portfolio-scan-btn');
    if (portfolioScanBtn && !portfolioScanBtn.disabled) {
      event.preventDefault();
      runPortfolioScanBySite(portfolioScanBtn.dataset.portfolioScan);
      return;
    }

    const scanBtn = event.target.closest('.scan-btn');
    if (scanBtn && !scanBtn.disabled) {
      event.preventDefault();
      runScanBySite(scanBtn.dataset.scan);
    }
  });
}

function formatScanSiteLabel(siteId) {
  return SCAN_LABELS[siteId] || PORTFOLIO_SCAN_LABELS[siteId] || siteId;
}

function formatPartialScanFailures(scanResult) {
  if (!scanResult?.errors?.length) return null;
  const failedSites = scanResult.errors
    .map((entry) => formatScanSiteLabel(entry.siteId))
    .join(', ');
  return `Помилки: ${failedSites}`;
}

async function runScan(label, scanFn, listKind = activeListKind(), scanSiteId = 'all', { background = false } = {}) {
  setScanBusy(true);
  lastScanOverlayMessage = `Сканування ${label}…`;
  syncScanBusyOverlay();
  if (background) {
    setBackgroundScanHint(lastScanOverlayMessage);
  } else {
    showBondListLoading();
    setScanStatusBoth(lastScanOverlayMessage, false, { scanning: true });
  }
  try {
    const stayInCalendar = isCalendarMode();
    if (!stayInCalendar) {
      await ensureListKind(listKind);
    }
    const shell = requireShell();
    const scanResult = await scanFn();
    updateScanFailures(listKind, scanResult);
    const fetchKind = listKind === 'holdings' ? activeListKind() : listKind;
    const result = stayInCalendar
      ? await loadCalendarData()
      : await shell.getSecurities('all', fetchKind);
    renderBondLists(result);
    const proposals = filteredProposals(cachedData, currentSource);
    const partialFailure = formatPartialScanFailures(scanResult);
    const allFailed = scanResult?.results?.length === 0 && scanResult?.errors?.length;

    if (fetchKind === 'orders') {
      const allFailed = scanResult?.results?.length === 0 && scanResult?.errors?.length;
      if (allFailed) {
        setScanStatusBoth(
          partialFailure || 'Помилка сканування',
          true,
          { metaHtml: `<div class="scan-site-rows">${buildScanSiteRowsMeta(result)}</div>` },
        );
        return;
      }
      setScanStatusBoth(
        partialFailure
          ? `Оновлено ${proposals.length} замовлень (${label}). ${partialFailure}`
          : `Оновлено ${proposals.length} замовлень (${label})`,
        !!partialFailure,
        { metaHtml: `<div class="scan-site-rows">${buildScanSiteRowsMeta(result)}</div>` },
      );
      return;
    }

    const groups = groupProposals(proposals, cachedData?.nbu_reference?.by_isin || {});
    const itemLabel = fetchKind === 'holdings' ? 'позицій' : 'пропозицій';
    const countLabel = groups.length !== proposals.length
      ? `${groups.length} ISIN (${proposals.length} ${itemLabel})`
      : `${groups.length} ${itemLabel}`;
    const scanTime = fetchKind === 'holdings'
      ? (result.holdings_scanned_at || result.scanned_at)
      : result.scanned_at;
    if (allFailed) {
      setScanStatusBoth(
        partialFailure || 'Помилка сканування',
        true,
        { metaHtml: `<div class="scan-site-rows">${buildScanSiteRowsMeta(result)}</div>` },
      );
    } else {
      setScanStatusBoth(
        partialFailure
          ? `Оновлено ${countLabel} (${label}). ${partialFailure}`
          : `Оновлено ${countLabel} (${label})`,
        !!partialFailure,
        { metaHtml: `<div class="scan-site-rows">${buildScanSiteRowsMeta(result)}</div>` },
      );
    }
    if (!background && fetchKind === 'catalog') {
      refreshNbuCatalog({ quiet: true }).catch(() => {});
    }
  } catch (err) {
    if (scanSiteId !== 'all') {
      setScanFailure(listKind, scanSiteId, err.message || 'Помилка сканування');
    }
    setScanStatusBoth(err.message || 'Помилка сканування', true, {
      metaHtml: `<div class="scan-site-rows">${buildScanSiteRowsMeta(cachedData)}</div>`,
    });
    renderBondLists(cachedData);
  } finally {
    setScanBusy(false);
    window.renderBalanceStrip?.();
  }
}

function requireShell() {
  if (!window.inzhurShell) {
    throw new Error('Панель не підключена до програми — перезапустіть застосунок');
  }
  return window.inzhurShell;
}

function showPanelError(message) {
  const listEl = document.getElementById('bond-list-manual');
  if (listEl) {
    listEl.innerHTML = `<p class="empty-state">${message}</p>`;
  }
  setScanStatus(message, true);
}

document.querySelectorAll('#drawer-calc input, #drawer-calc select').forEach((el) => {
  el.addEventListener('input', calculate);
  el.addEventListener('change', calculate);
});

wireSidePanelActions();

window.initDeskUi?.({
  getCachedData: () => cachedData,
  getSessionStates: () => sessionStates,
  getOnboardingState: () => onboardingAppState,
  setScanStatus,
  requireShell,
  isSiteAuthenticated,
  refreshSessionStates: async () => {
    sessionStates = normalizeSessionStates(await requireShell().getSessionStates());
    refreshScanButtonState();
    window.renderBalanceStrip?.();
  },
  onFilterSource: (siteId) => {
    applySourceFilter(siteId);
  },
  onBalanceChipClick: (siteId) => {
    navigateToPortfolioSource(siteId);
  },
  getCurrentSource: () => currentSource,
  getScanFailures: () => getScanFailures(activeScanFailureKind()),
  runPortfolioRefresh: () => {
    if (SITE_ORDER.some((id) => isSiteAuthenticated(id))) {
      runPortfolioScanBySite('all');
    } else {
      setScanStatus('Спочатку увійдіть на платформу', true);
    }
  },
});

try {
  const shell = requireShell();

  shell.onPendingUniverOrder?.((payload) => {
    addPendingUniverOrder(payload || {});
  });

  shell.onNbuReferenceUpdated?.((snapshot) => {
    if (!snapshot?.count) return;
    const next = { ...cachedData, nbu_reference: snapshot };
    renderBondLists(next);
    if (isNbuCatalogView()) {
      setScanStatus('Довідник НБУ', false, {
        meta: snapshot.fetched_at ? formatScanTime(snapshot.fetched_at) : undefined,
      });
    } else if (isCalendarMode()) {
      renderBondCalendarList(
        document.getElementById('bond-list-manual'),
        document.getElementById('bond-list-title-manual'),
        next,
      );
    }
  });

  shell.onSecuritiesUpdated(async (data) => {
    try {
      if (data?.fromCache) {
        const kind = data.listKind || activeListKind();
        persistListCache(kind, data);
        if (kind === 'holdings' || kind === 'orders') {
          mergeBackgroundSecuritiesMeta(data);
          window.renderBalanceStrip?.();
        }
        const relevant = kind === activeListKind()
          || (isCalendarMode() && (kind === 'holdings' || kind === 'catalog'));
        if (relevant) {
          if (isCalendarMode()) {
            const merged = await loadCalendarData();
            renderBondLists(merged);
          } else {
            renderBondLists(data);
            setScanStatusFromData(data, { fromCache: true });
          }
        }
        return;
      }
      if (data?.listKind === 'holdings' || data?.listKind === 'orders') {
        await applyBackgroundSecuritiesUpdate(data);
        return;
      }
      await reloadSecuritiesList();
      if (remoteScanBusy && !localScanBusy) {
        setBackgroundScanHint(lastScanOverlayMessage);
      }
    } catch (err) {
      setScanStatus(err.message || 'Помилка оновлення списку', true);
    }
  });

  shell.onScanState(({ scanning, message, scanKind, summary }) => {
    remoteScanBusy = Boolean(scanning);
    if (scanning && message) {
      lastScanOverlayMessage = message;
      if (!localScanBusy) {
        setBackgroundScanHint(message);
      }
    } else if (!scanning && !localScanBusy) {
      if (scanKind === 'catalog' && summary) {
        updateScanFailures('catalog', summary);
      }
      if (cachedData?.proposals?.length || summary?.results?.length) {
        const partialFailure = formatPartialScanFailures(summary);
        if (partialFailure) {
          setScanStatusBoth(`Каталог оновлено. ${partialFailure}`, true, {
            metaHtml: `<div class="scan-site-rows">${buildScanSiteRowsMeta(cachedData)}</div>`,
          });
        } else {
          setScanStatusFromData(cachedData);
        }
      }
    }
    syncScanBusyOverlay();
    refreshScanButtonState();
  });

  shell.onSessionStates((states) => {
    sessionStates = normalizeSessionStates(states);
    refreshScanButtonState();
    window.renderBalanceStrip?.();
    if (isOrdersView()) {
      renderBondLists(cachedData);
    }
  });

  shell.getSessionStates().then((states) => {
    sessionStates = normalizeSessionStates(states);
    refreshScanButtonState();
  }).catch(() => {});

  shell.getOnboardingState().then((state) => {
    onboardingAppState = state;
  }).catch(() => {});

  shell.onOnboardingState((state) => {
    onboardingAppState = state;
  });

  shell.onOpenCalcDrawer?.(() => {
    window.openCalcDrawerFree?.();
  });

  applyListKind(currentListKind);
  applyPortfolioViewUi();
  applyCatalogViewUi();

  const cachedLists = hydrateListCache(activeListKind());
  if (cachedLists?.proposals?.length) {
    renderBondLists(cachedLists);
    setScanStatusFromData(cachedLists, { fromCache: true });
  }

  shell.getScanState?.().then(({ scanning }) => {
    remoteScanBusy = Boolean(scanning);
    if (scanning && !localScanBusy) {
      setBackgroundScanHint(lastScanOverlayMessage);
    }
    syncScanBusyOverlay();
    refreshScanButtonState();
  }).catch(() => {});

  shell.getSecurities('all', activeListKind()).then((data) => {
    if (localScanBusy) return;
    renderBondLists(data);
    if (!remoteScanBusy) {
      setScanStatusFromData(data);
    }
  }).catch((err) => {
    if (localScanBusy) return;
    showPanelError(err.message);
  });

  setTimeout(syncPanelLayoutSoon, 100);
  setTimeout(syncPanelLayoutSoon, 400);
} catch (err) {
  showPanelError(err.message);
}

calculate();
if (window.wireAutomationPanel) {
  try {
    window.wireAutomationPanel();
  } catch (err) {
    showPanelError(err.message);
  }
}

window.switchListKind = switchListKind;
window.registerPendingUniverOrder = addPendingUniverOrder;
window.navigateToOrdersAfterUniverBuy = navigateToOrdersAfterUniverBuy;
window.getCurrentSource = () => currentSource;
window.applySourceFilter = applySourceFilter;
window.setScanStatus = setScanStatus;
window.getCurrentListKind = () => currentListKind;
window.syncToolbarNavActive = syncToolbarNavActive;
