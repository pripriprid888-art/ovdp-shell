const { EXTRACT_PORTFOLIO_JS } = require('./extract');
const { processPortfolioItems } = require('./process');
const {
  FETCH_BRIEFCASE_BONDS_JS,
  parseBriefcaseApiResponse,
} = require('../privat-api');

const PORTFOLIO_URL = 'https://next.privat24.ua/bonds/my';

const CHECK_AUTH_JS = `(() => {
  const url = location.href.toLowerCase();
  if (!url.includes('privat24.ua')) return false;
  if (url.includes('login-widget')) return false;
  const nodes = document.querySelectorAll('[data-qa-node="login"], [data-qa="login"], button, a');
  for (const el of nodes) {
    const text = (el.innerText || el.getAttribute('aria-label') || '').trim();
    if (/\\bвхід\\b/i.test(text) && el.offsetParent !== null) return false;
  }
  return true;
})()`;

const PREPARE_PORTFOLIO_JS = `(() => {
  const links = [...document.querySelectorAll('a, button, [role="tab"]')];
  const portfolio = links.find((el) => /портфель|portfolio|мої/i.test(el.innerText || ''));
  if (portfolio) {
    portfolio.click();
    return true;
  }
  return /\\/bonds\\/(my|portfolio)/.test(location.pathname);
})()`;

function processApiPortfolioResult(apiResult) {
  const parsed = parseBriefcaseApiResponse(apiResult);
  return {
    ...parsed,
    items: processPortfolioItems(parsed.items, 'privat', PORTFOLIO_URL),
  };
}

module.exports = {
  id: 'privat',
  name: 'Приват24',
  portfolioUrl: PORTFOLIO_URL,
  waitSelector: 'table, [data-qa-node], main',
  preparePage: PREPARE_PORTFOLIO_JS,
  prepareDelayMs: 2500,
  apiPrepareDelayMs: 500,
  checkAuthJs: CHECK_AUTH_JS,
  fetchApiJs: FETCH_BRIEFCASE_BONDS_JS,
  processApiPortfolioResult,
  extractJs: EXTRACT_PORTFOLIO_JS,
  processRawItems: (rawItems) => processPortfolioItems(rawItems, 'privat', PORTFOLIO_URL),
  emptyMessage: 'У Приват24 не знайдено ОВДП у портфелі',
  layoutErrorMessage: 'Портфель Приват24 не завантажився — перевірте сесію',
  authRequiredMessage: 'Потрібен вхід у Приват24 для сканування портфеля',
};
