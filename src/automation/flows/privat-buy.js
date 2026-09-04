function buildSelectPaymentAccountJs(accountNumber) {
  const full = String(accountNumber || '').trim();
  const digits = full.replace(/\D/g, '');
  return `(() => {
    const fullNeedle = ${JSON.stringify(full)};
    const digitNeedle = ${JSON.stringify(digits)};
    if (!fullNeedle && !digitNeedle) return { ok: false, reason: 'empty' };

    function isVisible(el) {
      if (!el || !el.getBoundingClientRect) return false;
      const rect = el.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) return false;
      const style = window.getComputedStyle(el);
      return style.display !== 'none' && style.visibility !== 'hidden' && Number(style.opacity) !== 0;
    }

    function matches(text) {
      const raw = String(text || '');
      const compact = raw.replace(/\\s/g, '');
      const digits = compact.replace(/\\D/g, '');
      if (fullNeedle && (compact.includes(fullNeedle) || raw.includes(fullNeedle))) return true;
      if (digitNeedle && digits.includes(digitNeedle)) return true;
      return false;
    }

    function tryClick(el) {
      if (!el || !isVisible(el)) return false;
      try { el.click(); return true; } catch {}
      return false;
    }

    for (const input of document.querySelectorAll('input[type="radio"]')) {
      const label = input.id ? document.querySelector(\`label[for="\${input.id}"]\`) : null;
      const text = [input.value, label?.innerText, input.closest('label')?.innerText].join(' ');
      if (matches(text) && tryClick(input)) {
        return { ok: true, method: 'radio' };
      }
    }

    for (const select of document.querySelectorAll('select')) {
      for (const option of select.options) {
        if (matches(option.text || option.value)) {
          select.value = option.value;
          select.dispatchEvent(new Event('input', { bubbles: true }));
          select.dispatchEvent(new Event('change', { bubbles: true }));
          return { ok: true, method: 'select' };
        }
      }
    }

    const candidates = document.querySelectorAll(
      'button, label, li, [role="radio"], [role="option"], [data-qa-node], .account, .card',
    );
    for (const el of candidates) {
      const text = el.innerText || el.textContent || el.getAttribute('aria-label') || '';
      if (matches(text) && tryClick(el)) {
        return { ok: true, method: 'click' };
      }
    }

    for (const input of document.querySelectorAll('input[type="text"], input[inputmode="numeric"]')) {
      if (!isVisible(input)) continue;
      const placeholder = input.placeholder || input.getAttribute('aria-label') || '';
      if (/карт|рахун|card|account/i.test(placeholder + input.name)) {
        const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set;
        input.focus();
        if (setter) setter.call(input, fullNeedle);
        else input.value = fullNeedle;
        input.dispatchEvent(new Event('input', { bubbles: true }));
        input.dispatchEvent(new Event('change', { bubbles: true }));
        return { ok: true, method: 'input' };
      }
    }

    return { ok: false, reason: 'not_found' };
  })()`;
}

async function selectPrivatPaymentAccount(webContents, accountNumber, { waitForSelector, delay }) {
  if (!accountNumber) return { ok: false, reason: 'empty' };
  await waitForSelector(webContents, 'input, select, button, [role="radio"], label', 45000);
  await delay(1500);
  return webContents.executeJavaScript(buildSelectPaymentAccountJs(accountNumber));
}

module.exports = {
  buildSelectPaymentAccountJs,
  selectPrivatPaymentAccount,
};
