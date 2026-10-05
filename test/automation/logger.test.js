const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');

describe('automation logger helpers', () => {
  const originalDebug = process.env.OVDP_DEBUG;

  afterEach(() => {
    if (originalDebug == null) delete process.env.OVDP_DEBUG;
    else process.env.OVDP_DEBUG = originalDebug;
    delete require.cache[require.resolve('../../src/automation/logger')];
  });

  it('detects debug mode from OVDP_DEBUG', () => {
    process.env.OVDP_DEBUG = '1';
    delete require.cache[require.resolve('../../src/automation/logger')];
    const logger = require('../../src/automation/logger');
    assert.equal(logger.isDebugEnabled(), true);
  });

  it('serializes error stacks and causes', () => {
    const logger = require('../../src/automation/logger');
    const cause = new Error('root cause');
    const err = new Error('wrapper');
    err.code = 'E_TEST';
    err.cause = cause;

    const serialized = logger.serializeError(err);
    assert.equal(serialized.message, 'wrapper');
    assert.equal(serialized.code, 'E_TEST');
    assert.match(serialized.stack || '', /wrapper/);
    assert.equal(serialized.cause.message, 'root cause');
  });

  it('tracks current run id inside withRun', async () => {
    const logger = require('../../src/automation/logger');
    const runId = logger.createRunId('test');
    assert.equal(logger.currentRunId(), null);

    await logger.withRun(runId, async (activeRunId) => {
      assert.equal(activeRunId, runId);
      assert.equal(logger.currentRunId(), runId);
    });

    assert.equal(logger.currentRunId(), null);
  });
});
