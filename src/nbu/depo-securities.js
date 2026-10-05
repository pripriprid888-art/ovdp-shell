const https = require('https');
const { normalizeMaturityDate } = require('../bond-dates');

const NBU_DEPO_JSON_URL = 'https://bank.gov.ua/depo_securities?json';
const USER_AGENT = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

const PAYMENT_TYPE_MAP = {
  1: 'coupon',
  2: 'maturity',
  3: 'maturity',
};

function fetchJson(url, timeoutMs = 45000) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { headers: { 'User-Agent': USER_AGENT } }, (res) => {
      if (res.statusCode !== 200) {
        reject(new Error(`NBU depo_securities HTTP ${res.statusCode}`));
        res.resume();
        return;
      }

      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => {
        try {
          resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
        } catch (err) {
          reject(new Error(`NBU depo_securities invalid JSON: ${err.message}`));
        }
      });
    });

    req.on('error', reject);
    req.setTimeout(timeoutMs, () => {
      req.destroy(new Error('NBU depo_securities request timed out'));
    });
  });
}

function normalizePayment(payment = {}) {
  const payType = String(payment.pay_type ?? '');
  return {
    date: normalizeMaturityDate(payment.pay_date) || payment.pay_date || null,
    amount: payment.pay_val ?? null,
    payment_type: PAYMENT_TYPE_MAP[payType] || 'coupon',
  };
}

function normalizeRecord(raw = {}) {
  const isin = String(raw.cpcode || '').trim().toUpperCase();
  if (!isin) return null;

  const payments = Array.isArray(raw.payments)
    ? raw.payments.map(normalizePayment).filter((entry) => entry.date)
    : [];

  return {
    isin,
    bond_type: raw.cpdescr || null,
    security_class: raw.cptype || null,
    nominal: raw.nominal ?? null,
    currency: raw.val_code || null,
    issue_date: normalizeMaturityDate(raw.razm_date) || raw.razm_date || null,
    maturity_date: normalizeMaturityDate(raw.pgs_date) || raw.pgs_date || null,
    circulation: raw.total_bonds ?? null,
    nominal_yield: raw.auk_proc ?? null,
    coupon_period_days: raw.pay_period ?? null,
    issuer_name: raw.emit_name || null,
    payments,
  };
}

function indexByIsin(records = []) {
  return Object.fromEntries(
    records.filter(Boolean).map((record) => [record.isin, record]),
  );
}

async function fetchDepoSecurities() {
  const raw = await fetchJson(NBU_DEPO_JSON_URL);
  if (!Array.isArray(raw)) {
    throw new Error('NBU depo_securities response is not an array');
  }

  const records = raw.map(normalizeRecord).filter(Boolean);
  return {
    source_url: NBU_DEPO_JSON_URL,
    fetched_at: new Date().toISOString(),
    count: records.length,
    records,
    by_isin: indexByIsin(records),
  };
}

module.exports = {
  NBU_DEPO_JSON_URL,
  fetchDepoSecurities,
  normalizeRecord,
  normalizePayment,
};
