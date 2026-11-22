import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const here = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(resolve(here, '../motif-artifact.tsx'), 'utf8');

describe('theme is light until the user picks one', () => {
  it('starts light whatever the system setting', () => {
    expect(source).toMatch(/const DEFAULT_WORKSPACE_LAYOUT: WorkspaceLayoutPrefs = \{\n(?:\s*\/\/[^\n]*\n)*\s*theme: 'light',/);
    // The system's dark mode is never read for the theme, before or after mount.
    expect(source).not.toContain('prefers-color-scheme');
    expect(source).not.toContain('SYSTEM_DARK_QUERY');
    expect(source).not.toContain('systemArtifactTheme');
    // The pre-render palette and the first render read the same saved layout.
    expect(source).toContain('applyArtifactTheme(loadWorkspaceLayoutPrefs().theme);');
    expect(source).toContain('const [theme, chooseTheme] = useState<ArtifactThemeName>(initialWorkspaceLayout.theme);');
  });

  it('lets a saved choice win and changes the theme only from Settings and the top-bar flip', () => {
    expect(source).toMatch(/onChange=\{\(\) => \{\s*chooseTheme\(option\.id\);\s*\}\}/);
    // Two callers: the Settings grid, and the top bar's icon, which flips to the
    // other theme through the same setter. The bar has no theme select.
    expect(source.match(/\bchooseTheme\(/g)).toHaveLength(2);
    expect(source).toContain("onClick={() => chooseTheme(theme === 'dark' ? 'light' : 'dark')}");
    expect(source).not.toContain('name="artifact-theme"');
    expect(source).not.toMatch(/\bsetTheme\(/);
    // The current theme is saved with the layout, so a pick survives a reload.
    expect(source).toMatch(/saveWorkspaceLayoutPrefs\(\{\n\s*theme,\n/);
  });

  it('keeps the two themes', () => {
    expect(source).toContain("if (value === 'light' || value === 'dark') return value;");
    expect(source).toContain("type ArtifactThemeName = 'light' | 'dark';");
  });

  it('offers exactly Light and Dark in the Settings grid', () => {
    const options = source.slice(source.indexOf('const THEME_OPTIONS'), source.indexOf('];', source.indexOf('const THEME_OPTIONS')));
    expect([...options.matchAll(/\{ id: '([a-z-]+)', label: '([^']+)'/g)].map((m) => [m[1], m[2]])).toEqual([['light', 'Light'], ['dark', 'Dark']]);
    // The one control renders THEME_OPTIONS and nothing else.
    expect(source.match(/THEME_OPTIONS\.map\(/g)).toHaveLength(1);
    expect(source).toContain('data-theme-choice={option.id}');
    expect(source).toMatch(/name="settings-theme"\s+value=\{option\.id\}/);
  });

  it('maps a legacy stored theme name to Light or Dark and anything else to the default', () => {
    const start = source.indexOf('function normalizeArtifactThemeName(value: unknown): ArtifactThemeName {');
    const body = source.slice(source.indexOf('{', start) + 1, source.indexOf('\n}\n', start));
    const normalize = new Function('value', 'DEFAULT_WORKSPACE_LAYOUT', body) as (value: unknown, defaults: { theme: string }) => string;
    const read = (value: unknown) => normalize(value, { theme: 'light' });
    expect(read('light')).toBe('light');
    expect(read('dark')).toBe('dark');
    expect(read('warm-light')).toBe('light');
    expect(read('warm-dark')).toBe('dark');
    expect(read('claude-light')).toBe('light');
    expect(read('claude-dark')).toBe('dark');
    expect(read('claude')).toBe('light');
    expect(read('tokyo')).toBe('dark');
    for (const unknown of ['sepia', '', 'Dark', null, undefined, 3, {}]) expect(read(unknown)).toBe('light');
    // First open stays Light whatever the system says: see 'starts light whatever the system setting'.
  });

  it('sends every way a theme arrives through that normaliser', () => {
    // Stored layout (current and legacy key) on load and before first paint.
    expect(source).toContain('theme: normalizeArtifactThemeName(source.theme),');
    expect(source).toContain('applyArtifactTheme(loadWorkspaceLayoutPrefs().theme);');
    // The Settings radios carry only THEME_OPTIONS ids, so they need no normalising.
    expect(source).toMatch(/onChange=\{\(\) => \{\s*chooseTheme\(option\.id\);/);
    // There is no host message, URL or data attribute that sets the theme: the
    // root attribute has one writer and it takes an already-normalised name.
    expect(source.match(/dataset\.theme\s*=/g)).toHaveLength(1);
    expect(source).toContain('root.dataset.theme = theme;');
    expect(source).not.toMatch(/searchParams\.get\(['"]theme/);
  });
});
