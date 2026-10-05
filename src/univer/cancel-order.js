const UNIVER_BASE = 'https://univer.1b.app';
const { CLICK_CANCEL_ORDER_JS } = require('../automation/flows/univer-buy');
const {
  delay,
  waitForSelector,
  loadUrlWithTimeout,
  waitForLoadStop,
} = require('../shared/web-contents');

function isUniverOrderAwaitingSignature(order) {
  if (!order || order.site_id !== 'univer') return false;
  const stage = String(order.stage || '').replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim();
  return stage.toLowerCase() === 'підписати';
}

function orderPageUrl(orderId) {
  const id = String(orderId || '').trim();
  if (!id) return null;
  return `${UNIVER_BASE}/client/order/${id}/`;
}

async function clickUniverCancelOnPage(webContents) {
  if (!webContents || webContents.isDestroyed()) {
    throw new Error('Вікно UNIVER недоступне');
  }
  const found = await waitForSelector(webContents, 'a.js-change-order-status', 25000);
  if (!found) throw new Error('Кнопку «Скасувати» не знайдено');
  await delay(700);
  const result = await webContents.executeJavaScript(CLICK_CANCEL_ORDER_JS);
  if (!result?.ok) throw new Error('Кнопку «Скасувати» не знайдено');
  await delay(2500);
  await waitForLoadStop(webContents, 15000);
  return result;
}

/**
 * Opens the order in a hidden session window and clicks «Скасувати»
 * (clickButtonSaveAll on the order page).
 */
async function cancelUniverOrderPage(orderId, {
  getSite,
  createScanWindow,
  destroyScanWindow,
  shouldOpenExternally,
} = {}) {
  const normalizedId = String(orderId || '').trim();
  const url = orderPageUrl(normalizedId);
  if (!url) throw new Error('Невідомий номер замовлення');
  if (typeof getSite !== 'function' || typeof createScanWindow !== 'function') {
    throw new Error('Налаштування скасування UNIVER неповні');
  }

  const site = getSite('univer');
  const scanWindow = createScanWindow({
    partition: site.partition,
    siteId: 'univer',
    shouldOpenExternally,
  });

  try {
    await loadUrlWithTimeout(scanWindow.webContents, url, 60000);
    await waitForLoadStop(scanWindow.webContents, 15000);
    await delay(800);
    const result = await clickUniverCancelOnPage(scanWindow.webContents);
    return { orderId: normalizedId, ...result };
  } finally {
    destroyScanWindow?.(scanWindow);
  }
}

module.exports = {
  isUniverOrderAwaitingSignature,
  orderPageUrl,
  clickUniverCancelOnPage,
  cancelUniverOrderPage,
};
