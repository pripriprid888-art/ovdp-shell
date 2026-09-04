/** Browser layout helpers (full-width browser; cabinet is a separate page). */
function applyBrowserLayoutState({ panelSuppressed }) {
  document.body.classList.toggle('browser-expanded', Boolean(panelSuppressed));
}

function initPanelLayout() {
  if (!window.inzhurShell) return;

  window.inzhurShell.onBrowserLayoutState?.(applyBrowserLayoutState);
  window.inzhurShell.getBrowserLayoutState?.().then(applyBrowserLayoutState);
}

initPanelLayout();
