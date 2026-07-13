import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  MOTIF_MAX_FEATURES_PER_RECORD,
  MOTIF_MAX_HITS_PER_SITE,
  MOTIF_MAX_METADATA_JSON_DEPTH,
  MOTIF_MAX_METADATA_JSON_NODES,
  MOTIF_MAX_PAYLOAD_JSON_BYTES,
  MOTIF_MAX_RECORDS,
  MOTIF_MAX_RECORD_LENGTH,
  MOTIF_MAX_SHORT_TEXT_LENGTH,
  MOTIF_MAX_SITES_PER_RECORD,
  MOTIF_MAX_TAGS_PER_RECORD,
  MotifArtifactRuntimeError,
  createCenteredBluntEnzyme,
  createArtifactDatabaseSnapshot,
  createDefensiveRuntimeSnapshot,
  describePayloadSnapshot,
  inventoryReportHtml,
  normalizeSequence,
  omitUndefinedObjectProperties,
  parseImportedRecords,
  prepareArtifactDatabaseRestore,
  prepareInventoryReplacement,
  validateRuntimeRecordInputs,
} from '../motif-artifact';

const here = dirname(fileURLToPath(import.meta.url));
const artifactSource = readFileSync(resolve(here, '..', 'motif-artifact.tsx'), 'utf8');

describe('Claude Science runtime data-integrity behavior', () => {
  it('permits only an explicit empty replacement to clear and rejects invalid non-empty batches', () => {
    expect(prepareInventoryReplacement([]).records).toEqual([]);
    expect(prepareInventoryReplacement({ records: [] }).records).toEqual([]);

    const replaceWithInvalid = () => prepareInventoryReplacement([
      { id: 'valid', type: 'dna', sequence: 'GAATTC' },
      { id: 'invalid', sequence: 'hello world' },
    ]);

    expect(replaceWithInvalid).toThrowError(MotifArtifactRuntimeError);
    try {
      replaceWithInvalid();
    } catch (error) {
      expect(error).toMatchObject({
        code: 'MOTIF_INVALID_INVENTORY_REPLACEMENT',
        details: { operation: 'motifRenderInventory', inputCount: 2, mutated: false },
      });
    }
  });

  it('rejects malformed nested record fields transactionally with structured paths', () => {
    const malformed = [
      { tags: 42 },
      { features: { start: 0, end: 2 } },
      { features: [null] },
      { features: [{ start: 0, end: 3, subRanges: { start: 0, end: 2 } }] },
      { sites: { enzyme: 'EcoRI' } },
      { sites: [{ enzyme: 'EcoRI', hits: [null] }] },
    ];

    malformed.forEach((patch) => {
      const replace = () => prepareInventoryReplacement([{
        id: 'last-good-must-survive',
        type: 'dna',
        sequence: 'GAATTCAAAAAA',
        ...patch,
      } as never]);
      expect(replace).toThrowError(MotifArtifactRuntimeError);
      try {
        replace();
      } catch (error) {
        expect(error).toMatchObject({
          code: 'MOTIF_INVALID_INVENTORY_REPLACEMENT',
          details: {
            operation: 'motifRenderInventory',
            mutated: false,
            issues: expect.arrayContaining([expect.objectContaining({
              code: 'malformed_field',
              path: expect.stringMatching(/^records\[0\]\./),
            })]),
          },
        });
      }
    });
  });

  it('assigns collision-free record and feature ids even when a generated suffix is already taken', () => {
    const payload = prepareInventoryReplacement([
      {
        id: 'x-3',
        sequence: 'GAATTCAAAAAA',
        features: [
          { id: 'feature-x-3', start: 0, end: 2 },
          { id: 'feature-x', start: 2, end: 4 },
          { id: 'feature-x', start: 4, end: 6 },
        ],
      },
      { id: 'x', sequence: 'GAATTCAAAAAA' },
      { id: 'x', sequence: 'GAATTCAAAAAA' },
    ]);

    expect(payload.records.map((record) => record.id)).toEqual(['x-3', 'x', 'x-2']);
    expect(payload.records[0].features.map((feature) => feature.id)).toEqual(['feature-x-3', 'feature-x', 'feature-x-2']);
    expect(new Set(payload.records.map((record) => record.id))).toHaveLength(3);
    expect(new Set(payload.records[0].features.map((feature) => feature.id))).toHaveLength(3);
  });

  it('prepares complete Database JSON restores transactionally', () => {
    const restored = prepareArtifactDatabaseRestore({
      schema: 'motif.claude-science.inventory.v1',
      records: [{ id: 'restored', name: 'Restored', type: 'dna', sequence: 'ATGGAATTCTAA' }],
      selectedRecordId: 'restored',
      notes: [{
        id: 'note-a',
        body: 'Review the EcoRI site.',
        format: 'plain',
        scope: 'range',
        recordId: 'restored',
        range: { start: 3, end: 9 },
        createdAt: '2026-07-12T12:00:00.000Z',
        updatedAt: '2026-07-12T12:00:00.000Z',
      }],
      workflowResults: [{
        id: 'digest-a',
        kind: 'digest',
        name: 'EcoRI digest',
        inputRecordIds: ['restored'],
        parameters: { enzymes: ['EcoRI'] },
        outputRecordIds: ['restored'],
        createdAt: '2026-07-12T12:05:00.000Z',
        provenance: { source: 'motif-artifact', operation: 'digest' },
      }],
      analysisResults: [{
        id: 'report-a',
        kind: 'report',
        name: 'Restriction review',
        status: 'complete',
        summary: 'EcoRI review saved as inert text.',
        inputRecordIds: ['restored'],
        inputSha256s: ['a'.repeat(64)],
        dependsOnResultIds: [],
        assetIds: [],
        parameters: {},
        data: { format: 'plain', body: 'Review the EcoRI site.' },
        createdAt: '2026-07-12T12:06:00.000Z',
        provenance: { source: 'claude-science', operation: 'report' },
      }],
      artifactState: {
        customEnzymes: [{
          name: 'RestoreI', recognitionSequence: 'GAATTC', cutOffset: 1, complementCutOffset: 5, overhang: '5prime',
        }],
        translationLayersByRecord: {
          restored: [{ id: 'layer', label: 'Layer', start: 0, end: 6, strand: 1, frame: 0 }],
        },
        enzymeSourcesByRecord: { restored: ['common'] },
        hiddenFeatureTranslationsByRecord: { restored: ['feat:one'] },
        restrictionLabelsByRecord: { restored: true },
        motifsByRecord: { restored: 'GAATTC' },
      },
    });

    expect(restored.payload.selectedRecordId).toBe('restored');
    expect(restored.payload.schema).toBe('motif.claude-science.inventory.v2');
    expect(restored.payload.notes[0]).toMatchObject({ id: 'note-a', scope: 'range', recordId: 'restored' });
    expect(restored.payload.workflowResults[0]).toMatchObject({ id: 'digest-a', kind: 'digest' });
    expect(restored.payload.analysisResults[0]).toMatchObject({ id: 'report-a', kind: 'report' });
    expect(restored.artifactState.customEnzymes[0]?.name).toBe('RestoreI');
    expect(restored.artifactState.translationLayersByRecord.restored[0]).toMatchObject({
      id: 'layer', start: 0, end: 6, source: 'layer',
    });

    expect(() => prepareArtifactDatabaseRestore({
      records: [{ id: 'last-good', type: 'dna', sequence: 'GAATTC' }],
      artifactState: { customEnzymes: { malformed: true } },
    })).toThrow(/customEnzymes must be an array/i);
  });

  it('round-trips a direct motifGetWorkspace-style snapshot without undefined object fields', () => {
    const payload = prepareInventoryReplacement([{
      id: 'direct-roundtrip',
      name: 'Direct roundtrip',
      type: 'dna',
      sequence: 'ATGGAATTCTAA',
    }]);
    const snapshot = createArtifactDatabaseSnapshot(payload, {
      customEnzymes: [],
      translationLayersByRecord: {},
      enzymeSourcesByRecord: {},
      hiddenEnzymesByRecord: {},
      hiddenFeatureTranslationsByRecord: {},
      restrictionLabelsByRecord: {},
      motifsByRecord: {},
    });

    expect(JSON.stringify(snapshot)).not.toContain('undefined');
    expect(() => prepareArtifactDatabaseRestore(snapshot)).not.toThrow();
    expect(prepareArtifactDatabaseRestore(snapshot).payload.records[0]).toMatchObject({
      id: 'direct-roundtrip',
      sequence: 'ATGGAATTCTAA',
    });
    expect(prepareArtifactDatabaseRestore(snapshot).payload.analysisResults).toEqual([]);
  });

  it('normalizes allowlisted feature fields and escapes all report markup', () => {
    const payload = prepareInventoryReplacement([{
      id: 'security-fixture',
      name: '<img src=x onerror="window.__motifReportPwned=true">',
      description: '</p><script>window.__motifReportPwned=true</script>',
      type: 'dna',
      sequence: 'GAATTCAAAAAA',
      features: [{
        id: 'unsafe-feature',
        name: '</li><script>window.__motifReportPwned=true</script>',
        type: '</li><script>window.__motifReportPwned=true</script>' as never,
        color: 'url(javascript:alert(1))',
        start: 0,
        end: 6,
        metadata: { source: '<script>metadata stays data</script>' },
      }],
    }]);
    const [record] = payload.records;
    const [feature] = record.features;

    expect(feature.type).toBe('custom');
    expect(feature.color).toBe('#9AA3B5');
    expect(feature.metadata).toEqual({ source: '<script>metadata stays data</script>' });
    const html = inventoryReportHtml(payload.records);
    expect(html).not.toContain('<script>window.__motifReportPwned=true</script>');
    expect(html).not.toContain('<img src=x');
    expect(html).toContain('&lt;script&gt;window.__motifReportPwned=true&lt;/script&gt;');
    expect(html).toContain('&lt;img src=x onerror=&quot;window.__motifReportPwned=true&quot;&gt;');

    const printStart = artifactSource.indexOf('function printHtmlReport(html: string): void {');
    const printEnd = artifactSource.indexOf('function AnalysisPanel(', printStart);
    const printHandler = artifactSource.slice(printStart, printEnd);
    expect(printHandler).toContain("frame.setAttribute('sandbox', 'allow-modals allow-same-origin');");
    expect(printHandler).toContain('frame.srcdoc = html;');
    expect(printHandler).not.toContain('document.write');
    expect(printHandler).not.toContain('allow-scripts');
  });

  it('rejects records above the artifact safety limit with an actionable code', () => {
    const oversized = 'A'.repeat(MOTIF_MAX_RECORD_LENGTH + 1);
    expect(() => prepareInventoryReplacement([{ id: 'too-large', type: 'dna', sequence: oversized }])).toThrowError(
      expect.objectContaining({
        code: 'MOTIF_RECORD_TOO_LARGE',
        message: expect.stringContaining(MOTIF_MAX_RECORD_LENGTH.toLocaleString()),
        details: expect.objectContaining({ mutated: false }),
      }),
    );
    expect(() => validateRuntimeRecordInputs([{ id: 'too-large', type: 'dna', sequence: oversized }], 'motifAddRecords')).toThrowError(
      expect.objectContaining({ code: 'MOTIF_RECORD_TOO_LARGE' }),
    );
  });

  it('bounds incoming cardinality, text, and nested JSON before mutating inventory', () => {
    const base = { id: 'bounded', type: 'dna' as const, sequence: 'GAATTCAAAAAA' };
    const limitCases: Array<{ input: unknown[]; path: string }> = [
      {
        input: Array.from({ length: MOTIF_MAX_RECORDS + 1 }, (_, index) => ({ ...base, id: `record-${index}` })),
        path: 'records',
      },
      {
        input: [{ ...base, features: Array.from({ length: MOTIF_MAX_FEATURES_PER_RECORD + 1 }, () => ({ start: 0, end: 1 })) }],
        path: 'records[0].features',
      },
      {
        input: [{ ...base, sites: Array.from({ length: MOTIF_MAX_SITES_PER_RECORD + 1 }, () => ({ enzyme: 'EcoRI' })) }],
        path: 'records[0].sites',
      },
      {
        input: [{ ...base, sites: [{ enzyme: 'EcoRI', hits: Array.from({ length: MOTIF_MAX_HITS_PER_SITE + 1 }, () => ({ position: 0 })) }] }],
        path: 'records[0].sites[0].hits',
      },
      {
        input: [{ ...base, sites: Array.from({ length: 6 }, () => ({ enzyme: 'EcoRI', hits: Array(9_000).fill({ position: 0 }) })) }],
        path: 'records[0].sites',
      },
      {
        input: [{ ...base, tags: Array.from({ length: MOTIF_MAX_TAGS_PER_RECORD + 1 }, (_, index) => `tag-${index}`) }],
        path: 'records[0].tags',
      },
      {
        input: [{ ...base, name: 'n'.repeat(MOTIF_MAX_SHORT_TEXT_LENGTH + 1) }],
        path: 'records[0].name',
      },
      {
        input: [{ ...base, provenance: { nodes: Array(MOTIF_MAX_METADATA_JSON_NODES + 1).fill(null) } }],
        path: 'records[0].provenance',
      },
      {
        input: [{ ...base, provenance: { chunks: Array(66).fill('x'.repeat(16_000)) } }],
        path: 'records[0].provenance',
      },
    ];

    let nested: Record<string, unknown> = {};
    for (let depth = 0; depth <= MOTIF_MAX_METADATA_JSON_DEPTH; depth += 1) nested = { child: nested };
    limitCases.push({ input: [{ ...base, provenance: nested }], path: 'records[0].provenance' });

    limitCases.forEach(({ input, path }) => {
      expect(() => validateRuntimeRecordInputs(input, 'motifAddRecords')).toThrowError(expect.objectContaining({
        code: 'MOTIF_INPUT_LIMIT_EXCEEDED',
        details: expect.objectContaining({
          mutated: false,
          issues: expect.arrayContaining([expect.objectContaining({ code: 'resource_limit', path })]),
        }),
      }));
    });

    expect(() => validateRuntimeRecordInputs([{
      ...base,
      ignoredPadding: 'x'.repeat(MOTIF_MAX_PAYLOAD_JSON_BYTES),
    }], 'motifAddRecords')).toThrowError(expect.objectContaining({
      code: 'MOTIF_INPUT_LIMIT_EXCEEDED',
      details: expect.objectContaining({
        mutated: false,
        issues: expect.arrayContaining([expect.objectContaining({ code: 'resource_limit', path: 'records' })]),
      }),
    }));
  });

  it('returns deep defensive runtime snapshots for every nested mutable field', () => {
    const payload = prepareInventoryReplacement([{
      id: 'snapshot-record',
      type: 'dna',
      sequence: 'GAATTCAAAAAA',
      tags: ['original'],
      provenance: { pipeline: { step: 'source' } },
      features: [{
        id: 'snapshot-feature',
        name: 'feature',
        start: 0,
        end: 6,
        metadata: { nested: { note: 'safe' } },
        subRanges: [{ start: 0, end: 3, strand: 1 }],
      }],
    }]);

    const first = createDefensiveRuntimeSnapshot(payload.records);
    first[0].tags![0] = 'mutated';
    ((first[0].provenance!.pipeline as Record<string, unknown>)).step = 'mutated';
    const feature = first[0].annotations![0];
    ((feature.metadata!.nested as Record<string, unknown>)).note = 'mutated';
    feature.subRanges![0].start = 2;

    const second = createDefensiveRuntimeSnapshot(payload.records);
    expect(second[0].tags).toEqual(['original']);
    expect(second[0].provenance).toEqual({ pipeline: { step: 'source' } });
    expect(second[0].annotations?.[0].metadata).toEqual({ nested: { note: 'safe' } });
    expect(second[0].annotations?.[0].subRanges).toEqual([{ start: 0, end: 3, strand: 1 }]);
    expect(first[0].annotations).not.toBe(second[0].annotations);
  });

  it('round-trips explicit DNA-end sequence and polarity metadata', () => {
    const payload = prepareInventoryReplacement([{
      id: 'sticky-fragment',
      name: 'Sticky fragment',
      type: 'dna',
      topology: 'linear',
      sequence: 'AATTGCGC',
      overhang5: 'AATT',
      overhang5Type: '5prime',
      overhang3: '',
      overhang3Type: 'blunt',
    }]);

    expect(payload.records[0]).toMatchObject({
      overhang5: 'AATT',
      overhang5Type: '5prime',
      overhang3: '',
      overhang3Type: 'blunt',
    });
    expect(createDefensiveRuntimeSnapshot(payload.records)[0]).toMatchObject({
      overhang5: 'AATT',
      overhang5Type: '5prime',
      overhang3: '',
      overhang3Type: 'blunt',
    });
    const summary = describePayloadSnapshot(payload, payload.selectedRecordId, ['common']);
    expect(summary?.data.ends).toEqual({
      left: { sequence: 'AATT', type: '5prime', label: 'AATT (5′ overhang)' },
      right: { sequence: '', type: 'blunt', label: 'blunt' },
    });
    expect(summary?.text).toContain('Ends: left AATT (5′ overhang); right blunt');
  });

  it('rejects inconsistent or non-DNA end chemistry transactionally', () => {
    const invalid = [
      { id: 'blunt-with-sequence', type: 'dna', sequence: 'AATTGCGC', overhang5: 'AATT', overhang5Type: 'blunt' },
      { id: 'sticky-without-sequence', type: 'dna', sequence: 'AATTGCGC', overhang5: '', overhang5Type: '5prime' },
      { id: 'type-without-end', type: 'dna', sequence: 'AATTGCGC', overhang5Type: '5prime' },
      { id: 'rna-end', type: 'rna', sequence: 'AAUUGCGC', overhang5: '', overhang5Type: 'blunt' },
    ];

    invalid.forEach((record) => {
      expect(() => validateRuntimeRecordInputs([record], 'motifAddRecords')).toThrowError(
        expect.objectContaining({ details: expect.objectContaining({ mutated: false }) }),
      );
    });
  });

  it('does not infer prose as protein while preserving explicit extended amino-acid symbols', () => {
    expect(normalizeSequence('hello world')).toBe('');
    expect(normalizeSequence('HELLO WORLD')).toBe('');
    expect(normalizeSequence('MPEPTIDE')).toBe('MPEPTIDE');
    expect(normalizeSequence('M U O J B X Z *', 'protein')).toBe('MUOJBXZ*');
  });

  it('keeps ordinary FASTA records JSON-compatible for atomic UI imports', () => {
    const [record] = parseImportedRecords(
      '>Wave3 Enzyme Probe\nAAAACCGGTCTCAAAATTTTCGTCTCGGGGAAAACCGAGACCAAAA',
      '',
      'auto',
      'linear',
    );

    expect(record).toMatchObject({
      name: 'Wave3 Enzyme Probe',
      molecule: 'dna',
      seq: 'AAAACCGGTCTCAAAATTTTCGTCTCGGGGAAAACCGAGACCAAAA',
    });
    expect(Object.prototype.hasOwnProperty.call(record, 'provenance')).toBe(false);
    expect(() => validateRuntimeRecordInputs([record], 'motifAddRecords')).not.toThrow();
  });

  it('reimports the bare object emitted by Record JSON export', () => {
    const [record] = parseImportedRecords(JSON.stringify({
      id: 'record-json-roundtrip',
      name: 'Record JSON roundtrip',
      molecule: 'dna',
      topology: 'circular',
      seq: 'AAAAGAATTCAAAA',
      annotations: [{ id: 'feature-1', name: 'feature', start: 2, end: 8 }],
      group: 'Round trips',
      provenance: { operation: 'record_json_export' },
    }), '', 'auto', 'linear');

    expect(record).toMatchObject({
      id: 'record-json-roundtrip',
      molecule: 'dna',
      topology: 'circular',
      seq: 'AAAAGAATTCAAAA',
      group: 'Round trips',
    });
    expect(() => validateRuntimeRecordInputs([record], 'motifAddRecords')).not.toThrow();
  });

  it('removes only undefined object properties from internal UI record shapes', () => {
    const sanitized = omitUndefinedObjectProperties({
      id: 'derived-record',
      group: undefined,
      annotations: [{
        name: 'derived feature',
        start: 0,
        end: 6,
        subRanges: undefined,
        metadata: { sourceRecordId: 'parent', optional: undefined },
      }],
      seq: 'GAATTC',
    });

    expect(sanitized).toEqual({
      id: 'derived-record',
      annotations: [{
        name: 'derived feature',
        start: 0,
        end: 6,
        metadata: { sourceRecordId: 'parent' },
      }],
      seq: 'GAATTC',
    });
    expect(omitUndefinedObjectProperties([undefined])).toEqual([undefined]);
    expect(() => validateRuntimeRecordInputs([sanitized], 'motifAddRecords')).not.toThrow();
  });

  it('models custom recognition motifs with one centered blunt cut bond', () => {
    expect(createCenteredBluntEnzyme('Wave3I', 'TTTTCG')).toEqual({
      name: 'Wave3I',
      recognitionSequence: 'TTTTCG',
      cutOffset: 3,
      complementCutOffset: 3,
      overhang: 'blunt',
    });
  });

  it('rejects truncated GenBank imports instead of falling through to raw-sequence parsing', () => {
    const truncatedGenBank = [
      'LOCUS       TRUNCATED       100 bp    DNA     linear   SYN 01-JAN-2026',
      'DEFINITION  Incomplete test record.',
      'ORIGIN',
      '        1 gaattc',
    ].join('\n');

    expect(() => parseImportedRecords(truncatedGenBank, '', 'auto', 'linear')).toThrowError(
      expect.objectContaining({
        code: 'MOTIF_TRUNCATED_GENBANK_IMPORT',
        message: expect.stringContaining('complete record'),
      }),
    );
    const lengthMismatchGenBank = [
      'LOCUS       PARTIAL          10 bp    DNA     linear   SYN 01-JAN-2026',
      'ORIGIN',
      '        1 gaattc',
      '//',
    ].join('\n');
    expect(() => parseImportedRecords(lengthMismatchGenBank, '', 'auto', 'linear')).toThrowError(
      expect.objectContaining({ code: 'MOTIF_TRUNCATED_GENBANK_IMPORT' }),
    );
    expect(() => validateRuntimeRecordInputs([
      {
        id: 'partial',
        type: 'dna',
        sequence: 'GAATTC',
        truncated: { reason: 'ORIGIN is partial' },
      },
    ], 'motifAddRecords')).toThrowError(expect.objectContaining({
      code: 'MOTIF_TRUNCATED_GENBANK_IMPORT',
      details: expect.objectContaining({ mutated: false }),
    }));
  });

  it('builds an immediate description from a fresh restriction scan', () => {
    const payload = prepareInventoryReplacement([
      { id: 'eco-ri-record', name: 'EcoRI record', type: 'dna', topology: 'linear', sequence: 'TTTGAATTCAAA' },
    ]);
    const summary = describePayloadSnapshot(payload, payload.selectedRecordId, ['common']);
    const restriction = summary?.data.restriction as { enzymesThatCut: number; singleCutters: string[] };

    expect(restriction.enzymesThatCut).toBeGreaterThan(0);
    expect(restriction.singleCutters).toContain('EcoRI');
    expect(summary?.text).toContain('Restriction:');
  });

  it('validates before resetting state and refreshes synchronous API summaries', () => {
    const renderStart = artifactSource.indexOf('window.motifRenderInventory = (entriesOrPayload) => {');
    const renderEnd = artifactSource.indexOf('// Append helper', renderStart);
    const renderHandler = artifactSource.slice(renderStart, renderEnd);
    const addStart = artifactSource.indexOf('window.motifAddRecords = (recordOrRecords) => {');
    const addEnd = artifactSource.indexOf('window.motifGetInventory', addStart);
    const addHandler = artifactSource.slice(addStart, addEnd);

    expect(renderHandler.indexOf('prepareInventoryReplacement(')).toBeLessThan(renderHandler.indexOf('resetRecordTransientState();'));
    expect(renderHandler).toContain('describeRuntimePayloadSnapshot(nextPayload');
    expect(addHandler).toContain("validateRuntimeRecordInputs(raw, 'motifAddRecords');");
    expect(addHandler).toContain('const traceSampleEntries = [...currentPayload.records, ...additions].reduce');
    expect(addHandler).toContain('traceSampleEntries > ARTIFACT_SANGER_MAX_WORKSPACE_SAMPLE_ENTRIES');
    expect(addHandler).toContain('No records were added.');
    expect(addHandler).toContain('describeRuntimePayloadSnapshot(nextPayload');
    expect(artifactSource).toContain('useState(loadInitialArtifactPayload)');
  });

  it('validates UI record batches before one atomic payload commit', () => {
    const addRecordsStart = artifactSource.indexOf('const addRecords = useCallback((recordInputs: readonly ArtifactRecordInput[]): number => {');
    const addRecordsEnd = artifactSource.indexOf('const addRecord = useCallback', addRecordsStart);
    const addRecordsHandler = artifactSource.slice(addRecordsStart, addRecordsEnd);

    expect(addRecordsStart).toBeGreaterThanOrEqual(0);
    expect(addRecordsHandler).toContain("validateRuntimeRecordInputs(sanitizedRecordInputs, 'motifAddRecords');");
    expect(addRecordsHandler.indexOf('validateRuntimeRecordInputs(')).toBeLessThan(addRecordsHandler.indexOf('payloadRef.current = nextPayload;'));
    expect(addRecordsHandler).toContain('records: [...current.records, ...additions]');
    expect(addRecordsHandler).not.toContain('recordInputs.reduce(');
  });

  it('keeps digest-save success inline instead of duplicating it in a toast', () => {
    const saveStart = artifactSource.indexOf('const saveDigestWorkflow = useCallback');
    const saveEnd = artifactSource.indexOf('const updateRecordDetails = useCallback', saveStart);
    const saveHandler = artifactSource.slice(saveStart, saveEnd);

    expect(saveHandler).toContain('setPayload(nextPayload);');
    expect(saveHandler).toContain('return { workflowResultId, recordCount: additions.length };');
    expect(saveHandler).not.toContain("'status'");
    expect(saveHandler).toContain("'error'");
  });

  it('reports complete ORF totals while limiting only the rendered rows', () => {
    const analysisStart = artifactSource.indexOf('function AnalysisPanel({');
    const analysisEnd = artifactSource.indexOf('function digestFragmentRangeLabel', analysisStart);
    const analysisPanel = artifactSource.slice(analysisStart, analysisEnd);

    expect(analysisPanel).toContain('const allOrfs = useMemo(');
    expect(analysisPanel).toContain('const visibleOrfs = useMemo(() => allOrfs.slice(0, 8), [allOrfs]);');
    expect(analysisPanel).toContain('orfCount: allOrfs.length');
    expect(analysisPanel).toContain('Showing the 8 longest of {allOrfs.length} detected ORFs.');
    expect(analysisPanel).toContain('`${allOrfs.length} ORFs`');
  });

  it('labels lossy interchange exports and session durability honestly', () => {
    expect(artifactSource).toContain("label: 'Basic GenBank'");
    expect(artifactSource).toContain("label: 'Basic GFF3 features'");
    expect(artifactSource).toContain('{copyStatus ?? durabilityStatus}');
    expect(artifactSource).toContain("? 'unsaved changes'");
    expect(artifactSource).toContain('Session data is not durable across reloads.');
    expect(artifactSource).toContain('Database JSON restores directly; ZIP contains the same inventory.json plus interchange exports');
    expect(artifactSource).toContain('artifactState,');
  });
});
