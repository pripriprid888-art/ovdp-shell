const UNIVER_BASE = 'https://univer.1b.app';
const ORDERS_URL = `${UNIVER_BASE}/client/myorders/blok-bek/`;
const {
  EXTRACT_UNIVER_ORDERS_JS,
  ORDERS_WAIT_SELECTOR,
} = require('./univer-orders-extract');

function processRawOrders(rawItems) {
  return (rawItems || []).map((item) => {
    const href = item.detail_href || `/client/order/${item.order_id}/`;
    const source = href.startsWith('http') ? href : `${UNIVER_BASE}${href.startsWith('/') ? href : `/${href}`}`;

    return {
      site_id: 'univer',
      kind: 'order',
      order_id: String(item.order_id || ''),
      title: String(item.order_id || '—'),
      service_type: item.service_type || '',
      parameters: item.parameters || '',
      stage: item.stage || '',
      stage_color: item.stage_color || '',
      created_at: item.created_at || '',
      total: item.total || '',
      buy_price: item.total || null,
      source_url: source,
      is_buyable: false,
      tag: item.stage || 'Замовлення',
    };
  });
}

module.exports = {
  ORDERS_URL,
  ORDERS_WAIT_SELECTOR,
  EXTRACT_UNIVER_ORDERS_JS,
  processRawOrders,
};
