/** UNIVER verification emails (display name often «УНІВЕР»). */
const UNIVER_OTP_FROM = 'noreply@univer.ua';

function isUniverOtpSender(fromHeader) {
  const from = String(fromHeader || '').toLowerCase();
  return from.includes(UNIVER_OTP_FROM);
}

function buildUniverGmailQuery() {
  return [`newer_than:1d`, `from:${UNIVER_OTP_FROM}`].join(' ');
}

function extractVerificationCode(text) {
  const source = String(text || '');
  if (!source.trim()) return null;

  const contextual = [
    /(?:код|code|verification|підтвердж)[^\d]{0,24}(\d{4,8})/i,
    /(?:код|code)\s*[:\-—]\s*(\d{4,8})/i,
    /(\d{4,8})\s*(?:—|-)\s*(?:код|code)/i,
  ];

  for (const pattern of contextual) {
    const match = source.match(pattern);
    if (match?.[1]) return match[1];
  }

  const candidates = [...source.matchAll(/\b(\d{6})\b/g)].map((m) => m[1]);
  if (candidates.length === 1) return candidates[0];

  return null;
}

module.exports = {
  UNIVER_OTP_FROM,
  isUniverOtpSender,
  buildUniverGmailQuery,
  extractVerificationCode,
};
