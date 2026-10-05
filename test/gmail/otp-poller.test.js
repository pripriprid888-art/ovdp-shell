const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

describe('gmail otp-poller shouldPollGmail', () => {
  const { shouldPollGmail } = require('../../src/gmail/otp-poller');

  it('polls for univer buy when gmail is connected', () => {
    const tokenStore = require('../../src/gmail/token-store');
    const original = tokenStore.isConnected;
    tokenStore.isConnected = () => true;
    try {
      assert.equal(shouldPollGmail({
        runId: 'otp-1',
        siteId: 'univer',
        orderId: '123',
        isin: 'UA4000118757',
      }), true);
    } finally {
      tokenStore.isConnected = original;
    }
  });

  it('does not poll for inzhur sign-in', () => {
    const tokenStore = require('../../src/gmail/token-store');
    const original = tokenStore.isConnected;
    tokenStore.isConnected = () => true;
    try {
      assert.equal(shouldPollGmail({ runId: 'otp-2', siteId: 'inzhur' }), false);
    } finally {
      tokenStore.isConnected = original;
    }
  });
});
