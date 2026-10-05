const { safeStorage, app } = require('electron');
const fs = require('fs');
const path = require('path');

const TOKEN_FILE = 'gmail-oauth.dat';
const META_FILE = 'gmail-oauth-meta.json';

function getTokenPath() {
  return path.join(app.getPath('userData'), TOKEN_FILE);
}

function getMetaPath() {
  return path.join(app.getPath('userData'), META_FILE);
}

function readMeta() {
  try {
    const raw = JSON.parse(fs.readFileSync(getMetaPath(), 'utf8'));
    return {
      email: raw.email || null,
      connectedAt: raw.connectedAt || null,
    };
  } catch {
    return { email: null, connectedAt: null };
  }
}

function writeMeta(meta) {
  fs.writeFileSync(getMetaPath(), JSON.stringify(meta, null, 2), 'utf8');
}

function readTokens() {
  const filePath = getTokenPath();
  if (!fs.existsSync(filePath)) return null;

  try {
    const raw = fs.readFileSync(filePath);
    if (safeStorage.isEncryptionAvailable()) {
      const decrypted = safeStorage.decryptString(raw);
      return JSON.parse(decrypted);
    }
    return JSON.parse(raw.toString('utf8'));
  } catch {
    return null;
  }
}

function writeTokens(tokens) {
  const payload = JSON.stringify(tokens);
  const filePath = getTokenPath();
  if (safeStorage.isEncryptionAvailable()) {
    fs.writeFileSync(filePath, safeStorage.encryptString(payload));
  } else {
    fs.writeFileSync(filePath, payload, 'utf8');
  }
}

function clearTokens() {
  for (const filePath of [getTokenPath(), getMetaPath()]) {
    try {
      if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    } catch {
      // ignore
    }
  }
}

function isConnected() {
  const tokens = readTokens();
  return Boolean(tokens?.refresh_token || tokens?.access_token);
}

function getStatus() {
  const meta = readMeta();
  return {
    connected: isConnected(),
    email: meta.email,
    connectedAt: meta.connectedAt,
  };
}

function saveOAuthResult(tokenResponse, email) {
  writeTokens({
    access_token: tokenResponse.access_token,
    refresh_token: tokenResponse.refresh_token || readTokens()?.refresh_token || null,
    scope: tokenResponse.scope,
    token_type: tokenResponse.token_type,
    expiry_date: tokenResponse.expires_in
      ? Date.now() + Number(tokenResponse.expires_in) * 1000
      : null,
  });
  writeMeta({
    email: email || readMeta().email,
    connectedAt: new Date().toISOString(),
  });
}

module.exports = {
  readTokens,
  writeTokens,
  clearTokens,
  isConnected,
  getStatus,
  saveOAuthResult,
};
