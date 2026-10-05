const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
  normalizeIsin,
  escapeHtml,
  groupProposals,
  pickPrimaryListing,
  formatUniqueValues,
  sortBondGroups,
} = require('../../src/bond-list/grouping');

const SITE_ORDER = ['inzhur', 'univer', 'privat'];

describe('normalizeIsin', () => {
  it('trims and uppercases', () => {
    assert.equal(normalizeIsin(' ua4000118757 '), 'UA4000118757');
  });
});

describe('escapeHtml', () => {
  it('escapes HTML special characters', () => {
    assert.equal(escapeHtml('<script>"x"</script>'), '&lt;script&gt;&quot;x&quot;&lt;/script&gt;');
  });
});

describe('groupProposals', () => {
  it('groups listings by ISIN and picks buyable primary', () => {
    const proposals = [
      { isin: 'UA4000118757', site_id: 'inzhur', title: 'Inzhur', is_buyable: false, scanned_at: '2026-01-01' },
      { isin: 'UA4000118757', site_id: 'privat', title: 'Privat', is_buyable: true, scanned_at: '2026-01-02' },
      { isin: 'UA4000118758', site_id: 'univer', title: 'Other', is_buyable: true },
    ];

    const groups = groupProposals(proposals, {}, { siteOrder: SITE_ORDER });
    assert.equal(groups.length, 2);

    const grouped = groups.find((g) => g.isin === 'UA4000118757');
    assert.equal(grouped.listings.length, 2);
    assert.equal(grouped.primary.site_id, 'privat');
    assert.equal(grouped.is_buyable, true);
  });

  it('uses NBU reference title when broker title is generic', () => {
    const proposals = [{
      isin: 'UA4000118757',
      site_id: 'privat',
      title: 'Державні облігації',
      is_buyable: true,
    }];
    const nbuByIsin = {
      UA4000118757: { bond_type: 'ОВДП 2028' },
    };

    const [group] = groupProposals(proposals, nbuByIsin, { siteOrder: SITE_ORDER });
    assert.equal(group.title, 'ОВДП 2028');
  });
});

describe('pickPrimaryListing', () => {
  it('respects current source filter', () => {
    const listings = [
      { site_id: 'inzhur', is_buyable: true, scanned_at: '2026-01-02' },
      { site_id: 'privat', is_buyable: true, scanned_at: '2026-01-01' },
    ];
    const primary = pickPrimaryListing(listings, { currentSource: 'inzhur', siteOrder: SITE_ORDER });
    assert.equal(primary.site_id, 'inzhur');
  });
});

describe('formatUniqueValues', () => {
  it('joins multiple unique values', () => {
    assert.equal(formatUniqueValues(['A', 'B', 'A']), 'A / B');
    assert.equal(formatUniqueValues(['only']), 'only');
    assert.equal(formatUniqueValues([]), '—');
  });
});

describe('sortBondGroups', () => {
  const parseYield = (value) => parseFloat(String(value).replace(',', '.'));
  const parsePrice = (value) => parseFloat(String(value).replace(/[^\d.,-]/g, '').replace(',', '.'));

  it('sorts groups by best yield descending', () => {
    const groups = [
      { isin: 'UA4000000001', listings: [{ yield_percent: '10,0%' }] },
      { isin: 'UA4000000002', listings: [{ yield_percent: '12,5%' }] },
      { isin: 'UA4000000003', listings: [{ yield_percent: '11,0%' }] },
    ];

    const sorted = sortBondGroups(groups, { key: 'yield', dir: 'desc', parseYield, parsePrice });
    assert.deepEqual(sorted.map((group) => group.isin), [
      'UA4000000002',
      'UA4000000003',
      'UA4000000001',
    ]);
  });

  it('sorts groups by lowest buy price ascending', () => {
    const groups = [
      { isin: 'UA4000000001', listings: [{ buy_price: '1 010,50 ₴' }] },
      { isin: 'UA4000000002', listings: [{ buy_price: '995,00 ₴' }] },
      { isin: 'UA4000000003', listings: [{ buy_price: '1 002,00 ₴' }] },
    ];

    const sorted = sortBondGroups(groups, { key: 'price', dir: 'asc', parseYield, parsePrice });
    assert.deepEqual(sorted.map((group) => group.isin), [
      'UA4000000002',
      'UA4000000003',
      'UA4000000001',
    ]);
  });

  it('sorts groups by best total return on invested descending', () => {
    const groups = [
      { isin: 'UA4000000001', listings: [{ isin: 'UA4000000001' }] },
      { isin: 'UA4000000002', listings: [{ isin: 'UA4000000002' }, { isin: 'UA4000000002' }] },
      { isin: 'UA4000000003', listings: [{ isin: 'UA4000000003' }] },
    ];
    const parseTotalReturn = (bond) => ({
      UA4000000001: 8.5,
      UA4000000002: 12,
      UA4000000003: 10,
    }[bond.isin]);

    const sorted = sortBondGroups(groups, {
      key: 'totalReturn',
      dir: 'desc',
      parseYield,
      parsePrice,
      parseTotalReturn,
    });
    assert.deepEqual(sorted.map((group) => group.isin), [
      'UA4000000002',
      'UA4000000003',
      'UA4000000001',
    ]);
  });
});
