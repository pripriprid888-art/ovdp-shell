const automationLog = require('../automation/logger');
const pendingOtp = require('../automation/pending-otp');
const tokenStore = require('./token-store');
const { listMessageMetas, getMessageText } = require('./api-client');
const {
  buildUniverGmailQuery,
  extractVerificationCode,
  isUniverOtpSender,
  UNIVER_OTP_FROM,
} = require('./univer-code-parser');

const POLL_INTERVAL_MS = 4000;
const OTP_WAIT_MS = pendingOtp.OTP_WAIT_MS;

/** @type {Map<string, { timer: NodeJS.Timeout, startedAt: number }>} */
const activePolls = new Map();

let notifyAutoOtp = () => {};

function configure(options = {}) {
  if (typeof options.notifyAutoOtp === 'function') {
    notifyAutoOtp = options.notifyAutoOtp;
  }
}

function shouldPollGmail(payload = {}) {
  if (!payload.runId) return false;
  if (payload.siteId === 'inzhur') return false;
  if (!tokenStore.isConnected()) return false;
  return payload.siteId === 'univer';
}

function stopGmailOtpPoll(runId, reason = null) {
  const entry = activePolls.get(runId);
  if (!entry) return;
  clearInterval(entry.timer);
  activePolls.delete(runId);
  if (reason) {
    automationLog.push(
      'info',
      'univer',
      `Gmail: опитування зупинено — ${reason}`,
      { category: 'buy', context: { runId } },
    );
  }
}

function logGmailPoll(message, context = {}, level = 'info') {
  const opts = { category: 'buy', context };
  if (level === 'debug') {
    automationLog.pushDebug('univer', message, opts);
  } else if (level === 'warning') {
    automationLog.push('warning', 'univer', message, opts);
  } else {
    automationLog.push('info', 'univer', message, opts);
  }
}

function isPollActive(runId) {
  return activePolls.has(runId);
}

async function findUniverVerificationCode({ afterMs, runId, orderId, isin }) {
  const query = buildUniverGmailQuery();
  const metas = await listMessageMetas(query, 10);
  const cutoff = afterMs - 60_000;
  const fromUniver = metas.filter((meta) => isUniverOtpSender(meta.from));

  logGmailPoll(
    `Gmail: опитування ${UNIVER_OTP_FROM} — ${fromUniver.length} лист(ів)`,
    { runId, query, total: metas.length, matchedSender: fromUniver.length },
  );

  for (const meta of fromUniver) {
    if (meta.internalDate && meta.internalDate < cutoff) {
      logGmailPoll(
        `Gmail: пропущено старий лист «${meta.subject || meta.snippet || meta.id}»`,
        { runId, messageId: meta.id },
        'debug',
      );
      continue;
    }

    let text = `${meta.subject}\n${meta.snippet}`;
    try {
      text = await getMessageText(meta.id);
    } catch {
      // use snippet fallback
    }

    const code = extractVerificationCode(text);
    if (code) {
      logGmailPoll(
        `Gmail: знайдено код у листі «${meta.subject || meta.from}»`,
        { runId, orderId, messageId: meta.id, codeLength: code.length },
      );
      return code;
    }
    logGmailPoll(
      `Gmail: лист від ${UNIVER_OTP_FROM} без коду — «${meta.subject || meta.snippet}»`,
      { runId, orderId, messageId: meta.id },
      'debug',
    );
  }

  return null;
}

function startGmailOtpPoll(payload = {}) {
  const { runId, orderId, isin } = payload;
  if (!shouldPollGmail(payload)) return;

  stopGmailOtpPoll(runId);
  const startedAt = Date.now();
  const query = buildUniverGmailQuery();
  logGmailPoll(
    `Gmail: старт опитування ${UNIVER_OTP_FROM} (кожні ${POLL_INTERVAL_MS / 1000} с)`,
    { runId, query },
  );

  const timer = setInterval(async () => {
    if (!pendingOtp.isAwaitingCode(runId)) {
      stopGmailOtpPoll(runId, 'код уже надіслано або скасовано');
      return;
    }

    try {
      const code = await findUniverVerificationCode({
        orderId,
        isin,
        afterMs: startedAt,
        runId,
      });
      if (!code || !pendingOtp.isAwaitingCode(runId)) return;

      const result = pendingOtp.submitCode(runId, code);
      if (result?.duplicate) return;

      logGmailPoll(
        'Gmail: код перевірки підставлено автоматично',
        { orderId, isin, runId, codeLength: code.length },
      );
      notifyAutoOtp({ runId, orderId, isin, source: 'gmail' });
      stopGmailOtpPoll(runId, 'код знайдено');
    } catch (err) {
      logGmailPoll(
        err.message.startsWith('Gmail:') ? err.message : `Gmail: ${err.message}`,
        { orderId, isin, runId },
        'warning',
      );
    }
  }, POLL_INTERVAL_MS);

  activePolls.set(runId, { timer, startedAt });

  setTimeout(() => {
    if (activePolls.has(runId)) stopGmailOtpPoll(runId, 'час очікування минув');
  }, OTP_WAIT_MS + 5000);
}

module.exports = {
  POLL_INTERVAL_MS,
  configure,
  shouldPollGmail,
  startGmailOtpPoll,
  stopGmailOtpPoll,
  isPollActive,
  findUniverVerificationCode,
};
