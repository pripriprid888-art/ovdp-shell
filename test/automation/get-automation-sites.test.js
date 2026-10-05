const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { getAutomationSites } = require('../../src/automation/runner');

describe('getAutomationSites', () => {
  it('exposes headless sign-in for Inzhur', () => {
    const inzhur = getAutomationSites().find((s) => s.id === 'inzhur');
    assert.ok(inzhur);
    assert.equal(inzhur.supportsBrowserAutoSignIn, false);
    assert.equal(inzhur.supportsHeadlessSignIn, true);
    assert.equal(inzhur.usesApiSignIn, false);
    assert.equal(inzhur.signInUrl, 'https://www.inzhur.reit/dashboard/signin');
  });
});
