const automationLog = require('./logger');
const { waitForSelector: waitForSelectorCount } = require('../shared/web-contents');

async function waitForSelector(webContents, selector, timeoutMs = 30000) {
  return waitForSelectorCount(webContents, selector, timeoutMs) > 0;
}

function setInputValue(selector, value) {
  return `(function() {
    const el = document.querySelector(${JSON.stringify(selector)});
    if (!el) return false;
    el.focus();
    el.value = ${JSON.stringify(value)};
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  })()`;
}

async function autoSignInInzhur(webContents, username, password, options = {}) {
  const { runInzhurApiSignIn } = require('./flows/inzhur-signin');
  return runInzhurApiSignIn(webContents, username, password, options);
}

async function autoSignInUniver(webContents, username, password) {
  automationLog.push('info', 'univer', 'Заповнюємо логін і пароль…');
  await waitForSelector(webContents, 'input[name="login"]');
  await webContents.executeJavaScript(setInputValue('input[name="login"]', username));
  await webContents.executeJavaScript(setInputValue('input[name="password"]', password));

  const submitted = await webContents.executeJavaScript(`(() => {
    const submit = document.querySelector('input[type="submit"][name="ok"]');
    if (submit) { submit.click(); return true; }
    const btn = [...document.querySelectorAll('button, input[type="submit"]')]
      .find((el) => /увійти/i.test(el.innerText || el.value || ''));
    if (btn) { btn.click(); return true; }
    return false;
  })()`);

  if (submitted) {
    automationLog.push('info', 'univer', 'Облікові дані надіслано.');
  } else {
    automationLog.push('warning', 'univer', 'Не знайдено кнопку входу — завершіть вручну.');
  }
  return { filled: true, submitted };
}

async function autoSignInPrivat(webContents, username, password) {
  automationLog.push('info', 'privat', 'Відкриваємо віджет входу…');
  const { runPrivatWidgetSignIn } = require('./flows/privat');
  await runPrivatWidgetSignIn(webContents, username, password);
  automationLog.push(
    'warning',
    'privat',
    'Підтвердіть вхід у застосунку Приват24, дзвінком або SMS — автоматизація зупиняється тут.',
  );
  return { filled: true, submitted: false };
}

async function runAutoSignIn(webContents, siteId, username, password, options = {}) {
  if (siteId === 'inzhur') return autoSignInInzhur(webContents, username, password, options);
  if (siteId === 'univer') return autoSignInUniver(webContents, username, password);
  if (siteId === 'privat') return autoSignInPrivat(webContents, username, password);
  throw new Error(`Auto sign-in not supported for ${siteId}`);
}

module.exports = {
  waitForSelector,
  runAutoSignIn,
};
