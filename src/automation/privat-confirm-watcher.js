const automationLog = require('./logger');
const { detectPrivatConfirmMessage } = require('./privat-confirm-detect');

const POLL_MS = 1500;

/** @type {{ timer: ReturnType<typeof setInterval>, lastMessage: string } | null} */
let activeWatcher = null;

function stopPrivatConfirmWatcher() {
  if (!activeWatcher) return;
  clearInterval(activeWatcher.timer);
  activeWatcher = null;
}

function startPrivatConfirmWatcher(webContents, onProgress) {
  stopPrivatConfirmWatcher();
  if (!webContents || webContents.isDestroyed()) return stopPrivatConfirmWatcher;

  activeWatcher = {
    timer: null,
    lastMessage: '',
  };

  const tick = async () => {
    if (!webContents || webContents.isDestroyed()) {
      stopPrivatConfirmWatcher();
      return;
    }
    const message = await detectPrivatConfirmMessage(webContents, 'buy');
    if (!message || message.message === activeWatcher.lastMessage) return;

    activeWatcher.lastMessage = message.message;
    automationLog.push('warning', 'privat', message.message);
    onProgress?.({ siteId: 'privat', step: message.message });
  };

  activeWatcher.timer = setInterval(() => {
    tick().catch(() => {});
  }, POLL_MS);
  tick().catch(() => {});

  return stopPrivatConfirmWatcher;
}

module.exports = {
  startPrivatConfirmWatcher,
  stopPrivatConfirmWatcher,
};
