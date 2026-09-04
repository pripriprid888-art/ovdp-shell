const automationLog = require('../logger');
const { delay, waitForSelector, waitForCondition } = require('../hidden-window');
const { PRIVAT_AUTH_CORE_JS } = require('../../session/privat-auth');

const BONDS_LIST_URL = 'https://next.privat24.ua/bonds/list';
const HEADLESS_AUTH_TIMEOUT_MS = 300000;

const { matchPrivatConfirmMessage } = require('../privat-confirm-detect');

/** Runs inside login-widget.privat24.ua iframe (cross-origin — parent cannot use contentDocument). */
const WIDGET_FRAME_API = `(() => {
  function nationalPhone(raw) {
    const digits = String(raw || '').replace(/\\D/g, '');
    if (digits.startsWith('380') && digits.length >= 12) return digits.slice(3, 12);
    return digits.slice(-9);
  }

  function isVisible(el) {
    if (!el || !el.getBoundingClientRect) return false;
    const rect = el.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return false;
    const style = window.getComputedStyle(el);
    if (style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity) === 0) {
      return false;
    }
    return true;
  }

  function firstVisible(selectors) {
    for (const sel of selectors) {
      for (const el of document.querySelectorAll(sel)) {
        if (isVisible(el)) return el;
      }
    }
    return null;
  }

  function setInputValue(el, value) {
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set;
    el.focus();
    try { el.click(); } catch {}
    if (setter) setter.call(el, '');
    else el.value = '';
    el.dispatchEvent(new Event('input', { bubbles: true }));
    if (setter) setter.call(el, value);
    else el.value = value;
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    return String(el.value || '').replace(/\\D/g, '');
  }

  function clickContinue() {
    const labels = ['Продовжити', 'Увійти', 'Підтвердити', 'Далі'];
    for (const label of labels) {
      const buttons = [...document.querySelectorAll('button')];
      const match = buttons.find((btn) => new RegExp(label, 'i').test((btn.innerText || '').trim()));
      if (match && !match.disabled && isVisible(match)) {
        match.click();
        return true;
      }
    }
    for (const submit of document.querySelectorAll('[data-qa-node="submit"]')) {
      if (isVisible(submit) && !submit.disabled) {
        submit.click();
        return true;
      }
    }
    return false;
  }

  function ensureTermsAccepted() {
    const terms = document.querySelector(
      '[data-qa-node="isAdmittedTerms"], input[name="isAdmittedTerms"], input[type="checkbox"]',
    );
    if (!terms || terms.checked) return;
    try {
      terms.click();
      return;
    } catch {}
    const label = document.querySelector('label[for]');
    if (label) {
      try { label.click(); } catch {}
    }
  }

  function hasPhoneField() {
    return !!firstVisible([
      '[data-qa-node="login-number"]',
      'input[type="tel"]',
      'input[placeholder="000000000"]',
    ]);
  }

  function fillPhone(phone) {
    const national = nationalPhone(phone);
    if (national.length !== 9) return { ok: false, reason: 'bad_phone', national };
    const input = firstVisible([
      '[data-qa-node="login-number"]',
      'input[type="tel"]',
      'input[placeholder="000000000"]',
    ]);
    if (!input) return { ok: false, reason: 'phone_field_missing' };
    const filled = setInputValue(input, national);
    if (filled !== national) {
      return { ok: false, reason: 'phone_not_accepted', expected: national, filled };
    }
    ensureTermsAccepted();
    const clicked = clickContinue();
    return { ok: true, clicked };
  }

  function fillPassword(password) {
    const input = firstVisible([
      '[data-qa-node="password"]',
      'input[type="password"]',
      'input[name="password"]',
    ]);
    if (!input) return { ok: false, reason: 'password_field_missing' };
    setInputValue(input, password);
    clickContinue();
    return { ok: true };
  }

  function getInnerText() {
    return (document.body?.innerText || '').replace(/\\s+/g, ' ').trim();
  }

  return { fillPhone, fillPassword, hasPhoneField, getInnerText };
})()`;

const PRIVAT_WIDGET_JS = String.raw`(() => {
  ${PRIVAT_AUTH_CORE_JS}

  function loginWidgetIframePresent() {
    return [...document.querySelectorAll('iframe')].some((iframe) =>
      (iframe.src || '').includes('login-widget.privat24.ua'));
  }

  function isAuthenticated() {
    const result = evaluatePrivatAuth();
    return !!result.authenticated;
  }

  function bondsShellReady() {
    const text = (document.body?.innerText || '').replace(/\s+/g, ' ').trim();
    if (text.length < 40) return false;
    return /Облігації|Придбати|Вхід|Портфель|Гаманець/.test(text)
      || !!document.querySelector('[data-qa-node="login"], [data-qa="login"]')
      || loginWidgetIframePresent();
  }

  function dismissPromos() {
    let dismissed = 0;
    const closeSelectors = [
      '[data-qa-node*="cancel"]',
      '[data-qa-node*="close"]',
      '[data-qa-node*="skip"]',
    ];
    for (let round = 0; round < 8; round += 1) {
      let closed = false;
      for (const sel of closeSelectors) {
        const node = document.querySelector(sel);
        if (node && node.offsetParent !== null) {
          node.click();
          closed = true;
          dismissed += 1;
          break;
        }
      }
      if (!closed) break;
    }
    return dismissed;
  }

  function openLoginWidgetIfNeeded() {
    if (loginWidgetIframePresent()) return true;

    const prioritized = [
      ...document.querySelectorAll('[data-qa-node="login"], [data-qa="login"]'),
      ...document.querySelectorAll('button, a, [role="button"]'),
    ];

    for (const el of prioritized) {
      const text = (el.innerText || el.getAttribute('aria-label') || '').trim();
      const isLoginNode = el.matches('[data-qa-node="login"], [data-qa="login"]')
        || /\bвхід\b/i.test(text);
      if (!isLoginNode) continue;
      try {
        el.scrollIntoView({ block: 'center', inline: 'center', behavior: 'instant' });
      } catch {}
      el.click();
      if (loginWidgetIframePresent()) return true;
    }

    return loginWidgetIframePresent();
  }

  return {
    headerLoginVisible,
    loggedInUiVisible,
    isAuthenticated,
    evaluatePrivatAuth,
    bondsShellReady,
    dismissPromos,
    openLoginWidgetIfNeeded,
    loginWidgetIframePresent,
  };
})()`;

function listFrames(webContents) {
  return webContents.mainFrame?.framesInOrder
    || webContents.mainFrame?.frames
    || [];
}

function findLoginWidgetFrame(webContents) {
  for (const frame of listFrames(webContents)) {
    try {
      if ((frame.url || '').includes('login-widget.privat24.ua')) return frame;
    } catch {
      // detached frame
    }
  }
  return null;
}

async function waitForLoginWidgetFrame(webContents, timeoutMs = 25000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const frame = findLoginWidgetFrame(webContents);
    if (frame) {
      try {
        const ready = await frame.executeJavaScript(`(() => {
          const api = ${WIDGET_FRAME_API};
          return api.hasPhoneField();
        })()`);
        if (ready) return frame;
      } catch {
        // iframe still loading
      }
    }
    await delay(400);
  }
  return null;
}

async function execInWidgetFrame(webContents, method, ...args) {
  const frame = findLoginWidgetFrame(webContents);
  if (!frame) return { ok: false, reason: 'widget_frame_missing' };
  const call = args.length
    ? `api.${method}(${args.map((arg) => JSON.stringify(arg)).join(', ')})`
    : `api.${method}()`;
  try {
    return await frame.executeJavaScript(`(() => {
      const api = ${WIDGET_FRAME_API};
      return ${call};
    })()`);
  } catch (err) {
    return { ok: false, reason: 'frame_exec_error', message: String(err.message || err) };
  }
}

async function getWidgetConfirmStep(webContents) {
  const text = await execInWidgetFrame(webContents, 'getInnerText');
  return matchPrivatConfirmMessage(text, 'signin');
}

async function execPrivat(webContents, method, ...args) {
  const call = args.length
    ? `api.${method}(${args.map((arg) => JSON.stringify(arg)).join(', ')})`
    : `api.${method}()`;
  return webContents.executeJavaScript(`(() => {
    const api = ${PRIVAT_WIDGET_JS};
    return ${call};
  })()`);
}

async function waitForBondsShell(webContents) {
  await waitForCondition(
    webContents,
    `(() => { const api = ${PRIVAT_WIDGET_JS}; return api.bondsShellReady(); })()`,
    45000,
  );
}

async function waitForAuthentication(webContents) {
  let lastConfirmStep = null;
  const deadline = Date.now() + HEADLESS_AUTH_TIMEOUT_MS;

  while (Date.now() < deadline) {
    const loggedIn = await execPrivat(webContents, 'isAuthenticated');
    if (loggedIn) {
      automationLog.push('info', 'privat', 'Вхід у Приват24 підтверджено');
      return;
    }

    const confirm = await getWidgetConfirmStep(webContents);
    if (confirm?.step && confirm.step !== lastConfirmStep) {
      automationLog.push('warning', 'privat', confirm.message);
      lastConfirmStep = confirm.step;
    } else if (!lastConfirmStep) {
      automationLog.push(
        'warning',
        'privat',
        'Очікуємо підтвердження входу в Приват24 (застосунок або дзвінок)',
      );
      lastConfirmStep = 'privat_confirm_wait';
    }

    await delay(1500);
  }

  const loggedIn = await execPrivat(webContents, 'isAuthenticated');
  if (loggedIn) return;

  throw new Error(
    'Час очікування підтвердження Приват24 минув — підтвердіть вхід у застосунку або при дзвінку банку',
  );
}

async function runPrivatWidgetSignIn(webContents, username, password) {
  await waitForBondsShell(webContents);

  let opened = await execPrivat(webContents, 'openLoginWidgetIfNeeded');
  await delay(1200);
  if (!opened) {
    opened = await execPrivat(webContents, 'openLoginWidgetIfNeeded');
    await delay(1500);
  }

  await waitForSelector(webContents, 'iframe[src*="login-widget.privat24.ua"]', 20000);
  const widgetFrame = await waitForLoginWidgetFrame(webContents, 25000);
  if (!widgetFrame) {
    throw new Error('Віджет входу Приват24 не завантажився — натисніть «Вхід» вручну та повторіть');
  }

  let phoneResult = null;
  for (let attempt = 0; attempt < 5; attempt += 1) {
    phoneResult = await execInWidgetFrame(webContents, 'fillPhone', username);
    if (phoneResult?.ok) break;
    await delay(800);
  }

  if (!phoneResult?.ok) {
    const detail = phoneResult?.reason || 'unknown';
    if (detail === 'bad_phone') {
      throw new Error(
        'Невірний формат телефону для Приват24 — збережіть номер як +380XXXXXXXXX',
      );
    }
    throw new Error(`Не вдалося заповнити телефон у віджеті Приват24 (${detail})`);
  }

  automationLog.push('info', 'privat', 'Телефон надіслано');
  await delay(1500);

  if (password) {
    let pwdResult = null;
    for (let attempt = 0; attempt < 5; attempt += 1) {
      pwdResult = await execInWidgetFrame(webContents, 'fillPassword', password);
      if (pwdResult?.ok) break;
      await delay(800);
    }
    if (pwdResult?.ok) {
      automationLog.push('warning', 'privat', 'Пароль надіслано — очікуємо підтвердження');
    }
  }

  return { filled: true, submitted: false };
}

async function runPrivatHeadlessSignIn(webContents, username, password) {
  automationLog.push('info', 'privat', 'Приват24: фоновий вхід — підтвердіть у телефоні');
  await webContents.loadURL(BONDS_LIST_URL);
  await waitForBondsShell(webContents);

  const alreadyIn = await execPrivat(webContents, 'isAuthenticated');
  if (alreadyIn) {
    automationLog.push('info', 'privat', 'Сесію Приват24 вже активовано');
    await execPrivat(webContents, 'dismissPromos');
    return { authenticated: true, reused: true };
  }

  await runPrivatWidgetSignIn(webContents, username, password);
  await waitForAuthentication(webContents);
  await webContents.loadURL(BONDS_LIST_URL);
  await waitForBondsShell(webContents);
  const dismissed = await execPrivat(webContents, 'dismissPromos');
  if (dismissed) {
    automationLog.push('info', 'privat', `Закрито ${dismissed} промо-оверлеїв`);
  }

  return { authenticated: true, reused: false };
}

module.exports = {
  BONDS_LIST_URL,
  runPrivatHeadlessSignIn,
  runPrivatWidgetSignIn,
  waitForBondsShell,
};
