const { EXTRACT_PORTFOLIO_JS } = require('./extract');
const { processPortfolioItems } = require('./process');

const PORTFOLIO_URL = 'https://www.inzhur.reit/dashboard';

const CHECK_AUTH_JS = `(() => {
  if (location.href.includes('/signin')) return false;
  if (!location.href.includes('/dashboard')) return false;
  return !document.querySelector('input[name="login"]');
})()`;

module.exports = {
  id: 'inzhur',
  name: 'Inzhur',
  portfolioUrl: PORTFOLIO_URL,
  waitSelector: '.investment-unit[data-asset-id], table, .dashboard, main',
  preparePage: null,
  prepareDelayMs: 2000,
  checkAuthJs: CHECK_AUTH_JS,
  extractJs: EXTRACT_PORTFOLIO_JS,
  processRawItems: (rawItems) => processPortfolioItems(rawItems, 'inzhur', PORTFOLIO_URL),
  emptyMessage: 'У кабінеті Inzhur не знайдено ОВДП у портфелі',
  layoutErrorMessage: 'Кабінет Inzhur не завантажився — перевірте сесію',
  authRequiredMessage: 'Потрібен вхід у Inzhur для сканування портфеля',
};
