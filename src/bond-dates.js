/**
 * Shared bond date parsing and display (DD.MM.YYYY in UI, YYYY-MM-DD in storage).
 */

function parseBondDate(dateStr) {
  if (dateStr == null || dateStr === '') return null;

  if (dateStr instanceof Date) {
    return Number.isNaN(dateStr.getTime()) ? null : dateStr;
  }

  const raw = String(dateStr).trim();
  if (!raw) return null;

  const isoMatch = raw.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (isoMatch) {
    const date = new Date(Number(isoMatch[1]), Number(isoMatch[2]) - 1, Number(isoMatch[3]));
    return Number.isNaN(date.getTime()) ? null : date;
  }

  const dmyMatch = raw.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{2,4})$/);
  if (dmyMatch) {
    const day = parseInt(dmyMatch[1], 10);
    const month = parseInt(dmyMatch[2], 10);
    let year = parseInt(dmyMatch[3], 10);
    if (year < 100) year += 2000;
    const date = new Date(year, month - 1, day);
    return Number.isNaN(date.getTime()) ? null : date;
  }

  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function normalizeMaturityDate(value) {
  const date = parseBondDate(value);
  if (!date) {
    const trimmed = String(value ?? '').trim();
    return trimmed || null;
  }

  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function formatMaturityDate(value) {
  const date = parseBondDate(value);
  if (!date) {
    const trimmed = String(value ?? '').trim();
    return trimmed || '—';
  }

  const day = String(date.getDate()).padStart(2, '0');
  const month = String(date.getMonth() + 1).padStart(2, '0');
  return `${day}.${month}.${date.getFullYear()}`;
}

function toDateInputValue(value) {
  const date = parseBondDate(value);
  if (!date) return '';
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

const BondDates = {
  parseBondDate,
  normalizeMaturityDate,
  formatMaturityDate,
  toDateInputValue,
};

if (typeof module !== 'undefined' && module.exports) {
  module.exports = BondDates;
}

if (typeof window !== 'undefined') {
  window.BondDates = BondDates;
}
