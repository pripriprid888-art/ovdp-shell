/** Renderer-side cache mirror for catalog / portfolio / orders lists. */

const LIST_CACHE_KEY = 'ovdp-shell-list-cache';

function readListCacheStore() {
  try {
    const raw = localStorage.getItem(LIST_CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return null;
    return parsed;
  } catch {
    return null;
  }
}

function writeListCacheEntry(listKind, data) {
  if (!listKind || !data) return;
  try {
    const store = readListCacheStore() || { entries: {}, savedAt: null };
    store.entries[listKind] = {
      listKind,
      proposals: Array.isArray(data.proposals) ? data.proposals : [],
      scanned_at: data.scanned_at || null,
      holdings_scanned_at: data.holdings_scanned_at || null,
      orders_scanned_at: data.orders_scanned_at || null,
      inzhur: data.inzhur || null,
      univer: data.univer || null,
      privat: data.privat || null,
      savedAt: new Date().toISOString(),
    };
    store.savedAt = store.entries[listKind].savedAt;
    localStorage.setItem(LIST_CACHE_KEY, JSON.stringify(store));
  } catch {
    // localStorage full or unavailable
  }
}

function readListCacheEntry(listKind) {
  const store = readListCacheStore();
  const entry = store?.entries?.[listKind];
  if (!entry) return null;
  return {
    siteFilter: 'all',
    listKind,
    proposals: entry.proposals || [],
    scanned_at: entry.scanned_at || null,
    holdings_scanned_at: entry.holdings_scanned_at || null,
    orders_scanned_at: entry.orders_scanned_at || null,
    inzhur: entry.inzhur || {},
    univer: entry.univer || {},
    privat: entry.privat || {},
    fromCache: true,
  };
}

window.ListCache = {
  readListCacheEntry,
  writeListCacheEntry,
  readListCacheStore,
};
