const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('inzhurShell', {
  navigate: (url) => ipcRenderer.invoke('navigate', url),
  goBack: () => ipcRenderer.invoke('go-back'),
  goForward: () => ipcRenderer.invoke('go-forward'),
  reload: () => ipcRenderer.invoke('reload'),
  goHome: () => ipcRenderer.invoke('go-home'),
  goCabinet: () => ipcRenderer.invoke('go-cabinet'),
  goSignin: () => ipcRenderer.invoke('go-signin'),
  goInzhurSignin: () => ipcRenderer.invoke('go-inzhur-signin'),
  goInzhurDashboard: () => ipcRenderer.invoke('go-inzhur-dashboard'),
  setInzhurOverlayCollapsed: (collapsed) =>
    ipcRenderer.invoke('set-inzhur-overlay-collapsed', collapsed),
  getInzhurOverlayState: () => ipcRenderer.invoke('get-inzhur-overlay-state'),
  setInzhurPageTheme: (themeId) => ipcRenderer.invoke('set-inzhur-page-theme', themeId),
  cycleInzhurPageTheme: () => ipcRenderer.invoke('cycle-inzhur-page-theme'),
  goUniverSignin: () => ipcRenderer.invoke('go-univer-signin'),
  goUniverCabinet: () => ipcRenderer.invoke('go-univer-cabinet'),
  goUniverPortfolio: () => ipcRenderer.invoke('go-univer-portfolio'),
  goCatalog: () => ipcRenderer.invoke('go-catalog'),
  goUniverCatalog: () => ipcRenderer.invoke('go-univer-catalog'),
  goPrivatCatalog: () => ipcRenderer.invoke('go-privat-catalog'),
  goPrivatBonds: () => ipcRenderer.invoke('go-privat-bonds'),
  openCatalog: (siteId) => ipcRenderer.invoke('open-catalog', siteId),
  switchSite: (siteId, url) => ipcRenderer.invoke('switch-site', siteId, url),
  toggleCalculator: () => ipcRenderer.invoke('toggle-calculator'),
  setPanelTab: (tabId) => ipcRenderer.invoke('set-panel-tab', tabId),
  openCabinetTab: (tabId) => ipcRenderer.invoke('open-cabinet-tab', tabId),
  setAppMode: (mode) => ipcRenderer.invoke('set-app-mode', mode),
  getAppMode: () => ipcRenderer.invoke('get-app-mode'),
  setManualTab: (tabId) => ipcRenderer.invoke('set-manual-tab', tabId),
  syncLayout: () => ipcRenderer.invoke('sync-layout'),
  getScanState: () => ipcRenderer.invoke('get-scan-state'),
  getPanelTab: () => ipcRenderer.invoke('get-panel-tab'),
  scanInzhurCatalog: () => ipcRenderer.invoke('scan-inzhur-catalog'),
  scanUniverCatalog: () => ipcRenderer.invoke('scan-univer-catalog'),
  scanPrivatCatalog: () => ipcRenderer.invoke('scan-privat-catalog'),
  scanAllCatalogs: () => ipcRenderer.invoke('scan-all-catalogs'),
  scanCatalog: (siteId) => ipcRenderer.invoke('scan-catalog', siteId),
  scanInzhurPortfolio: () => ipcRenderer.invoke('scan-inzhur-portfolio'),
  scanUniverPortfolio: () => ipcRenderer.invoke('scan-univer-portfolio'),
  scanUniverOrders: () => ipcRenderer.invoke('scan-univer-orders'),
  scanPrivatPortfolio: () => ipcRenderer.invoke('scan-privat-portfolio'),
  scanAllPortfolios: () => ipcRenderer.invoke('scan-all-portfolios'),
  scanPortfolio: (siteId) => ipcRenderer.invoke('scan-portfolio', siteId),
  getSecurities: (siteFilter, listKind) => ipcRenderer.invoke('get-securities', siteFilter, listKind),
  getSessionStates: () => ipcRenderer.invoke('get-session-states'),
  verifySession: (siteId) => ipcRenderer.invoke('verify-session', siteId),
  clearSession: (siteId) => ipcRenderer.invoke('clear-session', siteId),
  getActiveSite: () => ipcRenderer.invoke('get-active-site'),
  getBrowserLayoutState: () => ipcRenderer.invoke('get-browser-layout-state'),
  getHomeState: () => ipcRenderer.invoke('get-home-state'),
  getCabinetState: () => ipcRenderer.invoke('get-cabinet-state'),
  getOnboardingState: () => ipcRenderer.invoke('get-onboarding-state'),
  setOnboardingSite: (siteId, patch) => ipcRenderer.invoke('set-onboarding-site', siteId, patch),
  completeOnboarding: () => ipcRenderer.invoke('complete-onboarding'),
  resetOnboarding: () => ipcRenderer.invoke('reset-onboarding'),
  getAutomationSites: () => ipcRenderer.invoke('get-automation-sites'),
  getAutomationBusy: () => ipcRenderer.invoke('get-automation-busy'),
  listCredentials: () => ipcRenderer.invoke('list-credentials'),
  listSiteCredentials: (siteId) => ipcRenderer.invoke('list-site-credentials', siteId),
  getCredentialsStoreStatus: () => ipcRenderer.invoke('get-credentials-store-status'),
  saveCredentials: (username, password, alias) =>
    ipcRenderer.invoke('save-credentials', username, password, alias),
  saveSiteCredentials: (siteId, username, password) =>
    ipcRenderer.invoke('save-site-credentials', siteId, username, password),
  deleteCredentials: (username) => ipcRenderer.invoke('delete-credentials', username),
  deleteSiteCredentials: (siteId, username) =>
    ipcRenderer.invoke('delete-site-credentials', siteId, username),
  getAutomationLog: () => ipcRenderer.invoke('get-automation-log'),
  clearAutomationLog: () => ipcRenderer.invoke('clear-automation-log'),
  runSignIn: (siteId, mode, username, password) =>
    ipcRenderer.invoke('run-sign-in', siteId, mode, username, password),
  ensureSiteSignIn: (siteId) => ipcRenderer.invoke('ensure-site-sign-in', siteId),
  runPurchaseRoute: (siteId, isin, paymentAccount, options) =>
    ipcRenderer.invoke('run-purchase-route', siteId, isin, paymentAccount, options || {}),
  stopPrivatConfirmWatcher: () => ipcRenderer.invoke('stop-privat-confirm-watcher'),
  runUniverBuy: (isin, quantity) =>
    ipcRenderer.invoke('run-univer-buy', isin, quantity),
  submitAutomationOtp: (runId, code) =>
    ipcRenderer.invoke('submit-automation-otp', runId, code),
  cancelAutomationOtp: (runId) =>
    ipcRenderer.invoke('cancel-automation-otp', runId),
  onCalculatorState: (callback) => {
    ipcRenderer.on('calculator-state', (_event, isOpen) => callback(isOpen));
  },
  onNavigationState: (callback) => {
    ipcRenderer.on('navigation-state', (_event, state) => callback(state));
  },
  onLoading: (callback) => {
    ipcRenderer.on('loading', (_event, isLoading) => callback(isLoading));
  },
  onSecuritiesUpdated: (callback) => {
    ipcRenderer.on('securities-updated', (_event, data) => callback(data));
  },
  onScanState: (callback) => {
    ipcRenderer.on('scan-state', (_event, state) => callback(state));
  },
  onSessionStates: (callback) => {
    ipcRenderer.on('session-states', (_event, states) => callback(states));
  },
  onActiveSite: (callback) => {
    ipcRenderer.on('active-site', (_event, payload) => callback(payload));
  },
  onBrowserLayoutState: (callback) => {
    ipcRenderer.on('browser-layout-state', (_event, state) => callback(state));
  },
  onHomeState: (callback) => {
    ipcRenderer.on('home-state', (_event, state) => callback(state));
  },
  onInzhurOverlayState: (callback) => {
    ipcRenderer.on('inzhur-overlay-state', (_event, state) => callback(state));
  },
  onPanelTab: (callback) => {
    ipcRenderer.on('panel-tab', (_event, tabId) => callback(tabId));
  },
  onAppMode: (callback) => {
    ipcRenderer.on('app-mode', (_event, state) => callback(state));
  },
  onAutomationLog: (callback) => {
    ipcRenderer.on('automation-log', (_event, entries) => callback(entries));
  },
  onAutomationOtpRequest: (callback) => {
    ipcRenderer.on('automation-otp-request', (_event, payload) => callback(payload));
  },
  onAutomationBuyProgress: (callback) => {
    ipcRenderer.on('automation-buy-progress', (_event, payload) => callback(payload));
  },
  onOnboardingState: (callback) => {
    ipcRenderer.on('onboarding-state', (_event, state) => callback(state));
  },
  onOpenCalcDrawer: (callback) => {
    ipcRenderer.on('open-calc-drawer', () => callback());
  },
});
