const { CHECK_AUTH_PRIVAT_JS } = require('../session/privat-auth');
const { CHECK_AUTH_UNIVER_JS } = require('../session/univer-auth');

const INZHUR_BASE = 'https://www.inzhur.reit';
const UNIVER_BASE = 'https://univer.1b.app';

const CHECK_AUTH_INZHUR_JS = `(() => {
  const url = location.href;
  if (url.includes('/signin')) return { authenticated: false, reason: 'signin' };
  if (url.includes('/dashboard')) {
    const hasLogin = !!document.querySelector('input[name="login"]');
    return { authenticated: !hasLogin, reason: hasLogin ? 'login_form' : 'dashboard' };
  }
  return { authenticated: false, reason: 'redirect' };
})()`;

const SITES = {
  inzhur: {
    id: 'inzhur',
    name: 'Inzhur',
    partition: 'persist:inzhur',
    homeUrl: `${INZHUR_BASE}/`,
    signInUrl: `${INZHUR_BASE}/signin`,
    catalogUrl: `${INZHUR_BASE}/offer/ovdp`,
    verifyUrl: `${INZHUR_BASE}/dashboard`,
    cookieDomains: ['inzhur.reit'],
    hostPatterns: ['inzhur.reit'],
    checkAuthJs: CHECK_AUTH_INZHUR_JS,
    authHint: {
      authenticated: ['/dashboard'],
      guest: ['/signin'],
    },
    authType: 'phone_password',
    usernameLabel: 'Телефон',
    passwordLabel: 'Пароль',
    passwordRequired: true,
    supportsAutoSignIn: true,
    supportsHeadlessSignIn: false,
    supportsPurchaseRoute: true,
  },
  univer: {
    id: 'univer',
    name: 'UNIVER',
    partition: 'persist:univer',
    homeUrl: 'https://www.univer.ua/products',
    signInUrl: `${UNIVER_BASE}/client/login/`,
    catalogUrl: `${UNIVER_BASE}/client/custompage/38/`,
    cabinetUrl: `${UNIVER_BASE}/client/`,
    portfolioUrl: `${UNIVER_BASE}/client/myorders/portfeli-kliientiv/`,
    verifyUrl: `${UNIVER_BASE}/client/custompage/38/`,
    cookieDomains: ['univer.ua', 'univer.1b.app', '1b.app'],
    hostPatterns: ['univer.ua', 'univer.1b.app', '1b.app'],
    checkAuthJs: CHECK_AUTH_UNIVER_JS,
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
    supportsAutoSignIn: true,
    supportsHeadlessSignIn: true,
    supportsPurchaseRoute: true,
  },
  privat: {
    id: 'privat',
    name: 'Приват24',
    partition: 'persist:privat',
    homeUrl: 'https://next.privat24.ua/',
    signInUrl: 'https://next.privat24.ua/bonds/list',
    catalogUrl: 'https://next.privat24.ua/bonds/list',
    bondsListUrl: 'https://next.privat24.ua/bonds/list',
    verifyUrl: 'https://next.privat24.ua/bonds/list',
    cookieDomains: ['privat24.ua', 'privatbank.ua'],
    hostPatterns: ['privat24.ua', 'privatbank.ua'],
    checkAuthJs: CHECK_AUTH_PRIVAT_JS,
    authHint: {
      guest: ['login-widget'],
    },
    authType: 'phone_otp',
    usernameLabel: 'Телефон',
    passwordLabel: 'Пароль',
    passwordRequired: true,
    supportsAutoSignIn: true,
    supportsHeadlessSignIn: true,
    supportsPurchaseRoute: true,
  },
};

function getSite(siteId) {
  const site = SITES[siteId];
  if (!site) throw new Error(`Unknown site: ${siteId}`);
  return site;
}

function listSiteIds() {
  return Object.keys(SITES);
}

function detectSiteFromUrl(url) {
  try {
    const hostname = new URL(url).hostname;
    for (const siteId of listSiteIds()) {
      const site = SITES[siteId];
      if (site.hostPatterns.some((pattern) => hostname.includes(pattern))) {
        return siteId;
      }
    }
  } catch {
    // ignore invalid URLs
  }
  return null;
}

function inferAuthFromUrl(siteId, url) {
  const site = getSite(siteId);
  const lower = (url || '').toLowerCase();
  if (site.authHint.guest?.some((part) => lower.includes(part.toLowerCase()))) {
    return 'guest';
  }
  if (siteId === 'privat') {
    if (lower.includes('login-widget')) return 'guest';
    if (lower.includes('/bonds/')) return 'authenticated';
    return null;
  }
  if (siteId === 'univer' && lower.includes('univer.1b.app/client') && !lower.includes('/client/login')) {
    return 'authenticated';
  }
  if (site.authHint.authenticated?.some((part) => lower.includes(part.toLowerCase()))) {
    return 'authenticated';
  }
  return null;
}

module.exports = {
  SITES,
  getSite,
  listSiteIds,
  detectSiteFromUrl,
  inferAuthFromUrl,
};
