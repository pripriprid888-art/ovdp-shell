const STYLE_ID = 'ovdp-inzhur-theme';

const INZHUR_SHELL_THEME_CSS = `
  html {
    filter: invert(0.91) hue-rotate(180deg) brightness(0.96) contrast(0.98) !important;
  }
  img, video, picture, svg, [style*="background-image"] {
    filter: invert(1) hue-rotate(180deg) !important;
  }
  html::after {
    background: rgba(61, 138, 181, 0.08) !important;
    content: "" !important;
    inset: 0 !important;
    mix-blend-mode: soft-light !important;
    pointer-events: none !important;
    position: fixed !important;
    z-index: 2147483647 !important;
  }
`;

function buildInzhurThemeInjectScript(enabled = true) {
  return `(() => {
    const styleId = ${JSON.stringify(STYLE_ID)};
    document.getElementById(styleId)?.remove();
    if (!${enabled ? 'true' : 'false'}) return true;
    const style = document.createElement('style');
    style.id = styleId;
    style.textContent = ${JSON.stringify(INZHUR_SHELL_THEME_CSS)};
    (document.head || document.documentElement).appendChild(style);
    return true;
  })()`;
}

module.exports = {
  STYLE_ID,
  buildInzhurThemeInjectScript,
};
