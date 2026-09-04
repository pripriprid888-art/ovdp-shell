const fs = require('fs');
const path = require('path');
const { app } = require('electron');
const { listSiteIds } = require('./sites/config');

const STORE_FILE = 'securities.json';
const LEGACY_FILE = 'inzhur-securities.json';

/** @type {Record<string, object>|null} */
let memoryStore = null;

function getStorePath() {
  return path.join(app.getPath('userData'), STORE_FILE);
}

function getLegacyPath() {
  return path.join(app.getPath('userData'), LEGACY_FILE);
}

function emptySite() {
  return {
    proposals: [],
    holdings: [],
    orders: [],
    account: null,
    scanned_at: null,
    holdings_scanned_at: null,
    orders_scanned_at: null,
  };
}

function emptyStore() {
  return Object.fromEntries(listSiteIds().map((siteId) => [siteId, emptySite()]));
}

function normalizeSite(rawSite = {}) {
  return {
    proposals: rawSite.proposals || [],
    holdings: rawSite.holdings || [],
    orders: rawSite.orders || [],
    account: rawSite.account || null,
    scanned_at: rawSite.scanned_at || null,
    holdings_scanned_at: rawSite.holdings_scanned_at || null,
    orders_scanned_at: rawSite.orders_scanned_at || null,
  };
}

function normalizeStore(raw) {
  const store = emptyStore();
  if (!raw) return store;

  for (const siteId of listSiteIds()) {
    if (raw[siteId]) {
      store[siteId] = normalizeSite(raw[siteId]);
    }
  }

  if (Array.isArray(raw?.proposals) && !raw.inzhur && !raw.univer) {
    store.inzhur = {
      ...store.inzhur,
      proposals: raw.proposals,
      scanned_at: raw.scanned_at || null,
    };
  }

  return store;
}

function readStoreFromDisk() {
  try {
    const raw = fs.readFileSync(getStorePath(), 'utf8');
    return normalizeStore(JSON.parse(raw));
  } catch {
    try {
      const legacy = fs.readFileSync(getLegacyPath(), 'utf8');
      return normalizeStore(JSON.parse(legacy));
    } catch {
      return normalizeStore(null);
    }
  }
}

function loadStore() {
  if (memoryStore) return memoryStore;
  memoryStore = readStoreFromDisk();
  return memoryStore;
}

function saveStore(store) {
  memoryStore = store;
  const targetPath = getStorePath();
  const tempPath = `${targetPath}.tmp`;
  const payload = JSON.stringify(store, null, 2);
  fs.writeFileSync(tempPath, payload, 'utf8');
  fs.renameSync(tempPath, targetPath);
  return store;
}

function saveSiteSecurities(siteId, proposals) {
  const store = loadStore();
  store[siteId] = {
    ...normalizeSite(store[siteId]),
    proposals,
    scanned_at: new Date().toISOString(),
  };
  saveStore(store);
  return store[siteId];
}

function saveSiteHoldings(siteId, holdings) {
  const store = loadStore();
  store[siteId] = {
    ...normalizeSite(store[siteId]),
    holdings,
    holdings_scanned_at: new Date().toISOString(),
  };
  saveStore(store);
  return store[siteId];
}

function saveSiteOrders(siteId, orders) {
  const store = loadStore();
  store[siteId] = {
    ...normalizeSite(store[siteId]),
    orders,
    orders_scanned_at: new Date().toISOString(),
  };
  saveStore(store);
  return store[siteId];
}

function saveSiteAccountInfo(siteId, accountInfo) {
  const store = loadStore();
  store[siteId] = {
    ...normalizeSite(store[siteId]),
    account: {
      ...accountInfo,
      scanned_at: new Date().toISOString(),
    },
  };
  saveStore(store);
  return store[siteId];
}

function getSecurities(siteFilter = 'all', listKind = 'catalog') {
  const store = loadStore();

  function pickList(siteId) {
    const site = normalizeSite(store[siteId]);
    if (listKind === 'holdings') return site.holdings;
    if (listKind === 'orders') return site.orders;
    if (listKind === 'all') return [...site.proposals, ...site.holdings, ...site.orders];
    return site.proposals;
  }

  if (siteFilter === 'all') {
    const proposals = listSiteIds().flatMap((siteId) => pickList(siteId));
    return {
      siteFilter,
      listKind,
      proposals,
      ...store,
      scanned_at: latestScanTime(store, 'scanned_at'),
      holdings_scanned_at: latestScanTime(store, 'holdings_scanned_at'),
      orders_scanned_at: latestScanTime(store, 'orders_scanned_at'),
    };
  }

  const site = normalizeSite(store[siteFilter]);
  const proposals = pickList(siteFilter);
  const scannedAtField = listKind === 'holdings'
    ? 'holdings_scanned_at'
    : listKind === 'orders'
      ? 'orders_scanned_at'
      : 'scanned_at';
  return {
    siteFilter,
    listKind,
    proposals,
    ...store,
    scanned_at: site[scannedAtField],
    holdings_scanned_at: site.holdings_scanned_at,
    orders_scanned_at: site.orders_scanned_at,
  };
}

function latestScanTime(store, field = 'scanned_at') {
  const times = listSiteIds()
    .map((siteId) => store[siteId]?.[field])
    .filter(Boolean);
  if (!times.length) return null;
  return times.sort().at(-1);
}

function hasCachedLists(store = loadStore()) {
  return listSiteIds().some((siteId) => {
    const site = normalizeSite(store[siteId]);
    return site.proposals.length > 0 || site.holdings.length > 0 || site.orders.length > 0;
  });
}

module.exports = {
  loadStore,
  saveSiteSecurities,
  saveSiteHoldings,
  saveSiteOrders,
  saveSiteAccountInfo,
  getSecurities,
  hasCachedLists,
};
