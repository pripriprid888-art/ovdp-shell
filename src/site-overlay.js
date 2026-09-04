const overlay = document.getElementById('inzhur-overlay');
const expandBtn = document.getElementById('btn-inzhur-overlay-expand');
const collapseBtn = document.getElementById('btn-inzhur-overlay-collapse');
const themeBtn = document.getElementById('btn-inzhur-theme');
const spacer = document.getElementById('browser-spacer');

const INZHUR_NAV = {
  signin: () => window.inzhurShell?.goInzhurSignin(),
  catalog: () => window.inzhurShell?.goCatalog(),
  dashboard: () => window.inzhurShell?.goInzhurDashboard(),
};

function applyInzhurOverlayState({ visible, collapsed, pageThemeLabel }) {
  if (!overlay || !expandBtn || !spacer) return;

  spacer.classList.toggle('inzhur-active', visible);
  overlay.hidden = !visible || collapsed;
  expandBtn.hidden = !visible || !collapsed;

  if (themeBtn && pageThemeLabel) {
    themeBtn.textContent = `Тема: ${pageThemeLabel}`;
  }

  if (collapseBtn) {
    collapseBtn.textContent = collapsed ? '▼' : '▲';
    collapseBtn.title = collapsed ? 'Розгорнути панель' : 'Згорнути панель';
  }
}

overlay?.addEventListener('click', (event) => {
  const navBtn = event.target.closest('[data-inzhur-nav]');
  if (!navBtn) return;
  const action = INZHUR_NAV[navBtn.dataset.inzhurNav];
  if (action) action();
});

collapseBtn?.addEventListener('click', () => {
  window.inzhurShell?.setInzhurOverlayCollapsed(true);
});

expandBtn?.addEventListener('click', () => {
  window.inzhurShell?.setInzhurOverlayCollapsed(false);
});

themeBtn?.addEventListener('click', () => {
  window.inzhurShell?.cycleInzhurPageTheme();
});

window.inzhurShell?.onInzhurOverlayState(applyInzhurOverlayState);
window.inzhurShell?.onActiveSite(({ siteId }) => {
  if (siteId !== 'inzhur') {
    applyInzhurOverlayState({ visible: false, collapsed: false });
  }
});

window.inzhurShell?.getInzhurOverlayState?.().then(applyInzhurOverlayState);
