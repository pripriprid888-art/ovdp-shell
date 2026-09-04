const styledSelectRegistry = new Map();

class StyledSelect {
  constructor(nativeSelect) {
    this.native = nativeSelect;
    this.open = false;
    this.wrap = document.createElement('div');
    this.wrap.className = 'styled-select';
    if (nativeSelect.classList.contains('styled-select-compact')) {
      this.wrap.classList.add('styled-select-compact');
    }

    this.trigger = document.createElement('button');
    this.trigger.type = 'button';
    this.trigger.className = 'styled-select-trigger';
    this.trigger.setAttribute('aria-haspopup', 'listbox');
    this.trigger.setAttribute('aria-expanded', 'false');
    this.labelEl = document.createElement('span');
    this.labelEl.className = 'styled-select-label';
    this.chevron = document.createElement('span');
    this.chevron.className = 'styled-select-chevron';
    this.chevron.setAttribute('aria-hidden', 'true');
    this.chevron.textContent = '▾';
    this.trigger.append(this.labelEl, this.chevron);

    this.menu = document.createElement('div');
    this.menu.className = 'styled-select-menu';
    this.menu.setAttribute('role', 'listbox');
    this.menu.hidden = true;

    this.wrap.append(this.trigger, this.menu);
    nativeSelect.classList.add('styled-select-native');
    nativeSelect.insertAdjacentElement('afterend', this.wrap);

    this.trigger.addEventListener('click', (event) => {
      event.stopPropagation();
      if (this.native.disabled) return;
      this.toggle();
    });

    this.menu.addEventListener('click', (event) => {
      const option = event.target.closest('[role="option"]');
      if (!option || option.disabled) return;
      this.selectValue(option.dataset.value, true);
      this.close();
    });

    this.observer = new MutationObserver(() => this.refresh());
    this.observer.observe(nativeSelect, {
      childList: true,
      attributes: true,
      attributeFilter: ['disabled', 'value'],
    });

    styledSelectRegistry.set(nativeSelect.id || nativeSelect, this);
    this.refresh();
  }

  static enhance(nativeSelect) {
    if (!nativeSelect || nativeSelect.dataset.styledSelect === 'true') {
      return nativeSelect?.id ? styledSelectRegistry.get(nativeSelect.id) : null;
    }
    nativeSelect.dataset.styledSelect = 'true';
    return new StyledSelect(nativeSelect);
  }

  static get(target) {
    if (!target) return null;
    if (target instanceof StyledSelect) return target;
    const el = typeof target === 'string' ? document.getElementById(target) : target;
    if (!el) return null;
    return styledSelectRegistry.get(el.id || el) || StyledSelect.enhance(el);
  }

  static initAll(root = document) {
    root.querySelectorAll('select.styled-select:not([data-styled-select="true"])').forEach((el) => {
      StyledSelect.enhance(el);
    });
  }

  static closeAll(except) {
    styledSelectRegistry.forEach((instance) => {
      if (instance !== except) instance.close();
    });
  }

  getOptions() {
    return [...this.native.options].map((opt) => ({
      value: opt.value,
      label: opt.textContent || '',
      disabled: opt.disabled,
      selected: opt.selected,
    }));
  }

  refresh() {
    const options = this.getOptions();
    const selected = options.find((opt) => opt.selected) || options[0];
    const disabled = this.native.disabled;

    this.trigger.disabled = disabled;
    this.wrap.classList.toggle('is-disabled', disabled);
    this.labelEl.textContent = selected?.label || '—';
    this.trigger.setAttribute(
      'aria-labelledby',
      this.native.id ? `${this.native.id}-label` : undefined,
    );

    this.menu.innerHTML = options.map((opt) => (
      `<button type="button" class="styled-select-option${opt.selected ? ' is-selected' : ''}"`
      + ` role="option" data-value="${escapeAttr(opt.value)}"`
      + `${opt.disabled ? ' disabled' : ''}`
      + `${opt.selected ? ' aria-selected="true"' : ''}>${escapeHtml(opt.label)}</button>`
    )).join('');
  }

  selectValue(value, dispatchChange = false) {
    this.native.value = value;
    this.refresh();
    if (dispatchChange) {
      this.native.dispatchEvent(new Event('change', { bubbles: true }));
    }
  }

  toggle() {
    if (this.open) this.close();
    else this.openMenu();
  }

  openMenu() {
    if (this.native.disabled) return;
    StyledSelect.closeAll(this);
    this.open = true;
    this.menu.hidden = false;
    this.wrap.classList.add('is-open');
    this.trigger.setAttribute('aria-expanded', 'true');
    const selected = this.menu.querySelector('.is-selected');
    selected?.scrollIntoView({ block: 'nearest' });
  }

  close() {
    this.open = false;
    this.menu.hidden = true;
    this.wrap.classList.remove('is-open');
    this.trigger.setAttribute('aria-expanded', 'false');
  }
}

function escapeHtml(text) {
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function escapeAttr(text) {
  return escapeHtml(text).replace(/'/g, '&#39;');
}

document.addEventListener('click', () => StyledSelect.closeAll());
document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') StyledSelect.closeAll();
});

StyledSelect.initAll();

window.StyledSelect = StyledSelect;
