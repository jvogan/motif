import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { afterEach, describe, expect, it } from 'vitest';

import { resolveFeatureColor } from '../../bio/feature-palette.js';
import { renderMotifArtifact } from '../../../mcp/motif/artifact-export.js';
import { MOTIF_WORKBENCH_RESOURCE_URI } from '../../../mcp/motif/contracts.js';
import {
  MOTIF_MCP_LIMITS,
  prepareMotifWorkbench,
  validateMotifPayload,
} from '../../../mcp/motif/payload.js';
import {
  createMotifClaudeScienceServer,
  type MotifMcpTraceEvent,
} from '../../../mcp/motif/server.js';
import { isMotifWorkbenchResult } from '../motif-workbench-bridge.js';

const runtimeBuildId = 'a'.repeat(64);
const artifactTemplate = `<!doctype html><html><head><meta name="motif-build-id" content="${runtimeBuildId}"><title>Motif</title></head><body><script type="application/json" id="motif-artifact-data">__SEQUENCE_INVENTORY__</script></body></html>`;

const openedClients: Client[] = [];
const openedServers: ReturnType<typeof createMotifClaudeScienceServer>[] = [];

function countJsonNodes(value: unknown): number {
  const pending: unknown[] = [value];
  let nodes = 0;
  while (pending.length > 0) {
    const current = pending.pop();
    nodes += 1;
    if (Array.isArray(current)) {
      for (const entry of current) pending.push(entry);
    } else if (current !== null && typeof current === 'object') {
      for (const entry of Object.values(current)) pending.push(entry);
    }
  }
  return nodes;
}

afterEach(async () => {
  await Promise.allSettled(openedClients.splice(0).map(client => client.close()));
  await Promise.allSettled(openedServers.splice(0).map(server => server.close()));
});

describe('Motif MCP payload boundary', () => {
  it('opens the sample inventory without replacing it', () => {
    const result = prepareMotifWorkbench({});
    expect(result).toEqual({
      schema: 'motif.mcp.workbench.v1',
      mode: 'sample',
      recordCount: 0,
      residueCount: 0,
    });
    expect(result.payload).toBeUndefined();
  });

  it('parses bounded FASTA and honors protein filename hints', () => {
    const result = prepareMotifWorkbench({
      content: '>alpha reporter\nMSTNPKPQR\n>beta reporter\nMSTNPKAQR',
      filename: 'reporters.faa',
    });
    expect(result).toMatchObject({
      mode: 'artifact',
      sourceName: 'reporters.faa',
      recordCount: 2,
      residueCount: 18,
      payload: {
        schema: 'motif.claude-science.inventory.v2',
        records: [
          { id: 'alpha-reporter', name: 'alpha reporter', molecule: 'protein' },
          { id: 'beta-reporter', name: 'beta reporter', molecule: 'protein', topology: 'linear' },
        ],
      },
    });
    const alphabeticallyAmbiguousProtein = prepareMotifWorkbench({
      content: '>all-acgt peptide\nACGTACGT',
      filename: 'ambiguous.faa',
    });
    expect(alphabeticallyAmbiguousProtein.payload?.records).toEqual([
      expect.objectContaining({ molecule: 'protein', topology: 'linear' }),
    ]);
  });

  it('rejects invalid FASTA characters instead of silently shortening the record', () => {
    expect(() => prepareMotifWorkbench({
      content: '>invalid\nACGT?ACGT',
      filename: 'invalid.fasta',
    })).toThrow(/invalid character "\?" at line 2, column 5/i);
  });

  it('treats FASTA as linear unless circular topology is explicit', () => {
    const defaultResult = prepareMotifWorkbench({ content: '>dna\nATGCGT', filename: 'dna.fna' });
    expect(defaultResult.payload?.records).toEqual([
      expect.objectContaining({ molecule: 'dna', topology: 'linear' }),
    ]);
    const circularResult = prepareMotifWorkbench({
      content: '>plasmid\nATGCGT',
      filename: 'plasmid.fasta',
      topology: 'circular',
    });
    expect(circularResult.payload?.records).toEqual([
      expect.objectContaining({ molecule: 'dna', topology: 'circular' }),
    ]);
  });

  it('parses complete GenBank records and preserves annotations', () => {
    const genBank = [
      'LOCUS       demo                      12 bp    DNA     linear   SYN 01-JAN-2026',
      'DEFINITION  bounded demo.',
      'ACCESSION   DEMO1',
      'FEATURES             Location/Qualifiers',
      '     CDS             1..12',
      '                     /label="demo CDS"',
      'ORIGIN',
      '        1 atggccgcttaa',
      '//',
    ].join('\n');
    const result = prepareMotifWorkbench({ content: genBank, filename: 'demo.gb' });
    expect(result).toMatchObject({
      mode: 'artifact',
      recordCount: 1,
      residueCount: 12,
      payload: {
        records: [{
          id: 'demo1',
          name: 'demo',
          sequence: 'ATGGCCGCTTAA',
          features: [{ name: 'demo CDS', start: 0, end: 12 }],
        }],
      },
    });
  });

  it('applies the shared palette and carries an explicit proposal opt-out', () => {
    const result = prepareMotifWorkbench({
      payload: {
        records: [{
          id: 'palette',
          name: 'Palette',
          molecule: 'dna',
          sequence: 'ATGAAATAA',
          features: [
            { name: 'coding region', type: 'cds', start: 0, end: 9 },
            { name: 'operator', type: 'regulatory', start: 3, end: 6, color: '#123456' },
          ],
        }],
      },
      proposeAnnotations: false,
    });
    expect(result.payload?.records).toEqual([
      expect.objectContaining({
        proposeAnnotations: false,
        features: [
          expect.objectContaining({ color: 'var(--accent, #7E9BBF)' }),
          expect.objectContaining({ color: '#123456' }),
        ],
      }),
    ]);
  });

  it('bounds record collections before applying a proposal preference', () => {
    const records = Array.from(
      { length: MOTIF_MCP_LIMITS.maxRecords + 1 },
      (_, index) => ({ id: `tiny-${index}`, sequence: 'A' }),
    );
    // A proposal preference used to call Array#map before validation. This
    // non-enumerable tripwire is invisible to JSON sizing, but proves an
    // oversized collection is rejected before any preference-wide mapping.
    Object.defineProperty(records, 'map', {
      configurable: true,
      get: () => {
        throw new Error('proposal preference mapped an oversized collection');
      },
    });
    const payload = { records };

    expect(Buffer.byteLength(JSON.stringify(payload), 'utf8')).toBeLessThan(MOTIF_MCP_LIMITS.maxPayloadBytes);
    expect(() => prepareMotifWorkbench({ payload, proposeAnnotations: true }))
      .toThrow(/cannot contain more than 100 records/i);

    const bounded = prepareMotifWorkbench({
      payload: { records: [{ id: 'bounded', sequence: 'A' }] },
      proposeAnnotations: true,
    });
    expect(bounded.payload?.records).toEqual([
      expect.objectContaining({ id: 'bounded', proposeAnnotations: true }),
    ]);
  });

  it('keeps the serialized payload bound after adding palette defaults', () => {
    const feature = { type: 'cds', start: 0, end: 1 };
    const features = Array.from(
      { length: MOTIF_MCP_LIMITS.maxFeaturesPerRecord },
      () => ({ ...feature }),
    );
    const payload = {
      records: [{ id: 'palette-boundary', sequence: 'A', features }],
      padding: '',
    };
    const beforePaddingBytes = Buffer.byteLength(JSON.stringify(payload), 'utf8');
    payload.padding = 'x'.repeat(MOTIF_MCP_LIMITS.maxPayloadBytes - beforePaddingBytes - 1);

    const inputBytes = Buffer.byteLength(JSON.stringify(payload), 'utf8');
    const paletteBytesPerFeature = Buffer.byteLength(
      JSON.stringify({ ...feature, color: resolveFeatureColor(feature) }),
      'utf8',
    ) - Buffer.byteLength(JSON.stringify(feature), 'utf8');
    expect(inputBytes).toBe(MOTIF_MCP_LIMITS.maxPayloadBytes - 1);
    expect(inputBytes + paletteBytesPerFeature * features.length).toBeGreaterThan(MOTIF_MCP_LIMITS.maxPayloadBytes);

    expect(() => validateMotifPayload(payload)).toThrow(/Payload cannot exceed 32 MiB\./);
  });

  it('keeps the JSON-node budget transactional after adding palette defaults', () => {
    const featureCount = MOTIF_MCP_LIMITS.maxFeaturesPerRecord;
    const makePayloadAtInputNodes = (targetNodes: number) => {
      const features = Array.from(
        { length: featureCount },
        () => ({ type: 'cds', start: 0, end: 1 }),
      );
      const payload = {
        records: [{ id: 'palette-node-boundary', sequence: 'A', features }],
        padding: [] as null[],
      };
      const paddingNodes = targetNodes - countJsonNodes(payload);
      expect(paddingNodes).toBeGreaterThanOrEqual(0);
      payload.padding = Array.from({ length: paddingNodes }, () => null);
      expect(countJsonNodes(payload)).toBe(targetNodes);
      return { features, payload };
    };

    const valid = makePayloadAtInputNodes(MOTIF_MCP_LIMITS.maxJsonNodes - featureCount);
    const prepared = validateMotifPayload(valid.payload).payload;
    expect(countJsonNodes(prepared)).toBe(MOTIF_MCP_LIMITS.maxJsonNodes);
    const preparedFeatures = (prepared.records as Array<{ features?: unknown[] }> | undefined)?.[0]?.features;
    expect(preparedFeatures?.[0]).toMatchObject({ color: resolveFeatureColor(valid.features[0]) });

    const oversized = makePayloadAtInputNodes(MOTIF_MCP_LIMITS.maxJsonNodes);
    expect(() => validateMotifPayload(oversized.payload))
      .toThrow(/cannot contain more than 250,000 JSON nodes/i);
    expect(oversized.features.every(feature => !Object.hasOwn(feature, 'color'))).toBe(true);
    expect(countJsonNodes(oversized.payload)).toBe(MOTIF_MCP_LIMITS.maxJsonNodes);
  });

  it('revalidates a direct payload after applying its title override', () => {
    const payload = {
      inventory: { title: 'Original' },
      records: [{ id: 'title-override', sequence: 'A' }],
    };
    const prepared = prepareMotifWorkbench({ payload, title: 'Delivered title' });
    expect(prepared.payload?.inventory).toMatchObject({ title: 'Delivered title' });
    expect(payload.inventory.title).toBe('Original');

    const title = 't'.repeat(MOTIF_MCP_LIMITS.maxShortTextLength);
    const boundary = {
      inventory: { title: 'Original' },
      records: [{ id: 'title-boundary', sequence: 'A' }],
      padding: '',
    };
    const withEmptyPadding = {
      ...boundary,
      inventory: { ...boundary.inventory, title },
    };
    boundary.padding = 'x'.repeat(
      MOTIF_MCP_LIMITS.maxPayloadBytes
        - Buffer.byteLength(JSON.stringify(withEmptyPadding), 'utf8')
        + 1,
    );
    expect(Buffer.byteLength(JSON.stringify(boundary), 'utf8'))
      .toBeLessThan(MOTIF_MCP_LIMITS.maxPayloadBytes);
    expect(Buffer.byteLength(JSON.stringify({
      ...boundary,
      inventory: { ...boundary.inventory, title },
    }), 'utf8')).toBe(MOTIF_MCP_LIMITS.maxPayloadBytes + 1);

    expect(() => prepareMotifWorkbench({ payload: boundary, title }))
      .toThrow(/Payload cannot exceed 32 MiB\./);
    expect(boundary.inventory.title).toBe('Original');
  });

  it('keeps valid unprojectable GenBank locations with feature and record diagnostics', () => {
    const genBank = [
      'LOCUS       diagnostic                 12 bp    DNA     linear   SYN 01-JAN-2026',
      'ACCESSION   DIAG1',
      'FEATURES             Location/Qualifiers',
      '     misc_feature    100^101',
      '                     /label="between"',
      '     misc_feature    J00194.1:100..200',
      '                     /label="remote"',
      'ORIGIN',
      '        1 atggccgcttaa',
      '//',
    ].join('\n');
    const result = prepareMotifWorkbench({ content: genBank, filename: 'diagnostic.gb' });
    const records =
      (result.payload as { records?: Array<Record<string, unknown>> } | undefined)?.records ?? [];
    expect(records).toHaveLength(1);
    expect(records[0].features).toEqual([
      expect.objectContaining({
        metadata: expect.objectContaining({ motifLocationQuarantined: true }),
      }),
      expect.objectContaining({
        metadata: expect.objectContaining({ motifLocationQuarantined: true }),
      }),
    ]);
    expect(records[0].provenance).toEqual({
      genbankImportDiagnostics: [
        expect.objectContaining({ code: 'between_base_location' }),
        expect.objectContaining({ code: 'remote_location' }),
      ],
    });
  });

  it('quarantines ambiguous valid GenBank locations instead of aborting the record', () => {
    const genBank = [
      'LOCUS       ambiguous                 12 bp    DNA     linear   SYN 01-JAN-2026',
      'ACCESSION   AMBIG1',
      'FEATURES             Location/Qualifiers',
      '     misc_feature    one-of(6,9)..12',
      '                     /label="ambiguous"',
      'ORIGIN',
      '        1 atggccgcttaa',
      '//',
    ].join('\n');
    const result = prepareMotifWorkbench({ content: genBank, filename: 'ambiguous.gb' });
    expect(result.payload?.records).toEqual([
      expect.objectContaining({
        features: [expect.objectContaining({
          metadata: expect.objectContaining({
            motifLocationQuarantined: true,
            motifLocationAmbiguous: true,
          }),
        })],
        provenance: {
          genbankImportDiagnostics: [expect.objectContaining({ code: 'ambiguous_location' })],
        },
      }),
    ]);
  });

  it('honors the GenPept aa unit even when a protein uses only nucleotide letters', () => {
    const genPept = [
      'LOCUS       all_acgt_peptide           8 aa            linear   SYN 01-JAN-2026',
      'DEFINITION  Alphabetically ambiguous peptide.',
      'ACCESSION   PTEST1',
      'ORIGIN',
      '        1 acgtacgt',
      '//',
    ].join('\n');
    const result = prepareMotifWorkbench({ content: genPept, filename: 'peptide.gp' });
    expect(result.payload?.records).toEqual([
      expect.objectContaining({ molecule: 'protein', sequence: 'ACGTACGT', topology: 'linear' }),
    ]);
  });

  it('preserves workspace sidecars when coercing a bare sequence record', () => {
    const createdAt = '2026-07-12T12:00:00.000Z';
    const validated = validateMotifPayload({
      id: 'bare-record',
      sequence: 'ATGC',
      notes: [{
        id: 'bare-note',
        body: 'Keep this note.',
        format: 'plain',
        scope: 'record',
        recordId: 'bare-record',
        createdAt,
        updatedAt: createdAt,
      }],
    });
    expect(validated.payload.records).toEqual([
      expect.objectContaining({ id: 'bare-record', sequence: 'ATGC' }),
    ]);
    expect(validated.payload.notes).toEqual([
      expect.objectContaining({ id: 'bare-note', recordId: 'bare-record' }),
    ]);

    const explicitRecordsWin = validateMotifPayload({
      sequence: 'TTTT',
      records: [{ id: 'explicit-record', sequence: 'ATGC' }],
      notes: [{
        id: 'explicit-note',
        body: 'Keep the explicit record container.',
        format: 'plain',
        scope: 'record',
        recordId: 'explicit-record',
        createdAt,
        updatedAt: createdAt,
      }],
    });
    expect(explicitRecordsWin.payload.records).toEqual([
      expect.objectContaining({ id: 'explicit-record', sequence: 'ATGC' }),
    ]);

    const sidecarOnly = validateMotifPayload({ name: 'Workspace label', notes: [] });
    expect(sidecarOnly.recordCount).toBe(0);
    expect(sidecarOnly.payload).toMatchObject({ name: 'Workspace label', notes: [] });

    const sangerTrace = {
      schema: 'motif.sanger-trace.v1',
      version: 1,
      baseCalls: 'A',
      sequence: 'A',
      qualityScores: [],
      peakPositions: [],
      channels: { A: [1], C: [0], G: [0], T: [0] },
      sampleCount: 1,
      dyeOrder: null,
      storedReverseComplement: null,
      warnings: [],
      metadata: {
        format: 'ABIF',
        abifVersion: 101,
        baseCallsTag: 'PBAS2',
        qualityScoresTag: null,
        peakPositionsTag: null,
        channelTags: {},
      },
    };
    const bareTrace = validateMotifPayload({ id: 'bare-trace', type: 'dna', sequence: 'A', sangerTrace });
    expect(bareTrace.payload.sangerTrace).toBeUndefined();
    expect(bareTrace.payload.records).toEqual([
      expect.objectContaining({ id: 'bare-trace', sangerTrace: expect.objectContaining({ baseCalls: 'A' }) }),
    ]);
  });

  it('rejects ambiguous inputs and out-of-range biological data transactionally', () => {
    expect(() => prepareMotifWorkbench({ payload: { records: [] }, content: '>x\nATGC' }))
      .toThrow(/either payload or content/i);
    expect(() => validateMotifPayload({
      records: [{
        name: 'bad feature',
        molecule: 'dna',
        sequence: 'ATGC',
        features: [{ name: 'outside', start: 1, end: 5 }],
      }],
    })).toThrow(/coordinates must satisfy/i);
    expect(() => validateMotifPayload({
      records: Array.from({ length: MOTIF_MCP_LIMITS.maxRecords + 1 }, (_, index) => ({
        name: `record-${index}`,
        sequence: 'ATGC',
      })),
    })).toThrow(/more than 100 records/i);
    expect(() => validateMotifPayload({
      records: [{ name: 'bad active flag', sequence: 'ATGC', active: 'yes' }],
    })).toThrow(/active must be a boolean/i);
    expect(() => validateMotifPayload({
      records: [{ id: 'record-a', name: 'bad note', sequence: 'ATGC' }],
      notes: { malformed: true },
    })).toThrow(/payload workspace is invalid.*notes must be an array/i);
    expect(() => validateMotifPayload({
      records: [{ id: 'record-a', name: 'bad state', sequence: 'ATGC' }],
      artifactState: { customEnzymes: { malformed: true } },
    })).toThrow(/payload workspace is invalid.*customEnzymes must be an array/i);
    expect(() => validateMotifPayload({
      records: [{ id: 'record-a', name: 'bad color', sequence: 'ATGC', features: [{ start: 0, end: 2, color: 'url(javascript:alert(1))' }] }],
    })).toThrow(/simple CSS color value/i);
    expect(() => validateMotifPayload({
      records: [
        { name: 'record-a', sequence: 'ATGC', active: false },
        { id: 'record-a', sequence: 'ATGC', active: true },
      ],
      notes: [{
        id: 'note-a', body: 'Ambiguous link', format: 'plain', scope: 'record', recordId: 'record-a',
        createdAt: '2026-07-12T12:00:00.000Z', updatedAt: '2026-07-12T12:00:00.000Z',
      }],
    })).toThrow(/payload workspace is invalid/i);
    expect(() => validateMotifPayload({
      records: [{ id: 'record-a', sequence: 'ATGC' }],
      alignments: [{
        id: 'orphaned', molecule: 'dna', rows: [
          { id: 'a', name: 'A', aligned: 'ATGC', sourceRecordId: 'missing' },
          { id: 'b', name: 'B', aligned: 'AT-C' },
        ],
      }],
    })).toThrow(/alignment rows reference unknown record id: missing/i);
  });

  it('rejects invalid sequence characters with their original offset before coordinates', () => {
    expect(() => validateMotifPayload({
      records: [{ molecule: 'dna', sequence: 'AT-GC', features: [{ start: 0, end: 99 }] }],
    })).toThrow(/invalid character "-" at offset 2/i);
    expect(() => validateMotifPayload({
      records: [{ molecule: 'dna', sequence: 'ATGC', features: [{ start: 0.5, end: 2 }] }],
    })).toThrow(/integer start and end coordinates/i);
    expect(() => validateMotifPayload({
      records: [{ molecule: 'dna', sequence: 'ATGC', features: [{ start: 0, end: 2, subRanges: [{ start: 1, end: 2.5 }] }] }],
    })).toThrow(/integer start and end coordinates/i);
    expect(() => validateMotifPayload({
      records: [{ molecule: 'dna', sequence: 'ATGC', sites: [{ enzyme: 'EcoRI', hits: [{ position: 1.5 }] }] }],
    })).toThrow(/position must be a non-negative safe integer/i);
    expect(() => validateMotifPayload({
      records: [{ molecule: 'dna', sequence: 'ATGC', sites: [{ enzyme: 'EcoRI', hits: [{ position: 1, cutPosition: 2.5 }] }] }],
    })).toThrow(/cutPosition must be a non-negative safe integer/i);
  });

  it('matches browser record validation for nested metadata and DNA end chemistry', () => {
    const base = { id: 'record-a', molecule: 'dna' as const, sequence: 'ATGC' };
    expect(() => validateMotifPayload({ records: [{ ...base, overhang5: 'AATT', overhang5Type: '5prime', overhang3: '', overhang3Type: 'blunt' }] }))
      .not.toThrow();
    expect(() => validateMotifPayload({ records: [{ ...base, translationTableId: 2 }] }))
      .not.toThrow();
    expect(() => validateMotifPayload({
      records: [{ id: 'rna-record', molecule: 'rna', sequence: 'AUGUAG', translationTableId: 32 }],
    })).not.toThrow();
    expect(() => validateMotifPayload({ records: [{ ...base, translationTableId: '2' }] }))
      .toThrow(/translationTableId must be a supported NCBI genetic-code id/i);
    expect(() => validateMotifPayload({ records: [{ ...base, translationTableId: 27 }] }))
      .toThrow(/translationTableId must be a supported NCBI genetic-code id/i);
    expect(() => validateMotifPayload({
      records: [{ ...base, molecule: 'protein', sequence: 'MPEPTIDE', translationTableId: 2 }],
    })).toThrow(/translationTableId is only valid on DNA and RNA records/i);

    for (const record of [
      { ...base, dateAdded: 42 },
      { ...base, provenance: [] },
      { ...base, provenance: { blob: 'x'.repeat(MOTIF_MCP_LIMITS.maxTextLength + 1) } },
      { ...base, sites: { enzyme: 'EcoRI' } },
      { ...base, sangerTrace: {} },
      { ...base, features: [{ start: 0, end: 2, metadata: [] }] },
      { ...base, features: [{ start: 0, end: 2, metadata: { blob: 'x'.repeat(MOTIF_MCP_LIMITS.maxTextLength + 1) } }] },
      { ...base, features: [{ start: 0, end: 2, subRanges: [{ start: 0, end: 1, strand: 2 }] }] },
      { ...base, overhang5: 'AATT', overhang5Type: 'blunt' },
      { ...base, overhang5Type: '5prime' },
      { ...base, overhang3: 'AX' },
      { ...base, molecule: 'protein', sequence: 'MPEPTIDE', overhang5: 'AATT', overhang5Type: '5prime' },
      { ...base, type: 'plasmid' },
    ]) {
      expect(() => validateMotifPayload({ records: [record] })).toThrow();
    }

    expect(() => validateMotifPayload({
      sequence: 'ATGC',
      records: { malformed: true },
    })).toThrow(/records must be an array/i);
    expect(() => validateMotifPayload({
      records: [{ ...base, sequence: 'ATGC' }],
      artifactState: {
        translationLayersByRecord: {
          'record-a': [{ id: 'too-long', label: 'Too long', start: 0, end: 5, strand: 1, frame: 0 }],
        },
      },
    })).toThrow(/payload workspace is invalid/i);
    expect(() => validateMotifPayload({
      records: [{ id: 'dual-sequence', molecule: 'dna', seq: 'AT', sequence: 'ATGCGC' }],
      artifactState: {
        translationLayersByRecord: {
          'dual-sequence': [{ id: 'too-long', label: 'Too long', start: 0, end: 6, strand: 1, frame: 0 }],
        },
      },
    })).toThrow(/payload workspace is invalid/i);
    expect(validateMotifPayload({
      records: [{ id: 'dual-sequence', molecule: 'dna', seq: 'AT', sequence: 'ATGCGC' }],
    }).residueCount).toBe(2);
  });

  it('rejects unsupported future schemas instead of silently downgrading', () => {
    expect(() => validateMotifPayload({
      schema: 'motif.claude-science.inventory.v99',
      records: [{ name: 'future', sequence: 'ATGC' }],
    })).toThrow(/unsupported motif inventory schema/i);
  });
});

describe('Motif embedded artifact export', () => {
  it('rejects escaped payload expansion before constructing oversized HTML', () => {
    const workbench = prepareMotifWorkbench({
      payload: {
        schema: 'motif.claude-science.inventory.v2',
        records: [{ id: 'demo', name: 'Demo', sequence: 'ATGCGT', molecule: 'dna' }],
        hostileText: '<'.repeat(7_000_000),
      },
    });
    expect(() => renderMotifArtifact({
      template: artifactTemplate,
      workbench,
      runtimeBuildId,
      filename: 'expanded.html',
    })).toThrow(/exceeds .* after safe payload escaping/i);
  });

  it('injects escaped JSON, creates a safe filename, and hashes exact HTML', () => {
    const workbench = prepareMotifWorkbench({
      payload: {
        schema: 'motif.claude-science.inventory.v2',
        inventory: { title: '</script><script>unsafe()</script>' },
        records: [{ id: 'demo', name: 'Demo', sequence: 'ATGCGT', molecule: 'dna' }],
      },
    });
    const artifact = renderMotifArtifact({
      template: artifactTemplate,
      workbench,
      runtimeBuildId,
      filename: '../Demo report.html',
    });
    expect(artifact.summary).toMatchObject({
      schema: 'motif.mcp.artifact-export.v1',
      delivery: 'embedded-html-resource',
      visibleMountConfirmed: false,
      runtimeBuildId,
      filename: 'Demo-report.html',
      recordCount: 1,
      residueCount: 6,
    });
    expect(artifact.summary.htmlSha256).toMatch(/^[a-f0-9]{64}$/u);
    expect(artifact.html).toContain('\\u003C/script\\u003E');
    expect(artifact.html).not.toContain('</script><script>unsafe()');
  });
});

describe('Motif MCP server', () => {
  it('exposes a fully branded app resource, viewer binding, and embedded fallback', async () => {
    const traceEvents: MotifMcpTraceEvent[] = [];
    const server = createMotifClaudeScienceServer({
      version: '0.2.1-test',
      runtimeBuildId,
      readWorkbenchHtml: async () => '<!doctype html><title>Motif</title><div class="motif-cs-brand">Motif</div>',
      readArtifactTemplate: async () => artifactTemplate,
      trace: event => traceEvents.push(event),
    });
    openedServers.push(server);
    const client = new Client({ name: 'motif-connector-test', version: '1.0.0' });
    openedClients.push(client);
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);

    const listed = await client.listTools();
    expect(listed.tools.map(tool => tool.name)).toEqual([
      'motif_open_workbench',
      'motif_create_workbench_artifact',
    ]);
    expect(client.getServerVersion()?.name).toBe('motif-claude-science');
    const openTool = listed.tools[0];
    expect(openTool?._meta?.['ui']).toMatchObject({
      resourceUri: MOTIF_WORKBENCH_RESOURCE_URI,
      visibility: ['model', 'app'],
    });
    expect(openTool?._meta?.['ui/resourceUri']).toBe(MOTIF_WORKBENCH_RESOURCE_URI);
    expect(openTool?._meta?.['operon.dev/viewer']).toMatchObject({
      contentParam: 'content',
      nameParam: 'filename',
      opensExtensions: expect.arrayContaining(['.gb', '.gbk', '.fasta', '.fa', '.faa']),
    });
    expect(openTool?.annotations).toMatchObject({
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    });

    const sensitiveFilename = 'private-sentinel.fasta';
    const sensitiveSequence = 'ATGCGTACGTTAGC';
    const openResult = await client.callTool({
      name: 'motif_open_workbench',
      arguments: { content: `>private-sentinel\n${sensitiveSequence}`, filename: sensitiveFilename },
    });
    expect(openResult.isError).not.toBe(true);
    expect(openResult.structuredContent).toMatchObject({
      schema: 'motif.mcp.workbench.v1',
      delivery: 'live-app-request',
      visibleMountConfirmed: false,
      fallbackTool: 'motif_create_workbench_artifact',
      runtimeBuildId,
      mode: 'artifact',
      sourceName: sensitiveFilename,
      recordCount: 1,
      residueCount: sensitiveSequence.length,
    });
    expect(openResult.content).toContainEqual(expect.objectContaining({
      type: 'resource_link',
      uri: MOTIF_WORKBENCH_RESOURCE_URI,
      mimeType: 'text/html;profile=mcp-app',
      name: 'Motif Workbench',
    }));
    expect(openResult.content).toContainEqual(expect.objectContaining({
      type: 'text',
      text: expect.stringContaining('Records: private-sentinel [private-sentinel].'),
    }));
    expect(isMotifWorkbenchResult(openResult.structuredContent)).toBe(true);

    const resource = await client.readResource({ uri: MOTIF_WORKBENCH_RESOURCE_URI });
    expect(resource.contents[0]).toMatchObject({
      uri: MOTIF_WORKBENCH_RESOURCE_URI,
      mimeType: 'text/html;profile=mcp-app',
      _meta: {
        prefersBorder: false,
        csp: expect.objectContaining({ connectDomains: [], resourceDomains: [] }),
      },
    });
    const resourceContent = resource.contents[0];
    expect(resourceContent && 'text' in resourceContent ? resourceContent.text : '').toContain('<title>Motif</title>');

    const artifactResult = await client.callTool({
      name: 'motif_create_workbench_artifact',
      arguments: {
        content: `>private-sentinel\n${sensitiveSequence}`,
        filename: sensitiveFilename,
        outputFilename: 'motif-review.html',
      },
    });
    expect(artifactResult.isError, JSON.stringify(artifactResult)).not.toBe(true);
    expect(artifactResult.structuredContent).toMatchObject({
      schema: 'motif.mcp.artifact-export.v1',
      delivery: 'embedded-html-resource',
      visibleMountConfirmed: false,
      runtimeBuildId,
      filename: 'motif-review.html',
      recordCount: 1,
      residueCount: sensitiveSequence.length,
    });
    expect(artifactResult.content).toContainEqual(expect.objectContaining({
      type: 'resource',
      resource: expect.objectContaining({
        uri: 'motif://artifact/motif-review.html',
        mimeType: 'text/html',
        text: expect.stringContaining('<title>Motif</title>'),
      }),
    }));
    expect(artifactResult.content).toContainEqual(expect.objectContaining({
      type: 'text',
      text: expect.stringContaining('Records: private-sentinel [private-sentinel].'),
    }));

    const serializedTrace = JSON.stringify(traceEvents);
    expect(serializedTrace).not.toContain(sensitiveFilename);
    expect(serializedTrace).not.toContain(sensitiveSequence);
    expect(traceEvents).toEqual(expect.arrayContaining([
      expect.objectContaining({ event: 'resource.registered', uri: MOTIF_WORKBENCH_RESOURCE_URI }),
      expect.objectContaining({ event: 'tool.finish', tool: 'motif_open_workbench', status: 'ok', recordCount: 1 }),
      expect.objectContaining({ event: 'resource.read.finish', status: 'ok' }),
    ]));
  });

  it('bounds record summaries without presenting shortened identifiers as exact', async () => {
    const server = createMotifClaudeScienceServer({
      version: '0.2.1-test',
      runtimeBuildId,
      readWorkbenchHtml: async () => '<title>Motif</title>',
      readArtifactTemplate: async () => artifactTemplate,
    });
    openedServers.push(server);
    const client = new Client({ name: 'motif-summary-test', version: '1.0.0' });
    openedClients.push(client);
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);

    const longId = `record-${'x'.repeat(140)}`;
    const result = await client.callTool({
      name: 'motif_open_workbench',
      arguments: {
        payload: {
          records: [
            { id: longId, name: 'Alpha\nRecord', sequence: 'ATGC' },
            { id: 'record-2', name: 'Beta', sequence: 'ATGC' },
            { id: 'record-3', name: 'Gamma', sequence: 'ATGC' },
            { id: 'record-4', name: 'Delta', sequence: 'ATGC' },
            { id: 'record-5', name: 'Epsilon', sequence: 'ATGC' },
            { id: 'record-6', name: 'HiddenSix', sequence: 'ATGC' },
          ],
        },
      },
    });
    const content = result.content as Array<{ type?: string; text?: string }>;
    const summary = content.find(item => item.type === 'text')?.text ?? '';
    expect(summary).toContain('Records: Alpha Record [record-');
    expect(summary).toContain('(truncated; inspect the structured result)');
    expect(summary).toContain('; +1 more.');
    expect(summary).not.toContain('HiddenSix');
    expect(summary).not.toContain('\nRecord');
    expect(isMotifWorkbenchResult(result.structuredContent)).toBe(true);
    if (!isMotifWorkbenchResult(result.structuredContent)) throw new Error('Expected a Motif workbench result');
    const structuredPayload = result.structuredContent.payload as {
      records?: Array<{ id?: string }>;
    };
    expect(structuredPayload.records?.[0]).toMatchObject({ id: longId });
  });

  it('returns bounded public errors without mounting malformed content', async () => {
    const server = createMotifClaudeScienceServer({
      version: '0.2.1-test',
      runtimeBuildId,
      readWorkbenchHtml: async () => '<title>Motif</title>',
      readArtifactTemplate: async () => artifactTemplate,
    });
    openedServers.push(server);
    const client = new Client({ name: 'motif-error-test', version: '1.0.0' });
    openedClients.push(client);
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
    const result = await client.callTool({
      name: 'motif_open_workbench',
      arguments: { content: '>bad\nATGC', payload: { records: [] } },
    });
    expect(result.isError).toBe(true);
    expect(result.content).toContainEqual(expect.objectContaining({
      type: 'text',
      text: expect.stringMatching(/either payload or content/i),
    }));
  });
});
