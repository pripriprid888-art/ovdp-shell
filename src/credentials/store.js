const { safeStorage } = require('electron');
const fs = require('fs');
const path = require('path');
const { app } = require('electron');
const { listSiteIds } = require('../sites/config');

const STORE_FILE = 'credentials.dat';
const BACKUP_FILE = 'credentials.dat.bak';
const INDEX_FILE = 'credentials-index.json';
const SITE_IDS = listSiteIds();

let storeStatus = {
  state: 'ok',
  message: '',
};

function getStorePath() {
  return path.join(app.getPath('userData'), STORE_FILE);
}

function getBackupPath() {
  return path.join(app.getPath('userData'), BACKUP_FILE);
}

function getIndexPath() {
  return path.join(app.getPath('userData'), INDEX_FILE);
}

function normalizePhone(value) {
  const digits = String(value || '').replace(/\D/g, '');
  if (!digits) return '';
  if (digits.startsWith('380') && digits.length >= 12) return digits.slice(0, 12);
  if (digits.startsWith('80') && digits.length >= 11) return `3${digits.slice(0, 11)}`;
  if (digits.length === 10 && digits.startsWith('0')) return `38${digits}`;
  if (digits.length === 9) return `380${digits}`;
  return digits;
}

function accountKey(username) {
  return normalizePhone(username) || String(username || '').trim().toLowerCase();
}

function displayUsername(username) {
  const key = accountKey(username);
  if (key.startsWith('380')) return `+${key}`;
  return String(username || '').trim();
}

function emptySites() {
  return Object.fromEntries(SITE_IDS.map((siteId) => [siteId, []]));
}

function aliasToSiteId(alias) {
  const value = String(alias || '').toLowerCase();
  if (value.includes('inzhur')) return 'inzhur';
  if (value.includes('univer')) return 'univer';
  if (value.includes('privat') || value.includes('приват')) return 'privat';
  return null;
}

function sortSiteEntries(entries) {
  return [...entries].sort((a, b) => String(b.savedAt || '').localeCompare(String(a.savedAt || '')));
}

function normalizeRaw(raw) {
  if (raw?.version === 2 && raw.sites) {
    const sites = emptySites();
    for (const siteId of SITE_IDS) {
      sites[siteId] = sortSiteEntries(raw.sites[siteId] || []);
    }
    return { version: 2, sites };
  }

  const sites = emptySites();
  for (const account of raw?.accounts || []) {
    const siteId = aliasToSiteId(account.alias);
    if (!siteId) continue;
    sites[siteId].push({
      username: displayUsername(account.username),
      password: account.password || '',
      savedAt: account.savedAt || new Date(0).toISOString(),
    });
  }

  for (const siteId of SITE_IDS) {
    const seen = new Set();
    sites[siteId] = sortSiteEntries(sites[siteId]).filter((entry) => {
      const key = accountKey(entry.username);
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  return { version: 2, sites };
}

function readUsernameIndex() {
  const filePath = getIndexPath();
  if (!fs.existsSync(filePath)) {
    return { version: 1, sites: emptySites() };
  }
  try {
    const raw = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    const sites = emptySites();
    for (const siteId of SITE_IDS) {
      sites[siteId] = sortSiteEntries(raw.sites?.[siteId] || []).map((entry) => ({
        username: displayUsername(entry.username),
        savedAt: entry.savedAt || null,
      })).filter((entry) => entry.username);
    }
    return { version: 1, sites };
  } catch {
    return { version: 1, sites: emptySites() };
  }
}

function writeUsernameIndex(data) {
  const index = { version: 1, sites: emptySites() };
  for (const siteId of SITE_IDS) {
    index.sites[siteId] = sortSiteEntries(data.sites[siteId] || []).map(({ username, savedAt }) => ({
      username,
      savedAt: savedAt || null,
    }));
  }
  fs.writeFileSync(getIndexPath(), JSON.stringify(index, null, 2), 'utf8');
}

function parseEncodedPayload(encoded) {
  if (!encoded?.length) return null;

  if (safeStorage.isEncryptionAvailable()) {
    try {
      return JSON.parse(safeStorage.decryptString(encoded));
    } catch {
      // fall through to legacy/base64 attempt
    }
  }

  try {
    return JSON.parse(Buffer.from(encoded.toString(), 'base64').toString('utf8'));
  } catch {
    return null;
  }
}

function readRawFromFile(filePath) {
  if (!fs.existsSync(filePath)) return null;
  return parseEncodedPayload(fs.readFileSync(filePath));
}

function markStoreCorrupt(message) {
  storeStatus = {
    state: 'corrupt',
    message: message || 'Збережені паролі недоступні — macOS не може їх розшифрувати. Введіть дані заново і натисніть «Зберегти».',
  };
}

function readRaw() {
  const filePath = getStorePath();
  if (!fs.existsSync(filePath)) {
    storeStatus = { state: 'empty', message: '' };
    return normalizeRaw({});
  }

  let parsed = readRawFromFile(filePath);
  if (parsed) {
    storeStatus = { state: 'ok', message: '' };
    return normalizeRaw(parsed);
  }

  parsed = readRawFromFile(getBackupPath());
  if (parsed) {
    const normalized = normalizeRaw(parsed);
    writeRaw(normalized);
    storeStatus = {
      state: 'recovered',
      message: 'Облікові дані відновлено з резервної копії.',
    };
    return normalized;
  }

  markStoreCorrupt();
  return normalizeRaw({});
}

function writeRaw(data) {
  const payload = JSON.stringify(data);
  const filePath = getStorePath();

  if (fs.existsSync(filePath)) {
    try {
      fs.copyFileSync(filePath, getBackupPath());
    } catch {
      // backup is best-effort
    }
  }

  if (safeStorage.isEncryptionAvailable()) {
    fs.writeFileSync(filePath, safeStorage.encryptString(payload));
  } else {
    fs.writeFileSync(filePath, Buffer.from(payload, 'utf8').toString('base64'), 'utf8');
  }

  writeUsernameIndex(data);
  storeStatus = { state: 'ok', message: '' };
}

function indexFallbackEntries(siteId) {
  if (storeStatus.state !== 'corrupt') return [];
  const index = readUsernameIndex();
  return sortSiteEntries(index.sites[siteId] || []).map(({ username, savedAt }) => ({
    username,
    password: '',
    savedAt,
  }));
}

function listSiteCredentials(siteId) {
  if (!SITE_IDS.includes(siteId)) return [];
  const data = readRaw();
  const entries = sortSiteEntries(data.sites[siteId] || []);
  if (entries.length) {
    return entries.map(({ username, password, savedAt }) => ({
      username,
      password: password || '',
      savedAt,
    }));
  }
  return indexFallbackEntries(siteId);
}

function getStoreStatus() {
  readRaw();
  return { ...storeStatus };
}

function getLatestSiteCredentials(siteId) {
  const entries = listSiteCredentials(siteId);
  return entries[0] || null;
}

function getSiteCredentials(siteId, username) {
  if (!SITE_IDS.includes(siteId)) return null;
  const key = accountKey(username);
  if (!key) return null;
  const entry = listSiteCredentials(siteId).find((item) => accountKey(item.username) === key);
  if (!entry) return null;
  return {
    username: entry.username,
    password: entry.password || '',
  };
}

function saveSiteCredentials(siteId, username, password) {
  if (!SITE_IDS.includes(siteId)) {
    throw new Error(`Unknown site: ${siteId}`);
  }
  const key = accountKey(username);
  if (!key) throw new Error('Вкажіть телефон або логін');

  let data = readRaw();
  if (storeStatus.state === 'corrupt') {
    data = normalizeRaw({});
  }

  const list = data.sites[siteId] || [];
  const now = new Date().toISOString();
  const entry = {
    username: displayUsername(username),
    password: password || '',
    savedAt: now,
  };

  const existingIndex = list.findIndex((item) => accountKey(item.username) === key);
  if (existingIndex >= 0) {
    list.splice(existingIndex, 1);
  }
  list.unshift(entry);
  data.sites[siteId] = list;
  writeRaw(data);
  return entry;
}

function deleteSiteCredentials(siteId, username) {
  if (!SITE_IDS.includes(siteId)) {
    throw new Error(`Unknown site: ${siteId}`);
  }
  const key = accountKey(username);
  const data = readRaw();
  const next = (data.sites[siteId] || []).filter((item) => accountKey(item.username) !== key);
  if (next.length === (data.sites[siteId] || []).length) {
    throw new Error('Обліковий запис не знайдено');
  }
  data.sites[siteId] = next;
  writeRaw(data);

  const index = readUsernameIndex();
  index.sites[siteId] = (index.sites[siteId] || []).filter(
    (item) => accountKey(item.username) !== key,
  );
  fs.writeFileSync(getIndexPath(), JSON.stringify(index, null, 2), 'utf8');
}

function listCredentials() {
  return SITE_IDS.flatMap((siteId) =>
    listSiteCredentials(siteId).map(({ username, savedAt }) => ({
      siteId,
      username,
      alias: siteId,
      displayName: username,
      savedAt,
    })),
  );
}

function getCredentials(username) {
  const key = accountKey(username);
  for (const siteId of SITE_IDS) {
    const entry = getSiteCredentials(siteId, key);
    if (entry) return entry;
  }
  return null;
}

function getDefaultCredentials() {
  for (const siteId of SITE_IDS) {
    const latest = getLatestSiteCredentials(siteId);
    if (latest) {
      return {
        username: latest.username,
        password: latest.password || '',
      };
    }
  }
  return null;
}

function saveCredentials(username, password, alias = '') {
  const siteId = aliasToSiteId(alias);
  if (!siteId) {
    throw new Error('Вкажіть платформу для збереження облікових даних');
  }
  return saveSiteCredentials(siteId, username, password);
}

function deleteCredentials(username) {
  const key = accountKey(username);
  const data = readRaw();
  let removed = false;
  for (const siteId of SITE_IDS) {
    const before = data.sites[siteId].length;
    data.sites[siteId] = data.sites[siteId].filter((item) => accountKey(item.username) !== key);
    if (data.sites[siteId].length !== before) removed = true;
  }
  if (!removed) throw new Error('Обліковий запис не знайдено');
  writeRaw(data);
}

function resolveCredentials(siteId, username) {
  if (username) {
    return getSiteCredentials(siteId, username);
  }
  return getLatestSiteCredentials(siteId);
}

module.exports = {
  listSiteCredentials,
  getLatestSiteCredentials,
  getSiteCredentials,
  saveSiteCredentials,
  deleteSiteCredentials,
  resolveCredentials,
  listCredentials,
  getCredentials,
  getDefaultCredentials,
  saveCredentials,
  deleteCredentials,
  getStoreStatus,
  normalizePhone,
  accountKey,
};
