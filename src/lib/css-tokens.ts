/**
 * Phase 32 — JS ↔ CSS token bridge
 *
 * Read CSS custom properties from `:root` at runtime so theme/HC switches
 * propagate to renderers that previously hardcoded color literals. Falls back
 * to the supplied default when the token is undefined (server / pre-mount) so
 * the helpers are safe in non-browser contexts.
 */

const isBrowser =
  typeof window !== 'undefined' && typeof document !== 'undefined';

function readToken(name: string, fallback: string): string {
  if (!isBrowser) return fallback;
  const value = getComputedStyle(document.documentElement)
    .getPropertyValue(name)
    .trim();
  // Phase 38 W1 defensive guard: a CSS variable resolved to `transparent` or
  // `rgba(0, 0, 0, 0)` makes any character it colors invisible. That was the
  // exact bug shape for `--aa-class-stop` in the compact renderers — the token
  // was intentionally `transparent` for DetailSequenceDisplay's anchor-only
  // tile design, but the detail codon-block styling paints its stop state with
  // a literal `transparent !important` rather than this token, so it kept working. The
  // compact renderers route through getAAColorToken() and got an invisible
  // glyph instead. Treat both transparency representations as "absent" so the
  // caller's fallback palette renders a visible color.
  if (!value || value === 'transparent' || value === 'rgba(0, 0, 0, 0)') {
    return fallback;
  }
  return value;
}

/**
 * Phase 38 Tier 5 (Pass 4 F1 fix): build a `var(--name, fallback)` CSS value
 * string that the browser resolves on every paint. Using this instead of
 * `readToken()` for inline `style={{ color }}` makes theme/HC switches
 * propagate to already-mounted spans without re-rendering. The earlier
 * resolved-hex approach baked the value at memo-compute time — and because
 * the React render runs BEFORE ThemeProvider's `data-theme` useEffect, the
 * resolved hex was always one theme behind on toggle.
 *
 * Falls back to the supplied default when not in a browser (SSR/jsdom) so
 * the helpers stay safe in non-browser contexts. The token is also probed
 * once to detect the `transparent` sentinel (intentional for the
 * DetailSequenceDisplay anchor-tile design) so callers fall back to the
 * theme-aware static palette rather than rendering invisible glyphs.
 */
function readTokenAsCssVar(name: string, fallback: string): string {
  if (!isBrowser) return fallback;
  // Probe once to honor the transparency-is-absent contract from
  // `readToken()`. If the live token is `transparent`, return the static
  // fallback (the caller's per-theme palette) instead of routing through
  // `var(...)` — otherwise the browser would paint the invisible token
  // every repaint and the W1 fix would regress.
  const probe = getComputedStyle(document.documentElement)
    .getPropertyValue(name)
    .trim();
  if (probe === 'transparent' || probe === 'rgba(0, 0, 0, 0)') {
    return fallback;
  }
  return `var(${name}, ${fallback})`;
}

/**
 * Amino-acid physicochemical class → CSS token name. Mirrors the 5 classes
 * defined by `--aa-class-*` in `src/index.css`. P / G / * / X are "special".
 */
const AA_CLASS_BY_LETTER: Record<string, 'hydrophobic' | 'polar' | 'positive' | 'negative' | 'special' | 'stop'> = {
  // Hydrophobic
  A: 'hydrophobic', V: 'hydrophobic', I: 'hydrophobic',
  L: 'hydrophobic', M: 'hydrophobic', F: 'hydrophobic',
  W: 'hydrophobic',
  // Polar uncharged
  S: 'polar', T: 'polar', C: 'polar',
  Y: 'polar', N: 'polar', Q: 'polar',
  // Positive
  K: 'positive', R: 'positive', H: 'positive',
  // Negative
  D: 'negative', E: 'negative',
  // Special / structural
  G: 'special', P: 'special', X: 'special',
  // Stop codon
  '*': 'stop',
};

/**
 * Resolve the CSS-token color for an amino-acid letter. Returns the live
 * `--aa-class-*` value (resolved to a literal hex) so theme/HC switches
 * reach the caller. The supplied fallback is used when the token is
 * undefined (SSR, jsdom, missing :root).
 *
 * Use this for consumers that need a literal color string (Canvas
 * `fillStyle`, color-math like `color-mix` polyfills). For inline-style
 * consumers prefer `getAAColorVar()` which returns a `var(...)` form so
 * the browser repaints on theme change.
 */
export function getAAColorToken(aa: string, fallback = '#9ca3af'): string {
  const cls = AA_CLASS_BY_LETTER[aa.toUpperCase()] ?? 'special';
  return readToken(`--aa-class-${cls}`, fallback);
}

/**
 * Phase 38 Tier 5 (Pass 4 F1 fix): return a CSS-var reference string for
 * an AA letter so the browser repaints on theme switch. The returned form
 * is one of `var(--aa-class-stop, fallback)`, `var(--aa-class-polar, fallback)`,
 * etc. — one of the five token names defined per-theme in `src/index.css`.
 *
 * Bug shape: Pass 4 measured the stop-codon asterisk dropping to 2.54:1 on
 * dark bg after a live `light to dark` toggle. The colorMap useMemo had
 * `effectiveTheme` as a dep and DID recompute, but `getAAColorToken`
 * resolved values via `getComputedStyle` at render time. React renders the
 * new memo BEFORE ThemeProvider's `useEffect` fires the `data-theme=dark`
 * attribute, so the resolved hex was always one theme behind. Routing
 * through CSS-var references defers resolution to paint time, after the
 * attr lands.
 */
export function getAAColorVar(aa: string, fallback = '#9ca3af'): string {
  const cls = AA_CLASS_BY_LETTER[aa.toUpperCase()] ?? 'special';
  return readTokenAsCssVar(`--aa-class-${cls}`, fallback);
}

/**
 * Build an HC-aware AA palette by resolving every letter through the live
 * `--aa-class-*` CSS tokens. Drop-in replacement for `AA_COLORS` /
 * `AA_COLORS_LIGHT` from `bio/types.ts`. Pass the per-theme fallback palette
 * to preserve SSR/jsdom behavior when the CSS variable is unavailable.
 *
 * Phase 32 P0-1: bridges the compact renderers (SequenceDisplay,
 * CanvasSequenceDisplay, MSAPanel, ProteinAnalysisPanel) to the same token
 * layer the detail renderer reads via `data-aa-class`. Without this, HC
 * mode skipped the compact AA palette — same bug shape as the Phase 28.5
 * workbar regression.
 *
 * Phase 38 Tier 5: now returns CSS-var reference strings (one of the five
 * `--aa-class-*` names) for DOM consumers (SequenceDisplay,
 * LineSequenceDisplay) so theme toggles propagate to already-mounted
 * spans (Pass 4 F1 fix). Canvas-only consumers should call
 * `resolveAaPaletteLiteral()` for hex strings.
 */
export function resolveAaPalette(
  fallback: Record<string, string>,
): Record<string, string> {
  const result: Record<string, string> = {};
  for (const aa of Object.keys(fallback)) {
    result[aa] = getAAColorVar(aa, fallback[aa] ?? '#9ca3af');
  }
  return result;
}

/**
 * Phase 38 Tier 5: Canvas-only variant of `resolveAaPalette()`. Returns a
 * literal hex color per AA (resolved via `getComputedStyle`), suitable for
 * Canvas `fillStyle` which cannot interpret `var(...)`. Loses live theme
 * propagation in exchange — Canvas re-renders are gated by the `colorMap`
 * useMemo, which already re-runs on theme change, so Canvas was never the
 * surface that exhibited the F1 bug.
 */
export function resolveAaPaletteLiteral(
  fallback: Record<string, string>,
): Record<string, string> {
  const result: Record<string, string> = {};
  for (const aa of Object.keys(fallback)) {
    result[aa] = getAAColorToken(aa, fallback[aa] ?? '#9ca3af');
  }
  return result;
}

/**
 * Resolve the CSS-token color for a feature type. Returns the live
 * `--feature-{type}` value (themed + HC-aware). The supplied fallback is used
 * when the token is undefined.
 */
export function getFeatureColorToken(type: string, fallback = '#6b7280'): string {
  return readToken(`--feature-${type}`, fallback);
}

/**
 * Generic CSS variable reader. Useful for one-off lookups that don't justify
 * a named helper. Returns the trimmed computed value or the fallback.
 */
export function getCssVar(name: string, fallback = ''): string {
  return readToken(name.startsWith('--') ? name : `--${name}`, fallback);
}
