import { describe, expect, it } from 'vitest';

import { resolveFeatureColor, resolveFeatureColorPickerValue } from '../feature-palette';

describe('shared feature palette', () => {
  it('preserves a valid explicit caller color', () => {
    expect(resolveFeatureColor({ name: 'caller choice', type: 'cds', color: '#12Ab9F' })).toBe('#12Ab9F');
  });

  it('is deterministic across repeated calls and serialized values', () => {
    const feature = { name: 'beta lactamase', type: 'resistance' as const };
    const first = resolveFeatureColor(feature);
    expect(resolveFeatureColor(feature)).toBe(first);
    expect(resolveFeatureColor({ ...feature, color: first })).toBe(first);
  });

  it('keeps one semantic type on one theme-adaptive token', () => {
    const first = resolveFeatureColor({ name: 'alpha coding region', type: 'cds' });
    const second = resolveFeatureColor({ name: 'omega coding region', type: 'cds' });
    expect(first).toBe('var(--accent, #7E9BBF)');
    expect(second).toBe(first);
  });

  it('hashes custom and unknown types into the curated theme-token ramp', () => {
    const custom = resolveFeatureColor({ name: 'unclassified island', type: 'custom' });
    const unknown = resolveFeatureColor({ name: 'unclassified island', type: 'future_feature' });
    expect(custom).toMatch(/^var\(--(?:accent|green|purple|amber|red|feature-neutral), #[0-9a-f]{6}\)$/i);
    expect(unknown).toMatch(/^var\(--(?:accent|green|purple|amber|red|feature-neutral), #[0-9a-f]{6}\)$/i);
    expect(resolveFeatureColor({ name: 'unclassified island', type: 'future_feature' })).toBe(unknown);
  });

  it('replaces unsafe explicit values with a deterministic safe default', () => {
    const feature = { name: 'unsafe', type: 'gene' as const, color: 'url(javascript:alert(1))' };
    expect(resolveFeatureColor(feature)).toBe(resolveFeatureColor(feature));
    expect(resolveFeatureColor(feature)).toBe('var(--accent, #7E9BBF)');
  });

  it('materializes a semantic token to the active opaque theme color for a native picker', () => {
    const stored = 'var(--accent, #7E9BBF)';
    const picker = resolveFeatureColorPickerValue(stored, (name) => (
      name === '--accent' ? '#0169cc' : undefined
    ));

    expect(picker).toBe('#0169cc');
    expect(stored).toBe('var(--accent, #7E9BBF)');
  });

  it('uses the portable token fallback when the active theme is unavailable', () => {
    expect(resolveFeatureColorPickerValue('var(--purple, #9E96B4)')).toBe('#9e96b4');
  });

  it('resolves approved theme mixes against the active workspace background', () => {
    const values: Record<string, string> = {
      '--green': '#40c977',
      '--bg-primary': '#1f1f1f',
    };
    expect(resolveFeatureColorPickerValue(
      'color-mix(in srgb, var(--green, #7FA98F) 80%, var(--bg-primary))',
      (name) => values[name],
    )).toBe('#39a765');
  });

  it('always returns an opaque six-digit sRGB value to the picker', () => {
    expect(resolveFeatureColorPickerValue('#AbC')).toBe('#aabbcc');
    expect(resolveFeatureColorPickerValue('hsl(120 50% 50%)')).toBe('#8b8f99');
  });
});
