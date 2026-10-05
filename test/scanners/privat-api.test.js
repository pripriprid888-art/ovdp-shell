const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
  parseBargainingApiResponse,
  parseBriefcaseApiResponse,
  parseCommissionsApiResponse,
  resolvePrivatBondSource,
  mapApiBond,
  flattenBriefcaseItems,
} = require('../../src/scanners/privat-api');

describe('parseBargainingApiResponse', () => {
  it('maps bargaining bonds from nested payload', () => {
    const result = parseBargainingApiResponse({
      ok: true,
      xref: 'a1b2c3d4e5f6789012345678abcdef01',
      data: {
        status: 'success',
        data: {
          bonds: [{
            isin: 'ua4000118757',
            name: 'ОВДП test',
            buyPrice: 980.5,
            buyYield: 16.5,
            maturity_date: '01.01.2028',
          }],
        },
      },
    });

    assert.equal(result.error, null);
    assert.equal(result.items.length, 1);
    assert.equal(result.items[0].isin, 'UA4000118757');
    assert.equal(result.items[0].price_raw, 980.5);
  });

  it('returns error for api error status', () => {
    const result = parseBargainingApiResponse({
      data: { status: 'error', message: 'session_expired', error_code: 42 },
    });
    assert.deepEqual(result.items, []);
    assert.equal(result.error, 'session_expired');
    assert.equal(result.errorCode, 42);
  });
});

describe('parseBriefcaseApiResponse', () => {
  it('returns separate lots for each purchase deal', () => {
    const payload = {
      status: 'success',
      accounts: [{
        number: 'acc-1',
        balances: [{
          isin: 'ua4000118757',
          currency: 'UAH',
          salesDeals: [
            { amount: 2, date: '2024-03-15' },
            { amount: 1, date: '2024-06-20' },
          ],
          totalPrice: 3000,
        }],
      }, {
        number: 'acc-2',
        balances: [{
          isin: 'UA4000118757',
          currency: 'UAH',
          salesDeals: [{ amount: 1, date: '2025-01-10' }],
          totalPrice: 1000,
        }],
      }],
    };

    const result = parseBriefcaseApiResponse({ ok: true, data: payload });
    assert.equal(result.error, null);
    assert.equal(result.items.length, 3);
    assert.deepEqual(result.items.map((item) => item.quantity), [2, 1, 1]);
    assert.equal(result.items[0].purchase_date, '2024-03-15');
    assert.equal(result.items[2].purchase_date, '2025-01-10');
  });
});

describe('mapApiBond', () => {
  it('returns null when ISIN is missing', () => {
    assert.equal(mapApiBond({ name: 'No ISIN' }), null);
  });
});

describe('parseCommissionsApiResponse', () => {
  it('extracts total and commission from nested payload', () => {
    const result = parseCommissionsApiResponse({
      ok: true,
      xref: 'a1b2c3d4e5f6789012345678abcdef01',
      data: {
        status: 'success',
        data: {
          bondPrice: 980.5,
          commission: 19.61,
          total: 1000.11,
        },
      },
    }, { isin: 'UA4000239081', count: 1, source: 3 });

    assert.equal(result.ok, true);
    assert.equal(result.total, 1000.11);
    assert.equal(result.commission, 19.61);
    assert.equal(result.bondPrice, 980.5);
    assert.equal(result.unitPrice, 980.5);
  });

  it('derives total from bond price and commission', () => {
    const result = parseCommissionsApiResponse({
      data: {
        status: 'success',
        price: 2000,
        fee: 40,
      },
    }, { count: 2 });

    assert.equal(result.ok, true);
    assert.equal(result.total, 2040);
    assert.equal(result.commission, 40);
    assert.equal(result.unitPrice, 1000);
  });

  it('returns error for api error status', () => {
    const result = parseCommissionsApiResponse({
      data: { status: 'error', message: 'session_expired', error_code: 7 },
    });
    assert.equal(result.ok, false);
    assert.equal(result.error, 'session_expired');
    assert.equal(result.errorCode, 7);
  });
});

describe('resolvePrivatBondSource', () => {
  it('prefers numeric bondSource from raw fields', () => {
    assert.equal(resolvePrivatBondSource({ raw_fields: { bondSource: 3, source: 'api' } }), 3);
  });

  it('defaults to bargaining source', () => {
    assert.equal(resolvePrivatBondSource({ raw_fields: { source: 'api' } }), 3);
  });
});

describe('flattenBriefcaseItems', () => {
  it('skips non-UAH balances', () => {
    const items = flattenBriefcaseItems({
      accounts: [{
        balances: [{
          isin: 'UA4000118757',
          currency: 'USD',
          salesDeals: [{ amount: 5 }],
        }],
      }],
    });
    assert.deepEqual(items, []);
  });
});
