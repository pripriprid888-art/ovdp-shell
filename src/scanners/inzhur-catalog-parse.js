const OVDP_ISIN_RE = /^UA4000\d{6}$/;

function deepResolveRoot(root, value) {
  if (typeof value === 'number') {
    const entry = root[value];
    if (entry == null) return value;
    if (typeof entry === 'number' || typeof entry === 'string' || typeof entry === 'boolean') {
      return entry;
    }
    if (Array.isArray(entry) && entry[0] === 0) return deepResolveRoot(root, entry[1]);
    if (Array.isArray(entry) && entry[0] === 1) {
      return entry[1].map((item) => deepResolveRoot(root, item));
    }
    if (typeof entry === 'object') {
      const out = {};
      for (const [key, nested] of Object.entries(entry)) {
        out[key] = deepResolveRoot(root, nested);
      }
      return out;
    }
    return entry;
  }
  if (Array.isArray(value)) return value.map((item) => deepResolveRoot(root, item));
  if (value && typeof value === 'object') {
    const out = {};
    for (const [key, nested] of Object.entries(value)) {
      out[key] = deepResolveRoot(root, nested);
    }
    return out;
  }
  return value;
}

function parseFlightCatalogRoot(root) {
  const isFlightRoot = Array.isArray(root)
    && (root[0] === 'Map' || (Array.isArray(root[0]) && root[0][0] === 'Map'));
  if (!isFlightRoot) return [];

  const items = [];
  for (const entry of root) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) continue;
    if (typeof entry.id !== 'number' || typeof entry.details !== 'number') continue;

    const details = deepResolveRoot(root, entry.details);
    const isin = String(details?.isin || '').trim();
    if (!/^UA4000\d{6}$/.test(isin)) continue;

    const type = deepResolveRoot(root, entry.type);
    if (type !== 'bond') continue;

    const status = deepResolveRoot(root, entry.status);
    if (status && status !== 'active') continue;

    const availableQty = Number(details.availableQuantity);
    if (!Number.isFinite(availableQty) || availableQty <= 0) continue;

    const prices = details.prices || {};
    const rates = details.returnRates || {};

    items.push({
      asset_id: String(entry.id),
      isin,
      yield_percent: rates.buy ?? rates.sell ?? null,
      maturity_date: details.maturityDate || null,
      buy_price: prices.buyUAH ?? prices.buy ?? null,
      sell_price: prices.sellUAH ?? prices.sell ?? null,
      available_count: details.availableQuantity ?? null,
      payment_schedule: Array.isArray(details.paymentSchedule) ? details.paymentSchedule : [],
      status: status || null,
      tag: /Спеціальна/i.test(String(details.title || '')) ? 'Спеціальна пропозиція' : null,
      title: details.title || null,
      has_invest_button: status === 'active' && Number(details.availableQuantity) > 0,
      invest_button_disabled: !(status === 'active' && Number(details.availableQuantity) > 0),
    });
  }

  return items;
}

function decodeFlightChunk(text) {
  const start = text.indexOf('[["Map"');
  if (start < 0) return null;

  let depth = 0;
  let end = -1;
  for (let i = start; i < text.length; i += 1) {
    if (text[i] === '[') depth += 1;
    else if (text[i] === ']') {
      depth -= 1;
      if (depth === 0) {
        end = i + 1;
        break;
      }
    }
  }
  if (end < 0) return null;

  try {
    const parsed = JSON.parse(text.slice(start, end));
    if (Array.isArray(parsed) && parsed.length === 1 && Array.isArray(parsed[0]) && parsed[0][0] === 'Map') {
      return parsed[0];
    }
    return parsed;
  } catch {
    return null;
  }
}

function extractCatalogFromHtml(html) {
  const scripts = String(html || '').match(/<script[^>]*>([\s\S]*?)<\/script>/gi) || [];
  for (const scriptTag of scripts) {
    const text = scriptTag.replace(/^<script[^>]*>/i, '').replace(/<\/script>$/i, '');
    if (!text.includes('[["Map"') || !text.includes('UA4000')) continue;
    const root = decodeFlightChunk(text);
    const items = parseFlightCatalogRoot(root);
    if (items.length) return items;
  }
  return [];
}

function cleanDomText(value) {
  return String(value || '').replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim();
}

function parseDomDesktopCardHtml(cardHtml) {
  const isin = cardHtml.match(/UA4000\d{6}/)?.[0] || null;
  if (!isin) return null;

  const yieldMatch = cardHtml.match(/data-testid="bond-units-yield-value"[^>]*>\s*([^<]+)/);
  const maturityMatch = cardHtml.match(/data-testid="bond-units-maturity-value"[^>]*>\s*([^<]+)/);
  const priceMatches = [...cardHtml.matchAll(/>([\d\s]+,\d{2})\s*(?:&#8381;|₴)/g)]
    .map((match) => `${cleanDomText(match[1])} ₴`);
  const qtyMatch = cardHtml.match(
    />([\d][\d\s]*)<\/span><\/div><div class="justify-center w-108[^"]*"[^>]*><(?:a|button)[^>]*data-testid="bond-units-invest-button"/,
  );
  const investMatch = cardHtml.match(/data-testid="bond-units-invest-button"([^>]*)>/);
  const assetMatch = cardHtml.match(/assetId=(\d+)/i);
  const isSpecial = /Спеціальна пропозиція/i.test(cardHtml);
  const investDisabled = investMatch ? /\bdisabled\b/i.test(investMatch[1]) : true;

  return {
    asset_id: assetMatch ? assetMatch[1] : null,
    isin,
    yield_percent: yieldMatch ? cleanDomText(yieldMatch[1]) : null,
    maturity_date: maturityMatch ? cleanDomText(maturityMatch[1]) : null,
    buy_price: priceMatches[0] || null,
    sell_price: priceMatches[1] || null,
    available_count: qtyMatch ? cleanDomText(qtyMatch[1]) : null,
    payment_schedule: [],
    status: investDisabled ? null : 'active',
    tag: isSpecial ? 'Спеціальна пропозиція' : null,
    title: `ОВДП ${isin}`,
    has_invest_button: !!investMatch,
    invest_button_disabled: investDisabled,
    is_special_offer: isSpecial,
    raw_fields: { source: 'dom-desktop-card' },
  };
}

function extractDomCatalogFromHtml(html) {
  const text = String(html || '');
  const parts = text.split('data-testid="bond-units-desktop-card"');
  if (parts.length <= 1) return [];

  const items = [];
  const seen = new Set();
  for (const chunk of parts.slice(1)) {
    const cardHtml = chunk.split('data-testid="bond-units-desktop-card"')[0];
    const end = cardHtml.search(/data-testid="bond-units-invest-button"/);
    const bounded = end >= 0 ? cardHtml.slice(0, end + 420) : cardHtml.slice(0, 4000);
    const item = parseDomDesktopCardHtml(bounded);
    if (item && !seen.has(item.isin)) {
      seen.add(item.isin);
      items.push(item);
    }
  }
  return items;
}

function mergeCatalogByIsin(primary, secondary) {
  const domDisplayFields = [
    'yield_percent',
    'maturity_date',
    'is_special_offer',
    'tag',
    'has_invest_button',
    'invest_button_disabled',
  ];
  const byIsin = new Map();
  for (const item of primary) {
    if (item?.isin) byIsin.set(item.isin, { ...item });
  }
  for (const item of secondary) {
    if (!item?.isin) continue;
    const existing = byIsin.get(item.isin);
    if (!existing) {
      byIsin.set(item.isin, { ...item });
      continue;
    }
    for (const [key, value] of Object.entries(item)) {
      if (existing[key] == null || existing[key] === '') {
        existing[key] = value;
      }
    }
    if (String(item.raw_fields?.source || '').startsWith('dom-')) {
      for (const field of domDisplayFields) {
        if (item[field] != null && item[field] !== '') {
          existing[field] = item[field];
        }
      }
    }
  }
  return [...byIsin.values()];
}

function extractInzhurCatalogFromHtml(html) {
  const embedded = extractCatalogFromHtml(html);
  const dom = extractDomCatalogFromHtml(html);
  return mergeCatalogByIsin(embedded, dom);
}

module.exports = {
  OVDP_ISIN_RE,
  deepResolveRoot,
  parseFlightCatalogRoot,
  decodeFlightChunk,
  extractCatalogFromHtml,
  extractDomCatalogFromHtml,
  mergeCatalogByIsin,
  extractInzhurCatalogFromHtml,
};
