const EXTRACT_PRIVAT_PAYMENT_STEP_JS = String.raw`(() => {
  function norm(text) {
    return String(text || '').replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim();
  }

  function isVisible(el) {
    if (!el || !el.getBoundingClientRect) return false;
    const rect = el.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return false;
    const style = window.getComputedStyle(el);
    return style.display !== 'none' && style.visibility !== 'hidden' && Number(style.opacity) !== 0;
  }

  function readTotal() {
    const label = document.querySelector('[data-qa-node="paymentCheckTotal"]');
    if (!label) return '';
    const row = label.closest('.sc-ixKSzz') || label.parentElement?.parentElement;
    if (!row) return '';
    const amountEl = row.querySelector('.sc-bvrlno, .iCOLuY, .hEXDDF');
    return norm(amountEl?.innerText || amountEl?.textContent);
  }

  const titleEl = document.querySelector('[data-qa-node="heading-title"], h3[data-qa-node="heading-title"]');
  const title = norm(titleEl?.innerText || titleEl?.textContent);
  const serviceName = norm(document.querySelector('[data-qa-node="service_name"]')?.innerText);
  const total = readTotal();
  const previewAmount = norm(
    document.querySelector('.preview_YHKFwB_eHq .sc-hzhJZQ.grlKRm')?.innerText
    || document.querySelector('.preview_YHKFwB_eHq [class*="grlKRm"]')?.innerText,
  );

  const dognoInput = document.querySelector('#DOGNO, input[name="DOGNO"], input[data-qa-node="DOGNO"]');
  const sumInput = document.querySelector('#SUM, input[name="SUM"], input[data-qa-node="SUM"]');
  const hasFormFields = Boolean(dognoInput && sumInput);
  const formFilled = hasFormFields
    && norm(dognoInput.value).length > 0
    && norm(sumInput.value).length > 0;
  const hasConfirmationChecks = Boolean(document.querySelector('[data-qa-node="paymentCheckTotal"]'));

  const buttons = [...document.querySelectorAll('button')]
    .filter((btn) => isVisible(btn))
    .map((btn) => norm(btn.innerText || btn.textContent))
    .filter(Boolean);

  let step = 'unknown';
  if (/Підтвердження платежу/i.test(title) || hasConfirmationChecks) {
    step = 'confirmation';
  } else if (hasFormFields) {
    step = 'form';
  }

  return {
    step,
    title,
    serviceName,
    total: total || previewAmount,
    buttons,
    hasFormFields,
    formFilled,
    hasConfirmationChecks,
  };
})()`;

function detectPrivatPaymentStep(raw = {}) {
  const title = String(raw.title || '').trim();
  const buttons = Array.isArray(raw.buttons) ? raw.buttons : [];

  let step = String(raw.step || 'unknown');
  if (step === 'unknown') {
    if (/Підтвердження платежу/i.test(title) || raw.hasConfirmationChecks) {
      step = 'confirmation';
    } else if (raw.hasFormFields) {
      step = 'form';
    }
  }

  return {
    step,
    title,
    serviceName: String(raw.serviceName || '').trim(),
    total: String(raw.total || '').trim(),
    buttons,
    hasFormFields: Boolean(raw.hasFormFields),
    formFilled: Boolean(raw.formFilled),
    hasConfirmationChecks: Boolean(raw.hasConfirmationChecks),
  };
}

function paymentStepStatusMessage(stepInfo, context = {}) {
  const info = detectPrivatPaymentStep(stepInfo);
  const amount = info.total || context.amount;

  if (info.step === 'confirmation') {
    const sum = amount ? ` — ${amount}` : '';
    return `Підтвердження платежу${sum}. Перевірте реквізити та завершіть оплату в Приват24.`;
  }
  if (info.step === 'form') {
    return context.amount
      ? `Форма оплати UNIVER — ${context.amount} ₴`
      : 'Форма оплати UNIVER у Приват24';
  }
  return null;
}

function buildClickPrivatButtonScript(labels = []) {
  const serialized = labels.map((label) => JSON.stringify(String(label || '')));
  return `(() => {
    const LABELS = [${serialized.join(', ')}];

    function norm(text) {
      return String(text || '').replace(/\\s+/g, ' ').trim();
    }

    function isVisible(el) {
      if (!el || !el.getBoundingClientRect) return false;
      const rect = el.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) return false;
      const style = window.getComputedStyle(el);
      return style.display !== 'none' && style.visibility !== 'hidden' && Number(style.opacity) !== 0;
    }

    for (const label of LABELS) {
      if (!label) continue;
      const re = new RegExp(label, 'i');
      for (const btn of document.querySelectorAll('button')) {
        const text = norm(btn.innerText || btn.textContent);
        if (!re.test(text) || !isVisible(btn) || btn.disabled) continue;
        btn.click();
        return { ok: true, label: text };
      }
    }

    return { ok: false };
  })()`;
}

module.exports = {
  EXTRACT_PRIVAT_PAYMENT_STEP_JS,
  detectPrivatPaymentStep,
  paymentStepStatusMessage,
  buildClickPrivatButtonScript,
};
