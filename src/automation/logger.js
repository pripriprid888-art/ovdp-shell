const logStore = require('./log-store');

/** @type {(() => void) | null} */
let broadcastFn = null;

/** @type {string[]} */
const runStack = [];

let consoleMirrorInstalled = false;
let mirroringConsole = false;

const originalConsole = {
  warn: console.warn.bind(console),
  error: console.error.bind(console),
  log: console.log.bind(console),
};

function isDebugEnabled() {
  const value = String(process.env.OVDP_DEBUG || '').trim().toLowerCase();
  return value === '1' || value === 'true' || value === 'yes';
}

function setBroadcast(fn) {
  broadcastFn = fn;
}

function init() {
  logStore.initLogStore();
}

function createRunId(prefix = 'run') {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
}

function currentRunId() {
  return runStack.length ? runStack[runStack.length - 1] : null;
}

function beginRun(runId) {
  if (runId) runStack.push(runId);
  return runId;
}

function endRun() {
  runStack.pop();
}

async function withRun(runId, fn) {
  beginRun(runId);
  try {
    return await fn(runId);
  } finally {
    endRun();
  }
}

function serializeError(err) {
  if (err == null) return null;
  if (typeof err === 'string') return { name: 'Error', message: err, stack: null, code: null, cause: null };
  return {
    name: err.name || 'Error',
    message: err.message || String(err),
    stack: err.stack || null,
    code: err.code ?? err.errorCode ?? null,
    cause: err.cause ? serializeError(err.cause) : null,
  };
}

function normalizeLogOptions(options) {
  if (options == null) return {};
  if (typeof options === 'string') return { category: options };
  return options;
}

function sanitizeContext(context) {
  if (!context || typeof context !== 'object') return null;
  try {
    return JSON.parse(JSON.stringify(context));
  } catch {
    return { note: String(context) };
  }
}

function mirrorToConsole(level, siteId, message, entry) {
  if (!isDebugEnabled() && level !== 'error' && level !== 'warning') return;
  const prefix = `[${level}${siteId ? `:${siteId}` : ''}${entry.category ? `:${entry.category}` : ''}]`;
  const line = `${prefix} ${message}`;
  if (level === 'error') {
    originalConsole.error(line, entry.error || '');
    return;
  }
  if (level === 'warning') {
    originalConsole.warn(line);
    return;
  }
  originalConsole.log(line);
}

function push(level, siteId, message, kind = 'automation', options = {}) {
  const opts = normalizeLogOptions(options);
  const entry = logStore.appendEntry({
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    at: new Date().toISOString(),
    level,
    siteId: siteId || null,
    message: String(message || ''),
    kind,
    category: opts.category || null,
    runId: opts.runId ?? currentRunId(),
    context: sanitizeContext(opts.context),
    error: opts.error ? serializeError(opts.error) : null,
  });
  mirrorToConsole(level, siteId, message, entry);
  broadcastFn?.();
  return entry;
}

function pushBackground(level, siteId, message, options = {}) {
  return push(level, siteId, message, 'background', options);
}

function pushDebug(siteId, message, options = {}) {
  if (!isDebugEnabled()) return null;
  return push('debug', siteId, message, 'background', options);
}

function logError(siteId, message, err, options = {}) {
  const opts = normalizeLogOptions(options);
  return push('error', siteId, message, opts.kind || 'background', {
    ...opts,
    error: err,
  });
}

function getLogs(options = {}) {
  if (typeof options === 'number') {
    return logStore.getLogs({ limit: options, includeDebug: isDebugEnabled() });
  }
  return logStore.getLogs({
    includeDebug: isDebugEnabled(),
    ...options,
  });
}

function getLogDates() {
  return logStore.getLogDates();
}

function clearLocalLogs() {
  logStore.clearLocalLogs();
  broadcastFn?.();
}

function clearLogs() {
  clearLocalLogs();
}

function formatConsoleArgs(args) {
  return args.map((arg) => {
    if (arg instanceof Error) return arg.message;
    if (typeof arg === 'object') {
      try {
        return JSON.stringify(arg);
      } catch {
        return String(arg);
      }
    }
    return String(arg);
  }).join(' ');
}

function shouldMirrorConsoleMessage(message) {
  const text = String(message || '').trim();
  if (!text) return false;
  // Ignore our own journal mirror lines to prevent feedback loops.
  if (/^\[(?:info|warning|error|debug):/i.test(text)) return false;
  return true;
}

function installConsoleMirror() {
  if (consoleMirrorInstalled) return;
  consoleMirrorInstalled = true;

  console.warn = (...args) => {
    originalConsole.warn(...args);
    if (mirroringConsole) return;

    const message = formatConsoleArgs(args);
    if (!shouldMirrorConsoleMessage(message)) return;

    mirroringConsole = true;
    try {
      pushBackground('warning', 'system', message, { category: 'system' });
    } finally {
      mirroringConsole = false;
    }
  };
}

module.exports = {
  init,
  push,
  pushBackground,
  pushDebug,
  logError,
  getLogs,
  getLogDates,
  clearLocalLogs,
  clearLogs,
  setBroadcast,
  isDebugEnabled,
  createRunId,
  currentRunId,
  withRun,
  beginRun,
  endRun,
  serializeError,
  installConsoleMirror,
};
