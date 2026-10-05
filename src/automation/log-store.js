const fs = require('fs');
const path = require('path');
const { app } = require('electron');
const logDb = require('./log-db');

const STORE_FILE = 'action-log.json';
const MAX_STORED = 5000;

/** @type {Array<object>|null} */
let logs = null;

function getStorePath() {
  return path.join(app.getPath('userData'), STORE_FILE);
}

function normalizeEntry(entry) {
  const normalized = {
    id: String(entry.id || `${Date.now()}-0`),
    at: entry.at || new Date().toISOString(),
    level: entry.level || 'info',
    siteId: entry.siteId || null,
    message: String(entry.message || ''),
    kind: entry.kind || 'automation',
    category: entry.category || null,
    runId: entry.runId || null,
    context: entry.context && typeof entry.context === 'object' ? entry.context : null,
    error: entry.error && typeof entry.error === 'object' ? entry.error : null,
  };
  return normalized;
}

function loadLogs() {
  if (logs) return logs;
  try {
    const raw = JSON.parse(fs.readFileSync(getStorePath(), 'utf8'));
    logs = Array.isArray(raw?.entries)
      ? raw.entries.map(normalizeEntry)
      : [];
  } catch {
    logs = [];
  }
  return logs;
}

function buildStorePayload() {
  return { version: 2, entries: loadLogs() };
}

function saveLogs() {
  const entries = loadLogs();
  if (entries.length > MAX_STORED) {
    logs = entries.slice(0, MAX_STORED);
  }
  const payload = buildStorePayload();
  const targetPath = getStorePath();
  const tempPath = `${targetPath}.tmp`;
  fs.writeFileSync(tempPath, JSON.stringify(payload, null, 2), 'utf8');
  fs.renameSync(tempPath, targetPath);
}

function localDateKey(iso) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function appendEntry(entry) {
  loadLogs();
  const normalized = normalizeEntry(entry);
  logs.unshift(normalized);
  if (logs.length > MAX_STORED) {
    logs.length = MAX_STORED;
  }
  saveLogs();
  logDb.insertEntryAsync(normalized);
  return normalized;
}

function getLogs(options = {}) {
  const {
    date,
    limit = 200,
    includeDebug = false,
    category,
    runId,
  } = options;

  let entries = loadLogs();

  if (!includeDebug) {
    entries = entries.filter((entry) => entry.level !== 'debug');
  }
  if (date) {
    entries = entries.filter((entry) => localDateKey(entry.at) === date);
  }
  if (category) {
    entries = entries.filter((entry) => entry.category === category);
  }
  if (runId) {
    entries = entries.filter((entry) => entry.runId === runId);
  }

  return entries.slice(0, Math.max(1, Number(limit) || 200));
}

function getLogDates() {
  const dates = new Set();
  for (const entry of loadLogs()) {
    const key = localDateKey(entry.at);
    if (key) dates.add(key);
  }
  return [...dates].sort((a, b) => b.localeCompare(a));
}

/** Clears the on-disk journal only. Postgres rows are never deleted (audit trail). */
function clearLocalLogs() {
  logs = [];
  saveLogs();
}

/** @deprecated Use clearLocalLogs — name kept for callers. */
function clearLogs() {
  clearLocalLogs();
}

function initLogStore() {
  loadLogs();
}

module.exports = {
  initLogStore,
  appendEntry,
  getLogs,
  getLogDates,
  clearLocalLogs,
  clearLogs,
  localDateKey,
  isLogDbConfigured: logDb.isLogDbConfigured,
};
