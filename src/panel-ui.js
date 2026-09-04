const PANEL_VIEWS = {
  bonds: 'panel-bonds',
};

function applyPanelTab(tabId) {
  let normalized = {
    securities: 'bonds',
    auto: 'bonds',
    automation: 'bonds',
    calculator: 'bonds',
    setup: 'bonds',
  }[tabId] || tabId;

  if (tabId === 'calculator') {
    window.openCalcDrawerFree?.();
  }

  if (tabId === 'setup') {
    window.switchListKind?.('setup');
  }

  if (!PANEL_VIEWS[normalized]) return;

  const cabinet = document.getElementById('cabinet-screen');
  if (!cabinet) return;

  cabinet.classList.remove(
    'panel-tab-bonds',
    'panel-tab-setup',
    'panel-tab-automation',
  );
  cabinet.classList.add(`panel-tab-${normalized}`);

  document.body.classList.remove(
    'panel-tab-bonds',
    'panel-tab-setup',
    'panel-tab-automation',
  );
  document.body.classList.add(`panel-tab-${normalized}`);

  Object.entries(PANEL_VIEWS).forEach(([id, viewId]) => {
    document.getElementById(viewId)?.classList.toggle('active', id === normalized);
  });
}

function initPanelUi() {
  window.inzhurShell?.onPanelTab(applyPanelTab);
  window.inzhurShell?.getPanelTab().then((tabId) => {
    if (tabId) applyPanelTab(tabId);
  });
}

initPanelUi();

window.applyPanelTab = applyPanelTab;
