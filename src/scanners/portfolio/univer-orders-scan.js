const UNIVER_BASE = 'https://univer.1b.app';
const ORDERS_URL = `${UNIVER_BASE}/client/myorders/blok-bek/`;
const {
  EXTRACT_UNIVER_ORDERS_JS,
  ORDERS_WAIT_SELECTOR,
} = require('./univer-orders-extract');
const {
  fetchOrderDocumentIdForOrder,
  isUniverOrderDownloadable,
} = require('../../univer/order-document');

function processRawOrders(rawItems) {
  return (rawItems || []).map((item) => {
    const href = item.detail_href || `/client/order/${item.order_id}/`;
    const source = href.startsWith('http') ? href : `${UNIVER_BASE}${href.startsWith('/') ? href : `/${href}`}`;
    const documentId = item.document_id ? String(item.document_id) : null;

    return {
      site_id: 'univer',
      kind: 'order',
      order_id: String(item.order_id || ''),
      document_id: documentId,
      title: String(item.order_id || '—'),
      service_type: item.service_type || '',
      parameters: item.parameters || '',
      stage: item.stage || '',
      stage_color: item.stage_color || '',
      created_at: item.created_at || '',
      total: item.total || '',
      buy_price: item.total || null,
      source_url: source,
      document_downloadable: Boolean(documentId) || isUniverOrderDownloadable(item.stage),
      is_buyable: false,
      tag: item.stage || 'Замовлення',
    };
  });
}

async function enrichRawOrdersWithDocumentIds(webContents, rawItems) {
  const enriched = [];
  for (const item of rawItems || []) {
    let document_id = item.document_id ? String(item.document_id) : null;
    if (!document_id && item.order_id && isUniverOrderDownloadable(item.stage)) {
      try {
        document_id = await fetchOrderDocumentIdForOrder(webContents, item.order_id);
      } catch {
        document_id = null;
      }
      await new Promise((resolve) => setTimeout(resolve, 400));
    }
    enriched.push({ ...item, document_id });
  }
  return enriched;
}

module.exports = {
  ORDERS_URL,
  ORDERS_WAIT_SELECTOR,
  EXTRACT_UNIVER_ORDERS_JS,
  processRawOrders,
  enrichRawOrdersWithDocumentIds,
};
