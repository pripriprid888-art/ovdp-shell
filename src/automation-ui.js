let otpRunId = null;
let otpSubmitting = false;
/** @type {object | null} */
let pendingOtpPayload = null;

function isStaleOtpError(message) {
  return /Немає активного|Завершено|Скасовано користувачем|Купівлю скасовано|минув/i.test(String(message || ''));
}
let actionLogViewDate = localDateKey(new Date());
let actionLogLevelFilter = 'all';
let actionLogSiteFilter = 'all';
let actionLogCategoryFilter = 'all';
let actionLogDebugMode = false;
let lastActionLogEntries = [];

function escapeHtml(text) {
  return String(text || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function localDateKey(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function formatLogTime(iso) {
  try {
    return new Date(iso).toLocaleTimeString('uk-UA', {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
  } catch {
    return '—';
  }
}

function formatLogDateLabel(dateKey) {
  if (!dateKey) return '';
  try {
    const [year, month, day] = dateKey.split('-').map(Number);
    const date = new Date(year, month - 1, day);
    return date.toLocaleDateString('uk-UA', {
      weekday: 'long',
      day: 'numeric',
      month: 'long',
      year: 'numeric',
    });
  } catch {
    return dateKey;
  }
}

function formatSiteLabel(siteId) {
  if (!siteId) return '';
  return window.getSiteLabel?.(siteId) || window.SITE_LABELS?.[siteId] || siteId.toUpperCase();
}

function formatLogDateOptionLabel(dateKey, today = localDateKey(new Date())) {
  if (dateKey === today) return 'Сьогодні';
  return formatLogDateLabel(dateKey);
}

function formatLogLevelLabel(level) {
  if (level === 'error') return 'Помилка';
  if (level === 'warning') return 'Увага';
  if (level === 'debug') return 'Debug';
  return 'Інфо';
}

function formatLogCategoryLabel(category) {
  const labels = {
    scan: 'Скан',
    session: 'Сесія',
    keepalive: 'Keepalive',
    'sign-in': 'Вхід',
    buy: 'Купівля',
    nbu: 'НБУ',
    system: 'Система',
    navigation: 'Навігація',
  };
  return labels[category] || category || '';
}

function formatLogContext(context) {
  if (!context || typeof context !== 'object') return '';
  try {
    return JSON.stringify(context, null, 2);
  } catch {
    return String(context);
  }
}

function formatLogErrorDetails(error) {
  if (!error || typeof error !== 'object') return '';
  const parts = [];
  if (error.name && error.name !== 'Error') parts.push(error.name);
  if (error.message) parts.push(error.message);
  if (error.code != null) parts.push(`code: ${error.code}`);
  if (error.stack) parts.push(error.stack);
  return parts.join('\n');
}

function extractIsinFromMessage(message) {
  const match = String(message || '').match(/UA\d{10}/i);
  return match ? match[0].toUpperCase() : null;
}

function getActionLogDateSelect() {
  return document.getElementById('action-log-date-select');
}

function getActionLogDateNativeInput() {
  return document.getElementById('action-log-date');
}

function syncActionLogDateControls(dateKey = actionLogViewDate) {
  const select = getActionLogDateSelect();
  const nativeInput = getActionLogDateNativeInput();
  if (select && dateKey) {
    if (![...select.options].some((option) => option.value === dateKey)) {
      const option = document.createElement('option');
      option.value = dateKey;
      option.textContent = formatLogDateOptionLabel(dateKey);
      select.insertBefore(option, select.firstChild);
    }
    select.value = dateKey;
  }
  if (nativeInput && nativeInput.value !== dateKey) {
    nativeInput.value = dateKey;
  }
  window.StyledSelect?.get('action-log-date-select')?.refresh();
}

function openActionLogDatePicker() {
  const nativeInput = getActionLogDateNativeInput();
  if (!nativeInput) return;
  nativeInput.value = actionLogViewDate;
  if (typeof nativeInput.showPicker === 'function') {
    try {
      nativeInput.showPicker();
      return;
    } catch {
      // showPicker can reject outside a user gesture
    }
  }
  nativeInput.focus({ preventScroll: true });
}

function wireActionLogDatePicker() {
  const nativeInput = getActionLogDateNativeInput();
  const openBtn = document.getElementById('btn-action-log-date-open');
  if (!nativeInput) return;

  openBtn?.addEventListener('click', (event) => {
    event.preventDefault();
    openActionLogDatePicker();
  });

  nativeInput.addEventListener('change', (event) => {
    const value = event.target.value;
    if (!value) return;
    loadBackgroundLog(value);
  });
}

async function populateActionLogDateOptions() {
  const select = getActionLogDateSelect();
  const nativeInput = getActionLogDateNativeInput();
  if (!select || !window.inzhurShell?.getAutomationLogDates) return;

  const today = localDateKey(new Date());
  const loggedDates = await window.inzhurShell.getAutomationLogDates();
  const dateKeys = [...new Set([today, actionLogViewDate, ...loggedDates])]
    .filter(Boolean)
    .sort()
    .reverse();

  select.innerHTML = dateKeys.map((dateKey) => {
    const label = formatLogDateOptionLabel(dateKey, today);
    return `<option value="${escapeHtml(dateKey)}">${escapeHtml(label)}</option>`;
  }).join('');

  select.value = dateKeys.includes(actionLogViewDate) ? actionLogViewDate : today;

  if (nativeInput && dateKeys.length) {
    nativeInput.min = dateKeys[dateKeys.length - 1];
    nativeInput.max = dateKeys[0];
    nativeInput.value = actionLogViewDate;
  }

  window.StyledSelect?.get('action-log-date-select')?.refresh();
}

function updateActionLogDateLabel() {
  const labelEl = document.getElementById('action-log-date-label');
  if (!labelEl) return;

  const today = localDateKey(new Date());
  if (actionLogViewDate === today) {
    labelEl.textContent = 'Сьогодні';
  } else {
    labelEl.textContent = formatLogDateLabel(actionLogViewDate);
  }
  syncActionLogDateControls(actionLogViewDate);
}

function filterActionLogEntries(entries = []) {
  return entries.filter((entry) => {
    const level = entry.level || 'info';
    const siteId = entry.siteId || '';
    const category = entry.category || '';
    if (level === 'debug' && !actionLogDebugMode && actionLogLevelFilter !== 'debug') return false;
    if (actionLogLevelFilter !== 'all' && level !== actionLogLevelFilter) return false;
    if (actionLogSiteFilter !== 'all' && siteId !== actionLogSiteFilter) return false;
    if (actionLogCategoryFilter !== 'all' && category !== actionLogCategoryFilter) return false;
    return true;
  });
}

function handleLogEntryClick(entry) {
  const isin = extractIsinFromMessage(entry.message);
  if (!isin) return;
  window.switchListKind?.('catalog');
  window.applySourceFilter?.('all');
  window.setScanStatus?.(`Знайдено ISIN з журналу: ${isin}`, false, {
    meta: 'Перевірте рядок у каталозі',
  });
}

function renderBackgroundLog(entries = lastActionLogEntries) {
  const container = document.getElementById('background-log');
  if (!container) return;

  lastActionLogEntries = entries;
  updateActionLogDateLabel();

  const filtered = filterActionLogEntries(entries);
  if (!filtered.length) {
    const hasAny = entries.length > 0;
    container.innerHTML = `<p class="background-log-empty">${hasAny ? 'Немає записів за обраними фільтрами.' : 'За цю дату записів немає.'}</p>`;
    return;
  }

  container.innerHTML = filtered.map((entry) => {
    const level = entry.level || 'info';
    const kind = entry.kind === 'automation' ? 'авто' : 'дія';
    const site = entry.siteId
      ? `<span class="log-site-badge">${escapeHtml(formatSiteLabel(entry.siteId))}</span>`
      : '';
    const category = entry.category
      ? `<span class="log-category-badge">${escapeHtml(formatLogCategoryLabel(entry.category))}</span>`
      : '';
    const runId = entry.runId
      ? `<span class="log-run-id" title="${escapeHtml(entry.runId)}">${escapeHtml(entry.runId.slice(0, 14))}…</span>`
      : '';
    const contextHtml = entry.context
      ? `<details class="log-details"><summary>Контекст</summary><pre class="log-context">${escapeHtml(formatLogContext(entry.context))}</pre></details>`
      : '';
    const errorHtml = entry.error
      ? `<details class="log-details log-error-details"><summary>Деталі помилки</summary><pre class="log-error-stack">${escapeHtml(formatLogErrorDetails(entry.error))}</pre></details>`
      : '';
    const isin = extractIsinFromMessage(entry.message);
    const clickable = isin ? ' log-line-clickable' : '';
    const dataIsin = isin ? ` data-log-isin="${escapeHtml(isin)}"` : '';
    return `
      <div class="log-line log-${level}${clickable}" data-log-id="${escapeHtml(entry.id || '')}"${dataIsin} tabindex="${isin ? '0' : '-1'}">
        <div class="log-line-head">
          <span class="log-level-badge log-level-${level}">${formatLogLevelLabel(level)}</span>
          ${category}
          ${site}
          ${runId}
          <span class="log-meta">${formatLogTime(entry.at)} · ${kind}</span>
        </div>
        <div class="log-message">${escapeHtml(entry.message)}</div>
        ${contextHtml}
        ${errorHtml}
        ${isin ? '<span class="log-jump-hint">Перейти до ISIN у каталозі</span>' : ''}
      </div>
    `;
  }).join('');

  container.querySelectorAll('.log-line-clickable').forEach((line) => {
    const entry = filtered.find((item) => item.id === line.dataset.logId)
      || filtered.find((item) => extractIsinFromMessage(item.message) === line.dataset.logIsin);
    if (!entry) return;
    line.addEventListener('click', () => handleLogEntryClick(entry));
    line.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        handleLogEntryClick(entry);
      }
    });
  });
}

async function loadBackgroundLog(date = actionLogViewDate) {
  if (!window.inzhurShell?.getAutomationLog) return;
  actionLogViewDate = date || localDateKey(new Date());
  const entries = await window.inzhurShell.getAutomationLog({
    date: actionLogViewDate,
    limit: 500,
    includeDebug: actionLogDebugMode,
  });
  renderBackgroundLog(entries);
}

function handleOtpRequest(payload) {
  pendingOtpPayload = payload;
  otpRunId = payload?.runId || null;
  if (payload?.gmailPoll && payload.siteId === 'univer') {
    window.hideGmailOtpPollMessage?.();
    window.showGmailOtpPollMessage?.(payload);
    return;
  }
  window.hideGmailOtpPollMessage?.();
  openOtpModal(payload);
}

function openOtpModal(payload) {
  pendingOtpPayload = payload;
  otpRunId = payload.runId;
  otpSubmitting = false;
  window.hideGmailOtpPollMessage?.();
  const modal = document.getElementById('otp-modal');
  const context = document.getElementById('otp-modal-context');
  const errorEl = document.getElementById('otp-modal-error');
  const codeInput = document.getElementById('otp-code');
  const titleEl = document.getElementById('otp-modal-title');
  const labelEl = modal?.querySelector('label[for="otp-code"]');
  if (!modal || !context) return;
  if (modal.parentElement !== document.body) {
    document.body.appendChild(modal);
  }
  window.BusyOverlay?.set('signin', false);
  window.BusyOverlay?.set('buy', false);
  window.BusyOverlay?.set('scan', false);
  if (titleEl) {
    titleEl.textContent = payload.siteId === 'inzhur' ? 'Код SMS Inzhur' : 'Код перевірки UNIVER';
  }
  if (labelEl) {
    labelEl.textContent = payload.siteId === 'inzhur' ? 'SMS-код' : 'Код перевірки';
  }
  context.textContent = payload.siteId === 'inzhur'
    ? (payload.message || 'Код з SMS для входу Inzhur.')
    : `Купівля ${payload.isin}. Код надіслано на email або телефон (замовлення #${payload.orderId || '—'}). Якщо Gmail підключено, код підставиться з пошти автоматично.`;
  if (errorEl) errorEl.hidden = true;
  if (codeInput) {
    codeInput.value = '';
    codeInput.placeholder = '000000';
    codeInput.setAttribute('maxlength', '8');
  }
  document.body.classList.add('otp-modal-open');
  window.syncPreOtpBuyCancel?.();
  modal.classList.add('open');
  requestAnimationFrame(() => {
    codeInput?.focus();
    codeInput?.select?.();
  });
}

function closeOtpModal() {
  const modal = document.getElementById('otp-modal');
  if (modal) modal.classList.remove('open');
  document.body.classList.remove('otp-modal-open');
  window.syncPreOtpBuyCancel?.();
  window.hideGmailOtpPollMessage?.();
  otpRunId = null;
  pendingOtpPayload = null;
  otpSubmitting = false;
  const otpSubmitBtn = document.getElementById('btn-otp-submit');
  if (otpSubmitBtn) {
    otpSubmitBtn.disabled = false;
    otpSubmitBtn.textContent = 'Підтвердити';
  }
}

function wireAutomationPanel() {
  if (!window.inzhurShell) return;

  document.getElementById('btn-otp-submit')?.addEventListener('click', async () => {
    const code = document.getElementById('otp-code')?.value.trim();
    const errorEl = document.getElementById('otp-modal-error');
    const otpSubmitBtn = document.getElementById('btn-otp-submit');
    if (!otpRunId || !code || otpSubmitting) return;
    otpSubmitting = true;
    otpSubmitBtn.disabled = true;
    otpSubmitBtn.textContent = 'Перевірка…';
    try {
      await window.inzhurShell.submitAutomationOtp(otpRunId, code);
      if (errorEl) errorEl.hidden = true;
      closeOtpModal();
    } catch (err) {
      if (isStaleOtpError(err?.message)) {
        closeOtpModal();
        return;
      }
      if (errorEl) {
        errorEl.hidden = false;
        errorEl.textContent = err.message;
      }
      otpSubmitting = false;
      otpSubmitBtn.disabled = false;
      otpSubmitBtn.textContent = 'Підтвердити';
    }
  });

  document.getElementById('btn-otp-cancel')?.addEventListener('click', async () => {
    if (otpRunId) {
      await window.inzhurShell.cancelAutomationOtp(otpRunId);
    }
    closeOtpModal();
  });

  document.getElementById('btn-gmail-otp-manual')?.addEventListener('click', () => {
    if (!pendingOtpPayload) return;
    openOtpModal(pendingOtpPayload);
  });

  document.getElementById('btn-gmail-otp-cancel')?.addEventListener('click', async () => {
    if (otpRunId) {
      await window.inzhurShell.cancelAutomationOtp(otpRunId);
    }
    closeOtpModal();
  });

  getActionLogDateSelect()?.addEventListener('change', (event) => {
    const value = event.target.value;
    if (!value) return;
    loadBackgroundLog(value);
  });

  document.getElementById('action-log-level-filter')?.addEventListener('change', (event) => {
    actionLogLevelFilter = event.target.value || 'all';
    renderBackgroundLog(lastActionLogEntries);
  });

  document.getElementById('action-log-site-filter')?.addEventListener('change', (event) => {
    actionLogSiteFilter = event.target.value || 'all';
    renderBackgroundLog(lastActionLogEntries);
  });

  document.getElementById('action-log-category-filter')?.addEventListener('change', (event) => {
    actionLogCategoryFilter = event.target.value || 'all';
    renderBackgroundLog(lastActionLogEntries);
  });

  wireActionLogDatePicker();
  window.StyledSelect?.enhance(getActionLogDateSelect());
  window.StyledSelect?.enhance(document.getElementById('action-log-level-filter'));
  window.StyledSelect?.enhance(document.getElementById('action-log-site-filter'));
  window.StyledSelect?.enhance(document.getElementById('action-log-category-filter'));

  document.getElementById('btn-action-log-today')?.addEventListener('click', () => {
    loadBackgroundLog(localDateKey(new Date()));
  });

  document.getElementById('btn-clear-background-log')?.addEventListener('click', async () => {
    const confirmed = window.confirm(
      'Очистити локальну копію журналу на цьому пристрої?\n\n'
      + 'Записи в Neon Postgres не видаляються.',
    );
    if (!confirmed) return;
    await window.inzhurShell.clearAutomationLog();
    renderBackgroundLog([]);
  });

  window.inzhurShell.onAutomationOtpRequest(handleOtpRequest);
  window.inzhurShell.onAutomationOtpAuto?.((payload) => {
    if (payload?.runId && payload.runId === otpRunId) {
      closeOtpModal();
    }
  });
  window.inzhurShell.onShellOtpMode?.((payload) => {
    if (!payload?.active) closeOtpModal();
  });
  window.inzhurShell.onAutomationLog(async () => {
    await populateActionLogDateOptions();
    loadBackgroundLog(actionLogViewDate);
  });
  window.inzhurShell.getLoggingConfig?.().then((config) => {
    actionLogDebugMode = Boolean(config?.debug);
    loadBackgroundLog(actionLogViewDate);
  }).catch(() => {});

  populateActionLogDateOptions().then(() => loadBackgroundLog(actionLogViewDate));
}

wireAutomationPanel();

window.wireAutomationPanel = wireAutomationPanel;
window.ensureAutomationPanel = () => loadBackgroundLog(actionLogViewDate);
window.loadAutomationData = () => loadBackgroundLog(actionLogViewDate);
window.initAutomationPanel = () => loadBackgroundLog(actionLogViewDate);
window.renderBackgroundLog = renderBackgroundLog;
window.loadBackgroundLog = loadBackgroundLog;
