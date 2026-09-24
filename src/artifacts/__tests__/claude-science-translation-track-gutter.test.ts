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
