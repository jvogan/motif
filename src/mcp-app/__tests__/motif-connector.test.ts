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
      version: '0.2.0-test',
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

    const serializedTrace = JSON.stringify(traceEvents);
    expect(serializedTrace).not.toContain(sensitiveFilename);
    expect(serializedTrace).not.toContain(sensitiveSequence);
    expect(traceEvents).toEqual(expect.arrayContaining([
      expect.objectContaining({ event: 'resource.registered', uri: MOTIF_WORKBENCH_RESOURCE_URI }),
      expect.objectContaining({ event: 'tool.finish', tool: 'motif_open_workbench', status: 'ok', recordCount: 1 }),
      expect.objectContaining({ event: 'resource.read.finish', status: 'ok' }),
    ]));
  });

  it('returns bounded public errors without mounting malformed content', async () => {
    const server = createMotifClaudeScienceServer({
      version: '0.2.0-test',
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
