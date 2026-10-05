const automationLog = require('../logger');
const pendingOtp = require('../pending-otp');
const { delay, waitForSelector, waitForCondition } = require('../hidden-window');
const { gotoUniverCatalog, ensureUniverBuyReady } = require('./univer');

const OTP_INPUT = 'input[name="customorder_Kodperevrkiklnt"]';
const POST_OTP_ACCEPT_TIMEOUT_MS = 60 * 1000;
const CANCEL_ORDER_STATUS_FALLBACK = '89';

const CLICK_CANCEL_ORDER_JS = `(() => {
  const links = [...document.querySelectorAll('a.js-change-order-status')];
  const cancelBtn = links.find((el) => /Скасувати/i.test(el.innerText || ''));
  if (!cancelBtn) return { ok: false, reason: 'not_found' };

  const onclick = cancelBtn.getAttribute('onclick') || '';
  const match = onclick.match(/clickButtonSaveAll\\(['"]?(\\d+)['"]?\\)/);
  const statusId = match ? match[1] : ${JSON.stringify(CANCEL_ORDER_STATUS_FALLBACK)};

  if (typeof clickButtonSaveAll === 'function') {
    clickButtonSaveAll(statusId);
    return { ok: true, method: 'clickButtonSaveAll', statusId };
  }

  cancelBtn.click();
  return { ok: true, method: 'click', statusId };
})()`;

const READ_POST_OTP_ORDER_STATE_FN = `function readPostOtpOrderState() {
  const body = document.body?.innerText || '';
  const hasAccept = [...document.querySelectorAll('a.js-change-order-status')]
    .some((el) => /Прийняти/i.test(el.innerText || ''));
  const accepted =
    /замовлення\\s+прийняте/i.test(body)
    || /очікуйте\\s+повідомлення\\s+про\\s+виконання/i.test(body);
  const hasOtp = Boolean(document.querySelector(${JSON.stringify(OTP_INPUT)}));
  const blockedFunds = /Заблоковано\\s+Баланс\\s+БО/i.test(body);
  const orderDocument = /Client_Order_/i.test(body) && /Завантажити\\s+PDF/i.test(body);
  const readyWithoutAccept = accepted || orderDocument || (blockedFunds && !hasOtp);
  return { hasAccept, accepted, orderDocument, readyWithoutAccept };
}`;

const POST_OTP_ORDER_STATE_JS = `(() => {
  ${READ_POST_OTP_ORDER_STATE_FN}
  return readPostOtpOrderState();
})()`;

const WAIT_POST_OTP_ORDER_READY_JS = `(() => {
  ${READ_POST_OTP_ORDER_STATE_FN}
  const state = readPostOtpOrderState();
  return state.readyWithoutAccept || state.hasAccept;
})()`;

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

function getPageUrl(webContents) {
  if (!webContents || webContents.isDestroyed?.()) return null;
  try {
    return webContents.getURL();
  } catch {
    return null;
  }
}

function pushBuyLog(level, message, context = {}) {
  automationLog.push(level, 'univer', message, {
    category: 'buy',
    context: sanitizeBuyLogContext(context),
  });
}

function sanitizeBuyLogContext(context) {
  if (!context || typeof context !== 'object') return null;
  const copy = { ...context };
  if ('otpCode' in copy) {
    copy.otpLength = String(copy.otpCode || '').length;
    delete copy.otpCode;
  }
  return copy;
}

function reportBuyStep(onProgress, step, logMessage, level = 'info', extraContext = {}) {
  pushBuyLog(level, logMessage, { step, ...extraContext });
  onProgress?.({ siteId: 'univer', step, ...extraContext });
}

function logBuyAction(webContents, message, context = {}) {
  pushBuyLog('info', message, {
    url: getPageUrl(webContents),
    ...context,
  });
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
  const qtySelector = `#js-productcount-${productId}`;
  const buySelector = `tr[data-productid="${productId}"] .js-client-buy-action.green`;

  logBuyAction(webContents, `Поле кількості: ${quantity}`, {
    step: 'Створення замовлення',
    action: 'fill',
    selector: qtySelector,
    productId,
    quantity,
  });

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

  logBuyAction(webContents, 'Клік «Придбати»', {
    step: 'Створення замовлення',
    action: 'click',
    selector: buySelector,
    label: 'Придбати',
    productId,
    quantity,
  });

  await delay(2000);

  const pageError = await readUniverPageError(webContents);
  if (pageError) throw new Error(pageError);

  const url = getPageUrl(webContents);
  const match = url?.match(/\/client\/order\/(\d+)\//);
  if (!match) {
    throw new Error(`Не вдалося відкрити сторінку замовлення (${url})`);
  }

  logBuyAction(webContents, `Відкрито замовлення #${match[1]}`, {
    step: 'Створення замовлення',
    action: 'navigate',
    orderId: match[1],
    url,
  });

  return match[1];
}

async function clickOrderStatusAction(webContents, labelPattern, labelName, step = 'Підтвердження замовлення') {
  const selector = 'a.js-change-order-status';

  logBuyAction(webContents, `Клік «${labelName}»`, {
    step,
    action: 'click',
    selector,
    label: labelName,
  });

  await webContents.executeJavaScript(`(() => {
    const links = [...document.querySelectorAll('a.js-change-order-status')];
    const btn = links.find((el) => ${labelPattern}.test(el.innerText || ''));
    if (!btn) throw new Error('Кнопку «${labelName}» не знайдено');
    btn.click();
  })()`);

  await delay(300);

  logBuyAction(webContents, `Після «${labelName}»`, {
    step,
    action: 'after_click',
    selector,
    label: labelName,
  });
}

async function clickDali(webContents) {
  await clickOrderStatusAction(webContents, /Далі/i, 'Далі', 'Підтвердження замовлення');
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
  logBuyAction(webContents, 'Заповнено поле коду перевірки', {
    step: 'Підтвердження коду',
    action: 'fill',
    selector: OTP_INPUT,
    otpCode: code,
  });

  await webContents.executeJavaScript(`(() => {
    const field = document.querySelector(${JSON.stringify(OTP_INPUT)});
    if (!field) throw new Error('Поле OTP не знайдено');
    field.value = ${JSON.stringify(code)};
    field.dispatchEvent(new Event('input', { bubbles: true }));
  })()`);

  await clickOrderStatusAction(webContents, /Підтвердити/i, 'Підтвердити', 'Підтвердження коду');
  await delay(3500);
}

async function readPostOtpOrderState(webContents) {
  return webContents.executeJavaScript(POST_OTP_ORDER_STATE_JS);
}

async function isOrderAlreadyAccepted(webContents) {
  const state = await readPostOtpOrderState(webContents);
  return Boolean(state?.readyWithoutAccept);
}

async function clickAcceptOrder(webContents) {
  await waitForCondition(
    webContents,
    WAIT_POST_OTP_ORDER_READY_JS,
    POST_OTP_ACCEPT_TIMEOUT_MS,
  );
  const state = await readPostOtpOrderState(webContents);
  if (state?.readyWithoutAccept) {
    logBuyAction(webContents, 'Замовлення вже прийняте — «Прийняти» не потрібно', {
      step: 'Прийняття замовлення',
      action: 'skip_click',
      label: 'Прийняти',
      orderState: state,
    });
    await delay(500);
    await assertNoUniverPageError(webContents);
    return;
  }
  if (state?.hasAccept) {
    await clickOrderStatusAction(webContents, /Прийняти/i, 'Прийняти', 'Прийняття замовлення');
    await delay(3500);
    await assertNoUniverPageError(webContents);
    return;
  }
  const pageError = await readUniverPageError(webContents);
  if (pageError) throw new Error(pageError);
  throw new Error('Кнопку «Прийняти» не знайдено');
}

async function cancelUniverOrder(webContents, { userInitiated = false } = {}) {
  if (await isOrderAlreadyAccepted(webContents)) return { skipped: true, reason: 'already_accepted' };

  logBuyAction(webContents, 'Клік «Скасувати»', {
    step: 'Скасування замовлення',
    action: 'click',
    selector: 'a.js-change-order-status',
    label: 'Скасувати',
    userInitiated,
  });

  const result = await webContents.executeJavaScript(CLICK_CANCEL_ORDER_JS);
  if (!result?.ok) {
    throw new Error('Кнопку «Скасувати» не знайдено');
  }

  await delay(2000);

  pushBuyLog(
    userInitiated ? 'info' : 'warning',
    userInitiated
      ? 'Купівлю скасовано за запитом користувача'
      : 'Замовлення скасовано в кабінеті UNIVER',
    {
      step: 'Скасування замовлення',
      action: 'cancel',
      url: getPageUrl(webContents),
      cancelMethod: result.method,
      statusId: result.statusId,
      userInitiated,
    },
  );

  return result;
}

async function tryCancelOrder(webContents, options = {}) {
  try {
    return await cancelUniverOrder(webContents, options);
  } catch {
    // ignore cancel failures
    return null;
  }
}

function throwIfBuyCancelled(runId) {
  if (!runId || !pendingOtp.wasUserCancelled(runId)) return;
  const error = new Error(pendingOtp.USER_CANCELLED_BUY_MESSAGE);
  error.code = 'USER_CANCELLED';
  throw error;
}

async function postConfirmStatus(webContents, orderId, runId) {
  throwIfBuyCancelled(runId);
  const body = await webContents.executeJavaScript('document.body.innerText');
  const lowered = body.toLowerCase();
  const otpStill = await webContents.executeJavaScript(
    `document.querySelectorAll(${JSON.stringify(OTP_INPUT)}).length`,
  );
  throwIfBuyCancelled(runId);
  if (
    /недостат|не вистачає|insufficient/.test(lowered)
    && /кошт|баланс|середств|funds/.test(lowered)
  ) {
    throw new Error('Недостатньо коштів на рахунку UNIVER');
  }
  if (otpStill > 0 && lowered.includes('код перевірки')) {
    throwIfBuyCancelled(runId);
    throw new Error('Код не прийнято — перевірте код і спробуйте ще раз');
  }
  if (/помилк|невірн|неправильн/.test(lowered) && (otpStill > 0 || lowered.slice(0, 800).includes('код'))) {
    throwIfBuyCancelled(runId);
    throw new Error('UNIVER відхилив підтвердження — перевірте код');
  }
  const pageError = await readUniverPageError(webContents);
  if (pageError) throw new Error(pageError);
  pushBuyLog('info', `Замовлення #${orderId} підтверджено`, {
    step: 'Завершення купівлі',
    action: 'verify',
    orderId,
    url: getPageUrl(webContents),
    otpFieldsVisible: otpStill,
  });
}

async function runUniverBuy(webContents, { isin, quantity = 1, runId, onOtpWait, onProgress }) {
  if (quantity < 1) throw new Error('Кількість має бути не менше 1');
  let reachedOtpStep = false;

  async function untilCancelled(promise) {
    throwIfBuyCancelled(runId);
    const result = await pendingOtp.raceCancel(runId, promise);
    throwIfBuyCancelled(runId);
    return result;
  }

  reportBuyStep(onProgress, 'Підготовка купівлі', `Початок купівлі ${isin} × ${quantity}`);

  try {
  reportBuyStep(onProgress, 'Перевірка сесії', 'Перевірка сесії UNIVER');
  await untilCancelled(ensureUniverBuyReady(webContents));
  reportBuyStep(onProgress, 'Перевірка сесії', 'Сесію UNIVER підтверджено');

  reportBuyStep(onProgress, 'Каталог гривневих ОВДП', 'Відкриття каталогу Гривневі ОВДП');
  await untilCancelled(gotoUniverCatalog(webContents));
  reportBuyStep(onProgress, 'Каталог гривневих ОВДП', 'Відкрито каталог Гривневі ОВДП');

  reportBuyStep(onProgress, 'Пошук сертифіката', `Пошук ${isin} у каталозі`);
  const row = await untilCancelled(findProductRow(webContents, isin));
  if (!row?.productid) {
    throw new Error(`ОВДП ${isin} не знайдено в каталозі Гривневі ОВДП`);
  }

  reportBuyStep(
    onProgress,
    'Пошук сертифіката',
    `Знайдено ${isin} (productid=${row.productid}, ціна=${row.price || '—'})`,
    'info',
    {
      action: 'found',
      isin,
      productId: row.productid,
      price: row.price,
      url: getPageUrl(webContents),
      selector: `tr[data-productid="${row.productid}"]`,
    },
  );

  reportBuyStep(onProgress, 'Створення замовлення', 'Створення замовлення…');
  const orderId = await untilCancelled(createOrder(webContents, row.productid, quantity));
  reportBuyStep(onProgress, 'Створення замовлення', `Створено замовлення #${orderId}`);
  await assertNoUniverPageError(webContents);

  reportBuyStep(onProgress, 'Підтвердження замовлення', 'Натискання «Далі»');
  await untilCancelled(clickDali(webContents));
  reachedOtpStep = true;
  reportBuyStep(
    onProgress,
    'Очікування коду перевірки',
    'Введіть код перевірки з email або SMS (діє близько 5 хвилин)',
    'warning',
  );
  onOtpWait?.({ runId, siteId: 'univer', isin, orderId });

  try {
    const code = await pendingOtp.waitForCode(runId);
    reportBuyStep(onProgress, 'Підтвердження коду', 'Надсилання коду перевірки');
    await pendingOtp.raceCancel(runId, submitOtp(webContents, code));
    reportBuyStep(onProgress, 'Підтвердження коду', 'Код перевірки надіслано');
    reportBuyStep(onProgress, 'Прийняття замовлення', 'Натискання «Прийняти»');
    await pendingOtp.raceCancel(runId, clickAcceptOrder(webContents));
    reportBuyStep(onProgress, 'Прийняття замовлення', 'Натиснуто «Прийняти»');
    reportBuyStep(onProgress, 'Завершення купівлі', 'Перевірка статусу замовлення');
    await pendingOtp.raceCancel(runId, postConfirmStatus(webContents, orderId, runId));
    pendingOtp.resolveVerification(runId);
    reportBuyStep(onProgress, 'Замовлення успішне', 'Замовлення успішне', 'info', {
      action: 'complete',
      orderId,
      isin,
      quantity,
    });
    return { orderId, isin, quantity, url: webContents.getURL() };
  } catch (err) {
    if (await isOrderAlreadyAccepted(webContents)) {
      reportBuyStep(onProgress, 'Завершення купівлі', 'Перевірка статусу замовлення');
      await postConfirmStatus(webContents, orderId, runId);
      pendingOtp.resolveVerification(runId);
      reportBuyStep(onProgress, 'Замовлення успішне', 'Замовлення успішне', 'info', {
        action: 'complete',
        orderId,
        isin,
        quantity,
      });
      return { orderId, isin, quantity, url: webContents.getURL() };
    }
    pendingOtp.rejectVerification(runId, err);
    const msg = String(err?.message || '');
    const userCancelled = pendingOtp.wasUserCancelled(runId)
      || err?.code === 'USER_CANCELLED'
      || msg === pendingOtp.USER_CANCEL_MESSAGE
      || msg === pendingOtp.USER_CANCELLED_BUY_MESSAGE;
    if (userCancelled) {
      if (reachedOtpStep) {
        await tryCancelOrder(webContents, { userInitiated: true });
      }
      const cancelErr = new Error(pendingOtp.USER_CANCELLED_BUY_MESSAGE);
      cancelErr.code = 'USER_CANCELLED';
      throw cancelErr;
    }
    if (msg === 'Час перевірки коду минув') {
      pushBuyLog(
        'warning',
        'Час перевірки минув — перевірте статус замовлення на UNIVER',
        { step: 'Підтвердження коду', action: 'otp_timeout', orderId, isin },
      );
    } else {
      await tryCancelOrder(webContents, { userInitiated: false });
    }
    throw err;
  }
  } catch (err) {
    const msg = String(err?.message || '');
    const userCancelled = pendingOtp.wasUserCancelled(runId)
      || err?.code === 'USER_CANCELLED'
      || msg === pendingOtp.USER_CANCEL_MESSAGE
      || msg === pendingOtp.USER_CANCELLED_BUY_MESSAGE;
    if (userCancelled && !reachedOtpStep) {
      const cancelErr = new Error(pendingOtp.USER_CANCELLED_BUY_MESSAGE);
      cancelErr.code = 'USER_CANCELLED';
      throw cancelErr;
    }
    throw err;
  } finally {
    pendingOtp.clear(runId);
  }
}

module.exports = {
  runUniverBuy,
  pushBuyLog,
  sanitizeBuyLogContext,
  CLICK_CANCEL_ORDER_JS,
  CANCEL_ORDER_STATUS_FALLBACK,
};
