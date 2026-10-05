const { getScanner, listScannerIds } = require('../scanners/index');
const { getPortfolioScanner, listPortfolioScannerIds } = require('../scanners/portfolio/index');
const { getSite } = require('../sites/config');
const {
  ORDERS_URL,
  ORDERS_WAIT_SELECTOR,
  EXTRACT_UNIVER_ORDERS_JS,
  processRawOrders,
  enrichRawOrdersWithDocumentIds,
} = require('../scanners/portfolio/univer-orders-scan');
const { loadUrlWithTimeout, waitForSelector } = require('../shared/web-contents');
const { createScanWindow, destroyScanWindow } = require('./window');

function createScanRunner(deps) {
  const {
    broadcast,
    logBackground,
    logError,
    logDebug,
    withRun,
    createRunId,
    getSiteSessionStatus,
    saveSiteSecurities,
    saveSiteHoldings,
    saveSiteOrders,
    saveSiteAccountInfo,
    isAuthenticatedResult,
    refreshNbuReference,
    notifySecuritiesUpdated,
    shouldOpenExternally,
  } = deps;

  let scanInProgress = false;

  function getSiteName(siteId) {
    return getSite(siteId)?.name || siteId;
  }

  async function runSiteScans(siteIds, scanKind, scanOne, { parallel = false } = {}) {
    const results = [];
    const errors = [];

    const runOne = async (siteId) => {
      try {
        const data = await scanOne(siteId);
        return { ok: true, siteId, data };
      } catch (err) {
        errors.push({ siteId, message: err.message, error: err });
        broadcast('scan-state', {
          scanning: true,
          scanKind,
          siteId,
          message: `${getSiteName(siteId)}: ${err.message}`,
        });
        return { ok: false, siteId, error: err };
      }
    };

    if (parallel && siteIds.length > 1) {
      const outcomes = await Promise.all(siteIds.map((siteId) => runOne(siteId)));
      for (const outcome of outcomes) {
        if (outcome.ok) {
          results.push({ siteId: outcome.siteId, data: outcome.data });
        }
      }
    } else {
      for (const siteId of siteIds) {
        const outcome = await runOne(siteId);
        if (outcome.ok) {
          results.push({ siteId: outcome.siteId, data: outcome.data });
        }
      }
    }

    const summary = { ok: errors.length === 0, results, errors };
    if (siteIds.length === 1 && errors.length === 1) {
      throw errors[0].error;
    }
    return summary;
  }

  async function scanSiteCatalog(siteId) {
    const scanner = getScanner(siteId);
    const site = getSite(siteId);
    logBackground('info', siteId, `Сканування каталогу ${scanner.name}`, {
      context: { scanKind: 'catalog', siteId },
    });
    broadcast('scan-state', { scanning: true, siteId, message: `Завантаження ${scanner.name}…` });

    const partition = scanner.useSitePartition && site?.partition ? site.partition : undefined;
    const scanWindow = createScanWindow({ partition, siteId, shouldOpenExternally });

    try {
      logBackground('info', siteId, `Завантаження ${scanner.catalogUrl}`, {
        context: { scanKind: 'catalog', url: scanner.catalogUrl },
      });
      await loadUrlWithTimeout(scanWindow.webContents, scanner.catalogUrl);
      logDebug?.(siteId, 'Сторінку каталогу завантажено', { context: { scanKind: 'catalog' } });

      const authenticated = getSiteSessionStatus(siteId) === 'authenticated';
      const preferGuestApi = siteId === 'privat';
      const fetchApiJs = !preferGuestApi && authenticated && scanner.fetchAuthenticatedApiJs
        ? scanner.fetchAuthenticatedApiJs
        : scanner.fetchApiJs;
      const canUseApi = fetchApiJs && scanner.processApiCatalogResult;
      let proposals = [];

      if (scanner.catalogListFromDom && scanner.mergeDomWithApiCatalog) {
        if (scanner.prepareDelayMs) {
          await new Promise((resolve) => setTimeout(resolve, scanner.prepareDelayMs));
        }

        if (scanner.preparePage) {
          broadcast('scan-state', { scanning: true, siteId, message: `Підготовка сторінки ${scanner.name}…` });
          await scanWindow.webContents.executeJavaScript(scanner.preparePage);
          const preparePageDelayMs = scanner.preparePageDelayMs ?? 300;
          if (preparePageDelayMs > 0) {
            await new Promise((resolve) => setTimeout(resolve, preparePageDelayMs));
          }
        }

        broadcast('scan-state', { scanning: true, siteId, message: `Список UAH на ${scanner.name}…` });
        const matchCount = await waitForSelector(scanWindow.webContents, scanner.waitSelector, 60000);
        if (matchCount === 0) {
          logBackground('error', siteId, scanner.layoutErrorMessage);
          throw new Error(scanner.layoutErrorMessage);
        }

        const domRawItems = await scanWindow.webContents.executeJavaScript(scanner.extractJs);
        if (!domRawItems?.length) {
          logBackground('warning', siteId, scanner.emptyMessage);
          throw new Error(scanner.emptyMessage);
        }

        let apiResult = null;
        if (canUseApi) {
          broadcast('scan-state', { scanning: true, siteId, message: `Дані API ${scanner.name}…` });
          apiResult = await scanWindow.webContents.executeJavaScript(fetchApiJs);
        }

        const merged = scanner.mergeDomWithApiCatalog(domRawItems, apiResult);
        proposals = merged.proposals;

        if (merged.apiError && !merged.apiCount) {
          logBackground(
            'warning',
            siteId,
            `Каталог API: ${merged.apiError} — лише дані зі сторінки bonds/list`,
          );
        } else {
          logBackground(
            'info',
            siteId,
            `Каталог: ${merged.domCount} на bonds/list (UAH), API ${merged.apiCount}, приховано ${merged.droppedApiOnlyCount} поза списком (xref=${merged.xref || '—'})`,
            {
              context: {
                scanKind: 'catalog',
                domCount: merged.domCount,
                apiCount: merged.apiCount,
                droppedApiOnlyCount: merged.droppedApiOnlyCount,
                xref: merged.xref || null,
              },
            },
          );
        }

        if (!proposals.length) {
          logBackground('warning', siteId, scanner.emptyMessage);
          throw new Error(scanner.emptyMessage);
        }
      } else if (canUseApi) {
        if ((scanner.apiPrepareDelayMs ?? 0) > 0) {
          await new Promise((resolve) => setTimeout(resolve, scanner.apiPrepareDelayMs));
        }
        broadcast('scan-state', { scanning: true, siteId, message: `Пошук даних ${scanner.name}…` });
        const apiResult = await scanWindow.webContents.executeJavaScript(fetchApiJs);
        const parsed = scanner.processApiCatalogResult(apiResult);
        if (parsed.items?.length) {
          logBackground(
            'info',
            siteId,
            `${authenticated ? 'Каталог API (auth)' : 'Каталог API'}: ${parsed.items.length} ОВДП (xref=${parsed.xref || '—'})`,
            {
              context: {
                scanKind: 'catalog',
                source: authenticated ? 'api-auth' : 'api-guest',
                count: parsed.items.length,
                xref: parsed.xref || null,
              },
            },
          );
          proposals = parsed.items;
        } else {
          logBackground(
            'warning',
            siteId,
            `${authenticated ? 'Каталог API (auth)' : 'Каталог API'}: ${parsed.error || 'порожньо'}${parsed.errorCode != null ? ` (${parsed.errorCode})` : ''} — ${authenticated && fetchApiJs !== scanner.fetchApiJs ? 'guest API / DOM fallback' : 'DOM fallback'}`,
          );
          if (authenticated && fetchApiJs !== scanner.fetchApiJs && scanner.fetchApiJs) {
            const guestResult = await scanWindow.webContents.executeJavaScript(scanner.fetchApiJs);
            const guestParsed = scanner.processApiCatalogResult(guestResult);
            if (guestParsed.items?.length) {
              logBackground(
                'info',
                siteId,
                `Каталог API: ${guestParsed.items.length} ОВДП (xref=${guestParsed.xref || '—'})`,
              );
              proposals = guestParsed.items;
            }
          }
        }
      }

      if (!proposals.length) {
        if (scanner.prepareDelayMs) {
          await new Promise((resolve) => setTimeout(resolve, scanner.prepareDelayMs));
        }

        if (scanner.preparePage) {
          broadcast('scan-state', { scanning: true, siteId, message: `Підготовка сторінки ${scanner.name}…` });
          await scanWindow.webContents.executeJavaScript(scanner.preparePage);
          const preparePageDelayMs = scanner.preparePageDelayMs ?? 300;
          if (preparePageDelayMs > 0) {
            await new Promise((resolve) => setTimeout(resolve, preparePageDelayMs));
          }
        }

        broadcast('scan-state', { scanning: true, siteId, message: `Пошук даних ${scanner.name}…` });
        const matchCount = await waitForSelector(scanWindow.webContents, scanner.waitSelector, 60000);
        if (matchCount === 0) {
          logBackground('error', siteId, scanner.layoutErrorMessage);
          throw new Error(scanner.layoutErrorMessage);
        }

        if (scanner.checkAuthJs) {
          const authResult = await scanWindow.webContents.executeJavaScript(scanner.checkAuthJs);
          const isAuthenticated = typeof authResult === 'boolean'
            ? authResult
            : isAuthenticatedResult(authResult);
          if (!isAuthenticated) {
            const currentUrl = scanWindow.webContents.getURL().toLowerCase();
            if (siteId === 'univer' && currentUrl.includes('/client/login')) {
              throw new Error('Сесія UNIVER недійсна — увійдіть через «Особисті дані» або toolbar');
            }
            throw new Error(scanner.authRequiredMessage || 'Потрібна авторизація');
          }
        }

        if (scanner.readyJs) {
          const readyDeadline = Date.now() + (scanner.readyTimeoutMs ?? 20000);
          while (Date.now() < readyDeadline) {
            const ready = await scanWindow.webContents.executeJavaScript(scanner.readyJs);
            if (ready) break;
            await new Promise((resolve) => setTimeout(resolve, 250));
          }
        }

        const rawItems = await scanWindow.webContents.executeJavaScript(scanner.extractJs);
        proposals = scanner.processRawItems(rawItems);
      }
      if (!proposals.length) {
        logBackground('warning', siteId, scanner.emptyMessage);
        throw new Error(scanner.emptyMessage);
      }

      saveSiteSecurities(siteId, proposals);
      notifySecuritiesUpdated('all', 'catalog');
      logBackground('info', siteId, `Каталог: знайдено ${proposals.length} ОВДП`);
      broadcast('scan-state', { scanning: true, siteId, message: `${scanner.name}: ${proposals.length} ОВДП` });
      return proposals;
    } catch (err) {
      logError?.(siteId, `Каталог: ${err.message}`, err, { context: { scanKind: 'catalog' } });
      throw err;
    } finally {
      destroyScanWindow(scanWindow);
    }
  }

  async function scanCatalogs(siteIds = listScannerIds()) {
    if (scanInProgress) {
      throw new Error('Сканування вже виконується');
    }

    return withRun(createRunId('scan-catalog'), async () => {
      scanInProgress = true;
      broadcast('scan-state', {
        scanning: true,
        scanKind: 'catalog',
        message: `Сканування каталогів: ${siteIds.map(getSiteName).join(', ')}…`,
      });
      logBackground('info', null, `Сканування каталогів: ${siteIds.join(', ')}`, {
        context: { scanKind: 'catalog', siteIds },
      });

      let summary = { ok: true, results: [], errors: [] };
      try {
        summary = await runSiteScans(siteIds, 'catalog', scanSiteCatalog, {
          parallel: siteIds.length > 1,
        });
        if (summary.results.length) {
          notifySecuritiesUpdated('all', 'catalog');
        }
        return summary;
      } finally {
        scanInProgress = false;
        broadcast('scan-state', {
          scanning: false,
          scanKind: 'catalog',
          summary,
        });
      }
    });
  }

  async function scanSitePortfolio(siteId) {
    const scanner = getPortfolioScanner(siteId);
    const site = getSite(siteId);

    if (getSiteSessionStatus(siteId) !== 'authenticated') {
      throw new Error(scanner.authRequiredMessage);
    }

    logBackground('info', siteId, `Сканування портфеля ${scanner.name}`, {
      context: { scanKind: 'portfolio', siteId },
    });
    broadcast('scan-state', {
      scanning: true,
      scanKind: 'portfolio',
      siteId,
      message: `Завантаження портфеля ${scanner.name}…`,
    });

    const scanWindow = createScanWindow({
      partition: site.partition,
      siteId,
      shouldOpenExternally,
    });

    try {
      if (scanner.balanceUrl && scanner.extractBalanceJs) {
        broadcast('scan-state', {
          scanning: true,
          scanKind: 'portfolio',
          siteId,
          message: `Баланс рахунку ${scanner.name}…`,
        });
        try {
          logBackground('info', siteId, `Завантаження балансу: ${scanner.balanceUrl}`);
          await loadUrlWithTimeout(scanWindow.webContents, scanner.balanceUrl);
          await new Promise((resolve) => setTimeout(resolve, scanner.balancePrepareDelayMs || 2000));

          const authenticatedForBalance = await scanWindow.webContents.executeJavaScript(scanner.checkAuthJs);
          if (!authenticatedForBalance) {
            throw new Error(scanner.authRequiredMessage);
          }

          let accountInfo = await scanWindow.webContents.executeJavaScript(scanner.extractBalanceJs);

          if (scanner.paymentInfoUrl && scanner.extractPaymentInfoJs) {
            try {
              logBackground('info', siteId, `Завантаження реквізитів: ${scanner.paymentInfoUrl}`);
              await loadUrlWithTimeout(scanWindow.webContents, scanner.paymentInfoUrl);
              await new Promise((resolve) => setTimeout(resolve, scanner.paymentInfoPrepareDelayMs || 2000));
              const paymentRaw = await scanWindow.webContents.executeJavaScript(scanner.extractPaymentInfoJs);
              const paymentInfo = typeof scanner.enrichPaymentInfo === 'function'
                ? scanner.enrichPaymentInfo(paymentRaw)
                : paymentRaw;
              accountInfo = { ...accountInfo, ...paymentInfo };
              if (paymentInfo?.contract_number) {
                logBackground('info', siteId, `Договір UNIVER: ${paymentInfo.contract_number}`);
              }
            } catch (paymentErr) {
              logBackground('warning', siteId, `Реквізити поповнення: ${paymentErr.message}`);
            }
          }

          if (
            accountInfo?.balance_uah != null
            || accountInfo?.balance_text
            || accountInfo?.contract_number
          ) {
            saveSiteAccountInfo(siteId, accountInfo);
            logBackground(
              'info',
              siteId,
              `Баланс: ${accountInfo.balance_text || accountInfo.balance_uah || '—'} ₴`,
            );
            broadcast('scan-state', {
              scanning: true,
              scanKind: 'portfolio',
              siteId,
              message: `${scanner.name}: баланс ${accountInfo.balance_text || accountInfo.balance_uah || '—'} ₴`,
            });
          } else {
            logBackground('warning', siteId, 'Баланс не знайдено на сторінці');
          }
        } catch (balanceErr) {
          logBackground('warning', siteId, `Баланс: ${balanceErr.message}`);
          broadcast('scan-state', {
            scanning: true,
            scanKind: 'portfolio',
            siteId,
            message: `${scanner.name}: баланс не зчитано (${balanceErr.message})`,
          });
        }
      }

      let holdings;
      let portfolioApiUsed = false;

      if (typeof scanner.scanHoldings === 'function') {
        const rawItems = await scanner.scanHoldings(scanWindow.webContents, {
          loadUrlWithTimeout,
          delay: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
          broadcast,
          logBackground: (level, message) => logBackground(level, siteId, message),
          siteId,
          name: scanner.name,
        });
        holdings = scanner.processRawItems(rawItems);
      } else {
        logBackground('info', siteId, `Завантаження портфеля: ${scanner.portfolioUrl}`);
        await loadUrlWithTimeout(scanWindow.webContents, scanner.portfolioUrl);
        await new Promise((resolve) => setTimeout(resolve, scanner.apiPrepareDelayMs ?? 500));

        const canUseApi = scanner.fetchApiJs && scanner.processApiPortfolioResult;
        if (canUseApi) {
          broadcast('scan-state', {
            scanning: true,
            scanKind: 'portfolio',
            siteId,
            message: `Пошук позицій ${scanner.name}…`,
          });
          const apiResult = await scanWindow.webContents.executeJavaScript(scanner.fetchApiJs);
          const parsed = scanner.processApiPortfolioResult(apiResult);
          if (parsed.error == null) {
            portfolioApiUsed = true;
            holdings = parsed.items;
            logBackground(
              'info',
              siteId,
              `Портфель API: ${holdings.length} поз. (xref=${parsed.xref || '—'})`,
            );
          } else {
            logBackground(
              'warning',
              siteId,
              `Портфель API: ${parsed.error}${parsed.errorCode != null ? ` (${parsed.errorCode})` : ''} — DOM fallback`,
            );
          }
        }

        if (!portfolioApiUsed) {
          await new Promise((resolve) => setTimeout(resolve, scanner.prepareDelayMs || 1500));

          const authenticated = await scanWindow.webContents.executeJavaScript(scanner.checkAuthJs);
          if (!authenticated) {
            throw new Error(scanner.authRequiredMessage);
          }

          if (scanner.preparePage) {
            broadcast('scan-state', {
              scanning: true,
              scanKind: 'portfolio',
              siteId,
              message: `Підготовка портфеля ${scanner.name}…`,
            });
            await scanWindow.webContents.executeJavaScript(scanner.preparePage);
            await new Promise((resolve) => setTimeout(resolve, 1200));
          }

          broadcast('scan-state', {
            scanning: true,
            scanKind: 'portfolio',
            siteId,
            message: `Пошук позицій ${scanner.name}…`,
          });

          const matchCount = await waitForSelector(scanWindow.webContents, scanner.waitSelector, 60000);
          if (matchCount === 0) {
            throw new Error(scanner.layoutErrorMessage);
          }

          const rawItems = await scanWindow.webContents.executeJavaScript(scanner.extractJs);
          holdings = scanner.processRawItems(rawItems);
        }
      }

      saveSiteHoldings(siteId, holdings);
      logBackground('info', siteId, `Портфель: ${holdings.length} поз.`);
      broadcast('scan-state', {
        scanning: true,
        scanKind: 'portfolio',
        siteId,
        message: `${scanner.name}: ${holdings.length} поз. у портфелі`,
      });
      return holdings;
    } catch (err) {
      logError?.(siteId, `Портфель: ${err.message}`, err, { context: { scanKind: 'portfolio' } });
      throw err;
    } finally {
      destroyScanWindow(scanWindow);
    }
  }

  async function scanPortfolios(siteIds = listPortfolioScannerIds()) {
    if (scanInProgress) {
      throw new Error('Сканування вже виконується');
    }

    return withRun(createRunId('scan-portfolio'), async () => {
      scanInProgress = true;
      broadcast('scan-state', { scanning: true, scanKind: 'portfolio' });
      logBackground('info', null, `Сканування портфелів: ${siteIds.join(', ')}`, {
        context: { scanKind: 'portfolio', siteIds },
      });

      try {
        const skipped = [];
        const authenticatedSiteIds = [];
        for (const siteId of siteIds) {
          if (getSiteSessionStatus(siteId) !== 'authenticated') {
            skipped.push(siteId);
            broadcast('scan-state', {
              scanning: true,
              scanKind: 'portfolio',
              siteId,
              message: `${getSiteName(siteId)}: пропущено (немає сесії)`,
            });
            continue;
          }
          authenticatedSiteIds.push(siteId);
        }

        const summary = authenticatedSiteIds.length
          ? await runSiteScans(authenticatedSiteIds, 'portfolio', scanSitePortfolio)
          : { ok: true, results: [], errors: [] };
        summary.skipped = skipped.map((siteId) => ({
          siteId,
          reason: 'not_authenticated',
        }));

        if (summary.results.length) {
          notifySecuritiesUpdated('all', 'holdings');
        }
        return summary;
      } finally {
        scanInProgress = false;
        broadcast('scan-state', { scanning: false, scanKind: 'portfolio' });
      }
    });
  }

  async function scanUniverOrders({ expectedOrderId } = {}) {
    const siteId = 'univer';
    const site = getSite(siteId);

    if (getSiteSessionStatus(siteId) !== 'authenticated') {
      throw new Error('Спочатку увійдіть на UNIVER');
    }

    return withRun(createRunId('scan-orders'), async () => {
      logBackground('info', siteId, `Завантаження замовлень: ${ORDERS_URL}`, {
        context: { scanKind: 'orders', url: ORDERS_URL },
      });
      broadcast('scan-state', {
        scanning: true,
        scanKind: 'orders',
        siteId,
        message: 'Завантаження замовлень UNIVER…',
      });

      const scanWindow = createScanWindow({
        partition: site.partition,
        siteId,
        shouldOpenExternally,
      });

      try {
        await loadUrlWithTimeout(scanWindow.webContents, ORDERS_URL);
        await new Promise((resolve) => setTimeout(resolve, 1500));

        const authResult = await scanWindow.webContents.executeJavaScript(site.checkAuthJs);
        if (!isAuthenticatedResult(authResult)) {
          throw new Error('Сесія UNIVER недійсна — увійдіть знову');
        }

        const matchCount = await waitForSelector(scanWindow.webContents, ORDERS_WAIT_SELECTOR, 30000);
        if (matchCount === 0) {
          saveSiteOrders(siteId, []);
          logBackground('warning', siteId, 'Таблицю замовлень не знайдено на blok-bek');
          return [];
        }

        const rawItems = await scanWindow.webContents.executeJavaScript(EXTRACT_UNIVER_ORDERS_JS);
        const enrichedItems = await enrichRawOrdersWithDocumentIds(scanWindow.webContents, rawItems);
        const orders = processRawOrders(enrichedItems);
        saveSiteOrders(siteId, orders);
        logBackground('info', siteId, `Замовлення: ${orders.length} записів`, {
          context: { scanKind: 'orders', count: orders.length },
        });

        if (expectedOrderId) {
          const found = orders.some((order) => String(order.order_id) === String(expectedOrderId));
          if (found) {
            logBackground('info', siteId, `Замовлення #${expectedOrderId} з’явилось в історії`, {
              context: { scanKind: 'orders', orderId: expectedOrderId },
            });
          } else {
            logBackground(
              'warning',
              siteId,
              `Замовлення #${expectedOrderId} поки не з’явилось в історії (${orders.length} записів)`,
              { context: { scanKind: 'orders', orderId: expectedOrderId, count: orders.length } },
            );
          }
        }

        broadcast('scan-state', {
          scanning: true,
          scanKind: 'orders',
          siteId,
          message: `UNIVER: ${orders.length} замовлень`,
        });
        return orders;
      } catch (err) {
        logError?.(siteId, `Замовлення: ${err.message}`, err, { context: { scanKind: 'orders' } });
        throw err;
      } finally {
        destroyScanWindow(scanWindow);
        broadcast('scan-state', { scanning: false, scanKind: 'orders' });
      }
    });
  }

  return {
    scanSiteCatalog,
    scanCatalogs,
    scanSitePortfolio,
    scanPortfolios,
    scanUniverOrders,
    isScanInProgress: () => scanInProgress,
  };
}

module.exports = {
  createScanRunner,
};
