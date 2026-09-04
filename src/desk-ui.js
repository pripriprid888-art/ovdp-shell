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
  if (bond?.site_id === 'privat' && bond?.kind !== 'holding' && parseMoney(bond?.buy_price) == null) {
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

function renderBalanceStrip() {
  const container = document.getElementById('balance-strip-items');
  if (!container) return;

  const data = deskCtx.getCachedData();
  const sessions = deskCtx.getSessionStates();

  container.innerHTML = SITE_ORDER.map((siteId) => {
    const status = sessions[siteId]?.status || 'unknown';
    const name = SITE_LABELS[siteId] || siteId;
    const balance = getSiteBalance(siteId, data);
    const balanceText = balance != null
      ? formatUah(balance)
      : '—';

    return `
      <button type="button" class="balance-chip" data-balance-site="${siteId}" title="${name}: ${sessionLabel(siteId)}">
        <span class="status-dot status-${status}"></span>
        <span class="balance-chip-text"><span class="balance-chip-name">${name}</span> ${escapeHtml(balanceText)}</span>
      </button>
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
  if (drawerBond?.site_id === 'privat' && buyProgressActive) {
    window.inzhurShell?.stopPrivatConfirmWatcher?.();
    endBuyProgress();
  }
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

function getDrawerBuyEconomics() {
  if (!drawerBond) {
    return { quantity: 1, unitCost: 0, total: 0, balance: null, after: null, insufficient: false };
  }

  const qtyInput = document.getElementById('buy-quantity-input');
  const quantity = Math.max(1, parseInt(qtyInput?.value || '1', 10) || 1);
  const unitCost = getBondUnitCost(drawerBond);
  const total = unitCost != null ? unitCost * quantity : null;
  const balance = getSiteBalance(drawerBond.site_id, deskCtx.getCachedData());
  const after = balance != null && total != null ? balance - total : null;

  return {
    quantity,
    unitCost,
    total,
    balance,
    after,
    insufficient: after != null && after < 0,
  };
}

let buyProgressActive = false;

function getBuyProgressEls() {
  return {
    wrap: document.getElementById('drawer-buy-progress'),
    statusEl: document.getElementById('drawer-buy-status'),
    spinner: document.querySelector('#drawer-buy-progress .buy-progress-spinner'),
  };
}

function setBuyAutoBusy(busy) {
  const btn = document.getElementById('btn-drawer-buy-auto');
  if (btn) btn.disabled = busy;
}

function showBuyProgress(step) {
  const { wrap, statusEl, spinner } = getBuyProgressEls();
  if (wrap) {
    wrap.hidden = false;
    wrap.classList.remove('error');
  }
  if (spinner) spinner.hidden = false;
  if (statusEl) statusEl.textContent = step || '—';
  window.BusyOverlay?.update('buy', step);
}

function hideBuyProgress() {
  const { wrap } = getBuyProgressEls();
  if (wrap) {
    wrap.hidden = true;
    wrap.classList.remove('error');
  }
}

function showBuyError(_statusEl, message) {
  const text = message || 'Помилка купівлі';
  deskCtx.setScanStatus(text, true);
  const { wrap, statusEl, spinner } = getBuyProgressEls();
  if (wrap) {
    wrap.hidden = false;
    wrap.classList.add('error');
  }
  if (spinner) spinner.hidden = true;
  if (statusEl) statusEl.textContent = text;
}

function startBuyProgress(siteId, step) {
  buyProgressActive = true;
  setBuyAutoBusy(true);
  const initialStep = step || 'Підготовка купівлі';
  showBuyProgress(initialStep);
  window.BusyOverlay?.set('buy', true, initialStep);
}

function endBuyProgress(options = {}) {
  buyProgressActive = false;
  setBuyAutoBusy(false);
  window.BusyOverlay?.set('buy', false);
  if (!options.keepVisible) hideBuyProgress();
  updateBuyDrawerSummary();
}

function handleBuyProgress(payload) {
  if (!buyProgressActive) return;
  if (!payload?.siteId || !['univer', 'privat'].includes(payload.siteId)) return;
  if (!payload?.step) return;
  showBuyProgress(payload.step);
}

function syncPrivatConfirmFromLog(entries) {
  const step = privatConfirmStepFromLogFallback(entries);
  if (!step) return;

  if (buyProgressActive && drawerBond?.site_id === 'privat') {
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

  const { quantity, total, balance, after, insufficient } = getDrawerBuyEconomics();

  document.getElementById('buy-total-price').textContent = total != null ? `≈ ${formatUah(total)}` : '≈ —';

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
    } else if (drawerBond.site_id === 'univer') {
      warningMessage = 'Оновіть портфель (↻), щоб побачити баланс UNIVER.';
    }
  }

  if (drawerBond.site_id === 'privat' && !getPrivatPaymentAccount()) {
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
    && (drawerBond.site_id !== 'privat' || Boolean(getPrivatPaymentAccount()))
    && !(drawerBond.site_id === 'univer' && insufficient);
  if (buyAutoBtn) {
    buyAutoBtn.disabled = !canBuy;
    buyAutoBtn.textContent = 'Купити (авто)';
  }
}

let buySignInBusy = false;

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
  openDrawer('buy');
  updateBuyDrawerSummary();
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
        await shell.runUniverBuy(isin, quantity);
        deskCtx.setScanStatus(`Купівлю UNIVER ${isin} (${quantity} шт.) підтверджено`);
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
      showBuyError(null, err.message || 'Помилка купівлі');
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

  document.getElementById('buy-quantity-input')?.addEventListener('input', updateBuyDrawerSummary);
  document.getElementById('buy-privat-account-input')?.addEventListener('input', updateBuyDrawerSummary);

  document.getElementById('btn-drawer-buy-auto')?.addEventListener('click', () => {
    executeBuyFromDrawer('auto');
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

  document.getElementById('btn-toolbar-calculator')?.addEventListener('click', openCalcDrawerFree);

  document.getElementById('balance-strip')?.addEventListener('click', (event) => {
    const chip = event.target.closest('[data-balance-site]');
    if (!chip) return;
    deskCtx.onFilterSource(chip.dataset.balanceSite);
  });

  document.getElementById('btn-balance-refresh')?.addEventListener('click', () => {
    deskCtx.runPortfolioRefresh();
  });

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && drawerMode) closeDrawer();
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

window.initDeskUi = initDeskUi;
window.renderBalanceStrip = renderBalanceStrip;
window.openBuyDrawer = openBuyDrawer;
window.openCalcDrawer = openCalcDrawer;
window.openCalcDrawerFree = openCalcDrawerFree;
window.isCalcDrawerOpen = isCalcDrawerOpen;
window.closeDeskDrawer = closeDrawer;
