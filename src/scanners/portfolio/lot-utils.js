const { normalizePurchaseDate } = require('../../bond-dates');

function readField(record, keys) {
  for (const key of keys) {
    const value = record?.[key];
    if (value != null && value !== '') return value;
  }
  return null;
}

function extractPurchaseDate(item = {}) {
  if (item.purchase_date) {
    return normalizePurchaseDate(item.purchase_date);
  }

  const fields = item.raw_fields || {};
  for (const [key, value] of Object.entries(fields)) {
    const label = String(key || '').toLowerCase();
    if (!value) continue;
    if (/дата\s*(куп|покуп|придб|операц|tran)|purchase|buy.?date|deal.?date/i.test(label)) {
      const normalized = normalizePurchaseDate(value);
      if (normalized) return normalized;
    }
  }

  const buyDetails = fields.buyDetails;
  if (buyDetails && typeof buyDetails === 'object') {
    const nested = readField(buyDetails, ['date', 'buyDate', 'purchaseDate', 'dealDate', 'createdAt']);
    const normalized = normalizePurchaseDate(nested);
    if (normalized) return normalized;
  }

  return null;
}

function portfolioLotKey(item, siteId) {
  return [
    siteId,
    String(item.isin || '').trim().toUpperCase(),
    readField(item.raw_fields, ['source']) || '',
    readField(item.raw_fields, ['row_index', 'rowIndex']) || '',
    readField(item.raw_fields, ['productid', 'productId']) || item.asset_id || '',
    extractPurchaseDate(item) || '',
    item.quantity ?? '',
    item.portfolio_value ?? item.current_value ?? item.buy_price ?? '',
  ].join('|');
}

function mergePortfolioScanItems(items, siteId) {
  const seen = new Set();
  const merged = [];
  for (const item of items || []) {
    if (!item?.isin) continue;
    const key = portfolioLotKey(item, siteId);
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push(item);
  }
  return merged;
}

module.exports = {
  readField,
  extractPurchaseDate,
  portfolioLotKey,
  mergePortfolioScanItems,
};
