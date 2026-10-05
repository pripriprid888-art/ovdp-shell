const automationLog = require('../automation/logger');
const { isTransientNetworkError } = require('../shared/network-errors');
const {
  PRIVAT_ORIGIN,
  PRIVAT_INIT_URL,
  PRIVAT_REFRESH_URL,
  postInit,
  postRefresh,
} = require('../shared/privat-session-api');

const SITE_ID = 'privat';
const INTERVAL_MS = 15 * 60 * 1000;
const INITIAL_DELAY_MS = 2 * 60 * 1000;

let intervalTimer = null;
let initialTimer = null;
let tickRunning = false;
let cachedXref = '';
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

async function pingPrivatSession(getSession) {
  const sess = getSession(SITE_ID);

  if (cachedXref) {
    const refreshOnly = await postRefresh(sess, cachedXref);
    if (refreshOnly.ok) return refreshOnly;
    cachedXref = '';
  }

  const initResult = await postInit(sess);
  if (!initResult.ok) return initResult;

  cachedXref = initResult.xref;
  return postRefresh(sess, cachedXref);
}

async function logPubkeyPresence(getSession) {
  try {
    const cookies = await getSession(SITE_ID).cookies.get({ url: PRIVAT_ORIGIN });
    const pubkey = cookies.find((cookie) => cookie.name === 'pubkey');
    if (!pubkey) return;
    if (pubkey.expirationDate) {
      const expiresAt = new Date(pubkey.expirationDate * 1000).toLocaleString('uk-UA');
      automationLog.pushBackground('info', SITE_ID, `Keepalive: pubkey діє до ${expiresAt}`, { category: 'keepalive' });
      return;
    }
    automationLog.pushBackground('info', SITE_ID, 'Keepalive: pubkey активний', { category: 'keepalive' });
  } catch {
    // ignore cookie read errors
  }
}

async function runKeepaliveTick() {
  if (tickRunning || !getSessionFn) return;
  if (getSessionState() !== 'authenticated') return;

  tickRunning = true;
  try {
    automationLog.pushBackground('info', SITE_ID, 'Keepalive: POST /api/p24/pub/refresh', { category: 'keepalive' });
    const result = await pingPrivatSession(getSessionFn);
    if (result.ok) {
      automationLog.pushBackground('info', SITE_ID, 'Keepalive: сесія активна', { category: 'keepalive' });
      await logPubkeyPresence(getSessionFn);
      return;
    }

    cachedXref = '';
    automationLog.pushBackground(
      'warning',
      SITE_ID,
      `Keepalive: сесія недійсна (${result.reason}${result.errorCode != null ? ` / ${result.errorCode}` : ''}) — перевірка`,
      {
        category: 'keepalive',
        context: { reason: result.reason, errorCode: result.errorCode ?? null },
      },
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
    cachedXref = '';
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
  cachedXref = '';
}

function scheduleSoon(delayMs = 5000) {
  if (!getSessionFn) return;
  setTimeout(runKeepaliveTick, delayMs);
}

module.exports = {
  SITE_ID,
  INIT_URL: PRIVAT_INIT_URL,
  REFRESH_URL: PRIVAT_REFRESH_URL,
  INTERVAL_MS,
  configure,
  start,
  stop,
  scheduleSoon,
  pingPrivatSession,
};
