const busySources = new Map();
const DEFAULT_MESSAGE = 'Виконується…';

function refreshBusyOverlay() {
  const overlay = document.getElementById('busy-overlay');
  const messageEl = document.getElementById('busy-overlay-message');
  if (!overlay) return;

  const active = busySources.size > 0;
  const messages = [...busySources.values()].filter(Boolean);
  const message = messages.length ? messages[messages.length - 1] : DEFAULT_MESSAGE;

  overlay.hidden = !active;
  overlay.setAttribute('aria-hidden', active ? 'false' : 'true');
  if (messageEl) messageEl.textContent = message;
  document.body.classList.toggle('busy-overlay-open', active);
}

function setBusyOverlay(key, active, message) {
  if (active) {
    busySources.set(key, message || DEFAULT_MESSAGE);
  } else {
    busySources.delete(key);
  }
  refreshBusyOverlay();
}

function updateBusyOverlay(key, message) {
  if (!busySources.has(key)) return;
  busySources.set(key, message || DEFAULT_MESSAGE);
  refreshBusyOverlay();
}

window.BusyOverlay = {
  set: setBusyOverlay,
  update: updateBusyOverlay,
};
