/** Normalize site.checkAuthJs results (boolean or { authenticated }). */
function isAuthenticatedResult(result) {
  if (typeof result === 'boolean') return result;
  return !!result?.authenticated;
}

module.exports = {
  isAuthenticatedResult,
};
