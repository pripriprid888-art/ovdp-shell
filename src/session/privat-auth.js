/** Shared Privat24 auth detection (verify window + in-page automation). */

const PRIVAT_AUTH_CORE_JS = `
  function isVisible(el) {
    if (!el || !el.getBoundingClientRect) return false;
    const rect = el.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return false;
    const style = window.getComputedStyle(el);
    if (style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity) === 0) {
      return false;
    }
    return true;
  }

  function headerLoginVisible() {
    for (const sel of ['[data-qa-node="login"]', '[data-qa="login"]']) {
      for (const el of document.querySelectorAll(sel)) {
        if (isVisible(el)) return true;
      }
    }
    for (const el of document.querySelectorAll('button, a, [role="button"]')) {
      const text = (el.innerText || el.getAttribute('aria-label') || '').trim();
      if (/\\bвхід\\b/i.test(text) && isVisible(el)) return true;
    }
    return false;
  }

  function bondsShellReady() {
    const text = (document.body?.innerText || '').replace(/\\s+/g, ' ').trim();
    if (text.length < 40) return false;
    return /Облігації|Придбати|Вхід|Портфель|Гаманець/i.test(text)
      || !!document.querySelector('[data-qa-node="login"], [data-qa="login"]');
  }

  function loggedInUiVisible() {
    for (const sel of [
      '[data-qa-node="profile"]',
      '[data-qa-node="user"]',
      '[data-qa="profile"]',
      '[data-qa-node="logout"]',
      '[data-qa="logout"]',
    ]) {
      for (const el of document.querySelectorAll(sel)) {
        if (isVisible(el)) return true;
      }
    }
    const text = (document.body?.innerText || '').replace(/\\s+/g, ' ');
    if (/\\bвийти\\b|\\blogout\\b/i.test(text)) return true;
    return false;
  }

  function loginControlPresent() {
    return !!document.querySelector('[data-qa-node="login"], [data-qa="login"]');
  }

  function evaluatePrivatAuth() {
    const url = location.href.toLowerCase();
    if (!url.includes('privat24.ua')) {
      return { authenticated: false, reason: 'wrong_host' };
    }
    if (url.includes('login-widget')) {
      return { authenticated: false, reason: 'login_widget' };
    }
    if (url.includes('/bonds/') && !bondsShellReady()) {
      return { authenticated: false, reason: 'loading' };
    }
    if (loggedInUiVisible()) {
      return { authenticated: true, reason: 'logged_in_ui' };
    }
    if (headerLoginVisible()) {
      const guestCatalog = url.includes('/bonds/list')
        && document.querySelectorAll('[data-qa-node="bond"]').length > 0;
      return {
        authenticated: false,
        reason: guestCatalog ? 'guest_catalog' : 'login_button',
      };
    }
    if (url.includes('/bonds/') && bondsShellReady() && !loginControlPresent()) {
      return { authenticated: true, reason: 'no_login_control' };
    }
    return { authenticated: false, reason: 'guest_default' };
  }
`;

const CHECK_AUTH_PRIVAT_JS = `(() => {
  ${PRIVAT_AUTH_CORE_JS}
  return evaluatePrivatAuth();
})()`;

module.exports = {
  PRIVAT_AUTH_CORE_JS,
  CHECK_AUTH_PRIVAT_JS,
};
