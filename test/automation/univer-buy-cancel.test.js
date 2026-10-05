const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('vm');
const {
  CLICK_CANCEL_ORDER_JS,
  CANCEL_ORDER_STATUS_FALLBACK,
} = require('../../src/automation/flows/univer-buy');

describe('Univer order cancel click', () => {
  it('calls clickButtonSaveAll with status id from the cancel button', () => {
    let savedStatusId = null;
    const calls = [];
    const context = {
      document: {
        querySelectorAll: () => [{
          innerText: 'Скасувати',
          getAttribute: (name) => (
            name === 'onclick' ? "clickButtonSaveAll('89');" : null
          ),
          click: () => calls.push('click'),
        }],
      },
      clickButtonSaveAll: (statusId) => {
        savedStatusId = statusId;
        calls.push('clickButtonSaveAll');
      },
    };

    const result = vm.runInNewContext(CLICK_CANCEL_ORDER_JS, context);
    assert.equal(result.ok, true);
    assert.equal(result.method, 'clickButtonSaveAll');
    assert.equal(result.statusId, '89');
    assert.equal(savedStatusId, '89');
    assert.deepEqual(calls, ['clickButtonSaveAll']);
  });

  it('falls back to button click when clickButtonSaveAll is unavailable', () => {
    const calls = [];
    const context = {
      document: {
        querySelectorAll: () => [{
          innerText: 'Скасувати',
          getAttribute: () => '',
          click: () => calls.push('click'),
        }],
      },
    };

    const result = vm.runInNewContext(CLICK_CANCEL_ORDER_JS, context);
    assert.equal(result.ok, true);
    assert.equal(result.method, 'click');
    assert.equal(result.statusId, CANCEL_ORDER_STATUS_FALLBACK);
    assert.deepEqual(calls, ['click']);
  });
});
