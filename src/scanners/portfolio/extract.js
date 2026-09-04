/** Generic portfolio extractor — runs on authenticated cabinet pages. */
const EXTRACT_PORTFOLIO_JS = `(() => {
  const ISIN_RE = /UA\\d{10}/;
  const items = [];
  const seen = new Set();

  function parseQuantity(text) {
    if (!text) return null;
    const match = String(text).match(/(\\d[\\d\\s.,]*)/);
    if (!match) return null;
    const n = parseInt(match[1].replace(/[^\\d]/g, ''), 10);
    return Number.isFinite(n) && n > 0 ? n : null;
  }

  function addItem(partial) {
    const isin = partial.isin;
    if (!isin || seen.has(isin)) return;
    seen.add(isin);
    items.push(partial);
  }

  document.querySelectorAll('.investment-unit[data-asset-id]').forEach((card) => {
    const text = card.innerText.replace(/\\s+/g, ' ');
    const isinMatch = text.match(ISIN_RE);
    if (!isinMatch) return;

    const fields = {};
    card.querySelectorAll('.unit-values').forEach((row) => {
      const label = (row.querySelector('.up_case')?.innerText || '').toLowerCase();
      const value = (row.querySelector('strong')?.innerText || '')
        .replace(/\\u00a0/g, ' ')
        .trim();
      if (label) fields[label] = value;
    });

    addItem({
      isin: isinMatch[0],
      title: (card.querySelector('.title')?.innerText || '').replace(/\\s+/g, ' ').trim() || null,
      quantity: parseQuantity(
        fields['кількість']
        || fields['кіл-сть']
        || fields['доступно облігацій']
        || fields.quantity,
      ),
      nominal_value: fields['номінал'] || fields['номінальна вартість'] || null,
      current_value: fields['вартість']
        || fields['сума']
        || fields['поточна вартість']
        || fields['вартість купівлі']
        || null,
      yield_percent: fields['дохідність'] || null,
      maturity_date: fields['дата погашення'] || null,
      asset_id: card.getAttribute('data-asset-id'),
      raw_fields: fields,
    });
  });

  document.querySelectorAll('table').forEach((table) => {
    const headerCells = [...table.querySelectorAll('thead th, tr th')];
    if (!headerCells.length) return;

    const headers = headerCells.map((h) => h.innerText.replace(/\\s+/g, ' ').trim().toLowerCase());
    const isinIdx = headers.findIndex((h) => h.includes('isin'));
    if (isinIdx < 0) return;

    const qtyIdx = headers.findIndex((h) =>
      h.includes('кільк') || h.includes('qty') || h.includes('count') || h.includes('шт'));
    const sumIdx = headers.findIndex((h) =>
      h.includes('сума') || h.includes('варт') || h.includes('amount') || h.includes('balance'));
    const yieldIdx = headers.findIndex((h) => h.includes('дохід') || h.includes('yield'));
    const matIdx = headers.findIndex((h) => h.includes('погаш') || h.includes('maturity'));
    const nameIdx = headers.findIndex((h) =>
      h.includes('назв') || h.includes('name') || h.includes('папір') || h.includes('security'));

    for (const tr of table.querySelectorAll('tbody tr')) {
      const cells = [...tr.querySelectorAll('td')].map((td) =>
        td.innerText.replace(/\\u00a0/g, ' ').trim());
      if (!cells.length) continue;

      const isinCell = cells[isinIdx] || '';
      const isinMatch = isinCell.match(ISIN_RE);
      if (!isinMatch) continue;

      addItem({
        isin: isinMatch[0],
        title: nameIdx >= 0 ? cells[nameIdx] : (cells[0] !== isinMatch[0] ? cells[0] : null),
        quantity: qtyIdx >= 0 ? parseQuantity(cells[qtyIdx]) : null,
        current_value: sumIdx >= 0 ? cells[sumIdx] : null,
        yield_percent: yieldIdx >= 0 ? cells[yieldIdx] : null,
        maturity_date: matIdx >= 0 ? cells[matIdx] : null,
        raw_fields: Object.fromEntries(headers.map((h, i) => [h, cells[i] || ''])),
      });
    }
  });

  for (const el of document.querySelectorAll('[data-isin], [data-bond-isin]')) {
    const isin = el.getAttribute('data-isin') || el.getAttribute('data-bond-isin');
    if (!isin || !ISIN_RE.test(isin)) continue;
    addItem({
      isin: isin.match(ISIN_RE)[0],
      title: el.getAttribute('data-title') || el.querySelector('.title')?.innerText?.trim() || null,
      quantity: parseQuantity(el.getAttribute('data-quantity') || el.innerText),
      raw_fields: { source: 'data-attribute' },
    });
  }

  return items;
})()`;

module.exports = {
  EXTRACT_PORTFOLIO_JS,
};
