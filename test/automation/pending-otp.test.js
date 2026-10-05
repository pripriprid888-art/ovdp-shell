const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');

describe('pending-otp verification window', () => {
  let pendingOtp;

  beforeEach(() => {
    pendingOtp = require('../../src/automation/pending-otp');
  });

  afterEach(() => {
    delete require.cache[require.resolve('../../src/automation/pending-otp')];
  });

  it('starts verification countdown when code is submitted, not while waiting for entry', async () => {
    const runId = pendingOtp.createRunId();
    const waitPromise = pendingOtp.waitForCode(runId);

    await new Promise((resolve) => setTimeout(resolve, 50));
    assert.equal(pendingOtp.hasPending(runId), true);

    pendingOtp.submitCode(runId, '123456');

    const verifyPromise = pendingOtp.awaitVerification(runId);
    await new Promise((resolve) => setTimeout(resolve, 50));
    assert.equal(pendingOtp.hasPending(runId), true);

    pendingOtp.resolveVerification(runId);
    await assert.doesNotReject(Promise.all([waitPromise, verifyPromise]));
    assert.equal(await waitPromise, '123456');
    assert.deepEqual(await verifyPromise, { ok: true });
  });

  it('allows duplicate submit while verification is in progress', async () => {
    const runId = pendingOtp.createRunId();
    pendingOtp.waitForCode(runId).catch(() => {});

    assert.deepEqual(pendingOtp.submitCode(runId, '123456'), { duplicate: false });
    assert.deepEqual(pendingOtp.submitCode(runId, '123456'), { duplicate: true });

    const verifyPromise = pendingOtp.awaitVerification(runId);
    pendingOtp.resolveVerification(runId);
    await assert.doesNotReject(verifyPromise);
  });

  it('cancel rejects an active code wait and verification', async () => {
    const runId = pendingOtp.createRunId();
    const waitPromise = pendingOtp.waitForCode(runId);
    pendingOtp.cancel(runId);

    await assert.rejects(waitPromise, /Скасовано користувачем/);
    assert.equal(pendingOtp.hasPending(runId), false);
    assert.equal(pendingOtp.wasUserCancelled(runId), true);
  });

  it('clears cancelled flag on clear()', async () => {
    const runId = pendingOtp.createRunId();
    pendingOtp.waitForCode(runId).catch(() => {});
    pendingOtp.cancel(runId);
    assert.equal(pendingOtp.wasUserCancelled(runId), true);
    pendingOtp.clear(runId);
    assert.equal(pendingOtp.wasUserCancelled(runId), false);
  });

  it('raceCancel aborts an in-flight step when the user cancels', async () => {
    const runId = pendingOtp.createRunId();
    pendingOtp.waitForCode(runId).catch(() => {});
    pendingOtp.submitCode(runId, '123456');

    const stepPromise = pendingOtp.raceCancel(runId, new Promise((resolve) => {
      setTimeout(resolve, 500);
    }));

    pendingOtp.cancel(runId);
    await assert.rejects(stepPromise, /Скасовано користувачем/);
  });

  it('clear settles pending verification without leaving a dangling timer', async () => {
    const runId = pendingOtp.createRunId();
    pendingOtp.waitForCode(runId).catch(() => {});
    pendingOtp.submitCode(runId, '123456');

    const verifyPromise = pendingOtp.awaitVerification(runId);
    pendingOtp.clear(runId);

    await assert.rejects(verifyPromise, /Завершено/);
    assert.equal(pendingOtp.hasPending(runId), false);
  });
});
