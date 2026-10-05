const OVDP_ISIN_RE = /^UA4000\d{6}$/;

function parseProductsRowParagraphs(paragraphs) {
  const texts = (paragraphs || [])
    .map((value) => String(value || '').replace(/\u00a0/g, ' ').trim())
    .filter(Boolean);
  if (texts.length < 6) return null;

  const [name, currency, isin, price, maturity_date, yield_percent] = texts;
  if (!OVDP_ISIN_RE.test(isin)) return null;
  if (currency !== 'UAH') return null;

  return {
    isin,
    name,
    currency,
    price,
    maturity_date,
    yield_percent,
    yield_type: null,
    productid: name || null,
  };
}

function extractProductsSection(html) {
  const source = String(html || '');
  const start = source.indexOf('investdataovdp');
  if (start < 0) return source;

  const nextSection = source.indexOf('class="investdata', start + 20);
  return nextSection > start ? source.slice(start, nextSection) : source.slice(start);
}

function extractProductsCatalogFromHtml(html) {
  const section = extractProductsSection(html);
  const results = [];
  const seen = new Set();
  const paragraphRe = /<p[^>]*class="[^"]*paragraph18-copy[^"]*"[^>]*>([^<]*)<\/p>/gi;
  const paragraphs = [...section.matchAll(paragraphRe)].map((match) => match[1].trim());

  for (let index = 0; index + 5 < paragraphs.length; index += 6) {
    const item = parseProductsRowParagraphs(paragraphs.slice(index, index + 6));
    if (!item || seen.has(item.isin)) continue;
    seen.add(item.isin);
    results.push(item);
  }

  return results;
}

module.exports = {
  OVDP_ISIN_RE,
  parseProductsRowParagraphs,
  extractProductsSection,
  extractProductsCatalogFromHtml,
};
