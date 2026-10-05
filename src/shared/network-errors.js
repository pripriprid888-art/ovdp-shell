function isTransientNetworkError(err) {
  if (!err) return false;
  if (err.name === 'AbortError') return true;

  const message = String(err.message || err).toLowerCase();
  return /err_timed_out|err_network|err_internet_disconnected|err_connection|err_name_not_resolved|enotfound|etimedout|econnreset|econnaborted|network request failed|fetch failed/.test(message);
}

module.exports = {
  isTransientNetworkError,
};
