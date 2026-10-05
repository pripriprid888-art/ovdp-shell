const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const BondCalculator = require('../src/bond-calculator');

describe('BondCalculator.computeProjection', () => {
  it('computes purchase total from nominal and price percent', () => {
    const result = BondCalculator.computeProjection({
      nominal: 1000,
      quantity: 2,
      couponRate: 10,
      pricePct: 98,
      years: 1,
      paymentsPerYear: 2,
      maturityDate: '2027-01-01',
      settleDate: new Date('2026-01-01'),
    });

    assert.equal(result.purchaseTotal, 1960);
    assert.ok(result.totalCoupons > 0);
    assert.ok(Number.isFinite(result.ytm));
  });

  it('counts only coupon inflows in totalCoupons when final flow includes nominal', () => {
    const result = BondCalculator.computeProjection({
      nominal: 1000,
      quantity: 1,
      couponRate: 10,
      pricePct: 100,
      years: 1,
      paymentsPerYear: 2,
      maturityDate: '2027-01-01',
      settleDate: new Date('2026-01-01'),
    });

    assert.equal(result.couponPerPayment, 50);
    assert.equal(result.totalCoupons, 100);
    assert.equal(result.totalCoupons + result.faceTotal, result.totalReturn + result.purchaseTotal);
  });

  it('builds cash flows from payment schedule without explicit maturity date', () => {
    const result = BondCalculator.computeProjection({
      nominal: 1000,
      quantity: 1,
      couponRate: 10,
      pricePct: 100,
      years: 0,
      paymentsPerYear: 2,
      maturityDate: null,
      paymentSchedule: [
        { date: '2026-07-01', amount: 50, payment_type: 'coupon' },
        { date: '2027-01-01', amount: 1050, payment_type: 'maturity' },
      ],
      settleDate: new Date('2026-01-01'),
    });

    assert.ok(result.cashFlows.length > 1);
    assert.equal(result.totalCoupons, 100);
    assert.equal(result.faceTotal, 1000);
    assert.equal(result.totalReturn, 100);
    assert.ok(result.purchaseTotal > 0);
  });
});

describe('BondCalculator.normalizeScheduleEntry', () => {
  it('splits combined maturity payment into coupon and principal', () => {
    const entry = BondCalculator.normalizeScheduleEntry(
      { date: '2027-01-01', amount: 1050, payment_type: 'maturity' },
      1000,
    );
    assert.equal(entry.coupon, 50);
    assert.equal(entry.principal, 1000);
  });

  it('uses explicit coupon and principal fields when provided', () => {
    const entry = BondCalculator.normalizeScheduleEntry(
      { date: '2027-01-01', coupon: '80', principal: '1000' },
      1000,
    );
    assert.equal(entry.coupon, 80);
    assert.equal(entry.principal, 1000);
  });
});

describe('BondCalculator.filterFutureScheduleEntries', () => {
  it('excludes past coupon payments from cash flows', () => {
    const future = BondCalculator.filterFutureScheduleEntries(
      [
        { date: '2020-01-01', amount: 50, payment_type: 'coupon' },
        { date: '2027-07-01', amount: 80, payment_type: 'coupon' },
        { date: '2028-01-01', amount: 1080, payment_type: 'maturity' },
      ],
      1000,
      new Date('2026-01-01'),
    );
    assert.equal(future.length, 2);
    assert.equal(future[0].coupon, 80);
    assert.equal(future[1].coupon, 80);
    assert.equal(future[1].principal, 1000);
  });
});

describe('BondCalculator audit-style hold-to-maturity example', () => {
  it('matches profit from schedule and clean price (10 × 980)', () => {
    const result = BondCalculator.computeProjection({
      nominal: 1000,
      quantity: 10,
      couponRate: 16,
      pricePct: 98,
      years: 0,
      paymentsPerYear: 2,
      maturityDate: '2027-01-01',
      paymentSchedule: [
        { date: '2026-07-02', coupon: '80', principal: '0' },
        { date: '2027-01-01', coupon: '80', principal: '1000' },
      ],
      settleDate: new Date('2026-01-01'),
    });

    assert.equal(result.purchaseTotal, 9800);
    assert.equal(result.totalCoupons, 1600);
    assert.equal(result.capitalGainAbs, 200);
    assert.equal(result.totalReturn, 1800);
    assert.ok(Math.abs(result.totalReturnPct - (1800 / 9800) * 100) < 0.01);
  });
});

describe('BondCalculator.toCalculatorQuoteContext', () => {
  it('keeps seller quotes distinct for the same ISIN', () => {
    const schedule = [
      { date: '2027-01-01', amount: 1000, payment_type: 'maturity' },
    ];
    const privat = BondCalculator.toCalculatorQuoteContext({
      isin: 'UA4000230809',
      site_id: 'privat',
      buy_price: 980,
      nominal_value: 1000,
      yield_percent: '16',
      payment_schedule: schedule,
    }, { scheduleSource: 'nbu' });
    const univer = BondCalculator.toCalculatorQuoteContext({
      isin: 'UA4000230809',
      site_id: 'univer',
      buy_price: 1003,
      nominal_value: 1000,
      yield_percent: '15.2',
      payment_schedule: schedule,
    }, { scheduleSource: 'nbu' });

    assert.equal(privat.quoteKey, 'privat:UA4000230809');
    assert.equal(univer.quoteKey, 'univer:UA4000230809');
    assert.equal(privat.unitPriceUah, 980);
    assert.equal(univer.unitPriceUah, 1003);
    assert.equal(privat.couponFromListedYtm, false);
    assert.notEqual(privat.listedYtm, univer.listedYtm);
  });

  it('does not use listed yield as coupon rate without schedule inference', () => {
    const ctx = BondCalculator.toCalculatorQuoteContext({
      isin: 'UA4000230809',
      site_id: 'univer',
      buy_price: 1000,
      nominal_value: 1000,
      yield_percent: '16',
      payment_schedule: [],
    });
    assert.equal(ctx.couponRate, 0);
    assert.equal(ctx.couponFromListedYtm, false);
    assert.equal(ctx.listedYtm, 16);
  });
});

describe('BondCalculator.resolveUnitBuyPrice', () => {
  it('detects total price stored as buy_price for multi-qty lots', () => {
    const unit = BondCalculator.resolveUnitBuyPrice({
      buy_price: 1960,
      quantity: 2,
    }, 1000);
    assert.equal(unit, 980);
  });
});

describe('BondCalculator.sumScheduleReceipts', () => {
  it('returns full and upcoming coupon plus principal totals', () => {
    const schedule = [
      { date: '2020-01-01', amount: 170, payment_type: 'coupon' },
      { date: '2027-01-01', amount: 1080, payment_type: 'maturity' },
    ];
    const settle = new Date('2026-01-01');
    const all = BondCalculator.sumScheduleReceipts(schedule, 1000, 1, { settle });
    const upcoming = BondCalculator.sumScheduleReceipts(schedule, 1000, 1, { settle, futureOnly: true });
    assert.equal(all, 1250);
    assert.equal(upcoming, 1080);
  });
});

describe('BondCalculator.inferPaymentsPerYear', () => {
  it('infers semiannual schedule from coupon dates', () => {
    const count = BondCalculator.inferPaymentsPerYear({
      payment_schedule: [
        { payment_type: 'coupon', date: '2026-06-01' },
        { payment_type: 'coupon', date: '2026-12-01' },
        { payment_type: 'coupon', date: '2027-06-01' },
      ],
    });
    assert.equal(count, 2);
  });
});
