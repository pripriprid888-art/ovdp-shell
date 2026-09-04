const {
  CATALOG_URL: INZHUR_CATALOG_URL,
  EXTRACT_BONDS_JS,
  processRawItems: processInzhurRawItems,
} = require('./inzhur');
const {
  CABINET_CATALOG_URL: UNIVER_CATALOG_URL,
  EXTRACT_CABINET_CATALOG_JS,
  processRawItems: processUniverRawItems,
} = require('./univer');
const { CHECK_AUTH_UNIVER_BOOLEAN_JS } = require('../session/univer-auth');
const {
  CATALOG_URL: PRIVAT_CATALOG_URL,
  EXTRACT_BONDS_LIST_JS,
  PREPARE_BONDS_LIST_JS,
  processRawItems: processPrivatRawItems,
} = require('./privat');

const SCANNERS = {
  inzhur: {
    id: 'inzhur',
    name: 'Inzhur',
    catalogUrl: INZHUR_CATALOG_URL,
    waitSelector: '.investment-unit[data-asset-id]',
    preparePage: null,
    prepareDelayMs: 500,
    extractJs: EXTRACT_BONDS_JS,
    processRawItems: processInzhurRawItems,
    emptyMessage: 'Державні облігації не знайдено на сторінці каталогу Inzhur',
    layoutErrorMessage: 'Картки ОВДП не знайдено — можливо, змінився макет сторінки Inzhur',
  },
  univer: {
    id: 'univer',
    name: 'УНІВЕР',
    catalogUrl: UNIVER_CATALOG_URL,
    useSitePartition: true,
    requiresAuth: true,
    checkAuthJs: CHECK_AUTH_UNIVER_BOOLEAN_JS,
    authRequiredMessage: 'Потрібен вхід у UNIVER для сканування каталогу Гривневі ОВДП',
    waitSelector: '.js-product-table .js-client-buy-action, tr[data-productid]',
    preparePage: null,
    prepareDelayMs: 2500,
    extractJs: EXTRACT_CABINET_CATALOG_JS,
    processRawItems: processUniverRawItems,
    emptyMessage: 'Гривневі ОВДП не знайдено в кабінеті UNIVER',
    layoutErrorMessage: 'Каталог Гривневі ОВДП не завантажився — перевірте сесію UNIVER',
  },
  privat: {
    id: 'privat',
    name: 'Приват24',
    catalogUrl: PRIVAT_CATALOG_URL,
    useSitePartition: true,
    waitSelector: '[data-qa-node="bond"]',
    preparePage: PREPARE_BONDS_LIST_JS,
    prepareDelayMs: 8000,
    extractJs: EXTRACT_BONDS_LIST_JS,
    processRawItems: processPrivatRawItems,
    emptyMessage: 'Гривневі ОВДП не знайдено на bonds/list Приват24',
    layoutErrorMessage: 'Список облігацій не завантажився — перевірте сесію Приват24',
  },
};

function getScanner(siteId) {
  const scanner = SCANNERS[siteId];
  if (!scanner) {
    throw new Error(`Невідоме джерело сканування: ${siteId}`);
  }
  return scanner;
}

function listScanners() {
  return Object.values(SCANNERS);
}

function listScannerIds() {
  return Object.keys(SCANNERS);
}

function getCatalogUrl(siteId) {
  return getScanner(siteId).catalogUrl;
}

module.exports = {
  SCANNERS,
  getScanner,
  listScanners,
  listScannerIds,
  getCatalogUrl,
};
