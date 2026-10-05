const STYLE_ID = 'ovdp-inzhur-signin-shell';
const ROOT_CLASS = 'ovdp-inzhur-signin-plain';

/** Sign-in pages only: white background, native Inzhur UI unchanged. */
function getSigninShellCss() {
  return `
html.${ROOT_CLASS},
html.${ROOT_CLASS} body {
  background: #ffffff !important;
}

html.${ROOT_CLASS} #pageCont,
html.${ROOT_CLASS} .pageContent,
html.${ROOT_CLASS} .landing_wrap,
html.${ROOT_CLASS} .page-holder,
html.${ROOT_CLASS} .section-content,
html.${ROOT_CLASS} .login-sandbox,
html.${ROOT_CLASS} .steps--wrapper {
  background: #ffffff !important;
}
`;
}

function buildInzhurSigninShellMarkScript() {
  const rootClass = JSON.stringify(ROOT_CLASS);
  return `(() => {
    const ROOT_CLASS = ${rootClass};

    function isSigninPath() {
      return location.pathname.indexOf('/signin') !== -1;
    }

    function applySigninPlain() {
      if (!isSigninPath()) {
        document.documentElement.classList.remove(ROOT_CLASS);
        return false;
      }
      document.documentElement.classList.add(ROOT_CLASS);
      return true;
    }

    function scheduleApply() {
      if (window.__ovdpInzhurSigninTimer) clearTimeout(window.__ovdpInzhurSigninTimer);
      window.__ovdpInzhurSigninTimer = setTimeout(() => {
        window.__ovdpInzhurSigninTimer = null;
        applySigninPlain();
      }, 80);
    }

    applySigninPlain();

    if (!window.__ovdpInzhurSigninObserver) {
      window.__ovdpInzhurSigninObserver = new MutationObserver(scheduleApply);
      window.__ovdpInzhurSigninObserver.observe(document.documentElement, {
        attributes: true,
        childList: true,
        subtree: true,
      });
    }

    return true;
  })()`;
}

function isInzhurSigninUrl(url = '') {
  try {
    const parsed = new URL(url);
    return parsed.hostname.includes('inzhur.reit') && parsed.pathname.includes('/signin');
  } catch {
    return String(url).includes('/signin');
  }
}

function buildInzhurSigninShellRemoveScript() {
  return `(() => {
    document.documentElement.classList.remove(${JSON.stringify(ROOT_CLASS)});
    if (window.__ovdpInzhurSigninObserver) {
      window.__ovdpInzhurSigninObserver.disconnect();
      window.__ovdpInzhurSigninObserver = null;
    }
    if (window.__ovdpInzhurSigninTimer) {
      clearTimeout(window.__ovdpInzhurSigninTimer);
      window.__ovdpInzhurSigninTimer = null;
    }
    return true;
  })()`;
}

/** @deprecated use buildInzhurSigninShellMarkScript */
function buildInzhurSigninShellScript() {
  return buildInzhurSigninShellMarkScript();
}

module.exports = {
  STYLE_ID,
  ROOT_CLASS,
  getSigninShellCss,
  isInzhurSigninUrl,
  buildInzhurSigninShellMarkScript,
  buildInzhurSigninShellScript,
  buildInzhurSigninShellRemoveScript,
};
