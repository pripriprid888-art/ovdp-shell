const backBtn = document.getElementById('btn-back');
const forwardBtn = document.getElementById('btn-forward');
const reloadBtn = document.getElementById('btn-reload');
const brandBtn = document.getElementById('btn-brand');
const catalogBtn = document.getElementById('btn-catalog');
const univerBtn = document.getElementById('btn-univer');
const privatBtn = document.getElementById('btn-privat');
const urlBar = document.getElementById('url-bar');
const statusDots = {
  inzhur: document.getElementById('status-inzhur'),
  univer: document.getElementById('status-univer'),
  privat: document.getElementById('status-privat'),
};

let activeSiteId = 'cabinet';

function updateSiteButtons() {
  const onCabinet = activeSiteId === 'cabinet';
  catalogBtn.classList.toggle('site-active', activeSiteId === 'inzhur');
  univerBtn.classList.toggle('site-active', activeSiteId === 'univer');
  privatBtn.classList.toggle('site-active', activeSiteId === 'privat');
  brandBtn?.classList.toggle('active', onCabinet);
}

function applySessionStates(states) {
  for (const state of states) {
    const dot = statusDots[state.siteId];
    const button = {
      inzhur: catalogBtn,
      univer: univerBtn,
      privat: privatBtn,
    }[state.siteId];
    if (!dot || !button) continue;

    dot.className = `status-dot status-${state.status}`;
    dot.title = state.message || state.status;
    button.classList.toggle('site-active', state.siteId === activeSiteId);
  }
}

function bindToolbar() {
  if (!window.inzhurShell) return;

  window.inzhurShell.onNavigationState(({ url, canGoBack, canGoForward, activeSiteId: siteId }) => {
    if (siteId) activeSiteId = siteId;
    urlBar.textContent = url || '';
    backBtn.disabled = !canGoBack;
    forwardBtn.disabled = !canGoForward;
    updateSiteButtons();
  });

  window.inzhurShell.onLoading((isLoading) => {
    urlBar.classList.toggle('loading', isLoading);
  });

  window.inzhurShell.onSessionStates(applySessionStates);

  window.inzhurShell.onActiveSite(({ siteId }) => {
    activeSiteId = siteId;
    updateSiteButtons();
  });

  window.inzhurShell.getSessionStates().then(applySessionStates);
  window.inzhurShell.getActiveSite().then((siteId) => {
    activeSiteId = siteId;
    updateSiteButtons();
  });
}

backBtn.addEventListener('click', () => window.inzhurShell?.goBack());
forwardBtn.addEventListener('click', () => window.inzhurShell?.goForward());
reloadBtn.addEventListener('click', () => window.inzhurShell?.reload());
brandBtn?.addEventListener('click', () => window.inzhurShell?.goCabinet());
catalogBtn.addEventListener('click', () => window.inzhurShell?.goInzhurSignin());
univerBtn.addEventListener('click', () => window.inzhurShell?.goUniverCatalog());
privatBtn.addEventListener('click', () => window.inzhurShell?.goPrivatBonds());

catalogBtn.addEventListener('contextmenu', (event) => {
  event.preventDefault();
  window.inzhurShell?.goCatalog();
});

univerBtn.addEventListener('contextmenu', (event) => {
  event.preventDefault();
  window.inzhurShell?.goUniverCabinet();
});

privatBtn.addEventListener('contextmenu', (event) => {
  event.preventDefault();
  window.inzhurShell?.goPrivatBonds();
});

bindToolbar();
