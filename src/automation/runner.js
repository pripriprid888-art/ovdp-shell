const { getSite } = require('../sites/config');
const credentialsStore = require('../credentials/store');
const automationLog = require('./logger');
const { runAutoSignIn, waitForSelector } = require('./sign-in');
const { purchaseUrl, HIGHLIGHT_ISIN_JS } = require('./purchase');
const { withHiddenWindow } = require('./hidden-window');
const pendingOtp = require('./pending-otp');
const { runPrivatHeadlessSignIn, BONDS_LIST_URL } = require('./flows/privat');
const { selectPrivatPaymentAccount } = require('./flows/privat-buy');
const { runUniverHeadlessSignIn } = require('./flows/univer');
const { runUniverBuy } = require('./flows/univer-buy');

function resolveSignInCredentials(siteId, username, passwordOverride) {
  if (passwordOverride !== undefined && passwordOverride !== null) {
    return {
      username: username || '',
      password: passwordOverride || '',
    };
  }
  return credentialsStore.resolveCredentials(siteId, username);
}

async function runSignIn(webContents, siteId, mode = 'manual', username, options = {}) {
  const site = getSite(siteId);
  const { navigate = true, password: passwordOverride } = options;
  automationLog.push('info', siteId, `Вхід (${mode === 'auto' ? 'авто' : mode === 'headless' ? 'фон' : 'ручний'}) — ${site.name}`);

  if (mode === 'headless') {
    return runHeadlessSignIn(siteId, username, passwordOverride);
  }

  if (navigate) {
    await webContents.loadURL(site.signInUrl);
  }
  await waitForSelector(webContents, 'input, button, iframe', 45000);

  if (mode !== 'auto') {
    automationLog.push('info', siteId, 'Завершіть вхід у вбудованому браузері.');
    return { mode: 'manual', url: webContents.getURL() };
  }

  const creds = resolveSignInCredentials(siteId, username, passwordOverride);
  if (!creds?.username) {
    throw new Error('Збережіть облікові дані в налаштуваннях платформ');
  }
  if (site.passwordRequired && !creds.password) {
    throw new Error('Для цього сайту потрібен пароль');
  }

  const result = await runAutoSignIn(
    webContents,
    siteId,
    creds.username,
    creds.password,
  );
  return { mode: 'auto', ...result, url: webContents.getURL() };
}

async function runHeadlessSignIn(siteId, username, passwordOverride) {
  const site = getSite(siteId);
  if (site.supportsHeadlessSignIn === false) {
    throw new Error(`Фоновий вхід для ${site.name} недоступний — використайте вхід у браузері`);
  }

  const creds = resolveSignInCredentials(siteId, username, passwordOverride);

  if (!creds?.username) {
    throw new Error('Збережіть облікові дані в налаштуваннях платформ');
  }

  if (site.passwordRequired && !creds.password) {
    throw new Error('Для цього сайту потрібен пароль');
  }

  const result = await withHiddenWindow(siteId, async (hiddenContents) => {
    if (siteId === 'privat') {
      return runPrivatHeadlessSignIn(hiddenContents, creds.username, creds.password);
    }
    if (siteId === 'univer') {
      return runUniverHeadlessSignIn(hiddenContents, creds.username, creds.password);
    }
    throw new Error(`Headless sign-in not supported for ${siteId}`);
  });

  return {
    mode: 'headless',
    ...result,
    openUrl: siteId === 'privat' ? BONDS_LIST_URL : getSite(siteId).verifyUrl,
  };
}

function reportBuyStep(onProgress, siteId, step, logMessage, level = 'info') {
  automationLog.push(level, siteId, logMessage);
  onProgress?.({ siteId, step });
}

async function runPurchaseRoute(webContents, siteId, isin, paymentAccount, options = {}) {
  const { onProgress } = options;
  const site = getSite(siteId);
  const url = purchaseUrl(siteId, isin);

  reportBuyStep(onProgress, siteId, 'Підготовка купівлі', `Маршрут купівлі${isin ? `: ${isin}` : ''}`);
  reportBuyStep(onProgress, siteId, 'Відкриття сторінки купівлі', `Завантаження ${url}`);

  await webContents.loadURL(url);

  if (siteId === 'inzhur' && isin) {
    reportBuyStep(onProgress, siteId, 'Пошук сертифіката', `Пошук ${isin} у каталозі`);
    await waitForSelector(webContents, '.investment-unit[data-asset-id]', 60000);
    const highlighted = await webContents.executeJavaScript(HIGHLIGHT_ISIN_JS(isin));
    if (!highlighted) {
      automationLog.push('warning', siteId, `ISIN ${isin} не знайдено на сторінці каталогу`);
    }
  }

  if (siteId === 'univer') {
    reportBuyStep(
      onProgress,
      siteId,
      'Підтвердження у браузері',
      'Знайдіть ISIN у таблиці та натисніть «Придбати», або використайте «Купівля UNIVER».',
    );
  }
  if (siteId === 'privat') {
    if (paymentAccount) {
      reportBuyStep(onProgress, siteId, 'Вибір рахунку', `Пошук рахунку ${paymentAccount}`);
      const { delay } = require('./hidden-window');
      const result = await selectPrivatPaymentAccount(webContents, paymentAccount, {
        waitForSelector,
        delay,
      });
      if (result?.ok) {
        reportBuyStep(onProgress, siteId, 'Рахунок обрано', `Обрано рахунок ${paymentAccount}`);
      } else {
        automationLog.push(
          'warning',
          siteId,
          `Рахунок ${paymentAccount} не знайдено на сторінці — оберіть вручну`,
        );
        reportBuyStep(
          onProgress,
          siteId,
          'Рахунок не знайдено',
          `Рахунок ${paymentAccount} не знайдено — оберіть вручну`,
          'warning',
        );
      }
    }

    reportBuyStep(
      onProgress,
      siteId,
      'Підтвердження у браузері',
      'Заповніть кількість та підтвердіть угоду вручну.',
    );
  }

  return { url: webContents.getURL(), isin: isin || null, paymentAccount: paymentAccount || null };
}

async function runUniverBuyFlow(webContents, { isin, quantity = 1, onOtpWait, onProgress }) {
  const runId = pendingOtp.createRunId();
  return runUniverBuy(webContents, { isin, quantity, runId, onOtpWait, onProgress });
}

async function runHeadlessUniverBuy({ isin, quantity = 1, onOtpWait, onProgress }) {
  onProgress?.({ siteId: 'univer', step: 'Підготовка купівлі' });
  automationLog.push('info', 'univer', `Купівля ${isin} × ${quantity} (фон)`);
  return withHiddenWindow('univer', (hiddenContents) => (
    runUniverBuyFlow(hiddenContents, { isin, quantity, onOtpWait, onProgress })
  ));
}

function getAutomationSites() {
  return Object.values(require('../sites/config').SITES).map((site) => ({
    id: site.id,
    name: site.name,
    authType: site.authType,
    usernameLabel: site.usernameLabel,
    passwordLabel: site.passwordLabel,
    passwordRequired: site.passwordRequired !== false,
    signInUrl: site.signInUrl,
    supportsAutoSignIn: site.supportsAutoSignIn !== false,
    supportsHeadlessSignIn: site.supportsHeadlessSignIn !== false,
    supportsPurchaseRoute: site.supportsPurchaseRoute !== false,
    supportsUniverBuy: site.id === 'univer',
  }));
}

module.exports = {
  runSignIn,
  runHeadlessSignIn,
  runPurchaseRoute,
  runUniverBuyFlow,
  runHeadlessUniverBuy,
  getAutomationSites,
};
