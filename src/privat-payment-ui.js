function escapeHtml(text) {
  return String(text ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function formatCardBalance(balanceText) {
  if (!balanceText) return '—';
  const cleaned = String(balanceText).replace(/\s/g, ' ').trim();
  if (/^\*+$/.test(cleaned.replace(/\s/g, ''))) return '—';
  return cleaned.includes('₴') ? cleaned : `${cleaned} ₴`;
}

function parseTopUpAmountInput(raw) {
  const cleaned = String(raw ?? '').replace(/\s/g, '').replace(',', '.');
  const n = parseFloat(cleaned);
  if (!Number.isFinite(n) || n <= 0) return null;
  return n.toFixed(2);
}

let selectedCardValue = null;
let modalCards = [];

function getModalEls() {
  return {
    modal: document.getElementById('univer-topup-modal'),
    meta: document.getElementById('univer-topup-meta'),
    amountInput: document.getElementById('univer-topup-amount'),
    cardsEl: document.getElementById('univer-topup-cards'),
    cardsLoading: document.getElementById('univer-topup-cards-loading'),
    errorEl: document.getElementById('univer-topup-error'),
    submitBtn: document.getElementById('univer-topup-submit'),
  };
}

function setModalError(message) {
  const { errorEl } = getModalEls();
  if (!errorEl) return;
  errorEl.hidden = !message;
  errorEl.textContent = message || '';
}

function updateSubmitState() {
  const { amountInput, submitBtn } = getModalEls();
  const amount = parseTopUpAmountInput(amountInput?.value);
  const canSubmit = Boolean(amount && selectedCardValue && modalCards.length);
  if (submitBtn) submitBtn.disabled = !canSubmit;
}

function renderTopUpCards(payload = {}) {
  const { cardsEl, cardsLoading } = getModalEls();
  if (!cardsEl) return;

  modalCards = Array.isArray(payload.cards) ? payload.cards : [];
  if (cardsLoading) {
    cardsLoading.hidden = modalCards.length > 0;
  }

  if (!modalCards.length) {
    cardsEl.innerHTML = '';
    selectedCardValue = null;
    updateSubmitState();
    return;
  }

  if (!selectedCardValue) {
    selectedCardValue = payload.selectedValue
      || modalCards.find((card) => card.selected)?.value
      || modalCards[0]?.value
      || null;
  }

  cardsEl.innerHTML = modalCards.map((card) => {
    const active = card.value === selectedCardValue ? ' active' : '';
    const mask = card.ibanMask || card.numberMask || '';
    return `
      <button
        type="button"
        class="privat-payment-card${active}"
        data-univer-topup-card="${escapeHtml(card.value)}"
        title="${escapeHtml(card.title)}${mask ? ` · ${escapeHtml(mask)}` : ''}"
      >
        <span class="privat-payment-card-title">${escapeHtml(card.title)}</span>
        <span class="privat-payment-card-balance">${escapeHtml(formatCardBalance(card.balanceText))}</span>
        ${mask ? `<span class="privat-payment-card-mask">${escapeHtml(mask)}</span>` : ''}
      </button>
    `;
  }).join('');

  updateSubmitState();
}

function openTopUpModalShell() {
  const { modal, amountInput, meta } = getModalEls();
  if (!modal) return false;

  selectedCardValue = null;
  modalCards = [];
  if (amountInput) amountInput.value = '';
  if (meta) meta.textContent = 'Завантаження форми оплати…';
  renderTopUpCards({ cards: [] });
  setModalError('');
  modal.classList.add('open');
  amountInput?.focus();
  return true;
}

function closeTopUpModalShell() {
  getModalEls().modal?.classList.remove('open');
  selectedCardValue = null;
  modalCards = [];
}

async function submitUniverTopUpModal() {
  const shell = window.inzhurShell;
  const { amountInput, submitBtn } = getModalEls();
  const amount = parseTopUpAmountInput(amountInput?.value);

  if (!amount) {
    setModalError('Вкажіть суму більше 0');
    amountInput?.focus();
    return;
  }
  if (!selectedCardValue) {
    setModalError('Оберіть картку для оплати');
    return;
  }

  setModalError('');
  if (submitBtn) submitBtn.disabled = true;

  try {
    const result = await shell.confirmUniverTopUpPrivat({
      amount,
      cardValue: selectedCardValue,
    });
    if (!result?.ok) {
      throw new Error(result?.message || 'Не вдалося заповнити форму оплати');
    }
    closeTopUpModalShell();
    window.onUniverTopUpConfirmed?.(amount);
  } catch (err) {
    setModalError(err.message || 'Помилка поповнення UNIVER');
    updateSubmitState();
  }
}

async function cancelUniverTopUpModal() {
  closeTopUpModalShell();
  try {
    await window.inzhurShell?.cancelUniverTopUpPrivat?.();
  } catch {
    // ignore
  }
}

async function openUniverTopUpPaymentModal() {
  const shell = window.inzhurShell;
  if (!shell?.beginUniverTopUpPrivat) return false;
  if (!openTopUpModalShell()) return false;

  const begun = await shell.beginUniverTopUpPrivat();
  if (!begun?.ok) {
    setModalError(begun?.message || 'Не вдалося відкрити оплату UNIVER');
    return false;
  }

  const { meta } = getModalEls();
  if (meta) {
    meta.textContent = begun.contractNumber
      ? `Договір ${begun.contractNumber}`
      : 'Оплата через Приват24';
  }

  const cards = await shell.getPrivatPaymentCards?.();
  if (cards?.cards?.length) renderTopUpCards(cards);

  return true;
}

function wirePrivatPaymentUi() {
  const { amountInput, cardsEl } = getModalEls();

  document.getElementById('univer-topup-cancel')?.addEventListener('click', () => {
    cancelUniverTopUpModal();
  });
  document.getElementById('univer-topup-submit')?.addEventListener('click', () => {
    submitUniverTopUpModal();
  });
  amountInput?.addEventListener('input', () => {
    setModalError('');
    updateSubmitState();
  });
  amountInput?.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      submitUniverTopUpModal();
    }
  });
  cardsEl?.addEventListener('click', (event) => {
    const button = event.target.closest('[data-univer-topup-card]');
    if (!button) return;
    selectedCardValue = button.dataset.univerTopupCard || null;
    renderTopUpCards({ cards: modalCards, selectedValue: selectedCardValue });
  });
  document.getElementById('univer-topup-modal')?.addEventListener('click', (event) => {
    if (event.target.id === 'univer-topup-modal') cancelUniverTopUpModal();
  });

  window.inzhurShell?.onPrivatPaymentCards?.((payload) => {
    if (!document.getElementById('univer-topup-modal')?.classList.contains('open')) return;
    renderTopUpCards(payload);
  });

  document.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape') return;
    if (document.getElementById('univer-topup-modal')?.classList.contains('open')) {
      cancelUniverTopUpModal();
    }
  });
}

wirePrivatPaymentUi();

window.openUniverTopUpPaymentModal = openUniverTopUpPaymentModal;
