const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { shouldOpenExternally } = require('../../src/shared/browser');

describe('shouldOpenExternally', () => {
  it('blocks custom app protocols', () => {
    assert.equal(shouldOpenExternally('diia://sign'), true);
    assert.equal(shouldOpenExternally('bankid://auth'), true);
    assert.equal(shouldOpenExternally('mailto:test@example.com'), true);
  });

  it('allows normal https URLs', () => {
    assert.equal(shouldOpenExternally('https://next.privat24.ua/bonds'), false);
    assert.equal(shouldOpenExternally('https://univer.1b.app/client/'), false);
  });

  it('blocks app store links', () => {
    assert.equal(shouldOpenExternally('https://apps.apple.com/app/id123'), true);
    assert.equal(shouldOpenExternally('https://play.google.com/store/apps/details?id=x'), true);
  });
});
