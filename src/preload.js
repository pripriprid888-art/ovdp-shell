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
  goUniverSignin: () => ipcRenderer.invoke('go-univer-signin'),
  goUniverCabinet: () => ipcRenderer.invoke('go-univer-cabinet'),
  goUniverPortfolio: () => ipcRenderer.invoke('go-univer-portfolio'),
  goCatalog: () => ipcRenderer.invoke('go-catalog'),
  goUniverCatalog: () => ipcRenderer.invoke('go-univer-catalog'),
  goUniverToolbar: () => ipcRenderer.invoke('go-univer-toolbar'),
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
  downloadUniverOrderPdf: (orderId, documentId) =>
    ipcRenderer.invoke('download-univer-order-pdf', orderId, documentId),
  cancelUniverOrder: (orderId) => ipcRenderer.invoke('cancel-univer-order', orderId),
  scanPrivatPortfolio: () => ipcRenderer.invoke('scan-privat-portfolio'),
  getPrivatCommissions: (isin, quantity, source) =>
    ipcRenderer.invoke('get-privat-commissions', isin, quantity, source),
  beginUniverTopUpPrivat: (options) =>
    ipcRenderer.invoke('begin-univer-topup-privat', options || {}),
  confirmUniverTopUpPrivat: (options) =>
    ipcRenderer.invoke('confirm-univer-topup-privat', options || {}),
  cancelUniverTopUpPrivat: () => ipcRenderer.invoke('cancel-univer-topup-privat'),
  getPrivatPaymentCards: () => ipcRenderer.invoke('get-privat-payment-cards'),
  onPrivatPaymentCards: (callback) => {
    ipcRenderer.on('privat-payment-cards', (_event, payload) => callback(payload));
  },
  onPrivatPaymentStep: (callback) => {
    ipcRenderer.on('privat-payment-step', (_event, payload) => callback(payload));
  },
  onShellTopUpMode: (callback) => {
    ipcRenderer.on('shell-topup-mode', (_event, payload) => callback(payload));
  },
  scanAllPortfolios: () => ipcRenderer.invoke('scan-all-portfolios'),
  scanPortfolio: (siteId) => ipcRenderer.invoke('scan-portfolio', siteId),
  getSecurities: (siteFilter, listKind) => ipcRenderer.invoke('get-securities', siteFilter, listKind),
  getNbuReference: () => ipcRenderer.invoke('get-nbu-reference'),
  refreshNbuReference: () => ipcRenderer.invoke('refresh-nbu-reference'),
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
  getAutomationLog: (options) => ipcRenderer.invoke('get-automation-log', options || {}),
  getAutomationLogDates: () => ipcRenderer.invoke('get-automation-log-dates'),
  getLoggingConfig: () => ipcRenderer.invoke('get-logging-config'),
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
  getGmailOAuthStatus: () => ipcRenderer.invoke('get-gmail-oauth-status'),
  startGmailOAuth: () => ipcRenderer.invoke('start-gmail-oauth'),
  disconnectGmailOAuth: () => ipcRenderer.invoke('disconnect-gmail-oauth'),
  onGmailOAuthStatus: (callback) => {
    ipcRenderer.on('gmail-oauth-status', (_event, payload) => callback(payload));
  },
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
  onNbuReferenceUpdated: (callback) => {
    ipcRenderer.on('nbu-reference-updated', (_event, data) => callback(data));
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
  onAutomationOtpAuto: (callback) => {
    ipcRenderer.on('automation-otp-auto', (_event, payload) => callback(payload));
  },
  onShellOtpMode: (callback) => {
    ipcRenderer.on('shell-otp-mode', (_event, payload) => callback(payload));
  },
  onAutomationBuyProgress: (callback) => {
    ipcRenderer.on('automation-buy-progress', (_event, payload) => callback(payload));
  },
  onPendingUniverOrder: (callback) => {
    ipcRenderer.on('pending-univer-order', (_event, payload) => callback(payload));
  },
  onOnboardingState: (callback) => {
    ipcRenderer.on('onboarding-state', (_event, state) => callback(state));
  },
  onOpenCalcDrawer: (callback) => {
    ipcRenderer.on('open-calc-drawer', () => callback());
  },
});
