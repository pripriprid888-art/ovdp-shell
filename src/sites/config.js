const registry = require('./registry');
const { CHECK_AUTH_PRIVAT_JS } = require('../session/privat-auth');
const { CHECK_AUTH_UNIVER_JS } = require('../session/univer-auth');

const CHECK_AUTH_INZHUR_JS = `(() => {
  const url = location.href;
  if (url.includes('/signin')) return { authenticated: false, reason: 'signin' };
  if (url.includes('/dashboard')) {
    const hasLogin = !!document.querySelector(
      'input[type="tel"], input[name="password"], input[name="login"]',
    );
    return { authenticated: !hasLogin, reason: hasLogin ? 'login_form' : 'dashboard' };
  }
  return { authenticated: false, reason: 'redirect' };
})()`;

const CHECK_AUTH_JS = {
  inzhur: CHECK_AUTH_INZHUR_JS,
  univer: CHECK_AUTH_UNIVER_JS,
  privat: CHECK_AUTH_PRIVAT_JS,
};

function buildSiteRecord(platform) {
  const { catalog, features, order, badgeClass, ...siteFields } = platform;
  return {
    ...siteFields,
    checkAuthJs: CHECK_AUTH_JS[platform.id],
    supportsAutoSignIn: features.autoSignIn !== false,
    supportsHeadlessSignIn: features.headlessSignIn !== false,
    supportsPurchaseRoute: features.purchaseRoute !== false,
    catalog,
    features,
  };
}

const SITES = Object.fromEntries(
  registry.listPlatformIds().map((id) => [id, buildSiteRecord(registry.getPlatform(id))]),
);

function getSite(siteId) {
  const site = SITES[siteId];
  if (!site) throw new Error(`Unknown site: ${siteId}`);
  return site;
}

function listSiteIds() {
  return registry.listPlatformIds();
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
