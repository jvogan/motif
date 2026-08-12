import { describe, expect, it, vi } from 'vitest';
import {
  designPrimerPairWithDiagnostics,
  type PrimerCandidate,
  type PrimerDesignParams,
  type PrimerPair,
} from '../../bio/primer-design';
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
import * as pcrModule from '../../bio/pcr';

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
  it('does not save a record or result when PCR reports conflicting overlap edits', () => {
    const template = 'AAAACCCCGGGGTTTTAAAACCCCGGGGTTTT';
    const selected = selection(pairFor(template, 4, 14, 20, 30));
    const exact = simulatePCR(
      template,
      selected.pair.forward.fullSequence,
      selected.pair.reverse.fullSequence,
      [],
      'linear',
      {
        forward: { start: selected.pair.forward.start, end: selected.pair.forward.end },
        reverse: { start: selected.pair.reverse.start, end: selected.pair.reverse.end },
      },
    );
    expect(exact).not.toBeNull();
    if (!exact) throw new Error('Expected a PCR fixture.');
    const spy = vi.spyOn(pcrModule, 'simulatePCR').mockReturnValue({
      ...exact,
      materializable: false,
      diagnostics: [{
        code: 'conflicting_overlapping_binding_edits',
        message: 'conflict',
        positions: [20],
      }],
    });
    try {
      expect(() => materializePcrAmplicon({
        sourceRecord: source(template),
        selection: selected,
        identity: {
          recordId: 'conflict-record',
          resultId: 'conflict-result',
          productId: 'conflict-product',
          createdAt: '2026-07-17T12:00:00.000Z',
        },
        primerDesignResultId: 'primer-result',
      })).toThrowError(new PcrMaterializationError(
        'The selected primer pair has conflicting overlapping edits and cannot be materialized safely.',
      ));
    } finally {
      spy.mockRestore();
    }
  });

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

    const malformedReview = structuredClone(baseSelection);
    malformedReview.evidenceReview = {
      schema: 'motif.primer.evidence-review.v0',
      required: false,
      acknowledged: false,
      reasonCodes: [],
    };
    expect(() => materialize(malformedReview)).toThrowError(new PcrMaterializationError(
      'Evidence review does not match motif.primer.evidence-review.v1.',
    ));
  });

  it('creates one exact linear record with primer annotations, hashes, and a linked PCR result', () => {
    const template = 'ATGCGTACGATCAGATCGTACGCAT';
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
    const tmEvidence = {
      conditionPresetId: 'custom',
      conditionPresetName: 'Custom bounded Tm conditions',
      model: 'santalucia-1998-nearest-neighbor',
      engine: 'motif-tm-calculator',
      engineVersion: '1',
      options: {
        method: 'nearest-neighbor',
        naConcentration: 75,
        mgConcentration: 2,
        dntpConcentration: 0.8,
        primerConcentration: 100,
        saltCorrection: 'owczarzy',
        selfComplementarity: 'auto',
      },
    };
    const evidenceReview = {
      schema: 'motif.primer.evidence-review.v1',
      required: true,
      acknowledged: true,
      reasonCodes: ['cross-dimer-3-prime'],
      acknowledgedAt: '2026-07-17T12:00:00.000Z',
    };
    const parameters: PrimerDesignParams = {
        targetStart: 12,
        targetEnd: 13,
        minLength: 12,
        maxLength: 12,
        minGC: 0,
        maxGC: 1,
        enforceTargetTm: false,
        requireGcClamp: false,
        flankingWindow: 12,
        forwardTail: 'GGATCC',
        reverseTail: 'CATATG',
        maxHairpinDeltaG: null,
        maxSelfDimerDeltaG: null,
        maxCrossDimerDeltaG: null,
        maxPairs: 100,
        tmConditionPresetId: 'custom',
        tmOptions: {
          method: 'nearest-neighbor',
          naConcentration: 75,
          mgConcentration: 2,
          dntpConcentration: 0.8,
          primerConcentration: 100,
          saltCorrection: 'owczarzy',
        },
    };
    const recomputedPair = designPrimerPairWithDiagnostics(template, parameters).pairs.find((pair) => (
      pair.forward.start === 0 && pair.forward.end === 12
      && pair.reverse.start === 12 && pair.reverse.end === 24
    ));
    expect(recomputedPair).toBeDefined();
    const selected: PcrMaterializationSelection = {
      ...selection(recomputedPair!),
      tmEvidence: {
        ...tmEvidence,
        options: { ...tmEvidence.options, mgConcentration: 999 },
      },
      evidenceReview,
      parameters,
    };
    const templateRecord = source(template, 'linear', [feature]);
    templateRecord.translationTableId = 2;
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
      translationTableId: 2,
      length: result.record.seq.length,
      active: true,
      group: 'Cloning',
      tags: ['source', 'PCR amplicon'],
      provenance: {
        operation: 'pcr_materialization',
        engineVersion: result.simulation.provenance.engineVersion,
        productAssembly: result.simulation.provenance.productAssembly,
        parentRecordId: 'template-1',
        primerDesignResultId: 'primer-result',
        productSha256: sha256HexSync(result.record.seq),
        translationTableId: 2,
        tmEvidence,
        evidenceReview: {
          schema: 'motif.primer.evidence-review.v1',
          assertion: {
            schema: 'motif.primer.evidence-acknowledgment.v1',
            acknowledged: true,
            acknowledgedAt: '2026-07-17T12:00:00.000Z',
          },
        },
        cloningPreparation: {
          requestSha256: 'a'.repeat(64),
          actionId: 'prep-action',
        },
        metadata: {
          productAssembly: result.simulation.provenance.productAssembly,
          tailPolicy: result.simulation.provenance.tailPolicy,
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
      parameters: {
        topology: 'linear',
        tmEvidence: { schema: 'motif.primer.tm-evidence.v1' },
        evidenceReview: { schema: 'motif.primer.evidence-review.v1' },
      },
      provenance: {
        engineVersion: result.simulation.provenance.engineVersion,
        metadata: {
          productAssembly: result.simulation.provenance.productAssembly,
          tailPolicy: result.simulation.provenance.tailPolicy,
          tmEvidence: { schema: 'motif.primer.tm-evidence.v1' },
          evidenceReview: { schema: 'motif.primer.evidence-review.v1' },
        },
      },
      data: {
        templateRecordId: 'template-1',
        primerDesignResultId: 'primer-result',
        products: [{
          id: 'pcr-product',
          recordId: 'amplicon-record',
          lengthBp: result.record.seq.length,
          templateRange: { start: 0, end: 24 },
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

  it('recomputes incomplete-search review evidence before accepting its separate acknowledgment', () => {
    const template = 'ATGCGTACGATCCGTAAGCTGACCTAGTCGATGCTACGGTCAATCG'.repeat(10);
    const parameters: PrimerDesignParams = {
      targetStart: 160,
      targetEnd: 240,
      minLength: 12,
      maxLength: 12,
      minGC: 0,
      maxGC: 1,
      enforceTargetTm: false,
      requireGcClamp: false,
      flankingWindow: 20,
      maxHairpinDeltaG: null,
      maxSelfDimerDeltaG: null,
      maxCrossDimerDeltaG: null,
      maxPairingCandidatesPerDirection: 1,
      maxPairs: 1,
    };
    const design = designPrimerPairWithDiagnostics(template, parameters);
    expect(design.warnings?.join(' ')).toMatch(/not exhaustive/iu);
    expect(design.pairs[0]).toBeDefined();
    const result = materializePcrAmplicon({
      sourceRecord: source(template),
      selection: {
        ...selection(design.pairs[0]),
        parameters,
        evidenceReview: {
          schema: 'motif.primer.evidence-review.v1',
          required: true,
          acknowledged: true,
          reasonCodes: ['search-evidence-incomplete'],
          acknowledgedAt: '2026-07-17T12:00:00.000Z',
        },
      },
      identity: {
        recordId: 'bounded-record',
        resultId: 'bounded-result',
        productId: 'bounded-product',
        createdAt: '2026-07-17T12:00:00.000Z',
      },
      primerDesignResultId: 'bounded-primer-result',
    });
    expect(result.record.provenance.evidenceReview).toMatchObject({
      required: true,
      reasonCodes: expect.arrayContaining(['search-evidence-incomplete']),
      assertion: { acknowledged: true },
    });
  });

  it('rejects non-object review assertions and timestamps without acknowledgment', () => {
    const template = 'AAAACCCCGGGGTTTTAAAACCCCGGGGTTTTAAAACCCC';
    const pair = pairFor(template, 2, 12, 24, 34);
    const identity = {
      recordId: 'review-record',
      resultId: 'review-result',
      productId: 'review-product',
      createdAt: '2026-07-17T12:00:00.000Z',
    };

    expect(() => materializePcrAmplicon({
      sourceRecord: source(template),
      selection: { ...selection(pair), evidenceReview: null as never },
      identity,
      primerDesignResultId: 'primer-result',
    })).toThrow(PcrMaterializationError);

    expect(() => materializePcrAmplicon({
      sourceRecord: source(template),
      selection: {
        ...selection(pair),
        evidenceReview: {
          schema: 'motif.primer.evidence-review.v1',
          required: false,
          acknowledged: false,
          reasonCodes: [],
          acknowledgedAt: 'not-a-timestamp',
        },
      },
      identity,
      primerDesignResultId: 'primer-result',
    })).toThrow(/timestamp is allowed only when the review is acknowledged/i);
  });

  it('omits an invalid linear template range for an origin-crossing product', () => {
    const template = 'AAAACCCCGGGGTTTTAAAACCCCGGGGTTTTAAAACCCC';
    const result = materializePcrAmplicon({
      sourceRecord: source(template, 'circular'),
      selection: {
        ...selection(pairFor(template, 30, 40, 2, 12)),
        evidenceReview: {
          schema: 'motif.primer.evidence-review.v1',
          required: true,
          acknowledged: true,
          reasonCodes: [],
          acknowledgedAt: '2026-07-17T12:00:00.000Z',
        },
      },
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
