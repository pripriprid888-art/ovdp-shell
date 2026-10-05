const { CHROME_UA } = require('./constants');

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForSelector(webContents, selector, timeoutMs = 90000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const count = await webContents.executeJavaScript(
      `document.querySelectorAll(${JSON.stringify(selector)}).length`,
    );
    if (count > 0) return count;
    await delay(250);
  }
  return 0;
}

function normalizeWebContentsPath(value) {
  try {
    return new URL(value).pathname.replace(/\/$/, '') || '/';
  } catch {
    return String(value || '').replace(/\/$/, '');
  }
}

function webContentsMatchesUrl(webContents, url) {
  if (!webContents || webContents.isDestroyed()) return false;
  const current = webContents.getURL();
  if (!current || current === 'about:blank') return false;
  const targetPath = normalizeWebContentsPath(url);
  try {
    const currentUrl = new URL(current);
    const targetUrl = new URL(url);
    return currentUrl.origin === targetUrl.origin
      && normalizeWebContentsPath(current) === targetPath;
  } catch {
    return current.startsWith(String(url).replace(/\/$/, ''));
  }
}

async function waitForUrlWithTimeout(webContents, url, timeoutMs = 60000) {
  if (!webContents || webContents.isDestroyed()) {
    throw new Error('Вікно браузера недоступне');
  }

  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (webContentsMatchesUrl(webContents, url) && !webContents.isLoading()) {
      return;
    }
    await delay(200);
  }

  if (webContentsMatchesUrl(webContents, url)) {
    await waitForLoadStop(webContents, Math.min(15000, timeoutMs));
    if (webContentsMatchesUrl(webContents, url)) return;
  }

  throw new Error(`Таймаут очікування сторінки: ${url}`);
}

async function loadUrlWithTimeout(webContents, url, timeoutMs = 60000) {
  webContents.setUserAgent(CHROME_UA);

  const targetPath = normalizeWebContentsPath(url);

  const reachedTarget = () => webContentsMatchesUrl(webContents, url);

  if (reachedTarget()) {
    await waitForLoadStop(webContents, Math.min(15000, timeoutMs));
    if (reachedTarget() && !webContents.isLoading()) return;
  }

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
      if (normalizeWebContentsPath(navigatedUrl) === targetPath) finish(resolve);
    };

    const onFailLoad = (_event, errorCode, _description, validatedURL, isMainFrame) => {
      if (!isMainFrame) return;
      if (reachedTarget() || normalizeWebContentsPath(validatedURL) === targetPath) {
        finish(resolve);
        return;
      }
      if (errorCode === -2 || errorCode === -3) {
        setTimeout(async () => {
          try {
            await waitForLoadStop(webContents, 8000);
          } catch {
            // ignore
          }
          if (reachedTarget()) finish(resolve);
          else finish(() => reject(new Error(`ERR_FAILED (${errorCode}) loading '${validatedURL || url}'`)));
        }, 600);
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

/** Wait until the main frame is not navigating (avoids executeJavaScript hangs). */
async function waitForLoadStop(webContents, timeoutMs = 12000) {
  if (!webContents || webContents.isDestroyed()) return;
  if (!webContents.isLoading()) return;

  await Promise.race([
    new Promise((resolve) => {
      const done = () => {
        webContents.removeListener('did-stop-loading', done);
        webContents.removeListener('did-fail-load', done);
        resolve();
      };
      webContents.once('did-stop-loading', done);
      webContents.once('did-fail-load', done);
    }),
    delay(timeoutMs),
  ]);
}

module.exports = {
  delay,
  waitForSelector,
  normalizeWebContentsPath,
  webContentsMatchesUrl,
  waitForUrlWithTimeout,
  loadUrlWithTimeout,
  waitForLoadStop,
};
