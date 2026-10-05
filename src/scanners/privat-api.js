/** Privat24 bonds JSON API (init, pub/bonds catalog, bonds briefcase portfolio). */

const INIT_API_PATH = '/api/p24/init';
const BONDS_API_PATH = '/api/p24/pub/bonds';
const AUTH_BONDS_API_PATH = '/api/p24/bonds';
const DEFAULT_PRIVAT_BOND_SOURCE = 3;

/** Runs inside next.privat24.ua — init sets pubkey cookie, then bargaining returns catalog. */
const FETCH_BARGAINING_BONDS_JS = String.raw`(() => {
  const apiHeaders = {
    Accept: 'application/json, text/plain, */*',
    'Content-Type': 'application/json',
  };

  function readXref(payload) {
    const xref = payload?.data?.xref;
    return typeof xref === 'string' && /^[a-f0-9]{32}$/i.test(xref) ? xref : '';
  }

  function fetchBargaining(xref) {
    return fetch('/api/p24/pub/bonds', {
      method: 'POST',
      credentials: 'include',
      headers: apiHeaders,
      body: JSON.stringify({
        action: 'bargaining',
        xref,
        _: Date.now(),
      }),
    })
      .then((response) => response.json().then((data) => ({
        ok: response.ok,
        status: response.status,
        data,
        xref,
      })))
      .catch((err) => ({ ok: false, error: String(err?.message || err), xref }));
  }

  const ts = Date.now();
  return fetch('/api/p24/init?lang=ua', {
    method: 'POST',
    credentials: 'include',
    headers: apiHeaders,
    body: JSON.stringify({ lang: 'ua', _: ts }),
  })
    .then((response) => response.json().then((initData) => {
      const xref = readXref(initData);
      if (!xref) {
        return {
          ok: false,
          error: initData?.message || 'init_no_xref',
          errorCode: initData?.error_code ?? null,
          data: initData,
          xref: '',
        };
      }
      return fetchBargaining(xref);
    }))
    .catch((err) => ({ ok: false, error: String(err?.message || err), xref: '' }));
})()`;

function pickBondArray(payload) {
  if (!payload || typeof payload !== 'object') return [];
  if (payload.status === 'error') return [];

  const root = payload.data;
  if (Array.isArray(root)) return root;
  if (root && typeof root === 'object') {
    for (const key of ['bonds', 'items', 'list', 'rows', 'result', 'bargaining']) {
      if (Array.isArray(root[key])) return root[key];
    }
  }
  return [];
}

function readField(record, keys) {
  for (const key of keys) {
    const value = record?.[key];
    if (value != null && value !== '') return value;
  }
  return null;
}

function mapApiBond(record) {
  const isin = readField(record, ['isin', 'ISIN', 'Isin', 'code', 'securityCode']);
  if (!isin) return null;

  const currency = readField(record, ['currency', 'ccy', 'Currency']);
  const buyPrice = readField(record, ['buyPrice', 'price_raw', 'price', 'cost', 'amount']);
  const buyYield = readField(record, ['buyYield', 'yield_raw', 'yield', 'yieldPercent', 'profitability', 'rate']);

  return {
    isin: String(isin).trim().toUpperCase(),
    name: readField(record, ['name', 'title', 'securityName', 'emitent', 'issuer']) || null,
    maturity_date: readField(record, ['maturity_date', 'maturityDate', 'maturity', 'date', 'redemptionDate']) || null,
    price_raw: buyPrice,
    yield_raw: buyYield,
    currency: currency ? String(currency).trim().toUpperCase() : null,
    raw_fields: {
      ...record,
      source: 'api',
      bondSource: readField(record, ['source', 'buySource', 'bondSource']),
    },
  };
}

function parseBargainingApiResponse(apiResult) {
  const payload = apiResult?.data;
  if (!payload || payload.status === 'error') {
    return {
      items: [],
      error: payload?.message || apiResult?.error || 'api_error',
      errorCode: payload?.error_code ?? null,
      xref: apiResult?.xref || null,
    };
  }

  const items = pickBondArray(payload)
    .map(mapApiBond)
    .filter(Boolean);

  return {
    items,
    error: items.length ? null : 'api_empty',
    errorCode: null,
    xref: apiResult?.xref || null,
  };
}

/** Signed-in catalog: POST /api/p24/bonds action=bargaining (SPA authenticated path). */
const FETCH_AUTH_BARGAINING_BONDS_JS = String.raw`(() => {
  const apiHeaders = {
    Accept: 'application/json, text/plain, */*',
    'Content-Type': 'application/json',
  };

  function readXref(payload) {
    const xref = payload?.data?.xref;
    return typeof xref === 'string' && /^[a-f0-9]{32}$/i.test(xref) ? xref : '';
  }

  function fetchAuthBargaining(xref) {
    return fetch('/api/p24/bonds', {
      method: 'POST',
      credentials: 'include',
      headers: apiHeaders,
      body: JSON.stringify({
        action: 'bargaining',
        xref,
        _: Date.now(),
      }),
    })
      .then((response) => response.json().then((data) => ({
        ok: response.ok,
        status: response.status,
        data,
        xref,
      })))
      .catch((err) => ({ ok: false, error: String(err?.message || err), xref }));
  }

  const ts = Date.now();
  return fetch('/api/p24/init?lang=ua', {
    method: 'POST',
    credentials: 'include',
    headers: apiHeaders,
    body: JSON.stringify({ lang: 'ua', _: ts }),
  })
    .then((response) => response.json().then((initData) => {
      const xref = readXref(initData);
      if (!xref) {
        return {
          ok: false,
          error: initData?.message || 'init_no_xref',
          errorCode: initData?.error_code ?? null,
          data: initData,
          xref: '',
        };
      }
      return fetchAuthBargaining(xref);
    }))
    .catch((err) => ({ ok: false, error: String(err?.message || err), xref: '' }));
})()`;

/** Signed-in portfolio: GET /api/p24/bonds?action=briefcase. */
const FETCH_BRIEFCASE_BONDS_JS = String.raw`(() => {
  const apiHeaders = {
    Accept: 'application/json, text/plain, */*',
    'Content-Type': 'application/json',
  };

  function readXref(payload) {
    const xref = payload?.data?.xref;
    return typeof xref === 'string' && /^[a-f0-9]{32}$/i.test(xref) ? xref : '';
  }

  function fetchBriefcase(xref) {
    const query = new URLSearchParams({
      action: 'briefcase',
      xref,
      _: String(Date.now()),
    });
    return fetch('/api/p24/bonds?' + query, {
      method: 'GET',
      credentials: 'include',
      headers: apiHeaders,
    })
      .then((response) => response.json().then((data) => ({
        ok: response.ok,
        status: response.status,
        data,
        xref,
      })))
      .catch((err) => ({ ok: false, error: String(err?.message || err), xref }));
  }

  const ts = Date.now();
  return fetch('/api/p24/init?lang=ua', {
    method: 'POST',
    credentials: 'include',
    headers: apiHeaders,
    body: JSON.stringify({ lang: 'ua', _: ts }),
  })
    .then((response) => response.json().then((initData) => {
      const xref = readXref(initData);
      if (!xref) {
        return {
          ok: false,
          error: initData?.message || 'init_no_xref',
          errorCode: initData?.error_code ?? null,
          data: initData,
          xref: '',
        };
      }
      return fetchBriefcase(xref);
    }))
    .catch((err) => ({ ok: false, error: String(err?.message || err), xref: '' }));
})()`;

function readBriefcaseAccounts(payload) {
  if (!payload || typeof payload !== 'object') return [];
  if (payload.status === 'error') return [];
  if (Array.isArray(payload.accounts)) return payload.accounts;
  if (Array.isArray(payload.data?.accounts)) return payload.data.accounts;
  return [];
}

function sumDealAmounts(balance) {
  const deals = balance?.salesDeals;
  if (Array.isArray(deals) && deals.length) {
    return deals.reduce((total, deal) => {
      const amount = Number(deal?.amount);
      return Number.isFinite(amount) ? total + amount : total;
    }, 0);
  }
  const amount = Number(balance?.amount);
  return Number.isFinite(amount) ? amount : null;
}

function mapBriefcaseBalance(balance, account, deal = null) {
  const isin = readField(balance, ['isin', 'ISIN', 'Isin']);
  if (!isin) return null;

  const currency = readField(balance, ['currency', 'ccy', 'Currency']);
  if (currency && String(currency).trim().toUpperCase() !== 'UAH') return null;

  const quantity = deal
    ? Number(deal?.amount)
    : sumDealAmounts(balance);
  if (!Number.isFinite(quantity) || quantity <= 0) return null;

  const totalPrice = deal
    ? readField(deal, ['totalPrice', 'total_price', 'amountTotal', 'price'])
    : readField(balance, ['totalPrice', 'total_price', 'amountTotal']);
  const buyDetails = balance?.buyDetails && typeof balance.buyDetails === 'object'
    ? balance.buyDetails
    : null;

  return {
    isin: String(isin).trim().toUpperCase(),
    title: readField(balance, ['name', 'title', 'securityName']) || null,
    quantity,
    purchase_date: readField(deal, ['date', 'buyDate', 'purchaseDate', 'dealDate', 'createdAt'])
      || readField(buyDetails, ['date', 'buyDate', 'purchaseDate', 'dealDate'])
      || null,
    maturity_date: readField(balance, ['maturity', 'maturityDate', 'maturity_date']) || null,
    yield_percent: readField(buyDetails, ['yield', 'buyYield', 'yieldPercent']) || null,
    portfolio_value: totalPrice,
    raw_fields: {
      source: 'api-briefcase',
      account: account?.number || null,
      currency: currency || 'UAH',
      totalPrice,
      buyDetails,
      deal,
      coupons: balance?.coupons || null,
    },
  };
}

function flattenBriefcaseItems(payload) {
  const items = [];

  for (const account of readBriefcaseAccounts(payload)) {
    for (const balance of account?.balances || []) {
      const deals = Array.isArray(balance?.salesDeals) ? balance.salesDeals : [];
      if (deals.length) {
        for (const deal of deals) {
          const item = mapBriefcaseBalance(balance, account, deal);
          if (item) items.push(item);
        }
        continue;
      }

      const item = mapBriefcaseBalance(balance, account);
      if (item) items.push(item);
    }
  }

  return items;
}

function readNumericField(record, keys) {
  for (const key of keys) {
    const value = record?.[key];
    if (value == null || value === '') continue;
    const n = Number(String(value).replace(/\s/g, '').replace(',', '.'));
    if (Number.isFinite(n)) return n;
  }
  return null;
}

function unwrapCommissionsPayload(payload) {
  if (!payload || typeof payload !== 'object') return null;
  if (payload.status === 'error') return null;

  const candidates = [
    payload.data,
    payload.commissions,
    payload.result,
    payload,
  ];

  for (const candidate of candidates) {
    if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) continue;
    if (
      readNumericField(candidate, ['total', 'totalAmount', 'totalPrice', 'sum', 'amount', 'paymentAmount', 'toPay']) != null
      || readNumericField(candidate, ['commission', 'fee', 'bankCommission', 'brokerCommission']) != null
    ) {
      return candidate;
    }
  }

  return payload.data && typeof payload.data === 'object' ? payload.data : payload;
}

function resolvePrivatBondSource(bond) {
  const raw = bond?.raw_fields || {};
  const fromRaw = raw.bondSource ?? raw.source ?? raw.buySource;
  const parsed = Number(fromRaw);
  if (Number.isFinite(parsed) && parsed > 0) return parsed;
  return DEFAULT_PRIVAT_BOND_SOURCE;
}

function parseCommissionsApiResponse(apiResult, meta = {}) {
  const payload = apiResult?.data;
  if (!payload || payload.status === 'error') {
    return {
      ok: false,
      error: payload?.message || apiResult?.error || 'api_error',
      errorCode: payload?.error_code ?? null,
      xref: apiResult?.xref || null,
      ...meta,
    };
  }

  const root = unwrapCommissionsPayload(payload);
  const bondPrice = readNumericField(root, [
    'bondPrice', 'bondsPrice', 'price', 'cost', 'nominalPrice', 'amountWithoutCommission',
  ]);
  const commission = readNumericField(root, [
    'commission', 'fee', 'bankCommission', 'brokerCommission', 'tax', 'serviceFee',
  ]);
  let total = readNumericField(root, [
    'total', 'totalAmount', 'totalPrice', 'sum', 'amount', 'paymentAmount', 'toPay', 'debitAmount',
  ]);

  if (total == null && bondPrice != null && commission != null) {
    total = bondPrice + commission;
  }

  const count = Math.max(1, Number(meta.count) || 1);
  const unitPrice = bondPrice != null && count > 0 ? bondPrice / count : null;

  if (total == null && bondPrice == null && commission == null) {
    return {
      ok: false,
      error: 'commissions_empty',
      errorCode: null,
      xref: apiResult?.xref || null,
      ...meta,
    };
  }

  return {
    ok: true,
    error: null,
    errorCode: null,
    xref: apiResult?.xref || null,
    total,
    bondPrice,
    commission,
    unitPrice,
    ...meta,
  };
}

/** Runs inside next.privat24.ua purchase page context. */
function buildFetchCommissionsJs({ isin, count = 1, source = DEFAULT_PRIVAT_BOND_SOURCE }) {
  const normalizedIsin = String(isin || '').trim().toUpperCase();
  const qty = Math.max(1, Number(count) || 1);
  const bondSource = Number(source) || DEFAULT_PRIVAT_BOND_SOURCE;

  return String.raw`(() => {
  const apiHeaders = {
    Accept: 'application/json, text/plain, */*',
    'Content-Type': 'application/json',
  };

  function readXref(payload) {
    const xref = payload?.data?.xref;
    return typeof xref === 'string' && /^[a-f0-9]{32}$/i.test(xref) ? xref : '';
  }

  function fetchCommissions(xref) {
    return fetch('/api/p24/bonds', {
      method: 'POST',
      credentials: 'include',
      headers: apiHeaders,
      body: JSON.stringify({
        isin: ${JSON.stringify(normalizedIsin)},
        count: ${qty},
        source: ${bondSource},
        xref,
        action: 'commissions',
        _: Date.now(),
      }),
    })
      .then((response) => response.json().then((data) => ({
        ok: response.ok,
        status: response.status,
        data,
        xref,
      })))
      .catch((err) => ({ ok: false, error: String(err?.message || err), xref }));
  }

  const ts = Date.now();
  return fetch('/api/p24/init?lang=ua', {
    method: 'POST',
    credentials: 'include',
    headers: apiHeaders,
    body: JSON.stringify({ lang: 'ua', _: ts }),
  })
    .then((response) => response.json().then((initData) => {
      const xref = readXref(initData);
      if (!xref) {
        return {
          ok: false,
          error: initData?.message || 'init_no_xref',
          errorCode: initData?.error_code ?? null,
          data: initData,
          xref: '',
        };
      }
      return fetchCommissions(xref);
    }))
    .catch((err) => ({ ok: false, error: String(err?.message || err), xref: '' }));
})()`;
}

function parseBriefcaseApiResponse(apiResult) {
  const payload = apiResult?.data;
  if (!payload || payload.status === 'error') {
    return {
      items: [],
      error: payload?.message || apiResult?.error || 'api_error',
      errorCode: payload?.error_code ?? null,
      xref: apiResult?.xref || null,
    };
  }

  const items = flattenBriefcaseItems(payload);
  return {
    items,
    error: null,
    errorCode: null,
    xref: apiResult?.xref || null,
  };
}

module.exports = {
  INIT_API_PATH,
  BONDS_API_PATH,
  AUTH_BONDS_API_PATH,
  FETCH_BARGAINING_BONDS_JS,
  FETCH_AUTH_BARGAINING_BONDS_JS,
  FETCH_BRIEFCASE_BONDS_JS,
  DEFAULT_PRIVAT_BOND_SOURCE,
  parseBargainingApiResponse,
  parseBriefcaseApiResponse,
  parseCommissionsApiResponse,
  resolvePrivatBondSource,
  buildFetchCommissionsJs,
  pickBondArray,
  mapApiBond,
  flattenBriefcaseItems,
};
