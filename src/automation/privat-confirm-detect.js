const CONFIRM_PATTERNS = [
  {
    re: /Телефонує ПриватБанк|Звонит ПриватБанк|PrivatBank is calling|Дайте відповідь на дзвінок|Підтвердження за телефоном/i,
    message: 'Прийміть дзвінок від ПриватБанку та підтвердіть вхід у телефоні',
    buyMessage: 'Прийміть дзвінок від ПриватБанку та підтвердіть купівлю',
  },
  {
    re: /додаток Приват24|підтвердження в додаток|Confirmation was sent to your Privat24|via Sender/i,
    message: 'Підтвердіть вхід у застосунку Приват24 на телефоні',
    buyMessage: 'Підтвердіть купівлю у застосунку Приват24 на телефоні',
  },
  {
    re: /відскануйте QR|QR-код|Scan via Privat24/i,
    message: 'Відскануйте QR-код у застосунку Приват24, щоб підтвердити вхід',
    buyMessage: 'Відскануйте QR-код у застосунку Приват24, щоб підтвердити купівлю',
  },
  {
    re: /SMS з кодом|SMS с кодом/i,
    message: 'Підтвердіть вхід за SMS-кодом, якщо банк надіслав повідомлення',
    buyMessage: 'Підтвердіть купівлю за SMS-кодом, якщо банк надіслав повідомлення',
  },
  {
    re: /SmartID|СмартID|підпишіть документ/i,
    message: 'Підпишіть документи через SmartID у застосунку Приват24',
    buyMessage: 'Підпишіть документи через SmartID у застосунку Приват24',
  },
  {
    re: /підтвердіть (операцію|купівлю|платіж)|очікуємо підтвердження (операції|від вас|платежу|входу)/i,
    message: 'Очікуємо підтвердження в Приват24 (застосунок або дзвінок)',
    buyMessage: 'Підтвердіть купівлю у застосунку Приват24 на телефоні',
  },
];

const COLLECT_TEXT_JS = `(() => {
  function normalize(text) {
    return String(text || '').replace(/\\s+/g, ' ').trim();
  }
  const parts = [normalize(document.body?.innerText || '')];
  for (const el of document.querySelectorAll('[role="dialog"], [role="alertdialog"], [class*="modal" i], [class*="Modal"]')) {
    const text = normalize(el.innerText || el.textContent);
    if (text) parts.unshift(text);
  }
  return parts.join(' ');
})()`;

function listFrames(webContents) {
  return webContents.mainFrame?.framesInOrder
    || webContents.mainFrame?.frames
    || [];
}

async function collectPrivatPageText(webContents) {
  const parts = [];
  try {
    const main = await webContents.executeJavaScript(COLLECT_TEXT_JS);
    if (main) parts.push(main);
  } catch {
    // page may still be loading
  }
  for (const frame of listFrames(webContents)) {
    try {
      const text = await frame.executeJavaScript(COLLECT_TEXT_JS);
      if (text) parts.push(text);
    } catch {
      // detached or cross-origin frame
    }
  }
  return parts.join(' ');
}

function matchPrivatConfirmMessage(text, context = 'signin') {
  if (typeof text !== 'string' || !text.trim()) return null;
  for (let index = 0; index < CONFIRM_PATTERNS.length; index += 1) {
    const pattern = CONFIRM_PATTERNS[index];
    if (pattern.re.test(text)) {
      return {
        step: `privat_confirm_${index}`,
        message: context === 'buy' && pattern.buyMessage ? pattern.buyMessage : pattern.message,
      };
    }
  }
  if (context === 'signin' && /код підтвердження/i.test(text)) {
    return {
      step: 'privat_confirm_sms',
      message: 'Підтвердіть вхід за SMS-кодом, якщо банк надіслав повідомлення',
    };
  }
  return null;
}

function isPrivatConfirmLogEntry(entry) {
  if (!entry || entry.siteId !== 'privat') return false;
  const message = String(entry.message || '');
  if (!message) return false;
  if (entry.level === 'warning') return /підтверд|очікуємо підтвердження|SmartID|дзвінок|QR|SMS|Sender|телефон/i.test(message);
  if (entry.level === 'info' && /очікуємо підтвердження|підтвердіть у телефон/i.test(message)) return true;
  return false;
}

function privatConfirmStepFromLog(entries = []) {
  for (const entry of entries) {
    if (isPrivatConfirmLogEntry(entry)) return entry.message;
  }
  return null;
}

async function detectPrivatConfirmMessage(webContents, context = 'buy') {
  const text = await collectPrivatPageText(webContents);
  return matchPrivatConfirmMessage(text, context);
}

module.exports = {
  CONFIRM_PATTERNS,
  collectPrivatPageText,
  matchPrivatConfirmMessage,
  detectPrivatConfirmMessage,
  isPrivatConfirmLogEntry,
  privatConfirmStepFromLog,
};
