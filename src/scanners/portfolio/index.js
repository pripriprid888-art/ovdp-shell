const inzhur = require('./inzhur');
const univer = require('./univer');
const privat = require('./privat');

const PORTFOLIO_SCANNERS = {
  inzhur,
  univer,
  privat,
};

function getPortfolioScanner(siteId) {
  const scanner = PORTFOLIO_SCANNERS[siteId];
  if (!scanner) {
    throw new Error(`Сканер портфеля не підтримується: ${siteId}`);
  }
  return scanner;
}

function listPortfolioScannerIds() {
  return Object.keys(PORTFOLIO_SCANNERS);
}

function getPortfolioUrl(siteId) {
  return getPortfolioScanner(siteId).portfolioUrl;
}

module.exports = {
  PORTFOLIO_SCANNERS,
  getPortfolioScanner,
  listPortfolioScannerIds,
  getPortfolioUrl,
};
