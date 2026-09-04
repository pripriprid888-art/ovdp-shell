const OTP_WAIT_MS = 5 * 60 * 1000;
const OTP_VERIFY_MS = 90 * 1000;

/** @type {Map<string, { resolve: (code: string) => void, reject: (err: Error) => void, timer: NodeJS.Timeout }>} */
const waits = new Map();

/** @type {Map<string, { resolve: (result: { ok: true }) => void, reject: (err: Error) => void, timer: NodeJS.Timeout, promise: Promise<{ ok: true }> }>} */
const verificationWaits = new Map();

function createRunId() {
  return `otp-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
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
  const timer = setTimeout(() => {
    verificationWaits.delete(runId);
    rejectFn(new Error('Час перевірки коду минув'));
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
  if (!pending?.promise) {
    throw new Error('Немає активного очікування перевірки коду');
  }
  return pending.promise;
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
    const timer = setTimeout(() => {
      waits.delete(runId);
      reject(new Error('Час очікування коду перевірки минув'));
    }, timeoutMs);

    waits.set(runId, { resolve, reject, timer });
  });
}

function submitCode(runId, code) {
  const pending = waits.get(runId);
  if (!pending) {
    throw new Error('Немає активного очікування коду');
  }
  clearTimeout(pending.timer);
  waits.delete(runId);
  pending.resolve(String(code || '').trim());
}

function cancel(runId, message = 'Скасовано користувачем') {
  const error = new Error(message);
  rejectVerification(runId, error);
  const pending = waits.get(runId);
  if (!pending) return verificationWaits.has(runId);
  clearTimeout(pending.timer);
  waits.delete(runId);
  pending.reject(error);
  return true;
}

function clear(runId) {
  const pending = waits.get(runId);
  if (pending) {
    clearTimeout(pending.timer);
    waits.delete(runId);
  }
  clearVerification(runId);
}

function hasPending(runId) {
  return waits.has(runId) || verificationWaits.has(runId);
}

module.exports = {
  OTP_WAIT_MS,
  OTP_VERIFY_MS,
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
};
