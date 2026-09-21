export type Theme = 'light' | 'dark';

function classHasTheme(value: string, kind: Theme): boolean {
  return new RegExp(`(?:vsts|vss)-theme-${kind}|theme-${kind}\\b`).test(value);
}

/** Relative luminance (0..1) of an rgb/rgba color string, or null if transparent/unparseable. */
function relativeLuminance(color: string): number | null {
  const match = color.match(/rgba?\(([^)]+)\)/);
  if (!match) return null;
  const parts = match[1].split(',').map((s) => parseFloat(s.trim()));
  const [r, g, b, a = 1] = parts;
  if (!Number.isFinite(r) || a === 0) return null;
  const linear = [r, g, b].map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2];
}

function backgroundLuminance(): number | null {
  for (const el of [document.body, document.documentElement]) {
    if (!el) continue;
    const lum = relativeLuminance(getComputedStyle(el).backgroundColor);
    if (lum != null) return lum;
  }
  return null;
}

/**
 * Detect the Azure DevOps page theme. Checks known theme classes first (e.g.
 * `vss-theme-dark`), then falls back to the page's background luminance (works regardless of
 * class names), then the OS preference.
 */
export function detectAdoTheme(): Theme {
  for (const el of [document.documentElement, document.body]) {
    const cls = (el?.className ?? '').toString();
    if (classHasTheme(cls, 'dark')) return 'dark';
    if (classHasTheme(cls, 'light')) return 'light';
  }
  const lum = backgroundLuminance();
  if (lum != null) return lum < 0.5 ? 'dark' : 'light';
  if (window.matchMedia?.('(prefers-color-scheme: dark)')?.matches) return 'dark';
  return 'dark';
}

/** Notify when the ADO theme may have changed (class/style toggles, OS preference). */
export function subscribeAdoTheme(callback: () => void): () => void {
  const observer = new MutationObserver(callback);
  const opts: MutationObserverInit = {
    attributes: true,
    attributeFilter: ['class', 'style', 'data-theme'],
  };
  if (document.body) observer.observe(document.body, opts);
  observer.observe(document.documentElement, opts);
  const media = window.matchMedia?.('(prefers-color-scheme: dark)');
  media?.addEventListener?.('change', callback);
  return () => {
    observer.disconnect();
    media?.removeEventListener?.('change', callback);
  };
}
