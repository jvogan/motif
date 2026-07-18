import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { afterEach, describe, expect, it } from 'vitest';

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

const artifactTemplate = '<!doctype html><html><head><title>Motif for Claude Science</title></head><body><script type="application/json" id="motif-artifact-data">__SEQUENCE_INVENTORY__</script></body></html>';

const openedClients: Client[] = [];
const openedServers: ReturnType<typeof createMotifClaudeScienceServer>[] = [];

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
      records: [{ ...base, sequence: 'AT*GC' }],
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
      filename: '../Demo report.html',
    });
    expect(artifact.summary).toMatchObject({
      schema: 'motif.mcp.artifact-export.v1',
      filename: 'Demo-report.html',
      recordCount: 1,
      residueCount: 6,
    });
    expect(artifact.summary.htmlSha256).toMatch(/^[a-f0-9]{64}$/u);
    expect(artifact.html).toContain('\\u003C/script\\u003E');
    expect(artifact.html).not.toContain('</script><script>unsafe()');
  });
});

describe('Motif for Claude Science MCP server', () => {
  it('exposes a fully branded app resource, viewer binding, and embedded fallback', async () => {
    const traceEvents: MotifMcpTraceEvent[] = [];
    const server = createMotifClaudeScienceServer({
      version: '0.2.1-test',
      readWorkbenchHtml: async () => '<!doctype html><title>Motif for Claude Science</title><div class="motif-cs-brand">Motif</div>',
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
      mode: 'artifact',
      sourceName: sensitiveFilename,
      recordCount: 1,
      residueCount: sensitiveSequence.length,
    });
    expect(openResult.content).toContainEqual(expect.objectContaining({
      type: 'resource_link',
      uri: MOTIF_WORKBENCH_RESOURCE_URI,
      mimeType: 'text/html;profile=mcp-app',
      name: 'Motif for Claude Science workbench',
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
    expect(resourceContent && 'text' in resourceContent ? resourceContent.text : '').toContain('Motif for Claude Science');

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
      filename: 'motif-review.html',
      recordCount: 1,
      residueCount: sensitiveSequence.length,
    });
    expect(artifactResult.content).toContainEqual(expect.objectContaining({
      type: 'resource',
      resource: expect.objectContaining({
        uri: 'motif://artifact/motif-review.html',
        mimeType: 'text/html',
        text: expect.stringContaining('Motif for Claude Science'),
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
      readWorkbenchHtml: async () => '<title>Motif for Claude Science</title>',
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
      readWorkbenchHtml: async () => '<title>Motif for Claude Science</title>',
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
