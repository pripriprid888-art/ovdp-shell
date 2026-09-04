const {
  app,
  BrowserWindow,
  BrowserView,
  ipcMain,
  shell,
  nativeImage,
} = require('electron');
const path = require('path');
const fs = require('fs');
const { getScanner, getCatalogUrl, listScannerIds } = require('./scanners/index');
const { getPortfolioScanner, listPortfolioScannerIds } = require('./scanners/portfolio/index');
const { saveSiteSecurities, saveSiteHoldings, saveSiteOrders, saveSiteAccountInfo, getSecurities, hasCachedLists } = require('./securities-store');
const { getSite, listSiteIds, detectSiteFromUrl } = require('./sites/config');
const { isAuthenticatedResult } = require('./session/auth-result');
const sessionManager = require('./session/manager');
const automationRunner = require('./automation/runner');
const automationLog = require('./automation/logger');
const credentialsStore = require('./credentials/store');
const onboardingStore = require('./onboarding/store');
const pendingOtp = require('./automation/pending-otp');
const {
  getInzhurPageTheme,
  nextInzhurPageThemeId,
  buildInzhurThemeInjectScript,
} = require('./inzhur-page-theme');
const {
  ORDERS_URL,
  ORDERS_WAIT_SELECTOR,
  EXTRACT_UNIVER_ORDERS_JS,
  processRawOrders,
} = require('./scanners/portfolio/univer-orders-scan');

const TOOLBAR_HEIGHT = 52;
const INZHUR_OVERLAY_HEIGHT = 52;
const APP_NAME = 'OVDP Shell';
/** Stable storage folder — must not change when the display name changes. */
const USER_DATA_DIR = 'inzhur-shell';
const USER_DATA_FILES = ['credentials.dat', 'onboarding.json', 'securities.json'];
const LEGACY_USER_DATA_DIR = 'OVDP Shell';
const SITE_PARTITIONS = ['inzhur', 'univer', 'privat'];
const CHROME_UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

function migrateLegacyPartitions(appDataRoot, userDataPath) {
  const fromRoot = path.join(appDataRoot, LEGACY_USER_DATA_DIR, 'Partitions');
  const toRoot = path.join(userDataPath, 'Partitions');
  if (!fs.existsSync(fromRoot)) return;

  for (const siteId of SITE_PARTITIONS) {
    const fromDir = path.join(fromRoot, siteId);
    const toDir = path.join(toRoot, siteId);
    if (!fs.existsSync(fromDir)) continue;

    if (!fs.existsSync(toDir)) {
      fs.cpSync(fromDir, toDir, { recursive: true });
      continue;
    }

    const fromCookies = path.join(fromDir, 'Cookies');
    const toCookies = path.join(toDir, 'Cookies');
    if (!fs.existsSync(fromCookies)) continue;

    try {
      const shouldCopy = !fs.existsSync(toCookies)
        || fs.statSync(fromCookies).mtimeMs > fs.statSync(toCookies).mtimeMs;
      if (shouldCopy) {
        fs.copyFileSync(fromCookies, toCookies);
      }
    } catch (err) {
      console.warn(`Partition cookie migration skipped for ${siteId}:`, err.message);
    }
  }
}

function configureUserDataPath() {
  const appDataRoot = app.getPath('appData');
  const userDataPath = path.join(appDataRoot, USER_DATA_DIR);
  app.setPath('userData', userDataPath);

  const renamedPath = path.join(appDataRoot, APP_NAME);
  if (renamedPath !== userDataPath && fs.existsSync(renamedPath)) {
    for (const fileName of USER_DATA_FILES) {
      const fromFile = path.join(renamedPath, fileName);
      const toFile = path.join(userDataPath, fileName);
      if (!fs.existsSync(fromFile)) continue;

      try {
        if (!fs.existsSync(toFile)) {
          fs.copyFileSync(fromFile, toFile);
          continue;
        }
        const fromStat = fs.statSync(fromFile);
        const toStat = fs.statSync(toFile);
        if (fromStat.mtimeMs > toStat.mtimeMs) {
          fs.copyFileSync(fromFile, toFile);
        }
      } catch (err) {
        console.warn(`User data migration skipped for ${fileName}:`, err.message);
      }
    }
  }

  migrateLegacyPartitions(appDataRoot, userDataPath);
}

configureUserDataPath();

if (typeof app.setName === 'function') {
  // Keep stable for macOS Keychain / safeStorage — display name uses APP_NAME in UI.
  app.setName(USER_DATA_DIR);
}

if (process.platform === 'darwin') {
  app.on('will-finish-launching', () => {
    app.dock?.hide();
  });
}

const EXTERNAL_PROTOCOLS = /^(diia:|bankid:|mailto:|tel:|itms-apps:|market:)/i;

function shouldOpenExternally(url) {
  if (EXTERNAL_PROTOCOLS.test(url)) return true;
  try {
    const { protocol, hostname } = new URL(url);
    if (protocol !== 'http:' && protocol !== 'https:') return true;
    if (hostname.includes('apps.apple.com') || hostname.includes('play.google.com')) {
      return true;
    }
  } catch {
    return true;
  }
  return false;
}

let mainWindow;
let browserView;
let scanInProgress = false;
let activeSiteId = 'cabinet';
let panelTab = 'bonds';
/** @type {Record<string, string>} */
const lastUrls = Object.fromEntries(
  listSiteIds().map((siteId) => [
    siteId,
    siteId === 'inzhur' ? getSite(siteId).signInUrl : getSite(siteId).homeUrl,
  ]),
);

let inzhurOverlayCollapsed = false;
let inzhurPageTheme = 'gold';
let privatSignInLayout = false;

let authCheckTimer = null;
let automationBusy = false;
let sessionStatusesInitialized = false;
/** @type {Record<string, string>} */
const lastKnownSessionStatus = Object.fromEntries(
  listSiteIds().map((siteId) => [siteId, 'unknown']),
);
/** @type {Record<string, ReturnType<typeof setTimeout>|null>} */
const portfolioLookupTimers = {};
const portfolioLookupRunningSites = new Set();
/** @type {Record<string, ReturnType<typeof setTimeout>|null>} */
const ordersLookupTimers = {};
const ordersLookupRunningSites = new Set();

function broadcast(channel, payload) {
  mainWindow?.webContents.send(channel, payload);
}

function broadcastAutomationLog() {
  broadcast('automation-log', automationLog.getLogs());
}

function broadcastOtpRequest(payload) {
  broadcast('automation-otp-request', payload);
}

function broadcastAutomationBuyProgress(payload) {
  broadcast('automation-buy-progress', payload);
}

automationLog.setBroadcast(broadcastAutomationLog);

async function runAutomationTask(taskFn) {
  if (automationBusy) {
    throw new Error('Інша автоматизація вже виконується');
  }
  automationBusy = true;
  try {
    return await taskFn();
  } finally {
    automationBusy = false;
    broadcastAutomationLog();
  }
}

function markSessionStatusesInitialized() {
  for (const state of sessionManager.cloneStates()) {
    lastKnownSessionStatus[state.siteId] = state.status;
  }
  sessionStatusesInitialized = true;
}

function schedulePortfolioLookupAfterSignIn(siteId) {
  if (!listPortfolioScannerIds().includes(siteId)) return;
  if (!sessionStatusesInitialized) return;

  if (portfolioLookupTimers[siteId]) {
    clearTimeout(portfolioLookupTimers[siteId]);
  }

  portfolioLookupTimers[siteId] = setTimeout(async () => {
    portfolioLookupTimers[siteId] = null;
    if (getSiteSessionStatus(siteId) !== 'authenticated') return;
    if (portfolioLookupRunningSites.has(siteId)) return;

    portfolioLookupRunningSites.add(siteId);
    const siteName = getSite(siteId).name;
    try {
      broadcast('scan-state', {
        scanning: true,
        scanKind: 'portfolio',
        siteId,
        message: `Оновлення портфеля ${siteName}…`,
      });
      logBackground('info', siteId, 'Автосканування портфеля (сесію підтверджено)');
      await scanSitePortfolio(siteId);
      notifySecuritiesUpdated('all', 'holdings');
    } catch (err) {
      broadcast('scan-state', {
        scanning: false,
        scanKind: 'portfolio',
        siteId,
        message: `${siteName}: ${err.message}`,
      });
    } finally {
      portfolioLookupRunningSites.delete(siteId);
      broadcast('scan-state', { scanning: false, scanKind: 'portfolio' });
    }
  }, 2000);
}

function scheduleOrdersLookupAfterSignIn(siteId) {
  if (siteId !== 'univer') return;
  if (!sessionStatusesInitialized) return;

  if (ordersLookupTimers[siteId]) {
    clearTimeout(ordersLookupTimers[siteId]);
  }

  ordersLookupTimers[siteId] = setTimeout(async () => {
    ordersLookupTimers[siteId] = null;
    if (getSiteSessionStatus(siteId) !== 'authenticated') return;
    if (ordersLookupRunningSites.has(siteId)) return;

    ordersLookupRunningSites.add(siteId);
    try {
      logBackground('info', siteId, 'Автосканування замовлень (сесію підтверджено)');
      await scanUniverOrders();
      notifySecuritiesUpdated('all', 'orders');
    } catch (err) {
      broadcast('scan-state', {
        scanning: false,
        scanKind: 'orders',
        siteId,
        message: `UNIVER: ${err.message}`,
      });
    } finally {
      ordersLookupRunningSites.delete(siteId);
    }
  }, 2000);
}

function scheduleSessionDataRefresh(siteId) {
  schedulePortfolioLookupAfterSignIn(siteId);
  scheduleOrdersLookupAfterSignIn(siteId);
}

function queueVerifyAndBroadcast(siteId) {
  return sessionManager.queueVerify(siteId).then((state) => {
    broadcastSessionStates();
    return state;
  });
}

async function verifyAllSessionsAndBroadcast() {
  await sessionManager.verifyAllSessions();
  broadcastSessionStates();
  const states = sessionManager.cloneStates();
  for (const state of states) {
    if (state.siteId === 'univer' && state.status === 'authenticated') {
      scheduleOrdersLookupAfterSignIn('univer');
    }
  }
  return states;
}

function broadcastSessionStates() {
  const states = sessionManager.cloneStates();
  if (sessionStatusesInitialized) {
    for (const state of states) {
      const previous = lastKnownSessionStatus[state.siteId];
      if (state.status === 'authenticated' && previous !== 'authenticated') {
        scheduleSessionDataRefresh(state.siteId);
      }
      lastKnownSessionStatus[state.siteId] = state.status;
    }
  }
  broadcast('session-states', states);
  refreshBrowserLayoutForSite();
}

function getSiteSessionStatus(siteId) {
  return sessionManager.cloneStates().find((state) => state.siteId === siteId)?.status ?? 'unknown';
}

async function attemptAutomaticSiteSignIn(siteId) {
  const site = getSite(siteId);
  const creds = credentialsStore.getLatestSiteCredentials(siteId);

  if (!creds?.username) {
    await switchSite(siteId, site.signInUrl);
    return {
      authenticated: false,
      needsManual: true,
      message: 'Збережіть облікові дані в Особисті дані',
    };
  }

  if (site.passwordRequired && !creds.password) {
    await switchSite(siteId, site.signInUrl);
    return {
      authenticated: false,
      needsManual: true,
      message: 'Збережіть пароль у Особисті дані',
    };
  }

  const mode = site.supportsHeadlessSignIn ? 'headless' : 'auto';
  automationLog.push('info', siteId, `Автовхід перед купівлею (${mode === 'headless' ? 'фон' : 'авто'})`);

  if (mode === 'headless') {
    try {
      const result = await automationRunner.runHeadlessSignIn(siteId, creds.username, creds.password);
      if (result.openUrl && siteId !== 'univer') {
        await switchSite(siteId, result.openUrl);
      }
    } catch (err) {
      if (siteId === 'univer') {
        await queueVerifyAndBroadcast(siteId);
        if (getSiteSessionStatus(siteId) === 'authenticated') {
          return { authenticated: true, message: `${site.name}: сесія активна` };
        }
      }
      await switchSite(siteId, site.signInUrl);
      throw err;
    }
  } else {
    const runVisibleAutoSignIn = async () => {
      await switchSite(siteId, site.signInUrl);
      if (!browserView) throw new Error('Не вдалося відкрити браузер');
      await automationRunner.runSignIn(
        browserView.webContents,
        siteId,
        'auto',
        creds.username,
        { navigate: false, password: creds.password },
      );
    };

    if (siteId === 'privat') {
      await withPrivatSignInLayout(runVisibleAutoSignIn);
    } else {
      await runVisibleAutoSignIn();
    }
  }

  await queueVerifyAndBroadcast(siteId);
  const authenticated = getSiteSessionStatus(siteId) === 'authenticated';
  return {
    authenticated,
    needsManual: !authenticated,
    message: authenticated
      ? `${site.name}: сесія активна`
      : `Завершіть вхід на ${site.name} у браузері`,
  };
}

function isPrivatBrowserExpanded() {
  if (activeSiteId !== 'privat') return false;
  if (privatSignInLayout) return true;
  return getSiteSessionStatus('privat') !== 'authenticated';
}

function broadcastBrowserLayoutState() {
  broadcast('browser-layout-state', {
    activeSiteId,
    panelSuppressed: isPrivatBrowserExpanded(),
    reason: isPrivatBrowserExpanded() ? 'privat_signin' : null,
  });
}

function refreshBrowserLayoutForSite() {
  if (!mainWindow) return;
  layoutView();
  broadcastBrowserLayoutState();
}

async function withPrivatSignInLayout(taskFn) {
  privatSignInLayout = true;
  refreshBrowserLayoutForSite();
  try {
    return await taskFn();
  } finally {
    privatSignInLayout = false;
    refreshBrowserLayoutForSite();
  }
}

function scheduleAuthCheckFromPage(siteId, url) {
  sessionManager.updateFromBrowserUrl(siteId, url);
  broadcastSessionStates();

  if (authCheckTimer) clearTimeout(authCheckTimer);
  authCheckTimer = setTimeout(() => {
    queueVerifyAndBroadcast(siteId);
  }, 2500);
}

async function waitForSelector(webContents, selector, timeoutMs = 90000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const count = await webContents.executeJavaScript(
      `document.querySelectorAll(${JSON.stringify(selector)}).length`,
    );
    if (count > 0) return count;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  return 0;
}

function notifySecuritiesUpdated(siteFilter = 'all', listKind = 'catalog', options = {}) {
  const data = {
    ...getSecurities(siteFilter, listKind),
    ...(options.fromCache ? { fromCache: true } : {}),
  };
  broadcast('securities-updated', data);
  return data;
}

function broadcastCachedSecurities() {
  if (!hasCachedLists()) return;
  for (const listKind of ['catalog', 'holdings', 'orders']) {
    const data = getSecurities('all', listKind);
    if (data.proposals?.length) {
      notifySecuritiesUpdated('all', listKind, { fromCache: true });
    }
  }
}

async function loadUrlWithTimeout(webContents, url, timeoutMs = 60000) {
  webContents.setUserAgent(CHROME_UA);

  const normalizePath = (value) => {
    try {
      return new URL(value).pathname.replace(/\/$/, '') || '/';
    } catch {
      return String(value || '').replace(/\/$/, '');
    }
  };

  const targetPath = normalizePath(url);

  const reachedTarget = () => {
    const current = webContents.getURL();
    if (!current || current === 'about:blank') return false;
    try {
      const currentUrl = new URL(current);
      const targetUrl = new URL(url);
      return currentUrl.origin === targetUrl.origin
        && normalizePath(current) === targetPath;
    } catch {
      return current.startsWith(url.replace(/\/$/, ''));
    }
  };

  await new Promise((resolve, reject) => {
    let settled = false;

    const finish = (fn) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      webContents.removeListener('did-finish-load', onFinishLoad);
      webContents.removeListener('did-navigate', onNavigate);
      webContents.removeListener('did-fail-load', onFailLoad);
      fn();
    };

    const onFinishLoad = () => {
      if (reachedTarget()) finish(resolve);
    };

    const onNavigate = (_event, navigatedUrl) => {
      if (normalizePath(navigatedUrl) === targetPath) finish(resolve);
    };

    const onFailLoad = (_event, errorCode, _description, validatedURL, isMainFrame) => {
      if (!isMainFrame) return;
      if (errorCode === -3) return;
      if (reachedTarget() || normalizePath(validatedURL) === targetPath) {
        finish(resolve);
        return;
      }
      if (errorCode === -2) {
        setTimeout(() => {
          if (reachedTarget()) finish(resolve);
          else finish(() => reject(new Error(`ERR_FAILED (-2) loading '${validatedURL || url}'`)));
        }, 400);
        return;
      }
      finish(() => reject(new Error(`Помилка завантаження (${errorCode}): ${validatedURL || url}`)));
    };

    const timer = setTimeout(
      () => finish(() => reject(new Error(`Таймаут завантаження: ${url}`))),
      timeoutMs,
    );

    webContents.on('did-finish-load', onFinishLoad);
    webContents.on('did-navigate', onNavigate);
    webContents.on('did-fail-load', onFailLoad);

    webContents.loadURL(url).catch((err) => {
      setTimeout(() => {
        if (reachedTarget()) finish(resolve);
        else finish(() => reject(err));
      }, 400);
    });
  });
}

function attachScanWindowHandlers(webContents, siteId = null) {
  webContents.setWindowOpenHandler(({ url }) => {
    automationLog.pushBackground('info', siteId, `Заблоковано popup: ${url}`);
    return { action: 'deny' };
  });
  webContents.on('will-navigate', (event, url) => {
    if (shouldOpenExternally(url) || /\.(pdf|doc|docx|xls|xlsx|zip)(\?|$)/i.test(url)) {
      event.preventDefault();
      automationLog.pushBackground('info', siteId, `Заблоковано перехід: ${url}`);
    }
  });
}

function logBackground(level, siteId, message) {
  automationLog.pushBackground(level, siteId, message);
}

async function scanSiteCatalog(siteId) {
  const scanner = getScanner(siteId);
  const site = getSite(siteId);
  logBackground('info', siteId, `Сканування каталогу ${scanner.name}`);
  broadcast('scan-state', { scanning: true, siteId, message: `Завантаження ${scanner.name}…` });

  const webPreferences = {
    nodeIntegration: false,
    contextIsolation: true,
    sandbox: true,
    webSecurity: true,
  };
  if (scanner.useSitePartition && site?.partition) {
    webPreferences.partition = site.partition;
  }

  const scanWindow = new BrowserWindow({
    show: false,
    webPreferences,
  });
  scanWindow.webContents.setUserAgent(CHROME_UA);
  attachScanWindowHandlers(scanWindow.webContents, siteId);

  try {
    logBackground('info', siteId, `Завантаження ${scanner.catalogUrl}`);
    await loadUrlWithTimeout(scanWindow.webContents, scanner.catalogUrl);
    await new Promise((resolve) => setTimeout(resolve, scanner.prepareDelayMs || 500));

    if (scanner.preparePage) {
      broadcast('scan-state', { scanning: true, siteId, message: `Підготовка сторінки ${scanner.name}…` });
      await scanWindow.webContents.executeJavaScript(scanner.preparePage);
      await new Promise((resolve) => setTimeout(resolve, 800));
    }

    broadcast('scan-state', { scanning: true, siteId, message: `Пошук даних ${scanner.name}…` });
    const matchCount = await waitForSelector(scanWindow.webContents, scanner.waitSelector, 60000);
    if (matchCount === 0) {
      logBackground('error', siteId, scanner.layoutErrorMessage);
      throw new Error(scanner.layoutErrorMessage);
    }

    if (scanner.checkAuthJs) {
      const authResult = await scanWindow.webContents.executeJavaScript(scanner.checkAuthJs);
      const authenticated = typeof authResult === 'boolean'
        ? authResult
        : isAuthenticatedResult(authResult);
      if (!authenticated) {
        const currentUrl = scanWindow.webContents.getURL().toLowerCase();
        if (siteId === 'univer' && currentUrl.includes('/client/login')) {
          throw new Error('Сесія UNIVER недійсна — увійдіть через «Особисті дані» або toolbar');
        }
        throw new Error(scanner.authRequiredMessage || 'Потрібна авторизація');
      }
    }

    const rawItems = await scanWindow.webContents.executeJavaScript(scanner.extractJs);
    const proposals = scanner.processRawItems(rawItems);
    if (!proposals.length) {
      logBackground('warning', siteId, scanner.emptyMessage);
      throw new Error(scanner.emptyMessage);
    }

    saveSiteSecurities(siteId, proposals);
    logBackground('info', siteId, `Каталог: знайдено ${proposals.length} ОВДП`);
    broadcast('scan-state', { scanning: true, siteId, message: `${scanner.name}: ${proposals.length} ОВДП` });
    return proposals;
  } catch (err) {
    logBackground('error', siteId, `Каталог: ${err.message}`);
    throw err;
  } finally {
    if (!scanWindow.isDestroyed()) {
      scanWindow.destroy();
    }
  }
}

async function scanCatalogs(siteIds = listScannerIds()) {
  if (scanInProgress) {
    throw new Error('Сканування вже виконується');
  }

  scanInProgress = true;
  broadcast('scan-state', { scanning: true, scanKind: 'catalog' });

  try {
    for (const siteId of siteIds) {
      await scanSiteCatalog(siteId);
    }
    return notifySecuritiesUpdated('all', 'catalog');
  } finally {
    scanInProgress = false;
    broadcast('scan-state', { scanning: false, scanKind: 'catalog' });
  }
}

async function scanSitePortfolio(siteId) {
  const scanner = getPortfolioScanner(siteId);
  const site = getSite(siteId);

  if (getSiteSessionStatus(siteId) !== 'authenticated') {
    throw new Error(scanner.authRequiredMessage);
  }

  logBackground('info', siteId, `Сканування портфеля ${scanner.name}`);
  broadcast('scan-state', {
    scanning: true,
    scanKind: 'portfolio',
    siteId,
    message: `Завантаження портфеля ${scanner.name}…`,
  });

  const scanWindow = new BrowserWindow({
    show: false,
    webPreferences: {
      partition: site.partition,
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      webSecurity: true,
    },
  });
  attachScanWindowHandlers(scanWindow.webContents, siteId);

  try {
    if (scanner.balanceUrl && scanner.extractBalanceJs) {
      broadcast('scan-state', {
        scanning: true,
        scanKind: 'portfolio',
        siteId,
        message: `Баланс рахунку ${scanner.name}…`,
      });
      try {
        logBackground('info', siteId, `Завантаження балансу: ${scanner.balanceUrl}`);
        await loadUrlWithTimeout(scanWindow.webContents, scanner.balanceUrl);
        await new Promise((resolve) => setTimeout(resolve, scanner.balancePrepareDelayMs || 2000));

        const authenticatedForBalance = await scanWindow.webContents.executeJavaScript(scanner.checkAuthJs);
        if (!authenticatedForBalance) {
          throw new Error(scanner.authRequiredMessage);
        }

        const accountInfo = await scanWindow.webContents.executeJavaScript(scanner.extractBalanceJs);
        if (accountInfo?.balance_uah != null || accountInfo?.balance_text) {
          saveSiteAccountInfo(siteId, accountInfo);
          logBackground(
            'info',
            siteId,
            `Баланс: ${accountInfo.balance_text || accountInfo.balance_uah} ₴`,
          );
          broadcast('scan-state', {
            scanning: true,
            scanKind: 'portfolio',
            siteId,
            message: `${scanner.name}: баланс ${accountInfo.balance_text || accountInfo.balance_uah} ₴`,
          });
        } else {
          logBackground('warning', siteId, 'Баланс не знайдено на сторінці');
        }
      } catch (balanceErr) {
        logBackground('warning', siteId, `Баланс: ${balanceErr.message}`);
        broadcast('scan-state', {
          scanning: true,
          scanKind: 'portfolio',
          siteId,
          message: `${scanner.name}: баланс не зчитано (${balanceErr.message})`,
        });
      }
    }

    let rawItems;
    if (typeof scanner.scanHoldings === 'function') {
      rawItems = await scanner.scanHoldings(scanWindow.webContents, {
        loadUrlWithTimeout,
        delay: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
        broadcast,
        logBackground: (level, message) => logBackground(level, siteId, message),
        siteId,
        name: scanner.name,
      });
    } else {
      logBackground('info', siteId, `Завантаження портфеля: ${scanner.portfolioUrl}`);
      await loadUrlWithTimeout(scanWindow.webContents, scanner.portfolioUrl);
      await new Promise((resolve) => setTimeout(resolve, scanner.prepareDelayMs || 1500));

      const authenticated = await scanWindow.webContents.executeJavaScript(scanner.checkAuthJs);
      if (!authenticated) {
        throw new Error(scanner.authRequiredMessage);
      }

      if (scanner.preparePage) {
        broadcast('scan-state', {
          scanning: true,
          scanKind: 'portfolio',
          siteId,
          message: `Підготовка портфеля ${scanner.name}…`,
        });
        await scanWindow.webContents.executeJavaScript(scanner.preparePage);
        await new Promise((resolve) => setTimeout(resolve, 1200));
      }

      broadcast('scan-state', {
        scanning: true,
        scanKind: 'portfolio',
        siteId,
        message: `Пошук позицій ${scanner.name}…`,
      });

      const matchCount = await waitForSelector(scanWindow.webContents, scanner.waitSelector, 60000);
      if (matchCount === 0) {
        throw new Error(scanner.layoutErrorMessage);
      }

      rawItems = await scanWindow.webContents.executeJavaScript(scanner.extractJs);
    }

    const holdings = scanner.processRawItems(rawItems);

    saveSiteHoldings(siteId, holdings);
    logBackground('info', siteId, `Портфель: ${holdings.length} поз.`);
    broadcast('scan-state', {
      scanning: true,
      scanKind: 'portfolio',
      siteId,
      message: `${scanner.name}: ${holdings.length} поз. у портфелі`,
    });
    return holdings;
  } catch (err) {
    logBackground('error', siteId, `Портфель: ${err.message}`);
    throw err;
  } finally {
    if (!scanWindow.isDestroyed()) {
      scanWindow.destroy();
    }
  }
}

async function scanPortfolios(siteIds = listPortfolioScannerIds()) {
  if (scanInProgress) {
    throw new Error('Сканування вже виконується');
  }

  scanInProgress = true;
  broadcast('scan-state', { scanning: true, scanKind: 'portfolio' });

  try {
    for (const siteId of siteIds) {
      if (getSiteSessionStatus(siteId) !== 'authenticated') {
        broadcast('scan-state', {
          scanning: true,
          scanKind: 'portfolio',
          siteId,
          message: `${getSite(siteId).name}: пропущено (немає сесії)`,
        });
        continue;
      }
      await scanSitePortfolio(siteId);
    }
    return notifySecuritiesUpdated('all', 'holdings');
  } finally {
    scanInProgress = false;
    broadcast('scan-state', { scanning: false, scanKind: 'portfolio' });
  }
}

async function scanUniverOrders({ expectedOrderId } = {}) {
  const siteId = 'univer';
  const site = getSite(siteId);

  if (getSiteSessionStatus(siteId) !== 'authenticated') {
    throw new Error('Спочатку увійдіть на UNIVER');
  }

  logBackground('info', siteId, `Завантаження замовлень: ${ORDERS_URL}`);
  broadcast('scan-state', {
    scanning: true,
    scanKind: 'orders',
    siteId,
    message: 'Завантаження замовлень UNIVER…',
  });

  const scanWindow = new BrowserWindow({
    show: false,
    webPreferences: {
      partition: site.partition,
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      webSecurity: true,
    },
  });
  attachScanWindowHandlers(scanWindow.webContents, siteId);

  try {
    await loadUrlWithTimeout(scanWindow.webContents, ORDERS_URL);
    await new Promise((resolve) => setTimeout(resolve, 1500));

    const authResult = await scanWindow.webContents.executeJavaScript(site.checkAuthJs);
    if (!isAuthenticatedResult(authResult)) {
      throw new Error('Сесія UNIVER недійсна — увійдіть знову');
    }

    const matchCount = await waitForSelector(scanWindow.webContents, ORDERS_WAIT_SELECTOR, 30000);
    if (matchCount === 0) {
      saveSiteOrders(siteId, []);
      logBackground('warning', siteId, 'Таблицю замовлень не знайдено на blok-bek');
      return [];
    }

    const rawItems = await scanWindow.webContents.executeJavaScript(EXTRACT_UNIVER_ORDERS_JS);
    const orders = processRawOrders(rawItems);
    saveSiteOrders(siteId, orders);
    logBackground('info', siteId, `Замовлення: ${orders.length} записів`);

    if (expectedOrderId) {
      const found = orders.some((order) => String(order.order_id) === String(expectedOrderId));
      if (found) {
        logBackground('info', siteId, `Замовлення #${expectedOrderId} з’явилось в історії`);
      } else {
        logBackground(
          'warning',
          siteId,
          `Замовлення #${expectedOrderId} поки не з’явилось в історії (${orders.length} записів)`,
        );
      }
    }

    broadcast('scan-state', {
      scanning: true,
      scanKind: 'orders',
      siteId,
      message: `UNIVER: ${orders.length} замовлень`,
    });
    return orders;
  } catch (err) {
    logBackground('error', siteId, `Замовлення: ${err.message}`);
    throw err;
  } finally {
    if (!scanWindow.isDestroyed()) {
      scanWindow.destroy();
    }
    broadcast('scan-state', { scanning: false, scanKind: 'orders' });
  }
}

function getPanelWidth() {
  return 0;
}

function getInzhurOverlayInset() {
  if (activeSiteId !== 'inzhur' || inzhurOverlayCollapsed) return 0;
  return INZHUR_OVERLAY_HEIGHT;
}

function broadcastInzhurOverlayState() {
  broadcast('inzhur-overlay-state', {
    visible: activeSiteId === 'inzhur',
    collapsed: inzhurOverlayCollapsed,
    height: INZHUR_OVERLAY_HEIGHT,
    pageTheme: inzhurPageTheme,
    pageThemeLabel: getInzhurPageTheme(inzhurPageTheme).label,
  });
}

async function applyInzhurPageTheme(webContents) {
  if (!webContents || webContents.isDestroyed()) return;
  let url = '';
  try {
    url = webContents.getURL();
  } catch {
    return;
  }
  if (!url.includes('inzhur.reit')) return;

  try {
    await webContents.executeJavaScript(buildInzhurThemeInjectScript(inzhurPageTheme), true);
  } catch {
    // Page may still be loading or cross-origin frame.
  }
}

function getLayoutBounds() {
  const [width, height] = mainWindow.getContentSize();
  const contentHeight = Math.max(0, height - TOOLBAR_HEIGHT);
  const calcWidth = getPanelWidth();
  const overlayInset = getInzhurOverlayInset();

  return {
    browser: {
      x: 0,
      y: TOOLBAR_HEIGHT + overlayInset,
      width: Math.max(0, width - calcWidth),
      height: Math.max(0, contentHeight - overlayInset),
    },
  };
}

function layoutView() {
  if (!mainWindow) return;
  if (!browserView) {
    mainWindow.setBrowserView(null);
    return;
  }
  const bounds = getLayoutBounds();
  browserView.setBounds(bounds.browser);
}

function setPanelTab(tabId) {
  const normalized = normalizePanelTab(tabId);
  if (!normalized) return panelTab;
  panelTab = normalized;
  broadcast('panel-tab', panelTab);
  return panelTab;
}

/** @deprecated */
function setAppMode(mode) {
  if (mode === 'auto') return setPanelTab('automation');
  return setPanelTab(panelTab === 'calculator' ? 'calculator' : 'bonds');
}

/** @deprecated */
function setManualTab(tabId) {
  if (tabId === 'calculator') return setPanelTab('calculator');
  return setPanelTab('bonds');
}

function sendNavigationState() {
  if (!mainWindow) return;

  if (activeSiteId === 'cabinet') {
    mainWindow.webContents.send('navigation-state', {
      url: `Кабінет — ${APP_NAME}`,
      activeSiteId: 'cabinet',
      canGoBack: false,
      canGoForward: false,
      isHome: false,
    });
    return;
  }

  if (!browserView) {
    return;
  }

  const { webContents } = browserView;
  const url = webContents.getURL();
  mainWindow.webContents.send('navigation-state', {
    url,
    activeSiteId,
    canGoBack: webContents.navigationHistory.canGoBack(),
    canGoForward: webContents.navigationHistory.canGoForward(),
    isHome: false,
  });
}

function normalizePanelTab(tabId) {
  const map = {
    securities: 'bonds',
    bonds: 'bonds',
    calculator: 'bonds',
    setup: 'setup',
    automation: 'setup',
    auto: 'setup',
  };
  return map[tabId] || null;
}

function detachBrowserView() {
  if (browserView && activeSiteId && activeSiteId !== 'cabinet') {
    try {
      lastUrls[activeSiteId] = browserView.webContents.getURL();
    } catch {
      // view may be destroyed
    }
  }

  if (browserView) {
    mainWindow.removeBrowserView(browserView);
    browserView.webContents.close();
    browserView = null;
  }
  mainWindow?.setBrowserView(null);
}

function showCabinetScreen() {
  detachBrowserView();

  activeSiteId = 'cabinet';
  mainWindow.setTitle(`Кабінет — ${APP_NAME}`);
  broadcast('active-site', { siteId: 'cabinet' });
  broadcast('panel-tab', panelTab);
  broadcastInzhurOverlayState();
  refreshBrowserLayoutForSite();
  sendNavigationState();
}

function attachViewHandlers(view, siteId) {
  const { webContents } = view;

  webContents.setWindowOpenHandler(({ url }) => {
    if (shouldOpenExternally(url)) {
      shell.openExternal(url);
      return { action: 'deny' };
    }
    webContents.loadURL(url);
    return { action: 'deny' };
  });

  webContents.on('will-navigate', (event, url) => {
    if (shouldOpenExternally(url)) {
      event.preventDefault();
      shell.openExternal(url);
    }
  });

  webContents.on('did-navigate', (_event, url) => {
    const detected = detectSiteFromUrl(url);
    if (detected) activeSiteId = detected;
    sendNavigationState();
    scheduleAuthCheckFromPage(activeSiteId, url);
  });

  webContents.on('did-navigate-in-page', (_event, url) => {
    sendNavigationState();
    scheduleAuthCheckFromPage(activeSiteId, url);
    if (siteId === 'inzhur') applyInzhurPageTheme(webContents);
  });

  webContents.on('did-start-loading', () => {
    mainWindow?.webContents.send('loading', true);
  });

  webContents.on('did-stop-loading', () => {
    mainWindow?.webContents.send('loading', false);
    sendNavigationState();
    scheduleAuthCheckFromPage(activeSiteId, webContents.getURL());
    if (siteId === 'inzhur') applyInzhurPageTheme(webContents);
    sessionManager.refreshCookieFlags(siteId).then(() => {
      broadcastSessionStates();
    });
  });

  webContents.on('dom-ready', () => {
    if (siteId === 'inzhur') applyInzhurPageTheme(webContents);
  });
}

function createBrowserView(siteId) {
  const site = getSite(siteId);
  sessionManager.getSession(siteId);

  const view = new BrowserView({
    webPreferences: {
      partition: site.partition,
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      webSecurity: true,
    },
  });

  attachViewHandlers(view, siteId);
  view.webContents.setUserAgent(CHROME_UA);
  return view;
}

async function switchSite(siteId, targetUrl) {
  if (siteId === 'home' || siteId === 'cabinet') {
    showCabinetScreen();
    return;
  }

  const site = getSite(siteId);
  const url = targetUrl || lastUrls[siteId] || site.homeUrl;

  if (browserView && activeSiteId === siteId) {
    if (browserView.webContents.getURL() !== url) {
      await browserView.webContents.loadURL(url);
    }
    mainWindow.setTitle(`${site.name} Shell`);
    sendNavigationState();
    broadcast('active-site', { siteId });
    broadcastInzhurOverlayState();
    refreshBrowserLayoutForSite();
    scheduleAuthCheckFromPage(siteId, url);
    return;
  }

  if (browserView && activeSiteId) {
    try {
      lastUrls[activeSiteId] = browserView.webContents.getURL();
    } catch {
      // view may be destroyed
    }
  }

  if (browserView) {
    mainWindow.removeBrowserView(browserView);
    browserView.webContents.close();
    browserView = null;
  }

  activeSiteId = siteId;
  browserView = createBrowserView(siteId);
  mainWindow.addBrowserView(browserView);
  layoutView();

  await browserView.webContents.loadURL(url);
  mainWindow.setTitle(`${site.name} Shell`);
  sendNavigationState();
  broadcast('active-site', { siteId });
  broadcastInzhurOverlayState();
  refreshBrowserLayoutForSite();
  queueVerifyAndBroadcast(siteId);
}

function loadAppIconImage() {
  const assetsDir = path.join(__dirname, '..', 'assets');
  const pngPath = path.join(assetsDir, 'icon.png');
  if (fs.existsSync(pngPath)) {
    const image = nativeImage.createFromPath(pngPath);
    if (!image.isEmpty()) {
      const { width } = image.getSize();
      if (width !== 512) {
        return image.resize({ width: 512, height: 512, quality: 'best' });
      }
      return image;
    }
  }
  return undefined;
}

function getAppIcon() {
  return loadAppIconImage();
}

function applyAppIcon() {
  if (process.platform !== 'darwin' || !app.dock) return;
  try {
    const icon = loadAppIconImage();
    if (icon) app.dock.setIcon(icon);
  } catch (err) {
    console.warn('App icon not applied:', err.message);
  }
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 900,
    minHeight: 600,
    title: APP_NAME,
    icon: getAppIcon(),
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
    },
  });

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
  });

  mainWindow.on('resize', layoutView);
  mainWindow.loadFile(path.join(__dirname, 'shell.html'));
  mainWindow.webContents.once('did-finish-load', async () => {
    broadcast('panel-tab', panelTab);
    broadcast('onboarding-state', onboardingStore.getOnboardingState());
    showCabinetScreen();
    markSessionStatusesInitialized();
    await verifyAllSessionsAndBroadcast();
    broadcastCachedSecurities();
  });
}

function registerIpc() {
  ipcMain.handle('navigate', (_event, url) => {
    browserView?.webContents.loadURL(url);
  });

  ipcMain.handle('go-back', () => {
    if (activeSiteId === 'cabinet' || !browserView) return;
    if (browserView.webContents.navigationHistory.canGoBack()) {
      browserView.webContents.navigationHistory.goBack();
    }
  });

  ipcMain.handle('go-forward', () => {
    if (activeSiteId === 'cabinet' || !browserView) return;
    if (browserView.webContents.navigationHistory.canGoForward()) {
      browserView.webContents.navigationHistory.goForward();
    }
  });

  ipcMain.handle('reload', () => {
    if (activeSiteId === 'cabinet' || !browserView) {
      verifyAllSessionsAndBroadcast();
      return;
    }
    browserView.webContents.reload();
  });

  ipcMain.handle('go-home', () => {
    showCabinetScreen();
  });

  ipcMain.handle('go-cabinet', () => {
    showCabinetScreen();
  });

  ipcMain.handle('go-signin', () => {
    if (activeSiteId === 'cabinet') return;
    switchSite(activeSiteId, getSite(activeSiteId).signInUrl);
  });

  ipcMain.handle('go-inzhur-signin', () => {
    switchSite('inzhur', getSite('inzhur').signInUrl);
  });

  ipcMain.handle('go-inzhur-dashboard', () => {
    switchSite('inzhur', getSite('inzhur').verifyUrl);
  });

  ipcMain.handle('set-inzhur-overlay-collapsed', (_event, collapsed) => {
    inzhurOverlayCollapsed = Boolean(collapsed);
    layoutView();
    broadcastInzhurOverlayState();
    return inzhurOverlayCollapsed;
  });

  ipcMain.handle('get-inzhur-overlay-state', () => ({
    visible: activeSiteId === 'inzhur',
    collapsed: inzhurOverlayCollapsed,
    height: INZHUR_OVERLAY_HEIGHT,
    pageTheme: inzhurPageTheme,
    pageThemeLabel: getInzhurPageTheme(inzhurPageTheme).label,
  }));

  ipcMain.handle('set-inzhur-page-theme', async (_event, themeId) => {
    inzhurPageTheme = getInzhurPageTheme(themeId).id;
    if (activeSiteId === 'inzhur' && browserView) {
      await applyInzhurPageTheme(browserView.webContents);
    }
    broadcastInzhurOverlayState();
    return {
      pageTheme: inzhurPageTheme,
      pageThemeLabel: getInzhurPageTheme(inzhurPageTheme).label,
    };
  });

  ipcMain.handle('cycle-inzhur-page-theme', async () => {
    inzhurPageTheme = nextInzhurPageThemeId(inzhurPageTheme);
    if (activeSiteId === 'inzhur' && browserView) {
      await applyInzhurPageTheme(browserView.webContents);
    }
    broadcastInzhurOverlayState();
    return {
      pageTheme: inzhurPageTheme,
      pageThemeLabel: getInzhurPageTheme(inzhurPageTheme).label,
    };
  });

  ipcMain.handle('go-univer-signin', () => {
    switchSite('univer', getSite('univer').signInUrl);
  });

  ipcMain.handle('go-univer-cabinet', () => {
    switchSite('univer', getSite('univer').cabinetUrl);
  });

  ipcMain.handle('go-univer-portfolio', () => {
    switchSite('univer', getSite('univer').portfolioUrl);
  });

  ipcMain.handle('toggle-calculator', () => {
    showCabinetScreen();
    setPanelTab('bonds');
    mainWindow?.webContents.send('open-calc-drawer');
    return true;
  });

  ipcMain.handle('set-panel-tab', (_event, tabId) => setPanelTab(tabId));

  ipcMain.handle('open-cabinet-tab', (_event, tabId) => {
    if (tabId === 'calculator') {
      setPanelTab('bonds');
      showCabinetScreen();
      mainWindow?.webContents.send('open-calc-drawer');
      return panelTab;
    }
    const normalized = normalizePanelTab(tabId);
    if (normalized) setPanelTab(normalized);
    showCabinetScreen();
    return panelTab;
  });

  ipcMain.handle('get-panel-tab', () => panelTab);

  ipcMain.handle('set-app-mode', (_event, mode) => setAppMode(mode));

  ipcMain.handle('get-app-mode', () => ({
    mode: panelTab === 'automation' ? 'auto' : 'manual',
    manualTab: 'bonds',
    panelTab,
  }));

  ipcMain.handle('set-manual-tab', (_event, tabId) => setManualTab(tabId));

  ipcMain.handle('sync-layout', () => {
    layoutView();
  });

  ipcMain.handle('get-scan-state', () => ({ scanning: scanInProgress }));

  ipcMain.handle('scan-inzhur-catalog', () => scanCatalogs(['inzhur']));
  ipcMain.handle('scan-univer-catalog', () => scanCatalogs(['univer']));
  ipcMain.handle('scan-privat-catalog', () => scanCatalogs(['privat']));
  ipcMain.handle('scan-all-catalogs', () => scanCatalogs(listScannerIds()));
  ipcMain.handle('scan-catalog', (_event, siteId) => {
    if (siteId === 'all') return scanCatalogs(listScannerIds());
    return scanCatalogs([siteId]);
  });

  ipcMain.handle('scan-inzhur-portfolio', () => scanPortfolios(['inzhur']));
  ipcMain.handle('scan-univer-portfolio', () => scanPortfolios(['univer']));
  ipcMain.handle('scan-univer-orders', async () => {
    const orders = await scanUniverOrders();
    return notifySecuritiesUpdated('all', 'orders');
  });
  ipcMain.handle('scan-privat-portfolio', () => scanPortfolios(['privat']));
  ipcMain.handle('scan-all-portfolios', () => scanPortfolios(listPortfolioScannerIds()));
  ipcMain.handle('scan-portfolio', (_event, siteId) => {
    if (siteId === 'all') return scanPortfolios(listPortfolioScannerIds());
    return scanPortfolios([siteId]);
  });

  ipcMain.handle('get-securities', (_event, siteFilter = 'all', listKind = 'catalog') => (
    getSecurities(siteFilter, listKind)
  ));

  ipcMain.handle('open-catalog', (_event, siteId = 'inzhur') => {
    switchSite(siteId, getCatalogUrl(siteId));
  });

  ipcMain.handle('go-catalog', () => {
    switchSite('inzhur', getCatalogUrl('inzhur'));
  });

  ipcMain.handle('go-univer-catalog', () => {
    switchSite('univer', getSite('univer').catalogUrl);
  });

  ipcMain.handle('go-privat-catalog', () => {
    switchSite('privat', getSite('privat').catalogUrl);
  });

  ipcMain.handle('go-privat-bonds', () => {
    switchSite('privat', getSite('privat').bondsListUrl);
  });

  ipcMain.handle('get-automation-sites', () => automationRunner.getAutomationSites());

  ipcMain.handle('list-credentials', () => credentialsStore.listCredentials());

  ipcMain.handle('list-site-credentials', (_event, siteId) => (
    credentialsStore.listSiteCredentials(siteId)
  ));

  ipcMain.handle('get-credentials-store-status', () => credentialsStore.getStoreStatus());

  ipcMain.handle('save-credentials', (_event, username, password, alias) => (
    credentialsStore.saveCredentials(username, password, alias)
  ));

  ipcMain.handle('save-site-credentials', (_event, siteId, username, password) => (
    credentialsStore.saveSiteCredentials(siteId, username, password)
  ));

  ipcMain.handle('delete-credentials', (_event, username) => {
    credentialsStore.deleteCredentials(username);
  });

  ipcMain.handle('delete-site-credentials', (_event, siteId, username) => {
    credentialsStore.deleteSiteCredentials(siteId, username);
  });

  ipcMain.handle('get-automation-log', () => automationLog.getLogs());

  ipcMain.handle('clear-automation-log', () => {
    automationLog.clearLogs();
    broadcastAutomationLog();
  });

  ipcMain.handle('run-sign-in', async (_event, siteId, mode = 'manual', username, password) => (
    runAutomationTask(async () => {
      automationLog.clearLogs();

      if (mode === 'headless') {
        let result;
        try {
          result = await automationRunner.runHeadlessSignIn(siteId, username, password);
        } catch (err) {
          if (siteId === 'univer') {
            await queueVerifyAndBroadcast(siteId);
            if (getSiteSessionStatus(siteId) === 'authenticated') {
              automationLog.push('warning', siteId, 'Вхід завершено після перевірки сесії');
              return { mode: 'headless', authenticated: true, recovered: true };
            }
          }
          throw err;
        }
        if (result.openUrl && siteId !== 'univer') {
          await switchSite(siteId, result.openUrl);
        }
        await queueVerifyAndBroadcast(siteId);
        return result;
      }

      const runVisibleSignIn = async () => {
        await switchSite(siteId, getSite(siteId).signInUrl);
        if (!browserView) throw new Error('Не вдалося відкрити браузер');

        const result = await automationRunner.runSignIn(
          browserView.webContents,
          siteId,
          mode,
          username,
          { navigate: false, password },
        );
        await queueVerifyAndBroadcast(siteId);
        return result;
      };

      if (siteId === 'privat') {
        return withPrivatSignInLayout(runVisibleSignIn);
      }

      return runVisibleSignIn();
    })
  ));

  ipcMain.handle('ensure-site-sign-in', async (_event, siteId) => {
    if (getSiteSessionStatus(siteId) === 'authenticated') {
      return { authenticated: true, skipped: true };
    }
    return runAutomationTask(() => attemptAutomaticSiteSignIn(siteId));
  });

  ipcMain.handle('run-purchase-route', async (_event, siteId, isin, paymentAccount, options = {}) => (
    runAutomationTask(async () => {
      const { purchaseUrl } = require('./automation/purchase');
      const { startPrivatConfirmWatcher, stopPrivatConfirmWatcher } = require('./automation/privat-confirm-watcher');
      const watchConfirmation = options.watchConfirmation === true;

      automationLog.push('info', siteId, `Маршрут купівлі${isin ? ` для ${isin}` : ''}`);
      await switchSite(siteId, purchaseUrl(siteId, isin));
      if (!browserView) throw new Error('Не вдалося відкрити браузер');

      try {
        const result = await automationRunner.runPurchaseRoute(
          browserView.webContents,
          siteId,
          isin,
          paymentAccount,
          {
            onProgress: (siteId === 'privat' || siteId === 'univer')
              ? (payload) => broadcastAutomationBuyProgress(payload)
              : undefined,
          },
        );

        if (siteId === 'privat' && watchConfirmation) {
          startPrivatConfirmWatcher(
            browserView.webContents,
            (payload) => broadcastAutomationBuyProgress(payload),
          );
        }

        if (siteId === 'privat' && paymentAccount) {
          onboardingStore.setSiteConfig('privat', { lastPaymentAccount: paymentAccount });
          broadcast('onboarding-state', onboardingStore.getOnboardingState());
        }

        return { ...result, watchingConfirmation: siteId === 'privat' && watchConfirmation };
      } finally {
        if (siteId === 'privat' && !watchConfirmation) {
          stopPrivatConfirmWatcher();
        }
      }
    })
  ));

  ipcMain.handle('stop-privat-confirm-watcher', () => {
    const { stopPrivatConfirmWatcher } = require('./automation/privat-confirm-watcher');
    stopPrivatConfirmWatcher();
    return { ok: true };
  });

  ipcMain.handle('run-univer-buy', async (_event, isin, quantity = 1) => {
    if (!isin) throw new Error('Вкажіть ISIN');

    return runAutomationTask(async () => {
      automationLog.clearLogs();

      if (getSiteSessionStatus('univer') !== 'authenticated') {
        throw new Error('Спочатку увійдіть на UNIVER');
      }

      const result = await automationRunner.runHeadlessUniverBuy({
        isin: String(isin).trim().toUpperCase(),
        quantity: Math.max(1, Number(quantity) || 1),
        onOtpWait: (payload) => broadcastOtpRequest(payload),
        onProgress: (payload) => broadcastAutomationBuyProgress(payload),
      });

      await queueVerifyAndBroadcast('univer');

      try {
        await scanUniverOrders({ expectedOrderId: result.orderId });
        notifySecuritiesUpdated('all', 'orders');
      } catch (err) {
        logBackground('warning', 'univer', `Перевірка замовлень: ${err.message}`);
      }

      return result;
    });
  });

  ipcMain.handle('submit-automation-otp', async (_event, runId, code) => {
    pendingOtp.submitCode(runId, code);
    await pendingOtp.awaitVerification(runId);
    broadcastAutomationLog();
    return { ok: true };
  });

  ipcMain.handle('cancel-automation-otp', (_event, runId) => {
    pendingOtp.cancel(runId);
    broadcastAutomationLog();
    return { ok: true };
  });

  ipcMain.handle('get-automation-busy', () => automationBusy);

  ipcMain.handle('switch-site', (_event, siteId, url) => switchSite(siteId, url));

  ipcMain.handle('get-session-states', () => sessionManager.cloneStates());

  ipcMain.handle('verify-session', (_event, siteId) => {
    if (siteId === 'all') {
      return verifyAllSessionsAndBroadcast();
    }
    return queueVerifyAndBroadcast(siteId);
  });

  ipcMain.handle('clear-session', async (_event, siteId) => {
    const state = await sessionManager.clearSiteSession(siteId);
    broadcastSessionStates();
    return state;
  });

  ipcMain.handle('get-active-site', () => activeSiteId);

  ipcMain.handle('get-browser-layout-state', () => ({
    activeSiteId,
    panelSuppressed: isPrivatBrowserExpanded(),
    reason: isPrivatBrowserExpanded() ? 'privat_signin' : null,
  }));

  ipcMain.handle('get-home-state', () => ({ visible: activeSiteId === 'cabinet' }));

  ipcMain.handle('get-cabinet-state', () => ({ visible: activeSiteId === 'cabinet' }));

  ipcMain.handle('get-onboarding-state', () => onboardingStore.getOnboardingState());

  ipcMain.handle('set-onboarding-site', (_event, siteId, patch) => (
    onboardingStore.setSiteConfig(siteId, patch)
  ));

  ipcMain.handle('complete-onboarding', () => {
    const state = onboardingStore.setOnboardingCompleted(true);
    broadcast('onboarding-state', state);
    return state;
  });

  ipcMain.handle('reset-onboarding', () => {
    const state = onboardingStore.resetOnboarding();
    broadcast('onboarding-state', state);
    return state;
  });
}

let cookiesFlushedForQuit = false;

app.on('before-quit', (event) => {
  if (cookiesFlushedForQuit) return;
  event.preventDefault();
  Promise.all(
    listSiteIds().map((siteId) => sessionManager.getSession(siteId).cookies.flushStore().catch(() => {})),
  ).finally(() => {
    cookiesFlushedForQuit = true;
    app.quit();
  });
});

app.whenReady().then(() => {
  applyAppIcon();
  if (process.platform === 'darwin' && app.dock) {
    app.dock.show();
  }
  registerIpc();
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
