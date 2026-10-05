const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { isTransientNetworkError } = require('../../src/shared/network-errors');

describe('isTransientNetworkError', () => {
  it('detects Electron timeout errors', () => {
    assert.equal(isTransientNetworkError(new Error('net::ERR_TIMED_OUT')), true);
  });

  it('detects abort/timeouts and DNS failures', () => {
    assert.equal(isTransientNetworkError({ name: 'AbortError', message: 'The operation was aborted' }), true);
    assert.equal(isTransientNetworkError(new Error('getaddrinfo ENOTFOUND example.com')), true);
  });

  it('does not treat auth failures as transient network errors', () => {
    assert.equal(isTransientNetworkError(new Error('Unexpected token in JSON')), false);
  });
});
