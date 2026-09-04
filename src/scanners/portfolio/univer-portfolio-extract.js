/** Portfolio extractor for UNIVER client cabinet (Мої Інвестиції → Мій портфель у цінних паперах). */
const CLICK_UNIVER_MENU_JS = `(function(labelPattern, allowClientLinks) {
  const re = new RegExp(labelPattern, 'i');

  function normalizeText(el) {
    return (el?.innerText || el?.textContent || '').replace(/\\u00a0/g, ' ').replace(/\\s+/g, ' ').trim();
  }

  function isVisible(el) {
    if (!el) return false;
    const style = window.getComputedStyle(el);
    if (style.display === 'none' || style.visibility === 'hidden') return false;
    return el.offsetParent !== null || el.closest('nav, .menu, .sidebar, .navigation, [class*="menu"], .tabs, [class*="tab"]');
  }

  function isAllowedClientHref(href) {
    if (!href || href.startsWith('#') || href.startsWith('javascript:')) return false;
    if (/\\.(pdf|doc|docx|xls|xlsx|zip)(\\?|$)/i.test(href)) return false;
    const lower = href.toLowerCase();
    if (lower.startsWith('/client') || lower.includes('univer.1b.app/client')) return true;
    return false;
  }

  function dispatchClick(target) {
    target.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
    target.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    target.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
    target.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    if (typeof target.click === 'function') target.click();
  }

  function clickTarget(el) {
    const anchor = el.closest('a[href]');
    if (anchor) {
      const href = (anchor.getAttribute('href') || anchor.href || '').trim();
      if (/\\.(pdf|doc|docx|xls|xlsx|zip)(\\?|$)/i.test(href)) return null;
      if (href.startsWith('#') || href.startsWith('javascript:')) {
        dispatchClick(anchor);
        return normalizeText(anchor);
      }
      if (allowClientLinks && isAllowedClientHref(href)) {
        dispatchClick(anchor);
        return normalizeText(anchor);
      }
      return null;
    }

    const target = el.closest('button, [role="button"], li, .menu-item, .nav-item, .tab, [class*="tab"]') || el;
    if (target.tagName === 'A') return null;
    dispatchClick(target);
    return normalizeText(target);
  }

  function findInDocument(doc) {
    if (!doc) return null;
    const candidates = [];

    for (const el of doc.querySelectorAll('a, button, [role="button"], li, span, div, td, label, p')) {
      const text = normalizeText(el);
      if (!text || text.length > 160) continue;
      if (!re.test(text)) continue;
      if (!isVisible(el)) continue;
      candidates.push({ el, text, len: text.length });
    }

    candidates.sort((a, b) => a.len - b.len);
    for (const { el } of candidates) {
      try {
        const text = clickTarget(el);
        if (text) return { ok: true, text };
      } catch (_err) {
        // try next candidate
      }
    }

    for (const iframe of doc.querySelectorAll('iframe')) {
      try {
        const nested = findInDocument(iframe.contentDocument);
        if (nested?.ok) return nested;
      } catch (_err) {
        // cross-origin iframe
      }
    }

    return null;
  }

  const result = findInDocument(document);
  return result || { ok: false };
})`;

const CLICK_UNIVER_PORTFOLIO_TAB_JS = `(() => {
  const TAB_RE = /^мій\\s+портфель\\s+у\\s+цінних\\s+паперах/i;

  function normalizeText(el) {
    return (el?.innerText || el?.textContent || '').replace(/\\u00a0/g, ' ').replace(/\\s+/g, ' ').trim();
  }

  function isTabLabel(text) {
    if (!text || text.length > 90) return false;
    if (/^назва\\b|інвестовано,\\s*грн/i.test(text)) return false;
    return TAB_RE.test(text.trim());
  }

  function isVisible(el) {
    if (!el) return false;
    const style = window.getComputedStyle(el);
    return style.display !== 'none' && style.visibility !== 'hidden' && el.offsetParent !== null;
  }

  function dispatchClick(target) {
    target.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    if (typeof target.click === 'function') target.click();
  }

  function findTabInDocument(doc) {
    if (!doc) return null;
    const candidates = [];

    for (const el of doc.querySelectorAll('a, button, [role="button"], li, span, label, div')) {
      const text = normalizeText(el);
      if (!isTabLabel(text) || !isVisible(el)) continue;
      candidates.push({ el, text, len: text.length });
    }

    candidates.sort((a, b) => a.len - b.len);
    for (const { el, text } of candidates) {
      const anchor = el.closest('a[href]');
      const target = anchor || el.closest('button, [role="button"], li, .tab, [class*="tab"]') || el;
      try {
        dispatchClick(target);
        return { ok: true, text };
      } catch (_err) {
        // try next
      }
    }

    for (const iframe of doc.querySelectorAll('iframe')) {
      try {
        const nested = findTabInDocument(iframe.contentDocument);
        if (nested?.ok) return nested;
      } catch (_err) {
        // cross-origin iframe
      }
    }

    return null;
  }

  return findTabInDocument(document) || { ok: false };
})()`;

const PREPARE_UNIVER_PORTFOLIO_JS = `(() => {
  let clicked = 0;
  for (const el of document.querySelectorAll('button, [role="button"], [data-toggle], .accordion-toggle, .js-open, .toggle, tr[data-toggle]')) {
    if (el.tagName === 'A') continue;
    const text = (el.innerText || '').replace(/\\s+/g, ' ').trim();
    if (!text || text.length > 100) continue;
    if (!/розгорнут|детал|показати|expand|відкрити таблицю/i.test(text)) continue;
    try {
      el.click();
      clicked += 1;
    } catch (_err) {
      // ignore click failures
    }
  }
  return clicked;
})()`;

const COLLECT_UNIVER_PORTFOLIO_URLS_JS = `(() => {
  const urls = new Set();
  const here = location.href.split('#')[0].replace(/\\/$/, '');
  const origin = location.origin;

  function add(raw) {
    if (!raw) return;
    let url = String(raw).trim();
    if (url.startsWith('/')) url = origin + url;
    if (!url.includes('univer.1b.app/client')) return;
    if (url.includes('/login') || url.includes('remindpassword')) return;
    if (/\\.(pdf|doc|docx|xls|xlsx|zip)(\\?|$)/i.test(url)) return;
    url = url.split('#')[0].replace(/\\/$/, '');
    if (url === here) return;
    if (!/myorders|portfeli-kliientiv|portfeli-klientiv|portfel/i.test(url)) return;
    if (/portfeli-kliientiv\\/|portfeli-klientiv\\//.test(url) && url !== here && !/portfeli-kliientiv$|portfeli-klientiv$/.test(url)) {
      urls.add(url.endsWith('/') ? url : \`\${url}/\`);
      return;
    }
    if (/\\/order\\/\\d+|myorders|portfel|process\\/\\d+|custompage\\/\\d+|\\/show\\/\\d+|\\/view\\/\\d+/i.test(url)) {
      urls.add(url.endsWith('/') ? url : \`\${url}/\`);
    }
  }

  function walkDocument(doc) {
    if (!doc) return;
    for (const a of doc.querySelectorAll('a[href]')) {
      add(a.getAttribute('href') || a.href);
    }
    for (const tr of doc.querySelectorAll('tr[data-href], tr[data-url], [data-orderid] a[href]')) {
      add(tr.getAttribute('data-href') || tr.getAttribute('data-url'));
      const link = tr.querySelector('a[href]');
      if (link) add(link.getAttribute('href') || link.href);
    }
    for (const row of doc.querySelectorAll('table tbody tr')) {
      const link = row.querySelector('a[href]');
      if (link) add(link.getAttribute('href') || link.href);
    }
  }

  walkDocument(document);
  for (const iframe of document.querySelectorAll('iframe')) {
    try {
      walkDocument(iframe.contentDocument);
    } catch (_err) {
      // cross-origin iframe
    }
  }

  return [...urls];
})()`;

const EXTRACT_UNIVER_PORTFOLIO_JS = `(() => {
  const ISIN_RE = /UA4000\\d{6}|UA\\d{10}/;
  const items = [];
  const seen = new Set();

  function parseQuantity(text) {
    if (!text) return null;
    const match = String(text).match(/(\\d[\\d\\s.,]*)/);
    if (!match) return null;
    const n = parseInt(match[1].replace(/[^\\d]/g, ''), 10);
    return Number.isFinite(n) && n > 0 ? n : null;
  }

  function parseMoney(text) {
    if (!text) return null;
    const cleaned = String(text).replace(/[^\\d.,\\s-]/g, '').replace(/\\s/g, '').replace(',', '.');
    const n = parseFloat(cleaned);
    return Number.isFinite(n) ? n : null;
  }

  function addItem(partial) {
    const isin = partial.isin?.match(ISIN_RE)?.[0];
    if (!isin || seen.has(isin)) return;
    seen.add(isin);
    items.push({ ...partial, isin });
  }

  function parseDecimalQty(text) {
    if (!text) return null;
    const cleaned = String(text).replace(/\\u00a0/g, ' ').replace(/\\s/g, '').replace(',', '.');
    const n = parseFloat(cleaned);
    return Number.isFinite(n) && n > 0 ? Math.round(n) : null;
  }

  function cellText(tr, key) {
    return tr.querySelector(\`td[data-key="\${key}"]\`)?.innerText?.replace(/\\u00a0/g, ' ').trim() || '';
  }

  function extractOsTable(doc) {
    for (const tr of doc.querySelectorAll('table.os-table tbody tr')) {
      const isinRaw = cellText(tr, 'cusstomproduct_ISIN');
      const isinMatch = isinRaw.match(ISIN_RE);
      if (!isinMatch) continue;

      const qtyRaw = cellText(tr, 'productcount');
      const qty = parseDecimalQty(qtyRaw);

      addItem({
        isin: isinMatch[0],
        title: cellText(tr, 'productname') || null,
        quantity: qty,
        maturity_date: cellText(tr, 'cusstomproduct_Datapogashennya') || null,
        current_value: cellText(tr, 'cusstom_Suma_PP') || cellText(tr, 'cusstomproduct_TSnavikupUK') || null,
        yield_percent: cellText(tr, 'cusstomproduct_Dohdnstkupvlya') || null,
        raw_fields: {
          source: 'os-table',
          productid: cellText(tr, 'productid') || null,
          category: cellText(tr, 'product_categoryname') || null,
          invested: cellText(tr, 'cusstom_Suma_PP') || null,
          buyback_price: cellText(tr, 'cusstomproduct_TSnavikupUK') || null,
        },
      });
    }
  }

  function extractFromDocument(doc) {
    if (!doc) return;

    extractOsTable(doc);

    doc.querySelectorAll('tr[data-productid]').forEach((tr) => {
      const text = tr.innerText.replace(/\\u00a0/g, ' ').replace(/\\s+/g, ' ').trim();
      const isinMatch = text.match(ISIN_RE);
      if (!isinMatch) return;

      const qtyInput = tr.querySelector('.js-client-buy-count, input[type="number"], input[name*="count" i]');
      const priceInput = tr.querySelector('.js-client-buy-price, .price, [class*="price"]');
      const titleEl = tr.querySelector('.product-name, .title, td:first-child, a');

      addItem({
        isin: isinMatch[0],
        title: titleEl?.innerText?.replace(/\\s+/g, ' ').trim() || null,
        quantity: parseQuantity(qtyInput?.value || qtyInput?.innerText || text),
        current_value: priceInput?.value || priceInput?.innerText || null,
        raw_fields: { source: 'data-productid', productid: tr.getAttribute('data-productid') },
      });
    });

    doc.querySelectorAll('table').forEach((table) => {
      const headerCells = [...table.querySelectorAll('thead th, thead td, tr th')];
      const headers = headerCells.length
        ? headerCells.map((h) => h.innerText.replace(/\\s+/g, ' ').trim().toLowerCase())
        : [];

      const qtyIdx = headers.findIndex((h) =>
        h.includes('кільк') || h.includes('qty') || h.includes('count') || h.includes('шт') || h.includes('обсяг'));
      const sumIdx = headers.findIndex((h) =>
        h.includes('сума') || h.includes('варт') || h.includes('amount') || h.includes('balance') || h.includes('номінал'));
      const yieldIdx = headers.findIndex((h) => h.includes('дохід') || h.includes('yield') || h.includes('ставк'));
      const matIdx = headers.findIndex((h) => h.includes('погаш') || h.includes('maturity') || h.includes('термін'));
      const nameIdx = headers.findIndex((h) =>
        h.includes('назв') || h.includes('name') || h.includes('емітент') || h.includes('папір') || h.includes('security'));

      for (const tr of table.querySelectorAll('tbody tr')) {
        const cells = [...tr.querySelectorAll('td')].map((td) =>
          td.innerText.replace(/\\u00a0/g, ' ').trim());
        if (!cells.length) continue;

        const rowText = cells.join(' ');
        const isinMatch = rowText.match(ISIN_RE);
        if (!isinMatch) continue;

        addItem({
          isin: isinMatch[0],
          title: nameIdx >= 0 ? cells[nameIdx] : cells.find((c) => c && !ISIN_RE.test(c) && c.length > 3) || null,
          quantity: qtyIdx >= 0 ? parseQuantity(cells[qtyIdx]) : parseQuantity(rowText),
          current_value: sumIdx >= 0 ? cells[sumIdx] : null,
          yield_percent: yieldIdx >= 0 ? cells[yieldIdx] : null,
          maturity_date: matIdx >= 0 ? cells[matIdx] : null,
          raw_fields: headers.length
            ? Object.fromEntries(headers.map((h, i) => [h, cells[i] || '']))
            : { source: 'table-row', text: rowText.slice(0, 240) },
        });
      }
    });

    for (const row of doc.querySelectorAll('tr, [role="row"], .portfolio-row, .js-product-row, li, .w-dyn-item')) {
      const text = row.innerText.replace(/\\u00a0/g, ' ').replace(/\\s+/g, ' ').trim();
      const isinMatch = text.match(ISIN_RE);
      if (!isinMatch) continue;

      const numbers = [...text.matchAll(/\\b(\\d[\\d\\s]{0,7})\\b/g)]
        .map((m) => parseQuantity(m[1]))
        .filter((n) => n && n <= 100000);

      addItem({
        isin: isinMatch[0],
        title: null,
        quantity: numbers.length ? numbers[numbers.length - 1] : null,
        raw_fields: { source: 'row-scan', text: text.slice(0, 280) },
      });
    }
  }

  extractFromDocument(document);
  for (const iframe of document.querySelectorAll('iframe')) {
    try {
      extractFromDocument(iframe.contentDocument);
    } catch (_err) {
      // cross-origin iframe
    }
  }

  return items;
})()`;

module.exports = {
  CLICK_UNIVER_MENU_JS,
  CLICK_UNIVER_PORTFOLIO_TAB_JS,
  PREPARE_UNIVER_PORTFOLIO_JS,
  COLLECT_UNIVER_PORTFOLIO_URLS_JS,
  EXTRACT_UNIVER_PORTFOLIO_JS,
};
