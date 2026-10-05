const { PRIVAT_ORIGIN } = require('../shared/constants');
const { postInit, postBonds } = require('../shared/privat-session-api');
const {
  DEFAULT_PRIVAT_BOND_SOURCE,
  parseCommissionsApiResponse,
  resolvePrivatBondSource,
} = require('./privat-api');

async function fetchPrivatCommissions(getSession, options = {}) {
  const isin = String(options.isin || '').trim().toUpperCase();
  if (!isin) {
    return { ok: false, error: 'missing_isin' };
  }

  const count = Math.max(1, Number(options.count) || 1);
  const source = Number(options.source) || DEFAULT_PRIVAT_BOND_SOURCE;
  const sess = getSession('privat');

  const initResult = await postInit(sess);
  if (!initResult.ok) {
    return {
      ok: false,
      error: initResult.reason || 'init_failed',
      errorCode: initResult.errorCode ?? null,
      isin,
      count,
      source,
    };
  }

  const referer = `${PRIVAT_ORIGIN}/bonds/purchase/${encodeURIComponent(isin)}`;
  const { response, data } = await postBonds(sess, {
    isin,
    count,
    source,
    xref: initResult.xref,
    action: 'commissions',
    _: Date.now(),
  }, referer);

  if (!response.ok) {
    return {
      ok: false,
      error: `http_${response.status}`,
      errorCode: null,
      xref: initResult.xref,
      isin,
      count,
      source,
    };
  }

  return parseCommissionsApiResponse(
    { ok: true, data, xref: initResult.xref },
    { isin, count, source },
  );
}

module.exports = {
  fetchPrivatCommissions,
  resolvePrivatBondSource,
};
