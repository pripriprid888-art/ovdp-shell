const fs = require('fs');
const path = require('path');

function parseEnvLine(line) {
  const trimmed = String(line || '').trim();
  if (!trimmed || trimmed.startsWith('#')) return null;
  const eq = trimmed.indexOf('=');
  if (eq <= 0) return null;
  const key = trimmed.slice(0, eq).trim();
  let value = trimmed.slice(eq + 1).trim();
  if (
    (value.startsWith('"') && value.endsWith('"'))
    || (value.startsWith("'") && value.endsWith("'"))
  ) {
    value = value.slice(1, -1);
  }
  return { key, value };
}

function loadEnvFile(filePath, { overrideEmptyOnly = true } = {}) {
  if (!fs.existsSync(filePath)) return false;
  const text = fs.readFileSync(filePath, 'utf8');
  for (const line of text.split(/\r?\n/)) {
    const entry = parseEnvLine(line);
    if (!entry) continue;
    if (overrideEmptyOnly) {
      if (process.env[entry.key] == null || process.env[entry.key] === '') {
        process.env[entry.key] = entry.value;
      }
    } else {
      process.env[entry.key] = entry.value;
    }
  }
  return true;
}

function tryGetElectronApp() {
  try {
    return require('electron').app;
  } catch {
    return null;
  }
}

function bundledEnvPaths() {
  const app = tryGetElectronApp();
  if (!app?.isPackaged || !process.resourcesPath) return [];
  return [
    path.join(process.resourcesPath, '.env'),
    path.join(process.resourcesPath, '.env.local'),
  ];
}

function devEnvPaths(root) {
  return [
    path.join(process.cwd(), '.env'),
    path.join(root, '.env'),
    path.join(process.cwd(), '.env.local'),
    path.join(root, '.env.local'),
  ];
}

function loadDotEnv() {
  const root = path.join(__dirname, '..', '..');
  const seen = new Set();
  const files = [...bundledEnvPaths(), ...devEnvPaths(root)].filter((filePath) => {
    if (seen.has(filePath)) return false;
    seen.add(filePath);
    return true;
  });

  let loaded = null;
  for (const filePath of files) {
    if (loadEnvFile(filePath)) loaded = filePath;
  }
  return loaded;
}

module.exports = {
  loadDotEnv,
  bundledEnvPaths,
  devEnvPaths,
  loadEnvFile,
};
