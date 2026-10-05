const CHROME_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

const PRIVAT_ORIGIN = 'https://next.privat24.ua';
const PRIVAT_INIT_URL = `${PRIVAT_ORIGIN}/api/p24/init?lang=ua`;
const PRIVAT_REFRESH_URL = `${PRIVAT_ORIGIN}/api/p24/pub/refresh`;
const PRIVAT_BONDS_URL = `${PRIVAT_ORIGIN}/api/p24/bonds`;
const PRIVAT_BIPLAN_URL = `${PRIVAT_ORIGIN}/api/p24/pub/biplan`;
const PRIVAT_UNIVER_BIPLAN_COMPANY_ID = '4842305';
/** Privat24 BIPLAN query for UNIVER company payment (createPayByCompany). */
const PRIVAT_UNIVER_BIPLAN_QUERY = 'UA063052990000026500026200741';

const EXTERNAL_PROTOCOLS = /^(diia:|bankid:|mailto:|tel:|itms-apps:|market:)/i;

module.exports = {
  CHROME_UA,
  PRIVAT_ORIGIN,
  PRIVAT_INIT_URL,
  PRIVAT_REFRESH_URL,
  PRIVAT_BONDS_URL,
  PRIVAT_BIPLAN_URL,
  PRIVAT_UNIVER_BIPLAN_COMPANY_ID,
  PRIVAT_UNIVER_BIPLAN_QUERY,
  EXTERNAL_PROTOCOLS,
};
