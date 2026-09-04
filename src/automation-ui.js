let otpRunId = null;

function escapeHtml(text) {
  return String(text || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function formatLogTime(iso) {
  try {
    return new Date(iso).toLocaleTimeString('uk-UA', {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
  } catch {
    return '—';
  }
}

function formatSiteLabel(siteId) {
  if (!siteId) return '';
  return window.SITE_LABELS?.[siteId] || siteId.toUpperCase();
}

function renderBackgroundLog(entries = []) {
  const container = document.getElementById('background-log');
  if (!container) return;

  if (!entries.length) {
    container.innerHTML = '<p class="background-log-empty">Поки немає записів.</p>';
    return;
  }

  container.innerHTML = entries.map((entry) => {
    const level = entry.level || 'info';
    const kind = entry.kind === 'automation' ? 'авто' : 'дія';
    const site = entry.siteId ? `[${escapeHtml(formatSiteLabel(entry.siteId))}] ` : '';
    return `
      <div class="log-line log-${level}">
        <span class="log-meta">${formatLogTime(entry.at)} · ${kind} · ${site}</span>
        ${escapeHtml(entry.message)}
      </div>
    `;
  }).join('');
}

async function loadBackgroundLog() {
  if (!window.inzhurShell?.getAutomationLog) return;
  const entries = await window.inzhurShell.getAutomationLog(80);
  renderBackgroundLog(entries);
}

function openOtpModal(payload) {
  otpRunId = payload.runId;
  const modal = document.getElementById('otp-modal');
  const context = document.getElementById('otp-modal-context');
  const errorEl = document.getElementById('otp-modal-error');
  const codeInput = document.getElementById('otp-code');
  if (!modal || !context) return;
  context.textContent = `Купівля ${payload.isin}. Код надіслано на email або телефон (замовлення #${payload.orderId || '—'}).`;
  if (errorEl) errorEl.hidden = true;
  if (codeInput) {
    codeInput.value = '';
    codeInput.focus();
  }
  modal.classList.add('open');
}

function closeOtpModal() {
  const modal = document.getElementById('otp-modal');
  if (modal) modal.classList.remove('open');
  otpRunId = null;
}

function wireAutomationPanel() {
  if (!window.inzhurShell) return;

  document.getElementById('btn-otp-submit')?.addEventListener('click', async () => {
    const code = document.getElementById('otp-code')?.value.trim();
    const errorEl = document.getElementById('otp-modal-error');
    const otpSubmitBtn = document.getElementById('btn-otp-submit');
    if (!otpRunId || !code) return;
    otpSubmitBtn.disabled = true;
    try {
      await window.inzhurShell.submitAutomationOtp(otpRunId, code);
      if (errorEl) errorEl.hidden = true;
      closeOtpModal();
    } catch (err) {
      if (errorEl) {
        errorEl.hidden = false;
        errorEl.textContent = err.message;
      }
    } finally {
      otpSubmitBtn.disabled = false;
    }
  });

  document.getElementById('btn-otp-cancel')?.addEventListener('click', async () => {
    if (otpRunId) {
      await window.inzhurShell.cancelAutomationOtp(otpRunId);
    }
    closeOtpModal();
  });

  document.getElementById('btn-clear-background-log')?.addEventListener('click', async () => {
    await window.inzhurShell.clearAutomationLog();
    renderBackgroundLog([]);
  });

  window.inzhurShell.onAutomationOtpRequest(openOtpModal);
  window.inzhurShell.onAutomationLog(renderBackgroundLog);
  loadBackgroundLog();
}

wireAutomationPanel();

window.wireAutomationPanel = wireAutomationPanel;
window.ensureAutomationPanel = loadBackgroundLog;
window.loadAutomationData = loadBackgroundLog;
window.initAutomationPanel = loadBackgroundLog;
window.renderBackgroundLog = renderBackgroundLog;
