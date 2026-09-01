import { describe, expect, it } from 'vitest';

import { resolveFeatureColor } from '../feature-palette';

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

  it('varies names within one semantic type without leaving its hue family', () => {
    const first = resolveFeatureColor({ name: 'alpha coding region', type: 'cds' });
    const second = resolveFeatureColor({ name: 'omega coding region', type: 'cds' });
    expect(first).not.toBe(second);
    expect(first).toMatch(/^#[0-9a-f]{6}$/i);
    expect(second).toMatch(/^#[0-9a-f]{6}$/i);
  });

  it('hashes custom and unknown types into the curated portable ramp', () => {
    const custom = resolveFeatureColor({ name: 'unclassified island', type: 'custom' });
    const unknown = resolveFeatureColor({ name: 'unclassified island', type: 'future_feature' });
    expect(custom).toMatch(/^#[0-9a-f]{6}$/i);
    expect(unknown).toMatch(/^#[0-9a-f]{6}$/i);
    expect(resolveFeatureColor({ name: 'unclassified island', type: 'future_feature' })).toBe(unknown);
    expect(unknown).not.toBe('#9AA3B5');
  });

  it('replaces unsafe explicit values with a deterministic safe default', () => {
    const feature = { name: 'unsafe', type: 'gene' as const, color: 'url(javascript:alert(1))' };
    expect(resolveFeatureColor(feature)).toBe(resolveFeatureColor(feature));
    expect(resolveFeatureColor(feature)).toMatch(/^#[0-9a-f]{6}$/i);
  });
});
