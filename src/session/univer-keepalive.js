const { net } = require('electron');
const automationLog = require('../automation/logger');
const { isTransientNetworkError } = require('../shared/network-errors');

const SITE_ID = 'univer';
const KEEPALIVE_URL = 'https://univer.1b.app/client/';
const INTERVAL_MS = 15 * 60 * 1000;
const INITIAL_DELAY_MS = 2 * 60 * 1000;
const FETCH_TIMEOUT_MS = 25 * 1000;
const RETRY_DELAY_MS = 3000;
const { CHROME_UA } = require('../shared/constants');

let intervalTimer = null;
let initialTimer = null;
let tickRunning = false;
let getSessionState = () => 'unknown';
let onSessionStale = async () => {};
let getSessionFn = null;

function configure(options = {}) {
  if (typeof options.getSessionState === 'function') {
    getSessionState = options.getSessionState;
  }
  if (typeof options.onSessionStale === 'function') {
    onSessionStale = options.onSessionStale;
  }
}

function looksLikeLoginHtml(html) {
  const sample = String(html || '').slice(0, 6000).toLowerCase();
  return sample.includes('input[name="login"]')
    && (sample.includes('password') || sample.includes('увійти'));
}

async function fetchKeepalive(getSession) {
  const sess = getSession(SITE_ID);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    return await net.fetch(KEEPALIVE_URL, {
      session: sess,
      signal: controller.signal,
      headers: {
        'User-Agent': CHROME_UA,
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      },
    });
  } finally {
    clearTimeout(timer);
  }
}

async function pingUniverSession(getSession) {
  const response = await fetchKeepalive(getSession);

  const finalUrl = String(response.url || KEEPALIVE_URL).toLowerCase();
  if (finalUrl.includes('/client/login') || finalUrl.includes('remindpassword')) {
    return { ok: false, reason: 'login_redirect', status: response.status };
  }

  if (!response.ok) {
    return { ok: false, reason: `http_${response.status}`, status: response.status };
  }

  const html = await response.text();
  if (looksLikeLoginHtml(html)) {
    return { ok: false, reason: 'login_form', status: response.status };
  }

  return { ok: true, status: response.status };
}

async function logAuthTokenExpiry(getSession) {
  try {
    const cookies = await getSession(SITE_ID).cookies.get({ url: KEEPALIVE_URL });
    const authToken = cookies.find((cookie) => cookie.name === 'utilsauthtoken');
    if (!authToken?.expirationDate) return;
    const expiresAt = new Date(authToken.expirationDate * 1000).toLocaleString('uk-UA');
    automationLog.pushBackground('info', SITE_ID, `Keepalive: utilsauthtoken діє до ${expiresAt}`, { category: 'keepalive' });
  } catch {
    // ignore cookie read errors
  }
}

async function pingUniverSessionWithRetry(getSession) {
  try {
    return await pingUniverSession(getSession);
  } catch (err) {
    if (!isTransientNetworkError(err)) throw err;
    await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS));
    return pingUniverSession(getSession);
  }
}

async function runKeepaliveTick() {
  if (tickRunning || !getSessionFn) return;
  if (getSessionState() !== 'authenticated') return;

  tickRunning = true;
  try {
    automationLog.pushBackground('info', SITE_ID, 'Keepalive: запит до /client/', { category: 'keepalive' });
    const result = await pingUniverSessionWithRetry(getSessionFn);
    if (result.ok) {
      automationLog.pushBackground('info', SITE_ID, 'Keepalive: сесія активна', { category: 'keepalive' });
      await logAuthTokenExpiry(getSessionFn);
      return;
    }

    automationLog.pushBackground(
      'warning',
      SITE_ID,
      `Keepalive: сесія недійсна (${result.reason}) — перевірка`,
      { category: 'keepalive', context: { reason: result.reason } },
    );
    await onSessionStale();
  } catch (err) {
    if (isTransientNetworkError(err)) {
      automationLog.pushBackground(
        'warning',
        SITE_ID,
        `Keepalive: тимчасова помилка мережі (${err.message}) — сесію не скинуто`,
        { category: 'keepalive', context: { transient: true } },
      );
      return;
    }
    automationLog.logError(SITE_ID, `Keepalive: ${err.message}`, err, { category: 'keepalive' });
  } finally {
    tickRunning = false;
  }
}

function start(getSession, options = {}) {
  stop();
  getSessionFn = getSession;
  const intervalMs = options.intervalMs ?? INTERVAL_MS;
  const initialDelayMs = options.initialDelayMs ?? INITIAL_DELAY_MS;

  intervalTimer = setInterval(runKeepaliveTick, intervalMs);
  initialTimer = setTimeout(runKeepaliveTick, initialDelayMs);
  automationLog.pushBackground(
    'info',
    SITE_ID,
    `Keepalive увімкнено (кожні ${Math.round(intervalMs / 60000)} хв)`,
    { category: 'keepalive' },
  );
}

function stop() {
  if (intervalTimer) {
    clearInterval(intervalTimer);
    intervalTimer = null;
  }
  if (initialTimer) {
    clearTimeout(initialTimer);
    initialTimer = null;
  }
  getSessionFn = null;
}

function scheduleSoon(delayMs = 5000) {
  if (!getSessionFn) return;
  setTimeout(runKeepaliveTick, delayMs);
}

module.exports = {
  SITE_ID,
  KEEPALIVE_URL,
  INTERVAL_MS,
  configure,
  start,
  stop,
  scheduleSoon,
  pingUniverSession,
};
