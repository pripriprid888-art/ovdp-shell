const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { extractProductsCatalogFromHtml, parseProductsRowParagraphs } = require('../../src/scanners/univer-products-parse');
const { processRawItems, resolveCatalogBuyPrice, PRODUCTS_URL } = require('../../src/scanners/univer');

describe('Univer products catalog scrape', () => {
  it('parses OVDP rows from the public products page', async () => {
    const tmpFile = path.join(os.tmpdir(), `univer-products-${Date.now()}.html`);
    execFileSync('curl', ['-sL', '-A', 'Mozilla/5.0', PRODUCTS_URL, '-o', tmpFile], {
      stdio: 'pipe',
    });
    const html = fs.readFileSync(tmpFile, 'utf8');
    fs.unlinkSync(tmpFile);

    const rawItems = extractProductsCatalogFromHtml(html);
    assert.ok(rawItems.length >= 10, `expected catalog bonds, got ${rawItems.length}`);

    const sample = rawItems.find((item) => item.isin === 'UA4000207518');
    assert.ok(sample, 'expected UA4000207518 in public catalog');
    assert.equal(sample.currency, 'UAH');
    assert.equal(sample.maturity_date, '2027-05-26');
    assert.equal(sample.price, '1003.9');

    const proposals = processRawItems(rawItems);
    const proposal = proposals.find((item) => item.isin === 'UA4000207518');
    assert.ok(proposal?.buy_price, 'processed proposal should include buy_price');
    assert.equal(proposal.source_url, PRODUCTS_URL);
    assert.match(proposal.yield_percent || '', /%/);
  });

  it('parses paragraph order from sample row markup', () => {
    const item = parseProductsRowParagraphs([
      '207518',
      'UAH',
      'UA4000207518',
      '1003.9',
      '2027-05-26',
      '15.15',
    ]);
    assert.equal(item.isin, 'UA4000207518');
    assert.equal(item.name, '207518');
    assert.equal(item.price, '1003.9');
  });
});

describe('Univer.resolveCatalogBuyPrice', () => {
  it('prefers buy price column value over generic price', () => {
    const formatted = resolveCatalogBuyPrice({ price: '1 003,90' });
    assert.match(formatted, /1[\s\u00a0]?003,90/);
  });
});

describe('Univer.processRawItems', () => {
  it('stores unit buy price from catalog scrape', () => {
    const [bond] = processRawItems([{
      isin: 'UA4000207518',
      name: '0528',
      maturity_date: '28.05.2028',
      yield_percent: '16,5',
      yield_type: 'YTM',
      price: '1 003,90',
      productid: '123',
    }]);

    assert.equal(bond.isin, 'UA4000207518');
    assert.match(bond.buy_price, /1[\s\u00a0]?003,90/);
    assert.equal(bond.calculator.unitPriceUah, 1003.9);
  });

  it('does not treat nominal-only fallback as buy price when buy column is present', () => {
    const [bond] = processRawItems([{
      isin: 'UA4000207518',
      name: '0528',
      maturity_date: '28.05.2028',
      yield_percent: '16,5',
      price: '1 003,90',
      productid: '123',
    }]);

    assert.notEqual(bond.calculator.unitPriceUah, 1000);
    assert.equal(bond.calculator.unitPriceUah, 1003.9);
  });
});
