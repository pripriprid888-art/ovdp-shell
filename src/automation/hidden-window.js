const { BrowserWindow } = require('electron');
const { getSite } = require('../sites/config');
const { CHROME_UA } = require('../shared/constants');
const { createSecureWebPreferences, attachBackgroundWebContentsHandlers } = require('../shared/browser');
const { delay, waitForSelector } = require('../shared/web-contents');

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

async function withHiddenWindow(siteId, callback) {
  const site = getSite(siteId);
  const win = new BrowserWindow({
    show: false,
    webPreferences: createSecureWebPreferences({ partition: site.partition }),
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
