const { session, BrowserWindow } = require('electron');
const { getSite, listSiteIds, inferAuthFromUrl } = require('../sites/config');
const { getVerifyPollConfig } = require('./univer-auth');
const automationLog = require('../automation/logger');

const CHROME_USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

/** @type {Record<string, object>} */
const sessionStates = {};

function ensureSiteState(siteId) {
  if (!sessionStates[siteId]) {
    sessionStates[siteId] = {
      siteId,
      status: 'unknown',
      hasCookies: false,
      cookieCount: 0,
      checkedAt: null,
      message: null,
      verifyUrl: null,
    };
  }
  return sessionStates[siteId];
}

for (const siteId of listSiteIds()) {
  ensureSiteState(siteId);
}

let verifyQueue = Promise.resolve();

function getSession(siteId) {
  const site = getSite(siteId);
  const sess = session.fromPartition(site.partition);
  sess.setUserAgent(CHROME_USER_AGENT);
  return sess;
}

function cloneStates() {
  return listSiteIds().map((siteId) => ({ ...sessionStates[siteId] }));
}

function setState(siteId, patch) {
  sessionStates[siteId] = {
    ...ensureSiteState(siteId),
    ...patch,
    siteId,
    checkedAt: patch.checkedAt ?? new Date().toISOString(),
  };
  return sessionStates[siteId];
}

async function countSiteCookies(siteId) {
  const site = getSite(siteId);
  const cookies = await getSession(siteId).cookies.get({});
  const relevant = cookies.filter((cookie) =>
    site.cookieDomains.some((domain) => (cookie.domain || '').includes(domain)),
  );
  return { count: relevant.length, cookies: relevant };
}

async function verifySiteSession(siteId) {
  const site = getSite(siteId);
  setState(siteId, {
    status: 'checking',
    message: 'Перевірка сесії…',
    verifyUrl: site.verifyUrl,
  });
  automationLog.pushBackground('info', siteId, `Перевірка сесії: ${site.verifyUrl}`);

  const cookieInfo = await countSiteCookies(siteId);
  const verifyWindow = new BrowserWindow({
    show: false,
    webPreferences: {
      partition: site.partition,
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      webSecurity: true,
    },
  });

  try {
    verifyWindow.webContents.setUserAgent(CHROME_USER_AGENT);
    await verifyWindow.loadURL(site.verifyUrl);

    const { attempts, initialDelayMs, pollDelayMs } = getVerifyPollConfig(siteId);
    let authResult = { authenticated: false, reason: 'loading' };

    for (let attempt = 0; attempt < attempts; attempt += 1) {
      if (attempt > 0) {
        await new Promise((resolve) => setTimeout(resolve, pollDelayMs));
      } else {
        await new Promise((resolve) => setTimeout(resolve, initialDelayMs));
      }

      const currentUrl = verifyWindow.webContents.getURL().toLowerCase();
      if (siteId === 'univer' && (currentUrl.includes('/client/login') || currentUrl.includes('/client/remindpassword'))) {
        authResult = { authenticated: false, reason: 'login_redirect' };
        break;
      }

      authResult = await verifyWindow.webContents.executeJavaScript(site.checkAuthJs);
      if (authResult?.authenticated) break;

      const reason = authResult?.reason || 'guest';
      const keepPolling = reason === 'loading'
        || (siteId === 'privat' && ['login_button', 'guest_default', 'guest_catalog'].includes(reason));
      if (!keepPolling && siteId !== 'univer' && siteId !== 'inzhur') break;
    }

    const finalUrl = verifyWindow.webContents.getURL();
    const authenticated = !!authResult?.authenticated;

    automationLog.pushBackground(
      authenticated ? 'info' : 'warning',
      siteId,
      authenticated
        ? `Сесія активна (${authResult?.reason || 'ok'})`
        : cookieInfo.count > 0
          ? `Не авторизовано (${authResult?.reason || 'guest'}, cookies: ${cookieInfo.count} — збережені cookies ≠ активна сесія)`
          : `Не авторизовано (${authResult?.reason || 'guest'})`,
    );

    let guestMessage = 'Не авторизовано';
    if (authenticated) {
      guestMessage = 'Сесія активна';
    } else if (cookieInfo.count > 0) {
      guestMessage = authResult?.reason === 'guest_catalog'
        ? 'Гість — каталог доступний, для купівлі увійдіть'
        : 'Потрібен вхід (є cookies, але сесія недійсна)';
    } else if (authResult?.reason === 'login_redirect') {
      guestMessage = 'Потрібен вхід у кабінет';
    }

    return setState(siteId, {
      status: authenticated ? 'authenticated' : 'guest',
      hasCookies: cookieInfo.count > 0,
      cookieCount: cookieInfo.count,
      message: guestMessage,
      verifyUrl: finalUrl,
    });
  } catch (err) {
    automationLog.pushBackground('error', siteId, `Перевірка сесії: ${err.message}`);
    return setState(siteId, {
      status: 'guest',
      hasCookies: cookieInfo.count > 0,
      cookieCount: cookieInfo.count,
      message: `Помилка перевірки: ${err.message}`,
      verifyUrl: site.verifyUrl,
    });
  } finally {
    if (!verifyWindow.isDestroyed()) {
      verifyWindow.destroy();
    }
  }
}

function queueVerify(siteId) {
  verifyQueue = verifyQueue
    .then(() => verifySiteSession(siteId))
    .catch((err) => {
      setState(siteId, {
        status: 'guest',
        message: err.message,
      });
      return sessionStates[siteId];
    });
  return verifyQueue;
}

async function verifyAllSessions() {
  for (const siteId of listSiteIds()) {
    await queueVerify(siteId);
  }
  return cloneStates();
}

function updateFromBrowserUrl(siteId, url) {
  const inferred = inferAuthFromUrl(siteId, url);
  if (!inferred) return null;

  const current = sessionStates[siteId];
  if (current.status === 'checking') return null;

  return setState(siteId, {
    status: inferred,
    message: inferred === 'authenticated' ? 'Авторизовано (сторінка)' : 'Потрібен вхід',
    verifyUrl: url,
  });
}

async function refreshCookieFlags(siteId) {
  const cookieInfo = await countSiteCookies(siteId);
  return setState(siteId, {
    hasCookies: cookieInfo.count > 0,
    cookieCount: cookieInfo.count,
  });
}

async function clearSiteSession(siteId) {
  const site = getSite(siteId);
  const sess = getSession(siteId);
  const cookies = await sess.cookies.get({});
  await Promise.all(
    cookies
      .filter((cookie) =>
        site.cookieDomains.some((domain) => (cookie.domain || '').includes(domain)),
      )
      .map((cookie) => {
        const protocol = cookie.secure ? 'https://' : 'http://';
        const domain = (cookie.domain || '').replace(/^\./, '');
        const url = `${protocol}${domain}${cookie.path || '/'}`;
        return sess.cookies.remove(url, cookie.name);
      }),
  );

  return setState(siteId, {
    status: 'guest',
    hasCookies: false,
    cookieCount: 0,
    message: 'Сесію очищено',
    verifyUrl: null,
  });
}

module.exports = {
  getSession,
  cloneStates,
  verifySiteSession,
  queueVerify,
  verifyAllSessions,
  updateFromBrowserUrl,
  refreshCookieFlags,
  clearSiteSession,
};
