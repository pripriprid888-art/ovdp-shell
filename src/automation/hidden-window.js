const { BrowserWindow } = require('electron');
const { getSite } = require('../sites/config');

const CHROME_UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForSelector(webContents, selector, timeoutMs = 30000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const count = await webContents.executeJavaScript(
      `document.querySelectorAll(${JSON.stringify(selector)}).length`,
    );
    if (count > 0) return count;
    await delay(400);
  }
  return 0;
}

async function waitForCondition(webContents, script, timeoutMs = 30000, intervalMs = 500) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      if (await webContents.executeJavaScript(script)) return true;
    } catch {
      // page may still be loading
    }
    await delay(intervalMs);
  }
  return false;
}

function attachBackgroundWebContentsHandlers(webContents, siteId = null) {
  const automationLog = require('./logger');
  webContents.setWindowOpenHandler(({ url }) => {
    automationLog.pushBackground('info', siteId, `Заблоковано popup: ${url}`);
    return { action: 'deny' };
  });
  webContents.on('will-navigate', (event, url) => {
    try {
      const { protocol } = new URL(url);
      if (protocol !== 'http:' && protocol !== 'https:') {
        event.preventDefault();
        automationLog.pushBackground('info', siteId, `Заблоковано перехід: ${url}`);
        return;
      }
      if (/\.(pdf|doc|docx|xls|xlsx|zip)(\?|$)/i.test(url)) {
        event.preventDefault();
        automationLog.pushBackground('info', siteId, `Заблоковано документ: ${url}`);
      }
    } catch {
      event.preventDefault();
      automationLog.pushBackground('info', siteId, `Заблоковано перехід: ${url}`);
    }
  });
}

async function withHiddenWindow(siteId, callback) {
  const site = getSite(siteId);
  const win = new BrowserWindow({
    show: false,
    webPreferences: {
      partition: site.partition,
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      webSecurity: true,
    },
  });
  attachBackgroundWebContentsHandlers(win.webContents, siteId);
  win.webContents.setUserAgent(CHROME_UA);
  require('./logger').pushBackground('info', siteId, 'Фонове вікно відкрито');

  try {
    return await callback(win.webContents, win);
  } finally {
    require('./logger').pushBackground('info', siteId, 'Фонове вікно закрито');
    if (!win.isDestroyed()) {
      win.destroy();
    }
  }
}

module.exports = {
  delay,
  waitForSelector,
  waitForCondition,
  withHiddenWindow,
};
