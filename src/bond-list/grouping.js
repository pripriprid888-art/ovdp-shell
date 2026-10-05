/**
 * ISIN grouping and catalog list aggregation (browser + Node).
 */
(function (root, factory) {
  const BondListGrouping = factory();
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = BondListGrouping;
  } else {
    root.BondListGrouping = BondListGrouping;
  }
}(typeof window !== 'undefined' ? window : globalThis, function () {
  function normalizeIsin(isin) {
    return String(isin || '').trim().toUpperCase();
  }

  function escapeHtml(text) {
    return String(text ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function pickPrimaryListing(listings, { currentSource = 'all', siteOrder = [] } = {}) {
    let pool = listings;
    if (currentSource !== 'all') {
      pool = listings.filter((bond) => bond.site_id === currentSource);
    }
    if (!pool.length) pool = listings;

    const ordered = [...pool].sort((a, b) => {
      const scannedDiff = (Date.parse(b.scanned_at || 0) || 0) - (Date.parse(a.scanned_at || 0) || 0);
      if (scannedDiff !== 0) return scannedDiff;
      return siteOrder.indexOf(a.site_id) - siteOrder.indexOf(b.site_id);
    });
    return ordered.find((bond) => bond.is_buyable) || ordered[0];
  }

  function pickGroupTitle(listings, primary, nbuByIsin = {}, options = {}) {
    const { pickBondTitle, currentSource = 'all', siteOrder = [] } = options;
    const pick = primary || pickPrimaryListing(listings, { currentSource, siteOrder });
    const isin = normalizeIsin(pick?.isin || listings[0]?.isin);
    const reference = isin ? nbuByIsin[isin] : null;

    if (typeof pickBondTitle === 'function') {
      return pickBondTitle(pick, reference);
    }

    const genericTitle = /^державні облігації/i.test(String(pick?.title || '').trim());
    if (pick?.title && !genericTitle) return pick.title;
    if (reference?.bond_type) return reference.bond_type;
    if (isin) return `ОВДП ${isin}`;
    return pick?.title || '—';
  }

  function groupProposals(proposals, nbuByIsin = {}, options = {}) {
    const { currentSource = 'all', siteOrder = [], pickBondTitle } = options;
    const groups = new Map();

    proposals.forEach((bond, index) => {
      const isin = normalizeIsin(bond.isin);
      const key = isin || `__missing__:${bond.site_id}:${index}`;
      if (!groups.has(key)) {
        groups.set(key, { isin: isin || null, listings: [] });
      }
      groups.get(key).listings.push(bond);
    });

    return [...groups.values()]
      .map((group) => {
        group.listings.sort((a, b) => {
          const db = Date.parse(b.purchase_date || '') || 0;
          const da = Date.parse(a.purchase_date || '') || 0;
          if (db !== da) return db - da;
          return siteOrder.indexOf(a.site_id) - siteOrder.indexOf(b.site_id);
        });
        group.primary = pickPrimaryListing(group.listings, { currentSource, siteOrder });
        group.title = pickGroupTitle(group.listings, group.primary, nbuByIsin, {
          pickBondTitle,
          currentSource,
          siteOrder,
        });
        group.nbu_reference = group.isin ? nbuByIsin[group.isin] || null : null;
        group.is_buyable = group.listings.some((bond) => bond.is_buyable);
        return group;
      })
      .sort((a, b) => String(a.isin || a.title).localeCompare(String(b.isin || b.title), 'uk'));
  }

  function formatUniqueValues(values, fallback = '—') {
    const unique = [...new Set(values.filter(Boolean))];
    if (!unique.length) return fallback;
    if (unique.length === 1) return unique[0];
    return unique.join(' / ');
  }

  function groupBestYield(listings, parseYield) {
    let best = null;
    listings.forEach((bond) => {
      const value = parseYield(bond?.yield_percent);
      if (value != null && Number.isFinite(value) && (best == null || value > best)) {
        best = value;
      }
    });
    return best;
  }

  function groupBestPrice(listings, parsePrice) {
    let best = null;
    listings.forEach((bond) => {
      const value = parsePrice(bond?.buy_price);
      if (value != null && Number.isFinite(value) && (best == null || value < best)) {
        best = value;
      }
    });
    return best;
  }

  function groupBestTotalReturn(listings, parseTotalReturn) {
    let best = null;
    listings.forEach((bond) => {
      const value = typeof parseTotalReturn === 'function' ? parseTotalReturn(bond) : null;
      if (value != null && Number.isFinite(value) && (best == null || value > best)) {
        best = value;
      }
    });
    return best;
  }

  function sortBondGroups(groups, {
    key,
    dir = 'desc',
    parseYield = () => null,
    parsePrice = () => null,
    parseTotalReturn = () => null,
    fallbackCompare,
  } = {}) {
    if (!key || !groups.length) return groups;

    const getValue = key === 'yield'
      ? (group) => groupBestYield(group.listings, parseYield)
      : key === 'totalReturn'
        ? (group) => groupBestTotalReturn(group.listings, parseTotalReturn)
        : (group) => groupBestPrice(group.listings, parsePrice);
    const factor = dir === 'asc' ? 1 : -1;

    return [...groups].sort((a, b) => {
      const av = getValue(a);
      const bv = getValue(b);
      const aNull = av == null || !Number.isFinite(av);
      const bNull = bv == null || !Number.isFinite(bv);
      if (aNull && bNull) {
        return typeof fallbackCompare === 'function' ? fallbackCompare(a, b) : 0;
      }
      if (aNull) return 1;
      if (bNull) return -1;
      if (av !== bv) return (av - bv) * factor;
      return typeof fallbackCompare === 'function' ? fallbackCompare(a, b) : 0;
    });
  }

  return {
    normalizeIsin,
    escapeHtml,
    pickPrimaryListing,
    pickGroupTitle,
    groupProposals,
    formatUniqueValues,
    groupBestYield,
    groupBestPrice,
    groupBestTotalReturn,
    sortBondGroups,
  };
}));
