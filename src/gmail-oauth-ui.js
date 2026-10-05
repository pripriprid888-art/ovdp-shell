let oauthModalOpen = false;
let pendingOAuthResolve = null;

function setGmailOAuthError(message) {
  const errorEl = document.getElementById('gmail-oauth-error');
  if (!errorEl) return;
  if (!message) {
    errorEl.hidden = true;
    errorEl.textContent = '';
    return;
  }
  errorEl.hidden = false;
  errorEl.textContent = message;
}

function setGmailOAuthBusy(busy) {
  const connectBtn = document.getElementById('btn-gmail-oauth-connect');
  const skipBtn = document.getElementById('btn-gmail-oauth-skip');
  if (connectBtn) {
    connectBtn.disabled = busy;
    connectBtn.textContent = busy ? 'Підключення…' : 'Підключити Gmail';
  }
  if (skipBtn) skipBtn.disabled = busy;
}

function closeGmailOAuthModal(outcome) {
  const modal = document.getElementById('gmail-oauth-modal');
  if (modal) modal.classList.remove('open');
  document.body.classList.remove('gmail-oauth-modal-open');
  oauthModalOpen = false;
  setGmailOAuthBusy(false);
  setGmailOAuthError('');
  const resolve = pendingOAuthResolve;
  pendingOAuthResolve = null;
  resolve?.(outcome);
}

function openGmailOAuthModal(options = {}) {
  const { reason = 'startup', allowSkip = true } = options;
  if (oauthModalOpen) {
    return new Promise((resolve) => {
      const prior = pendingOAuthResolve;
      pendingOAuthResolve = (outcome) => {
        prior?.(outcome);
        resolve(outcome);
      };
    });
  }

  const modal = document.getElementById('gmail-oauth-modal');
  const titleEl = document.getElementById('gmail-oauth-title');
  const contextEl = document.getElementById('gmail-oauth-context');
  const skipBtn = document.getElementById('btn-gmail-oauth-skip');
  if (!modal || !contextEl) {
    return Promise.resolve({ connected: false, skipped: true });
  }

  if (modal.parentElement !== document.body) {
    document.body.appendChild(modal);
  }

  if (titleEl) {
    titleEl.textContent = reason === 'univer-buy'
      ? 'Gmail для кодів UNIVER'
      : 'Підключіть Gmail';
  }

  contextEl.textContent = reason === 'univer-buy'
    ? 'Щоб автоматично підставляти коди підтвердження з листів UNIVER, підключіть Gmail (лише читання). Можна пропустити й ввести код вручну.'
    : 'Підключіть Gmail, щоб застосунок міг читати листи UNIVER з кодами підтвердження. Доступ лише для читання пошти.';

  if (skipBtn) {
    skipBtn.hidden = !allowSkip;
    skipBtn.textContent = reason === 'univer-buy' ? 'Купити без Gmail' : 'Пізніше';
  }

  setGmailOAuthError('');
  setGmailOAuthBusy(false);
  oauthModalOpen = true;
  modal.classList.add('open');
  document.body.classList.add('gmail-oauth-modal-open');

  return new Promise((resolve) => {
    pendingOAuthResolve = resolve;
  });
}

async function connectGmailFromModal() {
  if (!window.inzhurShell?.startGmailOAuth) return;
  setGmailOAuthBusy(true);
  setGmailOAuthError('');
  try {
    const result = await window.inzhurShell.startGmailOAuth();
    closeGmailOAuthModal({ connected: true, email: result?.email || null });
  } catch (err) {
    const cancelled = err?.code === 'GMAIL_OAUTH_CANCELLED'
      || /скасовано|cancel/i.test(String(err?.message || ''));
    if (cancelled) {
      closeGmailOAuthModal({ connected: false, skipped: true, cancelled: true });
      return;
    }
    setGmailOAuthError(err?.message || 'Не вдалося підключити Gmail');
    setGmailOAuthBusy(false);
  }
}

async function initGmailOAuthOnStartup() {
  const shell = window.inzhurShell;
  if (!shell?.getGmailOAuthStatus) return;
  const status = await shell.getGmailOAuthStatus();
  if (!status?.configured || status.connected) return;
  await openGmailOAuthModal({ reason: 'startup', allowSkip: true });
}

async function ensureGmailOAuthForUniverBuy() {
  const shell = window.inzhurShell;
  if (!shell?.getGmailOAuthStatus) return { connected: false, skipped: true };
  const status = await shell.getGmailOAuthStatus();
  if (!status?.configured || status.connected) {
    return { connected: Boolean(status?.connected), skipped: false };
  }
  return openGmailOAuthModal({ reason: 'univer-buy', allowSkip: true });
}

function wireGmailOAuthUi() {
  document.getElementById('btn-gmail-oauth-connect')?.addEventListener('click', () => {
    connectGmailFromModal();
  });

  document.getElementById('btn-gmail-oauth-skip')?.addEventListener('click', () => {
    closeGmailOAuthModal({ connected: false, skipped: true });
  });

  document.getElementById('gmail-oauth-modal')?.addEventListener('click', (event) => {
    if (event.target.id === 'gmail-oauth-modal') {
      closeGmailOAuthModal({ connected: false, skipped: true });
    }
  });
}

window.ensureGmailOAuthForUniverBuy = ensureGmailOAuthForUniverBuy;
window.openGmailOAuthModal = openGmailOAuthModal;

wireGmailOAuthUi();

function scheduleStartupGmailPrompt() {
  if (!window.inzhurShell?.getGmailOAuthStatus) {
    requestAnimationFrame(scheduleStartupGmailPrompt);
    return;
  }
  void initGmailOAuthOnStartup();
}

scheduleStartupGmailPrompt();
