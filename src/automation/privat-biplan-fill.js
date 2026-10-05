function normalizeTopUpAmount(raw) {
  const cleaned = String(raw ?? '').replace(/\s/g, '').replace(',', '.');
  const n = parseFloat(cleaned);
  if (!Number.isFinite(n) || n <= 0) return '';
  return n.toFixed(2);
}

function buildPrivatBiplanFillScript({ contractNumber, amount } = {}) {
  const contract = JSON.stringify(String(contractNumber || '').trim());
  const sum = JSON.stringify(normalizeTopUpAmount(amount));
  return `(() => {
    const CONTRACT = ${contract};
    const AMOUNT = ${sum};

    function fillInput(input, value) {
      if (!input || !value) return false;
      if (input.value === value) return true;
      input.focus();
      input.value = value;
      input.setAttribute('data-qa-value', value);
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
      return input.value === value;
    }

    function tryFill() {
      let contractOk = !CONTRACT;
      let amountOk = !AMOUNT;

      if (CONTRACT) {
        const dogno = document.querySelector('#DOGNO, input[name="DOGNO"], input[data-qa-node="DOGNO"]');
        contractOk = fillInput(dogno, CONTRACT);
      }

      if (AMOUNT) {
        const sumInput = document.querySelector('#SUM, input[name="SUM"], input[data-qa-node="SUM"]');
        amountOk = fillInput(sumInput, AMOUNT);
      }

      return {
        ok: contractOk && amountOk,
        contractOk,
        amountOk,
      };
    }

    const immediate = tryFill();
    if (immediate.ok) return immediate;

    if (!window.__ovdpBiplanFillObserver) {
      window.__ovdpBiplanFillObserver = new MutationObserver(() => {
        const result = tryFill();
        if (result.ok) {
          window.__ovdpBiplanFillObserver.disconnect();
          window.__ovdpBiplanFillObserver = null;
        }
      });
      window.__ovdpBiplanFillObserver.observe(document.documentElement, {
        childList: true,
        subtree: true,
      });
      setTimeout(() => {
        if (window.__ovdpBiplanFillObserver) {
          window.__ovdpBiplanFillObserver.disconnect();
          window.__ovdpBiplanFillObserver = null;
        }
      }, 15000);
    }

    return immediate;
  })()`;
}

/** @deprecated use buildPrivatBiplanFillScript */
function buildPrivatDognoFillScript(contractNumber) {
  return buildPrivatBiplanFillScript({ contractNumber });
}

function isPrivatBiplanPaymentUrl(url = '') {
  try {
    const parsed = new URL(url);
    return parsed.hostname.includes('privat24.ua')
      && (parsed.pathname.includes('/payments/') || parsed.pathname.includes('/payment'));
  } catch {
    return String(url).includes('privat24.ua') && String(url).includes('payment');
  }
}

module.exports = {
  normalizeTopUpAmount,
  buildPrivatBiplanFillScript,
  buildPrivatDognoFillScript,
  isPrivatBiplanPaymentUrl,
};
