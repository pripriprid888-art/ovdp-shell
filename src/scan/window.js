const { BrowserWindow } = require('electron');
const { CHROME_UA } = require('../shared/constants');
const { createSecureWebPreferences, attachScanWindowHandlers } = require('../shared/browser');

function createScanWindow({ partition, siteId, shouldOpenExternally }) {
  const webPreferences = createSecureWebPreferences({ partition });
  const scanWindow = new BrowserWindow({
    show: false,
    webPreferences,
  });
  scanWindow.webContents.setUserAgent(CHROME_UA);
  attachScanWindowHandlers(scanWindow.webContents, {
    siteId,
    shouldBlockNavigation: shouldOpenExternally,
  });
  return scanWindow;
}

function destroyScanWindow(scanWindow) {
  if (scanWindow && !scanWindow.isDestroyed()) {
    scanWindow.destroy();
  }
}

module.exports = {
  createScanWindow,
  destroyScanWindow,
};
