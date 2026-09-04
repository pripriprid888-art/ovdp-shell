const { processPortfolioItems } = require('./process');
const { EXTRACT_UNIVER_BALANCE_JS } = require('./univer-balance');
const { scanUniverHoldings, PORTFOLIO_URL } = require('./univer-portfolio-scan');

const UNIVER_BASE = 'https://univer.1b.app';
const BALANCE_URL = `${UNIVER_BASE}/client/`;

const CHECK_AUTH_JS = `(() => {
  const url = location.href.toLowerCase();
  if (!url.includes('univer.1b.app')) return false;
  if (url.includes('/client/login') || url.includes('/client/remindpassword')) return false;
  return !document.querySelector('input[name="login"]');
})()`;

module.exports = {
  id: 'univer',
  name: 'UNIVER',
  balanceUrl: BALANCE_URL,
  balancePrepareDelayMs: 3000,
  extractBalanceJs: EXTRACT_UNIVER_BALANCE_JS,
  portfolioUrl: PORTFOLIO_URL,
  waitSelector: 'table, a[href*="/client/"], tr[data-productid], main, .content, #content',
  preparePage: null,
  prepareDelayMs: 3500,
  checkAuthJs: CHECK_AUTH_JS,
  scanHoldings: scanUniverHoldings,
  processRawItems: (rawItems) => processPortfolioItems(rawItems, 'univer', PORTFOLIO_URL),
  emptyMessage: 'У кабінеті UNIVER не знайдено ОВДП у портфелі',
  layoutErrorMessage: 'Портфель UNIVER не завантажився — перевірте сесію',
  authRequiredMessage: 'Потрібен вхід у UNIVER для сканування портфеля',
};
