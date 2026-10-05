const { createScanWindow, destroyScanWindow } = require('../../scan/window');

const UNIVER_PAYMENT_ADD_URL = 'https://univer.1b.app/client/payment/add/';

const EXTRACT_UNIVER_PAYMENT_INFO_JS = String.raw`(() => {
  function normalizeText(el) {
    return (el?.innerText || el?.textContent || '').replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim();
  }

  let paymentPurpose = null;
  for (const el of document.querySelectorAll('.flex-value .js-text, .data-view .js-text, .flex-value, .data-view')) {
    const text = normalizeText(el);
    if (!text || /^(призначення платежу:?)$/i.test(text)) continue;
    if (/договор/i.test(text)) {
      paymentPurpose = text.replace(/^.*призначення платежу:\s*/i, '').trim() || text;
      break;
    }
  }

  return {
    payment_purpose: paymentPurpose || null,
    contract_number: null,
  };
})()`;

function parseContractNumberFromPurpose(text) {
  if (!text) return '';
  const normalized = String(text).replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim();
  const match = normalized.match(/договор[уа]?\s*(?:№|#|No\.?)\s*([A-ZА-ЯІЇЄҐ0-9-]+)/iu);
  return match ? match[1].trim() : '';
}

function enrichPaymentInfo(raw = {}) {
  const paymentPurpose = raw.payment_purpose || raw.paymentPurpose || null;
  const contractNumber = parseContractNumberFromPurpose(paymentPurpose)
    || String(raw.contract_number || raw.contractNumber || '').trim();

  return {
    payment_purpose: paymentPurpose,
    contract_number: contractNumber || null,
  };
}

async function loadUrlWithTimeout(webContents, url, timeoutMs = 45000) {
  await webContents.loadURL(url);
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (!webContents.isLoading()) return;
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error('timeout');
}

async function fetchUniverPaymentInfo(getSession, options = {}) {
  const site = require('../../sites/config').getSite('univer');
  const scanWindow = createScanWindow({
    partition: site.partition,
    siteId: 'univer',
    shouldOpenExternally: require('../../shared/browser').shouldOpenExternally,
  });

  try {
    await loadUrlWithTimeout(scanWindow.webContents, UNIVER_PAYMENT_ADD_URL, options.timeoutMs);
    await new Promise((resolve) => setTimeout(resolve, options.prepareDelayMs || 2500));

    const authenticated = await scanWindow.webContents.executeJavaScript(`(() => {
      const url = location.href.toLowerCase();
      if (url.includes('/client/login') || url.includes('/client/remindpassword')) return false;
      return !document.querySelector('input[name="login"]');
    })()`);
    if (!authenticated) {
      return { ok: false, error: 'univer_not_authenticated' };
    }

    const raw = await scanWindow.webContents.executeJavaScript(EXTRACT_UNIVER_PAYMENT_INFO_JS);
    const info = enrichPaymentInfo(raw);
    if (!info.contract_number) {
      return { ok: false, error: 'contract_not_found', ...info };
    }

    return { ok: true, ...info };
  } finally {
    destroyScanWindow(scanWindow);
  }
}

module.exports = {
  UNIVER_PAYMENT_ADD_URL,
  EXTRACT_UNIVER_PAYMENT_INFO_JS,
  parseContractNumberFromPurpose,
  enrichPaymentInfo,
  fetchUniverPaymentInfo,
};
