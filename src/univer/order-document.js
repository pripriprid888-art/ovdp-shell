const { dialog } = require('electron');
const fs = require('fs');
const { getSite } = require('../sites/config');
const { createScanWindow, destroyScanWindow } = require('../scan/window');
const { shouldOpenExternally } = require('../shared/browser');

const UNIVER_BASE = 'https://univer.1b.app';

const PDF_HREF_RE = /\/client\/document\/(\d+)\/pdf\/?(?:\?[^"'\\s>]*)?/gi;

function isUniverOrderDownloadable(stage) {
  const text = String(stage || '').trim().toLowerCase();
  if (!text) return false;
  if (/скас|відхил|cancel|reject|помилк|error|відмов|ануль/.test(text)) return false;
  if (/очіку|процес|нове|new|чернет|draft|формуван/.test(text)) return false;
  return /прийня|викон|заверш|успіш|done|complete|closed|оплач|підтверд|в\s*робот|in\s*progress/.test(text);
}

function normalizeCellText(value) {
  return String(value || '').replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim();
}

function scoreOrderPdfCandidate(candidate, orderId) {
  let score = 0;
  if (/Client_Order_/i.test(candidate.docName) && candidate.docName.includes(orderId)) score += 100;
  if (/Завантажити\s*PDF/i.test(candidate.label)) score += 50;
  if (/download=1/.test(candidate.href)) score += 25;
  return score;
}

function pickBestOrderPdfCandidate(candidates, orderId) {
  if (!candidates.length) return null;
  return [...candidates].sort(
    (a, b) => scoreOrderPdfCandidate(b, orderId) - scoreOrderPdfCandidate(a, orderId),
  )[0];
}

function ensurePdfDownloadUrl(href, baseUrl = UNIVER_BASE) {
  const absolute = new URL(href, baseUrl).href;
  if (/download=1(?:&|$)/.test(absolute)) return absolute;
  return absolute.includes('?') ? `${absolute}&download=1` : `${absolute}?download=1`;
}

function extractOrderPdfCandidatesFromHtml(html, orderId) {
  const rows = String(html || '').split(/<tr[\s>]/i).slice(1);
  const candidates = [];

  for (const rowChunk of rows) {
    const row = rowChunk.split(/<\/tr>/i)[0] || '';
    if (!PDF_HREF_RE.test(row)) continue;
    PDF_HREF_RE.lastIndex = 0;

    const hrefMatch = row.match(/href=["']([^"']*\/client\/document\/\d+\/pdf\/[^"']*)["']/i);
    if (!hrefMatch) continue;

    const labelMatch = row.match(/>([^<]*Завантажити\s*PDF[^<]*)</i);
    const label = labelMatch ? normalizeCellText(labelMatch[1]) : '';
    const cellMatches = [...row.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)];
    const docName = normalizeCellText(
      (cellMatches[2]?.[1] || cellMatches[1]?.[1] || '').replace(/<[^>]+>/g, ' '),
    );

    candidates.push({
      href: hrefMatch[1],
      label,
      docName,
    });
  }

  return candidates;
}

function extractDocumentIdFromPdfUrl(url) {
  const match = String(url || '').match(/\/client\/document\/(\d+)\/pdf\/?/i);
  return match ? match[1] : null;
}

function buildUniverDocumentPdfUrl(documentId) {
  const normalizedId = String(documentId || '').trim();
  if (!/^\d+$/.test(normalizedId)) {
    throw new Error('Невідомий номер документа');
  }
  return `${UNIVER_BASE}/client/document/${normalizedId}/pdf/?download=1`;
}

function extractOrderPdfLinkFromHtml(html, orderId, baseUrl = UNIVER_BASE) {
  const candidate = pickBestOrderPdfCandidate(extractOrderPdfCandidatesFromHtml(html, orderId), orderId);
  if (!candidate) return null;
  return {
    url: ensurePdfDownloadUrl(candidate.href, baseUrl),
    docName: candidate.docName,
    label: candidate.label,
  };
}

function extractOrderDocumentIdFromHtml(html, orderId) {
  const link = extractOrderPdfLinkFromHtml(html, orderId);
  return link?.url ? extractDocumentIdFromPdfUrl(link.url) : null;
}

function extractPdfUrlsFromHtml(html) {
  const link = extractOrderPdfLinkFromHtml(html, '');
  if (link?.url) return [link.url];

  const urls = new Set();
  PDF_HREF_RE.lastIndex = 0;
  let match = PDF_HREF_RE.exec(html);
  while (match) {
    urls.add(ensurePdfDownloadUrl(`/client/document/${match[1]}/pdf/`));
    match = PDF_HREF_RE.exec(html);
  }
  return [...urls];
}

function looksLikeLoginHtml(html) {
  const sample = String(html || '').slice(0, 12000).toLowerCase();
  const hasLoginField = /name=["']login["']/.test(sample);
  const hasPasswordField = /type=["']password["']|name=["']password["']/.test(sample);
  return hasLoginField && (hasPasswordField || sample.includes('увійти'));
}

function buildExtractOrderPdfJs(orderId) {
  return `(() => {
    const orderId = ${JSON.stringify(String(orderId))};
    function normalize(text) {
      return String(text || '').replace(/\\u00a0/g, ' ').replace(/\\s+/g, ' ').trim();
    }
    function score(candidate) {
      let value = 0;
      if (/Client_Order_/i.test(candidate.docName) && candidate.docName.includes(orderId)) value += 100;
      if (/Завантажити\\s*PDF/i.test(candidate.label)) value += 50;
      if (/download=1/.test(candidate.href)) value += 25;
      return value;
    }

    const rows = [...document.querySelectorAll('.os-table tbody tr, table.os-table tbody tr')];
    const candidates = [];
    for (const row of rows) {
      const link = [...row.querySelectorAll('a[href*="/client/document/"]')]
        .find((el) => /\\/pdf\\/?/i.test(el.getAttribute('href') || ''));
      if (!link) continue;
      const cells = [...row.querySelectorAll('td')];
      candidates.push({
        href: link.getAttribute('href') || '',
        label: normalize(link.innerText || link.textContent),
        docName: normalize(cells[2]?.innerText || cells[1]?.innerText || ''),
      });
    }

    if (!candidates.length) return null;
    const best = candidates.sort((a, b) => score(b) - score(a))[0];
    let href = best.href;
    if (!/download=1/.test(href)) {
      href += href.includes('?') ? '&download=1' : '?download=1';
    }
    return {
      url: new URL(href, location.origin).href,
      docName: best.docName,
      label: best.label,
    };
  })()`;
}

function extractOrderIdFromReferer(referer) {
  const match = String(referer || '').match(/\/client\/order\/(\d+)\/?/i);
  return match ? match[1] : null;
}

async function waitForWebContentsLoad(webContents, timeoutMs = 45000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (!webContents.isLoading()) break;
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
}

async function assertUniverBrowserSession(webContents) {
  const finalUrl = String(webContents.getURL() || '').toLowerCase();
  if (finalUrl.includes('/client/login') || finalUrl.includes('remindpassword')) {
    throw new Error('Потрібен вхід у UNIVER');
  }

  const authenticated = await webContents.executeJavaScript(`(() => {
    const login = document.querySelector('input[name="login"]');
    return !(login && login.offsetParent !== null);
  })()`);
  if (!authenticated) {
    throw new Error('Потрібен вхід у UNIVER');
  }
}

async function loadUniverRefererPage(webContents, { orderId } = {}) {
  const normalizedOrderId = String(orderId || '').trim();
  if (normalizedOrderId) {
    await loadOrderPage(webContents, normalizedOrderId);
    return;
  }

  const url = `${UNIVER_BASE}/client/`;
  await webContents.loadURL(url);
  await waitForWebContentsLoad(webContents);
  await new Promise((resolve) => setTimeout(resolve, 1000));
  await assertUniverBrowserSession(webContents);
}

function isPdfBuffer(buffer) {
  return Buffer.isBuffer(buffer)
    && buffer.length >= 4
    && buffer.toString('ascii', 0, 4) === '%PDF';
}

function assertPdfBuffer(buffer) {
  if (isPdfBuffer(buffer)) return;
  const head = Buffer.isBuffer(buffer) ? buffer.toString('utf8', 0, 240).toLowerCase() : '';
  if (head.includes('<html') || head.includes('<!doctype')) {
    throw new Error('UNIVER повернув сторінку замість PDF — перевірте сесію');
  }
  throw new Error('Завантажений файл не схожий на PDF');
}

async function fetchPdfBufferInBrowser(webContents, pdfUrl) {
  const base64 = await webContents.executeJavaScript(`(async () => {
    const response = await fetch(${JSON.stringify(pdfUrl)}, {
      credentials: 'include',
      headers: { Accept: 'application/pdf,*/*' },
    });
    if (!response.ok) {
      throw new Error('HTTP ' + response.status);
    }

    const contentType = String(response.headers.get('content-type') || '').toLowerCase();
    const buffer = await response.arrayBuffer();
    const bytes = new Uint8Array(buffer);
    const magic = bytes.length >= 4
      ? String.fromCharCode(bytes[0], bytes[1], bytes[2], bytes[3])
      : '';
    if (magic !== '%PDF' && (contentType.includes('text/html') || contentType.includes('text/plain'))) {
      throw new Error('HTML_RESPONSE');
    }

    let binary = '';
    const chunkSize = 0x8000;
    for (let i = 0; i < bytes.length; i += chunkSize) {
      binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunkSize));
    }
    return btoa(binary);
  })()`);

  return Buffer.from(base64, 'base64');
}

async function loadOrderPage(webContents, orderId, timeoutMs = 45000) {
  const orderUrl = `${UNIVER_BASE}/client/order/${orderId}/`;
  await webContents.loadURL(orderUrl);
  await waitForWebContentsLoad(webContents, timeoutMs);
  await new Promise((resolve) => setTimeout(resolve, 1500));
  await assertUniverBrowserSession(webContents);
}

async function fetchOrderDocumentIdForOrder(webContents, orderId) {
  const normalizedId = String(orderId || '').trim();
  if (!normalizedId) return null;

  await loadOrderPage(webContents, normalizedId);
  const extracted = await webContents.executeJavaScript(buildExtractOrderPdfJs(normalizedId));
  if (extracted?.url) {
    return extractDocumentIdFromPdfUrl(extracted.url);
  }

  const html = await webContents.executeJavaScript('document.documentElement.outerHTML');
  return extractOrderDocumentIdFromHtml(html, normalizedId);
}

async function resolveOrderPdfLink(orderId) {
  const normalizedId = String(orderId || '').trim();
  if (!normalizedId) throw new Error('Невідомий номер замовлення');

  const site = getSite('univer');
  const scanWindow = createScanWindow({
    partition: site.partition,
    siteId: 'univer',
    shouldOpenExternally,
  });

  try {
    await loadOrderPage(scanWindow.webContents, normalizedId);
    const extracted = await scanWindow.webContents.executeJavaScript(
      buildExtractOrderPdfJs(normalizedId),
    );
    if (extracted?.url) return extracted;

    const html = await scanWindow.webContents.executeJavaScript(
      'document.documentElement.outerHTML',
    );
    const fallback = extractOrderPdfLinkFromHtml(html, normalizedId);
    if (fallback?.url) return fallback;

    if (looksLikeLoginHtml(html)) {
      throw new Error('Потрібен вхід у UNIVER');
    }
    throw new Error('PDF документ для цього замовлення не знайдено');
  } finally {
    destroyScanWindow(scanWindow);
  }
}

async function downloadPdfFromUrl(pdfUrl, {
  orderId,
  referer,
  savePath,
  defaultFileName,
  dialogTitle,
} = {}) {
  const site = getSite('univer');
  const scanWindow = createScanWindow({
    partition: site.partition,
    siteId: 'univer',
    shouldOpenExternally,
  });

  try {
    const refererOrderId = String(orderId || '').trim() || extractOrderIdFromReferer(referer);
    await loadUniverRefererPage(scanWindow.webContents, { orderId: refererOrderId });

    let buffer;
    try {
      buffer = await fetchPdfBufferInBrowser(scanWindow.webContents, pdfUrl);
    } catch (err) {
      const message = String(err?.message || err || '');
      if (message.includes('HTML_RESPONSE')) {
        throw new Error('UNIVER повернув сторінку замість PDF — перевірте сесію');
      }
      if (/HTTP\s401|HTTP\s403/.test(message)) {
        throw new Error('Потрібен вхід у UNIVER');
      }
      throw new Error(message.startsWith('HTTP ') ? `Не вдалося завантажити PDF (${message.slice(5)})` : message);
    }

    assertPdfBuffer(buffer);

    let targetPath = savePath;
    if (!targetPath) {
      const result = await dialog.showSaveDialog({
        title: dialogTitle,
        defaultPath: defaultFileName,
        filters: [{ name: 'PDF', extensions: ['pdf'] }],
      });
      if (result.canceled || !result.filePath) {
        return { canceled: true };
      }
      targetPath = result.filePath;
    }

    fs.writeFileSync(targetPath, buffer);
    return {
      canceled: false,
      savedPath: targetPath,
      url: pdfUrl,
    };
  } finally {
    destroyScanWindow(scanWindow);
  }
}

async function downloadUniverOrderPdf(orderId, { documentId, savePath } = {}) {
  const normalizedId = String(orderId || '').trim();
  const normalizedDocumentId = String(documentId || '').trim();
  if (!normalizedId && !normalizedDocumentId) {
    throw new Error('Невідомий номер замовлення');
  }

  let pdfUrl;
  let referer = `${UNIVER_BASE}/client/`;
  let defaultFileName = normalizedDocumentId
    ? `univer-document-${normalizedDocumentId}.pdf`
    : `univer-order-${normalizedId}.pdf`;
  let dialogTitle = normalizedDocumentId
    ? `Зберегти PDF — документ #${normalizedDocumentId}`
    : `Зберегти PDF — замовлення #${normalizedId}`;

  if (normalizedDocumentId) {
    pdfUrl = buildUniverDocumentPdfUrl(normalizedDocumentId);
    if (normalizedId) {
      referer = `${UNIVER_BASE}/client/order/${normalizedId}/`;
      defaultFileName = `univer-order-${normalizedId}-doc-${normalizedDocumentId}.pdf`;
    }
  } else {
    const pdfLink = await resolveOrderPdfLink(normalizedId);
    pdfUrl = pdfLink.url;
    referer = `${UNIVER_BASE}/client/order/${normalizedId}/`;
  }

  const saved = await downloadPdfFromUrl(pdfUrl, {
    orderId: normalizedId,
    referer,
    savePath,
    defaultFileName,
    dialogTitle,
  });
  if (saved.canceled) return saved;

  return {
    ...saved,
    documentId: normalizedDocumentId || extractDocumentIdFromPdfUrl(pdfUrl),
    documentCount: 1,
  };
}

module.exports = {
  isUniverOrderDownloadable,
  downloadUniverOrderPdf,
  fetchOrderDocumentIdForOrder,
  buildUniverDocumentPdfUrl,
  extractDocumentIdFromPdfUrl,
  extractOrderDocumentIdFromHtml,
  looksLikeLoginHtml,
  extractPdfUrlsFromHtml,
  extractOrderPdfLinkFromHtml,
  isPdfBuffer,
  assertPdfBuffer,
};
