const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const BondCalendar = require('../src/bond-calendar');

describe('BondCalendar quantities', () => {
  const record = {
    isin: 'UA4000230809',
    bond_type: 'Test bond',
    payments: [
      { date: '2026-06-01', amount: 80, payment_type: 'coupon' },
      { date: '2027-01-01', amount: 1000, payment_type: 'maturity' },
    ],
  };

  it('scales coupon amounts by bond quantity', () => {
    const events = BondCalendar.calendarBuildEvents([record], {}, {
      bondQty: { UA4000230809: 5 },
    });
    const coupon = events.find((event) => event.payment_type === 'coupon');
    assert.equal(coupon.scaledAmount, 400);
    assert.equal(coupon.bondQuantity, 5);
  });

  it('sums scaled coupons for a calendar day', () => {
    const events = BondCalendar.calendarBuildEvents([record], {}, {
      bondQty: { UA4000230809: 5 },
    });
    const total = BondCalendar.calendarDayCouponTotal(events);
    assert.equal(total, 400);
  });

  it('excludes bonds with zero quantity', () => {
    const events = BondCalendar.calendarBuildEvents([record], {}, {
      bondQty: { UA4000230809: 0 },
    });
    assert.equal(events.length, 0);
  });
});
