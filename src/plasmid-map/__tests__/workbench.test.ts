import { describe, expect, it } from 'vitest';

import {
  createBioMapCommentSelection,
  createBioMapCompareSelection,
  createBioMapDesignSelection,
  createBioMapDigestSelection,
  createBioMapRestrictionClusterSelection,
  createBioMapRestrictionSiteSelection,
  createBioMapHighlightSelection,
  createBioMapMotifSelection,
  createBioMapOrfSelection,
  createBioMapScarSelection,
  createBioMapVariantSelection,
  legacySelectionForBioMapSelection,
  restrictionClusterIdForBioMapSelection,
} from '../workbench';

describe('map workbench restriction identity', () => {
  it('resolves a direct restriction-cluster id from selection', () => {
    const selection = createBioMapRestrictionClusterSelection({
      blockId: 'b1',
      clusterId: 'cluster-a',
      tickIds: ['EcoRI@10', 'BamHI@12'],
      source: 'map',
      primaryRange: { start: 10, end: 16 },
    });

    expect(restrictionClusterIdForBioMapSelection(selection)).toBe('cluster-a');
  });

  it('remaps stale restriction cluster ids through durable tick ids', () => {
    const selection = createBioMapRestrictionClusterSelection({
      blockId: 'b1',
      clusterId: 'stale-cluster',
      tickIds: ['EcoRI@10', 'BamHI@12'],
      source: 'map',
      primaryRange: { start: 10, end: 16 },
    });

    expect(restrictionClusterIdForBioMapSelection(selection, [
      { clusterId: 'cluster-current', tickIds: ['EcoRI@10', 'BamHI@12'] },
    ])).toBe('cluster-current');
  });

  it('remaps single restriction-site selections to containing render clusters', () => {
    const selection = createBioMapRestrictionSiteSelection({
      blockId: 'b1',
      tickId: 'EcoRI@10',
      clusterId: 'stale-single',
      source: 'map',
      primaryRange: { start: 10, end: 16 },
      position: 10,
    });

    expect(restrictionClusterIdForBioMapSelection(selection, [
      { clusterId: 'cluster-current', tickIds: ['EcoRI@10', 'BamHI@12'] },
    ])).toBe('cluster-current');
  });

  it('creates durable object selections for selectable range overlays', () => {
    const highlight = createBioMapHighlightSelection({
      blockId: 'b1',
      highlightId: 'hl-a',
      source: 'map',
      primaryRange: { start: 900, end: 1000 },
      focusedRanges: [{ start: 900, end: 1000 }, { start: 0, end: 90 }],
      label: 'Region A',
    });
    const comment = createBioMapCommentSelection({
      blockId: 'b1',
      commentId: 'comment-a',
      source: 'map',
      primaryRange: { start: 300, end: 301 },
      label: 'Review junction',
    });
    const scar = createBioMapScarSelection({
      blockId: 'b1',
      scarId: 'scar-a',
      source: 'map',
      primaryRange: { start: 410, end: 411 },
      label: 'Deletion at 411',
    });
    const orf = createBioMapOrfSelection({
      blockId: 'b1',
      orfId: 'orf:+1:12:180:0',
      source: 'map',
      primaryRange: { start: 12, end: 180 },
      label: 'ORF +1 55 aa',
    });
    const motif = createBioMapMotifSelection({
      blockId: 'b1',
      motifId: 'motif-atg',
      source: 'map',
      primaryRange: { start: 0, end: 3 },
      focusedRanges: [{ start: 0, end: 3 }, { start: 12, end: 15 }],
      label: 'Motif ATG',
    });
    const variant = createBioMapVariantSelection({
      blockId: 'b1',
      variantId: 'variant-a',
      source: 'map',
      primaryRange: { start: 42, end: 43 },
      label: 'A>G',
    });
    const digest = createBioMapDigestSelection({
      blockId: 'b1',
      digestId: 'digest-frag-a',
      source: 'map',
      primaryRange: { start: 100, end: 300 },
      label: 'EcoRI fragment',
    });
    const design = createBioMapDesignSelection({
      blockId: 'b1',
      designId: 'primer-fwd-a',
      source: 'map',
      primaryRange: { start: 12, end: 34 },
      label: 'Forward primer',
    });
    const compare = createBioMapCompareSelection({
      blockId: 'b1',
      compareId: 'cmp-a',
      source: 'map',
      primaryRange: { start: 20, end: 21 },
      label: 'A/G mismatch',
    });

    expect(highlight.ref).toMatchObject({ blockId: 'b1', kind: 'highlight', id: 'hl-a', label: 'Region A' });
    expect(highlight.focusedRanges).toEqual([{ start: 900, end: 1000 }, { start: 0, end: 90 }]);
    expect(comment.ref).toMatchObject({ blockId: 'b1', kind: 'comment', id: 'comment-a' });
    expect(scar.ref).toMatchObject({ blockId: 'b1', kind: 'scar', id: 'scar-a' });
    expect(orf.ref).toMatchObject({ blockId: 'b1', kind: 'orf', id: 'orf:+1:12:180:0' });
    expect(motif.ref).toMatchObject({ blockId: 'b1', kind: 'motif', id: 'motif-atg' });
    expect(motif.focusedRanges).toEqual([{ start: 0, end: 3 }, { start: 12, end: 15 }]);
    expect(variant.ref).toMatchObject({ blockId: 'b1', kind: 'variant', id: 'variant-a', label: 'A>G' });
    expect(digest.ref).toMatchObject({ blockId: 'b1', kind: 'digest', id: 'digest-frag-a', label: 'EcoRI fragment' });
    expect(design.ref).toMatchObject({ blockId: 'b1', kind: 'design', id: 'primer-fwd-a', label: 'Forward primer' });
    expect(compare.ref).toMatchObject({ blockId: 'b1', kind: 'compare', id: 'cmp-a', label: 'A/G mismatch' });

    expect(legacySelectionForBioMapSelection(highlight)).toEqual({
      selectedFeatureId: null,
      selectionSource: 'map',
      selectedRange: { start: 900, end: 1000 },
      focusedRanges: [{ start: 900, end: 1000 }, { start: 0, end: 90 }],
    });
  });
});
