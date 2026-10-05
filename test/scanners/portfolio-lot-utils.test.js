const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { parsePrice } = require('../../src/bond-calculator');
const { processPortfolioItems } = require('../../src/scanners/portfolio/process');
const {
  extractPurchaseDate,
  portfolioLotKey,
  mergePortfolioScanItems,
} = require('../../src/scanners/portfolio/lot-utils');

describe('portfolio lot helpers', () => {
  it('extracts purchase date from raw field labels', () => {
    const date = extractPurchaseDate({
      raw_fields: { 'дата купівлі': '15.03.2024' },
    });
    assert.equal(date, '2024-03-15');
  });

  it('does not multiply line total buy_price by quantity again for portfolio sum', () => {
    const [holding] = processPortfolioItems([{
      isin: 'UA4000207518',
      quantity: 3,
      buy_price: '3 011,70 ₴',
      nominal_value: 1000,
    }], 'inzhur', 'https://www.inzhur.reit/dashboard');

    assert.ok(Math.abs(holding.calculator.unitPriceUah - 1003.9) < 0.02);
    assert.equal(parsePrice(holding.portfolio_value), 3011.7);
  });

  it('keeps separate lots with the same ISIN', () => {
    const items = processPortfolioItems([
      {
        isin: 'UA4000118757',
        quantity: 2,
        purchase_date: '2024-03-15',
        raw_fields: { productid: '111' },
      },
      {
        isin: 'UA4000118757',
        quantity: 3,
        purchase_date: '2024-06-20',
        raw_fields: { productid: '222' },
      },
    ], 'univer', 'https://univer.1b.app/client/');

    assert.equal(items.length, 2);
    assert.equal(items[0].purchase_date, '2024-03-15');
    assert.equal(items[1].quantity, 3);
    assert.notEqual(items[0].lot_id, items[1].lot_id);
  });

  it('builds stable lot keys', () => {
    const key = portfolioLotKey({
      isin: 'UA4000118757',
      purchase_date: '2024-03-15',
      quantity: 2,
      raw_fields: { productid: '111' },
    }, 'univer');
    assert.match(key, /UA4000118757/);
    assert.match(key, /2024-03-15/);
  });

  it('keeps multiple UNIVER rows with the same ISIN during scan merge', () => {
    const isin = 'UA4000207518';
    const merged = mergePortfolioScanItems([
      {
        isin,
        quantity: 1,
        raw_fields: { source: 'os-table', row_index: 1, productid: 'a' },
      },
      {
        isin,
        quantity: 2,
        raw_fields: { source: 'os-table', row_index: 2, productid: 'b' },
      },
      {
        isin,
        quantity: 3,
        raw_fields: { source: 'os-table', row_index: 3, productid: 'c' },
      },
    ], 'univer');

    assert.equal(merged.length, 3);
    assert.deepEqual(merged.map((item) => item.quantity), [1, 2, 3]);
  });
});
