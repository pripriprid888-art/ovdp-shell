const automationLog = require('../logger');
const pendingOtp = require('../pending-otp');
const { waitForSelector } = require('../sign-in');
const { delay, waitForCondition } = require('../hidden-window');

const INZHUR_ORIGIN = 'https://www.inzhur.reit';
const SIGNIN_URL = `${INZHUR_ORIGIN}/dashboard/signin`;
const DASHBOARD_URL = `${INZHUR_ORIGIN}/dashboard`;
const LEGACY_AUTH_ORIGIN = 'https://auth.inzhur.reit';

const INZHUR_UI_IN_PAGE = String.raw`(() => {
  function normText(el) {
    return (el?.innerText || el?.textContent || '').replace(/\\s+/g, ' ').trim();
  }

  function setInput(el, value) {
    if (!el) return false;
    el.focus();
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
    if (setter) setter.call(el, value);
    else el.value = value;
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    el.dispatchEvent(new Event('blur', { bubbles: true }));
    return true;
  }

  function findPhoneInput() {
    return document.querySelector(
      'input[type="tel"][autocomplete="tel"], input[type="tel"][placeholder*="тел" i], input[name="login"]',
    );
  }

  function findPasswordInput() {
    return document.querySelector('input[name="password"][type="password"], input[name="password"]');
  }

  function isPasswordStepVisible() {
    const pass = findPasswordInput();
    if (!pass) return false;
    const rect = pass.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  }

  function clickPhoneContinue() {
    const buttons = [...document.querySelectorAll('button')];
    const continueBtn = buttons.find((b) => /^(далі|continue|продовж)/i.test(normText(b)));
    if (continueBtn) {
      continueBtn.click();
      return true;
    }
    const phone = findPhoneInput();
    if (!phone) return false;
    phone.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true }));
    phone.dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter', code: 'Enter', bubbles: true }));
    return true;
  }

  function clickLoginButton() {
    const preloaderBtn = document.querySelector('button .preloader-anim')?.closest('button');
    if (preloaderBtn) {
      const aria = preloaderBtn.getAttribute('aria-label') || '';
      if (!/сховати|показати/i.test(aria)) {
        preloaderBtn.click();
        return true;
      }
    }
    const buttons = [...document.querySelectorAll('button[type="submit"], button')];
    const loginBtn = buttons.find((b) => {
      const aria = b.getAttribute('aria-label') || '';
      if (/сховати|показати пароль/i.test(aria)) return false;
      return /увійти/i.test(normText(b));
    });
    if (loginBtn) {
      loginBtn.click();
      return true;
    }
    return false;
  }

  function findOtpInput() {
    return document.querySelector(
      'input[autocomplete="one-time-code"], input[inputmode="numeric"], input[name*="otp" i], input[placeholder*="код" i]',
    );
  }

  function clickOtpSubmit() {
    const buttons = [...document.querySelectorAll('button')];
    const confirm = buttons.find((b) => /^(підтверд|confirm|далі|увійти)/i.test(normText(b)));
    if (confirm) {
      confirm.click();
      return true;
    }
    return clickLoginButton();
  }

  function isSignedIn() {
    const path = location.pathname || '';
    return path.includes('/dashboard') && !path.includes('/signin');
  }

  return {
    setInput,
    findPhoneInput,
    findPasswordInput,
    isPasswordStepVisible,
    clickPhoneContinue,
    clickLoginButton,
    findOtpInput,
    clickOtpSubmit,
    isSignedIn,
  };
})()`;

const INZHUR_AUTH_IN_PAGE = String.raw`(() => {
  const AUTH_ORIGIN = 'https://auth.inzhur.reit';

  async function request(path, { method = 'POST', body, extraHeaders = {} } = {}) {
    const response = await fetch(AUTH_ORIGIN + path, {
      method,
      credentials: 'include',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        'x-client-platform': 'web',
        'x-lang': 'uk',
        ...extraHeaders,
      },
      body: body != null ? JSON.stringify(body) : undefined,
    });
    let data = null;
    try {
      data = await response.json();
    } catch {
      data = null;
    }
    return {
      ok: response.ok,
      status: response.status,
      data,
      actionProofHeader: response.headers.get('x-action-proof'),
    };
  }

  function readRecaptchaToken() {
    const el = document.querySelector('textarea#g-recaptcha-response, textarea[name="g-recaptcha-response"]');
    if (el?.value && el.value.length > 20) return el.value;
    return '';
  }

  function buildLoginBody(identifier, password, recaptchaToken) {
    return { identifier, password, recaptchaToken };
  }

  async function loginInitial(identifier, password, recaptchaToken) {
    return request('/api/v1/auth/login', {
      body: buildLoginBody(identifier, password, recaptchaToken),
    });
  }

  async function verifyChallenge(verificationData, challengeId) {
    return request('/api/v1/2fa/challenges/verification', {
      body: { verificationData, challengeId },
    });
  }

  async function loginWithProof(identifier, password, recaptchaToken, actionProof) {
    const extraHeaders = {};
    if (actionProof) extraHeaders['x-action-proof'] = actionProof;
    return request('/api/v1/auth/login', {
      body: buildLoginBody(identifier, password, recaptchaToken),
      extraHeaders,
    });
  }

  function pickChallengeId(result) {
    const payload = result?.data;
    if (!payload || typeof payload !== 'object') return null;
    const root = payload.data && typeof payload.data === 'object' ? payload.data : payload;
    return root.challengeId
      || root.challenge?.id
      || root.challenge?.challengeId
      || null;
  }

  function pickActionProof(result) {
    if (result?.actionProofHeader) return result.actionProofHeader;
    const payload = result?.data;
    if (!payload || typeof payload !== 'object') return null;
    const root = payload.data && typeof payload.data === 'object' ? payload.data : payload;
    return payload.actionProof
      || root?.actionProof
      || root?.proof
      || payload.proof
      || null;
  }

  function pickAccessToken(result) {
    const payload = result?.data;
    if (!payload || typeof payload !== 'object') return null;
    const root = payload.data && typeof payload.data === 'object' ? payload.data : payload;
    return root?.accessToken
      || root?.access_token
      || root?.token
      || payload.accessToken
      || payload.token
      || null;
  }

  function persistAccessToken(token) {
    if (!token) return false;
    const keys = ['accessToken', 'access_token', 'auth.token', 'inzhur.token', 'token'];
    for (const key of keys) {
      try {
        localStorage.setItem(key, token);
        sessionStorage.setItem(key, token);
      } catch {
        // ignore storage errors
      }
    }
    try {
      localStorage.setItem('auth._token.local', token.startsWith('Bearer ') ? token : 'Bearer ' + token);
    } catch {
      // ignore
    }
    return true;
  }

  function pickError(result) {
    const payload = result?.data;
    if (payload && typeof payload === 'object') {
      return payload.message
        || payload.error?.message
        || (typeof payload.error === 'string' ? payload.error : null)
        || null;
    }
    return result?.status ? 'HTTP ' + result.status : 'auth_error';
  }

  function isSuccess(result) {
    const payload = result?.data;
    if (payload && typeof payload === 'object') {
      if (payload.success === false) return false;
      if (payload.status === 'error') return false;
    }
    return !!result?.ok;
  }

  return {
    readRecaptchaToken,
    loginInitial,
    verifyChallenge,
    loginWithProof,
    pickChallengeId,
    pickActionProof,
    pickAccessToken,
    persistAccessToken,
    pickError,
    isSuccess,
  };
})()`;

function normalizeInzhurPhone(identifier) {
  const raw = String(identifier || '').replace(/[\s()-]/g, '');
  if (!raw) return '';
  if (raw.startsWith('+380')) return raw;
  if (raw.startsWith('380') && raw.length >= 12) return `+${raw}`;
  if (raw.startsWith('0') && raw.length >= 10) return `+38${raw}`;
  if (raw.startsWith('+')) return raw;
  return `+380${raw.replace(/^0+/, '')}`;
}

async function callInzhurUi(webContents, method, args = []) {
  return webContents.executeJavaScript(`(async () => {
    const api = ${INZHUR_UI_IN_PAGE};
    return api[${JSON.stringify(method)}](...${JSON.stringify(args)});
  })()`);
}

async function callInzhurAuthMulti(webContents, method, args = []) {
  return webContents.executeJavaScript(`(async () => {
    const api = ${INZHUR_AUTH_IN_PAGE};
    return api[${JSON.stringify(method)}](...${JSON.stringify(args)});
  })()`);
}

async function fillPhoneStep(webContents, phone) {
  const ok = await webContents.executeJavaScript(`(() => {
    const api = ${INZHUR_UI_IN_PAGE};
    const input = api.findPhoneInput();
    return api.setInput(input, ${JSON.stringify(phone)});
  })()`);
  if (!ok) throw new Error('Не знайдено поле телефону на сторінці входу Inzhur');
}

async function fillPasswordStep(webContents, password) {
  const ok = await webContents.executeJavaScript(`(() => {
    const api = ${INZHUR_UI_IN_PAGE};
    const input = api.findPasswordInput();
    return api.setInput(input, ${JSON.stringify(password)});
  })()`);
  if (!ok) throw new Error('Не знайдено поле пароля на сторінці входу Inzhur');
}

async function waitForPasswordStep(webContents, timeoutMs = 45000) {
  const script = `(() => {
    const api = ${INZHUR_UI_IN_PAGE};
    return api.isPasswordStepVisible();
  })()`;
  const ready = await waitForCondition(webContents, script, timeoutMs, 400);
  if (!ready) {
    throw new Error('Після телефону не з’явилось поле пароля — перевірте номер або продовжіть вручну');
  }
}

async function waitForSignedIn(webContents, timeoutMs = 120000) {
  const script = `(() => {
    const api = ${INZHUR_UI_IN_PAGE};
    return api.isSignedIn();
  })()`;
  return waitForCondition(webContents, script, timeoutMs, 500);
}

async function waitForOtpField(webContents, timeoutMs = 120000) {
  const script = `(() => {
    const api = ${INZHUR_UI_IN_PAGE};
    const el = api.findOtpInput();
    if (!el) return false;
    const rect = el.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  })()`;
  return waitForCondition(webContents, script, timeoutMs, 500);
}

async function runInzhurDashboardUiSignIn(webContents, username, password, options = {}) {
  const { onOtpWait } = options;
  const phone = normalizeInzhurPhone(username);
  if (!phone || !password) {
    throw new Error('Потрібні телефон і пароль Inzhur');
  }

  automationLog.push('info', 'inzhur', 'Вхід: номер телефону…');
  await waitForSelector(webContents, 'input[type="tel"], input[name="login"]', 45000);
  await fillPhoneStep(webContents, phone);
  await delay(300);
  await callInzhurUi(webContents, 'clickPhoneContinue', []);
  await delay(400);

  automationLog.push('info', 'inzhur', 'Вхід: пароль…');
  await waitForPasswordStep(webContents);
  await fillPasswordStep(webContents, password);
  await delay(200);

  const clicked = await callInzhurUi(webContents, 'clickLoginButton', []);
  if (!clicked) {
    automationLog.push('warning', 'inzhur', 'Кнопку «Увійти» не знайдено — натисніть вручну');
  } else {
    automationLog.push('info', 'inzhur', 'Вхід: надіслано телефон і пароль');
  }

  if (await waitForSignedIn(webContents, 8000)) {
    return { filled: true, submitted: true, ui: true, skippedOtp: true };
  }

  if (await waitForOtpField(webContents, 60000)) {
    const runId = pendingOtp.createRunId();
    onOtpWait?.({ runId, siteId: 'inzhur', message: 'Код з SMS для входу Inzhur' });
    try {
      const code = await pendingOtp.waitForCode(runId);
      await webContents.executeJavaScript(`(() => {
        const api = ${INZHUR_UI_IN_PAGE};
        const input = api.findOtpInput();
        return api.setInput(input, ${JSON.stringify(code)});
      })()`);
      await delay(200);
      await callInzhurUi(webContents, 'clickOtpSubmit', []);
      pendingOtp.resolveVerification(runId);
      automationLog.push('info', 'inzhur', 'SMS-код надіслано');
    } catch (err) {
      pendingOtp.rejectVerification(runId, err);
      throw err;
    } finally {
      pendingOtp.clear(runId);
    }
  }

  const signedIn = await waitForSignedIn(webContents, 90000);
  if (!signedIn) {
    throw new Error('Вхід не завершено — перевірте SMS або завершіть вручну');
  }

  if (!webContents.getURL().includes('/dashboard') || webContents.getURL().includes('/signin')) {
    await webContents.loadURL(DASHBOARD_URL);
  }

  return { filled: true, submitted: true, ui: true };
}

async function waitForRecaptchaToken(webContents, timeoutMs = 180000) {
  const start = Date.now();
  automationLog.push('info', 'inzhur', 'Очікуємо reCAPTCHA — відмітьте галочку на сторінці входу');
  while (Date.now() - start < timeoutMs) {
    const token = await callInzhurAuthMulti(webContents, 'readRecaptchaToken', []);
    if (token) return token;
    await delay(500);
  }
  throw new Error('reCAPTCHA не пройдено — відмітьте галочку та спробуйте знову');
}

async function runInzhurLegacyApiSignIn(webContents, username, password, options = {}) {
  const { onOtpWait } = options;
  const identifier = String(username || '').trim();
  if (!identifier || !password) {
    throw new Error('Потрібні телефон і пароль Inzhur');
  }

  automationLog.push('info', 'inzhur', 'Legacy API вхід (auth.inzhur.reit)…');
  await waitForSelector(webContents, 'input[name="login"]');
  await webContents.executeJavaScript(`(() => {
    const login = document.querySelector('input[name="login"]');
    const pass = document.querySelector('input[name="password"]');
    if (login) {
      login.value = ${JSON.stringify(identifier)};
      login.dispatchEvent(new Event('input', { bubbles: true }));
    }
    if (pass) {
      pass.value = ${JSON.stringify(password)};
      pass.dispatchEvent(new Event('input', { bubbles: true }));
    }
    return !!(login && pass);
  })()`);

  const recaptchaToken = await waitForRecaptchaToken(webContents);

  automationLog.push('info', 'inzhur', 'API вхід: POST /api/v1/auth/login (крок 1)');
  const login1 = await callInzhurAuthMulti(webContents, 'loginInitial', [
    identifier,
    password,
    recaptchaToken,
  ]);

  const challengeId = await callInzhurAuthMulti(webContents, 'pickChallengeId', [login1]);
  const earlyToken = await callInzhurAuthMulti(webContents, 'pickAccessToken', [login1]);

  if (!challengeId) {
    if (earlyToken) {
      await callInzhurAuthMulti(webContents, 'persistAccessToken', [earlyToken]);
      automationLog.push('info', 'inzhur', 'API вхід: сесію отримано без SMS');
      await webContents.loadURL(DASHBOARD_URL);
      return { filled: true, submitted: true, api: true, skippedOtp: true };
    }
    const err = await callInzhurAuthMulti(webContents, 'pickError', [login1]);
    throw new Error(err || 'Не отримано challengeId — перевірте reCAPTCHA або облікові дані');
  }

  automationLog.push('info', 'inzhur', 'API вхід: SMS надіслано — очікуємо код');
  const runId = pendingOtp.createRunId();
  onOtpWait?.({ runId, siteId: 'inzhur', message: 'Код з SMS для входу Inzhur' });

  try {
    const code = await pendingOtp.waitForCode(runId);
    automationLog.push('info', 'inzhur', 'API вхід: POST /api/v1/2fa/challenges/verification');
    const verify = await callInzhurAuthMulti(webContents, 'verifyChallenge', [code, challengeId]);
    const verifyOk = await callInzhurAuthMulti(webContents, 'isSuccess', [verify]);
    if (!verifyOk) {
      const err = await callInzhurAuthMulti(webContents, 'pickError', [verify]);
      throw new Error(err || 'Невірний SMS код');
    }

    const actionProof = await callInzhurAuthMulti(webContents, 'pickActionProof', [verify]);
    if (!actionProof) {
      throw new Error('Сервер не повернув x-action-proof після SMS');
    }

    automationLog.push('info', 'inzhur', 'API вхід: POST /api/v1/auth/login (крок 2, x-action-proof)');
    const login2 = await callInzhurAuthMulti(webContents, 'loginWithProof', [
      identifier,
      password,
      recaptchaToken,
      actionProof,
    ]);
    const loginOk = await callInzhurAuthMulti(webContents, 'isSuccess', [login2]);
    if (!loginOk) {
      const err = await callInzhurAuthMulti(webContents, 'pickError', [login2]);
      if (/recaptcha/i.test(err || '')) {
        throw new Error('reCAPTCHA застаріла — оновіть сторінку входу та спробуйте знову');
      }
      throw new Error(err || 'Не вдалося завершити вхід');
    }

    const accessToken = await callInzhurAuthMulti(webContents, 'pickAccessToken', [login2]);
    if (accessToken) {
      await callInzhurAuthMulti(webContents, 'persistAccessToken', [accessToken]);
    }

    pendingOtp.resolveVerification(runId);
    automationLog.push('info', 'inzhur', 'API вхід: успішно — відкриваємо dashboard');
    await webContents.loadURL(DASHBOARD_URL);
    return { filled: true, submitted: true, api: true, challengeId };
  } catch (err) {
    pendingOtp.rejectVerification(runId, err);
    throw err;
  } finally {
    pendingOtp.clear(runId);
  }
}

async function runInzhurApiSignIn(webContents, username, password, options = {}) {
  const currentUrl = webContents.getURL() || '';
  if (currentUrl.includes('auth.inzhur.reit')) {
    return runInzhurLegacyApiSignIn(webContents, username, password, options);
  }

  const recaptchaToken = await callInzhurAuthMulti(webContents, 'readRecaptchaToken', []).catch(() => '');
  if (recaptchaToken) {
    return runInzhurLegacyApiSignIn(webContents, username, password, options);
  }

  return runInzhurDashboardUiSignIn(webContents, username, password, options);
}

async function runInzhurHeadlessSignIn(webContents, username, password, options = {}) {
  automationLog.push('info', 'inzhur', 'Inzhur: фоновий вхід');
  await webContents.loadURL(SIGNIN_URL);
  await waitForSelector(webContents, 'input[type="tel"], input[name="login"]', 45000);

  if (await waitForSignedIn(webContents, 4000)) {
    automationLog.push('info', 'inzhur', 'Сесію Inzhur вже активовано');
    if (!webContents.getURL().includes('/dashboard') || webContents.getURL().includes('/signin')) {
      await webContents.loadURL(DASHBOARD_URL);
    }
    return { authenticated: true, reused: true };
  }

  const result = await runInzhurApiSignIn(webContents, username, password, options);
  const signedIn = await waitForSignedIn(webContents, 30000);
  if (!signedIn) {
    throw new Error('Inzhur: не вдалося увійти — перевірте телефон, пароль або SMS');
  }
  return { authenticated: true, reused: false, ...result };
}

module.exports = {
  INZHUR_ORIGIN,
  LEGACY_AUTH_ORIGIN,
  AUTH_ORIGIN: LEGACY_AUTH_ORIGIN,
  SIGNIN_URL,
  DASHBOARD_URL,
  normalizeInzhurPhone,
  runInzhurApiSignIn,
  runInzhurHeadlessSignIn,
  runInzhurDashboardUiSignIn,
  runInzhurLegacyApiSignIn,
  waitForRecaptchaToken,
};
