import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { afterEach, describe, expect, it } from 'vitest';

import { MOTIF_WORKBENCH_RESOURCE_URI } from '../contracts.js';
import {
  createMotifClaudeScienceServer,
  MOTIF_MCP_SERVER_INSTRUCTIONS,
} from '../server.js';

const runtimeBuildId = 'a'.repeat(64);
const openedClients: Client[] = [];
const openedServers: ReturnType<typeof createMotifClaudeScienceServer>[] = [];

function firstTextContent(content: unknown): string {
  if (!Array.isArray(content)) return '';
  const item = content.find((candidate): candidate is { type: 'text'; text: string } => (
    typeof candidate === 'object'
    && candidate !== null
    && 'type' in candidate
    && candidate.type === 'text'
    && 'text' in candidate
    && typeof candidate.text === 'string'
  ));
  return item?.text ?? '';
}

async function connectedClient(options: {
  readWorkbenchHtml?: () => Promise<string>;
  readArtifactTemplate?: () => Promise<string>;
} = {}): Promise<Client> {
  const server = createMotifClaudeScienceServer({
    version: '0.4.0',
    runtimeBuildId,
    readWorkbenchHtml: options.readWorkbenchHtml ?? (async () => '<html>Motif</html>'),
    readArtifactTemplate: options.readArtifactTemplate ?? (async () => (
      `<!doctype html><meta name="motif-build-id" content="${runtimeBuildId}">`
      + '<script type="application/json" id="motif-artifact-data">{}</script>'
    )),
  });
  const client = new Client({ name: 'motif-contract-test', version: '1.0.0' });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  openedServers.push(server);
  openedClients.push(client);
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  return client;
}

afterEach(async () => {
  await Promise.allSettled(openedClients.splice(0).map(client => client.close()));
  await Promise.allSettled(openedServers.splice(0).map(server => server.close()));
});

describe('Motif MCP public contract', () => {
  it('publishes concise initialization instructions and exact success schemas', async () => {
    const client = await connectedClient();
    expect(client.getInstructions()).toBe(MOTIF_MCP_SERVER_INSTRUCTIONS);
    expect(MOTIF_MCP_SERVER_INSTRUCTIONS.length).toBeLessThanOrEqual(512);

    const tools = await client.listTools();
    const openTool = tools.tools.find(tool => tool.name === 'motif_open_workbench');
    const artifactTool = tools.tools.find(tool => tool.name === 'motif_create_workbench_artifact');
    expect(openTool?.outputSchema).toMatchObject({
      additionalProperties: false,
      required: expect.arrayContaining([
        'schema',
        'mode',
        'recordCount',
        'residueCount',
        'delivery',
        'visibleMountConfirmed',
        'fallbackTool',
        'runtimeBuildId',
      ]),
    });
    expect((openTool?.outputSchema as { required?: string[] } | undefined)?.required).not.toContain('payload');
    expect(artifactTool?.outputSchema).toMatchObject({
      additionalProperties: false,
      required: expect.arrayContaining([
        'schema',
        'delivery',
        'visibleMountConfirmed',
        'runtimeBuildId',
        'filename',
        'recordCount',
        'residueCount',
        'bytes',
        'htmlSha256',
      ]),
    });

    const result = await client.callTool({ name: 'motif_open_workbench', arguments: {} });
    expect(result.isError).not.toBe(true);
    expect(result.structuredContent).toEqual({
      schema: 'motif.mcp.workbench.v1',
      mode: 'sample',
      recordCount: 0,
      residueCount: 0,
      delivery: 'live-app-request',
      visibleMountConfirmed: false,
      fallbackTool: 'motif_create_workbench_artifact',
      runtimeBuildId,
    });
  });

  it('returns typed bounded input failures', async () => {
    const client = await connectedClient();
    const result = await client.callTool({
      name: 'motif_create_workbench_artifact',
      arguments: { content: '>bad\nATGC?', filename: 'bad.fasta' },
    });
    expect(result.isError).toBe(true);
    expect(result._meta).toEqual({ 'motif/error': { code: 'invalid_input' } });
    const text = firstTextContent(result.content);
    expect(text).toMatch(/invalid character/i);
    expect(text.length).toBeLessThanOrEqual(512);
  });

  it('keeps the live payload in structuredContent until the App bridge coordinates an _meta migration', async () => {
    const client = await connectedClient();
    const result = await client.callTool({
      name: 'motif_open_workbench',
      arguments: { content: '>record\nATGC', filename: 'record.fasta' },
    });
    expect(result.isError).not.toBe(true);
    expect(result.structuredContent).toMatchObject({
      mode: 'artifact',
      payload: {
        schema: 'motif.claude-science.inventory.v2',
        records: [expect.objectContaining({ sequence: 'ATGC' })],
      },
    });
  });

  it('redacts unexpected template I/O details from tool failures', async () => {
    const client = await connectedClient({
      readArtifactTemplate: async () => {
        throw new Error('ENOENT: /Users/private-project/sentinel-template.html');
      },
    });
    const result = await client.callTool({
      name: 'motif_create_workbench_artifact',
      arguments: { content: '>ok\nATGC', filename: 'ok.fasta' },
    });
    expect(result.isError).toBe(true);
    expect(result._meta).toEqual({ 'motif/error': { code: 'internal_error' } });
    const text = firstTextContent(result.content);
    expect(text).toBe('Motif could not complete the request because an internal resource was unavailable.');
    expect(text).not.toMatch(/sentinel|private-project|Users/u);
  });

  it('redacts unexpected App resource I/O details', async () => {
    const client = await connectedClient({
      readWorkbenchHtml: async () => {
        throw new Error('EACCES: /Users/private-project/sentinel-workbench.html');
      },
    });
    const failure = await client.readResource({ uri: MOTIF_WORKBENCH_RESOURCE_URI }).then(
      () => undefined,
      (error: unknown) => error,
    );
    expect(failure).toBeInstanceOf(Error);
    expect((failure as Error).message).toContain('Motif workbench resource is unavailable.');
    expect((failure as Error).message).not.toMatch(/sentinel|private-project|Users/u);
  });
});
