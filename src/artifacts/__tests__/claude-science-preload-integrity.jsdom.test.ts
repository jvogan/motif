// @vitest-environment jsdom

import { afterEach, describe, expect, it } from 'vitest';
import {
  loadInitialArtifactWorkspace,
  prepareInitialArtifactWorkspace,
  readInitialArtifactSourceFromDom,
} from '../motif-artifact';

function embed(value: string): void {
  document.body.innerHTML = `<script type="application/json" id="motif-artifact-data">${value}</script>`;
}

const validWorkspace = {
  schema: 'motif.claude-science.inventory.v2',
  inventory: { id: 'preload-integrity', title: 'Preload integrity' },
  records: [{ id: 'record-a', name: '__SEQUENCE_INVENTORY__ is data', type: 'dna', sequence: 'ATGGAATTCTAA' }],
  selectedRecordId: 'record-a',
  artifactState: {
    customEnzymes: [{
      name: 'PreloadI', recognitionSequence: 'GAATTC', cutOffset: 1, complementCutOffset: 5, overhang: '5prime',
    }],
    translationLayersByRecord: {
      'record-a': [{ id: 'layer-a', label: 'Layer A', start: 0, end: 6, strand: 1, frame: 0 }],
    },
    enzymeSourcesByRecord: { 'record-a': ['common'] },
    hiddenEnzymesByRecord: { 'record-a': ['EcoRI'] },
    hiddenFeatureTranslationsByRecord: { 'record-a': ['feat:a'] },
    restrictionLabelsByRecord: { 'record-a': true },
    motifsByRecord: { 'record-a': 'GAATTC' },
  },
} satisfies NonNullable<typeof window.MOTIF_ARTIFACT_DATA>;

describe('Claude Science initial workspace integrity', () => {
  afterEach(() => {
    document.body.innerHTML = '';
    delete window.MOTIF_ARTIFACT_DATA;
  });

  it('uses samples only for an absent payload or an exact build placeholder', () => {
    embed('__SEQUENCE_INVENTORY__');
    expect(readInitialArtifactSourceFromDom()).toEqual({ kind: 'sample' });
    const sample = loadInitialArtifactWorkspace();
    expect(sample.payload.inventory.id).toBe('motif-built-in-vectors');
    expect(sample.artifactState.customEnzymes).toEqual([]);

    window.MOTIF_ARTIFACT_DATA = validWorkspace;
    expect(readInitialArtifactSourceFromDom()).toMatchObject({
      kind: 'payload',
      origin: 'window',
      value: validWorkspace,
    });
    delete window.MOTIF_ARTIFACT_DATA;

    embed(JSON.stringify(validWorkspace));
    expect(readInitialArtifactSourceFromDom()).toMatchObject({ kind: 'payload', origin: 'script' });
  });

  it('hydrates payload and durable state as one validated initial workspace', () => {
    const prepared = prepareInitialArtifactWorkspace(validWorkspace);
    expect(prepared.payload.inventory.id).toBe('preload-integrity');
    expect(prepared.payload.records.map((record) => record.id)).toEqual(['record-a']);
    expect(prepared.artifactState.customEnzymes[0]?.name).toBe('PreloadI');
    expect(prepared.artifactState.translationLayersByRecord['record-a'][0]).toMatchObject({
      id: 'layer-a', start: 0, end: 6, source: 'layer',
    });

    embed(JSON.stringify(validWorkspace));
    expect(loadInitialArtifactWorkspace()).toEqual(prepared);
  });

  it('opens an alignment-only workspace with an empty inventory instead of sample records', () => {
    const prepared = prepareInitialArtifactWorkspace({
      alignments: [{
        id: 'alignment-only',
        molecule: 'dna',
        rows: [
          { id: 'a', name: 'A', aligned: 'ATGC' },
          { id: 'b', name: 'B', aligned: 'AT-C' },
        ],
      }],
    });
    expect(prepared.payload.inventory.id).toBe('motif-sequence-inventory');
    expect(prepared.payload.records).toEqual([]);
    expect(prepared.payload.alignments).toHaveLength(1);
  });

  it('rejects malformed explicit preload data without substituting built-in records', () => {
    embed('{"records": [}');
    expect(() => loadInitialArtifactWorkspace()).toThrowError(expect.objectContaining({
      code: 'MOTIF_INVALID_PRELOAD',
      details: expect.objectContaining({ operation: 'initialHydration', origin: 'script', mutated: false }),
    }));

    const invalidState = {
      records: [{ id: 'record-a', type: 'dna', sequence: 'ATGGAATTCTAA' }],
      artifactState: { customEnzymes: { malformed: true } },
    };
    embed(JSON.stringify(invalidState));
    expect(() => loadInitialArtifactWorkspace()).toThrowError(expect.objectContaining({
      code: 'MOTIF_INVALID_PRELOAD',
      message: expect.stringContaining('No bundled sample data was substituted'),
      details: expect.objectContaining({ operation: 'initialHydration', origin: 'script', mutated: false }),
    }));

    embed('');
    expect(() => loadInitialArtifactWorkspace()).toThrowError(expect.objectContaining({
      code: 'MOTIF_INVALID_PRELOAD',
      message: expect.stringContaining('embedded payload is blank'),
    }));
  });

  it('keeps an explicit null or empty object distinct from no payload', () => {
    for (const value of ['null', '{}']) {
      embed(value);
      expect(readInitialArtifactSourceFromDom()).toMatchObject({ kind: 'payload', origin: 'script' });
      expect(() => loadInitialArtifactWorkspace()).toThrowError(expect.objectContaining({
        code: 'MOTIF_INVALID_PRELOAD',
      }));
    }
  });

  it('does not let a bare sequence overwrite malformed or ambiguous record containers', () => {
    for (const value of [
      { sequence: 'ATGC', records: { malformed: true } },
      { sequence: 'ATGC', record: null },
      { records: [{ id: 'a', sequence: 'ATGC' }], entries: [{ id: 'b', sequence: 'ATGC' }] },
      { records: 'broken', alignments: [] },
      {
        records: [{ id: 'a', sequence: 'ATGC' }],
        alignments: [{
          id: 'orphaned', molecule: 'dna', rows: [
            { id: 'a', name: 'A', aligned: 'ATGC', sourceRecordId: 'missing' },
            { id: 'b', name: 'B', aligned: 'AT-C' },
          ],
        }],
      },
    ]) {
      expect(() => prepareInitialArtifactWorkspace(value)).toThrowError(expect.objectContaining({
        code: 'MOTIF_INVALID_PRELOAD',
        details: expect.objectContaining({ operation: 'initialHydration', mutated: false }),
      }));
    }

    expect(prepareInitialArtifactWorkspace({ name: 'Workspace label', notes: [] }).payload.records).toEqual([]);
  });
});
