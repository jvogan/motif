#!/usr/bin/env node

import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

import { buildMotifCodexPlugin } from './build-motif-codex-plugin.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const fixtureDirectory = mkdtempSync(join(tmpdir(), 'motif-codex-plugin-'));
const outputDirectory = join(fixtureDirectory, 'codex', 'motif-for-claude-science');
const zipPath = join(fixtureDirectory, 'motif-for-codex.zip');
const checksumPath = join(fixtureDirectory, 'motif-for-codex.checksums.json');
const MCP_APP_RESOURCE_URI = 'ui://motif/workbench.html';
const MCP_APP_MIME_TYPE = 'text/html;profile=mcp-app';
const STARTUP_TIMEOUT_MS = 10_000;
const REQUEST_TIMEOUT_MS = 10_000;
const CLEANUP_TIMEOUT_MS = 5_000;
const MAX_STDERR_BYTES = 8 * 1024;
const REQUIRED_TRACKED_SOURCE_FILES = [
  'src/artifacts/motif-for-codex-plugin/motif-for-claude-science/.codex-plugin/plugin.json',
  'src/artifacts/motif-for-codex-plugin/motif-for-claude-science/.mcp.json',
  'src/artifacts/motif-for-codex-plugin/motif-for-claude-science/README.md',
  'src/artifacts/motif-for-codex-plugin/motif-for-claude-science/skills/motif-for-codex/SKILL.md',
];

function verifyRequiredSourcesAreTracked() {
  const tracked = new Set(execFileSync(
    'git',
    ['ls-files', '--', 'src/artifacts/motif-for-codex-plugin/motif-for-claude-science'],
    { cwd: root, encoding: 'utf8' },
  ).trim().split('\n').filter(Boolean));
  for (const relativePath of REQUIRED_TRACKED_SOURCE_FILES) {
    assert.equal(
      tracked.has(relativePath),
      true,
      `Codex plugin source must be tracked for fresh checkouts: ${relativePath}`,
    );
  }
}

async function withDeadline(label, timeoutMs, operation) {
  let timer;
  try {
    return await Promise.race([
      Promise.resolve().then(operation),
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(`${label} exceeded ${timeoutMs}ms`)), timeoutMs);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

function captureStderr(stream) {
  const chunks = [];
  let bytes = 0;
  let truncated = false;
  stream?.on('data', chunk => {
    if (bytes >= MAX_STDERR_BYTES) {
      truncated = true;
      return;
    }
    const buffer = Buffer.from(chunk);
    const retained = buffer.subarray(0, MAX_STDERR_BYTES - bytes);
    chunks.push(retained);
    bytes += retained.length;
    if (retained.length !== buffer.length) truncated = true;
  });
  return () => ({
    text: Buffer.concat(chunks).toString('utf8'),
    truncated,
  });
}

function redactDiagnostics(text, truncated) {
  const redacted = text
    .replaceAll(fixtureDirectory, '[staged-plugin]')
    .replaceAll(root, '[workspace]')
    .replace(/\/Users\/[^/\s]+/gu, '[home]')
    .slice(0, MAX_STDERR_BYTES);
  return `${redacted || '(no stderr captured)'}${truncated ? ' [truncated]' : ''}`;
}

function expandPluginRoot(value) {
  assert.equal(typeof value, 'string', 'MCP command and args must be strings');
  return value.replaceAll('${PLUGIN_ROOT}', outputDirectory);
}

async function verifyStagedMcp(mcpManifest) {
  const server = mcpManifest.motif;
  assert.equal(typeof server?.command, 'string', 'staged MCP server command is missing');
  assert.equal(Array.isArray(server?.args), true, 'staged MCP server args are missing');
  const command = expandPluginRoot(server.command);
  const args = server.args.map(expandPluginRoot);
  assert.equal(
    [command, ...args].some(value => value.includes('${PLUGIN_ROOT}')),
    false,
    'staged MCP command must expand every PLUGIN_ROOT placeholder before launch',
  );

  const transport = new StdioClientTransport({ command, args, stderr: 'pipe' });
  const stderr = captureStderr(transport.stderr);
  const client = new Client({ name: 'motif-codex-plugin-packaging-test', version: '1.0.0' });
  try {
    await withDeadline('staged MCP initialization', STARTUP_TIMEOUT_MS, () => client.connect(transport));
    assert.match(client.getInstructions() ?? '', /Motif is a read-only/u);

    const listed = await withDeadline('staged MCP tools/list', REQUEST_TIMEOUT_MS, () => client.listTools());
    const tools = listed.tools ?? [];
    assert.deepEqual(
      tools.map(tool => tool.name).sort(),
      ['motif_create_workbench_artifact', 'motif_open_workbench'],
      'staged MCP tool surface must contain exactly the two reviewed tools',
    );
    for (const tool of tools) {
      assert.equal(tool.annotations?.readOnlyHint, true, `${tool.name} must be marked read-only`);
      assert.equal(tool.annotations?.destructiveHint, false, `${tool.name} must not be destructive`);
      assert.equal(tool.annotations?.idempotentHint, true, `${tool.name} must be idempotent`);
      assert.equal(tool.annotations?.openWorldHint, false, `${tool.name} must not access or change the open world`);
      assert.equal(typeof tool.outputSchema, 'object', `${tool.name} must publish an output schema`);
      assert.equal(tool.outputSchema?.additionalProperties, false, `${tool.name} output schema must be closed`);
      assert.equal(Array.isArray(tool.outputSchema?.required), true, `${tool.name} output schema needs required fields`);
    }

    const resource = await withDeadline(
      'staged MCP resources/read',
      REQUEST_TIMEOUT_MS,
      () => client.readResource({ uri: MCP_APP_RESOURCE_URI }),
    );
    const app = resource.contents?.[0];
    assert.equal(app?.mimeType, MCP_APP_MIME_TYPE, 'staged App resource has the wrong MCP App MIME type');
    assert.equal(typeof app?.text, 'string', 'staged App resource must contain HTML text');
    const buildIdentity = /motif-build-id" content="([a-f0-9]{64})"/u.exec(app.text)?.[1];
    assert.ok(buildIdentity, 'staged App resource is missing its runtime build identity');

    const opened = await withDeadline(
      'staged MCP motif_open_workbench',
      REQUEST_TIMEOUT_MS,
      () => client.callTool({ name: 'motif_open_workbench', arguments: {} }),
    );
    assert.notEqual(opened.isError, true, 'staged motif_open_workbench returned an error');
    assert.equal(opened.structuredContent?.schema, 'motif.mcp.workbench.v1');
    assert.equal(opened.structuredContent?.delivery, 'live-app-request');
    assert.equal(opened.structuredContent?.runtimeBuildId, buildIdentity);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const diagnostics = stderr();
    throw new Error(
      `Staged MCP acceptance failed: ${message}\nStaged server diagnostics: ${redactDiagnostics(
        diagnostics.text,
        diagnostics.truncated,
      )}`,
      { cause: error },
    );
  } finally {
    await Promise.allSettled([
      withDeadline('staged MCP client cleanup', CLEANUP_TIMEOUT_MS, () => client.close()),
    ]);
    await Promise.allSettled([
      withDeadline('staged MCP transport cleanup', CLEANUP_TIMEOUT_MS, () => transport.close()),
    ]);
  }
}

try {
  verifyRequiredSourcesAreTracked();
  const first = buildMotifCodexPlugin({
    rootDirectory: root,
    outputDirectory,
    zipPath,
    checksumPath,
  });
  const firstZip = readFileSync(zipPath);
  const firstChecksums = readFileSync(checksumPath, 'utf8');

  const manifest = JSON.parse(
    readFileSync(join(outputDirectory, '.codex-plugin', 'plugin.json'), 'utf8'),
  );
  const packageJson = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
  const submission = JSON.parse(readFileSync(join(root, 'docs', 'openai-submission.json'), 'utf8'));
  const mcpManifest = JSON.parse(readFileSync(join(outputDirectory, '.mcp.json'), 'utf8'));
  const checksums = JSON.parse(firstChecksums);
  const skill = readFileSync(join(outputDirectory, 'skills', 'motif-for-codex', 'SKILL.md'), 'utf8');
  const skillInterface = readFileSync(
    join(outputDirectory, 'skills', 'motif-for-codex', 'agents', 'openai.yaml'),
    'utf8',
  );
  assert.equal(manifest.version, packageJson.version);
  assert.equal(manifest.name, 'motif-for-claude-science');
  assert.equal(
    packageJson.scripts['build:codex-plugin'],
    'npm run build:motif && node scripts/build-motif-codex-plugin.mjs',
  );
  assert.match(manifest.interface.longDescription, /interactive molecular-biology workbench/u);
  assert.match(manifest.interface.longDescription, /self-contained HTML workbench/u);
  assert.match(manifest.interface.longDescription, /does not retrieve missing records/u);
  assert.doesNotMatch(manifest.interface.longDescription, /motif_[a-z_]+/u);
  assert.doesNotMatch(manifest.interface.longDescription, /FASTA alignment|GenBank summary|sequence inspection/u);
  assert.equal(manifest.interface.displayName, 'Motif');
  assert.equal(manifest.interface.shortDescription, 'Explore biological sequences');
  assert.ok(manifest.interface.shortDescription.length <= 30);
  assert.equal(manifest.interface.privacyPolicyURL, 'https://github.com/jvogan/motif/blob/main/PRIVACY.md');
  assert.equal(manifest.interface.termsOfServiceURL, 'https://github.com/jvogan/motif/blob/main/TERMS.md');
  assert.equal(manifest.interface.logo, './assets/logo.png');
  assert.equal(manifest.interface.composerIcon, './assets/logo.png');
  assert.equal(manifest.interface.defaultPrompt.length, 3);
  assert.deepEqual(manifest.interface.defaultPrompt, submission.starter_prompts);
  for (const prompt of manifest.interface.defaultPrompt) assert.ok(prompt.length <= 128);
  assert.match(skill, /motif_open_workbench/u);
  assert.match(skill, /motif_create_workbench_artifact/u);
  assert.match(skill, /Do not invoke Motif merely because/u);
  assert.doesNotMatch(skill, /Motif for Claude Science/u);
  assert.doesNotMatch(skill, /sequence-review|relevant validation or summary/u);
  assert.match(skillInterface, /^interface:\n/u);
  assert.match(skillInterface, /display_name: "Motif"/u);
  assert.match(skillInterface, /short_description: "Inspect supplied biological sequences"/u);
  assert.match(skillInterface, /icon_small: "\.\/assets\/logo\.png"/u);
  assert.match(skillInterface, /icon_large: "\.\/assets\/logo\.png"/u);
  assert.match(skillInterface, /default_prompt: "Use \$motif-for-codex /u);
  assert.doesNotMatch(skillInterface, /^metadata:/mu);
  assert.equal(basename(outputDirectory), manifest.name);
  assert.equal(
    Object.hasOwn(mcpManifest, 'mcpServers'),
    false,
    'Codex .mcp.json must use its documented direct server map, not the legacy camelCase wrapper.',
  );
  assert.equal(mcpManifest.motif.command, 'node');
  assert.equal(
    mcpManifest.motif.args[0],
    '${PLUGIN_ROOT}/server/motif-mcp-server.mjs',
  );
  assert.equal(checksums.schema, 'motif.codex-plugin-checksums.v1');
  assert.equal(checksums.archiveSha256.length, 64);
  for (const archiveEntry of [
    '.codex-plugin/plugin.json',
    '.mcp.json',
    'assets/logo.png',
    'skills/motif-for-codex/SKILL.md',
    'skills/motif-for-codex/agents/openai.yaml',
    'skills/motif-for-codex/assets/logo.png',
    'server/motif-mcp-server.mjs',
    'server/motif-mcp-app.html',
  ]) {
    assert.equal(
      firstZip.includes(Buffer.from(archiveEntry)),
      true,
      `Codex plugin ZIP is missing its root entry: ${archiveEntry}`,
    );
  }

  for (const relativePath of [
    'assets/logo.png',
    'server/motif-mcp-server.mjs',
    'server/motif-mcp-app.html',
    'server/motif-template.html',
    'skills/motif-for-codex/SKILL.md',
    'skills/motif-for-codex/agents/openai.yaml',
    'skills/motif-for-codex/assets/logo.png',
    'PRIVACY.md',
    'TERMS.md',
    'examples/motif-demo.gb',
    'docs/CAPABILITIES.md',
    'doctor-motif-codex-plugin.mjs',
    'motif-runtime-integrity.json',
    'LICENSE',
    'THIRD_PARTY_NOTICES.md',
    'third-party-licenses/mcp-sdk-LICENSE.txt',
  ]) {
    assert.equal(existsSync(join(outputDirectory, relativePath)), true, `missing ${relativePath}`);
  }
  assert.deepEqual(
    readFileSync(join(outputDirectory, 'skills', 'motif-for-codex', 'assets', 'logo.png')),
    readFileSync(join(outputDirectory, 'assets', 'logo.png')),
    'plugin logo and skill icon must use the same reviewed bytes',
  );

  const stagedPackage = JSON.parse(readFileSync(join(outputDirectory, 'package.json'), 'utf8'));
  assert.equal(stagedPackage.engines?.node, '^22.13.0 || >=24.0.0');
  assert.equal(stagedPackage.scripts?.doctor, 'node doctor-motif-codex-plugin.mjs --plugin-root .');
  const runtimeIntegrity = JSON.parse(readFileSync(join(outputDirectory, 'motif-runtime-integrity.json'), 'utf8'));
  assert.equal(runtimeIntegrity.schema, 'motif.codex-runtime-integrity.v1');
  assert.equal(runtimeIntegrity.version, packageJson.version);
  assert.equal(runtimeIntegrity.algorithm, 'sha256');
  assert.deepEqual(Object.keys(runtimeIntegrity.files).sort(), [
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
  ]);

  await verifyStagedMcp(mcpManifest);

  buildMotifCodexPlugin({
    rootDirectory: root,
    outputDirectory,
    zipPath,
    checksumPath,
  });
  assert.deepEqual(readFileSync(zipPath), firstZip, 'Codex plugin ZIP must be deterministic');
  assert.equal(
    readFileSync(checksumPath, 'utf8'),
    firstChecksums,
    'Codex plugin checksums must be deterministic',
  );

  console.log('Motif Codex plugin packaging checks passed.');
} finally {
  rmSync(fixtureDirectory, { recursive: true, force: true });
}
