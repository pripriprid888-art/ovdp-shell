const automationLog = require('./logger');

async function waitForSelector(webContents, selector, timeoutMs = 30000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const count = await webContents.executeJavaScript(
      `document.querySelectorAll(${JSON.stringify(selector)}).length`,
    );
    if (count > 0) return true;
    await delay(400);
  }
  return false;
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
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

async function autoSignInInzhur(webContents, username, password) {
  automationLog.push('info', 'inzhur', 'Заповнюємо телефон і пароль…');
  await waitForSelector(webContents, 'input[name="login"]');
  await webContents.executeJavaScript(setInputValue('input[name="login"]', username));
  await webContents.executeJavaScript(setInputValue('input[name="password"]', password));

  const clicked = await webContents.executeJavaScript(`(() => {
    const btn = [...document.querySelectorAll('button.row-btn, button[type="submit"], button')]
      .find((el) => /Отримати код з SMS/i.test(el.innerText || ''));
    if (btn) { btn.click(); return true; }
    return false;
  })()`);

  automationLog.push(
    'warning',
    'inzhur',
    clicked
      ? 'Натиснуто «Отримати код з SMS» — завершіть reCAPTCHA/SMS на сторінці.'
      : 'Підтвердіть reCAPTCHA та SMS вручну, потім натисніть кнопку входу на сайті.',
  );
  return { filled: true, submitted: clicked };
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

async function runAutoSignIn(webContents, siteId, username, password) {
  if (siteId === 'inzhur') return autoSignInInzhur(webContents, username, password);
  if (siteId === 'univer') return autoSignInUniver(webContents, username, password);
  if (siteId === 'privat') return autoSignInPrivat(webContents, username, password);
  throw new Error(`Auto sign-in not supported for ${siteId}`);
}

module.exports = {
  waitForSelector,
  runAutoSignIn,
};
