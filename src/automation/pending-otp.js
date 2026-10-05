const OTP_WAIT_MS = 5 * 60 * 1000;
const OTP_VERIFY_MS = OTP_WAIT_MS;
const USER_CANCEL_MESSAGE = 'Скасовано користувачем';
const USER_CANCELLED_BUY_MESSAGE = 'Купівлю скасовано';

/** @type {Set<string>} */
const userCancelledRuns = new Set();

/** @type {Map<string, { resolve: (code: string) => void, reject: (err: Error) => void, timer: NodeJS.Timeout }>} */
const waits = new Map();

/** @type {Map<string, Set<(err: Error) => void>>} */
const cancelListeners = new Map();

/** @type {Map<string, { resolve: (result: { ok: true }) => void, reject: (err: Error) => void, timer: NodeJS.Timeout, promise: Promise<{ ok: true }> }>} */
const verificationWaits = new Map();

function createRunId() {
  return `otp-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function trackCancel(runId, reject) {
  if (!cancelListeners.has(runId)) cancelListeners.set(runId, new Set());
  cancelListeners.get(runId).add(reject);
}

function untrackCancel(runId, reject) {
  const listeners = cancelListeners.get(runId);
  if (!listeners) return;
  listeners.delete(reject);
  if (!listeners.size) cancelListeners.delete(runId);
}

function notifyCancel(runId, error) {
  const listeners = cancelListeners.get(runId);
  if (!listeners) return;
  for (const reject of listeners) reject(error);
  cancelListeners.delete(runId);
}

async function raceCancel(runId, promise) {
  let cancelReject;
  const cancelPromise = new Promise((_, reject) => {
    cancelReject = reject;
    trackCancel(runId, reject);
  });
  try {
    return await Promise.race([promise, cancelPromise]);
  } finally {
    untrackCancel(runId, cancelReject);
  }
}

function isAwaitingCode(runId) {
  return waits.has(runId);
}

function isAwaitingVerification(runId) {
  return verificationWaits.has(runId);
}

function clearVerification(runId) {
  const pending = verificationWaits.get(runId);
  if (!pending) return;
  clearTimeout(pending.timer);
  verificationWaits.delete(runId);
}

function prepareVerification(runId, timeoutMs = OTP_VERIFY_MS) {
  clearVerification(runId);
  let resolveFn;
  let rejectFn;
  const promise = new Promise((resolve, reject) => {
    resolveFn = resolve;
    rejectFn = reject;
  });
  promise.catch(() => {});
  const timer = setTimeout(() => {
    rejectVerification(runId, new Error('Час перевірки коду минув'));
  }, timeoutMs);
  verificationWaits.set(runId, {
    resolve: resolveFn,
    reject: rejectFn,
    timer,
    promise,
  });
}

function awaitVerification(runId) {
  const pending = verificationWaits.get(runId);
  if (pending?.promise) return pending.promise;
  if (waits.has(runId)) {
    throw new Error('Спочатку надішліть код перевірки');
  }
  throw new Error('Немає активного очікування перевірки коду');
}

function resolveVerification(runId) {
  const pending = verificationWaits.get(runId);
  if (!pending) return false;
  clearTimeout(pending.timer);
  verificationWaits.delete(runId);
  pending.resolve({ ok: true });
  return true;
}

function rejectVerification(runId, err) {
  const pending = verificationWaits.get(runId);
  if (!pending) return false;
  clearTimeout(pending.timer);
  verificationWaits.delete(runId);
  const error = err instanceof Error ? err : new Error(String(err?.message || err || 'Код не прийнято'));
  pending.reject(error);
  return true;
}

function register(runId) {
  if (waits.has(runId)) {
    clearTimeout(waits.get(runId).timer);
    waits.delete(runId);
  }
}

function waitForCode(runId, timeoutMs = OTP_WAIT_MS) {
  register(runId);
  return new Promise((resolve, reject) => {
    trackCancel(runId, reject);
    const timer = setTimeout(() => {
      waits.delete(runId);
      untrackCancel(runId, reject);
      reject(new Error('Час очікування коду перевірки минув'));
    }, timeoutMs);

    waits.set(runId, { resolve, reject, timer });
  });
}

function submitCode(runId, code) {
  if (verificationWaits.has(runId)) {
    return { duplicate: true };
  }
  const pending = waits.get(runId);
  if (!pending) {
    throw new Error('Немає активного очікування коду');
  }
  clearTimeout(pending.timer);
  waits.delete(runId);
  prepareVerification(runId);
  pending.resolve(String(code || '').trim());
  return { duplicate: false };
}

function wasUserCancelled(runId) {
  return userCancelledRuns.has(runId);
}

function markUserCancelled(runId) {
  if (runId) userCancelledRuns.add(runId);
}

function cancel(runId, message = USER_CANCEL_MESSAGE) {
  markUserCancelled(runId);
  const error = new Error(message);
  error.code = 'USER_CANCELLED';
  notifyCancel(runId, error);
  rejectVerification(runId, error);
  const pending = waits.get(runId);
  if (!pending) return hasPending(runId);
  clearTimeout(pending.timer);
  waits.delete(runId);
  pending.reject(error);
  return true;
}

function clear(runId) {
  cancelListeners.delete(runId);
  const pending = waits.get(runId);
  if (pending) {
    clearTimeout(pending.timer);
    waits.delete(runId);
    if (wasUserCancelled(runId)) {
      const error = new Error(USER_CANCELLED_BUY_MESSAGE);
      error.code = 'USER_CANCELLED';
      pending.reject(error);
    } else {
      pending.reject(new Error('Завершено'));
    }
  } else if (wasUserCancelled(runId)) {
    rejectVerification(runId, (() => {
      const error = new Error(USER_CANCELLED_BUY_MESSAGE);
      error.code = 'USER_CANCELLED';
      return error;
    })());
  } else {
    rejectVerification(runId, new Error('Завершено'));
  }
  userCancelledRuns.delete(runId);
}

function hasPending(runId) {
  return waits.has(runId) || verificationWaits.has(runId);
}

module.exports = {
  OTP_WAIT_MS,
  OTP_VERIFY_MS,
  USER_CANCEL_MESSAGE,
  USER_CANCELLED_BUY_MESSAGE,
  wasUserCancelled,
  markUserCancelled,
  createRunId,
  register,
  prepareVerification,
  awaitVerification,
  resolveVerification,
  rejectVerification,
  waitForCode,
  submitCode,
  cancel,
  clear,
  hasPending,
  isAwaitingCode,
  isAwaitingVerification,
  raceCancel,
};
