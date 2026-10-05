const { loadDotEnv } = require('./config/load-env');
loadDotEnv();

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
const gmailTokenStore = require('./gmail/token-store');
const { runLoopbackOAuth, USER_CANCELLED, getGoogleOAuthConfig } = require('./gmail/oauth-flow');
const gmailOtpPoller = require('./gmail/otp-poller');
const { getCatalogUrl, listScannerIds } = require('./scanners/index');
const { listPortfolioScannerIds } = require('./scanners/portfolio/index');
const { saveSiteSecurities, saveSiteHoldings, saveSiteOrders, saveSiteAccountInfo, getSecurities, hasCachedLists } = require('./securities-store');
const nbuReferenceStore = require('./nbu-reference-store');
const { getSite, listSiteIds, detectSiteFromUrl } = require('./sites/config');
const { isAuthenticatedResult } = require('./session/auth-result');
const sessionManager = require('./session/manager');
const univerKeepalive = require('./session/univer-keepalive');
const privatKeepalive = require('./session/privat-keepalive');
const automationRunner = require('./automation/runner');
const automationLog = require('./automation/logger');
const credentialsStore = require('./credentials/store');
const onboardingStore = require('./onboarding/store');
const pendingOtp = require('./automation/pending-otp');
const {
  buildInzhurThemeInjectScript,
} = require('./inzhur-page-theme');
const {
  isInzhurSigninUrl,
  getSigninShellCss,
  buildInzhurSigninShellMarkScript,
  buildInzhurSigninShellRemoveScript,
} = require('./inzhur-signin-shell');
const { downloadUniverOrderPdf } = require('./univer/order-document');
const { cancelUniverOrderPage } = require('./univer/cancel-order');
const { createScanWindow, destroyScanWindow } = require('./scan/window');
const { CHROME_UA } = require('./shared/constants');
const { shouldOpenExternally } = require('./shared/browser');
const { createScanRunner } = require('./scan/runner');

const TOOLBAR_HEIGHT = 52;
const APP_NAME = 'OVDP Shell';
/** Stable storage folder — must not change when the display name changes. */
const USER_DATA_DIR = 'inzhur-shell';
const USER_DATA_FILES = ['credentials.dat', 'onboarding.json', 'securities.json', 'nbu-reference.json'];
const LEGACY_USER_DATA_DIR = 'OVDP Shell';
const SITE_PARTITIONS = ['inzhur', 'univer', 'privat'];

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
    try {
      const icon = loadAppIconImage();
      if (icon) app.dock?.setIcon(icon);
    } catch {
      // Icon assets may be missing in dev.
    }
  });
}

let mainWindow;
let browserView;
let scanSiteCatalog;
let scanCatalogs;
let scanSitePortfolio;
let scanPortfolios;
let scanUniverOrders;
let isScanInProgress = () => false;
let activeSiteId = 'cabinet';
let panelTab = 'bonds';
/** @type {Record<string, string>} */
const lastUrls = Object.fromEntries(
  listSiteIds().map((siteId) => [
    siteId,
    siteId === 'inzhur' ? getSite(siteId).signInUrl : getSite(siteId).homeUrl,
  ]),
);

let inzhurSigninCssKey = null;
let privatSignInLayout = false;

let authCheckTimer = null;
let automationBusy = false;
let otpBrowserSuspended = false;
let isQuitting = false;
let cookiesFlushedForQuit = false;
const COOKIE_FLUSH_TIMEOUT_MS = 2500;
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

function suspendBrowserForOtp() {
  if (!mainWindow || !browserView || otpBrowserSuspended) return;
  mainWindow.removeBrowserView(browserView);
  otpBrowserSuspended = true;
  broadcast('shell-otp-mode', { active: true });
}

function resumeBrowserAfterOtp() {
  if (!mainWindow || !browserView || !otpBrowserSuspended) return;
  mainWindow.addBrowserView(browserView);
  layoutView();
  otpBrowserSuspended = false;
  broadcast('shell-otp-mode', { active: false });
}

let devtoolsBrowserSuspended = false;
let pendingPrivatBiplanFill = null;
let privatPaymentWatchActive = false;
let topUpBrowserSuspended = false;
let privatPaymentCardsTimer = null;
let privatPaymentCardsState = { active: false, cards: [], selectedValue: null };
let privatPaymentFlowState = {
  clickedContinue: false,
  clickedAddToCart: false,
  confirmWatcherStarted: false,
  lastStatusMessage: '',
};

function isBrowserViewOnScreen() {
  return Boolean(browserView && activeSiteId !== 'cabinet' && !otpBrowserSuspended && !topUpBrowserSuspended);
}

function suspendBrowserForTopUp() {
  if (!mainWindow || !browserView || topUpBrowserSuspended || otpBrowserSuspended) return;
  mainWindow.removeBrowserView(browserView);
  topUpBrowserSuspended = true;
  broadcast('shell-topup-mode', { active: true });
}

function resumeBrowserAfterTopUp() {
  if (!mainWindow || !browserView || !topUpBrowserSuspended) return;
  mainWindow.addBrowserView(browserView);
  layoutView();
  topUpBrowserSuspended = false;
  broadcast('shell-topup-mode', { active: false });
}

function suspendBrowserViewForDevTools() {
  if (!mainWindow || !browserView || devtoolsBrowserSuspended || otpBrowserSuspended || topUpBrowserSuspended) return;
  mainWindow.removeBrowserView(browserView);
  devtoolsBrowserSuspended = true;
}

function resumeBrowserViewAfterDevTools() {
  if (!mainWindow || !browserView || !devtoolsBrowserSuspended || otpBrowserSuspended || topUpBrowserSuspended) return;
  mainWindow.addBrowserView(browserView);
  layoutView();
  devtoolsBrowserSuspended = false;
}

function attachEmbeddedDevToolsHandlers(webContents) {
  let reopeningDetached = false;
  webContents.on('devtools-opened', () => {
    if (reopeningDetached) return;
    reopeningDetached = true;
    try {
      webContents.closeDevTools();
      webContents.openDevTools({ mode: 'detach' });
    } finally {
      setImmediate(() => {
        reopeningDetached = false;
      });
    }
  });
}

function attachMainDevToolsHandlers() {
  if (!mainWindow) return;
  mainWindow.webContents.on('devtools-opened', () => {
    if (isBrowserViewOnScreen()) suspendBrowserViewForDevTools();
  });
  mainWindow.webContents.on('devtools-closed', () => {
    resumeBrowserViewAfterDevTools();
  });
}

function broadcastOtpRequest(payload) {
  suspendBrowserForOtp();
  const enriched = {
    ...payload,
    gmailPoll: gmailOtpPoller.shouldPollGmail(payload),
  };
  broadcast('automation-otp-request', enriched);
  gmailOtpPoller.startGmailOtpPoll(payload);
}

function broadcastAutomationBuyProgress(payload) {
  broadcast('automation-buy-progress', payload);
}

automationLog.setBroadcast(broadcastAutomationLog);

async function runAutomationTask(taskFn, options = {}) {
  if (automationBusy) {
    throw new Error('Інша автоматизація вже виконується');
  }
  automationBusy = true;
  const runId = automationLog.createRunId(options.runPrefix || 'automation');
  const category = options.category || 'sign-in';
  try {
    return await automationLog.withRun(runId, async () => {
      automationLog.pushBackground('info', options.siteId || null, options.startMessage || 'Старт автоматизації', {
        category,
        context: options.context || null,
      });
      return taskFn(runId);
    });
  } finally {
    resumeBrowserAfterOtp();
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
      await automationLog.withRun(automationLog.createRunId('scan-portfolio'), async () => {
        logBackground('info', siteId, 'Автосканування портфеля (сесію підтверджено)', {
          category: 'scan',
          context: { scanKind: 'portfolio', trigger: 'session-auth' },
        });
        await scanSitePortfolio(siteId);
      });
      notifySecuritiesUpdated('all', 'holdings');
    } catch (err) {
      automationLog.logError(siteId, `Автосканування портфеля: ${err.message}`, err, {
        category: 'scan',
        context: { scanKind: 'portfolio', trigger: 'session-auth' },
      });
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
      await automationLog.withRun(automationLog.createRunId('scan-orders'), async () => {
        logBackground('info', siteId, 'Автосканування замовлень (сесію підтверджено)', {
          category: 'scan',
          context: { scanKind: 'orders', trigger: 'session-auth' },
        });
        await scanUniverOrders();
      });
      notifySecuritiesUpdated('all', 'orders');
    } catch (err) {
      automationLog.logError(siteId, `Автосканування замовлень: ${err.message}`, err, {
        category: 'scan',
        context: { scanKind: 'orders', trigger: 'session-auth' },
      });
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
        if (state.siteId === 'univer') {
          univerKeepalive.scheduleSoon();
        }
        if (state.siteId === 'privat') {
          privatKeepalive.scheduleSoon();
        }
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

async function maybeSignInUniverOnLaunch() {
  const config = onboardingStore.getOnboardingState().sites?.univer;
  if (!config?.signInOnLaunch) return;
  if (getSiteSessionStatus('univer') === 'authenticated') return;

  const creds = credentialsStore.getLatestSiteCredentials('univer');
  if (!creds?.username || !creds.password) {
    logBackground('warning', 'univer', 'Автовхід при запуску: збережіть логін і пароль UNIVER', { category: 'sign-in' });
    return;
  }

  if (automationBusy) {
    automationLog.push('info', 'univer', 'Автовхід відкладено — інша автоматизація виконується', {
      category: 'sign-in',
    });
    return;
  }

  try {
    await runAutomationTask(() => attemptAutomaticSiteSignIn('univer'), {
      runPrefix: 'sign-in-launch',
      category: 'sign-in',
      siteId: 'univer',
      startMessage: 'Автовхід при запуску…',
    });
  } catch (err) {
    automationLog.logError('univer', `Автовхід при запуску: ${err.message}`, err, { category: 'sign-in' });
  }
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
  automationLog.push(
    'info',
    siteId,
    `Автовхід перед купівлею (${mode === 'headless' ? 'фон' : 'авто'})`,
    { category: 'sign-in', context: { mode } },
  );

  if (mode === 'headless') {
    try {
      const result = await automationRunner.runHeadlessSignIn(
        siteId,
        creds.username,
        creds.password,
        { onOtpWait: (payload) => broadcastOtpRequest(payload) },
      );
      if (result.openUrl && siteId !== 'univer') {
        await switchSite(siteId, result.openUrl);
      }
    } catch (err) {
      if (siteId === 'univer' || siteId === 'inzhur') {
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
        {
          navigate: false,
          password: creds.password,
          onOtpWait: (payload) => broadcastOtpRequest(payload),
        },
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

function getPrivatPaymentContext() {
  return {
    amount: pendingPrivatBiplanFill?.amount || null,
    contractNumber: pendingPrivatBiplanFill?.contractNumber || null,
  };
}

function broadcastPrivatPaymentCards() {
  broadcast('privat-payment-cards', {
    ...privatPaymentCardsState,
    ...getPrivatPaymentContext(),
  });
}

function clearPrivatPaymentWatch() {
  privatPaymentWatchActive = false;
  pendingPrivatBiplanFill = null;
  if (privatPaymentCardsTimer) {
    clearInterval(privatPaymentCardsTimer);
    privatPaymentCardsTimer = null;
  }
  privatPaymentFlowState = {
    clickedContinue: false,
    clickedAddToCart: false,
    confirmWatcherStarted: false,
    lastStatusMessage: '',
  };
  try {
    const { stopPrivatConfirmWatcher } = require('./automation/privat-confirm-watcher');
    stopPrivatConfirmWatcher();
  } catch {
    // ignore
  }
  privatPaymentCardsState = { active: false, cards: [], selectedValue: null };
  resumeBrowserAfterTopUp();
  broadcastPrivatPaymentCards();
}

function startPrivatPaymentWatch() {
  privatPaymentWatchActive = true;
  if (privatPaymentCardsTimer) return;
  privatPaymentCardsTimer = setInterval(() => {
    pollPrivatPaymentCards().catch(() => {});
  }, 1500);
  pollPrivatPaymentCards().catch(() => {});
}

function broadcastPrivatPaymentStep(stepInfo) {
  broadcast('privat-payment-step', stepInfo);
}

async function advancePrivatPaymentFlow(webContents) {
  if (!privatPaymentWatchActive || !pendingPrivatBiplanFill?.amount) return;

  const {
    EXTRACT_PRIVAT_PAYMENT_STEP_JS,
    detectPrivatPaymentStep,
    paymentStepStatusMessage,
    buildClickPrivatButtonScript,
  } = require('./automation/privat-payment-flow');
  const automationLog = require('./automation/logger');

  let rawStep;
  try {
    rawStep = await webContents.executeJavaScript(EXTRACT_PRIVAT_PAYMENT_STEP_JS, true);
  } catch {
    return;
  }

  const stepInfo = detectPrivatPaymentStep(rawStep);
  const statusMessage = paymentStepStatusMessage(stepInfo, {
    amount: pendingPrivatBiplanFill.amount,
  });

  broadcastPrivatPaymentStep({
    ...stepInfo,
    amount: pendingPrivatBiplanFill.amount,
    contractNumber: pendingPrivatBiplanFill.contractNumber || null,
    message: statusMessage,
  });

  if (statusMessage && statusMessage !== privatPaymentFlowState.lastStatusMessage) {
    privatPaymentFlowState.lastStatusMessage = statusMessage;
    automationLog.push('info', 'privat', statusMessage, { category: 'top-up' });
  }

  if (stepInfo.step === 'form'
    && stepInfo.formFilled
    && privatPaymentCardsState.selectedValue
    && !privatPaymentFlowState.clickedContinue) {
    await applyPrivatBiplanFill(webContents, pendingPrivatBiplanFill);
    const clicked = await webContents.executeJavaScript(
      buildClickPrivatButtonScript(['^Продовжити$']),
      true,
    );
    if (clicked?.ok) {
      privatPaymentFlowState.clickedContinue = true;
      automationLog.push('info', 'privat', 'Натиснуто «Продовжити» на формі оплати', {
        category: 'top-up',
      });
    }
  }

  if (stepInfo.step === 'confirmation') {
    if (!privatPaymentFlowState.confirmWatcherStarted) {
      const { startPrivatConfirmWatcher } = require('./automation/privat-confirm-watcher');
      startPrivatConfirmWatcher(webContents, (payload) => {
        broadcastPrivatPaymentStep({
          ...stepInfo,
          message: payload?.step || statusMessage,
        });
      });
      privatPaymentFlowState.confirmWatcherStarted = true;
    }

    if (!privatPaymentFlowState.clickedAddToCart
      && stepInfo.buttons.some((label) => /Додати в кошик/i.test(label))) {
      const clicked = await webContents.executeJavaScript(
        buildClickPrivatButtonScript(['Додати в кошик']),
        true,
      );
      if (clicked?.ok) {
        privatPaymentFlowState.clickedAddToCart = true;
        automationLog.push('info', 'privat', 'Натиснуто «Додати в кошик»', { category: 'top-up' });
      }
    }
  }
}

async function pollPrivatPaymentCards() {
  if (!privatPaymentWatchActive || !browserView || activeSiteId !== 'privat') {
    return;
  }

  const { isPrivatBiplanPaymentUrl } = require('./automation/privat-biplan-fill');
  const {
    EXTRACT_PRIVAT_PAYMENT_CARDS_JS,
    normalizePaymentCardsState,
  } = require('./scanners/privat-payment-cards');
  const webContents = browserView.webContents;
  if (webContents.isDestroyed()) return;

  const url = webContents.getURL();
  if (!isPrivatBiplanPaymentUrl(url)) {
    clearPrivatPaymentWatch();
    return;
  }

  await advancePrivatPaymentFlow(webContents);

  const raw = await webContents.executeJavaScript(EXTRACT_PRIVAT_PAYMENT_CARDS_JS, true);
  const normalized = normalizePaymentCardsState(raw);
  if (!normalized.cards.length) return;

  privatPaymentCardsState = {
    active: true,
    ...normalized,
  };
  broadcastPrivatPaymentCards();
}

async function selectPrivatPaymentCard(cardValue) {
  if (!browserView || activeSiteId !== 'privat') {
    return { ok: false, error: 'privat_not_active' };
  }

  const { buildSelectPrivatPaymentCardScript } = require('./scanners/privat-payment-cards');
  const webContents = browserView.webContents;
  if (webContents.isDestroyed()) {
    return { ok: false, error: 'view_destroyed' };
  }

  const result = await webContents.executeJavaScript(
    buildSelectPrivatPaymentCardScript(cardValue),
    true,
  );
  if (result?.ok) {
    await pollPrivatPaymentCards();
  }
  return result || { ok: false, error: 'select_failed' };
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

function withNbuReference(data) {
  return {
    ...data,
    nbu_reference: nbuReferenceStore.getSnapshot(),
  };
}

function notifySecuritiesUpdated(siteFilter = 'all', listKind = 'catalog', options = {}) {
  const data = withNbuReference({
    ...getSecurities(siteFilter, listKind),
    ...(options.fromCache ? { fromCache: true } : {}),
  });
  broadcast('securities-updated', data);
  return data;
}

async function refreshNbuReference(options = {}) {
  const { force = false, quiet = false } = options;
  if (!force && !nbuReferenceStore.isStale()) {
    const store = nbuReferenceStore.loadReference();
    broadcast('nbu-reference-updated', nbuReferenceStore.getSnapshot());
    if (hasCachedLists()) {
      notifySecuritiesUpdated('all', 'catalog');
    }
    return store;
  }

  try {
    const store = await nbuReferenceStore.refreshReference();
    if (!quiet) {
      logBackground('info', 'nbu', `Довідник НБУ: ${store.count} ОВДП`, { category: 'nbu' });
    }
    broadcast('nbu-reference-updated', nbuReferenceStore.getSnapshot());
    if (hasCachedLists()) {
      notifySecuritiesUpdated('all', 'catalog');
    }
    return store;
  } catch (err) {
    if (!quiet) {
      automationLog.logError('nbu', `Довідник НБУ: ${err.message}`, err, { category: 'nbu' });
    }
    throw err;
  }
}

function assumeGuestSessionsOnBoot() {
  sessionManager.resetAllSessionsGuest();
  broadcastSessionStates();
}

async function maybeSignInUniverForStartup() {
  if (getSiteSessionStatus('univer') === 'authenticated') return;

  const creds = credentialsStore.getLatestSiteCredentials('univer');
  if (!creds?.username || !creds.password) {
    logBackground('info', 'univer', 'Стартовий вхід UNIVER пропущено — немає збережених облікових даних', {
      category: 'sign-in',
    });
    return;
  }

  if (automationBusy) {
    logBackground('warning', 'univer', 'Стартовий вхід UNIVER відкладено — інша автоматизація виконується', {
      category: 'sign-in',
    });
    return;
  }

  try {
    broadcast('scan-state', {
      scanning: true,
      scanKind: 'catalog',
      siteId: 'univer',
      message: 'Вхід UNIVER…',
    });
    await runAutomationTask(() => attemptAutomaticSiteSignIn('univer'), {
      runPrefix: 'sign-in-startup',
      category: 'sign-in',
      siteId: 'univer',
      startMessage: 'Вхід UNIVER перед скануванням…',
    });
  } catch (err) {
    automationLog.logError('univer', `Стартовий вхід UNIVER: ${err.message}`, err, { category: 'sign-in' });
  }
}

async function runStartupNbuReferenceRefresh() {
  try {
    broadcast('scan-state', {
      scanning: true,
      scanKind: 'nbu',
      message: 'Оновлення довідника НБУ…',
    });
    logBackground('info', 'nbu', 'Стартове оновлення довідника НБУ', {
      category: 'nbu',
      context: { scanKind: 'nbu', trigger: 'startup' },
    });
    await refreshNbuReference({ quiet: true });
  } catch (err) {
    logBackground('warning', 'nbu', `Довідник НБУ при запуску: ${err.message}`, {
      category: 'nbu',
      context: { scanKind: 'nbu', trigger: 'startup' },
    });
  } finally {
    broadcast('scan-state', { scanning: false, scanKind: 'nbu' });
  }
}

async function runDeferredStartupTasks() {
  await maybeSignInUniverForStartup();

  try {
    await automationLog.withRun(automationLog.createRunId('scan-catalog'), async () => {
      logBackground('info', null, 'Стартове сканування каталогів', {
        category: 'scan',
        context: { scanKind: 'catalog', trigger: 'startup', siteIds: listScannerIds() },
      });
      await scanCatalogs(listScannerIds());
    });
  } catch (err) {
    logBackground('warning', null, `Стартове сканування каталогу: ${err.message}`, {
      category: 'scan',
      context: { scanKind: 'catalog', trigger: 'startup' },
    });
  }

  const portfolioSiteIds = listPortfolioScannerIds().filter(
    (siteId) => getSiteSessionStatus(siteId) === 'authenticated',
  );
  if (portfolioSiteIds.length) {
    try {
      await automationLog.withRun(automationLog.createRunId('scan-portfolio'), async () => {
        logBackground('info', null, 'Стартове сканування портфелів', {
          category: 'scan',
          context: { scanKind: 'portfolio', trigger: 'startup', siteIds: portfolioSiteIds },
        });
        await scanPortfolios(portfolioSiteIds);
      });
    } catch (err) {
      logBackground('warning', null, `Стартове сканування портфеля: ${err.message}`, {
        category: 'scan',
        context: { scanKind: 'portfolio', trigger: 'startup' },
      });
    }
  }

  await runStartupNbuReferenceRefresh();
}

function logBackground(level, siteId, message, options = {}) {
  const opts = typeof options === 'object' && options ? options : {};
  if (level === 'error' && opts.error) {
    return automationLog.logError(siteId, message, opts.error, { kind: 'background', ...opts });
  }
  return automationLog.pushBackground(level, siteId, message, opts);
}

({
  scanSiteCatalog,
  scanCatalogs,
  scanSitePortfolio,
  scanPortfolios,
  scanUniverOrders,
  isScanInProgress,
} = createScanRunner({
  broadcast,
  logBackground: (level, siteId, message, options = {}) => {
    logBackground(level, siteId, message, { category: 'scan', ...options });
  },
  logError: (siteId, message, err, options = {}) => {
    automationLog.logError(siteId, message, err, { kind: 'background', category: 'scan', ...options });
  },
  logDebug: (siteId, message, options = {}) => {
    automationLog.pushDebug(siteId, message, { category: 'scan', ...options });
  },
  withRun: automationLog.withRun,
  createRunId: automationLog.createRunId,
  getSiteSessionStatus,
  saveSiteSecurities,
  saveSiteHoldings,
  saveSiteOrders,
  saveSiteAccountInfo,
  isAuthenticatedResult,
  refreshNbuReference,
  notifySecuritiesUpdated,
  shouldOpenExternally,
}));

function broadcastCachedSecurities() {
  if (!hasCachedLists()) return;
  for (const listKind of ['catalog', 'holdings', 'orders']) {
    const data = getSecurities('all', listKind);
    if (data.proposals?.length) {
      notifySecuritiesUpdated('all', listKind, { fromCache: true });
    }
  }
}

function getPanelWidth() {
  return 0;
}

async function removeInzhurSigninCss(webContents) {
  if (!inzhurSigninCssKey || !webContents || webContents.isDestroyed()) return;
  try {
    await webContents.removeInsertedCSS(inzhurSigninCssKey);
  } catch {
    // CSS may already be gone with the view.
  }
  inzhurSigninCssKey = null;
}

async function syncInzhurSigninShell(webContents) {
  if (!webContents || webContents.isDestroyed()) return;
  try {
    await removeInzhurSigninCss(webContents);
    inzhurSigninCssKey = await webContents.insertCSS(getSigninShellCss());
    await webContents.executeJavaScript(buildInzhurSigninShellMarkScript(), true);
    await webContents.executeJavaScript(buildInzhurThemeInjectScript(false), true);
  } catch {
    // Page may still be loading.
  }
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
    if (isInzhurSigninUrl(url)) {
      await syncInzhurSigninShell(webContents);
      setTimeout(() => syncInzhurSigninShell(webContents), 800);
      setTimeout(() => syncInzhurSigninShell(webContents), 2500);
      return;
    }
    await webContents.executeJavaScript(buildInzhurSigninShellRemoveScript(), true);
    await removeInzhurSigninCss(webContents);
    await webContents.executeJavaScript(buildInzhurThemeInjectScript(true), true);
  } catch {
    // Page may still be loading or cross-origin frame.
  }
}

function getLayoutBounds() {
  const [width, height] = mainWindow.getContentSize();
  const contentHeight = Math.max(0, height - TOOLBAR_HEIGHT);
  const calcWidth = getPanelWidth();

  return {
    browser: {
      x: 0,
      y: TOOLBAR_HEIGHT,
      width: Math.max(0, width - calcWidth),
      height: Math.max(0, contentHeight),
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

function clearScheduledWork() {
  univerKeepalive.stop();
  privatKeepalive.stop();
  try {
    require('./automation/privat-confirm-watcher').stopPrivatConfirmWatcher();
  } catch {
    // ignore
  }

  if (authCheckTimer) {
    clearTimeout(authCheckTimer);
    authCheckTimer = null;
  }

  for (const siteId of listSiteIds()) {
    if (portfolioLookupTimers[siteId]) {
      clearTimeout(portfolioLookupTimers[siteId]);
      portfolioLookupTimers[siteId] = null;
    }
    if (ordersLookupTimers[siteId]) {
      clearTimeout(ordersLookupTimers[siteId]);
      ordersLookupTimers[siteId] = null;
    }
  }
}

function destroyAuxiliaryWindows() {
  for (const win of BrowserWindow.getAllWindows()) {
    if (mainWindow && !mainWindow.isDestroyed() && win.id === mainWindow.id) continue;
    if (!win.isDestroyed()) {
      try {
        win.destroy();
      } catch {
        // window may already be closing
      }
    }
  }
}

function finishAppQuit() {
  if (cookiesFlushedForQuit) return;
  cookiesFlushedForQuit = true;
  try {
    destroyAuxiliaryWindows();
    detachBrowserView();
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.destroy();
    }
    app.quit();
    setTimeout(() => app.exit(0), 500);
  } catch (err) {
    console.warn('Quit cleanup failed:', err);
    app.exit(1);
  }
}

function prepareAppQuit() {
  if (isQuitting) return;
  isQuitting = true;
  clearScheduledWork();
  otpBrowserSuspended = false;
  clearPrivatPaymentWatch();
  destroyAuxiliaryWindows();
  detachBrowserView();
}

function detachBrowserView() {
  const view = browserView;
  const webContents = view?.webContents;

  if (view && webContents && !webContents.isDestroyed() && activeSiteId && activeSiteId !== 'cabinet') {
    try {
      lastUrls[activeSiteId] = webContents.getURL();
    } catch {
      // view may be destroyed
    }
  }

  if (view) {
    inzhurSigninCssKey = null;
    try {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.removeBrowserView(view);
        mainWindow.setBrowserView(null);
      }
    } catch {
      // window may already be closing
    }
    try {
      if (webContents && !webContents.isDestroyed()) {
        webContents.destroy();
      }
    } catch {
      // webContents may already be gone during quit
    }
    browserView = null;
    devtoolsBrowserSuspended = false;
  } else if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.setBrowserView(null);
  }
}

function showCabinetScreen() {
  clearPrivatPaymentWatch();
  detachBrowserView();

  activeSiteId = 'cabinet';
  mainWindow.setTitle(`Кабінет — ${APP_NAME}`);
  broadcast('active-site', { siteId: 'cabinet' });
  broadcast('panel-tab', panelTab);
  refreshBrowserLayoutForSite();
  sendNavigationState();
}

async function applyPrivatBiplanFill(webContents, fillPayload) {
  if (!webContents || webContents.isDestroyed() || !fillPayload) return;
  const { buildPrivatBiplanFillScript, isPrivatBiplanPaymentUrl } = require('./automation/privat-biplan-fill');
  const url = webContents.getURL();
  if (!isPrivatBiplanPaymentUrl(url)) return;

  try {
    await webContents.executeJavaScript(buildPrivatBiplanFillScript(fillPayload), true);
  } catch {
    // Payment form may still be loading.
  }
}

function schedulePrivatBiplanFill(webContents) {
  const fillPayload = pendingPrivatBiplanFill;
  if (!fillPayload || !webContents || webContents.isDestroyed()) return;

  const attempt = () => applyPrivatBiplanFill(webContents, fillPayload);
  attempt();
  setTimeout(attempt, 600);
  setTimeout(attempt, 1500);
  setTimeout(attempt, 3000);
  setTimeout(() => {
    if (pendingPrivatBiplanFill === fillPayload) {
      pendingPrivatBiplanFill = null;
    }
  }, 12000);
}

function attachViewHandlers(view, siteId) {
  const { webContents } = view;

  attachEmbeddedDevToolsHandlers(webContents);

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
    if (siteId === 'inzhur') applyInzhurPageTheme(webContents);
    if (siteId === 'privat' && privatPaymentWatchActive) {
      const { isPrivatBiplanPaymentUrl } = require('./automation/privat-biplan-fill');
      if (!isPrivatBiplanPaymentUrl(url)) clearPrivatPaymentWatch();
      else pollPrivatPaymentCards().catch(() => {});
    }
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
    if (siteId === 'privat' && pendingPrivatBiplanFill) {
      schedulePrivatBiplanFill(webContents);
    }
    if (siteId === 'privat' && privatPaymentWatchActive) {
      pollPrivatPaymentCards().catch(() => {});
    }
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
    refreshBrowserLayoutForSite();
    scheduleAuthCheckFromPage(siteId, url);
    if (siteId === 'inzhur') applyInzhurPageTheme(browserView.webContents);
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
    inzhurSigninCssKey = null;
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
  refreshBrowserLayoutForSite();
  queueVerifyAndBroadcast(siteId);
  if (siteId === 'inzhur') applyInzhurPageTheme(browserView.webContents);
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

  if (process.platform === 'darwin') {
    const icnsPath = path.join(assetsDir, 'icon.icns');
    if (fs.existsSync(icnsPath)) {
      const icnsImage = nativeImage.createFromPath(icnsPath);
      if (!icnsImage.isEmpty()) return icnsImage;
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

  mainWindow.on('close', () => {
    prepareAppQuit();
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
    if (!cookiesFlushedForQuit) {
      app.quit();
    }
  });

  mainWindow.on('resize', layoutView);
  attachMainDevToolsHandlers();
  mainWindow.loadFile(path.join(__dirname, 'shell.html'));
  mainWindow.webContents.once('did-finish-load', () => {
    broadcast('panel-tab', panelTab);
    broadcast('onboarding-state', onboardingStore.getOnboardingState());
    showCabinetScreen();
    assumeGuestSessionsOnBoot();
    broadcastCachedSecurities();
    markSessionStatusesInitialized();

    void runDeferredStartupTasks();

    univerKeepalive.configure({
      getSessionState: () => getSiteSessionStatus('univer'),
      onSessionStale: () => queueVerifyAndBroadcast('univer'),
    });
    univerKeepalive.start(sessionManager.getSession);
    privatKeepalive.configure({
      getSessionState: () => getSiteSessionStatus('privat'),
      onSessionStale: () => queueVerifyAndBroadcast('privat'),
    });
    privatKeepalive.start(sessionManager.getSession);
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

  ipcMain.handle('go-univer-signin', () => {
    switchSite('univer', getSite('univer').signInUrl);
  });

  ipcMain.handle('go-univer-cabinet', () => {
    switchSite('univer', getSite('univer').cabinetUrl);
  });

  ipcMain.handle('go-univer-toolbar', () => {
    const site = getSite('univer');
    const url = getSiteSessionStatus('univer') === 'authenticated'
      ? site.cabinetUrl
      : site.catalogUrl;
    switchSite('univer', url);
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

  ipcMain.handle('get-scan-state', () => ({ scanning: isScanInProgress() }));

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

  ipcMain.handle('download-univer-order-pdf', async (_event, orderId, documentId) => {
    try {
      const result = await downloadUniverOrderPdf(orderId, { documentId });
      if (result.canceled) {
        return { ok: false, canceled: true };
      }
      logBackground('info', 'univer', `PDF збережено: ${result.savedPath}`);
      return { ok: true, ...result };
    } catch (err) {
      const message = err?.message || 'Не вдалося завантажити PDF';
      logBackground('error', 'univer', message);
      return { ok: false, error: message };
    }
  });

  ipcMain.handle('cancel-univer-order', async (_event, orderId) => {
    const normalizedId = String(orderId || '').trim();
    if (!normalizedId) {
      return { ok: false, error: 'Невідомий номер замовлення' };
    }
    if (getSiteSessionStatus('univer') !== 'authenticated') {
      return { ok: false, error: 'Спочатку увійдіть на UNIVER' };
    }
    try {
      logBackground('info', 'univer', `Скасування замовлення #${normalizedId}`, { category: 'orders' });
      await cancelUniverOrderPage(normalizedId, {
        getSite,
        createScanWindow,
        destroyScanWindow,
        shouldOpenExternally,
      });
      await scanUniverOrders({ expectedOrderId: normalizedId });
      notifySecuritiesUpdated('all', 'orders');
      logBackground('info', 'univer', `Замовлення #${normalizedId} скасовано`, { category: 'orders' });
      return { ok: true, orderId: normalizedId };
    } catch (err) {
      const message = err?.message || 'Не вдалося скасувати замовлення';
      logBackground('error', 'univer', message, { category: 'orders', error: err });
      return { ok: false, error: message };
    }
  });

  ipcMain.handle('scan-privat-portfolio', () => scanPortfolios(['privat']));

  ipcMain.handle('begin-univer-topup-privat', async (_event, options = {}) => {
    const {
      createUniverTopUpPayment,
      resolveUniverTopUpQuery,
      resolveUniverContractNumber,
    } = require('./scanners/privat-biplan');
    const { fetchUniverPaymentInfo } = require('./scanners/portfolio/univer-payment-info');

    if (getSiteSessionStatus('privat') !== 'authenticated') {
      return {
        ok: false,
        error: 'privat_not_authenticated',
        message: 'Спочатку увійдіть у Приват24',
      };
    }

    const onboardingState = onboardingStore.getOnboardingState();
    const securities = getSecurities();
    const existingAccount = securities?.univer?.account || {};

    let contractNumber = resolveUniverContractNumber({
      contractNumber: options.contractNumber,
      onboardingState,
      accountInfo: existingAccount,
    });

    if (!contractNumber && getSiteSessionStatus('univer') === 'authenticated') {
      automationLog.push('info', 'univer', 'Зчитуємо номер договору з UNIVER…', { category: 'top-up' });
      const fresh = await fetchUniverPaymentInfo(sessionManager.getSession);
      if (fresh.ok && fresh.contract_number) {
        contractNumber = fresh.contract_number;
        saveSiteAccountInfo('univer', { ...existingAccount, ...fresh });
        broadcast('securities-updated', getSecurities());
      }
    }

    if (!contractNumber) {
      return {
        ok: false,
        error: 'missing_contract_number',
        message: 'Не знайдено номер договору UNIVER. Оновіть портфель UNIVER або вкажіть його в «Особисті дані».',
      };
    }

    const queryString = resolveUniverTopUpQuery({
      queryString: options.queryString,
      onboardingState,
    });

    const result = await createUniverTopUpPayment(sessionManager.getSession, { queryString });
    const targetUrl = result.ok
      ? (result.paymentUrl || result.formUrl)
      : result.formUrl;

    if (!targetUrl) {
      return {
        ok: false,
        error: result.error || 'top_up_failed',
        message: result.error || 'Не вдалося відкрити поповнення UNIVER у Приват24',
      };
    }

    pendingPrivatBiplanFill = { contractNumber };
    startPrivatPaymentWatch();
    await switchSite('privat', targetUrl);
    if (browserView && !browserView.webContents.isDestroyed()) {
      await pollPrivatPaymentCards().catch(() => {});
      suspendBrowserForTopUp();
    }

    return {
      ok: true,
      url: targetUrl,
      formOnly: Boolean(result.formOnly),
      queryString,
      contractNumber,
      apiError: result.ok ? null : (result.error || null),
    };
  });

  ipcMain.handle('confirm-univer-topup-privat', async (_event, options = {}) => {
    const { normalizeTopUpAmount } = require('./automation/privat-biplan-fill');
    const amount = normalizeTopUpAmount(options.amount);
    const cardValue = String(options.cardValue || '').trim();
    const contractNumber = pendingPrivatBiplanFill?.contractNumber;

    if (!contractNumber) {
      return {
        ok: false,
        error: 'top_up_not_prepared',
        message: 'Форма оплати не підготовлена',
      };
    }
    if (!amount) {
      return {
        ok: false,
        error: 'missing_amount',
        message: 'Вкажіть суму поповнення',
      };
    }
    if (!cardValue) {
      return {
        ok: false,
        error: 'missing_card',
        message: 'Оберіть картку для оплати',
      };
    }

    pendingPrivatBiplanFill = { contractNumber, amount };
    resumeBrowserAfterTopUp();

    if (browserView && !browserView.webContents.isDestroyed()) {
      schedulePrivatBiplanFill(browserView.webContents);
      await selectPrivatPaymentCard(cardValue);
    }

    automationLog.push(
      'info',
      'privat',
      `Поповнення UNIVER: ${amount} ₴ · договір ${contractNumber}`,
      { category: 'top-up', context: { contractNumber, amount, cardValue } },
    );

    return { ok: true, amount, cardValue, contractNumber };
  });

  ipcMain.handle('cancel-univer-topup-privat', () => {
    clearPrivatPaymentWatch();
    return { ok: true };
  });

  ipcMain.handle('get-privat-payment-cards', () => ({
    ...privatPaymentCardsState,
    ...getPrivatPaymentContext(),
  }));

  ipcMain.handle('select-privat-payment-card', async (_event, cardValue) => (
    selectPrivatPaymentCard(cardValue)
  ));

  ipcMain.handle('get-privat-commissions', async (_event, isin, quantity, source) => {
    const normalizedIsin = String(isin || '').trim().toUpperCase();
    if (!normalizedIsin) {
      return { ok: false, error: 'missing_isin' };
    }
    if (getSiteSessionStatus('privat') !== 'authenticated') {
      return { ok: false, error: 'not_authenticated' };
    }

    const { fetchPrivatCommissions } = require('./scanners/privat-commissions');
    return fetchPrivatCommissions(sessionManager.getSession, {
      isin: normalizedIsin,
      count: Math.max(1, Number(quantity) || 1),
      source: source != null ? Number(source) : undefined,
    });
  });
  ipcMain.handle('scan-all-portfolios', () => scanPortfolios(listPortfolioScannerIds()));
  ipcMain.handle('scan-portfolio', (_event, siteId) => {
    if (siteId === 'all') return scanPortfolios(listPortfolioScannerIds());
    return scanPortfolios([siteId]);
  });

  ipcMain.handle('get-securities', (_event, siteFilter = 'all', listKind = 'catalog') => (
    withNbuReference(getSecurities(siteFilter, listKind))
  ));

  ipcMain.handle('get-nbu-reference', () => nbuReferenceStore.getSnapshot());

  ipcMain.handle('refresh-nbu-reference', async () => {
    const store = await refreshNbuReference({ force: true });
    return nbuReferenceStore.getSnapshot();
  });

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

  ipcMain.handle('get-automation-log', (_event, options = {}) => automationLog.getLogs(options));

  ipcMain.handle('get-automation-log-dates', () => automationLog.getLogDates());

  ipcMain.handle('get-logging-config', () => ({
    debug: automationLog.isDebugEnabled(),
  }));

  ipcMain.handle('clear-automation-log', () => {
    automationLog.clearLocalLogs();
    broadcastAutomationLog();
  });

  ipcMain.handle('run-sign-in', async (_event, siteId, mode = 'manual', username, password) => (
    runAutomationTask(async () => {
      if (mode === 'headless') {
        let result;
        try {
          result = await automationRunner.runHeadlessSignIn(
            siteId,
            username,
            password,
            { onOtpWait: (payload) => broadcastOtpRequest(payload) },
          );
        } catch (err) {
          if (siteId === 'univer' || siteId === 'inzhur') {
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
          {
            navigate: false,
            password,
            onOtpWait: (payload) => broadcastOtpRequest(payload),
          },
        );
        await queueVerifyAndBroadcast(siteId);
        return result;
      };

      if (siteId === 'privat') {
        return withPrivatSignInLayout(runVisibleSignIn);
      }

      return runVisibleSignIn();
    }, {
      runPrefix: 'sign-in',
      category: 'sign-in',
      siteId,
      startMessage: `Вхід (${mode})`,
      context: { mode },
    })
  ));

  ipcMain.handle('ensure-site-sign-in', async (_event, siteId) => {
    if (getSiteSessionStatus(siteId) === 'authenticated') {
      return { authenticated: true, skipped: true };
    }
    return runAutomationTask(() => attemptAutomaticSiteSignIn(siteId), {
      runPrefix: 'sign-in',
      category: 'sign-in',
      siteId,
      startMessage: 'Автовхід перед дією',
    });
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
    }, {
      runPrefix: 'buy',
      category: 'buy',
      siteId,
      startMessage: `Маршрут купівлі${isin ? `: ${isin}` : ''}`,
      context: { isin: isin || null, paymentAccount: paymentAccount || null },
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
      if (getSiteSessionStatus('univer') !== 'authenticated') {
        throw new Error('Спочатку увійдіть на UNIVER');
      }

      const useVisibleBrowser = Boolean(
        browserView
        && activeSiteId === 'univer'
        && !browserView.webContents.isDestroyed(),
      );
      const result = await automationRunner.runHeadlessUniverBuy({
        isin: String(isin).trim().toUpperCase(),
        quantity: Math.max(1, Number(quantity) || 1),
        webContents: useVisibleBrowser ? browserView.webContents : null,
        onOtpWait: (payload) => broadcastOtpRequest(payload),
        onProgress: (payload) => broadcastAutomationBuyProgress(payload),
      });

      if (result?.orderId) {
        broadcast('pending-univer-order', {
          orderId: String(result.orderId),
          isin: String(isin).trim().toUpperCase(),
          quantity: Math.max(1, Number(quantity) || 1),
        });
      }

      await queueVerifyAndBroadcast('univer');

      try {
        await scanSitePortfolio('univer');
        notifySecuritiesUpdated('all', 'holdings');
      } catch (err) {
        automationLog.logError('univer', `Портфель після купівлі: ${err.message}`, err, {
          category: 'scan',
          context: { scanKind: 'portfolio', trigger: 'univer-buy' },
        });
      }

      try {
        await scanUniverOrders({ expectedOrderId: result.orderId });
        notifySecuritiesUpdated('all', 'orders');
      } catch (err) {
        automationLog.logError('univer', `Перевірка замовлень: ${err.message}`, err, {
          category: 'scan',
          context: { scanKind: 'orders', trigger: 'univer-buy' },
        });
      }

      return result;
    }, {
      runPrefix: 'buy-univer',
      category: 'buy',
      siteId: 'univer',
      startMessage: `Купівля UNIVER: ${isin}`,
      context: { isin, quantity },
    });
  });

  ipcMain.handle('submit-automation-otp', async (_event, runId, code) => {
    try {
      pendingOtp.submitCode(runId, code);
      await pendingOtp.awaitVerification(runId);
      broadcastAutomationLog();
      return { ok: true };
    } catch (err) {
      broadcastAutomationLog();
      throw err;
    }
  });

  ipcMain.handle('cancel-automation-otp', (_event, runId) => {
    gmailOtpPoller.stopGmailOtpPoll(runId);
    if (!pendingOtp.hasPending(runId) && !pendingOtp.wasUserCancelled(runId)) {
      pendingOtp.cancel(runId, pendingOtp.USER_CANCELLED_BUY_MESSAGE);
      broadcastAutomationLog();
      return { ok: true, early: true };
    }
    if (!pendingOtp.hasPending(runId)) {
      return { ok: true, stale: true };
    }
    pendingOtp.cancel(runId, pendingOtp.USER_CANCELLED_BUY_MESSAGE);
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

  ipcMain.handle('get-gmail-oauth-status', () => {
    const config = getGoogleOAuthConfig();
    const status = gmailTokenStore.getStatus();
    return {
      configured: config.configured,
      connected: status.connected,
      email: status.email,
      connectedAt: status.connectedAt,
    };
  });

  ipcMain.handle('start-gmail-oauth', async () => {
    try {
      const result = await runLoopbackOAuth(mainWindow);
      broadcast('gmail-oauth-status', {
        configured: getGoogleOAuthConfig().configured,
        connected: true,
        email: result.email || gmailTokenStore.getStatus().email,
      });
      return result;
    } catch (err) {
      if (err?.message === USER_CANCELLED) {
        const cancelled = new Error('Скасовано');
        cancelled.code = 'GMAIL_OAUTH_CANCELLED';
        throw cancelled;
      }
      throw err;
    }
  });

  ipcMain.handle('disconnect-gmail-oauth', () => {
    gmailTokenStore.clearTokens();
    const payload = {
      configured: getGoogleOAuthConfig().configured,
      connected: false,
      email: null,
    };
    broadcast('gmail-oauth-status', payload);
    return payload;
  });
}

app.on('before-quit', (event) => {
  prepareAppQuit();
  if (cookiesFlushedForQuit) return;

  event.preventDefault();
  const flushCookies = Promise.all(
    listSiteIds().map((siteId) => sessionManager.getSession(siteId).cookies.flushStore().catch(() => {})),
  );
  const flushTimeout = new Promise((resolve) => {
    setTimeout(resolve, COOKIE_FLUSH_TIMEOUT_MS);
  });

  Promise.race([flushCookies, flushTimeout])
    .finally(finishAppQuit)
    .catch((err) => {
      console.warn('Cookie flush during quit failed:', err);
      finishAppQuit();
    });
});

app.whenReady().then(() => {
  applyAppIcon();
  automationLog.init();
  automationLog.installConsoleMirror();
  gmailOtpPoller.configure({
    notifyAutoOtp: (payload) => broadcast('automation-otp-auto', payload),
  });
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
  app.quit();
});
