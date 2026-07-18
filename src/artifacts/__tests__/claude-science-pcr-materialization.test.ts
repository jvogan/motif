import { describe, expect, it } from 'vitest';
import type { PrimerCandidate, PrimerPair } from '../../bio/primer-design';
import { simulatePCR } from '../../bio/pcr';
import { reverseComplement } from '../../bio/reverse-complement';
import type { Feature } from '../../bio/types';
import {
  normalizeArtifactAnalysisWorkspace,
  type ArtifactAnalysisResult,
} from '../claude-science-analysis-results';
import {
  findPcrMaterializationDuplicate,
  materializePcrAmplicon,
  PcrMaterializationError,
  type PcrMaterializationSelection,
  type PcrMaterializationSourceRecord,
} from '../claude-science-pcr-materialization';
import { sha256HexSync } from '../claude-science-sha256';

function candidate(
  direction: 'forward' | 'reverse',
  sequence: string,
  start: number,
  end: number,
  tail = '',
): PrimerCandidate {
  return {
    direction,
    sequence,
    fullSequence: tail + sequence,
    tail,
    start,
    end,
    length: sequence.length,
    fullLength: sequence.length + tail.length,
    tm: 60,
    gcPercent: 50,
    anchorDistance: 0,
  };
}

function pairFor(
  template: string,
  forwardStart: number,
  forwardEnd: number,
  reverseStart: number,
  reverseEnd: number,
  forwardTail = '',
  reverseTail = '',
): PrimerPair {
  return {
    forward: candidate(
      'forward',
      template.slice(forwardStart, forwardEnd),
      forwardStart,
      forwardEnd,
      forwardTail,
    ),
    reverse: candidate(
      'reverse',
      reverseComplement(template.slice(reverseStart, reverseEnd)),
      reverseStart,
      reverseEnd,
      reverseTail,
    ),
    productLength: reverseEnd - forwardStart,
    tmDifference: 0,
  };
}

function selection(pair: PrimerPair): PcrMaterializationSelection {
  return {
    pair,
    pairNumber: 1,
    target: { start: pair.forward.start, end: pair.reverse.end },
  };
}

function source(
  sequence: string,
  topology: 'linear' | 'circular' = 'linear',
  features: readonly Feature[] = [],
): PcrMaterializationSourceRecord {
  return {
    id: 'template-1',
    name: 'Template DNA',
    sequence,
    type: 'dna',
    topology,
    active: true,
    features,
    group: 'Cloning',
    tags: ['source'],
  };
}

describe('PCR engine selected-pair semantics', () => {
  it('uses the selected repeat occurrence and incorporates both 5′ tails with correct reverse-primer semantics', () => {
    const template = 'AACCGGTTAA' + 'GGGGGGGGGG' + 'AACCGGTTAA' + 'CCCCCCCCCC' + 'TTGCAACGTA' + 'AAAAAAAAAA';
    const pair = pairFor(template, 20, 30, 40, 50, 'GGATCC', 'CATATG');
    const result = simulatePCR(
      template,
      pair.forward.fullSequence,
      pair.reverse.fullSequence,
      [],
      'linear',
      {
        forward: { start: pair.forward.start, end: pair.forward.end },
        reverse: { start: pair.reverse.start, end: pair.reverse.end },
      },
    );

    expect(result).not.toBeNull();
    expect(result?.forward.bindStart).toBe(20);
    expect(result?.product).toBe(`GGATCC${template.slice(20, 50)}${reverseComplement('CATATG')}`);
    expect(result?.product.startsWith(pair.forward.fullSequence)).toBe(true);
    expect(result?.product.endsWith(reverseComplement(pair.reverse.fullSequence))).toBe(true);
  });

  it('propagates in-range feature subranges and source identity into product coordinates', () => {
    const template = 'AAAACCCCGGGGTTTTAAAACCCCGGGGTTTT';
    const pair = pairFor(template, 4, 14, 20, 30, 'GGATCC', 'AAGCTT');
    const feature: Feature = {
      id: 'source-feature',
      name: 'coding segment',
      type: 'cds',
      start: 10,
      end: 16,
      strand: 1,
      subRanges: [{ start: 11, end: 14, strand: 1 }],
      color: '#000000',
      metadata: { note: 'retain' },
    };
    const result = simulatePCR(
      template,
      pair.forward.fullSequence,
      pair.reverse.fullSequence,
      [feature],
      'linear',
      {
        forward: { start: 4, end: 14 },
        reverse: { start: 20, end: 30 },
      },
    );

    expect(result?.features).toHaveLength(1);
    expect(result?.features[0]).toMatchObject({
      start: 13,
      end: 16,
      subRanges: [{ start: 13, end: 16, strand: 1 }],
      metadata: {
        note: 'retain',
        pcrSourceFeatureId: 'source-feature',
        pcrSourceStart: 10,
        pcrSourceEnd: 16,
      },
    });
  });

  it('creates the exact origin-crossing product for a selected circular pair', () => {
    const template = 'AAAACCCCGGGGTTTTAAAACCCCGGGGTTTTAAAACCCC';
    const pair = pairFor(template, 30, 40, 2, 12);
    const result = simulatePCR(
      template,
      pair.forward.fullSequence,
      pair.reverse.fullSequence,
      [],
      'circular',
      {
        forward: { start: 30, end: 40 },
        reverse: { start: 2, end: 12 },
      },
    );

    expect(result?.wrapsOrigin).toBe(true);
    expect(result?.product).toBe(template.slice(30) + template.slice(0, 12));
  });

  it('propagates an origin-spanning multipart feature through circular PCR', () => {
    const template = 'AAAACCCCGGGGTTTTAAAACCCCGGGGTTTTAAAACCCC';
    const pair = pairFor(template, 30, 40, 2, 12);
    const feature: Feature = {
      id: 'origin-cds',
      name: 'origin CDS',
      type: 'cds',
      start: 2,
      end: 36,
      strand: 1,
      color: '#000000',
      metadata: {},
      subRanges: [
        { start: 32, end: 36, strand: 1 },
        { start: 2, end: 6, strand: 1 },
      ],
    };

    const result = simulatePCR(
      template,
      pair.forward.fullSequence,
      pair.reverse.fullSequence,
      [feature],
      'circular',
      {
        forward: { start: 30, end: 40 },
        reverse: { start: 2, end: 12 },
      },
    );

    expect(result?.features).toMatchObject([{
      name: 'origin CDS',
      start: 2,
      end: 16,
      subRanges: [
        { start: 2, end: 6, strand: 1 },
        { start: 12, end: 16, strand: 1 },
      ],
    }]);
  });
});

describe('PCR amplicon materialization', () => {
  it('rejects noncanonical or internally inconsistent selected primer sequences', () => {
    const template = 'AAAACCCCGGGGTTTTAAAACCCCGGGGTTTT';
    const baseSelection = selection(pairFor(template, 4, 14, 20, 30));
    const materialize = (selected: PcrMaterializationSelection) => materializePcrAmplicon({
      sourceRecord: source(template),
      selection: selected,
      identity: {
        recordId: 'guarded-amplicon',
        resultId: 'guarded-result',
        productId: 'guarded-product',
        createdAt: '2026-07-17T12:00:00.000Z',
      },
      primerDesignResultId: 'primer-result',
    });

    const noncanonical = structuredClone(baseSelection);
    noncanonical.pair.forward.tail = 'NNNN';
    noncanonical.pair.forward.fullSequence = `NNNN${noncanonical.pair.forward.sequence}`;
    noncanonical.pair.forward.fullLength = noncanonical.pair.forward.fullSequence.length;
    expect(() => materialize(noncanonical)).toThrowError(new PcrMaterializationError(
      'Forward primer materialization requires unambiguous A/C/G/T binding and full sequences.',
    ));

    const inconsistent = structuredClone(baseSelection);
    inconsistent.pair.reverse.fullSequence = `A${inconsistent.pair.reverse.fullSequence}`;
    inconsistent.pair.reverse.fullLength = inconsistent.pair.reverse.fullSequence.length;
    expect(() => materialize(inconsistent)).toThrowError(new PcrMaterializationError(
      'Reverse primer fullSequence must equal its 5′ tail followed by its binding sequence.',
    ));
  });

  it('creates one exact linear record with primer annotations, hashes, and a linked PCR result', () => {
    const template = 'AAAACCCCGGGGTTTTAAAACCCCGGGGTTTT';
    const feature: Feature = {
      id: 'gene-1',
      name: 'payload',
      type: 'gene',
      start: 10,
      end: 16,
      strand: 1,
      color: '#000000',
      metadata: {},
    };
    const selected = selection(pairFor(template, 4, 14, 20, 30, 'GGATCC', 'CATATG'));
    const templateRecord = source(template, 'linear', [feature]);
    const sourceSnapshot = structuredClone(templateRecord);
    const result = materializePcrAmplicon({
      sourceRecord: templateRecord,
      selection: selected,
      identity: {
        recordId: 'amplicon-record',
        resultId: 'pcr-result',
        productId: 'pcr-product',
        createdAt: '2026-07-17T12:00:00.000Z',
      },
      primerDesignResultId: 'primer-result',
      preparation: {
        requestSha256: 'a'.repeat(64),
        actionId: 'prep-action',
        actionKind: 'add_homology',
        method: 'gibson',
        orientation: 'forward',
      },
    });

    expect(result.record).toMatchObject({
      id: 'amplicon-record',
      molecule: 'dna',
      topology: 'linear',
      length: result.record.seq.length,
      active: true,
      group: 'Cloning',
      tags: ['source', 'PCR amplicon'],
      provenance: {
        operation: 'pcr_materialization',
        parentRecordId: 'template-1',
        primerDesignResultId: 'primer-result',
        productSha256: sha256HexSync(result.record.seq),
        cloningPreparation: {
          requestSha256: 'a'.repeat(64),
          actionId: 'prep-action',
        },
      },
    });
    expect(templateRecord).toEqual(sourceSnapshot);
    expect(result.record.seq.startsWith(selected.pair.forward.fullSequence)).toBe(true);
    expect(result.record.seq.endsWith(reverseComplement(selected.pair.reverse.fullSequence))).toBe(true);
    expect(result.record.annotations.filter((item) => item.type === 'primer_bind')).toEqual([
      expect.objectContaining({ start: 0, strand: 1 }),
      expect.objectContaining({ end: result.record.seq.length, strand: -1 }),
    ]);
    expect(result.record.annotations.find((item) => item.name === 'payload')?.metadata).toMatchObject({
      pcrSourceFeatureId: 'gene-1',
    });
    expect(result.analysisResult).toMatchObject({
      id: 'pcr-result',
      kind: 'pcr',
      inputRecordIds: ['template-1'],
      dependsOnResultIds: ['primer-result'],
      parameters: { topology: 'linear' },
      data: {
        templateRecordId: 'template-1',
        primerDesignResultId: 'primer-result',
        products: [{
          id: 'pcr-product',
          recordId: 'amplicon-record',
          lengthBp: result.record.seq.length,
          templateRange: { start: 4, end: 30 },
        }],
      },
    });
    expect(result.materializationKey).toMatch(/^[0-9a-f]{64}$/);
    const primerResult: ArtifactAnalysisResult = {
      id: 'primer-result',
      kind: 'primer_design',
      name: 'Primer design',
      status: 'complete',
      inputRecordIds: ['template-1'],
      inputSha256s: [sha256HexSync(template)],
      dependsOnResultIds: [],
      assetIds: [],
      parameters: {},
      data: {
        targetRecordId: 'template-1',
        pairs: [{
          id: 'pair-1',
          forward: { sequence: selected.pair.forward.fullSequence, tmC: 60, gcPercent: 50 },
          reverse: { sequence: selected.pair.reverse.fullSequence, tmC: 60, gcPercent: 50 },
          productLengthBp: selected.pair.productLength,
        }],
        selectedPairId: 'pair-1',
      },
      createdAt: '2026-07-17T12:00:00.000Z',
      provenance: { source: 'motif-for-claude-science-artifact' },
    };
    const normalizedWorkspace = normalizeArtifactAnalysisWorkspace({
      analysisResults: [primerResult, result.analysisResult],
      analysisAssets: [],
    }, {
      recordLengths: new Map([
        ['template-1', template.length],
        ['amplicon-record', result.record.length],
      ]),
    });
    expect(normalizedWorkspace.analysisResults[1]).toMatchObject({
      dependsOnResultIds: ['primer-result'],
      data: { products: [{ recordId: 'amplicon-record' }] },
    });
    expect(findPcrMaterializationDuplicate([
      {
        id: result.record.id,
        name: result.record.name,
        sequence: result.record.seq,
        provenance: result.record.provenance,
      },
    ], result.materializationKey)?.id).toBe('amplicon-record');
    expect(findPcrMaterializationDuplicate([{
      id: result.record.id,
      name: result.record.name,
      sequence: `${result.record.seq}A`,
      provenance: result.record.provenance,
    }], result.materializationKey)).toBeNull();
    expect(findPcrMaterializationDuplicate([], result.materializationKey)).toBeNull();
  });

  it('omits an invalid linear template range for an origin-crossing product', () => {
    const template = 'AAAACCCCGGGGTTTTAAAACCCCGGGGTTTTAAAACCCC';
    const result = materializePcrAmplicon({
      sourceRecord: source(template, 'circular'),
      selection: selection(pairFor(template, 30, 40, 2, 12)),
      identity: {
        recordId: 'wrapped-record',
        resultId: 'wrapped-result',
        productId: 'wrapped-product',
        createdAt: '2026-07-17T12:00:00.000Z',
      },
      primerDesignResultId: 'primer-result',
    });

    expect(result.simulation.wrapsOrigin).toBe(true);
    expect(result.analysisResult.parameters.topology).toBe('circular');
    expect(result.analysisResult.data.products[0]).not.toHaveProperty('templateRange');
  });
});
