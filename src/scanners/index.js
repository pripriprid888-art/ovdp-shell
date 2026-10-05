const {
  CATALOG_URL: INZHUR_CATALOG_URL,
  EXTRACT_BONDS_JS,
  WAIT_FOR_INZHUR_CATALOG_READY_JS,
  processRawItems: processInzhurRawItems,
} = require('./inzhur');
const {
  PRODUCTS_URL: UNIVER_CATALOG_URL,
  EXTRACT_PRODUCTS_CATALOG_JS,
  WAIT_FOR_UNIVER_PRODUCTS_READY_JS,
  processRawItems: processUniverRawItems,
} = require('./univer');
const {
  CATALOG_URL: PRIVAT_CATALOG_URL,
  EXTRACT_BONDS_LIST_JS,
  PREPARE_BONDS_LIST_JS,
  FETCH_BARGAINING_BONDS_JS,
  FETCH_AUTH_BARGAINING_BONDS_JS,
  processApiCatalogResult,
  mergeDomWithApiCatalog,
  processRawItems: processPrivatRawItems,
} = require('./privat');

const SCANNERS = {
  inzhur: {
    id: 'inzhur',
    name: 'Inzhur',
    catalogUrl: INZHUR_CATALOG_URL,
    waitSelector: 'body',
    readyJs: WAIT_FOR_INZHUR_CATALOG_READY_JS,
    readyTimeoutMs: 30000,
    preparePage: null,
    prepareDelayMs: 400,
    extractJs: EXTRACT_BONDS_JS,
    processRawItems: processInzhurRawItems,
    emptyMessage: 'Державні облігації не знайдено на сторінці каталогу Inzhur',
    layoutErrorMessage: 'Каталог ОВДП Inzhur не завантажився — перевірте доступ до inzhur.reit',
  },
  univer: {
    id: 'univer',
    name: 'УНІВЕР',
    catalogUrl: UNIVER_CATALOG_URL,
    waitSelector: '.investdataovdp .w-dyn-item, #oblovdp_products .w-dyn-item',
    preparePage: null,
    prepareDelayMs: 400,
    readyJs: WAIT_FOR_UNIVER_PRODUCTS_READY_JS,
    readyTimeoutMs: 30000,
    extractJs: EXTRACT_PRODUCTS_CATALOG_JS,
    processRawItems: processUniverRawItems,
    emptyMessage: 'Гривневі ОВДП не знайдено на сторінці каталогу UNIVER',
    layoutErrorMessage: 'Каталог ОВДП UNIVER не завантажився — перевірте доступ до univer.ua',
  },
  privat: {
    id: 'privat',
    name: 'Приват24',
    catalogUrl: PRIVAT_CATALOG_URL,
    useSitePartition: true,
    waitSelector: '[data-qa-node="bond"]',
    preparePage: PREPARE_BONDS_LIST_JS,
    apiPrepareDelayMs: 0,
    prepareDelayMs: 1200,
    preparePageDelayMs: 300,
    fetchApiJs: FETCH_BARGAINING_BONDS_JS,
    fetchAuthenticatedApiJs: FETCH_AUTH_BARGAINING_BONDS_JS,
    processApiCatalogResult,
    mergeDomWithApiCatalog,
    catalogListFromDom: true,
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
