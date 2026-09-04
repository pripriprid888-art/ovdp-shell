const MAX_LOG = 120;
const logs = [];

/** @type {(() => void) | null} */
let broadcastFn = null;

function setBroadcast(fn) {
  broadcastFn = fn;
}

function push(level, siteId, message, kind = 'automation') {
  const entry = {
    id: `${Date.now()}-${logs.length}`,
    at: new Date().toISOString(),
    level,
    siteId: siteId || null,
    message,
    kind,
  };
  logs.unshift(entry);
  if (logs.length > MAX_LOG) logs.length = MAX_LOG;
  broadcastFn?.();
  return entry;
}

function pushBackground(level, siteId, message) {
  return push(level, siteId, message, 'background');
}

function getLogs(limit = 40) {
  return logs.slice(0, limit);
}

function clearLogs() {
  logs.length = 0;
}

module.exports = {
  push,
  pushBackground,
  getLogs,
  clearLogs,
  setBroadcast,
};
