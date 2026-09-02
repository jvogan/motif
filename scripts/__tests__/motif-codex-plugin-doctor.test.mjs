import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import {
  inspectProtocol,
  inspectStagedPlugin,
  isSupportedNodeVersion,
  parseDoctorArgs,
  terminateChild,
} from '../doctor-motif-codex-plugin.mjs';

const temporaryDirectories = [];
const buildId = 'a'.repeat(64);

function createFixture(options = {}) {
  const root = mkdtempSync(join(tmpdir(), 'motif-codex-doctor-'));
  temporaryDirectories.push(root);
  for (const directory of [
    '.codex-plugin',
    'assets',
    'server',
    'skills/motif-for-codex/agents',
    'skills/motif-for-codex/assets',
  ]) {
    mkdirSync(join(root, directory), { recursive: true });
  }
  writeFileSync(join(root, '.codex-plugin/plugin.json'), JSON.stringify({
    name: 'motif-for-claude-science',
    version: '0.3.6',
    mcpServers: './.mcp.json',
    skills: './skills/',
  }));
  writeFileSync(join(root, '.mcp.json'), JSON.stringify({
    mcpServers: {
      motif: { command: 'node', args: ['${PLUGIN_ROOT}/server/motif-mcp-server.mjs'] },
    },
  }));
  writeFileSync(join(root, 'package.json'), JSON.stringify({
    name: 'motif-for-claude-science',
    version: '0.3.6',
    private: true,
    engines: { node: '^22.13.0 || >=24.0.0' },
  }));
  writeFileSync(join(root, 'doctor-motif-codex-plugin.mjs'), '// fixture doctor\n');
  writeFileSync(join(root, 'PRIVACY.md'), '# Privacy\n');
  writeFileSync(join(root, 'TERMS.md'), '# Terms\n');
  writeFileSync(join(root, 'assets/logo.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47]));
  writeFileSync(join(root, 'skills/motif-for-codex/SKILL.md'), '# Fixture skill\n');
  writeFileSync(join(root, 'skills/motif-for-codex/agents/openai.yaml'), 'interface:\n  display_name: Motif\n');
  writeFileSync(join(root, 'skills/motif-for-codex/assets/logo.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47]));
  writeFileSync(join(root, 'server/motif-mcp-app.html'), `<meta name="motif-build-id" content="${buildId}">app`);
  writeFileSync(
    join(root, 'server/motif-template.html'),
    `<meta name="motif-build-id" content="${buildId}"><script type="application/json" id="motif-artifact-data">{}</script>`,
  );
  writeFileSync(join(root, 'server/motif-mcp-server.mjs'), fakeServer(options));
  const integrityFiles = [
    '.codex-plugin/plugin.json',
    '.mcp.json',
    'PRIVACY.md',
    'TERMS.md',
    'assets/logo.png',
    'doctor-motif-codex-plugin.mjs',
    'package.json',
    'server/motif-mcp-app.html',
    'server/motif-mcp-server.mjs',
    'server/motif-template.html',
    'skills/motif-for-codex/SKILL.md',
    'skills/motif-for-codex/agents/openai.yaml',
    'skills/motif-for-codex/assets/logo.png',
  ];
  writeFileSync(join(root, 'motif-runtime-integrity.json'), JSON.stringify({
    schema: 'motif.codex-runtime-integrity.v1',
    algorithm: 'sha256',
    version: '0.3.6',
    files: Object.fromEntries(integrityFiles.map(relativePath => [
      relativePath,
      createHash('sha256').update(readFileSync(join(root, relativePath))).digest('hex'),
    ])),
  }));
  return root;
}

function fakeServer({ polluted = false, oversized = false } = {}) {
  return `
import { createInterface } from 'node:readline';
const buildId = ${JSON.stringify(buildId)};
const uri = 'ui://motif/workbench.html';
const app = '<meta name="motif-build-id" content="' + buildId + '">app';
const send = value => process.stdout.write(JSON.stringify(value) + '\\n');
createInterface({ input: process.stdin, crlfDelay: Infinity }).on('line', line => {
  const request = JSON.parse(line);
  if (request.id === undefined) return;
  ${polluted ? "process.stdout.write('not-json\\n'); return;" : ''}
  if (request.method === 'initialize') send({ jsonrpc: '2.0', id: request.id, result: {
    protocolVersion: '2025-06-18', serverInfo: { name: 'motif-claude-science', version: '0.3.6' }, capabilities: {}
  }});
  if (request.method === 'tools/list') send({ jsonrpc: '2.0', id: request.id, result: { tools: [
    { name: 'motif_open_workbench', _meta: { ui: { resourceUri: uri } } },
    { name: 'motif_create_workbench_artifact' }
  ] }});
  if (request.method === 'resources/list') send({ jsonrpc: '2.0', id: request.id, result: { resources: [
    { uri, name: 'Motif workbench', mimeType: 'text/html;profile=mcp-app' }
  ] }});
  if (request.method === 'resources/read') {
    ${oversized ? "process.stdout.write('x'.repeat(2048)); return;" : ''}
    send({ jsonrpc: '2.0', id: request.id, result: { contents: [
      { uri, mimeType: 'text/html;profile=mcp-app', text: app }
    ] }});
  }
  if (request.method === 'tools/call') send({ jsonrpc: '2.0', id: request.id, result: {
    structuredContent: { schema: 'motif.mcp.workbench.v1', recordCount: 1, residueCount: 4, runtimeBuildId: buildId },
    content: []
  }});
});
`;
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe('Motif Codex plugin consumer doctor', () => {
  it('checks the documented Node.js runtime range and CLI arguments', () => {
    expect(isSupportedNodeVersion('22.13.0')).toBe(true);
    expect(isSupportedNodeVersion('22.12.9')).toBe(false);
    expect(isSupportedNodeVersion('23.9.0')).toBe(false);
    expect(isSupportedNodeVersion('24.0.0')).toBe(true);
    expect(parseDoctorArgs(['--plugin-root', './stage', '--timeout-ms', '1200'])).toMatchObject({
      pluginRoot: './stage', timeoutMs: 1200,
    });
    expect(() => parseDoctorArgs([])).toThrow(/--plugin-root is required/u);
  });

  it('validates a staged package and exercises the complete tiny MCP flow', async () => {
    const root = createFixture();
    const packageInfo = await inspectStagedPlugin(root);
    const protocol = await inspectProtocol(packageInfo, { timeoutMs: 1000 });
    expect(packageInfo.runtimeBuildId).toBe(buildId);
    expect(protocol.tools).toEqual(['motif_create_workbench_artifact', 'motif_open_workbench']);
    expect(protocol.resources).toBe(1);
    expect(protocol.stdoutBytes).toBeGreaterThan(0);
  });

  it('rejects non-JSON protocol stdout with an actionable diagnostic', async () => {
    const packageInfo = await inspectStagedPlugin(createFixture({ polluted: true }));
    await expect(inspectProtocol(packageInfo, { timeoutMs: 1000 })).rejects.toThrow(
      /non-JSON data.*Rebuild the staged plugin/u,
    );
  });

  it('rejects a staged runtime file that no longer matches the integrity manifest', async () => {
    const root = createFixture();
    writeFileSync(join(root, 'server/motif-mcp-app.html'), `<meta name="motif-build-id" content="${buildId}">changed`);
    await expect(inspectStagedPlugin(root)).rejects.toThrow(/integrity check failed.*motif-mcp-app\.html/u);
  });

  it('rejects an oversized unterminated JSON-RPC frame', async () => {
    const packageInfo = await inspectStagedPlugin(createFixture({ oversized: true }));
    await expect(inspectProtocol(packageInfo, {
      timeoutMs: 1000,
      maxMessageBytes: 1024,
      maxStdoutBytes: 4096,
    })).rejects.toThrow(/frame larger than 1024 bytes/u);
  });

  it('escalates cleanup from TERM to KILL for a stuck child', async () => {
    const child = spawn(process.execPath, ['-e', "process.on('SIGTERM', () => {}); process.stdout.write('ready'); setInterval(() => {}, 1000)"], {
      stdio: ['pipe', 'pipe', 'ignore'],
    });
    await new Promise(resolvePromise => child.stdout.once('data', resolvePromise));
    await expect(terminateChild(child, {
      stdinGraceMs: 20,
      termGraceMs: 20,
      killGraceMs: 500,
    })).resolves.toBe('sigkill');
  });
});
