import { describe, expect, it } from 'vitest';
import { translationTrackGutterLabels, translationTrackKind } from '../motif-artifact';

describe('translation track gutter labels', () => {
  it('draws the type for tracks whose names draw the same six characters', () => {
    const labels = translationTrackGutterLabels([
      { id: 'cds', label: 'SELENOP', kind: 'cds' },
      { id: 'sig', label: 'SELENOP', kind: 'sig_peptide' },
      { id: 'mat', label: 'SELENOQ', kind: 'mat_peptide' },
      { id: 'pin', label: 'SELENOP 1-2056 +1' },
      { id: 'amp', label: 'AmpR', kind: 'resistance' },
    ]);
    expect(Object.fromEntries(labels)).toEqual({ cds: 'cds', sig: 'sig', mat: 'mat', pin: 'pinned', amp: 'AmpR' });
  });

  it('numbers tracks that share a drawn name and a type', () => {
    const labels = translationTrackGutterLabels([
      { id: 'a', label: 'SELENOP', kind: 'cds' },
      { id: 'b', label: 'SELENOP isoform 2', kind: 'cds' },
      { id: 'c', label: 'SELENOP', kind: 'transit_peptide' },
    ]);
    expect(Object.fromEntries(labels)).toEqual({ a: 'cds1', b: 'cds2', c: 'trans' });
  });

  it('draws the feature name, not its type, for a name longer than the gutter', () => {
    // Every row is named for its feature, whatever the feature's type. The view hides a name
    // that does not fit the gutter and keeps the full name as the row's accessible text.
    const labels = translationTrackGutterLabels([
      { id: 'demo', label: 'demo_cds', kind: 'cds' },
      { id: 'lac', label: 'lacZ-alpha', kind: 'resistance' },
      { id: 'amp', label: 'AmpR', kind: 'resistance' },
    ]);
    expect(Object.fromEntries(labels)).toEqual({ demo: 'demo_cds', lac: 'lacZ-alpha', amp: 'AmpR' });
  });

  it('keeps long names that start apart, and numbers long names that start alike', () => {
    expect(Object.fromEntries(translationTrackGutterLabels([
      { id: 'a', label: 'alpha_subunit', kind: 'cds' },
      { id: 'b', label: 'beta_subunit', kind: 'cds' },
    ]))).toEqual({ a: 'alpha_subunit', b: 'beta_subunit' });
    expect(Object.fromEntries(translationTrackGutterLabels([
      { id: 'a', label: 'subunit_alpha', kind: 'cds' },
      { id: 'b', label: 'subunit_beta', kind: 'cds' },
    ]))).toEqual({ a: 'cds1', b: 'cds2' });
  });

  it('keeps names that already draw apart', () => {
    const labels = translationTrackGutterLabels([
      { id: 'tet', label: 'TetR', kind: 'resistance' },
      { id: 'rop', label: 'rop', kind: 'gene' },
      { id: 'amp', label: 'AmpR', kind: 'resistance' },
    ]);
    expect(Object.fromEntries(labels)).toEqual({ tet: 'TetR', rop: 'rop', amp: 'AmpR' });
  });

  it('names a pinned layer as pinned', () => {
    expect(translationTrackKind({ kind: 'sig_peptide' })).toBe('sig_peptide');
    expect(translationTrackKind({})).toBe('pinned');
  });
});
