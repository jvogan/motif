/** @vitest-environment jsdom */

import { afterEach, describe, expect, it, vi } from 'vitest';

import { resolveFeatureColorPickerValue } from '../feature-palette';

afterEach(() => vi.restoreAllMocks());

describe('feature palette browser color resolution', () => {
  it.each([
    ['red', '#ff0000'],
    ['rgb(10 20 30)', '#0a141e'],
    ['hsl(120 50% 50%)', '#40bf40'],
  ])('seeds the native picker from the accepted CSS literal %s', (stored, expected) => {
    expect(resolveFeatureColorPickerValue(stored)).toBe(expected);
  });

  it('composites a translucent literal over the active workspace background', () => {
    expect(resolveFeatureColorPickerValue(
      'rgb(10 20 30 / 50%)',
      (name) => name === '--bg-primary' ? '#f0f0f0' : undefined,
    )).toBe('#7d8287');
    expect(resolveFeatureColorPickerValue(
      'transparent',
      (name) => name === '--bg-primary' ? '#112233' : undefined,
    )).toBe('#112233');
  });

  it('rounds decimal CSSOM channels and preserves percentage alpha', () => {
    vi.spyOn(window, 'getComputedStyle').mockReturnValue({
      color: 'rgba(10.5, 20.5, 30.5, 50%)',
    } as CSSStyleDeclaration);

    expect(resolveFeatureColorPickerValue(
      'red',
      (name) => name === '--bg-primary' ? '#f0f0f0' : undefined,
    )).toBe('#7e8388');
  });

  it.each([
    ['#0000', '#fffdf9', '#fffdf9'],
    ['#0000', '#232323', '#232323'],
    ['#ff000080', '#fffdf9', '#ff7e7c'],
    ['#ff000080', '#232323', '#911111'],
  ])('composites the alpha-hex literal %s over %s', (stored, background, expected) => {
    expect(resolveFeatureColorPickerValue(
      stored,
      (name) => name === '--bg-primary' ? background : undefined,
    )).toBe(expected);
  });

  it('keeps invalid and semantic-value handling on their existing paths', () => {
    expect(resolveFeatureColorPickerValue('not-a-color')).toBe('#8b8f99');
    expect(resolveFeatureColorPickerValue(
      'var(--accent, #7E9BBF)',
      (name) => name === '--accent' ? '#0169cc' : undefined,
    )).toBe('#0169cc');
  });
});
