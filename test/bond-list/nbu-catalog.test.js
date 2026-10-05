const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
  getNbuRecords,
  buildBrokerAvailabilityIndex,
  matchesIsinOrTitleSearch,
  filterNbuRecordsBySearch,
  filterCatalogGroupsBySearch,
  getNbuPaymentSchedule,
  getNextCouponPayment,
  isNbuRecordInactive,
  sumNbuSchedulePayments,
  nbuCouponColumnCount,
} = require('../../src/bond-list/nbu-catalog');

describe('getNbuRecords', () => {
  it('returns only UAH records sorted by maturity', () => {
    const data = {
      nbu_reference: {
        by_isin: {
          A: { isin: 'UA2', currency: 'UAH', maturity_date: '2028-01-01' },
          B: { isin: 'UA1', currency: 'UAH', maturity_date: '2027-01-01' },
          C: { isin: 'US1', currency: 'USD', maturity_date: '2027-01-01' },
        },
      },
    };

    const records = getNbuRecords(data);
    assert.equal(records.length, 2);
    assert.equal(records[0].isin, 'UA1');
  });
});

describe('buildBrokerAvailabilityIndex', () => {
  it('indexes site availability by ISIN', () => {
    const index = buildBrokerAvailabilityIndex([
      { isin: 'ua4000118757', site_id: 'privat' },
      { isin: 'UA4000118757', site_id: 'inzhur' },
    ]);
    assert.deepEqual([...index.UA4000118757], ['privat', 'inzhur']);
  });
});

describe('filterNbuRecordsBySearch', () => {
  const records = [
    { isin: 'UA4000118757', bond_type: 'ОВДП 2028' },
    { isin: 'UA4000118758', bond_type: 'Інша' },
  ];

  it('filters by ISIN fragment', () => {
    const filtered = filterNbuRecordsBySearch(records, '8757');
    assert.equal(filtered.length, 1);
    assert.equal(filtered[0].isin, 'UA4000118757');
  });

  it('filters by title fragment', () => {
    const filtered = filterNbuRecordsBySearch(records, 'інша');
    assert.equal(filtered.length, 1);
  });

  it('matches full ISIN case-insensitively', () => {
    assert.equal(
      matchesIsinOrTitleSearch(records[0], 'ua4000118757'),
      true,
    );
  });

  it('matches ISIN without UA prefix', () => {
    assert.equal(matchesIsinOrTitleSearch(records[0], '4000118757'), true);
  });

  it('returns all records for blank query', () => {
    assert.equal(filterNbuRecordsBySearch(records, '   ').length, records.length);
  });
});

describe('filterCatalogGroupsBySearch', () => {
  const groups = [
    {
      isin: 'UA4000118757',
      title: 'ОВДП 2028',
      listings: [
        { isin: 'UA4000118757', title: 'Inzhur listing', site_id: 'inzhur' },
        { isin: 'UA4000118757', title: 'Privat listing', site_id: 'privat' },
      ],
    },
    {
      isin: 'UA4000118758',
      title: 'Інша серія',
      listings: [{ isin: 'UA4000118758', title: 'UNIVER', site_id: 'univer' }],
    },
  ];

  it('filters by group ISIN', () => {
    const filtered = filterCatalogGroupsBySearch(groups, '8757');
    assert.equal(filtered.length, 1);
    assert.equal(filtered[0].isin, 'UA4000118757');
  });

  it('filters by listing title when group title differs', () => {
    const filtered = filterCatalogGroupsBySearch(groups, 'privat listing');
    assert.equal(filtered.length, 1);
    assert.equal(filtered[0].isin, 'UA4000118757');
  });
});

describe('getNbuPaymentSchedule', () => {
  it('normalizes coupon and maturity payments', () => {
    const schedule = getNbuPaymentSchedule({
      payments: [
        { date: '2027-06-01', amount: 50, payment_type: 'coupon' },
        { date: '2028-01-01', amount: 1000, pay_type: '2' },
      ],
    });

    assert.equal(schedule.length, 2);
    assert.equal(schedule[0].payment_type, 'coupon');
    assert.equal(schedule[1].payment_type, 'maturity');
  });
});

describe('getNextCouponPayment', () => {
  it('returns first future coupon', () => {
    const farFuture = new Date();
    farFuture.setFullYear(farFuture.getFullYear() + 2);
    const y = farFuture.getFullYear();
    const m = String(farFuture.getMonth() + 1).padStart(2, '0');
    const d = String(farFuture.getDate()).padStart(2, '0');

    const next = getNextCouponPayment({
      payments: [
        { date: '2000-01-01', amount: 1, payment_type: 'coupon' },
        { date: `${y}-${m}-${d}`, amount: 50, payment_type: 'coupon' },
      ],
    });

    assert.equal(next.amount, 50);
  });
});

describe('isNbuRecordInactive', () => {
  it('marks zero circulation as inactive', () => {
    assert.equal(isNbuRecordInactive({ circulation: 0 }), true);
  });

  it('marks matured bonds as inactive', () => {
    assert.equal(isNbuRecordInactive({ maturity_date: '2000-01-01', circulation: 100 }), true);
  });
});

describe('sumNbuSchedulePayments', () => {
  it('sums numeric payment amounts', () => {
    const total = sumNbuSchedulePayments([
      { amount: 10 },
      { amount: '20,5' },
    ]);
    assert.equal(total, 30.5);
  });

  it('sums only future payments when futureOnly is set', () => {
    const total = sumNbuSchedulePayments([
      { amount: 170, isPast: true },
      { amount: 80, isPast: false },
      { amount: 1000, isPast: false },
    ], { futureOnly: true });
    assert.equal(total, 1080);
  });

  it('sums full schedule including past coupons', () => {
    const total = sumNbuSchedulePayments([
      { amount: 170, isPast: true },
      { amount: 80, isPast: false },
      { amount: 1000, isPast: false },
    ]);
    assert.equal(total, 1250);
  });
});

describe('nbuCouponColumnCount', () => {
  it('rounds up column count', () => {
    assert.equal(nbuCouponColumnCount(5), 1);
    assert.equal(nbuCouponColumnCount(6), 2);
    assert.equal(nbuCouponColumnCount(0), 0);
  });
});
