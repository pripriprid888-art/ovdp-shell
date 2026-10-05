const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
  buildUniverTopUpFormUrl,
  buildPaymentUrlFromId,
  parseCreatePayByCompanyResponse,
  resolveUniverTopUpQuery,
  resolveUniverContractNumber,
} = require('../../src/scanners/privat-biplan');
const { PRIVAT_UNIVER_BIPLAN_QUERY } = require('../../src/shared/constants');

describe('buildUniverTopUpFormUrl', () => {
  it('builds encoded Privat24 payment form URL', () => {
    const url = buildUniverTopUpFormUrl('UA063052990000026500026200741');
    assert.match(url, /^https:\/\/next\.privat24\.ua\/payments\/form\//);
    assert.match(decodeURIComponent(url), /4842305/);
    assert.match(decodeURIComponent(url), /UA063052990000026500026200741/);
  });
});

describe('parseCreatePayByCompanyResponse', () => {
  const formUrl = buildUniverTopUpFormUrl('UA063052990000026500026200741');

  it('returns payment URL from API payload', () => {
    const parsed = parseCreatePayByCompanyResponse({
      status: 'success',
      data: { url: 'https://next.privat24.ua/payments/abc123' },
    }, { formUrl });
    assert.equal(parsed.ok, true);
    assert.equal(parsed.paymentUrl, 'https://next.privat24.ua/payments/abc123');
  });

  it('falls back to form URL on success without redirect', () => {
    const parsed = parseCreatePayByCompanyResponse({ status: 'success', data: {} }, { formUrl });
    assert.equal(parsed.ok, true);
    assert.equal(parsed.paymentUrl, formUrl);
    assert.equal(parsed.formOnly, true);
  });

  it('maps API errors', () => {
    const parsed = parseCreatePayByCompanyResponse({
      status: 'error',
      message: 'session expired',
      error_code: 42,
    }, { formUrl });
    assert.equal(parsed.ok, false);
    assert.equal(parsed.error, 'session expired');
    assert.equal(parsed.errorCode, 42);
  });
});

describe('buildPaymentUrlFromId', () => {
  it('builds payment URL from id fields', () => {
    assert.equal(
      buildPaymentUrlFromId({ paymentId: 'pay-1' }),
      'https://next.privat24.ua/payments/pay-1',
    );
  });
});

describe('resolveUniverTopUpQuery', () => {
  it('prefers explicit query, then onboarding IBAN, then default', () => {
    assert.equal(resolveUniverTopUpQuery({ queryString: 'UA111' }), 'UA111');
    assert.equal(resolveUniverTopUpQuery({
      onboardingState: { sites: { univer: { topUpIban: 'UA222' } } },
    }), 'UA222');
    assert.equal(resolveUniverTopUpQuery({}), PRIVAT_UNIVER_BIPLAN_QUERY);
  });
});

describe('resolveUniverContractNumber', () => {
  it('prefers explicit contract, then onboarding, then scanned account', () => {
    assert.equal(resolveUniverContractNumber({ contractNumber: 'БО-1' }), 'БО-1');
    assert.equal(resolveUniverContractNumber({
      onboardingState: { sites: { univer: { topUpContract: 'БО-2' } } },
    }), 'БО-2');
    assert.equal(resolveUniverContractNumber({
      accountInfo: { contract_number: 'БО-3' },
    }), 'БО-3');
    assert.equal(resolveUniverContractNumber({}), '');
  });
});
