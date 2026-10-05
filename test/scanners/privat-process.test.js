const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { processRawItems, mergeDomWithApiCatalog } = require('../../src/scanners/privat');

describe('Privat.processRawItems', () => {
  it('preserves full API payload in raw_fields', () => {
    const [proposal] = processRawItems([{
      isin: 'UA4000233704',
      currency: 'UAH',
      price_raw: 1079.95,
      yield_raw: 16.25,
      maturity_date: '14.04.2027',
      raw_fields: {
        source: 'api',
        isin: 'UA4000233704',
        maturity: '14.04.2027',
        termMaturity: '6 міс.',
        quotationDate: '06.10.2026',
        currency: 'UAH',
        yieldType: 'YTM',
        buyYield: 16.25,
        buyPrice: 1079.95,
        military: true,
        coupons: [{ type: 'Купон', value: 80.85, paymentDate: '14.10.2026' }],
      },
    }]);

    assert.equal(proposal.isin, 'UA4000233704');
    assert.equal(proposal.listed_yield_type, 'YTM');
    assert.equal(proposal.raw_fields.yieldType, 'YTM');
    assert.equal(proposal.raw_fields.military, true);
    assert.equal(proposal.raw_fields.buyPrice, 1079.95);
    assert.ok(Array.isArray(proposal.raw_fields.coupons));
  });

  it('keeps only ISINs present on bonds/list DOM', () => {
    const domRaw = [{
      isin: 'UA4000239016',
      name: 'ОВДП',
      maturity_date: '21.07.2027',
      price_raw: '1 032,37 ₴',
      yield_raw: '15,50%',
    }];
    const apiResult = {
      ok: true,
      data: {
        status: 'success',
        data: {
          bonds: [
            {
              isin: 'UA4000239016',
              currency: 'UAH',
              buyPrice: 1032.37,
              buyYield: 15.5,
              yieldType: 'YTM',
              maturity: '21.07.2027',
            },
            {
              isin: 'UA4000233704',
              currency: 'UAH',
              buyPrice: 1079.95,
              buyYield: 16.25,
              yieldType: 'YTM',
              maturity: '14.04.2027',
            },
          ],
        },
      },
    };

    const merged = mergeDomWithApiCatalog(domRaw, apiResult);
    assert.equal(merged.domCount, 1);
    assert.equal(merged.apiCount, 2);
    assert.equal(merged.droppedApiOnlyCount, 1);
    assert.equal(merged.proposals.length, 1);
    assert.equal(merged.proposals[0].isin, 'UA4000239016');
    assert.equal(merged.proposals[0].raw_fields.listed_on_bonds_page, true);
    assert.equal(merged.proposals[0].raw_fields.yieldType, 'YTM');
  });
});
