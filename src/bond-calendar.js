/**
 * Month calendar for OVDP coupon and maturity schedules (NBU reference data).
 */

const UK_MONTHS = [
  'Січень', 'Лютий', 'Березень', 'Квітень', 'Травень', 'Червень',
  'Липень', 'Серпень', 'Вересень', 'Жовтень', 'Листопад', 'Грудень',
];

const UK_WEEKDAYS = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Нд'];

let calendarMonth = null;
let calendarSelectedDate = null;
let calendarShowCoupons = true;
let calendarShowMaturity = true;
let calendarSecSearch = '';
let calendarSecDropdownOpen = true;

function calendarToday() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

function calendarDateKey(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function calendarParseKey(key) {
  const [y, m, d] = String(key).split('-').map(Number);
  return new Date(y, m - 1, d);
}

function calendarEnsureMonth(date = calendarToday()) {
  calendarMonth = { year: date.getFullYear(), month: date.getMonth() };
}

function calendarMonthStart() {
  return new Date(calendarMonth.year, calendarMonth.month, 1);
}

function calendarMonthLabel() {
  return `${UK_MONTHS[calendarMonth.month]} ${calendarMonth.year}`;
}

function calendarEscape(text) {
  return String(text ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function calendarParseAmount(amount) {
  if (amount == null || amount === '') return null;
  const n = typeof amount === 'number'
    ? amount
    : parseFloat(String(amount).replace(/\s/g, '').replace(',', '.'));
  return Number.isFinite(n) ? n : null;
}

function calendarFormatAmount(amount) {
  const n = calendarParseAmount(amount);
  if (n == null) return amount == null || amount === '' ? '—' : String(amount);
  return `${n.toLocaleString('uk-UA', { maximumFractionDigits: 4 })} ₴`;
}

function calendarFormatAmountCompact(amount) {
  const n = calendarParseAmount(amount);
  if (n == null) return '';
  if (n >= 1000000) {
    return `${(n / 1000000).toLocaleString('uk-UA', { maximumFractionDigits: 1 })}M ₴`;
  }
  if (n >= 10000) {
    return `${Math.round(n).toLocaleString('uk-UA')} ₴`;
  }
  return calendarFormatAmount(n);
}

function calendarResolveBondQty(isin, options = {}) {
  const key = calendarNormalizeIsin(isin);
  const bondQty = options.bondQty || {};
  const holdingsQty = options.holdingsQty || {};
  if (bondQty[key] != null && Number.isFinite(Number(bondQty[key]))) {
    return Math.max(0, Math.floor(Number(bondQty[key])));
  }
  if (holdingsQty[key] != null && holdingsQty[key] > 0) {
    return Math.max(0, Math.floor(Number(holdingsQty[key])));
  }
  return 1;
}

function calendarFormatDayLabel(dateKey) {
  const date = calendarParseKey(dateKey);
  const day = date.getDate();
  const month = UK_MONTHS[date.getMonth()].toLowerCase();
  return `${day} ${month} ${date.getFullYear()}`;
}

function calendarNormalizeIsin(isin) {
  return String(isin || '').trim().toUpperCase();
}

function calendarParsePaymentDate(dateStr) {
  if (typeof BondDates !== 'undefined' && BondDates.parseBondDate) {
    return BondDates.parseBondDate(dateStr);
  }
  const iso = String(dateStr || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (iso) {
    const date = new Date(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3]));
    return Number.isNaN(date.getTime()) ? null : date;
  }
  const uk = String(dateStr || '').match(/(\d{1,2})[./-](\d{1,2})[./-](\d{2,4})/);
  if (!uk) return null;
  let year = parseInt(uk[3], 10);
  if (year < 100) year += 2000;
  const date = new Date(year, parseInt(uk[2], 10) - 1, parseInt(uk[1], 10));
  return Number.isNaN(date.getTime()) ? null : date;
}

function calendarNormalizePayment(payment = {}) {
  const rawType = payment.payment_type ?? payment.pay_type;
  const paymentType = rawType === 'maturity' || String(rawType) === '2' || String(rawType) === '3'
    ? 'maturity'
    : 'coupon';
  const rawDate = payment.date || payment.pay_date || null;
  const date = typeof BondDates !== 'undefined'
    ? (BondDates.normalizeMaturityDate(rawDate) || rawDate)
    : rawDate;
  const dateObj = calendarParsePaymentDate(date);
  const today = calendarToday();

  return {
    date,
    dateKey: dateObj ? calendarDateKey(dateObj) : null,
    dateObj,
    amount: payment.amount ?? payment.pay_val ?? null,
    payment_type: paymentType,
    isPast: dateObj ? dateObj < today : false,
  };
}

function calendarBuildEvents(records, availabilityIndex, options = {}) {
  const events = [];
  const { holdingsQty = {} } = options;

  records.forEach((record) => {
    const isin = calendarNormalizeIsin(record.isin);
    if (!isin) return;

    const bondQuantity = calendarResolveBondQty(isin, options);
    if (bondQuantity <= 0) return;

    const sites = (typeof SITE_ORDER !== 'undefined' ? SITE_ORDER : [])
      .filter((siteId) => availabilityIndex[isin]?.has(siteId));
    const hasBroker = sites.length > 0;

    const payments = Array.isArray(record.payments) ? record.payments : [];
    payments.forEach((raw) => {
      const payment = calendarNormalizePayment(raw);
      if (!payment.dateKey || !payment.dateObj) return;
      if (payment.payment_type === 'coupon' && !calendarShowCoupons) return;
      if (payment.payment_type === 'maturity' && !calendarShowMaturity) return;

      const unitAmount = calendarParseAmount(payment.amount);
      const scaledAmount = unitAmount != null ? unitAmount * bondQuantity : null;

      events.push({
        dateKey: payment.dateKey,
        dateObj: payment.dateObj,
        isin,
        title: record.bond_type || isin,
        payment_type: payment.payment_type,
        amount: payment.amount,
        unitAmount,
        scaledAmount,
        bondQuantity,
        isPast: payment.isPast,
        buyable: hasBroker,
        sites,
        yield: record.nominal_yield,
        holdingsQty: holdingsQty[isin] || null,
        inactive: typeof isNbuRecordInactive === 'function' ? isNbuRecordInactive(record) : false,
      });
    });
  });

  events.sort((a, b) => {
    const dateDiff = a.dateObj - b.dateObj;
    if (dateDiff !== 0) return dateDiff;
    const typeDiff = (a.payment_type === 'maturity' ? 1 : 0) - (b.payment_type === 'maturity' ? 1 : 0);
    if (typeDiff !== 0) return typeDiff;
    return a.isin.localeCompare(b.isin, 'uk');
  });

  return events;
}

function calendarGroupByDate(events) {
  const map = new Map();
  events.forEach((event) => {
    if (!map.has(event.dateKey)) map.set(event.dateKey, []);
    map.get(event.dateKey).push(event);
  });
  return map;
}

function calendarSiteBadges(sites) {
  if (!sites.length) return '';
  return sites.map((siteId) => {
    const cls = typeof siteBadgeClass === 'function' ? siteBadgeClass(siteId) : '';
    const label = (typeof SITE_LABELS !== 'undefined' ? SITE_LABELS[siteId] : null) || siteId;
    return `<span class="bond-badge ${cls}">${calendarEscape(label)}</span>`;
  }).join('');
}

function calendarDaySummary(events) {
  let coupons = 0;
  let maturities = 0;
  let couponSum = 0;
  events.forEach((event) => {
    if (event.payment_type === 'maturity') {
      maturities += 1;
      return;
    }
    coupons += 1;
    if (event.scaledAmount != null) couponSum += event.scaledAmount;
  });
  const parts = [];
  if (couponSum > 0) parts.push(calendarFormatAmountCompact(couponSum));
  else if (coupons) parts.push(`${coupons} куп.`);
  if (maturities) parts.push(`${maturities} пог.`);
  return parts.join(' · ');
}

function calendarDayCouponTotal(events) {
  return events.reduce((sum, event) => {
    if (event.payment_type !== 'coupon') return sum;
    if (event.scaledAmount == null) return sum;
    return sum + event.scaledAmount;
  }, 0);
}

function calendarScopeHint(totalCount, activeCount) {
  return `${activeCount} з ${totalCount} облігацій у календарі`;
}

function calendarPartitionSecRecords(allRecords, ownedIsins) {
  const owned = [];
  const other = [];

  allRecords.forEach((record) => {
    const isin = calendarNormalizeIsin(record.isin);
    if (ownedIsins.has(isin)) owned.push(record);
    else other.push(record);
  });

  const sortByIsin = (a, b) => String(a.isin || '').localeCompare(String(b.isin || ''), 'uk');
  owned.sort(sortByIsin);
  other.sort(sortByIsin);
  return { owned, other };
}

function calendarSecRowHtml(record, activeIsins, holdingsQty, ownedIsins, bondQty = {}) {
  const isin = calendarNormalizeIsin(record.isin);
  const selected = activeIsins.has(isin);
  const owned = ownedIsins.has(isin);
  const qty = calendarResolveBondQty(isin, { bondQty, holdingsQty });

  return `
    <button
      type="button"
      class="bond-cal-sec-row${selected ? ' selected' : ''}${owned ? ' owned' : ''}"
      data-cal-bond="${calendarEscape(isin)}"
      aria-pressed="${selected}"
    >
      <span class="bond-cal-sec-check" aria-hidden="true">${selected ? '✓' : ''}</span>
      <span class="bond-cal-sec-ident">
        <span class="bond-isin">${calendarEscape(isin)}</span>
        <span class="bond-title">${calendarEscape(record.bond_type || '—')}</span>
      </span>
      ${owned
    ? '<span class="bond-cal-sec-owned-badge">Портфель</span>'
    : '<span class="bond-cal-sec-owned-slot" aria-hidden="true"></span>'}
      <label class="bond-cal-sec-qty-wrap" aria-label="Кількість облігацій">
        <span class="bond-cal-sec-qty-label">К-ть</span>
        <input
          type="number"
          class="bond-cal-sec-qty-input"
          data-cal-qty="${calendarEscape(isin)}"
          min="0"
          step="1"
          inputmode="numeric"
          value="${calendarEscape(String(qty))}"
        >
      </label>
    </button>
  `;
}

function calendarSecDropdownHtml(allRecords, activeIsins, holdingsQty = {}, ownedIsins = new Set(), bondQty = {}) {
  if (!allRecords.length) return '';

  const matchesQuery = (record) => {
    const matcher = typeof BondNbuCatalog !== 'undefined' && BondNbuCatalog.matchesIsinOrTitleSearch;
    if (matcher) return BondNbuCatalog.matchesIsinOrTitleSearch(record, calendarSecSearch);
    const q = calendarSecSearch.trim().toLowerCase();
    if (!q) return true;
    const isin = calendarNormalizeIsin(record.isin);
    const title = String(record.bond_type || record.title || '').toLowerCase();
    return isin.includes(q.toUpperCase()) || title.includes(q);
  };

  const { owned, other } = calendarPartitionSecRecords(allRecords, ownedIsins);
  const ownedFiltered = owned.filter(matchesQuery);
  const otherFiltered = other.filter(matchesQuery);
  const activeCount = allRecords.filter(
    (r) => activeIsins.has(calendarNormalizeIsin(r.isin)),
  ).length;

  const ownedRows = ownedFiltered.map(
    (record) => calendarSecRowHtml(record, activeIsins, holdingsQty, ownedIsins, bondQty),
  ).join('');

  const otherRows = otherFiltered.map(
    (record) => calendarSecRowHtml(record, activeIsins, holdingsQty, ownedIsins, bondQty),
  ).join('');

  const listParts = [];
  if (ownedFiltered.length) {
    listParts.push(`<div class="bond-cal-sec-group-label">У портфелі</div>${ownedRows}`);
  }
  if (otherFiltered.length) {
    if (ownedFiltered.length) {
      listParts.push(`<div class="bond-cal-sec-group-label">Інші</div>${otherRows}`);
    } else {
      listParts.push(otherRows);
    }
  }

  const listHtml = listParts.length
    ? listParts.join('')
    : '<p class="bond-cal-detail-hint">Нічого не знайдено</p>';

  return `
    <section class="bond-cal-sec-dropdown${calendarSecDropdownOpen ? ' open' : ''}" aria-label="Оберіть облігації">
      <div class="bond-cal-sec-head">
        <input
          type="search"
          class="bond-cal-sec-search-compact"
          placeholder="ISIN або назва…"
          value="${calendarEscape(calendarSecSearch)}"
          aria-label="Пошук облігацій"
        >
        <button
          type="button"
          class="bond-cal-sec-trigger action subtle"
          data-cal-sec-toggle
          aria-expanded="${calendarSecDropdownOpen}"
        >
          <span class="bond-cal-sec-trigger-label">Облігації</span>
          <span class="bond-cal-sec-trigger-count">${activeCount} / ${allRecords.length}</span>
          <span class="bond-cal-sec-chevron" aria-hidden="true"></span>
        </button>
      </div>
      <div class="bond-cal-sec-panel">
        <div class="bond-cal-sec-actions">
          <button type="button" class="action subtle" data-cal-bonds-all>Усі</button>
          <button type="button" class="action subtle" data-cal-bonds-none>Жодної</button>
          <button type="button" class="action subtle" data-cal-bonds-owned>Лише портфель</button>
        </div>
        <div class="bond-cal-sec-list" role="group" aria-label="Список облігацій">
          ${listHtml}
        </div>
      </div>
    </section>
  `;
}

function calendarToggleSecDropdown(container, open) {
  calendarSecDropdownOpen = open;
  const dropdown = container.querySelector('.bond-cal-sec-dropdown');
  const trigger = container.querySelector('[data-cal-sec-toggle]');
  if (dropdown) dropdown.classList.toggle('open', open);
  if (trigger) trigger.setAttribute('aria-expanded', String(open));
  if (typeof syncPanelLayoutSoon === 'function') syncPanelLayoutSoon();
}

function calendarRestoreSecSearchFocus(container) {
  const input = container.querySelector('.bond-cal-sec-search-compact');
  if (!input || document.activeElement === input) return;
  const len = input.value.length;
  input.focus();
  try {
    input.setSelectionRange(len, len);
  } catch {
    // setSelectionRange unsupported for some input types
  }
}

function calendarGridHtml(eventsByDate) {
  const monthStart = calendarMonthStart();
  const startDow = (monthStart.getDay() + 6) % 7;
  const daysInMonth = new Date(calendarMonth.year, calendarMonth.month + 1, 0).getDate();
  const todayKey = calendarDateKey(calendarToday());
  const cells = [];

  for (let i = 0; i < startDow; i += 1) {
    cells.push('<div class="bond-cal-day bond-cal-day-empty" aria-hidden="true"></div>');
  }

  for (let day = 1; day <= daysInMonth; day += 1) {
    const date = new Date(calendarMonth.year, calendarMonth.month, day);
    const dateKey = calendarDateKey(date);
    const dayEvents = eventsByDate.get(dateKey) || [];
    const isToday = dateKey === todayKey;
    const isSelected = dateKey === calendarSelectedDate;
    const isPast = date < calendarToday();
    const hasCoupon = dayEvents.some((e) => e.payment_type === 'coupon');
    const hasMaturity = dayEvents.some((e) => e.payment_type === 'maturity');
    const hasPortfolio = dayEvents.some((e) => e.holdingsQty);
    const couponTotal = calendarDayCouponTotal(dayEvents);

    const classes = [
      'bond-cal-day',
      isToday ? 'bond-cal-day-today' : '',
      isSelected ? 'bond-cal-day-selected' : '',
      isPast ? 'bond-cal-day-past' : '',
      dayEvents.length ? 'bond-cal-day-has-events' : '',
    ].filter(Boolean).join(' ');

    const dots = dayEvents.length ? `
      <span class="bond-cal-dots" aria-hidden="true">
        ${hasCoupon ? '<span class="bond-cal-dot bond-cal-dot-coupon"></span>' : ''}
        ${hasMaturity ? '<span class="bond-cal-dot bond-cal-dot-maturity"></span>' : ''}
        ${hasPortfolio ? '<span class="bond-cal-dot bond-cal-dot-portfolio"></span>' : ''}
      </span>
    ` : '';

    const couponSumHtml = couponTotal > 0
      ? `<span class="bond-cal-day-sum" title="Сума купонів за обраною кількістю">${calendarEscape(calendarFormatAmountCompact(couponTotal))}</span>`
      : '';
    const countHtml = dayEvents.length && couponTotal <= 0
      ? `<span class="bond-cal-day-count">${dayEvents.length}</span>`
      : '';

    cells.push(`
      <button type="button" class="${classes}" data-cal-date="${dateKey}" aria-pressed="${isSelected}">
        <span class="bond-cal-day-num">${day}</span>
        ${dots}
        ${couponSumHtml}
        ${countHtml}
      </button>
    `);
  }

  return cells.join('');
}

function calendarEventRowHtml(event) {
  const typeLabel = event.payment_type === 'maturity' ? 'Погашення' : 'Купон';
  const typeClass = event.payment_type === 'maturity' ? 'bond-cal-event-maturity' : 'bond-cal-event-coupon';
  const pastClass = event.isPast ? ' bond-cal-event-past' : '';
  const inactiveClass = event.inactive ? ' bond-cal-event-inactive' : '';
  const yieldStr = event.yield != null && event.yield !== ''
    ? `<span class="bond-cal-event-yield">${calendarEscape(String(event.yield))} %</span>`
    : '';
  const qtyStr = event.bondQuantity
    ? `<span class="bond-cal-event-qty">${calendarEscape(String(event.bondQuantity))} шт.</span>`
    : '';

  const amountLabel = event.scaledAmount != null && event.bondQuantity > 1
    ? calendarFormatAmount(event.scaledAmount)
    : calendarFormatAmount(event.amount);
  const amountTitle = event.scaledAmount != null && event.bondQuantity > 1 && event.unitAmount != null
    ? ` title="${calendarEscape(`${calendarFormatAmount(event.unitAmount)} × ${event.bondQuantity}`)}"`
    : '';

  return `
    <article class="bond-cal-event${pastClass}${inactiveClass}">
      <div class="bond-cal-event-main">
        <span class="bond-cal-event-type ${typeClass}">${typeLabel}</span>
        <div class="bond-cal-event-ident">
          <span class="bond-isin">${calendarEscape(event.isin)}</span>
          <span class="bond-title">${calendarEscape(event.title)}</span>
        </div>
        ${qtyStr}
        ${yieldStr}
        <span class="bond-cal-event-amount"${amountTitle}>${calendarEscape(amountLabel)}</span>
      </div>
      <div class="bond-cal-event-meta">
        <div class="bond-cal-event-badges">${calendarSiteBadges(event.sites)}</div>
        <button type="button" class="action bond-cal-event-calc" data-cal-calc="${calendarEscape(event.isin)}">Калькулятор</button>
      </div>
    </article>
  `;
}

function calendarDetailHtml(events, dateKey) {
  if (!dateKey) {
    return `
      <div class="bond-cal-detail bond-cal-detail-empty">
        <p class="bond-cal-detail-hint">Оберіть день у календарі, щоб переглянути графік виплат.</p>
      </div>
    `;
  }

  const dayEvents = events.filter((e) => e.dateKey === dateKey);
  if (!dayEvents.length) {
    return `
      <div class="bond-cal-detail bond-cal-detail-empty">
        <h3 class="bond-cal-detail-title">${calendarEscape(calendarFormatDayLabel(dateKey))}</h3>
        <p class="bond-cal-detail-hint">Немає виплат у цей день за обраними фільтрами.</p>
      </div>
    `;
  }

  const couponTotal = dayEvents
    .filter((e) => e.payment_type === 'coupon')
    .reduce((sum, e) => sum + (e.scaledAmount ?? calendarParseAmount(e.amount) ?? 0), 0);
  const maturityTotal = dayEvents
    .filter((e) => e.payment_type === 'maturity')
    .reduce((sum, e) => sum + (e.scaledAmount ?? calendarParseAmount(e.amount) ?? 0), 0);

  const totals = [];
  if (couponTotal > 0) totals.push(`купони: ${calendarFormatAmount(couponTotal)}`);
  if (maturityTotal > 0) totals.push(`погашення: ${calendarFormatAmount(maturityTotal)}`);

  return `
    <div class="bond-cal-detail">
      <header class="bond-cal-detail-head">
        <h3 class="bond-cal-detail-title">${calendarEscape(calendarFormatDayLabel(dateKey))}</h3>
        <p class="bond-cal-detail-meta">${dayEvents.length} виплат${totals.length ? ` · ${totals.join(' · ')}` : ''}</p>
      </header>
      <div class="bond-cal-event-list">
        ${dayEvents.map((event) => calendarEventRowHtml(event)).join('')}
      </div>
    </div>
  `;
}

function calendarUpcomingHtml(events, limit = 8) {
  const today = calendarToday();
  const upcoming = events.filter((e) => e.dateObj >= today).slice(0, limit);
  if (!upcoming.length) {
    return `
      <aside class="bond-cal-upcoming">
        <h3 class="bond-cal-upcoming-title">Найближчі виплати</h3>
        <p class="bond-cal-detail-hint">Немає майбутніх виплат за обраними фільтрами.</p>
      </aside>
    `;
  }

  const byDate = calendarGroupByDate(upcoming);
  const rows = [...byDate.entries()].map(([dateKey, dayEvents]) => `
    <button type="button" class="bond-cal-upcoming-row" data-cal-date="${dateKey}">
      <span class="bond-cal-upcoming-date">${calendarEscape(typeof formatMaturityDate === 'function' ? formatMaturityDate(dateKey) : dateKey)}</span>
      <span class="bond-cal-upcoming-summary">${calendarEscape(calendarDaySummary(dayEvents))}</span>
    </button>
  `).join('');

  return `
    <aside class="bond-cal-upcoming">
      <h3 class="bond-cal-upcoming-title">Найближчі виплати</h3>
      <div class="bond-cal-upcoming-list">${rows}</div>
    </aside>
  `;
}

function calendarHtml(events, options = {}) {
  const eventsByDate = calendarGroupByDate(events);
  const monthEvents = events.filter((e) => (
    e.dateObj.getFullYear() === calendarMonth.year && e.dateObj.getMonth() === calendarMonth.month
  ));
  const {
    allRecords = [],
    records = [],
    activeIsins = new Set(),
    ownedIsins = new Set(),
  } = options;

  const activeCount = allRecords.filter(
    (r) => activeIsins.has(calendarNormalizeIsin(r.isin)),
  ).length;

  return `
    <div class="bond-calendar">
      <p class="bond-cal-scope-hint">${calendarEscape(calendarScopeHint(allRecords.length, activeCount))}</p>
      ${calendarSecDropdownHtml(
    allRecords,
    activeIsins,
    options.holdingsQty || {},
    ownedIsins,
    options.bondQty || {},
  )}
      <header class="bond-cal-toolbar">
        <div class="bond-cal-nav">
          <div class="bond-cal-nav-center">
            <button type="button" class="action subtle bond-cal-nav-btn" data-cal-nav="prev" aria-label="Попередній місяць">‹</button>
            <h2 class="bond-cal-month-label">${calendarEscape(calendarMonthLabel())}</h2>
            <button type="button" class="action subtle bond-cal-nav-btn" data-cal-nav="next" aria-label="Наступний місяць">›</button>
          </div>
          <button type="button" class="action subtle bond-cal-today-btn" data-cal-nav="today">Сьогодні</button>
        </div>
        <div class="bond-cal-filters" role="group" aria-label="Фільтри календаря">
          <label class="bond-cal-filter">
            <input type="checkbox" data-cal-filter="coupons" ${calendarShowCoupons ? 'checked' : ''}>
            <span>Купони</span>
          </label>
          <label class="bond-cal-filter">
            <input type="checkbox" data-cal-filter="maturity" ${calendarShowMaturity ? 'checked' : ''}>
            <span>Погашення</span>
          </label>
        </div>
        <p class="bond-cal-legend" aria-hidden="true">
          <span class="bond-cal-legend-item"><span class="bond-cal-dot bond-cal-dot-coupon"></span> купон</span>
          <span class="bond-cal-legend-item"><span class="bond-cal-dot bond-cal-dot-maturity"></span> погашення</span>
          <span class="bond-cal-legend-item"><span class="bond-cal-dot bond-cal-dot-portfolio"></span> портфель</span>
        </p>
      </header>

      <div class="bond-cal-body">
        <div class="bond-cal-main">
          <div class="bond-cal-weekdays" aria-hidden="true">
            ${UK_WEEKDAYS.map((day) => `<span class="bond-cal-weekday">${day}</span>`).join('')}
          </div>
          <div class="bond-cal-grid" role="grid" aria-label="Календар виплат">
            ${calendarGridHtml(eventsByDate)}
          </div>
          <p class="bond-cal-month-stats">${monthEvents.length ? `${monthEvents.length} виплат у ${UK_MONTHS[calendarMonth.month].toLowerCase()}` : 'Немає виплат у цьому місяці'}</p>
        </div>
        ${calendarUpcomingHtml(events)}
      </div>

      ${calendarDetailHtml(events, calendarSelectedDate)}
    </div>
  `;
}

function calendarRerender(container, options, { preserveSecSearchFocus = false } = {}) {
  renderBondCalendar(container, {
    ...options,
    preserveSecSearchFocus,
  });
}

function calendarAttachActions(container, options = {}) {
  const {
    records = [],
    allRecords = records,
    availabilityIndex = {},
    onActiveIsinsChange,
    onBondQtyChange,
    activeIsins = new Set(),
    ownedIsins = new Set(),
  } = options;

  container.querySelectorAll('[data-cal-nav]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const action = btn.getAttribute('data-cal-nav');
      if (action === 'prev') {
        calendarMonth.month -= 1;
        if (calendarMonth.month < 0) {
          calendarMonth.month = 11;
          calendarMonth.year -= 1;
        }
      } else if (action === 'next') {
        calendarMonth.month += 1;
        if (calendarMonth.month > 11) {
          calendarMonth.month = 0;
          calendarMonth.year += 1;
        }
      } else if (action === 'today') {
        calendarEnsureMonth(calendarToday());
        calendarSelectedDate = calendarDateKey(calendarToday());
      }
      calendarRerender(container, options);
    });
  });

  container.querySelectorAll('[data-cal-filter]').forEach((input) => {
    input.addEventListener('change', () => {
      const filter = input.getAttribute('data-cal-filter');
      if (filter === 'coupons') calendarShowCoupons = input.checked;
      if (filter === 'maturity') calendarShowMaturity = input.checked;
      calendarRerender(container, options);
    });
  });

  const selectDate = (dateKey) => {
    if (dateKey) {
      const date = calendarParseKey(dateKey);
      if (date.getFullYear() !== calendarMonth.year || date.getMonth() !== calendarMonth.month) {
        calendarMonth = { year: date.getFullYear(), month: date.getMonth() };
      }
    }
    calendarSelectedDate = dateKey;
    calendarRerender(container, options);
  };

  container.querySelectorAll('[data-cal-date]').forEach((btn) => {
    btn.addEventListener('click', () => {
      selectDate(btn.getAttribute('data-cal-date'));
    });
  });

  container.querySelectorAll('[data-cal-calc]').forEach((btn) => {
    btn.addEventListener('click', (event) => {
      event.stopPropagation();
      const isin = calendarNormalizeIsin(btn.getAttribute('data-cal-calc'));
      const record = records.find((entry) => calendarNormalizeIsin(entry.isin) === isin)
        || allRecords.find((entry) => calendarNormalizeIsin(entry.isin) === isin);
      if (record && typeof fillCalculatorFromBond === 'function') {
        fillCalculatorFromBond(typeof nbuRecordToProposal === 'function' ? nbuRecordToProposal(record) : { isin, title: record.bond_type });
      }
    });
  });

  container.querySelector('[data-cal-sec-toggle]')?.addEventListener('click', (event) => {
    event.preventDefault();
    event.stopPropagation();
    const isOpen = container.querySelector('.bond-cal-sec-dropdown')?.classList.contains('open');
    calendarToggleSecDropdown(container, !isOpen);
  });

  container.querySelector('.bond-cal-sec-search-compact')?.addEventListener('input', (event) => {
    calendarSecSearch = event.target.value || '';
    if (!calendarSecDropdownOpen) {
      calendarToggleSecDropdown(container, true);
    }
    calendarRerender(container, options, { preserveSecSearchFocus: true });
  });

  container.querySelector('.bond-cal-sec-search-compact')?.addEventListener('click', (event) => {
    event.stopPropagation();
  });

  container.querySelector('[data-cal-bonds-all]')?.addEventListener('click', () => {
    if (!onActiveIsinsChange) return;
    onActiveIsinsChange(new Set(allRecords.map((record) => calendarNormalizeIsin(record.isin)).filter(Boolean)));
  });

  container.querySelector('[data-cal-bonds-none]')?.addEventListener('click', () => {
    if (!onActiveIsinsChange) return;
    onActiveIsinsChange(new Set());
  });

  container.querySelector('[data-cal-bonds-owned]')?.addEventListener('click', () => {
    if (!onActiveIsinsChange) return;
    onActiveIsinsChange(new Set([...ownedIsins].filter(Boolean)));
  });

  container.querySelectorAll('[data-cal-bond]').forEach((btn) => {
    btn.addEventListener('click', () => {
      if (!onActiveIsinsChange) return;
      const isin = calendarNormalizeIsin(btn.getAttribute('data-cal-bond'));
      const next = new Set(activeIsins);
      if (next.has(isin)) next.delete(isin);
      else next.add(isin);
      onActiveIsinsChange(next);
    });
  });

  container.querySelectorAll('.bond-cal-sec-qty-wrap').forEach((wrap) => {
    wrap.addEventListener('click', (event) => {
      event.stopPropagation();
    });
  });

  container.querySelectorAll('[data-cal-qty]').forEach((input) => {
    input.addEventListener('mousedown', (event) => {
      event.stopPropagation();
    });
    const commitQty = () => {
      if (!onBondQtyChange) return;
      const isin = calendarNormalizeIsin(input.getAttribute('data-cal-qty'));
      const parsed = parseInt(String(input.value || '').trim(), 10);
      const qty = Number.isFinite(parsed) ? Math.max(0, parsed) : 0;
      input.value = String(qty);
      onBondQtyChange(isin, qty);
    };
    input.addEventListener('change', commitQty);
    input.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        commitQty();
      }
    });
  });
}

function renderBondCalendar(container, options = {}) {
  if (!container) return;

  const {
    records = [],
    allRecords = records,
    availabilityIndex = {},
  } = options;

  if (!calendarMonth) calendarEnsureMonth(calendarToday());

  const events = calendarBuildEvents(records, availabilityIndex, options);

  if (!calendarSelectedDate) {
    const todayKey = calendarDateKey(calendarToday());
    const hasToday = events.some((e) => e.dateKey === todayKey);
    calendarSelectedDate = hasToday ? todayKey : null;
  }

  const preserveSearch = Boolean(options.preserveSecSearchFocus);
  container.innerHTML = calendarHtml(events, { ...options, records });
  calendarAttachActions(container, options);
  if (preserveSearch) calendarRestoreSecSearchFocus(container);

  if (typeof syncPanelLayoutSoon === 'function') syncPanelLayoutSoon();
}

const BondCalendar = {
  render: renderBondCalendar,
  calendarBuildEvents,
  calendarDayCouponTotal,
  calendarResolveBondQty,
  calendarParseAmount,
  reset: () => {
    calendarMonth = null;
    calendarSelectedDate = null;
    calendarSecSearch = '';
    calendarSecDropdownOpen = true;
  },
};

if (typeof window !== 'undefined') {
  window.BondCalendar = BondCalendar;
  window.renderBondCalendar = renderBondCalendar;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = BondCalendar;
}
