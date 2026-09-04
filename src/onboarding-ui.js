const SITE_OPEN = {
  inzhur: () => window.inzhurShell?.goInzhurSignin(),
  univer: () => window.inzhurShell?.goUniverCatalog(),
  privat: () => window.inzhurShell?.goPrivatBonds(),
};

const AUTH_HINTS = {
  phone_password: 'Телефон і пароль. SMS або reCAPTCHA — у браузері.',
  password: 'Логін або email і пароль.',
  phone_otp: 'Телефон і пароль. Підтвердження в застосунку Приват24.',
};

let automationSites = [];
let onboardingState = { completed: false, sites: {} };
let platformSessionStates = {};
/** @type {Record<string, Array<{ username: string, password: string, savedAt: string }>>} */
let siteCredentials = {};
const busySites = new Set();

function requireShell() {
  if (!window.inzhurShell) throw new Error('Застосунок не готовий — перезапустіть');
  return window.inzhurShell;
}

function accountKey(username) {
  const digits = String(username || '').replace(/\D/g, '');
  if (digits.startsWith('380') && digits.length >= 12) return digits.slice(0, 12);
  if (digits.startsWith('80') && digits.length >= 11) return `3${digits.slice(0, 11)}`;
  if (digits.length === 10 && digits.startsWith('0')) return `38${digits}`;
  if (digits.length === 9) return `380${digits}`;
  return String(username || '').trim().toLowerCase();
}

function sessionLabel(siteId) {
  const status = platformSessionStates[siteId]?.status || 'unknown';
  const map = {
    authenticated: 'Сесія активна',
    guest: 'Потрібен вхід',
    checking: 'Перевірка…',
    unknown: 'Статус невідомий',
  };
  return map[status] || status;
}

function getSiteMeta(siteId) {
  return automationSites.find((item) => item.id === siteId);
}

function getLatestCredentials(siteId) {
  return siteCredentials[siteId]?.[0] || null;
}

function findSavedCredentials(siteId, username) {
  const key = accountKey(username);
  return (siteCredentials[siteId] || []).find((entry) => accountKey(entry.username) === key) || null;
}

function setFormStatus(siteId, message, isError = false) {
  const card = document.querySelector(`.platform-form-card[data-site-id="${siteId}"]`);
  const el = card?.querySelector('.platform-form-status');
  if (!el) return;
  if (!message) {
    el.hidden = true;
    return;
  }
  el.hidden = false;
  el.textContent = message;
  el.classList.toggle('error', isError);
}

function updateSessionBadges() {
  SITE_ORDER.forEach((siteId) => {
    const card = document.querySelector(`.platform-form-card[data-site-id="${siteId}"]`);
    if (!card) return;
    const status = platformSessionStates[siteId]?.status || 'unknown';
    const dot = card.querySelector('.status-dot');
    const meta = card.querySelector('.platform-form-meta');
    if (dot) dot.className = `status-dot status-${status}`;
    if (meta) meta.textContent = sessionLabel(siteId);

    const headlessBtn = card.querySelector('[data-action="signin-headless"]');
    const site = getSiteMeta(siteId);
    if (headlessBtn) {
      headlessBtn.disabled = site?.supportsHeadlessSignIn === false || busySites.has(siteId);
    }
  });
}

function escapeHtml(text) {
  return String(text || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

const PASSWORD_EYE_ICON = `
  <svg class="password-toggle-icon" viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
    <path fill="currentColor" d="M12 5C7 5 2.73 8.11 1 12.5c1.73 4.39 6 7.5 11 7.5s9.27-3.11 11-7.5C21.27 8.11 17 5 12 5zm0 12.5a5 5 0 1 1 0-10 5 5 0 0 1 0 10zm0-2.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5z"/>
  </svg>
`;

const PASSWORD_EYE_OFF_ICON = `
  <svg class="password-toggle-icon" viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
    <path fill="currentColor" d="M2.1 3.51 3.51 2.1l18.39 18.39-1.41 1.41-3.28-3.28A10.8 10.8 0 0 1 12 19.5C7 19.5 2.73 16.39 1 12c.74-1.87 2.01-3.47 3.64-4.64L2.1 3.51zM12 5c1.74 0 3.37.48 4.8 1.31l-1.46 1.46A5.02 5.02 0 0 0 12 7c-2.76 0-5 2.24-5 5 0 .88.23 1.71.64 2.43L6.3 13.1A2.98 2.98 0 0 1 9 12c0-1.66 1.34-3 3-3 .55 0 1.07.15 1.52.41l1.47 1.47C14.55 10.23 13.32 10 12 10a5 5 0 0 0-5 5c0 .69.14 1.35.39 1.96L5.6 19.4C3.55 17.78 2.08 15.05 1.41 12 2.73 8.11 7 5 12 5zm7.6 3.29 1.41 1.41C21.27 8.11 17 5 12 5c-.69 0-1.37.07-2.03.2l1.55 1.55c.48-.08.97-.13 1.48-.13 2.76 0 5 2.24 5 5 0 .51-.05 1-.13 1.48l1.71 1.71c.53-.98.89-2.07 1.05-3.19z"/>
  </svg>
`;

function renderPasswordToggleButton(visible) {
  const label = visible ? 'Приховати пароль' : 'Показати пароль';
  return `
    <button
      type="button"
      class="password-toggle-btn"
      data-toggle-password
      title="${label}"
      aria-label="${label}"
      aria-pressed="${visible ? 'true' : 'false'}"
    >${visible ? PASSWORD_EYE_OFF_ICON : PASSWORD_EYE_ICON}</button>
  `;
}

function renderPasswordInputWrap(inputHtml) {
  return `
    <div class="password-input-wrap">
      ${inputHtml}
      ${renderPasswordToggleButton(false)}
    </div>
  `;
}

function togglePasswordVisibility(button) {
  const wrap = button.closest('.password-input-wrap');
  const input = wrap?.querySelector('input');
  if (!input) return;

  const visible = input.type === 'text';
  input.type = visible ? 'password' : 'text';
  const label = visible ? 'Показати пароль' : 'Приховати пароль';
  button.title = label;
  button.setAttribute('aria-label', label);
  button.setAttribute('aria-pressed', visible ? 'false' : 'true');
  button.innerHTML = visible ? PASSWORD_EYE_ICON : PASSWORD_EYE_OFF_ICON;
}

function closeAllUsernameMenus() {
  document.querySelectorAll('.platform-username-menu').forEach((menu) => {
    menu.hidden = true;
  });
}

function renderUsernameMenu(siteId, currentUsername) {
  const entries = siteCredentials[siteId] || [];
  const currentKey = accountKey(currentUsername);
  const others = entries.filter((entry) => accountKey(entry.username) !== currentKey);
  if (!others.length) return '';

  return others.map((entry) => `
    <button
      type="button"
      class="platform-username-option"
      data-pick-username="${escapeHtml(entry.username)}"
    >${escapeHtml(entry.username)}</button>
  `).join('');
}

function refreshUsernameMenu(siteId) {
  const card = document.querySelector(`.platform-form-card[data-site-id="${siteId}"]`);
  if (!card) return;
  const usernameInput = card.querySelector('[data-username-input]');
  const menu = card.querySelector('.platform-username-menu');
  if (!usernameInput || !menu) return;

  const html = renderUsernameMenu(siteId, usernameInput.value);
  menu.innerHTML = html;
  menu.hidden = !html;
}

function applyCredentialToForm(siteId, entry) {
  const card = document.querySelector(`.platform-form-card[data-site-id="${siteId}"]`);
  if (!card || !entry) return;

  const usernameInput = card.querySelector('[data-username-input]');
  const passwordInput = card.querySelector('[data-password-input]');
  if (usernameInput) usernameInput.value = entry.username || '';
  if (passwordInput) passwordInput.value = entry.password || '';
  refreshUsernameMenu(siteId);
}

function refreshCredentialsPanel(siteId) {
  const card = document.querySelector(`.platform-form-card[data-site-id="${siteId}"]`);
  const panel = card?.querySelector('[data-credentials-panel]');
  if (!panel || panel.hidden) return;
  panel.innerHTML = renderCredentialsList(siteId);
}

async function updateCredentialsStoreWarning() {
  const el = document.getElementById('credentials-store-warning');
  if (!el) return;
  try {
    const status = await requireShell().getCredentialsStoreStatus();
    if (status?.state === 'corrupt') {
      el.hidden = false;
      el.textContent = status.message;
      el.classList.add('error');
      return;
    }
    if (status?.state === 'recovered' && status.message) {
      el.hidden = false;
      el.textContent = status.message;
      el.classList.remove('error');
      return;
    }
    el.hidden = true;
    el.textContent = '';
    el.classList.remove('error');
  } catch {
    el.hidden = true;
  }
}

function renderCredentialsList(siteId) {
  const entries = siteCredentials[siteId] || [];
  const site = getSiteMeta(siteId);

  if (!entries.length) {
    return '<p class="platform-credentials-empty">Немає збережених облікових даних.</p>';
  }

  return entries.map((entry) => `
    <div class="platform-credential-row" data-credential-username="${escapeHtml(entry.username)}">
      <div class="platform-credential-fields">
        <div class="field">
          <label>${escapeHtml(site?.usernameLabel || 'Логін')}</label>
          <input type="text" data-credential-username value="${escapeHtml(entry.username)}" />
        </div>
        <div class="field">
          <label>${escapeHtml(site?.passwordLabel || 'Пароль')}</label>
          ${renderPasswordInputWrap(`
            <input type="password" data-credential-password value="${escapeHtml(entry.password)}" />
          `)}
        </div>
      </div>
      <div class="platform-credential-row-actions">
        <button type="button" class="action subtle" data-credential-action="apply">У форму</button>
        <button type="button" class="action" data-credential-action="update">Зберегти</button>
        <button type="button" class="action subtle" data-credential-action="delete">Видалити</button>
      </div>
    </div>
  `).join('');
}

async function updateCredentialRow(siteId, row) {
  const originalUsername = row.dataset.credentialUsername;
  const username = row.querySelector('[data-credential-username]')?.value.trim() || '';
  const password = row.querySelector('[data-credential-password]')?.value || '';
  if (!username) throw new Error('Вкажіть логін або телефон');

  const shell = requireShell();
  if (accountKey(originalUsername) !== accountKey(username)) {
    await shell.deleteSiteCredentials(siteId, originalUsername);
  }
  await shell.saveSiteCredentials(siteId, username, password);
  siteCredentials[siteId] = await shell.listSiteCredentials(siteId);
  refreshCredentialsPanel(siteId);
  refreshUsernameMenu(siteId);
  applyCredentialToForm(siteId, findSavedCredentials(siteId, username));
  setFormStatus(siteId, 'Обліковий запис оновлено');
}

async function deleteCredentialRow(siteId, row) {
  const username = row.dataset.credentialUsername;
  if (!username) return;

  await requireShell().deleteSiteCredentials(siteId, username);
  siteCredentials[siteId] = await requireShell().listSiteCredentials(siteId);
  refreshCredentialsPanel(siteId);
  refreshUsernameMenu(siteId);

  const { username: currentUsername } = getFormValues(siteId);
  if (accountKey(currentUsername) === accountKey(username)) {
    const card = document.querySelector(`.platform-form-card[data-site-id="${siteId}"]`);
    const usernameInput = card?.querySelector('[data-username-input]');
    const passwordInput = card?.querySelector('[data-password-input]');
    if (usernameInput) usernameInput.value = '';
    if (passwordInput) passwordInput.value = '';
  }

  setFormStatus(siteId, 'Обліковий запис видалено');
}

function renderPlatformForm(site) {
  const siteId = site.id;
  const latest = getLatestCredentials(siteId);
  const username = latest?.username || onboardingState.sites[siteId]?.username || '';
  const status = platformSessionStates[siteId]?.status || 'unknown';
  const passwordFieldHidden = site.passwordRequired === false;
  const menuHtml = renderUsernameMenu(siteId, username);
  const paymentAccounts = onboardingState.sites.privat?.paymentAccounts || '';
  const paymentAccountsBlock = siteId === 'privat' ? `
      <div class="field">
        <label for="platform-privat-payment-accounts">Картки / рахунки (через кому)</label>
        <input
          id="platform-privat-payment-accounts"
          type="text"
          data-payment-accounts-input
          placeholder="5169..., UA123..."
          value="${escapeHtml(paymentAccounts)}"
        />
      </div>
  ` : '';

  return `
    <article class="platform-form-card platform-form-${siteId}" data-site-id="${siteId}">
      <header class="platform-form-header">
        <span class="status-dot status-${status}" title="${sessionLabel(siteId)}"></span>
        <div class="platform-form-heading">
          <h3 class="platform-form-name">${site.name}</h3>
          <p class="platform-form-meta">${sessionLabel(siteId)}</p>
        </div>
      </header>
      <p class="platform-form-hint">${AUTH_HINTS[site.authType] || 'Збережіть дані та увійдіть на платформу.'}</p>
      <div class="field">
        <label for="platform-${siteId}-username">${site.usernameLabel || 'Логін'}</label>
        <div class="platform-username-picker">
          <input
            id="platform-${siteId}-username"
            type="text"
            autocomplete="username"
            data-username-input
            data-site-id="${siteId}"
            value="${escapeHtml(username)}"
          />
          <div class="platform-username-menu" ${menuHtml ? '' : 'hidden'}>${menuHtml}</div>
        </div>
      </div>
      <div class="field platform-form-password" ${passwordFieldHidden ? 'hidden' : ''}>
        <label for="platform-${siteId}-password">${site.passwordLabel || 'Пароль'}</label>
        ${renderPasswordInputWrap(`
          <input
            id="platform-${siteId}-password"
            type="password"
            autocomplete="current-password"
            data-password-input
          />
        `)}
      </div>
      ${paymentAccountsBlock}
      <div class="platform-credentials-panel" data-credentials-panel hidden>
        ${renderCredentialsList(siteId)}
      </div>
      <div class="platform-form-status scan-status" hidden></div>
      <div class="platform-form-actions">
        <button type="button" class="action subtle" data-action="manage-credentials">Збережені облікові дані</button>
        <button type="button" class="action" data-action="save">Зберегти</button>
        <button type="button" class="action" data-action="signin-browser">Увійти в браузері</button>
        <button
          type="button"
          class="action primary"
          data-action="signin-headless"
          ${site.supportsHeadlessSignIn === false ? 'disabled' : ''}
        >Фоновий вхід</button>
        <button type="button" class="action subtle" data-action="open-site">Відкрити</button>
      </div>
    </article>
  `;
}

async function loadAllSiteCredentials() {
  const shell = requireShell();
  const entries = await Promise.all(
    SITE_ORDER.map(async (siteId) => [siteId, await shell.listSiteCredentials(siteId)]),
  );
  siteCredentials = Object.fromEntries(entries);
}

function renderPlatformForms() {
  const container = document.getElementById('platform-forms');
  if (!container) return;

  const sites = SITE_ORDER
    .map((siteId) => getSiteMeta(siteId))
    .filter(Boolean);

  container.innerHTML = sites.map(renderPlatformForm).join('');

  SITE_ORDER.forEach((siteId) => {
    const latest = getLatestCredentials(siteId);
    if (latest?.password) {
      applyCredentialToForm(siteId, latest);
    }
  });
}

function getFormValues(siteId) {
  const card = document.querySelector(`.platform-form-card[data-site-id="${siteId}"]`);
  if (!card) return { username: '', password: '' };
  return {
    username: card.querySelector('[data-username-input]')?.value.trim() || '',
    password: card.querySelector('[data-password-input]')?.value || '',
  };
}

async function saveSiteCredentials(siteId) {
  const { username, password } = getFormValues(siteId);
  if (!username) throw new Error('Вкажіть логін або телефон');

  const shell = requireShell();
  await shell.saveSiteCredentials(siteId, username, password);
  siteCredentials[siteId] = await shell.listSiteCredentials(siteId);

  const card = document.querySelector(`.platform-form-card[data-site-id="${siteId}"]`);
  const patch = { username };
  if (siteId === 'privat') {
    patch.paymentAccounts = card?.querySelector('[data-payment-accounts-input]')?.value.trim() || '';
  }
  onboardingState = await shell.setOnboardingSite(siteId, patch);

  if (!onboardingState.completed) {
    onboardingState = await shell.completeOnboarding();
  }

  applyCredentialToForm(siteId, getLatestCredentials(siteId));
  refreshCredentialsPanel(siteId);
  closeAllUsernameMenus();
  setFormStatus(siteId, 'Дані збережено');
  await updateCredentialsStoreWarning();
}

async function runSiteSignIn(siteId, mode) {
  if (busySites.has(siteId)) return;

  const { username, password } = getFormValues(siteId);
  if (!username) throw new Error('Вкажіть логін або телефон');

  busySites.add(siteId);
  updateSessionBadges();
  setFormStatus(siteId, mode === 'headless' ? 'Фоновий вхід…' : 'Відкриваємо сторінку входу…');

  try {
    const saved = findSavedCredentials(siteId, username);
    const signInPassword = password || saved?.password || '';
    await requireShell().runSignIn(siteId, mode, username, signInPassword);
    setFormStatus(
      siteId,
      mode === 'headless' ? 'Перевірте сесію у toolbar' : 'Завершіть вхід у браузері',
    );
  } catch (err) {
    setFormStatus(siteId, err.message, true);
  } finally {
    busySites.delete(siteId);
    updateSessionBadges();
  }
}

function openSetup(options = {}) {
  requireShell().goCabinet();
  window.applyPanelTab?.('bonds');
  window.switchListKind?.('setup');

  if (options.siteId && SITE_ORDER.includes(options.siteId)) {
    requestAnimationFrame(() => {
      document
        .querySelector(`.platform-form-card[data-site-id="${options.siteId}"]`)
        ?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    });
  }
}

function wirePlatformForms() {
  document.getElementById('market-view-setup')?.addEventListener('focusin', (event) => {
    const input = event.target.closest('[data-username-input]');
    if (!input) return;
    closeAllUsernameMenus();
    refreshUsernameMenu(input.dataset.siteId);
    const menu = input.closest('.platform-username-picker')?.querySelector('.platform-username-menu');
    if (menu && menu.childElementCount > 0) {
      menu.hidden = false;
    }
  });

  document.getElementById('market-view-setup')?.addEventListener('input', (event) => {
    const input = event.target.closest('[data-username-input]');
    if (!input) return;
    refreshUsernameMenu(input.dataset.siteId);
  });

  document.getElementById('market-view-setup')?.addEventListener('click', async (event) => {
    const toggleBtn = event.target.closest('[data-toggle-password]');
    if (toggleBtn) {
      event.preventDefault();
      togglePasswordVisibility(toggleBtn);
      return;
    }

    const pickBtn = event.target.closest('[data-pick-username]');
    if (pickBtn) {
      event.preventDefault();
      const card = pickBtn.closest('.platform-form-card');
      const siteId = card?.dataset.siteId;
      const username = pickBtn.dataset.pickUsername;
      if (!siteId || !username) return;
      const entry = findSavedCredentials(siteId, username);
      if (entry) applyCredentialToForm(siteId, entry);
      closeAllUsernameMenus();
      return;
    }

    const card = event.target.closest('.platform-form-card');
    if (!card) return;
    const siteId = card.dataset.siteId;

    const credBtn = event.target.closest('[data-credential-action]');
    if (credBtn) {
      event.preventDefault();
      const row = credBtn.closest('.platform-credential-row');
      if (!row) return;
      const action = credBtn.dataset.credentialAction;
      try {
        if (action === 'apply') {
          const username = row.querySelector('[data-credential-username]')?.value.trim() || '';
          const password = row.querySelector('[data-credential-password]')?.value || '';
          applyCredentialToForm(siteId, { username, password });
          setFormStatus(siteId, 'Завантажено у форму');
          return;
        }
        if (action === 'update') {
          await updateCredentialRow(siteId, row);
          return;
        }
        if (action === 'delete') {
          await deleteCredentialRow(siteId, row);
        }
      } catch (err) {
        setFormStatus(siteId, err.message, true);
      }
      return;
    }

    const actionBtn = event.target.closest('[data-action]');
    if (!actionBtn) return;

    const action = actionBtn.dataset.action;
    if (action === 'manage-credentials') {
      event.preventDefault();
      const panel = card.querySelector('[data-credentials-panel]');
      if (!panel) return;
      const opening = panel.hidden;
      panel.hidden = !opening;
      if (opening) {
        panel.innerHTML = renderCredentialsList(siteId);
      }
      return;
    }

    if (action === 'open-site') {
      SITE_OPEN[siteId]?.();
      return;
    }

    if (action === 'save') {
      try {
        await saveSiteCredentials(siteId);
      } catch (err) {
        setFormStatus(siteId, err.message, true);
      }
      return;
    }

    if (action === 'signin-browser') {
      runSiteSignIn(siteId, 'manual');
      return;
    }

    if (action === 'signin-headless') {
      runSiteSignIn(siteId, 'headless');
    }
  });

  document.addEventListener('click', (event) => {
    if (!event.target.closest('.platform-username-picker')) {
      closeAllUsernameMenus();
    }
  });
}

async function initPlatformSetup() {
  if (!window.inzhurShell) return;

  wirePlatformForms();

  const shell = window.inzhurShell;
  [automationSites, onboardingState] = await Promise.all([
    shell.getAutomationSites(),
    shell.getOnboardingState(),
  ]);

  await loadAllSiteCredentials();
  await updateCredentialsStoreWarning();
  renderPlatformForms();

  shell.onOnboardingState((state) => {
    onboardingState = state;
    renderPlatformForms();
    updateSessionBadges();
  });

  shell.onSessionStates((states) => {
    platformSessionStates = Object.fromEntries(states.map((state) => [state.siteId, state]));
    updateSessionBadges();
  });

  shell.getSessionStates().then((states) => {
    platformSessionStates = Object.fromEntries(states.map((state) => [state.siteId, state]));
    updateSessionBadges();
  });
}

initPlatformSetup();

window.openOnboarding = openSetup;
window.openSetup = openSetup;
window.refreshSetupView = async () => {
  await loadAllSiteCredentials();
  await updateCredentialsStoreWarning();
  renderPlatformForms();
  updateSessionBadges();
};
