const INZHUR_BASE = 'https://www.inzhur.reit';
const UNIVER_BASE = 'https://univer.1b.app';

/** Canonical platform definitions — labels, order, URLs, catalog quirks, capabilities. */
const PLATFORMS = {
  inzhur: {
    id: 'inzhur',
    name: 'Inzhur',
    order: 0,
    badgeClass: 'source-inzhur',
    partition: 'persist:inzhur',
    homeUrl: `${INZHUR_BASE}/`,
    signInUrl: `${INZHUR_BASE}/dashboard/signin`,
    catalogUrl: `${INZHUR_BASE}/offer/ovdp`,
    verifyUrl: `${INZHUR_BASE}/dashboard`,
    cookieDomains: ['inzhur.reit'],
    hostPatterns: ['inzhur.reit'],
    authHint: {
      authenticated: ['/dashboard'],
      guest: ['/signin'],
    },
    authType: 'phone_password',
    usernameLabel: 'Телефон',
    passwordLabel: 'Пароль',
    passwordRequired: true,
    catalog: { listedYield: true, buyPrice: true },
    features: {
      autoSignIn: true,
      apiSignIn: false,
      headlessSignIn: true,
      purchaseRoute: true,
      orders: false,
      univerBuy: false,
      requiresPaymentAccount: false,
      portfolioBalanceHint: false,
      purchaseBalanceCheck: false,
      purchaseConfirmWatcher: false,
    },
  },
  univer: {
    id: 'univer',
    name: 'UNIVER',
    order: 1,
    badgeClass: 'source-univer',
    partition: 'persist:univer',
    homeUrl: 'https://www.univer.ua/products',
    signInUrl: `${UNIVER_BASE}/client/login/`,
    catalogUrl: 'https://www.univer.ua/products',
    cabinetUrl: `${UNIVER_BASE}/client/`,
    portfolioUrl: `${UNIVER_BASE}/client/myorders/portfeli-kliientiv/`,
    verifyUrl: `${UNIVER_BASE}/client/custompage/38/`,
    cookieDomains: ['univer.ua', 'univer.1b.app', '1b.app'],
    hostPatterns: ['univer.ua', 'univer.1b.app', '1b.app'],
    authHint: {
      authenticated: ['univer.1b.app/client'],
      guest: ['/client/login', '/client/remindpassword'],
    },
    authType: 'password',
    usernameLabel: 'Логін або email',
    passwordLabel: 'Пароль',
    passwordRequired: true,
    cabinetBuyUrl: `${UNIVER_BASE}/client/custompage/38/`,
    ordersUrl: `${UNIVER_BASE}/client/myorders/blok-bek/`,
    catalog: { listedYield: true, buyPrice: true },
    features: {
      autoSignIn: true,
      headlessSignIn: true,
      purchaseRoute: true,
      orders: true,
      univerBuy: true,
      requiresPaymentAccount: false,
      portfolioBalanceHint: true,
      purchaseBalanceCheck: true,
      purchaseConfirmWatcher: false,
    },
  },
  privat: {
    id: 'privat',
    name: 'Приват24',
    order: 2,
    badgeClass: 'source-privat',
    partition: 'persist:privat',
    homeUrl: 'https://next.privat24.ua/',
    signInUrl: 'https://next.privat24.ua/bonds/list',
    catalogUrl: 'https://next.privat24.ua/bonds/list',
    bondsListUrl: 'https://next.privat24.ua/bonds/list',
    verifyUrl: 'https://next.privat24.ua/bonds/list',
    cookieDomains: ['privat24.ua', 'privatbank.ua'],
    hostPatterns: ['privat24.ua', 'privatbank.ua'],
    authHint: {
      guest: ['login-widget'],
    },
    authType: 'phone_otp',
    usernameLabel: 'Телефон',
    passwordLabel: 'Пароль',
    passwordRequired: true,
    catalog: { listedYield: false, buyPrice: false },
    features: {
      autoSignIn: true,
      headlessSignIn: true,
      purchaseRoute: true,
      orders: false,
      univerBuy: false,
      requiresPaymentAccount: true,
      portfolioBalanceHint: false,
      purchaseBalanceCheck: false,
      purchaseConfirmWatcher: true,
    },
  },
};

function listPlatformIds() {
  return Object.values(PLATFORMS)
    .sort((a, b) => a.order - b.order)
    .map((p) => p.id);
}

function listPlatforms() {
  return listPlatformIds().map((id) => PLATFORMS[id]);
}

function getPlatform(siteId) {
  return PLATFORMS[siteId] || null;
}

function getSiteLabel(siteId) {
  return getPlatform(siteId)?.name || siteId;
}

function siteBadgeClass(siteId) {
  return getPlatform(siteId)?.badgeClass || `source-${siteId}`;
}

function siteSupports(siteId, feature) {
  return Boolean(getPlatform(siteId)?.features?.[feature]);
}

function isCatalogBond(bond) {
  return bond?.kind !== 'holding';
}

function catalogHasListedYield(siteId) {
  return getPlatform(siteId)?.catalog?.listedYield !== false;
}

function catalogHasBuyPrice(siteId) {
  return getPlatform(siteId)?.catalog?.buyPrice !== false;
}

function isCatalogBondMissingListedYield(bond) {
  return isCatalogBond(bond) && !catalogHasListedYield(bond?.site_id);
}

function isCatalogBondMissingBuyPrice(bond) {
  return isCatalogBond(bond) && !catalogHasBuyPrice(bond?.site_id);
}

function compareSiteOrder(a, b) {
  return listPlatformIds().indexOf(a) - listPlatformIds().indexOf(b);
}

const SITE_LABELS = Object.fromEntries(
  Object.values(PLATFORMS).map((p) => [p.id, p.name]),
);
const SITE_ORDER = listPlatformIds();

const PlatformRegistry = {
  PLATFORMS,
  SITE_LABELS,
  SITE_ORDER,
  listPlatformIds,
  listPlatforms,
  listSiteIds: listPlatformIds,
  getPlatform,
  getSiteLabel,
  siteBadgeClass,
  siteSupports,
  isCatalogBond,
  catalogHasListedYield,
  catalogHasBuyPrice,
  isCatalogBondMissingListedYield,
  isCatalogBondMissingBuyPrice,
  compareSiteOrder,
};

if (typeof module !== 'undefined' && module.exports) {
  module.exports = PlatformRegistry;
}
if (typeof window !== 'undefined') {
  window.PlatformRegistry = PlatformRegistry;
  window.SITE_LABELS = SITE_LABELS;
  window.SITE_ORDER = SITE_ORDER;
}
