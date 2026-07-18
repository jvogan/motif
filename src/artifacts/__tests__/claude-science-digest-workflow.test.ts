import { describe, expect, it } from 'vitest';
import { RESTRICTION_ENZYMES_FULL } from '../../bio/enzyme-data';
import type { Feature, RestrictionEnzyme, Topology } from '../../bio/types';
import { buildDigestRecipe, type DigestRecipe } from '../claude-science-digest-recipe';
import {
  DigestWorkflowMaterializationError,
  materializeDigestWorkflow,
  MAX_DIGEST_WORKFLOW_FRAGMENTS,
  MAX_DIGEST_WORKFLOW_RECORDS,
  type DigestWorkflowSourceRecord,
  type MaterializeDigestWorkflowInput,
} from '../claude-science-digest-workflow';

const CREATED_AT = '2026-07-12T20:15:00.000Z';
const SHA256 = 'a'.repeat(64);

function sourceRecord(
  sequence: string,
  topology: Topology = 'linear',
  features: readonly Feature[] = [],
): DigestWorkflowSourceRecord {
  return {
    id: 'source-record',
    name: 'Source plasmid',
    sequence,
    type: 'dna',
    topology,
    active: true,
    features,
    organism: 'synthetic construct',
    group: 'Cloning / DNA',
    tags: ['diagnostic'],
  };
}

function recipeFor(
  record: DigestWorkflowSourceRecord,
  enzymeText: string,
  enzymeCatalog: readonly RestrictionEnzyme[] = RESTRICTION_ENZYMES_FULL,
): DigestRecipe {
  return buildDigestRecipe({
    sequence: record.sequence,
    sequenceType: record.type,
    topology: record.topology,
    enzymeText,
    enzymeCatalog,
    features: record.features,
  });
}

function materialize(
  record: DigestWorkflowSourceRecord,
  recipe: DigestRecipe,
  overrides: Partial<MaterializeDigestWorkflowInput> = {},
) {
  return materializeDigestWorkflow({
    sourceRecord: record,
    recipe,
    workflow: {
      id: 'digest-workflow-1',
      createdAt: CREATED_AT,
      inputSha256: SHA256,
      engineVersion: '2.5.0',
    },
    ...overrides,
  });
}

describe('Claude Science digest workflow materialization', () => {
  it('materializes a linear sticky-end digest as deterministic, validated child records', () => {
    const source = sourceRecord('AAAAGAATTCTTTT');
    source.translationTableId = 11;
    const recipe = recipeFor(source, 'EcoRI');

    const result = materialize(source, recipe);

    expect(result.records).toHaveLength(2);
    expect(result.records.every((record) => record.translationTableId === 11)).toBe(true);
    expect(result.records.every((record) => record.provenance.translationTableId === 11)).toBe(true);
    expect(result.records.map((record) => ({
      id: record.id,
      name: record.name,
      sequence: record.seq,
      topology: record.topology,
    }))).toEqual([
      {
        id: 'digest-workflow-1-fragment-1',
        name: 'Fragment 1 (EcoRI) of Source plasmid',
        sequence: 'AAAAG',
        topology: 'linear',
      },
      {
        id: 'digest-workflow-1-fragment-2',
        name: 'Fragment 2 (EcoRI) of Source plasmid',
        sequence: 'AATTCTTTT',
        topology: 'linear',
      },
    ]);
    expect(result.records[0]).toMatchObject({
      molecule: 'dna',
      overhang5: '',
      overhang5Type: 'blunt',
      overhang3: 'AATT',
      overhang3Type: '5prime',
      organism: 'synthetic construct',
      group: 'Cloning / DNA',
      tags: ['diagnostic'],
      dateAdded: CREATED_AT,
      provenance: {
        parentRecordId: 'source-record',
        operation: 'restriction_digest',
        workflowResultId: 'digest-workflow-1',
        fragmentIndex: 1,
        fragmentCount: 2,
        leftEnzyme: null,
        rightEnzyme: 'EcoRI',
        overhang3: 'AATT',
        overhang3Type: '5prime',
      },
    });
    expect(result.records[1]).toMatchObject({
      overhang5: 'AATT',
      overhang5Type: '5prime',
      overhang3: '',
      overhang3Type: 'blunt',
      provenance: { leftEnzyme: 'EcoRI', rightEnzyme: null },
    });
    expect(result.workflowResult).toMatchObject({
      id: 'digest-workflow-1',
      kind: 'digest',
      inputRecordIds: ['source-record'],
      inputSha256s: [SHA256],
      outputRecordIds: ['digest-workflow-1-fragment-1', 'digest-workflow-1-fragment-2'],
      parameters: {
        enzymes: ['EcoRI'],
        topology: 'linear',
        cutCount: 1,
        outcome: 'fragmented',
      },
      result: {
        outcome: 'fragmented',
        physicalFragmentCount: 2,
        derivedRecordCount: 2,
      },
      provenance: {
        source: 'motif-for-claude-science-artifact',
        operation: 'restriction_digest',
        engine: 'motif-for-claude-science-artifact',
        engineVersion: '2.5.0',
        parentIds: ['source-record'],
      },
    });
  });

  it('records an uncut reaction without creating a misleading duplicate child record', () => {
    const source = sourceRecord('AAAAAAAAAAAA', 'circular');
    const recipe = recipeFor(source, 'EcoRI');

    const result = materialize(source, recipe, { outputIdentities: [] });

    expect(recipe.outcome).toBe('uncut');
    expect(recipe.fragments).toHaveLength(1);
    expect(result.records).toEqual([]);
    expect(result.workflowResult.outputRecordIds).toEqual([]);
    expect(result.workflowResult.result).toMatchObject({
      outcome: 'uncut',
      physicalFragmentCount: 1,
      derivedRecordCount: 0,
      fragments: [expect.objectContaining({ outputRecordId: null, length: source.sequence.length })],
    });
    expect(() => materialize(source, recipe, {
      outputIdentities: [{ id: 'fake-uncut-child' }],
    })).toThrow(/identity count.*must match.*0/i);
  });

  it('linearizes a one-cut circular molecule with the exact wrap-around sequence', () => {
    const source = sourceRecord('AAAAGAATTCTTTT', 'circular');
    const recipe = recipeFor(source, 'EcoRI');

    const result = materialize(source, recipe);

    expect(recipe.outcome).toBe('linearized');
    expect(result.records).toHaveLength(1);
    expect(result.records[0]).toMatchObject({
      id: 'digest-workflow-1-linearized',
      name: 'Source plasmid · linearized (EcoRI)',
      topology: 'linear',
      seq: 'AATTCTTTTAAAAG',
      length: source.sequence.length,
      overhang5: 'AATT',
      overhang3: 'AATT',
      provenance: {
        sourceTopology: 'circular',
        startInOriginal: 5,
        endInOriginal: 19,
        wrapsOrigin: true,
        leftEnzyme: 'EcoRI',
        rightEnzyme: 'EcoRI',
      },
    });
    expect(result.workflowResult.outputRecordIds).toEqual(['digest-workflow-1-linearized']);
    expect(result.workflowResult.result).toMatchObject({
      fragments: [expect.objectContaining({ wrapsOrigin: true, startInOriginal: 5, endInOriginal: 19 })],
    });
  });

  it('preserves every base and identifies the origin-wrapping fragment of a multi-cut circle', () => {
    const source = sourceRecord('GAATTCAAAAGAATTC', 'circular');
    const recipe = recipeFor(source, 'EcoRI');

    const result = materialize(source, recipe);

    expect(recipe.outcome).toBe('fragmented');
    expect(result.records.map((record) => record.seq)).toEqual(['AATTCAAAAG', 'AATTCG']);
    expect(result.records.reduce((total, record) => total + record.length, 0)).toBe(source.sequence.length);
    expect(result.records[0].provenance.wrapsOrigin).toBe(false);
    expect(result.records[1].provenance).toMatchObject({
      startInOriginal: 11,
      endInOriginal: 17,
      wrapsOrigin: true,
    });
  });

  it('emits explicit empty-string blunt ends both on records and in provenance', () => {
    const blunt: RestrictionEnzyme = {
      name: 'BluntI',
      recognitionSequence: 'GGG',
      cutOffset: 1,
      complementCutOffset: 1,
      overhang: 'blunt',
    };
    const source = sourceRecord('AAAGGGTTT');
    const recipe = recipeFor(source, 'BluntI', [blunt]);

    const result = materialize(source, recipe);

    expect(result.records.map((record) => ({
      overhang5: record.overhang5,
      overhang3: record.overhang3,
      overhang5Type: record.overhang5Type,
      overhang3Type: record.overhang3Type,
    }))).toEqual([
      { overhang5: '', overhang3: '', overhang5Type: 'blunt', overhang3Type: 'blunt' },
      { overhang5: '', overhang3: '', overhang5Type: 'blunt', overhang3Type: 'blunt' },
    ]);
    expect(result.records[0].provenance).toMatchObject({ overhang5: '', overhang3: '' });
  });

  it.each([
    {
      label: 'forward',
      sequence: 'TTTTTGGTCTCACAGTGGGGGGGG',
      downstreamOverhang: 'CAGT',
      upstreamOverhang: 'ACTG',
      strand: 1,
    },
    {
      label: 'reverse',
      sequence: 'AAAACCCCAGAGACCTTTTTTTT',
      downstreamOverhang: 'CCCC',
      upstreamOverhang: 'GGGG',
      strand: -1,
    },
  ])('retains honest $label-strand Type IIS geometry in records and workflow history', ({
    sequence,
    downstreamOverhang,
    upstreamOverhang,
    strand,
  }) => {
    const source = sourceRecord(sequence);
    const recipe = recipeFor(source, 'BsaI');

    const result = materialize(source, recipe);

    expect(recipe.sites).toMatchObject([{ strand }]);
    expect(result.records[0]).toMatchObject({
      overhang3: upstreamOverhang,
      overhang3Type: '5prime',
      provenance: { rightEnzyme: 'BsaI', overhang3: upstreamOverhang },
    });
    expect(result.records[1]).toMatchObject({
      overhang5: downstreamOverhang,
      overhang5Type: '5prime',
      provenance: { leftEnzyme: 'BsaI', overhang5: downstreamOverhang },
    });
    expect(result.workflowResult.parameters).toMatchObject({
      enzymeGeometry: [{
        name: 'BsaI',
        type: 'type-iis',
        recognitionSequence: 'GGTCTC',
        cutOffset: 7,
        complementCutOffset: 11,
        overhang: '5prime',
      }],
    });
  });

  it('re-keys propagated features deterministically and returns defensive nested metadata', () => {
    const feature: Feature = {
      id: 'source-feature',
      name: 'contained feature',
      type: 'misc_feature',
      start: 1,
      end: 4,
      strand: 1,
      color: '#abcdef',
      metadata: { nested: { source: 'fixture' } },
      subRanges: [{ start: 1, end: 3, strand: 1 }],
    };
    const source = sourceRecord('AAAAGAATTCTTTT', 'linear', [feature]);
    const first = materialize(source, recipeFor(source, 'EcoRI'));
    const second = materialize(source, recipeFor(source, 'EcoRI'));

    expect(first).toEqual(second);
    expect(first.records[0].annotations).toMatchObject([{
      id: 'digest-feature-1',
      name: 'contained feature',
      start: 1,
      end: 3,
      subRanges: [{ start: 1, end: 3, strand: 1 }],
      metadata: { nested: { source: 'fixture' } },
    }]);
    ((feature.metadata.nested as { source: string }).source) = 'mutated';
    expect(first.records[0].annotations[0].metadata).toEqual({
      nested: { source: 'fixture' },
      sourceRecordId: 'source-record',
      sourceFeatureId: 'source-feature',
      generatedBy: 'restriction_digest',
    });
  });

  it('repositions both tail and head features onto an origin-wrapping circular fragment', () => {
    const features: Feature[] = [
      {
        id: 'tail-feature',
        name: 'tail',
        type: 'misc_feature',
        start: 12,
        end: 15,
        strand: 1,
        color: '#aaaaaa',
        metadata: {},
      },
      {
        id: 'head-feature',
        name: 'head',
        type: 'misc_feature',
        start: 0,
        end: 1,
        strand: -1,
        color: '#bbbbbb',
        metadata: {},
      },
      {
        id: 'origin-feature',
        name: 'origin join',
        type: 'cds',
        start: 0,
        end: 15,
        strand: 1,
        color: '#cccccc',
        metadata: {},
        subRanges: [
          { start: 12, end: 15, strand: 1 },
          { start: 0, end: 1, strand: 1 },
        ],
      },
    ];
    const source = sourceRecord('GAATTCAAAAGAATTC', 'circular', features);
    const result = materialize(source, recipeFor(source, 'EcoRI'));

    expect(result.records[0].annotations).toEqual([]);
    expect(result.records[1].provenance.wrapsOrigin).toBe(true);
    expect(result.records[1].annotations.map((feature) => ({
      name: feature.name,
      start: feature.start,
      end: feature.end,
      sourceFeatureId: feature.metadata.sourceFeatureId,
    }))).toEqual([
      { name: 'tail', start: 1, end: 4, sourceFeatureId: 'tail-feature' },
      { name: 'head', start: 5, end: 6, sourceFeatureId: 'head-feature' },
      { name: 'origin join', start: 1, end: 6, sourceFeatureId: 'origin-feature' },
    ]);
    expect(result.records[1].annotations[2].subRanges).toEqual([
      { start: 1, end: 4, strand: 1 },
      { start: 5, end: 6, strand: 1 },
    ]);
  });

  it('accepts caller identities while enforcing count, id, and case-insensitive name uniqueness atomically', () => {
    const source = sourceRecord('AAAAGAATTCTTTT');
    const recipe = recipeFor(source, 'EcoRI');
    const customized = materialize(source, recipe, {
      outputIdentities: [
        { id: 'left-arm', name: 'Left diagnostic arm' },
        { id: 'right-arm', name: 'Right diagnostic arm' },
      ],
    });
    expect(customized.records.map(({ id, name }) => ({ id, name }))).toEqual([
      { id: 'left-arm', name: 'Left diagnostic arm' },
      { id: 'right-arm', name: 'Right diagnostic arm' },
    ]);
    expect(materialize(source, recipe, { outputNamePrefix: 'Diagnostic digest' })
      .records.map((record) => record.name)).toEqual([
      'Fragment 1 (EcoRI) of Diagnostic digest',
      'Fragment 2 (EcoRI) of Diagnostic digest',
    ]);

    expect(() => materialize(source, recipe, {
      outputIdentities: [{ id: 'one-only' }],
    })).toMatchErrorCode('identity-count');
    expect(() => materialize(source, recipe, {
      outputIdentities: [{ id: 'duplicate' }, { id: 'duplicate' }],
    })).toMatchErrorCode('duplicate-id');
    expect(() => materialize(source, recipe, {
      outputIdentities: [
        { id: 'one', name: 'Same name' },
        { id: 'two', name: 'same NAME' },
      ],
    })).toMatchErrorCode('duplicate-name');
    expect(() => materialize(source, recipe, {
      existingRecordIds: ['digest-workflow-1-fragment-1'],
    })).toMatchErrorCode('duplicate-id');
    expect(() => materialize(source, recipe, {
      existingRecordNames: ['fragment 1 (ecori) of source plasmid'],
    })).toMatchErrorCode('duplicate-name');
    expect(() => materialize(source, recipe, {
      existingRecordIds: Array.from(
        { length: MAX_DIGEST_WORKFLOW_RECORDS - 1 },
        (_, index) => `existing-${index}`,
      ),
    })).toMatchErrorCode('resource-limit');
  });

  it('rejects inactive/non-DNA sources and stale, invalid, or geometrically altered recipes', () => {
    const source = sourceRecord('AAAAGAATTCTTTT');
    const recipe = recipeFor(source, 'EcoRI');
    expect(() => materialize({ ...source, active: false }, recipe)).toMatchErrorCode('inactive-source');
    expect(() => materialize({ ...source, type: 'rna' }, recipe)).toMatchErrorCode('invalid-source');
    expect(() => materialize(source, recipeFor(source, 'DefinitelyNotAnEnzyme')))
      .toMatchErrorCode('invalid-recipe');
    expect(() => materialize({ ...source, topology: 'circular' }, recipe))
      .toMatchErrorCode('invalid-recipe');

    const altered: DigestRecipe = {
      ...recipe,
      fragments: recipe.fragments.map((fragment, index) => (
        index === 0 ? { ...fragment, sequence: `T${fragment.sequence.slice(1)}` } : fragment
      )),
    };
    expect(() => materialize(source, altered)).toMatchErrorCode('incoherent-recipe');
  });

  it('bounds pathological digests before they can exceed the portable workspace record limit', () => {
    const everyBase: RestrictionEnzyme = {
      name: 'EveryI',
      recognitionSequence: 'A',
      cutOffset: 0,
      complementCutOffset: 0,
      overhang: 'blunt',
    };
    const source = sourceRecord('A'.repeat(MAX_DIGEST_WORKFLOW_FRAGMENTS + 1), 'circular');
    const recipe = recipeFor(source, 'EveryI', [everyBase]);

    expect(recipe.fragments).toHaveLength(MAX_DIGEST_WORKFLOW_FRAGMENTS + 1);
    expect(() => materialize(source, recipe)).toMatchErrorCode('resource-limit');
  });
});

declare module 'vitest' {
  interface Assertion<T> {
    toMatchErrorCode(expected: string): T;
  }
}

expect.extend({
  toMatchErrorCode(received: unknown, expected: string) {
    let thrown: unknown;
    try {
      (received as () => unknown)();
    } catch (error) {
      thrown = error;
    }
    const pass = thrown instanceof DigestWorkflowMaterializationError && thrown.code === expected;
    return {
      pass,
      message: () => pass
        ? `expected function not to throw DigestWorkflowMaterializationError(${expected})`
        : `expected DigestWorkflowMaterializationError(${expected}), received ${String(thrown)}`,
    };
  },
});
