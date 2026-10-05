function applyShellView(siteId) {
  const cabinet = document.getElementById('cabinet-screen');
  const spacer = document.getElementById('browser-spacer');
  if (!cabinet || !spacer) return;

  const isCabinet = siteId === 'cabinet';
  cabinet.hidden = !isCabinet;
  spacer.hidden = isCabinet;
}

function initShellView() {
  if (!window.inzhurShell) return;

  window.inzhurShell.onActiveSite(({ siteId }) => {
    applyShellView(siteId);
  });

  window.inzhurShell.onShellOtpMode?.(({ active }) => {
    if (active) {
      applyShellView('cabinet');
      return;
    }
    window.inzhurShell.getActiveSite().then((siteId) => {
      applyShellView(siteId);
    });
  });

  window.inzhurShell.onShellTopUpMode?.(({ active }) => {
    if (active) {
      applyShellView('cabinet');
      return;
    }
    window.inzhurShell.getActiveSite().then((siteId) => {
      applyShellView(siteId);
    });
  });

  window.inzhurShell.getActiveSite().then((siteId) => {
    applyShellView(siteId);
  });
}

initShellView();

window.applyShellView = applyShellView;
