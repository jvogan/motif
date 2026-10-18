import { describe, expect, it } from 'vitest';
import { RESTRICTION_ENZYMES_FULL } from '../../bio/enzyme-data';
import { findRestrictionSites } from '../../bio/restriction-sites';
import {
  createArtifactDatabaseSnapshot,
  getArtifactCheckpointExportIssues,
  normalizeRecord,
  prepareArtifactDatabaseRestore,
} from '../motif-artifact';

// A nicking enzyme reports the nicked strand of the molecule, so its hits on
// the two strands carry opposite modes. The checkpoint stores one mode per site
// group, so those hits travel as two groups of the same enzyme, and every
// consumer reads the flattened sites back with each hit's own mode.

const artifactState: Parameters<typeof createArtifactDatabaseSnapshot>[1] = {
  customEnzymes: [],
  translationLayersByRecord: {},
  enzymeSourcesByRecord: {},
  hiddenEnzymesByRecord: {},
  hiddenFeatureTranslationsByRecord: {},
  restrictionLabelsByRecord: {},
  motifsByRecord: {},
};

describe('a nickase with hits on both strands', () => {
  it('round-trips through a checkpoint with each hit keeping its own mode', () => {
    const nickase = RESTRICTION_ENZYMES_FULL.find((enzyme) => enzyme.name === 'Nt.BstNBI');
    expect(nickase?.cleavageMode).toBe('nick_top');
    // GAGTC on the top strand, its reverse complement GACTC later on.
    const sequence = `${'A'.repeat(30)}GAGTC${'A'.repeat(40)}GACTC${'A'.repeat(30)}`;
    const sites = findRestrictionSites(sequence, [nickase!], { topology: 'linear' });
    const modes = sites.map((site) => `${site.strand}:${site.cleavageMode}`).sort();
    expect(modes).toEqual(['-1:nick_bottom', '1:nick_top']);

    const record = normalizeRecord({ id: 'nickase', name: 'nickase', molecule: 'dna', topology: 'linear', seq: sequence }, 0)!;
    const withSites = { ...record, sites };
    expect(getArtifactCheckpointExportIssues([withSites])).toEqual([]);

    const checkpoint = createArtifactDatabaseSnapshot({
      schema: 'motif.inventory.v1',
      inventory: {},
      records: [withSites],
      selectedRecordId: 'nickase',
      alignments: [],
      notes: [],
      workflowResults: [],
      analysisResults: [],
      analysisAssets: [],
    } as unknown as Parameters<typeof createArtifactDatabaseSnapshot>[0], artifactState);
    const [serialized] = checkpoint.records as Array<{ sites: Array<{ enzyme: string; cleavageMode?: string; count: number }> }>;
    expect(serialized.sites.map((group) => [group.enzyme, group.cleavageMode, group.count]).sort()).toEqual([
      ['Nt.BstNBI', 'nick_bottom', 1],
      ['Nt.BstNBI', 'nick_top', 1],
    ]);

    const restored = prepareArtifactDatabaseRestore(JSON.parse(JSON.stringify(checkpoint))).payload.records[0];
    expect(restored.sites.map((site) => `${site.strand}:${site.cleavageMode}`).sort()).toEqual(modes);
    expect(restored.sites.filter((site) => site.enzyme === 'Nt.BstNBI')).toHaveLength(2);
  });
});
