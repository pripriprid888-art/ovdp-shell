/** UNIVER order history — table.os-table on blok-bek page. */

const EXTRACT_UNIVER_ORDERS_JS = String.raw`(() => {
  const table = document.querySelector('table.os-table');
  if (!table) return [];

  return [...table.querySelectorAll('tbody tr[data-orderid]')].map((row) => {
    const orderId = row.getAttribute('data-orderid') || '';
    const cells = [...row.querySelectorAll(':scope > td')];
    const detailLink = row.querySelector('a.js-load-show');
    const stageEl = row.querySelector('.ob-wf-stage');
    const paramsEl = row.querySelector('.nb-table-prod-wrap');

    return {
      order_id: orderId,
      detail_href: detailLink?.getAttribute('href') || null,
      service_type: (cells[1]?.innerText || '').replace(/\s+/g, ' ').trim(),
      parameters: (paramsEl?.innerText || cells[2]?.innerText || '').replace(/\s+/g, ' ').trim(),
      stage: (stageEl?.innerText || cells[3]?.innerText || '').replace(/\s+/g, ' ').trim(),
      stage_color: stageEl?.style?.backgroundColor || '',
      created_at: (cells[4]?.innerText || '').replace(/\s+/g, ' ').trim(),
      total: (cells[5]?.innerText || '').replace(/\s+/g, ' ').trim(),
    };
  }).filter((item) => item.order_id);
})()`;

const ORDERS_WAIT_SELECTOR = 'table.os-table tbody tr[data-orderid]';

module.exports = {
  EXTRACT_UNIVER_ORDERS_JS,
  ORDERS_WAIT_SELECTOR,
};
