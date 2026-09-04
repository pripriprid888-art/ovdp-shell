let currentSource = 'all';
let currentListKind = 'catalog';
let currentPortfolioView = 'positions';
let sessionStates = {};
let onboardingAppState = { sites: {} };
let cachedData = { proposals: [], inzhur: {}, univer: {} };
let localScanBusy = false;
let remoteScanBusy = false;
let lastScanOverlayMessage = '';
let listKindRequestId = 0;
let calculatorBond = null;

function formatMoney(n) {
  return n.toLocaleString('uk-UA', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function formatPct(n) {
  return formatPctCompact(n).replace(/ %$/, '');
}

function setOut(id, text) {
  const el = document.getElementById(id);
  if (el) el.textContent = text;
}

function renderCashFlows(cashFlows = []) {
  const body = document.getElementById('calc-cashflows-body');
  if (!body) return;
  if (!cashFlows.length) {
    body.innerHTML = '<tr><td colspan="3" class="calc-cashflows-empty">Немає майбутніх виплат для обраних параметрів.</td></tr>';
    return;
  }
  body.innerHTML = cashFlows.map((flow) => {
    const amountClass = flow.amount < 0 ? 'calc-flow-out' : 'calc-flow-in';
    const sign = flow.amount < 0 ? '−' : '+';
    return `
      <tr>
        <td>${escapeHtml(flow.dateLabel || formatMaturityDate(flow.date))}</td>
        <td>${escapeHtml(flow.label || '—')}</td>
        <td class="${amountClass}">${sign}${formatMoney(Math.abs(flow.amount))} ₴</td>
      </tr>
    `;
  }).join('');
}

function calculate() {
  const calc = window.BondCalculator;
  if (!calc) return;

  const paymentsEl = document.getElementById('payments');
  const maturityInput = document.getElementById('calc-maturity-date');
  const result = calc.computeProjection({
    nominal: parseFloat(document.getElementById('nominal')?.value) || 0,
    quantity: parseFloat(document.getElementById('quantity')?.value) || 0,
    couponRate: parseFloat(document.getElementById('coupon-rate')?.value) || 0,
    pricePct: parseFloat(document.getElementById('price-pct')?.value) || 0,
    years: parseFloat(document.getElementById('years')?.value) || 0,
    paymentsPerYear: parseInt(paymentsEl?.value, 10) || 1,
    maturityDate: maturityInput?.value || calculatorBond?.maturity_date || null,
    paymentSchedule: calculatorBond?.payment_schedule || null,
    settleDate: new Date(),
  });

  setOut('out-purchase', `${formatMoney(result.purchaseTotal)} ₴`);
  setOut('out-coupon-payment', `${formatMoney(result.couponPerPayment)} ₴`);
  setOut('out-annual', `${formatMoney(result.annualCoupon)} ₴`);
  setOut('out-total-coupons', `${formatMoney(result.totalCoupons)} ₴`);
  setOut('out-capital', `${formatMoney(result.capitalGainAbs)} ₴`);
  setOut('out-capital-pct', `${formatPct(result.capitalGainPctOfPurchase)} %`);
  setOut('out-total', `${formatMoney(result.totalReturn)} ₴`);
  setOut('out-ytm', `${formatPct(result.ytm)} %`);
  setOut('out-current-yield', `${formatPct(result.simpleYield ?? result.currentYield)} %`);
  setOut('out-total-return-pct', `${formatPct(result.totalReturnPct)} %`);
  setOut('out-annualized-return', `${formatPct(result.annualizedReturnPct)} %`);
  renderCashFlows(result.cashFlows);
}

function resolveCalculatorFields(bond) {
  if (window.BondCalculator?.toCalculatorFields) {
    return window.BondCalculator.toCalculatorFields(bond);
  }
  const fields = bond.calculator || {};
  const listedYtm = fields.listedYtm ?? window.BondCalculator?.parseYield?.(bond.yield_percent) ?? null;
  const couponRate = fields.couponRate > 0 ? fields.couponRate : (listedYtm ?? 0);
  return { ...fields, listedYtm, couponRate };
}

function fillCalculatorFields(bond) {
  calculatorBond = bond || null;
  const fields = bond ? resolveCalculatorFields(bond) : {};
  const isinEl = document.getElementById('calc-isin');
  if (isinEl) isinEl.textContent = bond?.isin || '—';

  if (bond) {
    document.getElementById('nominal').value = fields.nominal ?? 1000;
    document.getElementById('quantity').value = fields.quantity ?? 1;
    document.getElementById('coupon-rate').value = fields.couponRate ?? 0;
    document.getElementById('price-pct').value = fields.pricePct ?? 100;
    document.getElementById('years').value = fields.years ?? 1;
    document.getElementById('payments').value = String(fields.payments ?? 2);
    window.StyledSelect?.get('payments')?.refresh();
  }

  const maturityInput = document.getElementById('calc-maturity-date');
  if (maturityInput) {
    maturityInput.value = bond && fields.maturityDate
      ? (window.BondDates?.toDateInputValue?.(fields.maturityDate) || '')
      : '';
  }

  const listedNote = document.getElementById('calc-listed-ytm');
  if (listedNote) {
    if (fields.listedYtm != null && fields.listedYtm > 0 && bond?.site_id !== 'privat') {
      listedNote.hidden = false;
      const typeLabel = fields.listedYieldType ? ` (${fields.listedYieldType})` : '';
      listedNote.textContent = fields.couponFromListedYtm
        ? `Дохідність з каталогу${typeLabel}: ${formatPct(fields.listedYtm)} % — підставлено як орієнтир для купонної ставки.`
        : `Дохідність з каталогу${typeLabel}: ${formatPct(fields.listedYtm)} % — для порівняння з розрахунком нижче.`;
    } else {
      listedNote.hidden = true;
    }
  }

  const couponHint = document.getElementById('calc-coupon-hint');
  if (couponHint) {
    couponHint.hidden = Boolean(fields.couponRate);
    couponHint.textContent = fields.couponRate
      ? ''
      : 'Купонну ставку не знайдено в даних — вкажіть вручну (дохідність з каталогу ≠ купон).';
  }

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

function setScanStatusFromData(data, { fromCache = false } = {}) {
  const scanTime = scanTimeForActiveView(data);
  if (scanTime) {
    const prefix = fromCache ? 'Кеш · ' : '';
    if (isOrdersView()) {
      setScanStatus(`${prefix}Замовлення: ${formatScanTime(scanTime)}`);
      return;
    }
    if (isHoldingView()) {
      setScanStatus(`${prefix}Портфель: ${formatScanTime(scanTime)}`);
      return;
    }
    const inzhurTime = data.inzhur?.scanned_at;
    const univerTime = data.univer?.scanned_at;
    const privatTime = data.privat?.scanned_at;
    if (inzhurTime || univerTime || privatTime) {
      const parts = [];
      if (inzhurTime) parts.push(`Inzhur: ${formatScanTime(inzhurTime)}`);
      if (univerTime) parts.push(`UNIVER: ${formatScanTime(univerTime)}`);
      if (privatTime) parts.push(`Privat: ${formatScanTime(privatTime)}`);
      setScanStatus(`${prefix}${parts.join(' · ')}`);
      return;
    }
    setScanStatus(`${prefix}Каталог: ${formatScanTime(scanTime)}`);
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

function normalizeIsin(isin) {
  return String(isin || '').trim().toUpperCase();
}

function siteBadgeClass(siteId) {
  if (siteId === 'univer') return 'source-univer';
  if (siteId === 'privat') return 'source-privat';
  return 'source-inzhur';
}

function escapeHtml(text) {
  return String(text ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function pickPrimaryListing(listings) {
  let pool = listings;
  if (currentSource !== 'all') {
    pool = listings.filter((bond) => bond.site_id === currentSource);
  }
  if (!pool.length) pool = listings;

  const ordered = [...pool].sort((a, b) => {
    const scannedDiff = (Date.parse(b.scanned_at || 0) || 0) - (Date.parse(a.scanned_at || 0) || 0);
    if (scannedDiff !== 0) return scannedDiff;
    return SITE_ORDER.indexOf(a.site_id) - SITE_ORDER.indexOf(b.site_id);
  });
  return ordered.find((bond) => bond.is_buyable) || ordered[0];
}

function pickGroupTitle(listings, primary) {
  const pick = primary || pickPrimaryListing(listings);
  const isin = pick?.isin || listings[0]?.isin;
  const genericTitle = /^державні облігації/i.test(String(pick?.title || '').trim());
  if (pick?.title && !genericTitle) return pick.title;
  if (isin) return `ОВДП ${isin}`;
  return pick?.title || '—';
}

function groupProposals(proposals) {
  const groups = new Map();

  proposals.forEach((bond, index) => {
    const isin = normalizeIsin(bond.isin);
    const key = isin || `__missing__:${bond.site_id}:${index}`;
    if (!groups.has(key)) {
      groups.set(key, { isin: isin || null, listings: [] });
    }
    groups.get(key).listings.push(bond);
  });

  return [...groups.values()]
    .map((group) => {
      group.listings.sort(
        (a, b) => SITE_ORDER.indexOf(a.site_id) - SITE_ORDER.indexOf(b.site_id),
      );
      group.primary = pickPrimaryListing(group.listings);
      group.title = pickGroupTitle(group.listings, group.primary);
      group.is_buyable = group.listings.some((bond) => bond.is_buyable);
      return group;
    })
    .sort((a, b) => String(a.isin || a.title).localeCompare(String(b.isin || b.title), 'uk'));
}

function formatUniqueValues(values, fallback = '—') {
  const unique = [...new Set(values.filter(Boolean))];
  if (!unique.length) return fallback;
  if (unique.length === 1) return unique[0];
  return unique.join(' / ');
}

function siteChipsHtml(listings) {
  return listings.map((bond) => (
    `<span class="bond-badge ${siteBadgeClass(bond.site_id)}">${SITE_LABELS[bond.site_id] || bond.site_id}</span>`
  )).join('');
}

function activeListKind() {
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
    ? `<span class="bond-badge holding-qty">${escapeHtml(String(bond.quantity))} шт.</span>`
    : '';
  return `<span class="bond-badge holding">Портфель</span>${qty}`;
}

function multiGroupBadge(group) {
  if (isHoldingView()) {
    return `<span class="bond-badge holding">${group.listings.length} поз.</span>`;
  }
  if (group.listings.length > 1) {
    return `<span class="bond-badge muted">${group.listings.length} платф.</span>`;
  }
  return '';
}

function catalogGroupMetricsColumns(listings) {
  if (listings.length <= 1) {
    return bondMetricsColumns(listings[0]);
  }

  const sorted = [...listings].sort(
    (a, b) => SITE_ORDER.indexOf(a.site_id) - SITE_ORDER.indexOf(b.site_id),
  );

  const renderLines = (renderValue) => sorted.map((bond) => `
    <div class="group-metric-line">
      <span class="bond-badge ${siteBadgeClass(bond.site_id)}">${SITE_LABELS[bond.site_id] || bond.site_id}</span>
      <span class="group-metric-value">${renderValue(bond)}</span>
    </div>
  `).join('');

  return {
    yield: renderLines((bond) => formatYieldCell(bond)),
    price: renderLines((bond) => escapeHtml(formatBondCostUah(bond))),
    maturity: renderLines((bond) => escapeHtml(formatMaturityDate(bond.maturity_date))),
  };
}

function holdingValueMetaHtml(bond) {
  if (bond.kind !== 'holding' || !bond.portfolio_value || isHoldingView()) return '';
  return `<span class="bond-portfolio-value">Сума: ${escapeHtml(formatBondCostUah({ buy_price: bond.portfolio_value }))}</span>`;
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
  const key = `${bond.site_id}:${isin}`;
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
  if (value === '—') return value;

  if (bond.site_id === 'privat') {
    return escapeHtml(value);
  }

  const yieldType = bond.calculator?.listedYieldType
    || window.BondCalculator?.inferListedYieldType?.(bond);
  if (!yieldType) return escapeHtml(value);
  return `
    <span class="yield-cell">
      <span class="yield-cell-value">${escapeHtml(value)}</span>
      <span class="yield-type-badge yield-type-${yieldType.toLowerCase()}">${yieldType}</span>
    </span>
  `;
}

function bondMetricsColumns(bond) {
  return {
    yield: formatYieldCell(bond),
    price: escapeHtml(formatBondCostUah(bond)),
    maturity: escapeHtml(formatMaturityDate(bond.maturity_date)),
  };
}

function portfolioBondMetricsColumns(bond) {
  return {
    qty: escapeHtml(formatQuantity(bond.quantity)),
    yield: formatYieldCell(bond),
    price: escapeHtml(formatBondCostUah(bond)),
    totalValue: escapeHtml(formatPortfolioValue(bond)),
    maturity: escapeHtml(formatMaturityDate(bond.maturity_date)),
  };
}

function portfolioSiteBadge(bond) {
  return `<span class="bond-badge ${siteBadgeClass(bond.site_id)}">${SITE_LABELS[bond.site_id] || bond.site_id}</span>`;
}

function orderStageBadge(order) {
  const stage = escapeHtml(order.stage || '—');
  const color = String(order.stage_color || '').trim();
  const style = color ? ` style="background-color: ${escapeHtml(color)}"` : '';
  return `<span class="order-stage-badge"${style}>${stage}</span>`;
}

function orderCardHtml(order) {
  return `
    <article class="bond-card bond-card-row">
      <div class="bond-row bond-orders-grid">
        <div class="bond-col bond-col-order-id">
          <span class="bond-isin">${escapeHtml(order.order_id || '—')}</span>
        </div>
        <div class="bond-col bond-col-service">${escapeHtml(order.service_type || '—')}</div>
        <div class="bond-col bond-col-params">${escapeHtml(order.parameters || '—')}</div>
        <div class="bond-col bond-col-stage">${orderStageBadge(order)}</div>
        <div class="bond-col bond-col-created">${escapeHtml(order.created_at || '—')}</div>
        <div class="bond-col bond-col-total">${escapeHtml(order.total || '—')}</div>
        <div class="bond-col bond-col-badges">${portfolioSiteBadge(order)}</div>
        <div class="bond-col bond-col-actions bond-actions bond-row-actions">
          <button type="button" class="action" data-action="order" data-site="${order.site_id}" data-url="${escapeHtml(order.source_url || '')}">Відкрити</button>
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

    const unit = parseMoneyValue(bond.buy_price);
    if (unit != null && Number.isFinite(qty)) {
      totalValue += unit * qty;
      hasValue = true;
    }
  });

  const primary = pickPrimaryListing(listings);
  const primaryMetrics = portfolioBondMetricsColumns(primary);

  return {
    qty: hasQty ? escapeHtml(formatQuantity(totalQty)) : primaryMetrics.qty,
    yield: primaryMetrics.yield,
    price: primaryMetrics.price,
    totalValue: hasValue
      ? escapeHtml(formatBondCostUah({ buy_price: totalValue }))
      : primaryMetrics.totalValue,
    maturity: primaryMetrics.maturity,
  };
}

function portfolioBondCardHtml(group) {
  const { listings } = group;
  const multi = listings.length > 1;
  const primary = group.primary || listings[0];

  if (!multi) {
    const bond = listings[0];
    const metrics = portfolioBondMetricsColumns(bond);

    return `
      <article class="bond-card bond-card-row">
        <div class="bond-row bond-portfolio-grid">
          <div class="bond-col bond-col-ident">
            <span class="bond-isin">${escapeHtml(bond.isin || '—')}</span>
            <span class="bond-title">${escapeHtml(bond.title || '')}</span>
          </div>
          <div class="bond-col bond-col-qty">${metrics.qty}</div>
          <div class="bond-col bond-col-yield">${metrics.yield}</div>
          <div class="bond-col bond-col-price bond-cost">${metrics.price}</div>
          <div class="bond-col bond-col-value">${metrics.totalValue}</div>
          <div class="bond-col bond-col-maturity">${metrics.maturity}</div>
          <div class="bond-col bond-col-badges">${portfolioSiteBadge(bond)}</div>
          <div class="bond-col bond-col-actions bond-actions bond-row-actions">${primaryBondActions(bond)}</div>
        </div>
      </article>
    `;
  }

  const siteOffers = listings.map((bond) => {
    const metrics = portfolioBondMetricsColumns(bond);
    return `
      <div class="bond-site-offer">
        <div class="bond-site-offer-head">
          ${portfolioSiteBadge(bond)}
        </div>
        <div class="bond-site-offer-meta">
          <span>Кількість: ${metrics.qty}</span>
          <span>Ціна: ${metrics.price}</span>
          <span class="bond-portfolio-value">Сума: ${metrics.totalValue}</span>
          <span>Дохідність: ${metrics.yield}</span>
          <span>Погашення: ${metrics.maturity}</span>
        </div>
        <div class="bond-actions bond-actions-inline">${expandedSiteActions(bond)}</div>
      </div>
    `;
  }).join('');

  const primaryKey = `${primary.site_id}:${primary.isin || ''}`;
  const metrics = portfolioGroupMetrics(listings);

  return `
    <article class="bond-card bond-card-row bond-card-multi">
      <button type="button" class="bond-card-expand" data-expand-card aria-expanded="false" title="Позиції по платформах (${listings.length})">▸</button>
      <div class="bond-row bond-portfolio-grid">
        <div class="bond-col bond-col-ident">
          <span class="bond-isin">${escapeHtml(group.isin || primary.isin || '—')}</span>
          <span class="bond-title">${escapeHtml(group.title || primary.title || '')}</span>
        </div>
        <div class="bond-col bond-col-qty">${metrics.qty}</div>
        <div class="bond-col bond-col-yield">${metrics.yield}</div>
        <div class="bond-col bond-col-price bond-cost">${metrics.price}</div>
        <div class="bond-col bond-col-value">${metrics.totalValue}</div>
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

function catalogBondCardHtml(group) {
  const { listings } = group;
  const multi = listings.length > 1;
  const primary = group.primary || listings[0];
  const buyable = !isHoldingView() && group.is_buyable ? 'buyable' : '';
  const metaBadge = multi ? multiGroupBadge(group) : holdingMetaBadge(listings[0]);

  if (!multi) {
    const bond = listings[0];
    const siteClass = siteBadgeClass(bond.site_id);

    const metrics = bondMetricsColumns(bond);

    return `
      <article class="bond-card bond-card-row ${buyable}">
        <div class="bond-row bond-catalog-grid">
          <div class="bond-col bond-col-ident">
            <span class="bond-isin">${escapeHtml(bond.isin || '—')}</span>
            <span class="bond-title">${escapeHtml(bond.title || '')}</span>
          </div>
          <div class="bond-col bond-col-yield">${metrics.yield}</div>
          <div class="bond-col bond-col-price bond-cost">${metrics.price}</div>
          <div class="bond-col bond-col-maturity">${metrics.maturity}</div>
          <div class="bond-col bond-col-badges">
            <span class="bond-badge ${siteClass}">${SITE_LABELS[bond.site_id] || bond.site_id}</span>
            ${metaBadge}
            ${holdingValueMetaHtml(bond)}
          </div>
          <div class="bond-col bond-col-actions bond-actions bond-row-actions">${primaryBondActions(bond)}</div>
        </div>
      </article>
    `;
  }

  const siteOffers = listings.map((bond) => {
    const offerBadge = holdingMetaBadge(bond);
    return `
      <div class="bond-site-offer">
        <div class="bond-site-offer-head">
          <span class="bond-badge ${siteBadgeClass(bond.site_id)}">${SITE_LABELS[bond.site_id] || bond.site_id}</span>
          ${offerBadge}
        </div>
        <div class="bond-site-offer-meta">
          ${bondCostMetaHtml(bond)}
          ${holdingValueMetaHtml(bond)}
          <span>Дохідність: ${escapeHtml(formatYieldForBond(bond))}</span>
          <span>Погашення: ${escapeHtml(formatMaturityDate(bond.maturity_date))}</span>
        </div>
        <div class="bond-actions bond-actions-inline">${expandedSiteActions(bond)}</div>
      </div>
    `;
  }).join('');

  const primaryKey = `${primary.site_id}:${primary.isin || ''}`;
  const metrics = catalogGroupMetricsColumns(listings);

  return `
    <article class="bond-card bond-card-row bond-card-multi ${buyable}">
      <button type="button" class="bond-card-expand" data-expand-card aria-expanded="false" title="Пропозиції по платформах">▸</button>
      <div class="bond-row bond-catalog-grid">
        <div class="bond-col bond-col-ident">
          <span class="bond-isin">${escapeHtml(group.isin || primary.isin || '—')}</span>
          <span class="bond-title">${escapeHtml(group.title || primary.title || '')}</span>
        </div>
        <div class="bond-col bond-col-yield">${metrics.yield}</div>
        <div class="bond-col bond-col-price bond-cost">${metrics.price}</div>
        <div class="bond-col bond-col-maturity">${metrics.maturity}</div>
        <div class="bond-col bond-col-badges">
          <div class="bond-site-chips">${siteChipsHtml(listings)}</div>
          ${metaBadge}
        </div>
        <div class="bond-col bond-col-actions bond-actions bond-row-actions bond-actions-shared">
          <button type="button" class="action" data-action="calc" data-key="${primaryKey}">Калькулятор</button>
          <button type="button" class="action primary" data-action="buy" data-site="${primary.site_id}" data-isin="${primary.isin || ''}" ${primary.is_buyable === false ? 'disabled' : ''}>Купити</button>
        </div>
      </div>
      <div class="bond-site-offers" hidden>${siteOffers}</div>
    </article>
  `;
}

function bondCardHtml(group) {
  if (isHoldingView()) return portfolioBondCardHtml(group);
  return catalogBondCardHtml(group);
}

function attachBondActions(listEl, proposals) {
  listEl.querySelectorAll('[data-expand-card]').forEach((btn) => {
    btn.addEventListener('click', (event) => {
      event.stopPropagation();
      const card = btn.closest('.bond-card-multi');
      const offers = card?.querySelector('.bond-site-offers');
      if (!offers) return;
      const expanded = offers.hidden;
      offers.hidden = !expanded;
      btn.setAttribute('aria-expanded', String(expanded));
      btn.textContent = expanded ? '▾' : '▸';
      card?.classList.toggle('expanded', expanded);
    });
  });

  listEl.querySelectorAll('[data-action="calc"]').forEach((btn) => {
    btn.addEventListener('click', (event) => {
      event.stopPropagation();
      const key = btn.getAttribute('data-key');
      const bond = proposals.find((p) => `${p.site_id}:${p.isin}` === key);
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
  if (portfolioHint) {
    return `<p class="empty-state">${portfolioHint}</p>`;
  }
  return '<p class="empty-state">Натисніть «Сканувати», щоб завантажити пропозиції.</p>';
}

function renderBondLists(data = cachedData) {
  cachedData = data;
  if (data?.listKind) {
    persistListCache(data.listKind, data);
  } else {
    persistListCache(activeListKind(), data);
  }
  window.renderBalanceStrip?.();
  const proposals = filteredProposals(data, currentSource);

  const listEl = document.getElementById('bond-list-manual');
  if (!listEl) return;

  const titleEl = document.getElementById('bond-list-title-manual');
  const itemLabel = listItemLabel();

  if (isOrdersView()) {
    const listTitle = 'Замовлення';
    const countLabel = `${proposals.length}`;

    if (titleEl) {
      titleEl.textContent = proposals.length ? `${listTitle} (${countLabel})` : listTitle;
    }

    if (!proposals.length) {
      listEl.innerHTML = emptyListMessage();
      syncPanelLayoutSoon();
      return;
    }

    listEl.innerHTML = proposals.map((order) => orderCardHtml(order)).join('');
    attachOrderActions(listEl, proposals);
    syncPanelLayoutSoon();
    return;
  }

  const groups = groupProposals(proposals);

  const countLabel = groups.length !== proposals.length
    ? `${groups.length} ISIN · ${proposals.length} ${itemLabel}`
    : `${groups.length}`;

  const listTitle = isHoldingView() ? 'Портфель' : 'Пропозиції';

  if (titleEl) {
    titleEl.textContent = groups.length
      ? `${listTitle} (${countLabel})`
      : listTitle;
  }

  if (!groups.length) {
    listEl.innerHTML = emptyListMessage();
    syncPanelLayoutSoon();
    return;
  }

  listEl.innerHTML = groups.map((group) => bondCardHtml(group)).join('');
  attachBondActions(listEl, proposals);
  syncPanelLayoutSoon();
}

function setScanStatus(message, isError = false) {
  const el = document.getElementById('scan-status-manual');
  if (!el) return;
  if (!message) {
    el.hidden = true;
    return;
  }
  el.hidden = false;
  el.textContent = message;
  el.classList.toggle('error', isError);
}

function setScanStatusBoth(message, isError = false) {
  setScanStatus(message, isError);
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
  if (!['catalog', 'holdings', 'setup', 'log'].includes(listKind)) return;
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

  refreshScanButtonState();
  syncPanelLayoutSoon();
}

function isScanBusy() {
  return localScanBusy || remoteScanBusy;
}

function refreshScanButtonState() {
  const busy = isScanBusy();
  document.querySelectorAll('.scan-btn, .portfolio-scan-btn').forEach((btn) => {
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
    isScanBusy(),
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
  if (!['catalog', 'holdings', 'setup', 'log'].includes(listKind)) return;
  if (listKind === currentListKind) return;

  applyListKind(listKind);

  if (listKind === 'setup') {
    window.applyPanelTab?.('bonds');
    requireShell().setPanelTab('bonds');
    return;
  }

  if (listKind === 'log') {
    window.applyPanelTab?.('bonds');
    requireShell().setPanelTab('bonds');
    return;
  }

  const requestId = ++listKindRequestId;

  try {
    const data = await requireShell().getSecurities('all', listKind === 'holdings' ? activeListKind() : listKind);
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
  const shell = requireShell();
  const data = await shell.getSecurities('all', activeListKind());
  renderBondLists(data);
  return data;
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
  runScan(SCAN_LABELS[siteId] || siteId, scanFn, 'catalog');
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
  runScan(`портфель ${PORTFOLIO_SCAN_LABELS[siteId] || siteId}`, scanFn, 'holdings');
}

function applySourceFilter(source) {
  if (!['all', 'inzhur', 'univer', 'privat'].includes(source)) return;
  currentSource = source;
  const select = document.getElementById('source-filter');
  if (select && select.value !== source) {
    select.value = source;
  }
  renderBondLists(cachedData);
  syncPanelLayoutSoon();
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

  const panel = document.getElementById('cabinet-screen');
  if (!panel) return;

  panel.addEventListener('click', (event) => {
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

async function runScan(label, scanFn, listKind = activeListKind()) {
  setScanBusy(true);
  lastScanOverlayMessage = `Сканування ${label}…`;
  syncScanBusyOverlay();
  setScanStatusBoth(lastScanOverlayMessage);
  try {
    await ensureListKind(listKind);
    const shell = requireShell();
    await scanFn();
    const fetchKind = listKind === 'holdings' ? activeListKind() : listKind;
    const result = await shell.getSecurities('all', fetchKind);
    renderBondLists(result);
    const proposals = filteredProposals(result, currentSource);

    if (fetchKind === 'orders') {
      setScanStatusBoth(
        `Оновлено ${proposals.length} замовлень (${label}) · ${formatScanTime(result.orders_scanned_at)}`,
      );
      return;
    }

    const groups = groupProposals(proposals);
    const itemLabel = fetchKind === 'holdings' ? 'позицій' : 'пропозицій';
    const countLabel = groups.length !== proposals.length
      ? `${groups.length} ISIN (${proposals.length} ${itemLabel})`
      : `${groups.length} ${itemLabel}`;
    const scanTime = fetchKind === 'holdings'
      ? (result.holdings_scanned_at || result.scanned_at)
      : result.scanned_at;
    setScanStatusBoth(
      `Оновлено ${countLabel} (${label}) · ${formatScanTime(scanTime)}`,
    );
  } catch (err) {
    setScanStatusBoth(err.message || 'Помилка сканування', true);
  } finally {
    setScanBusy(false);
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

  shell.onSecuritiesUpdated(async (data) => {
    try {
      if (data?.fromCache) {
        persistListCache(data.listKind || activeListKind(), data);
        if ((data.listKind || activeListKind()) === activeListKind()) {
          renderBondLists(data);
          setScanStatusFromData(data, { fromCache: true });
        }
        return;
      }
      if (data?.listKind === 'orders') {
        await ensureListKind('orders');
        if (data.orders_scanned_at) {
          setScanStatusFromData(data);
        }
        return;
      }
      await reloadSecuritiesList();
    } catch (err) {
      setScanStatus(err.message || 'Помилка оновлення списку', true);
    }
  });

  shell.onScanState(({ scanning, message }) => {
    remoteScanBusy = Boolean(scanning);
    if (scanning && message) {
      lastScanOverlayMessage = message;
      setScanStatusBoth(message);
    }
    syncScanBusyOverlay();
    refreshScanButtonState();
  });

  shell.onSessionStates((states) => {
    sessionStates = normalizeSessionStates(states);
    refreshScanButtonState();
    window.renderBalanceStrip?.();
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

  const cachedLists = hydrateListCache(activeListKind());
  if (cachedLists?.proposals?.length) {
    renderBondLists(cachedLists);
    setScanStatusFromData(cachedLists, { fromCache: true });
  }

  shell.getScanState?.().then(({ scanning }) => {
    remoteScanBusy = Boolean(scanning);
    syncScanBusyOverlay();
    refreshScanButtonState();
  }).catch(() => {});

  shell.getSecurities('all', activeListKind()).then((data) => {
    renderBondLists(data);
    setScanStatusFromData(data);
  }).catch((err) => {
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
window.getCurrentListKind = () => currentListKind;
window.syncToolbarNavActive = syncToolbarNavActive;
