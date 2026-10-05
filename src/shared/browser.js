const automationLog = require('../automation/logger');
const { EXTERNAL_PROTOCOLS } = require('./constants');

function createSecureWebPreferences(options = {}) {
  const prefs = {
    nodeIntegration: false,
    contextIsolation: true,
    sandbox: true,
    webSecurity: true,
  };
  if (options.partition) {
    prefs.partition = options.partition;
  }
  return prefs;
}

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

function attachScanWindowHandlers(webContents, { siteId = null, shouldBlockNavigation } = {}) {
  const blockNavigation = shouldBlockNavigation || shouldOpenExternally;

  webContents.setWindowOpenHandler(({ url }) => {
    automationLog.pushBackground('info', siteId, `Заблоковано popup: ${url}`, { category: 'navigation' });
    return { action: 'deny' };
  });

  webContents.on('will-navigate', (event, url) => {
    if (blockNavigation(url) || /\.(pdf|doc|docx|xls|xlsx|zip)(\?|$)/i.test(url)) {
      event.preventDefault();
      automationLog.pushBackground('info', siteId, `Заблоковано перехід: ${url}`, { category: 'navigation' });
    }
  });
}

function attachBackgroundWebContentsHandlers(webContents, siteId = null) {
  webContents.setWindowOpenHandler(({ url }) => {
    automationLog.pushBackground('info', siteId, `Заблоковано popup: ${url}`, { category: 'navigation' });
    return { action: 'deny' };
  });

  webContents.on('will-navigate', (event, url) => {
    try {
      const { protocol } = new URL(url);
      if (protocol !== 'http:' && protocol !== 'https:') {
        event.preventDefault();
        automationLog.pushBackground('info', siteId, `Заблоковано перехід: ${url}`, { category: 'navigation' });
        return;
      }
      if (/\.(pdf|doc|docx|xls|xlsx|zip)(\?|$)/i.test(url)) {
        event.preventDefault();
        automationLog.pushBackground('info', siteId, `Заблоковано документ: ${url}`, { category: 'navigation' });
      }
    } catch {
      event.preventDefault();
      automationLog.pushBackground('info', siteId, `Заблоковано перехід: ${url}`, { category: 'navigation' });
    }
  });
}

module.exports = {
  createSecureWebPreferences,
  shouldOpenExternally,
  attachScanWindowHandlers,
  attachBackgroundWebContentsHandlers,
};
