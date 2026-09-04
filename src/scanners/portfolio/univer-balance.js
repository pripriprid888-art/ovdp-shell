/** Extract broker account balance from UNIVER client home (Брокерські послуги). */
const EXTRACT_UNIVER_BALANCE_JS = `(() => {
  const BALANCE_LABEL = /мій баланс рахунку/i;
  const BROKER_SECTION = /брокерські послуги/i;

  function normalizeText(el) {
    return (el?.innerText || '').replace(/\\u00a0/g, ' ').replace(/\\s+/g, ' ').trim();
  }

  function parseMoney(text) {
    if (!text) return null;
    const cleaned = String(text).replace(/[^\\d.,\\s-]/g, '').replace(/\\s/g, '').replace(',', '.');
    const n = parseFloat(cleaned);
    return Number.isFinite(n) ? n : null;
  }

  function valueNearLabel(labelEl) {
    const row = labelEl.closest('tr, .row, .form-row, .field, .widget, li, dl, [class*="balance"], table, .panel, .card, .block');
    if (row) {
      const cells = [...row.querySelectorAll('td, strong, b, .value, span, div, p, input[readonly], input[disabled]')];
      for (const cell of cells) {
        if (cell === labelEl || labelEl.contains(cell)) continue;
        const text = normalizeText(cell);
        if (!text || BALANCE_LABEL.test(text)) continue;
        const amount = parseMoney(text);
        if (amount != null) return { text, amount };
      }
      const rowText = normalizeText(row).replace(BALANCE_LABEL, '').trim();
      const amount = parseMoney(rowText);
      if (amount != null) return { text: rowText, amount };
    }

    let sibling = labelEl.nextElementSibling;
    for (let i = 0; i < 4 && sibling; i += 1) {
      const text = normalizeText(sibling);
      const amount = parseMoney(text);
      if (amount != null) return { text, amount };
      sibling = sibling.nextElementSibling;
    }

    const parentText = normalizeText(labelEl.parentElement).replace(BALANCE_LABEL, '').trim();
    const parentAmount = parseMoney(parentText);
    if (parentAmount != null) return { text: parentText, amount: parentAmount };

    return null;
  }

  function findBrokerRoot(doc) {
    for (const el of doc.querySelectorAll('h1, h2, h3, h4, legend, .title, .header, section, .panel, .block, div')) {
      const text = normalizeText(el);
      if (!text || text.length > 80) continue;
      if (BROKER_SECTION.test(text)) {
        return el.closest('section, .panel, .block, .widget, .card, table, div') || el.parentElement || doc.body;
      }
    }
    return doc.body;
  }

  function scanDocument(doc) {
    let sectionFound = false;
    let balance = null;
    let balanceLabel = null;
    if (!doc) return { sectionFound, balance, balanceLabel };

    const root = findBrokerRoot(doc);
    if (root !== doc.body) sectionFound = true;

    for (const el of root.querySelectorAll('label, td, th, span, div, p, strong, b')) {
      const text = normalizeText(el);
      if (!text || text.length > 160) continue;
      if (BROKER_SECTION.test(text)) sectionFound = true;
      if (!BALANCE_LABEL.test(text)) continue;

      balanceLabel = text;
      const found = valueNearLabel(el);
      if (found) {
        balance = found;
        break;
      }
    }

    return { sectionFound, balance, balanceLabel };
  }

  let sectionFound = false;
  let balance = null;
  let balanceLabel = null;

  for (const doc of [document, ...[...document.querySelectorAll('iframe')].map((f) => {
    try { return f.contentDocument; } catch { return null; }
  }).filter(Boolean)]) {
    const result = scanDocument(doc);
    sectionFound = sectionFound || result.sectionFound;
    if (result.balance) {
      balance = result.balance;
      balanceLabel = result.balanceLabel;
      break;
    }
  }

  return {
    section: sectionFound ? 'Брокерські послуги' : null,
    balance_label: balanceLabel || 'Мій баланс рахунку, грн.',
    balance_uah: balance?.amount ?? null,
    balance_text: balance?.text ?? null,
  };
})()`;

module.exports = {
  EXTRACT_UNIVER_BALANCE_JS,
};
