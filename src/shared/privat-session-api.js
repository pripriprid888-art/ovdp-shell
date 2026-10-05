const {
  CHROME_UA,
  PRIVAT_ORIGIN,
  PRIVAT_INIT_URL,
  PRIVAT_REFRESH_URL,
  PRIVAT_BONDS_URL,
  PRIVAT_BIPLAN_URL,
} = require('./constants');

function readXref(payload) {
  const xref = payload?.data?.xref;
  return typeof xref === 'string' && /^[a-f0-9]{32}$/i.test(xref) ? xref : '';
}

async function postJson(sess, url, body) {
  const { net } = require('electron');
  const response = await net.fetch(url, {
    session: sess,
    method: 'POST',
    headers: {
      'User-Agent': CHROME_UA,
      Accept: 'application/json, text/plain, */*',
      'Content-Type': 'application/json',
      Origin: PRIVAT_ORIGIN,
      Referer: `${PRIVAT_ORIGIN}/`,
    },
    body: JSON.stringify(body),
  });

  let data = null;
  try {
    data = await response.json();
  } catch {
    data = null;
  }

  return { response, data };
}

async function postInit(sess) {
  const { response, data } = await postJson(sess, PRIVAT_INIT_URL, { lang: 'ua', _: Date.now() });
  if (!response.ok) {
    return { ok: false, reason: `init_http_${response.status}`, xref: '' };
  }
  if (data?.status === 'error') {
    return {
      ok: false,
      reason: data.message || 'init_error',
      errorCode: data.error_code ?? null,
      xref: '',
    };
  }

  const xref = readXref(data);
  if (!xref) {
    return { ok: false, reason: 'init_no_xref', xref: '' };
  }

  return { ok: true, xref, data };
}

async function postBonds(sess, body, referer) {
  const { net } = require('electron');
  const purchaseReferer = referer || `${PRIVAT_ORIGIN}/bonds/list`;
  const response = await net.fetch(PRIVAT_BONDS_URL, {
    session: sess,
    method: 'POST',
    headers: {
      'User-Agent': CHROME_UA,
      Accept: 'application/json, text/plain, */*',
      'Content-Type': 'application/json',
      Origin: PRIVAT_ORIGIN,
      Referer: purchaseReferer,
    },
    body: JSON.stringify(body),
  });

  let data = null;
  try {
    data = await response.json();
  } catch {
    data = null;
  }

  return { response, data };
}

async function postBiplan(sess, body, referer) {
  const { net } = require('electron');
  const response = await net.fetch(PRIVAT_BIPLAN_URL, {
    session: sess,
    method: 'POST',
    headers: {
      'User-Agent': CHROME_UA,
      Accept: 'application/json, text/plain, */*',
      'Content-Type': 'application/json',
      Origin: PRIVAT_ORIGIN,
      Referer: referer || `${PRIVAT_ORIGIN}/`,
    },
    body: JSON.stringify(body),
  });

  let data = null;
  try {
    data = await response.json();
  } catch {
    data = null;
  }

  return { response, data };
}

async function postRefresh(sess, xref) {
  const { response, data } = await postJson(sess, PRIVAT_REFRESH_URL, { xref, _: Date.now() });
  if (!response.ok) {
    return { ok: false, reason: `refresh_http_${response.status}`, xref };
  }
  if (data?.status === 'error') {
    return {
      ok: false,
      reason: data.message || 'refresh_error',
      errorCode: data.error_code ?? null,
      xref,
    };
  }

  return { ok: true, xref, data };
}

module.exports = {
  PRIVAT_ORIGIN,
  PRIVAT_INIT_URL,
  PRIVAT_REFRESH_URL,
  readXref,
  postJson,
  postInit,
  postRefresh,
  postBonds,
  postBiplan,
};
