const automationLog = require('../logger');
const pendingOtp = require('../pending-otp');
const { delay, waitForSelector, waitForCondition } = require('../hidden-window');
const { gotoUniverCatalog, execUniver } = require('./univer');

const OTP_INPUT = 'input[name="customorder_Kodperevrkiklnt"]';

const READ_UNIVER_PAGE_ERROR_JS = `(() => {
  const normalize = (text) => String(text || '').replace(/\\s+/g, ' ').trim();
  const selectors = [
    '.error',
    '.alert-danger',
    '.alert-warning',
    '[role="alert"]',
    '.notice.error',
    '.validation-error',
    '.help-block.error',
    '.field-error',
  ];
  for (const sel of selectors) {
    for (const el of document.querySelectorAll(sel)) {
      const style = window.getComputedStyle(el);
      if (style.display === 'none' || style.visibility === 'hidden') continue;
      const text = normalize(el.innerText);
      if (text && text.length <= 500) return text;
    }
  }
  const body = normalize(document.body?.innerText || '');
  const patterns = [
    /недостат\\w*\\s+[^.!?]{0,120}(кошт|коштів|баланс|середств)/i,
    /не\\s+вистачає\\s+[^.!?]{0,120}(кошт|коштів|баланс|середств)/i,
    /баланс[^.!?]{0,80}недостат/i,
    /insufficient\\s+funds/i,
  ];
  for (const re of patterns) {
    const match = body.match(re);
    if (match) return match[0].trim();
  }
  return null;
})()`;

function reportBuyStep(onProgress, step, logMessage, level = 'info') {
  automationLog.push(level, 'univer', logMessage);
  onProgress?.({ siteId: 'univer', step });
}

function normalizeUniverBuyError(text) {
  const cleaned = String(text || '').replace(/\s+/g, ' ').trim();
  if (!cleaned) return 'Помилка купівлі на UNIVER';
  const lowered = cleaned.toLowerCase();
  if (
    /недостат|не вистачає|insufficient/.test(lowered)
    && /кошт|баланс|середств|funds/.test(lowered)
  ) {
    return 'Недостатньо коштів на рахунку UNIVER';
  }
  return cleaned.length > 200 ? `${cleaned.slice(0, 197)}…` : cleaned;
}

async function readUniverPageError(webContents) {
  const text = await webContents.executeJavaScript(READ_UNIVER_PAGE_ERROR_JS);
  return text ? normalizeUniverBuyError(text) : null;
}

async function assertNoUniverPageError(webContents) {
  const errorText = await readUniverPageError(webContents);
  if (errorText) throw new Error(errorText);
}

async function findProductRow(webContents, isin) {
  return webContents.executeJavaScript(`(() => {
    const isin = ${JSON.stringify(isin)};
    const rows = [...document.querySelectorAll('tr[data-productid]')];
    const row = rows.find((tr) => (tr.innerText || '').includes(isin));
    if (!row) return null;
    const buy = row.querySelector('.js-client-buy');
    const count = row.querySelector('.js-client-buy-count');
    const price = row.querySelector('.js-client-buy-price');
    return {
      productid: row.getAttribute('data-productid') || (buy && buy.getAttribute('data-productid')),
      price: price ? price.value : null,
      count: count ? count.value : null,
    };
  })()`);
}

async function createOrder(webContents, productId, quantity) {
  await webContents.executeJavaScript(`(() => {
    const input = document.querySelector('#js-productcount-${productId}');
    if (!input) throw new Error('Поле кількості не знайдено');
    input.value = ${JSON.stringify(String(quantity))};
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
    const btn = document.querySelector('tr[data-productid="${productId}"] .js-client-buy-action.green');
    if (!btn) throw new Error('Кнопку «Придбати» не знайдено');
    btn.click();
  })()`);

  await delay(2000);

  const pageError = await readUniverPageError(webContents);
  if (pageError) throw new Error(pageError);

  const url = webContents.getURL();
  const match = url.match(/\/client\/order\/(\d+)\//);
  if (!match) {
    throw new Error(`Не вдалося відкрити сторінку замовлення (${url})`);
  }
  return match[1];
}

async function clickOrderStatusAction(webContents, labelPattern, labelName) {
  await webContents.executeJavaScript(`(() => {
    const links = [...document.querySelectorAll('a.js-change-order-status')];
    const btn = links.find((el) => ${labelPattern}.test(el.innerText || ''));
    if (!btn) throw new Error('Кнопку «${labelName}» не знайдено');
    btn.click();
  })()`);
}

async function clickDali(webContents) {
  await clickOrderStatusAction(webContents, /Далі/i, 'Далі');
  try {
    await waitForSelector(webContents, OTP_INPUT, 30000);
  } catch (err) {
    const pageError = await readUniverPageError(webContents);
    if (pageError) throw new Error(pageError);
    throw err;
  }
  await assertNoUniverPageError(webContents);
}

async function submitOtp(webContents, code) {
  await webContents.executeJavaScript(`(() => {
    const field = document.querySelector(${JSON.stringify(OTP_INPUT)});
    if (!field) throw new Error('Поле OTP не знайдено');
    field.value = ${JSON.stringify(code)};
    field.dispatchEvent(new Event('input', { bubbles: true }));
  })()`);
  await clickOrderStatusAction(webContents, /Підтвердити/i, 'Підтвердити');
  await delay(3500);
}

async function clickAcceptOrder(webContents) {
  const hasAccept = await waitForCondition(
    webContents,
    `[...document.querySelectorAll('a.js-change-order-status')].some((el) => /Прийняти/i.test(el.innerText || ''))`,
    30000,
  );
  if (!hasAccept) {
    const pageError = await readUniverPageError(webContents);
    if (pageError) throw new Error(pageError);
    throw new Error('Кнопку «Прийняти» не знайдено');
  }
  await clickOrderStatusAction(webContents, /Прийняти/i, 'Прийняти');
  await delay(3500);
  await assertNoUniverPageError(webContents);
}

async function tryCancelOrder(webContents) {
  try {
    const hasCancel = await webContents.executeJavaScript(
      `[...document.querySelectorAll('a.js-change-order-status')].some((el) => /Скасувати/i.test(el.innerText || ''))`,
    );
    if (!hasCancel) return;
    await clickOrderStatusAction(webContents, /Скасувати/i, 'Скасувати');
    await delay(2000);
    automationLog.push('warning', 'univer', 'Замовлення скасовано в кабінеті UNIVER');
  } catch {
    // ignore cancel failures
  }
}

async function postConfirmStatus(webContents, orderId) {
  const body = await webContents.executeJavaScript('document.body.innerText');
  const lowered = body.toLowerCase();
  const otpStill = await webContents.executeJavaScript(
    `document.querySelectorAll(${JSON.stringify(OTP_INPUT)}).length`,
  );
  if (
    /недостат|не вистачає|insufficient/.test(lowered)
    && /кошт|баланс|середств|funds/.test(lowered)
  ) {
    throw new Error('Недостатньо коштів на рахунку UNIVER');
  }
  if (otpStill > 0 && lowered.includes('код перевірки')) {
    throw new Error('Код не прийнято — перевірте код і спробуйте ще раз');
  }
  if (/помилк|невірн|неправильн/.test(lowered) && (otpStill > 0 || lowered.slice(0, 800).includes('код'))) {
    throw new Error('UNIVER відхилив підтвердження — перевірте код');
  }
  const pageError = await readUniverPageError(webContents);
  if (pageError) throw new Error(pageError);
  automationLog.push('info', 'univer', `Замовлення #${orderId} підтверджено`);
}

async function runUniverBuy(webContents, { isin, quantity = 1, runId, onOtpWait, onProgress }) {
  if (quantity < 1) throw new Error('Кількість має бути не менше 1');

  reportBuyStep(onProgress, 'Підготовка купівлі', `Початок купівлі ${isin} × ${quantity}`);

  reportBuyStep(onProgress, 'Перевірка сесії', 'Перевірка сесії UNIVER');
  if (!(await execUniver(webContents, 'isAuthenticated'))) {
    throw new Error('Сесія UNIVER недійсна — увійдіть знову');
  }

  reportBuyStep(onProgress, 'Каталог гривневих ОВДП', 'Відкриття каталогу Гривневі ОВДП');
  await gotoUniverCatalog(webContents);
  reportBuyStep(onProgress, 'Каталог гривневих ОВДП', 'Відкрито каталог Гривневі ОВДП');

  reportBuyStep(onProgress, 'Пошук сертифіката', `Пошук ${isin} у каталозі`);
  const row = await findProductRow(webContents, isin);
  if (!row?.productid) {
    throw new Error(`ОВДП ${isin} не знайдено в каталозі Гривневі ОВДП`);
  }

  reportBuyStep(
    onProgress,
    'Пошук сертифіката',
    `Знайдено ${isin} (productid=${row.productid}, ціна=${row.price || '—'})`,
  );

  reportBuyStep(onProgress, 'Створення замовлення', 'Створення замовлення…');
  const orderId = await createOrder(webContents, row.productid, quantity);
  reportBuyStep(onProgress, 'Створення замовлення', `Створено замовлення #${orderId}`);
  await assertNoUniverPageError(webContents);

  reportBuyStep(onProgress, 'Підтвердження замовлення', 'Натискання «Далі»');
  await clickDali(webContents);
  pendingOtp.prepareVerification(runId);
  reportBuyStep(
    onProgress,
    'Очікування коду перевірки',
    'Введіть код перевірки з email або SMS (діє близько 5 хвилин)',
    'warning',
  );
  onOtpWait?.({ runId, isin, orderId });

  try {
    const code = await pendingOtp.waitForCode(runId);
    reportBuyStep(onProgress, 'Підтвердження коду', 'Надсилання коду перевірки');
    await submitOtp(webContents, code);
    reportBuyStep(onProgress, 'Підтвердження коду', 'Код перевірки надіслано');
    reportBuyStep(onProgress, 'Прийняття замовлення', 'Натискання «Прийняти»');
    await clickAcceptOrder(webContents);
    reportBuyStep(onProgress, 'Прийняття замовлення', 'Натиснуто «Прийняти»');
    reportBuyStep(onProgress, 'Завершення купівлі', 'Перевірка статусу замовлення');
    await postConfirmStatus(webContents, orderId);
    pendingOtp.resolveVerification(runId);
    reportBuyStep(onProgress, 'Завершення купівлі', `Купівлю ${isin} підтверджено (замовлення #${orderId})`);
    return { orderId, isin, quantity, url: webContents.getURL() };
  } catch (err) {
    pendingOtp.rejectVerification(runId, err);
    await tryCancelOrder(webContents);
    throw err;
  } finally {
    pendingOtp.clear(runId);
  }
}

module.exports = {
  runUniverBuy,
};
