const { getSite } = require('../sites/config');

function purchaseUrl(siteId, isin) {
  const site = getSite(siteId);
  if (siteId === 'privat') {
    if (!isin) return site.bondsListUrl;
    return `https://next.privat24.ua/bonds/purchase/${encodeURIComponent(isin)}`;
  }
  if (siteId === 'univer') {
    return site.cabinetBuyUrl || site.cabinetUrl;
  }
  if (siteId === 'inzhur') {
    return site.catalogUrl;
  }
  throw new Error(`Purchase route not supported for ${siteId}`);
}

const HIGHLIGHT_ISIN_JS = (isin) => `(() => {
  const target = ${JSON.stringify(isin || '')};
  if (!target) return false;
  const cards = [...document.querySelectorAll('.investment-unit[data-asset-id]')];
  const card = cards.find((el) => el.innerText.includes(target));
  if (!card) return false;
  card.scrollIntoView({ behavior: 'smooth', block: 'center' });
  card.style.outline = '2px solid #c9a227';
  return true;
})()`;

module.exports = {
  purchaseUrl,
  HIGHLIGHT_ISIN_JS,
};
