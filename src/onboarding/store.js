const fs = require('fs');
const path = require('path');
const { app } = require('electron');

const STORE_FILE = 'onboarding.json';
const SITE_IDS = ['inzhur', 'univer', 'privat'];

function getStorePath() {
  return path.join(app.getPath('userData'), STORE_FILE);
}

function defaultSiteState() {
  return {
    inzhur: { enabled: false, username: '' },
    univer: { enabled: false, username: '' },
    privat: {
      enabled: false,
      username: '',
      paymentAccounts: '',
      lastPaymentAccount: '',
    },
  };
}

function mergeSites(rawSites = {}) {
  const defaults = defaultSiteState();
  return Object.fromEntries(SITE_IDS.map((siteId) => [
    siteId,
    { ...defaults[siteId], ...(rawSites[siteId] || {}) },
  ]));
}

function readRaw() {
  const filePath = getStorePath();
  if (!fs.existsSync(filePath)) {
    return { completed: false, sites: defaultSiteState() };
  }
  try {
    const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    return {
      completed: Boolean(data.completed),
      sites: mergeSites(data.sites),
    };
  } catch {
    return { completed: false, sites: defaultSiteState() };
  }
}

function writeRaw(data) {
  fs.writeFileSync(getStorePath(), JSON.stringify(data, null, 2), 'utf8');
}

function getOnboardingState() {
  const data = readRaw();
  return {
    completed: data.completed,
    sites: data.sites,
    enabledSites: SITE_IDS.filter((id) => data.sites[id]?.enabled),
  };
}

function setSiteConfig(siteId, { enabled, username, paymentAccounts, lastPaymentAccount } = {}) {
  if (!SITE_IDS.includes(siteId)) return getOnboardingState();
  const data = readRaw();
  data.sites[siteId] = {
    ...data.sites[siteId],
    ...(enabled !== undefined ? { enabled: Boolean(enabled) } : {}),
    ...(username !== undefined ? { username: String(username || '').trim() } : {}),
    ...(paymentAccounts !== undefined ? { paymentAccounts: String(paymentAccounts || '').trim() } : {}),
    ...(lastPaymentAccount !== undefined ? { lastPaymentAccount: String(lastPaymentAccount || '').trim() } : {}),
  };
  writeRaw(data);
  return getOnboardingState();
}

function setOnboardingCompleted(completed = true) {
  const data = readRaw();
  data.completed = Boolean(completed);
  writeRaw(data);
  return getOnboardingState();
}

function resetOnboarding() {
  writeRaw({ completed: false, sites: defaultSiteState() });
  return getOnboardingState();
}

module.exports = {
  SITE_IDS,
  getOnboardingState,
  setSiteConfig,
  setOnboardingCompleted,
  resetOnboarding,
};
