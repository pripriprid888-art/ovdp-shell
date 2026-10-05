const fs = require('fs');
const path = require('path');
const { app } = require('electron');
const { fetchDepoSecurities } = require('./nbu/depo-securities');

const STORE_FILE = 'nbu-reference.json';
const DEFAULT_MAX_AGE_MS = 24 * 60 * 60 * 1000;

/** @type {object|null} */
let memoryStore = null;

function getStorePath() {
  return path.join(app.getPath('userData'), STORE_FILE);
}

function emptyStore() {
  return {
    source_url: null,
    fetched_at: null,
    count: 0,
    records: [],
    by_isin: {},
  };
}

function normalizeStore(raw) {
  if (!raw || typeof raw !== 'object') return emptyStore();

  const records = Array.isArray(raw.records) ? raw.records : [];
  const byIsin = raw.by_isin && typeof raw.by_isin === 'object'
    ? raw.by_isin
    : Object.fromEntries(records.filter((entry) => entry?.isin).map((entry) => [entry.isin, entry]));

  return {
    source_url: raw.source_url || null,
    fetched_at: raw.fetched_at || null,
    count: Number.isFinite(raw.count) ? raw.count : records.length,
    records,
    by_isin: byIsin,
  };
}

function readStoreFromDisk() {
  try {
    const raw = fs.readFileSync(getStorePath(), 'utf8');
    return normalizeStore(JSON.parse(raw));
  } catch {
    return emptyStore();
  }
}

function loadReference() {
  if (memoryStore) return memoryStore;
  memoryStore = readStoreFromDisk();
  return memoryStore;
}

function saveReference(store) {
  memoryStore = normalizeStore(store);
  const targetPath = getStorePath();
  const tempPath = `${targetPath}.tmp`;
  fs.writeFileSync(tempPath, JSON.stringify(memoryStore, null, 2), 'utf8');
  fs.renameSync(tempPath, targetPath);
  return memoryStore;
}

function getSnapshot() {
  const store = loadReference();
  return {
    source_url: store.source_url,
    fetched_at: store.fetched_at,
    count: store.count,
    by_isin: store.by_isin,
  };
}

function isStale(maxAgeMs = DEFAULT_MAX_AGE_MS) {
  const store = loadReference();
  if (!store.fetched_at || !store.count) return true;
  const age = Date.now() - Date.parse(store.fetched_at);
  return !Number.isFinite(age) || age >= maxAgeMs;
}

async function refreshReference() {
  const fetched = await fetchDepoSecurities();
  return saveReference(fetched);
}

module.exports = {
  loadReference,
  saveReference,
  getSnapshot,
  isStale,
  refreshReference,
  DEFAULT_MAX_AGE_MS,
};
