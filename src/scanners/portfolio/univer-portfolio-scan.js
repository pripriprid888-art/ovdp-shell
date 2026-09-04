/** UNIVER portfolio scan: portfeli-kliientiv → Мій портфель у цінних паперах → ISIN table. */
const {
  CLICK_UNIVER_PORTFOLIO_TAB_JS,
  EXTRACT_UNIVER_PORTFOLIO_JS,
} = require('./univer-portfolio-extract');
const { CHECK_AUTH_UNIVER_BOOLEAN_JS } = require('../../session/univer-auth');

const UNIVER_CLIENT_HOME = 'https://univer.1b.app/client/';
const PORTFOLIO_URL = 'https://univer.1b.app/client/myorders/portfeli-kliientiv/';

const CHECK_AUTH_JS = CHECK_AUTH_UNIVER_BOOLEAN_JS;

const WAIT_FOR_PORTFOLIO_TAB_JS = `(() => ({
  onListPage: /portfeli-kliientiv/i.test(location.href),
  tabLabel: /мій\\s+портфель\\s+у\\s+цінних\\s+паперах/i.test(document.body?.innerText || ''),
}))()`;

const WAIT_FOR_UNIVER_ISIN_TABLE_JS = `(() => ({
  isinCells: document.querySelectorAll('td[data-key="cusstomproduct_ISIN"]').length,
  osTableRows: document.querySelectorAll('table.os-table tbody tr').length,
  isinText: /UA\\d{10}/.test(document.body?.innerText || ''),
}))()`;

async function waitForPortfolioTab(webContents, delay, timeoutMs = 20000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const state = await webContents.executeJavaScript(WAIT_FOR_PORTFOLIO_TAB_JS);
    if (state.onListPage && state.tabLabel) return state;
    await delay(500);
  }
  return webContents.executeJavaScript(WAIT_FOR_PORTFOLIO_TAB_JS);
}

async function waitForIsinTable(webContents, delay, timeoutMs = 35000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const state = await webContents.executeJavaScript(WAIT_FOR_UNIVER_ISIN_TABLE_JS);
    if (state.isinCells > 0 || state.isinText) return state;
    await delay(600);
  }
  return webContents.executeJavaScript(WAIT_FOR_UNIVER_ISIN_TABLE_JS);
}

async function navigateToUniverPortfolio(webContents, helpers) {
  const { loadUrlWithTimeout, delay, broadcast, logBackground, siteId, name } = helpers;

  logBackground?.('info', `Завантаження: ${PORTFOLIO_URL}`);
  await loadUrlWithTimeout(webContents, PORTFOLIO_URL);
  await delay(2500);

  const authenticated = await webContents.executeJavaScript(CHECK_AUTH_JS);
  if (!authenticated) {
    logBackground?.('error', 'Потрібен вхід у UNIVER (перенаправлено на авторизацію)');
    throw new Error('Потрібен вхід у UNIVER для сканування портфеля');
  }

  await waitForPortfolioTab(webContents, delay);
  logBackground?.('info', 'Сторінку portfeli-kliientiv завантажено');

  broadcast('scan-state', {
    scanning: true,
    scanKind: 'portfolio',
    siteId,
    message: `${name}: «Мій портфель у цінних паперах»…`,
  });

  const step = await webContents.executeJavaScript(CLICK_UNIVER_PORTFOLIO_TAB_JS);
  if (!step?.ok) {
    logBackground?.('error', 'Не знайдено «Мій портфель у цінних паперах»');
    throw new Error('Не знайдено «Мій портфель у цінних паперах»');
  }
  logBackground?.('info', `Клік: «${step.text}»`);

  await delay(2500);
  const contentState = await waitForIsinTable(webContents, delay);
  logBackground?.(
    'info',
    `Таблиця ISIN: комірок=${contentState.isinCells}, рядків=${contentState.osTableRows}, ISIN=${contentState.isinText ? 'так' : 'ні'}`,
  );
  await delay(1000);
}

async function scanUniverHoldings(webContents, helpers) {
  const { broadcast, logBackground, siteId, name } = helpers;
  const allItems = [];
  const seen = new Set();

  function mergeItems(items) {
    for (const item of items || []) {
      const isin = item?.isin;
      if (!isin || seen.has(isin)) continue;
      seen.add(isin);
      allItems.push(item);
    }
  }

  await navigateToUniverPortfolio(webContents, helpers);

  const items = await webContents.executeJavaScript(EXTRACT_UNIVER_PORTFOLIO_JS);
  mergeItems(items);
  logBackground?.('info', `портфель у цінних паперах: ${allItems.length} поз.`);
  broadcast('scan-state', {
    scanning: true,
    scanKind: 'portfolio',
    siteId,
    message: `${name}: ${allItems.length} поз. у портфелі`,
  });

  if (!allItems.length) {
    const hint = await webContents.executeJavaScript(`(() => ({
      url: location.href,
      isinCells: document.querySelectorAll('td[data-key="cusstomproduct_ISIN"]').length,
      osTables: document.querySelectorAll('table.os-table').length,
      hasIsinText: /UA\\d{10}/.test(document.body?.innerText || ''),
    }))()`);
    logBackground?.(
      'warning',
      `0 поз.: url=${hint.url}, os-table=${hint.osTables}, isin-комірок=${hint.isinCells}`,
    );
  }

  return allItems;
}

module.exports = {
  UNIVER_CLIENT_HOME,
  PORTFOLIO_URL,
  scanUniverHoldings,
};
