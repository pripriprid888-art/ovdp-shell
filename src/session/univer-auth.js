/** Shared UNIVER auth detection — session verify, scans, automation flows. */

const CHECK_AUTH_UNIVER_JS = String.raw`(() => {
  const href = location.href.toLowerCase();
  if (!href.includes('univer.1b.app')) {
    return { authenticated: false, reason: 'wrong_host' };
  }

  const path = href.split('?')[0].replace(/\/$/, '');
  if (path.endsWith('/client/login') || path.endsWith('/client/remindpassword')) {
    return { authenticated: false, reason: 'login' };
  }

  const login = document.querySelector('input[name="login"]');
  const loginVisible = !!(login && login.offsetParent !== null);
  if (loginVisible) {
    return { authenticated: false, reason: 'login_form' };
  }

  if (href.includes('/client')) {
    return { authenticated: true, reason: 'cabinet' };
  }

  return { authenticated: false, reason: 'unknown' };
})()`;

const CHECK_AUTH_UNIVER_BOOLEAN_JS = String.raw`(() => {
  const href = location.href.toLowerCase();
  if (!href.includes('univer.1b.app')) return false;
  const path = href.split('?')[0].replace(/\/$/, '');
  if (path.endsWith('/client/login') || path.endsWith('/client/remindpassword')) return false;
  const login = document.querySelector('input[name="login"]');
  if (login && login.offsetParent !== null) return false;
  return href.includes('/client');
})()`;

function getVerifyPollConfig(siteId) {
  if (siteId === 'privat') {
    return { attempts: 20, initialDelayMs: 1500, pollDelayMs: 800 };
  }
  if (siteId === 'univer') {
    return { attempts: 20, initialDelayMs: 1500, pollDelayMs: 800 };
  }
  if (siteId === 'inzhur') {
    return { attempts: 8, initialDelayMs: 1500, pollDelayMs: 700 };
  }
  return { attempts: 3, initialDelayMs: 1200, pollDelayMs: 600 };
}

module.exports = {
  CHECK_AUTH_UNIVER_JS,
  CHECK_AUTH_UNIVER_BOOLEAN_JS,
  getVerifyPollConfig,
};
