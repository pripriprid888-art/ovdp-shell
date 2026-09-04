function formatMoney(n) {
  return n.toLocaleString('uk-UA', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function formatPct(n) {
  if (typeof formatPctCompact === 'function') {
    return formatPctCompact(n).replace(/ %$/, '');
  }
  return n.toLocaleString('uk-UA', { maximumFractionDigits: 4, minimumFractionDigits: 0 });
}

function setOut(id, text) {
  const el = document.getElementById(id);
  if (el) el.textContent = text;
}

function calculate() {
  const calc = window.BondCalculator;
  if (!calc) return;

  const paymentsEl = document.getElementById('payments');
  const result = calc.computeProjection({
    nominal: parseFloat(document.getElementById('nominal')?.value) || 0,
    quantity: parseFloat(document.getElementById('quantity')?.value) || 0,
    couponRate: parseFloat(document.getElementById('coupon-rate')?.value) || 0,
    pricePct: parseFloat(document.getElementById('price-pct')?.value) || 0,
    years: parseFloat(document.getElementById('years')?.value) || 0,
    paymentsPerYear: parseInt(paymentsEl?.value, 10) || 1,
  });

  setOut('out-purchase', `${formatMoney(result.purchaseTotal)} ₴`);
  setOut('out-coupon-payment', `${formatMoney(result.couponPerPayment)} ₴`);
  setOut('out-annual', `${formatMoney(result.annualCoupon)} ₴`);
  setOut('out-total-coupons', `${formatMoney(result.totalCoupons)} ₴`);
  setOut('out-capital', `${formatMoney(result.capitalGainAbs)} ₴`);
  setOut('out-capital-pct', `${formatPct(result.capitalGainPctOfPurchase)} %`);
  setOut('out-total', `${formatMoney(result.totalReturn)} ₴`);
  setOut('out-ytm', `${formatPct(result.ytm)} %`);
  setOut('out-current-yield', `${formatPct(result.currentYield)} %`);
  setOut('out-total-return-pct', `${formatPct(result.totalReturnPct)} %`);
  setOut('out-annualized-return', `${formatPct(result.annualizedReturnPct)} %`);
}

document.querySelectorAll('input, select').forEach((el) => {
  el.addEventListener('input', calculate);
  el.addEventListener('change', calculate);
});

calculate();
