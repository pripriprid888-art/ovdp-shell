const automationLog = require('../logger');
const { delay, waitForSelector, waitForCondition } = require('../hidden-window');

const LOGIN_URL = 'https://univer.1b.app/client/login/';
const CLIENT_HOME_URL = 'https://univer.1b.app/client/';
const UAH_OVDP_CATALOG_URL = 'https://univer.1b.app/client/custompage/38/';
const HEADLESS_AUTH_TIMEOUT_MS = 45000;

const UNIVER_PAGE_JS = String.raw`(() => {
  function isLoginPath(url) {
    const path = (url || location.href).split('?')[0].replace(/\/$/, '').toLowerCase();
    return path.endsWith('/client/login') || path.endsWith('/client/remindpassword');
  }

  function loginFormVisible() {
    const login = document.querySelector('input[name="login"]');
    return !!(login && login.offsetParent !== null);
  }

  function loginErrorMessage() {
    const nodes = document.querySelectorAll('.error, .alert, .alert-danger, [role="alert"], [class*="error"]');
    for (const node of nodes) {
      const text = (node.innerText || '').trim();
      if (!text || text.length > 280) continue;
      if (/невірн|неправильн|помилк|error|invalid|incorrect/i.test(text)) return text;
    }
    return null;
  }

  function isAuthenticated() {
    return location.href.includes('univer.1b.app') && !isLoginPath() && !loginFormVisible();
  }

  function fillAndSubmit(username, password) {
    const login = document.querySelector('input[name="login"]');
    const passwordInput = document.querySelector('input[name="password"]');
    if (!login) return false;
    login.value = username;
    login.dispatchEvent(new Event('input', { bubbles: true }));
    if (passwordInput && password) {
      passwordInput.value = password;
      passwordInput.dispatchEvent(new Event('input', { bubbles: true }));
    }
    const submit = document.querySelector('input[type="submit"][name="ok"]');
    if (submit) {
      submit.click();
      return true;
    }
    const btn = [...document.querySelectorAll('button, input[type="submit"]')]
      .find((el) => /увійти/i.test(el.innerText || el.value || ''));
    if (btn) {
      btn.click();
      return true;
    }
    return false;
  }

  return {
    isLoginPath,
    loginFormVisible,
    loginErrorMessage,
    isAuthenticated,
    fillAndSubmit,
  };
})()`;

async function execUniver(webContents, method, ...args) {
  const payload = args.length ? JSON.stringify(args) : '';
  const call = payload
    ? `api.${method}(...${payload})`
    : `api.${method}()`;
  return webContents.executeJavaScript(`(() => {
    const api = ${UNIVER_PAGE_JS};
    return ${call};
  })()`);
}

async function ensureClientHome(webContents) {
  if (!(await execUniver(webContents, 'isAuthenticated'))) return;

  const href = webContents.getURL().toLowerCase();
  if (href.includes('univer.1b.app/client') && !href.includes('/client/login')) {
    return;
  }

  try {
    await webContents.loadURL(CLIENT_HOME_URL);
  } catch (err) {
    if (await execUniver(webContents, 'isAuthenticated')) {
      automationLog.push(
        'warning',
        'univer',
        'Перехід на /client/ перервано, але сесію підтверджено',
      );
      return;
    }
    throw err;
  }
}

async function waitForUniverAuth(webContents, timeoutMs = HEADLESS_AUTH_TIMEOUT_MS) {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    const errorText = await execUniver(webContents, 'loginErrorMessage');
    if (errorText) {
      throw new Error(`UNIVER: ${errorText}`);
    }

    if (await execUniver(webContents, 'isAuthenticated')) {
      automationLog.push('info', 'univer', 'Вхід у UNIVER підтверджено');
      await ensureClientHome(webContents);
      return;
    }

    await delay(1500);
  }

  if (await execUniver(webContents, 'isAuthenticated')) {
    await ensureClientHome(webContents);
    return;
  }

  throw new Error('UNIVER: не вдалося увійти — перевірте логін і пароль');
}

async function runUniverHeadlessSignIn(webContents, username, password) {
  automationLog.push('info', 'univer', 'UNIVER: фоновий вхід');
  await webContents.loadURL(LOGIN_URL);
  await waitForSelector(webContents, 'input[name="login"]', 20000);

  if (await execUniver(webContents, 'isAuthenticated')) {
    automationLog.push('info', 'univer', 'Сесію UNIVER вже активовано');
    return { authenticated: true, reused: true };
  }

  const submitted = await execUniver(webContents, 'fillAndSubmit', username, password);
  if (!submitted) {
    throw new Error('Не вдалося надіслати форму входу UNIVER');
  }
  automationLog.push('info', 'univer', 'Облікові дані надіслано');

  await waitForUniverAuth(webContents);
  return { authenticated: true, reused: false };
}

async function gotoUniverCatalog(webContents) {
  await webContents.loadURL(UAH_OVDP_CATALOG_URL);
  await waitForSelector(webContents, '.js-product-table .js-client-buy-action', 30000);
}

module.exports = {
  CLIENT_HOME_URL,
  UAH_OVDP_CATALOG_URL,
  runUniverHeadlessSignIn,
  gotoUniverCatalog,
  execUniver,
};
