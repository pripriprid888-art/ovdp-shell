const {
  PRIVAT_ORIGIN,
  PRIVAT_UNIVER_BIPLAN_COMPANY_ID,
  PRIVAT_UNIVER_BIPLAN_QUERY,
} = require('../shared/constants');
const { postInit, postBiplan } = require('../shared/privat-session-api');

function pickFirstString(values) {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return '';
}

function buildUniverTopUpFormPayload(companyId, queryString) {
  return {
    companyID: String(companyId),
    form: { query: String(queryString) },
  };
}

function buildUniverTopUpFormUrl(queryString, companyId = PRIVAT_UNIVER_BIPLAN_COMPANY_ID) {
  const payload = buildUniverTopUpFormPayload(companyId, queryString);
  return `${PRIVAT_ORIGIN}/payments/form/${encodeURIComponent(JSON.stringify(payload))}`;
}

function buildPaymentUrlFromId(payload = {}) {
  const id = payload.paymentId
    || payload.payment_id
    || payload.payId
    || payload.id;
  if (!id) return '';
  return `${PRIVAT_ORIGIN}/payments/${encodeURIComponent(String(id))}`;
}

function parseCreatePayByCompanyResponse(data, { formUrl } = {}) {
  if (!data || typeof data !== 'object') {
    return { ok: false, error: 'empty_response' };
  }

  if (data.status === 'error') {
    return {
      ok: false,
      error: data.message || data.error_message || 'biplan_error',
      errorCode: data.error_code ?? null,
      raw: data,
    };
  }

  const payload = data.data && typeof data.data === 'object' ? data.data : data;
  const paymentUrl = pickFirstString([
    payload.url,
    payload.redirectUrl,
    payload.paymentUrl,
    payload.nextUrl,
    payload.link,
    payload.payUrl,
    payload.href,
    buildPaymentUrlFromId(payload),
  ]);

  if (paymentUrl) {
    return { ok: true, paymentUrl, formUrl, raw: data };
  }

  if (data.status === 'success' || payload.result === 'success') {
    return {
      ok: true,
      paymentUrl: formUrl,
      formOnly: true,
      raw: data,
    };
  }

  return { ok: false, error: 'unexpected_response', raw: data };
}

function resolveUniverTopUpQuery({ queryString, onboardingState } = {}) {
  const direct = String(queryString || '').trim();
  if (direct) return direct;

  const fromOnboarding = String(
    onboardingState?.sites?.univer?.topUpIban
    || onboardingState?.sites?.univer?.topUpQuery
    || '',
  ).trim();
  if (fromOnboarding.startsWith('UA')) return fromOnboarding;

  return PRIVAT_UNIVER_BIPLAN_QUERY;
}

function resolveUniverContractNumber({ contractNumber, onboardingState, accountInfo } = {}) {
  const direct = String(contractNumber || '').trim();
  if (direct) return direct;

  const fromOnboarding = String(
    onboardingState?.sites?.univer?.topUpContract
    || onboardingState?.sites?.univer?.topUpQuery
    || '',
  ).trim();
  if (fromOnboarding && !fromOnboarding.startsWith('UA')) return fromOnboarding;

  const fromAccount = String(accountInfo?.contract_number || '').trim();
  if (fromAccount) return fromAccount;

  return '';
}

async function createUniverTopUpPayment(getSession, options = {}) {
  const queryString = String(options.queryString || '').trim();
  const companyID = String(options.companyId || PRIVAT_UNIVER_BIPLAN_COMPANY_ID);

  const formUrl = queryString
    ? buildUniverTopUpFormUrl(queryString, companyID)
    : '';

  if (!queryString) {
    return { ok: false, error: 'missing_query', companyID, formUrl };
  }

  const sess = getSession('privat');
  const initResult = await postInit(sess);
  if (!initResult.ok) {
    return {
      ok: false,
      error: initResult.reason || 'init_failed',
      errorCode: initResult.errorCode ?? null,
      companyID,
      queryString,
      formUrl,
    };
  }
  const { response, data } = await postBiplan(sess, {
    action: 'createPayByCompany',
    companyID,
    queryString,
    xref: initResult.xref,
    _: Date.now(),
  }, formUrl);

  if (!response.ok) {
    return {
      ok: false,
      error: `http_${response.status}`,
      companyID,
      queryString,
      formUrl,
      xref: initResult.xref,
    };
  }

  const parsed = parseCreatePayByCompanyResponse(data, { formUrl });
  return {
    ...parsed,
    companyID,
    queryString,
    formUrl,
    xref: initResult.xref,
  };
}

module.exports = {
  buildUniverTopUpFormPayload,
  buildUniverTopUpFormUrl,
  buildPaymentUrlFromId,
  parseCreatePayByCompanyResponse,
  resolveUniverTopUpQuery,
  resolveUniverContractNumber,
  createUniverTopUpPayment,
};
