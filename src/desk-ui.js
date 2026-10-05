let deskCtx = {
  getCachedData: () => ({}),
  getSessionStates: () => ({}),
  getOnboardingState: () => ({ sites: {} }),
  setScanStatus: () => {},
  requireShell: () => window.inzhurShell,
  isSiteAuthenticated: () => false,
  onFilterSource: () => {},
  runPortfolioRefresh: () => {},
};

let drawerBond = null;
let drawerMode = null;
let platformPickerBonds = [];
let privatCommissionsQuote = null;
let privatCommissionsLoading = false;
let privatCommissionsRequestId = 0;
let privatCommissionsTimer = null;

function escapeHtml(text) {
  return String(text ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function parseMoney(value) {
  if (value == null || value === '') return null;
  const cleaned = String(value).replace(/[^\d.,-]/g, '').replace(',', '.');
  const n = parseFloat(cleaned);
  return Number.isFinite(n) ? n : null;
}

function formatUah(amount) {
  if (amount == null || !Number.isFinite(amount)) return '—';
  return new Intl.NumberFormat('uk-UA', {
    style: 'currency',
    currency: 'UAH',
    maximumFractionDigits: 2,
  }).format(amount);
}

function sessionLabel(siteId) {
  const status = deskCtx.getSessionStates()[siteId]?.status || 'unknown';
  const map = {
    authenticated: 'активна',
    guest: 'потрібен вхід',
    checking: 'перевірка…',
    unknown: '—',
  };
  return map[status] || status;
}

function getSiteBalance(siteId, data) {
  if (siteId === 'univer') {
    const account = data?.univer?.account;
    if (account?.balance_uah != null) return account.balance_uah;
    if (account?.balance_text) return parseMoney(account.balance_text);
  }
  return null;
}

function getBondUnitCost(bond) {
  if (isCatalogBondMissingBuyPrice(bond) && parseMoney(bond?.buy_price) == null) {
    return null;
  }

  const calc = bond?.calculator || {};
  const nominal = calc.nominal || parseMoney(bond?.nominal_value) || 1000;
  const pricePct = calc.pricePct ?? 100;
  const fromBuy = parseMoney(bond?.buy_price);
  if (fromBuy != null && fromBuy > 0) {
    const qty = Math.max(1, parseInt(bond?.quantity, 10) || 1);
    if (bond?.kind === 'holding' && qty > 1 && fromBuy / qty / nominal * 100 >= 40) {
      return fromBuy / qty;
    }
    if (bond?.kind !== 'holding' || qty <= 1) return fromBuy;
  }
  return nominal * (pricePct / 100);
}

function canShowUniverTopUp() {
  return deskCtx.isSiteAuthenticated('privat');
}

async function openUniverTopUpFromPrivat() {
  if (!window.openUniverTopUpPaymentModal) {
    throw new Error('Форма поповнення недоступна');
  }
  await window.openUniverTopUpPaymentModal();
}

function renderBalanceStrip() {
  const container = document.getElementById('balance-strip-items');
  if (!container) return;

  const data = deskCtx.getCachedData();
  const sessions = deskCtx.getSessionStates();
  const showUniverTopUp = canShowUniverTopUp();

  const scanFailures = deskCtx.getScanFailures?.() || {};

  container.innerHTML = SITE_ORDER.map((siteId) => {
    const status = sessions[siteId]?.status || 'unknown';
    const name = SITE_LABELS[siteId] || siteId;
    const balance = getSiteBalance(siteId, data);
    const balanceText = balance != null
      ? formatUah(balance)
      : '—';
    const active = deskCtx.getCurrentSource?.() === siteId ? ' active' : '';
    const scanFailed = Boolean(scanFailures[siteId]);
    const scanFailedClass = scanFailed ? ' scan-failed' : '';
    const scanFailedHint = scanFailed ? ` · ${escapeHtml(scanFailures[siteId])}` : '';

    const chip = `
      <button type="button" class="balance-chip${active}${scanFailedClass}" data-balance-site="${siteId}" title="${escapeHtml(name)}: ${escapeHtml(sessionLabel(siteId))}${scanFailedHint} · відкрити портфель">
        <span class="status-dot status-${status}"></span>
        <span class="balance-chip-text"><span class="balance-chip-name">${name}</span> ${escapeHtml(balanceText)}</span>
      </button>
    `;

    if (siteId !== 'univer' || !showUniverTopUp) return chip;

    return `
      <span class="balance-chip-group">
        ${chip}
        <button
          type="button"
          class="balance-topup-btn"
          data-univer-topup
          title="Поповнити UNIVER через Приват24"
        >Поповнити</button>
      </span>
    `;
  }).join('');
}

function openDrawer(mode) {
  drawerMode = mode;
  const drawer = document.getElementById('desk-drawer');
  const backdrop = document.getElementById('desk-drawer-backdrop');
  const buyPanel = document.getElementById('drawer-buy');
  const calcPanel = document.getElementById('drawer-calc');
  if (!drawer || !backdrop) return;

  buyPanel.hidden = mode !== 'buy';
  calcPanel.hidden = mode !== 'calc';

  drawer.hidden = false;
  drawer.setAttribute('aria-hidden', 'false');
  backdrop.hidden = false;
  document.body.classList.add('drawer-open');
  window.syncToolbarNavActive?.();
}

function closeDrawer() {
  if (buyProgressActive && siteSupports(drawerBond?.site_id, 'purchaseConfirmWatcher')) {
    window.inzhurShell?.stopPrivatConfirmWatcher?.();
    endBuyProgress();
  }
  resetPrivatCommissionsQuote();
  const drawer = document.getElementById('desk-drawer');
  const backdrop = document.getElementById('desk-drawer-backdrop');
  if (drawer) {
    drawer.hidden = true;
    drawer.setAttribute('aria-hidden', 'true');
  }
  if (backdrop) backdrop.hidden = true;
  document.body.classList.remove('drawer-open');
  drawerBond = null;
  drawerMode = null;
  window.syncToolbarNavActive?.();
}

function isCalcDrawerOpen() {
  return drawerMode === 'calc';
}

function parsePaymentAccounts(raw) {
  return String(raw || '')
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean);
}

function configurePrivatBuyAccountField(siteId) {
  const section = document.getElementById('drawer-buy-privat-account');
  const input = document.getElementById('buy-privat-account-input');
  const datalist = document.getElementById('buy-privat-account-options');
  if (!section || !input || !datalist) return;

  const isPrivat = siteId === 'privat';
  section.hidden = !isPrivat;
  if (!isPrivat) {
    input.value = '';
    datalist.innerHTML = '';
    return;
  }

  const privatSite = deskCtx.getOnboardingState()?.sites?.privat || {};
  const accounts = parsePaymentAccounts(privatSite.paymentAccounts);
  const preferred = privatSite.lastPaymentAccount
    || accounts[0]
    || '';

  datalist.innerHTML = accounts.map((account) => `
    <option value="${escapeHtml(account)}"></option>
  `).join('');
  input.value = preferred;
}

function resolvePrivatBondSource(bond) {
  const raw = bond?.raw_fields || {};
  const candidates = [raw.bondSource, raw.buySource, raw.source];
  for (const value of candidates) {
    const parsed = Number(value);
    if (Number.isFinite(parsed) && parsed > 0) return parsed;
  }
  return 3;
}

function resetPrivatCommissionsQuote() {
  privatCommissionsQuote = null;
  privatCommissionsLoading = false;
  privatCommissionsRequestId += 1;
  if (privatCommissionsTimer) {
    clearTimeout(privatCommissionsTimer);
    privatCommissionsTimer = null;
  }
}

function schedulePrivatCommissionsRefresh() {
  if (!drawerBond || drawerBond.site_id !== 'privat') return;
  if (privatCommissionsTimer) clearTimeout(privatCommissionsTimer);
  privatCommissionsTimer = setTimeout(() => {
    privatCommissionsTimer = null;
    refreshPrivatCommissionsQuote();
  }, 350);
}

async function refreshPrivatCommissionsQuote() {
  if (!drawerBond || drawerBond.site_id !== 'privat') return;

  const shell = window.inzhurShell;
  if (!shell?.getPrivatCommissions) return;

  const qtyInput = document.getElementById('buy-quantity-input');
  const quantity = Math.max(1, parseInt(qtyInput?.value || '1', 10) || 1);
  const isin = drawerBond.isin || '';
  if (!isin) return;

  const requestId = privatCommissionsRequestId + 1;
  privatCommissionsRequestId = requestId;
  privatCommissionsLoading = true;
  updateBuyDrawerSummary();

  try {
    const source = resolvePrivatBondSource(drawerBond);
    const quote = await shell.getPrivatCommissions(isin, quantity, source);
    if (requestId !== privatCommissionsRequestId) return;
    privatCommissionsQuote = quote?.ok ? quote : null;
  } catch {
    if (requestId !== privatCommissionsRequestId) return;
    privatCommissionsQuote = null;
  } finally {
    if (requestId === privatCommissionsRequestId) {
      privatCommissionsLoading = false;
      updateBuyDrawerSummary();
    }
  }
}

function getDrawerBuyEconomics() {
  if (!drawerBond) {
    return {
      quantity: 1,
      unitCost: 0,
      total: 0,
      balance: null,
      after: null,
      insufficient: false,
      commission: null,
      priceFromApi: false,
      commissionsLoading: false,
    };
  }

  const qtyInput = document.getElementById('buy-quantity-input');
  const quantity = Math.max(1, parseInt(qtyInput?.value || '1', 10) || 1);
  const unitCost = getBondUnitCost(drawerBond);
  let total = unitCost != null ? unitCost * quantity : null;
  let commission = null;
  let priceFromApi = false;

  if (drawerBond.site_id === 'privat' && privatCommissionsQuote?.ok) {
    if (privatCommissionsQuote.total != null) {
      total = privatCommissionsQuote.total;
      priceFromApi = true;
    }
    commission = privatCommissionsQuote.commission;
  }

  const balance = getSiteBalance(drawerBond.site_id, deskCtx.getCachedData());
  const after = balance != null && total != null ? balance - total : null;

  return {
    quantity,
    unitCost,
    total,
    balance,
    after,
    insufficient: after != null && after < 0,
    commission,
    priceFromApi,
    commissionsLoading: drawerBond.site_id === 'privat' && privatCommissionsLoading,
  };
}

let buyProgressActive = false;
let activeBuyRunId = null;

function isOtpBuyUiVisible() {
  const gmail = document.getElementById('drawer-gmail-otp-poll');
  const gmailVisible = Boolean(gmail && !gmail.hidden);
  return gmailVisible || document.body.classList.contains('otp-modal-open');
}

function syncPreOtpBuyCancel() {
  const btn = document.getElementById('btn-drawer-buy-cancel');
  if (!btn) return;
  const show = buyProgressActive
    && drawerBond?.site_id === 'univer'
    && Boolean(activeBuyRunId)
    && !isOtpBuyUiVisible();
  btn.hidden = !show;
  btn.disabled = !show;
}

function getBuyProgressEls() {
  return {
    wrap: document.getElementById('drawer-buy-progress'),
    statusEl: document.getElementById('drawer-buy-status'),
    spinner: document.querySelector('#drawer-buy-progress .buy-progress-spinner'),
    tick: document.querySelector('#drawer-buy-progress .buy-progress-tick'),
  };
}

function isBuySuccessStep(stepOrPayload) {
  const payload = stepOrPayload && typeof stepOrPayload === 'object'
    ? stepOrPayload
    : { step: stepOrPayload };
  if (payload.action === 'complete') return true;
  const step = String(payload.step || '');
  return /успіш/i.test(step) || /замовлення успіш/i.test(step);
}

function setBuyProgressIndicator(mode) {
  const { spinner, tick } = getBuyProgressEls();
  const showTick = mode === 'success';
  if (spinner) spinner.hidden = showTick;
  if (tick) tick.hidden = !showTick;
}

function setBuyAutoBusy(busy) {
  const btn = document.getElementById('btn-drawer-buy-auto');
  if (btn) btn.disabled = busy;
}

function showBuyProgress(step, options = {}) {
  const success = options.success || isBuySuccessStep(step);
  const { wrap, statusEl } = getBuyProgressEls();
  if (wrap) {
    wrap.hidden = false;
    wrap.classList.remove('error');
    wrap.classList.toggle('success', success);
  }
  setBuyProgressIndicator(success ? 'success' : 'busy');
  if (statusEl) statusEl.textContent = step || '—';
  if (success) {
    buyProgressActive = false;
    setBuyAutoBusy(false);
    window.BusyOverlay?.set('buy', false);
  } else {
    window.BusyOverlay?.update('buy', step);
  }
}

function hideBuyProgress() {
  const { wrap } = getBuyProgressEls();
  if (wrap) {
    wrap.hidden = true;
    wrap.classList.remove('error', 'success');
  }
}

function showGmailOtpPollMessage(payload = {}) {
  const panel = document.getElementById('drawer-gmail-otp-poll');
  const textEl = document.getElementById('drawer-gmail-otp-poll-text');
  if (!panel || !textEl) return;

  const orderRef = payload.orderId ? ` (замовлення #${payload.orderId})` : '';
  const isinRef = payload.isin ? ` · ${payload.isin}` : '';
  textEl.textContent =
    `Перевіряємо Gmail (листи від noreply@univer.ua) на код перевірки UNIVER${orderRef}${isinRef}. `
    + 'Код підставиться автоматично, коли лист надійде. Деталі — у «Журнал дій».';

  panel.hidden = false;
  showBuyProgress('Очікування коду з Gmail…');
  buyProgressActive = true;
  setBuyAutoBusy(true);
  syncPreOtpBuyCancel();
}

function hideGmailOtpPollMessage() {
  const panel = document.getElementById('drawer-gmail-otp-poll');
  if (panel) panel.hidden = true;
  syncPreOtpBuyCancel();
}

function formatBuyErrorMessage(err) {
  const raw = String(err?.message || err || '');
  const ipcMatch = raw.match(/Error invoking remote method '[^']+': (?:(?:Error|DOMException): )?(.+)$/s);
  const text = (ipcMatch?.[1] || raw).trim();
  if (err?.code === 'USER_CANCELLED' || /^Купівлю скасовано$/i.test(text)) {
    return 'Купівлю скасовано';
  }
  if (/^Скасовано користувачем$/i.test(text)) {
    return 'Купівлю скасовано';
  }
  return text || 'Помилка купівлі';
}

function showBuyError(_statusEl, message) {
  const text = message || 'Помилка купівлі';
  deskCtx.setScanStatus(text, true);
  const { wrap, statusEl } = getBuyProgressEls();
  if (wrap) {
    wrap.hidden = false;
    wrap.classList.remove('success');
    wrap.classList.add('error');
  }
  setBuyProgressIndicator('hidden');
  if (statusEl) statusEl.textContent = text;
}

function showBuySuccess(message = 'Замовлення успішне', detail = '') {
  deskCtx.setScanStatus(message, false, detail ? { meta: detail } : undefined);
  const { wrap, statusEl } = getBuyProgressEls();
  if (wrap) {
    wrap.hidden = false;
    wrap.classList.remove('error');
    wrap.classList.add('success');
  }
  setBuyProgressIndicator('success');
  if (statusEl) statusEl.textContent = message;
  buyProgressActive = false;
  setBuyAutoBusy(false);
  window.BusyOverlay?.set('buy', false);
}

function startBuyProgress(siteId, step) {
  buyProgressActive = true;
  activeBuyRunId = null;
  setBuyAutoBusy(true);
  syncPreOtpBuyCancel();
  const initialStep = step || 'Підготовка купівлі';
  showBuyProgress(initialStep);
  window.BusyOverlay?.set('buy', true, initialStep);
}

function endBuyProgress(options = {}) {
  buyProgressActive = false;
  activeBuyRunId = null;
  setBuyAutoBusy(false);
  syncPreOtpBuyCancel();
  window.BusyOverlay?.set('buy', false);
  if (!options.keepVisible) hideBuyProgress();
  updateBuyDrawerSummary();
}

function handleBuyProgress(payload) {
  if (!buyProgressActive && !isBuySuccessStep(payload)) return;
  if (!payload?.siteId || (
    !siteSupports(payload.siteId, 'univerBuy')
    && !siteSupports(payload.siteId, 'purchaseConfirmWatcher')
  )) return;
  if (!payload?.step) return;
  if (payload.runId) activeBuyRunId = payload.runId;
  showBuyProgress(payload.step, { success: isBuySuccessStep(payload) });
  syncPreOtpBuyCancel();
}

function syncPrivatConfirmFromLog(entries) {
  const step = privatConfirmStepFromLogFallback(entries);
  if (!step) return;

  if (buyProgressActive && siteSupports(drawerBond?.site_id, 'purchaseConfirmWatcher')) {
    showBuyProgress(step);
  }
  if (buySignInBusy) {
    window.BusyOverlay?.update('signin', step);
  }
}

function privatConfirmStepFromLogFallback(entries = []) {
  for (const entry of entries) {
    if (entry?.siteId !== 'privat') continue;
    const message = String(entry.message || '');
    if (entry.level === 'warning' && /підтверд|очікуємо підтвердження|SmartID|дзвінок|QR|SMS|Sender/i.test(message)) {
      return message;
    }
    if (entry.level === 'info' && /очікуємо підтвердження|підтвердіть у телефон/i.test(message)) {
      return message;
    }
  }
  return null;
}

function updateBuyDrawerSummary() {
  if (!drawerBond) return;

  const {
    total,
    balance,
    after,
    insufficient,
    commission,
    priceFromApi,
    commissionsLoading,
  } = getDrawerBuyEconomics();

  const totalEl = document.getElementById('buy-total-price');
  if (totalEl) {
    if (commissionsLoading) {
      totalEl.textContent = '…';
    } else if (total != null) {
      totalEl.textContent = priceFromApi ? formatUah(total) : `≈ ${formatUah(total)}`;
    } else {
      totalEl.textContent = '≈ —';
    }
  }

  const hintEl = document.getElementById('buy-price-hint');
  if (hintEl) {
    if (commissionsLoading) {
      hintEl.textContent = 'розрахунок у Приват24…';
    } else if (priceFromApi && commission != null) {
      hintEl.textContent = `комісія ${formatUah(commission)} · тариф Приват24`;
    } else if (priceFromApi) {
      hintEl.textContent = 'тариф Приват24';
    } else if (drawerBond.site_id === 'privat') {
      hintEl.textContent = 'орієнтовно з каталогу';
    } else {
      hintEl.textContent = 'номінал × ціна';
    }
  }

  const balanceLineEl = document.getElementById('buy-balance-line');
  const warningEl = document.getElementById('drawer-buy-warning');
  let warningMessage = null;

  if (balance != null) {
    if (balanceLineEl) {
      balanceLineEl.textContent = `Баланс: ${formatUah(balance)} · після: ${formatUah(after)}`;
    }
    if (insufficient) {
      warningMessage = 'Недостатньо коштів на рахунку — перевірте баланс або зменште кількість.';
    }
  } else {
    const authed = deskCtx.isSiteAuthenticated(drawerBond.site_id);
    if (balanceLineEl) {
      balanceLineEl.textContent = authed
        ? 'Баланс: — · після: —'
        : 'Баланс: увійдіть · після: —';
    }
    if (!authed) {
      warningMessage = 'Потрібна активна сесія. Налаштуйте платформу у розділі «Особисті дані».';
    } else if (siteSupports(drawerBond.site_id, 'portfolioBalanceHint')) {
      warningMessage = `Оновіть портфель (↻), щоб побачити баланс ${getSiteLabel(drawerBond.site_id)}.`;
    }
  }

  if (siteSupports(drawerBond.site_id, 'requiresPaymentAccount') && !getPrivatPaymentAccount()) {
    warningMessage = 'Вкажіть картку або рахунок для купівлі.';
  }

  if (warningEl) {
    warningEl.hidden = !warningMessage;
    if (warningMessage) warningEl.textContent = warningMessage;
    warningEl.classList.toggle('error', Boolean(insufficient));
  }

  const buyAutoBtn = document.getElementById('btn-drawer-buy-auto');
  const canBuy = drawerBond.is_buyable !== false
    && drawerBond.kind !== 'holding'
    && deskCtx.isSiteAuthenticated(drawerBond.site_id)
    && (!siteSupports(drawerBond.site_id, 'requiresPaymentAccount') || Boolean(getPrivatPaymentAccount()))
    && !(siteSupports(drawerBond.site_id, 'purchaseBalanceCheck') && insufficient);
  if (buyAutoBtn) {
    buyAutoBtn.disabled = !canBuy;
    buyAutoBtn.textContent = 'Купити (авто)';
  }
}

let buySignInBusy = false;

function closePlatformBuyPicker() {
  const modal = document.getElementById('platform-buy-picker');
  if (!modal) return;
  modal.classList.remove('open');
  platformPickerBonds = [];
}

function openPlatformBuyPicker(bonds, options = {}) {
  const listings = (bonds || []).filter((bond) => bond && bond.kind !== 'holding');
  const buyable = listings.filter((bond) => bond.is_buyable !== false);
  if (!buyable.length) return;
  if (buyable.length === 1) {
    openBuyDrawer(buyable[0], options);
    return;
  }

  const modal = document.getElementById('platform-buy-picker');
  const context = document.getElementById('platform-buy-picker-context');
  const optionsEl = document.getElementById('platform-buy-picker-options');
  if (!modal || !optionsEl) return;

  platformPickerBonds = listings;
  const isin = listings[0]?.isin || '—';
  if (context) {
    context.textContent = listings.length === buyable.length
      ? isin
      : `${isin} · доступно на ${buyable.length} з ${listings.length} платформ`;
  }

  const sorted = [...listings].sort(
    (a, b) => SITE_ORDER.indexOf(a.site_id) - SITE_ORDER.indexOf(b.site_id),
  );
  let bestPrice = Infinity;
  sorted.forEach((bond) => {
    const priceVal = parseMoney(bond.buy_price);
    if (priceVal != null && priceVal < bestPrice) bestPrice = priceVal;
  });

  optionsEl.innerHTML = sorted.map((bond) => {
    const siteId = bond.site_id;
    const label = SITE_LABELS[siteId] || siteId;
    const canBuy = bond.is_buyable !== false;
    const price = typeof formatBondCostUah === 'function' ? formatBondCostUah(bond) : '—';
    const yieldStr = typeof formatYieldForBond === 'function' ? formatYieldForBond(bond) : '—';
    const priceVal = parseMoney(bond.buy_price);
    const isBest = canBuy && priceVal != null && priceVal === bestPrice;
    return `
      <button
        type="button"
        class="platform-buy-chip bond-badge ${siteBadgeClass(siteId)}${canBuy ? '' : ' platform-buy-chip-disabled'}${isBest ? ' platform-buy-chip-best' : ''}"
        data-site="${escapeHtml(siteId)}"
        ${canBuy ? '' : 'disabled'}
      >
        <span class="platform-buy-chip-name">${escapeHtml(label)}</span>
        <span class="platform-buy-chip-meta">${escapeHtml(yieldStr)} · ${escapeHtml(price)}</span>
        ${isBest ? '<span class="platform-buy-chip-note">найкраща ціна</span>' : ''}
        ${!canBuy ? '<span class="platform-buy-chip-note">недоступно</span>' : ''}
      </button>
    `;
  }).join('');

  optionsEl.querySelectorAll('.platform-buy-chip:not([disabled])').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const bond = platformPickerBonds.find((entry) => entry.site_id === btn.dataset.site);
      closePlatformBuyPicker();
      if (bond) await openBuyDrawer(bond, options);
    });
  });

  modal.classList.add('open');
  optionsEl.querySelector('.platform-buy-chip:not([disabled])')?.focus();
}

async function openBuyDrawer(bond, options = {}) {
  if (!bond || bond.kind === 'holding') return;
  if (buySignInBusy) return;

  const siteId = bond.site_id;
  const siteName = SITE_LABELS[siteId] || siteId;

  if (!deskCtx.isSiteAuthenticated(siteId)) {
    buySignInBusy = true;
    const signInMessage = `Спроба входу на ${siteName}…`;
    deskCtx.setScanStatus(signInMessage);
    window.BusyOverlay?.set('signin', true, signInMessage);
    try {
      const shell = deskCtx.requireShell();
      const result = await shell.ensureSiteSignIn(siteId);
      await deskCtx.refreshSessionStates?.();
      if (result?.message) {
        deskCtx.setScanStatus(result.message, !result.authenticated);
      }
    } catch (err) {
      deskCtx.setScanStatus(err.message || 'Помилка входу', true);
    } finally {
      buySignInBusy = false;
      window.BusyOverlay?.set('signin', false);
    }
  }

  drawerBond = bond;

  document.getElementById('desk-drawer-kicker').textContent = `${bond.isin || '—'} · ${siteName}`;
  document.getElementById('desk-drawer-title').textContent = bond.title || 'Купівля';

  const qtyInput = document.getElementById('buy-quantity-input');
  if (qtyInput) {
    qtyInput.value = String(
      options.quantity ?? bond.calculator?.quantity ?? 1,
    );
  }

  const statusEl = document.getElementById('drawer-buy-progress');
  if (statusEl) statusEl.hidden = true;
  hideBuyProgress();

  configurePrivatBuyAccountField(bond.site_id);
  resetPrivatCommissionsQuote();
  openDrawer('buy');
  updateBuyDrawerSummary();
  if (bond.site_id === 'privat') {
    schedulePrivatCommissionsRefresh();
  }
}

function openCalcDrawer(bond) {
  drawerBond = bond || null;
  const calcToBuyBtn = document.getElementById('btn-drawer-calc-to-buy');

  if (bond) {
    document.getElementById('desk-drawer-kicker').textContent = SITE_LABELS[bond.site_id] || bond.site_id;
    document.getElementById('desk-drawer-title').textContent = bond.isin || 'Калькулятор';
    if (window.fillCalculatorFields) {
      window.fillCalculatorFields(bond);
    }
    if (calcToBuyBtn) {
      calcToBuyBtn.hidden = bond.kind === 'holding' || bond.is_buyable === false;
    }
  } else {
    document.getElementById('desk-drawer-kicker').textContent = 'Калькулятор';
    document.getElementById('desk-drawer-title').textContent = 'Калькулятор';
    if (calcToBuyBtn) calcToBuyBtn.hidden = true;
    if (window.fillCalculatorFields) window.fillCalculatorFields(null);
    else if (window.calculate) window.calculate();
  }

  openDrawer('calc');
}

function openCalcDrawerFree() {
  openCalcDrawer(null);
}

async function executeBuyFromDrawer(mode) {
  if (!drawerBond) return;
  const shell = deskCtx.requireShell();
  const isin = drawerBond.isin || '';
  const siteId = drawerBond.site_id;
  const quantity = Math.max(1, parseInt(document.getElementById('buy-quantity-input')?.value || '1', 10) || 1);
  const paymentAccount = siteId === 'privat' ? getPrivatPaymentAccount() : undefined;

  if (siteId === 'privat' && !paymentAccount) {
    showBuyError(null, 'Вкажіть картку або рахунок');
    return;
  }

  if (mode === 'auto') {
    if (siteId === 'univer' && getDrawerBuyEconomics().insufficient) {
      showBuyError(null, 'Недостатньо коштів на рахунку — перевірте баланс або зменште кількість.');
      return;
    }

    if (siteId !== 'univer' && siteId !== 'privat') {
      startBuyProgress(siteId, 'Виконується…');
    } else {
      startBuyProgress(siteId, 'Підготовка купівлі');
    }

    try {
      if (siteId === 'univer' && isin) {
        await window.ensureGmailOAuthForUniverBuy?.();
        const result = await shell.runUniverBuy(isin, quantity);
        if (result?.orderId) {
          window.registerPendingUniverOrder?.({
            orderId: result.orderId,
            isin,
            quantity,
          });
        }
        const detail = result?.orderId
          ? `Замовлення #${result.orderId} · ${isin} × ${quantity}`
          : `${isin} × ${quantity}`;
        showBuySuccess('Замовлення успішне', detail);
        await new Promise((resolve) => setTimeout(resolve, 1400));
        if (result?.orderId) {
          await window.navigateToOrdersAfterUniverBuy?.();
        }
        closeDrawer();
        hideBuyProgress();
        return;
      } else {
        await shell.runPurchaseRoute(
          siteId,
          isin || undefined,
          paymentAccount,
          siteId === 'privat' ? { watchConfirmation: true } : undefined,
        );
        if (siteId === 'privat') {
          deskCtx.setScanStatus('Завершіть купівлю в браузері Приват24');
          return;
        }
        deskCtx.setScanStatus(
          isin
            ? `Відкрито купівлю ${isin} на ${SITE_LABELS[siteId] || siteId}`
            : `Відкрито сторінку купівлі ${SITE_LABELS[siteId] || siteId}`,
        );
      }
      closeDrawer();
    } catch (err) {
      showBuyError(null, formatBuyErrorMessage(err));
      endBuyProgress({ keepVisible: true });
      return;
    }
    endBuyProgress();
    return;
  }

  await shell.runPurchaseRoute(siteId, isin || undefined, paymentAccount);
  deskCtx.setScanStatus(isin ? `Відкрито ${isin} на ${SITE_LABELS[siteId] || siteId}` : 'Відкрито сторінку');
  closeDrawer();
}

function wireDeskUi() {
  document.getElementById('desk-drawer-close')?.addEventListener('click', closeDrawer);
  document.getElementById('desk-drawer-backdrop')?.addEventListener('click', closeDrawer);

  document.getElementById('buy-quantity-input')?.addEventListener('input', () => {
    if (drawerBond?.site_id === 'privat') {
      privatCommissionsQuote = null;
      schedulePrivatCommissionsRefresh();
    }
    updateBuyDrawerSummary();
  });
  document.getElementById('buy-privat-account-input')?.addEventListener('input', updateBuyDrawerSummary);

  document.getElementById('btn-drawer-buy-auto')?.addEventListener('click', () => {
    executeBuyFromDrawer('auto');
  });

  document.getElementById('btn-drawer-buy-cancel')?.addEventListener('click', async () => {
    const runId = activeBuyRunId;
    const btn = document.getElementById('btn-drawer-buy-cancel');
    if (!runId || !btn || btn.disabled) return;
    btn.disabled = true;
    try {
      await window.inzhurShell?.cancelAutomationOtp?.(runId);
    } catch (err) {
      showBuyError(null, formatBuyErrorMessage(err));
    }
  });

  document.getElementById('btn-drawer-buy-route')?.addEventListener('click', () => {
    executeBuyFromDrawer('route');
  });

  document.getElementById('btn-drawer-buy-calc')?.addEventListener('click', () => {
    if (drawerBond) openCalcDrawer(drawerBond);
  });

  document.getElementById('btn-drawer-calc-to-buy')?.addEventListener('click', () => {
    if (!drawerBond) return;
    const qty = Math.max(1, parseInt(document.getElementById('quantity')?.value || '1', 10) || 1);
    openBuyDrawer(drawerBond, { quantity: qty });
  });

  document.getElementById('btn-calc-open-privat-quote')?.addEventListener('click', async () => {
    if (!drawerBond || drawerBond.site_id !== 'privat') return;
    const shell = deskCtx.requireShell();
    const isin = drawerBond.isin || undefined;
    await shell.runPurchaseRoute('privat', isin);
    deskCtx.setScanStatus(isin ? `Відкрито котирування ${isin} у Приват24` : 'Відкрито котирування у Приват24');
  });

  document.getElementById('btn-toolbar-calculator')?.addEventListener('click', openCalcDrawerFree);

  document.getElementById('balance-strip')?.addEventListener('click', async (event) => {
    const topUpBtn = event.target.closest('[data-univer-topup]');
    if (topUpBtn) {
      event.preventDefault();
      event.stopPropagation();
      try {
        await openUniverTopUpFromPrivat();
      } catch (err) {
        deskCtx.setScanStatus(err.message || 'Помилка поповнення UNIVER', true);
      }
      return;
    }

    const chip = event.target.closest('[data-balance-site]');
    if (!chip) return;
    if (deskCtx.onBalanceChipClick) {
      deskCtx.onBalanceChipClick(chip.dataset.balanceSite);
      return;
    }
    deskCtx.onFilterSource(chip.dataset.balanceSite);
  });

  document.getElementById('btn-balance-refresh')?.addEventListener('click', () => {
    deskCtx.runPortfolioRefresh();
  });

  window.onUniverTopUpConfirmed = (amount) => {
    deskCtx.setScanStatus(`Форма оплати UNIVER — ${amount} ₴`);
  };

  window.inzhurShell?.onPrivatPaymentStep?.((payload) => {
    if (!payload?.message) return;
    const meta = payload.total
      ? payload.total
      : (payload.serviceName || undefined);
    deskCtx.setScanStatus(payload.message, false, meta ? { meta } : undefined);
  });

  document.getElementById('platform-buy-picker-cancel')?.addEventListener('click', closePlatformBuyPicker);
  document.getElementById('platform-buy-picker')?.addEventListener('click', (event) => {
    if (event.target.id === 'platform-buy-picker') closePlatformBuyPicker();
  });

  document.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape') return;
    if (document.getElementById('platform-buy-picker')?.classList.contains('open')) {
      closePlatformBuyPicker();
      return;
    }
    if (drawerMode) closeDrawer();
  });

  window.inzhurShell?.onAutomationBuyProgress?.(handleBuyProgress);
  window.inzhurShell?.onAutomationLog?.((entries) => {
    syncPrivatConfirmFromLog(entries);
  });
}

function initDeskUi(context) {
  deskCtx = { ...deskCtx, ...context };
  wireDeskUi();
}

window.showGmailOtpPollMessage = showGmailOtpPollMessage;
window.syncPreOtpBuyCancel = syncPreOtpBuyCancel;
window.hideGmailOtpPollMessage = hideGmailOtpPollMessage;

window.initDeskUi = initDeskUi;
window.renderBalanceStrip = renderBalanceStrip;
window.openBuyDrawer = openBuyDrawer;
window.openPlatformBuyPicker = openPlatformBuyPicker;
window.closePlatformBuyPicker = closePlatformBuyPicker;
window.openCalcDrawer = openCalcDrawer;
window.openCalcDrawerFree = openCalcDrawerFree;
window.isCalcDrawerOpen = isCalcDrawerOpen;
window.closeDeskDrawer = closeDrawer;
