const STYLE_ID = 'ovdp-inzhur-theme';

const INZHUR_PAGE_THEMES = {
  off: {
    id: 'off',
    label: 'Оригінал',
    css: '',
  },
  gold: {
    id: 'gold',
    label: 'Shell',
    css: `
      html {
        filter: invert(0.91) hue-rotate(180deg) brightness(0.96) contrast(0.98) !important;
      }
      img, video, picture, svg, [style*="background-image"] {
        filter: invert(1) hue-rotate(180deg) !important;
      }
      html::before {
        background: radial-gradient(
          ellipse at center,
          transparent 45%,
          rgba(18, 18, 31, 0.42) 100%
        ) !important;
        content: "" !important;
        inset: 0 !important;
        mix-blend-mode: multiply !important;
        pointer-events: none !important;
        position: fixed !important;
        z-index: 2147483646 !important;
      }
      html::after {
        background: rgba(201, 162, 39, 0.11) !important;
        content: "" !important;
        inset: 0 !important;
        mix-blend-mode: overlay !important;
        pointer-events: none !important;
        position: fixed !important;
        z-index: 2147483647 !important;
      }
    `,
  },
  dark: {
    id: 'dark',
    label: 'Темна',
    css: `
      html {
        filter: invert(0.93) hue-rotate(180deg) brightness(0.94) !important;
      }
      img, video, picture, svg, [style*="background-image"] {
        filter: invert(1) hue-rotate(180deg) !important;
      }
    `,
  },
  warm: {
    id: 'warm',
    label: 'Тепла',
    css: `
      html {
        filter: sepia(0.28) saturate(1.15) hue-rotate(-12deg) brightness(0.98) !important;
      }
      html::after {
        background: rgba(201, 162, 39, 0.14) !important;
        content: "" !important;
        inset: 0 !important;
        mix-blend-mode: soft-light !important;
        pointer-events: none !important;
        position: fixed !important;
        z-index: 2147483647 !important;
      }
    `,
  },
  cool: {
    id: 'cool',
    label: 'Холодна',
    css: `
      html {
        filter: hue-rotate(195deg) saturate(0.88) brightness(0.96) contrast(1.02) !important;
      }
      html::after {
        background: rgba(110, 168, 254, 0.12) !important;
        content: "" !important;
        inset: 0 !important;
        mix-blend-mode: soft-light !important;
        pointer-events: none !important;
        position: fixed !important;
        z-index: 2147483647 !important;
      }
    `,
  },
};

const THEME_ORDER = ['gold', 'dark', 'warm', 'cool', 'off'];

function getInzhurPageTheme(themeId) {
  return INZHUR_PAGE_THEMES[themeId] || INZHUR_PAGE_THEMES.gold;
}

function nextInzhurPageThemeId(currentId) {
  const index = THEME_ORDER.indexOf(currentId);
  const nextIndex = index >= 0 ? (index + 1) % THEME_ORDER.length : 0;
  return THEME_ORDER[nextIndex];
}

function buildInzhurThemeInjectScript(themeId) {
  const theme = getInzhurPageTheme(themeId);
  return `(() => {
    const styleId = ${JSON.stringify(STYLE_ID)};
    document.getElementById(styleId)?.remove();
    if (${JSON.stringify(themeId)} === 'off') return true;
    const style = document.createElement('style');
    style.id = styleId;
    style.textContent = ${JSON.stringify(theme.css)};
    (document.head || document.documentElement).appendChild(style);
    return true;
  })()`;
}

module.exports = {
  INZHUR_PAGE_THEMES,
  THEME_ORDER,
  getInzhurPageTheme,
  nextInzhurPageThemeId,
  buildInzhurThemeInjectScript,
};
