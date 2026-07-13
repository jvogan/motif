import type { Feature, FeatureType } from '../../bio/types';
import { getCssVar, getFeatureColorToken } from '../../lib/css-tokens';

/**
 * Maps GenBank/common feature types to conventional display colors.
 * Dark palette: bright colors for dark backgrounds.
 * Light palette: darkened equivalents that pass WCAG AA as small text on light sequence panels.
 *
 * Phase 32 P0-6: these constants stay as the canonical TS-side source of truth
 * (consumed directly by importers and tests), but `featureTypeDisplayColor()`
 * now prefers the live CSS token (`--feature-{type}`) when one is defined so
 * HC + theme switches reach the renderers. The constants serve as the SSR /
 * jsdom fallback.
 */
export const GENBANK_FEATURE_COLORS: Record<FeatureType, string> = {
  gene:            '#5E8FE0',
  cds:             '#5E8FE0',
  orf:             '#52C091',
  promoter:        '#E0A23C',
  terminator:      '#E07A6E',
  rbs:             '#E0A23C',
  origin:          '#A98BE0',
  resistance:      '#E08A4E',
  restriction_site:'#9AA3B5',
  primer_bind:     '#E08A4E',
  misc_feature:    '#9AA3B5',
  mRNA:            '#3FC4B0',
  rRNA:            '#3FC4B0',
  tRNA:            '#3FC4B0',
  ncRNA:           '#A98BE0',
  regulatory:      '#E0A23C',
  repeat_region:   '#A98BE0',
  sig_peptide:     '#86C95E',
  mat_peptide:     '#86C95E',
  transit_peptide: '#86C95E',
  intron:          '#9AA3B5',
  exon:            '#3FC4B0',
  polyA_signal:    '#E07A6E',
  enhancer:        '#E0A23C',
  custom:          '#9AA3B5',
};

export const GENBANK_FEATURE_COLORS_LIGHT: Record<FeatureType, string> = {
  gene:            '#1F5FC0',
  cds:             '#1F5FC0',
  orf:             '#1A7D4D',
  promoter:        '#8A5500',
  terminator:      '#B23A2C',
  rbs:             '#8A5500',
  origin:          '#6A3FBE',
  resistance:      '#A04A14',
  restriction_site:'#3D4757',
  primer_bind:     '#A04A14',
  misc_feature:    '#3D4757',
  mRNA:            '#0E7A6B',
  rRNA:            '#0E7A6B',
  tRNA:            '#0E7A6B',
  ncRNA:           '#6A3FBE',
  regulatory:      '#8A5500',
  repeat_region:   '#6A3FBE',
  sig_peptide:     '#3F7A14',
  mat_peptide:     '#3F7A14',
  transit_peptide: '#3F7A14',
  intron:          '#3D4757',
  exon:            '#0E7A6B',
  polyA_signal:    '#B23A2C',
  enhancer:        '#8A5500',
  custom:          '#3D4757',
};

type ThemeName = 'light' | 'dark';
type FeatureColorSource = Pick<Feature, 'type' | 'color'> & { metadata?: Feature['metadata'] };

const LIGHT_SEQUENCE_BACKGROUNDS = ['#ffffff', '#f5f5f5'];
const DARK_SEQUENCE_BACKGROUNDS = ['#24252b', '#2b2c33'];
const MIN_TEXT_CONTRAST = 4.5;
const FEATURE_LABEL_COLOR_METADATA_KEY = 'labelColor';

function normalizeHexColor(color: string): string | null {
  const trimmed = color.trim();
  const short = /^#([0-9a-f]{3})$/i.exec(trimmed);
  if (short) {
    return `#${short[1].split('').map((character) => character + character).join('').toLowerCase()}`;
  }
  const full = /^#([0-9a-f]{6})$/i.exec(trimmed);
  return full ? `#${full[1].toLowerCase()}` : null;
}

function cssVarName(color: string): string | null {
  const match = /^var\(\s*(--[a-z0-9_-]+)(?:\s*,[^)]*)?\)$/i.exec(color.trim());
  return match ? match[1] : null;
}

function resolvedHexColor(color: string): string | null {
  const direct = normalizeHexColor(color);
  if (direct) return direct;

  const variableName = cssVarName(color);
  if (!variableName) return null;

  return normalizeHexColor(getCssVar(variableName, ''));
}

function featureLabelColorOverride(feature: { metadata?: Feature['metadata'] }): string | null {
  const value = feature.metadata?.[FEATURE_LABEL_COLOR_METADATA_KEY];
  return typeof value === 'string' ? normalizeHexColor(value) : null;
}

function hexToRgb(hex: string): { r: number; g: number; b: number } {
  return {
    r: Number.parseInt(hex.slice(1, 3), 16),
    g: Number.parseInt(hex.slice(3, 5), 16),
    b: Number.parseInt(hex.slice(5, 7), 16),
  };
}

function rgbToHex({ r, g, b }: { r: number; g: number; b: number }): string {
  const channel = (value: number) => Math.round(Math.max(0, Math.min(255, value))).toString(16).padStart(2, '0');
  return `#${channel(r)}${channel(g)}${channel(b)}`;
}

function relativeLuminance(hex: string): number {
  const { r, g, b } = hexToRgb(hex);
  const linear = (channel: number) => {
    const normalized = channel / 255;
    return normalized <= 0.03928
      ? normalized / 12.92
      : ((normalized + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * linear(r) + 0.7152 * linear(g) + 0.0722 * linear(b);
}

export function colorContrastRatio(color: string, background: string): number {
  const colorHex = normalizeHexColor(color);
  const backgroundHex = normalizeHexColor(background);
  if (!colorHex || !backgroundHex) return 0;
  const lighter = Math.max(relativeLuminance(colorHex), relativeLuminance(backgroundHex));
  const darker = Math.min(relativeLuminance(colorHex), relativeLuminance(backgroundHex));
  return (lighter + 0.05) / (darker + 0.05);
}

function hasReadableContrast(color: string, backgrounds: string[]): boolean {
  return backgrounds.every((background) => colorContrastRatio(color, background) >= MIN_TEXT_CONTRAST);
}

function mixWith(color: string, target: string, amount: number): string {
  const start = hexToRgb(color);
  const end = hexToRgb(target);
  return rgbToHex({
    r: start.r + (end.r - start.r) * amount,
    g: start.g + (end.g - start.g) * amount,
    b: start.b + (end.b - start.b) * amount,
  });
}

function shiftUntilReadable(color: string, theme: ThemeName): string {
  const backgrounds = theme === 'light' ? LIGHT_SEQUENCE_BACKGROUNDS : DARK_SEQUENCE_BACKGROUNDS;
  if (hasReadableContrast(color, backgrounds)) return color;

  const target = theme === 'light' ? '#111827' : '#f8fafc';
  for (let amount = 0.12; amount <= 0.88; amount += 0.04) {
    const candidate = mixWith(color, target, amount);
    if (hasReadableContrast(candidate, backgrounds)) return candidate;
  }
  return theme === 'light' ? '#111827' : '#f8fafc';
}

export function featureTypeDisplayColor(type: FeatureType, theme: ThemeName): string {
  const fallback =
    theme === 'light'
      ? (GENBANK_FEATURE_COLORS_LIGHT[type] ?? GENBANK_FEATURE_COLORS_LIGHT.custom)
      : (GENBANK_FEATURE_COLORS[type] ?? GENBANK_FEATURE_COLORS.custom);
  // Phase 32 P0-6: prefer the live CSS token so HC + theme switches reach
  // every renderer that lands here (FeatureAnnotationTrack, FeatureSelector,
  // DetailSequenceDisplay). Hex constants above remain the SSR fallback.
  return getFeatureColorToken(type, fallback);
}

export function featureDisplayTextColor(
  feature: FeatureColorSource,
  theme: ThemeName,
  fallbackColor = featureTypeDisplayColor(feature.type, theme),
): string {
  const labelColor = featureLabelColorOverride(feature);
  if (labelColor) return labelColor;

  const rawColor = feature.color?.trim() || fallbackColor;
  const hexColor = resolvedHexColor(rawColor);
  if (!hexColor) return fallbackColor;

  return shiftUntilReadable(hexColor, theme);
}

function featureDisplayFillColor(
  feature: Pick<Feature, 'type' | 'color'>,
  fallbackColor: string,
): string {
  const rawColor = feature.color?.trim() || fallbackColor;
  if (rawColor.startsWith('var(')) return rawColor;

  return normalizeHexColor(rawColor) ?? rawColor;
}

function textColorOnFeatureFill(fillColor: string, theme: ThemeName): string {
  const hexColor = resolvedHexColor(fillColor);
  const darkText = '#111827';
  const lightText = '#f8fafc';

  if (!hexColor) return theme === 'light' ? darkText : lightText;

  return colorContrastRatio(darkText, hexColor) >= colorContrastRatio(lightText, hexColor)
    ? darkText
    : lightText;
}

export interface FeatureDisplayTokens {
  /**
   * The saturated base color for this feature. Explicit feature colors are kept
   * as-is so sequence bars match the inspector swatch.
   */
  base: string;
  /**
   * Background for foreground UI surfaces (pill chips in the Features
   * mini-table, badge backgrounds). Kept softer than the sequence feature bar
   * because these are UI chips rather than the feature itself.
   */
  bg: string;
  /** Idle background for the inline feature bar. Matches the feature swatch color. */
  fill: string;
  /** Outline color for the inline feature bar. */
  stroke: string;
  /** Foreground text color selected for contrast on `fill`. */
  text: string;
  selectedFill: string;
  selectedStroke: string;
  selectedText: string;
  hoverFill: string;
  selectedUnderlayFill: string;
  hoverUnderlayFill: string;
}

// Foreground-pill background saturation (Features mini-table chips). Sequence
// feature bars use the raw swatch color; pills stay softer because they are
// controls and metadata surfaces, not the feature geometry.
const FEATURE_PILL_BG_MIX_LIGHT = 18;
const FEATURE_PILL_BG_MIX_DARK = 26;

export function featureDisplayTokens(
  feature: FeatureColorSource,
  theme: ThemeName,
  fallbackColor = featureTypeDisplayColor(feature.type, theme),
): FeatureDisplayTokens {
  const base = featureDisplayFillColor(feature, fallbackColor);
  const labelText = featureLabelColorOverride(feature) ?? textColorOnFeatureFill(base, theme);
  const pillBgMix = theme === 'light' ? FEATURE_PILL_BG_MIX_LIGHT : FEATURE_PILL_BG_MIX_DARK;
  // Underlays are intentionally separate from the feature bar fill. They are
  // used only as a very soft hover/selection surface when a renderer needs one.
  const selectedUnderlayMix = theme === 'light' ? 13 : 20;
  const hoverUnderlayMix = theme === 'light' ? 8 : 13;

  return {
    base,
    bg: `color-mix(in srgb, ${base} ${pillBgMix}%, transparent)`,
    fill: base,
    stroke: base,
    text: labelText,
    selectedFill: base,
    selectedStroke: base,
    selectedText: labelText,
    hoverFill: base,
    selectedUnderlayFill: `color-mix(in srgb, ${base} ${selectedUnderlayMix}%, transparent)`,
    hoverUnderlayFill: `color-mix(in srgb, ${base} ${hoverUnderlayMix}%, transparent)`,
  };
}
