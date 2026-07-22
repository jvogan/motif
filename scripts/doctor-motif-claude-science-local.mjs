#!/usr/bin/env node

import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';
import {
  DEFAULT_CLAUDE_SCIENCE_CONFIG_PATH,
  MOTIF_LOCAL_CONNECTOR_NAME,
  desiredMotifLocalServer,
  motifLocalServerMatches,
  preflightConnectorFiles,
  readLocalMcpConfig,
} from './lib/motif-local-mcp-config.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const WORKBENCH_URI = 'ui://motif/workbench.html';
const MCP_APP_MIME_TYPE = 'text/html;profile=mcp-app';
const EXPECTED_TOOLS = ['motif_create_workbench_artifact', 'motif_open_workbench'];
const PRIVACY_SENTINEL = 'ATGCGTACGTAA';

function usage() {
  return `Preflight the local Motif connector without changing Claude Science.

Usage:
  node scripts/doctor-motif-claude-science-local.mjs [options]

Options:
  --skip-config      Test built files and stdio without requiring registration.
  --files-only       Check built files (and registration unless skipped) only.
  --config <path>    Check an alternate local-mcp.json path.
  --timeout-ms <n>   Per-request timeout from 1000 to 30000 (default: 10000).
  --help             Show this help.

The doctor passes an allowlisted environment to the connector and never prints
config values, payload content, child stderr, or inherited credentials.
`;
}

export function parseDoctorArgs(args) {
  const options = {
    configPath: DEFAULT_CLAUDE_SCIENCE_CONFIG_PATH,
    skipConfig: false,
    filesOnly: false,
    timeoutMs: 10_000,
    help: false,
  };
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === '--help' || arg === '-h') {
      options.help = true;
      continue;
    }
    if (arg === '--skip-config') {
      options.skipConfig = true;
      continue;
    }
    if (arg === '--files-only') {
      options.filesOnly = true;
      continue;
    }
    if (arg === '--config' || arg === '--timeout-ms') {
      const value = args[index + 1];
      if (!value || value.startsWith('--')) throw new Error(`${arg} requires a value`);
      index += 1;
      if (arg === '--config') options.configPath = resolve(value);
      if (arg === '--timeout-ms') {
        const timeoutMs = Number(value);
        if (!Number.isInteger(timeoutMs) || timeoutMs < 1000 || timeoutMs > 30_000) {
          throw new Error('--timeout-ms must be an integer from 1000 to 30000');
        }
        options.timeoutMs = timeoutMs;
      }
      continue;
    }
    throw new Error(`Unknown option: ${arg}`);
  }
  return options;
}

class StdioMcpClient {
  constructor(child, timeoutMs) {
    this.child = child;
    this.timeoutMs = timeoutMs;
    this.nextId = 1;
    this.pending = new Map();
    this.protocolError = null;
    this.lines = createInterface({ input: child.stdout, crlfDelay: Infinity });
    this.lines.on('line', line => this.handleLine(line));
    child.once('error', error => this.failAll(`connector process failed to start (${error.code ?? 'unknown'})`));
    child.once('exit', (code, signal) => {
      if (this.pending.size > 0) {
        this.failAll(`connector exited before replying (${signal ?? code ?? 'unknown'})`);
      }
    });
  }

  handleLine(line) {
    if (!line.trim()) return;
    let message;
    try {
      message = JSON.parse(line);
    } catch {
      this.protocolError = new Error('connector wrote non-JSON data to protocol stdout');
      this.failAll(this.protocolError.message);
      return;
    }
    if (message.id === undefined) return;
    const pending = this.pending.get(message.id);
    if (!pending) return;
    this.pending.delete(message.id);
    clearTimeout(pending.timer);
    if (message.error) {
      pending.reject(new Error(`MCP ${pending.method} failed with code ${message.error.code ?? 'unknown'}`));
    } else {
      pending.resolve(message.result);
    }
  }

  failAll(message) {
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(new Error(message));
    }
    this.pending.clear();
  }

  request(method, params = {}) {
    if (this.protocolError) return Promise.reject(this.protocolError);
    const id = this.nextId;
    this.nextId += 1;
    return new Promise((resolvePromise, rejectPromise) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        rejectPromise(new Error(`MCP ${method} timed out`));
      }, this.timeoutMs);
      this.pending.set(id, { resolve: resolvePromise, reject: rejectPromise, timer, method });
      this.child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`);
    });
  }

  notify(method, params = {}) {
    this.child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method, params })}\n`);
  }

  async close() {
    this.lines.close();
    this.child.stdin.end();
    if (this.child.exitCode !== null || this.child.signalCode !== null) return;
    await new Promise(resolvePromise => {
      const timeout = setTimeout(() => {
        this.child.kill('SIGTERM');
        resolvePromise();
      }, 500);
      this.child.once('exit', () => {
        clearTimeout(timeout);
        resolvePromise();
      });
    });
  }
}

function doctorEnvironment(paths) {
  return {
    HOME: homedir(),
    PATH: '/usr/bin:/bin:/usr/sbin:/sbin',
    TMPDIR: process.env.TMPDIR || tmpdir(),
    LANG: 'C.UTF-8',
    MOTIF_NODE_BIN: process.execPath,
    MOTIF_ROOT: paths.root,
    MOTIF_MCP_TRACE: '1',
  };
}

function captureStderr(stream, maximumBytes = 1_048_576) {
  const chunks = [];
  let bytes = 0;
  let truncated = false;
  stream.on('data', chunk => {
    if (bytes >= maximumBytes) {
      truncated = true;
      return;
    }
    const buffer = Buffer.from(chunk);
    const remaining = maximumBytes - bytes;
    const retained = buffer.subarray(0, remaining);
    chunks.push(retained);
    bytes += retained.length;
    if (retained.length !== buffer.length) truncated = true;
  });
  return () => ({ text: Buffer.concat(chunks).toString('utf8'), bytes, truncated });
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function toolResourceUri(tool) {
  return tool?._meta?.ui?.resourceUri ?? tool?._meta?.['ui/resourceUri'];
}

async function inspectProtocol(paths, timeoutMs) {
  const child = spawn('/bin/bash', [paths.launcher], {
    cwd: paths.root,
    env: doctorEnvironment(paths),
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  const stderrSnapshot = captureStderr(child.stderr);
  const client = new StdioMcpClient(child, timeoutMs);

  try {
    const initialized = await client.request('initialize', {
      protocolVersion: '2025-06-18',
      capabilities: {},
      clientInfo: { name: 'motif-local-doctor', version: '1.0.0' },
    });
    assert(initialized?.serverInfo?.name === 'motif-claude-science', 'server identity is not motif-claude-science');
    client.notify('notifications/initialized');

    const listed = await client.request('tools/list');
    const tools = Array.isArray(listed?.tools) ? listed.tools : [];
    const names = tools.map(tool => tool.name).sort();
    assert(
      JSON.stringify(names) === JSON.stringify(EXPECTED_TOOLS),
      'tool discovery does not match the reviewed Motif connector surface',
    );

    const openTool = tools.find(tool => tool.name === 'motif_open_workbench');
    assert(toolResourceUri(openTool) === WORKBENCH_URI, 'open tool does not point to the Motif workbench resource');
    const viewer = openTool?._meta?.['operon.dev/viewer'];
    assert(viewer?.contentParam === 'content', 'artifact viewer content binding is missing');
    assert(viewer?.nameParam === 'filename', 'artifact viewer filename binding is missing');
    for (const extension of ['.gb', '.gbk', '.fa', '.fasta']) {
      assert(viewer?.opensExtensions?.includes(extension), `artifact viewer binding is missing ${extension}`);
    }

    const opened = await client.request('tools/call', {
      name: 'motif_open_workbench',
      arguments: {
        content: `>motif-doctor\n${PRIVACY_SENTINEL}`,
        filename: 'motif-doctor.fasta',
      },
    });
    assert(!opened?.isError, 'open-workbench smoke test returned an error');
    assert(opened?.structuredContent?.schema === 'motif.mcp.workbench.v1', 'open result schema is not Motif-owned');
    assert(opened?.structuredContent?.mode === 'artifact', 'opened FASTA was not identified as an artifact');
    assert(opened?.structuredContent?.delivery === 'live-app-request', 'open result does not identify its delivery boundary');
    assert(opened?.structuredContent?.visibleMountConfirmed === false, 'open result overstates visible mounting');
    assert(/^[a-f0-9]{64}$/u.test(opened?.structuredContent?.runtimeBuildId), 'open result is missing the runtime build identity');
    assert(opened?.structuredContent?.recordCount === 1, 'opened FASTA did not produce one record');
    assert(opened?.structuredContent?.residueCount === PRIVACY_SENTINEL.length, 'opened FASTA residue count is incorrect');
    const openedSummary = opened?.content?.find(item => item?.type === 'text')?.text;
    assert(
      typeof openedSummary === 'string' && openedSummary.includes('Records: motif-doctor [motif-doctor].'),
      'open-workbench summary does not expose the bounded record name and ID',
    );
    const workbenchLink = opened?.content?.find(
      item => item?.type === 'resource_link' && item.uri === WORKBENCH_URI,
    );
    assert(workbenchLink?.mimeType === MCP_APP_MIME_TYPE, 'open result is missing its Motif MCP App resource link');

    const artifactResult = await client.request('tools/call', {
      name: 'motif_create_workbench_artifact',
      arguments: {
        content: `>motif-doctor\n${PRIVACY_SENTINEL}`,
        filename: 'motif-doctor.fasta',
        outputFilename: 'motif-doctor.html',
      },
    });
    assert(!artifactResult?.isError, 'standalone artifact smoke test returned an error');
    assert(
      artifactResult?.structuredContent?.schema === 'motif.mcp.artifact-export.v1',
      'standalone artifact result schema is not Motif-owned',
    );
    assert(artifactResult?.structuredContent?.recordCount === 1, 'standalone artifact did not retain its record');
    assert(
      artifactResult?.structuredContent?.delivery === 'embedded-html-resource',
      'standalone artifact result does not identify its delivery boundary',
    );
    assert(
      artifactResult?.structuredContent?.runtimeBuildId === opened?.structuredContent?.runtimeBuildId,
      'standalone artifact and live App results disagree on the runtime build identity',
    );
    const artifactSummary = artifactResult?.content?.find(item => item?.type === 'text')?.text;
    assert(
      typeof artifactSummary === 'string' && artifactSummary.includes('Records: motif-doctor [motif-doctor].'),
      'standalone artifact summary does not expose the bounded record name and ID',
    );
    const embeddedArtifact = artifactResult?.content?.find(
      item => item?.type === 'resource' && item.resource?.mimeType === 'text/html',
    )?.resource;
    assert(typeof embeddedArtifact?.text === 'string', 'standalone artifact result is missing embedded HTML');
    assert(
      embeddedArtifact.text.includes('Motif for Claude Science'),
      'Motif identity is missing from the standalone artifact HTML',
    );

    const resource = await client.request('resources/read', { uri: WORKBENCH_URI });
    const app = resource?.contents?.[0];
    assert(app?.mimeType === MCP_APP_MIME_TYPE, 'Motif workbench resource has the wrong MIME type');
    assert(typeof app?.text === 'string', 'Motif workbench resource does not contain HTML');
    assert(app.text.includes('Motif for Claude Science'), 'Motif identity is missing from the MCP App HTML');

    await new Promise(resolvePromise => setTimeout(resolvePromise, 25));
    const stderr = stderrSnapshot();
    assert(!stderr.text.includes(PRIVACY_SENTINEL), 'connector tracing exposed sequence content');
    assert(!stderr.text.includes('motif-doctor.fasta'), 'connector tracing exposed a source filename');
    assert(!stderr.truncated, 'connector stderr exceeded the bounded doctor capture');

    return {
      protocolVersion: initialized.protocolVersion,
      tools: names,
      appBytes: Buffer.byteLength(app.text, 'utf8'),
      artifactBytes: Buffer.byteLength(embeddedArtifact.text, 'utf8'),
      stderrBytes: stderr.bytes,
    };
  } finally {
    await client.close();
  }
}

export async function runDoctor(options) {
  if (options.help) {
    process.stdout.write(usage());
    return { ok: true };
  }
  const paths = preflightConnectorFiles(root, { requireBuild: true });
  if (!options.skipConfig) {
    const desired = desiredMotifLocalServer(root);
    const document = readLocalMcpConfig(options.configPath);
    const entry = document.config.servers.find(server => server?.name === MOTIF_LOCAL_CONNECTOR_NAME);
    assert(motifLocalServerMatches(entry, desired), `${MOTIF_LOCAL_CONNECTOR_NAME} is not registered as expected`);
  }
  if (options.filesOnly) {
    process.stdout.write('\u2713 Motif connector files and requested registration checks passed\n');
    return { ok: true, filesOnly: true };
  }

  const result = await inspectProtocol(paths, options.timeoutMs);
  process.stdout.write('\u2713 Motif local connector doctor passed\n');
  process.stdout.write(`  protocol: ${result.protocolVersion}\n`);
  process.stdout.write(`  tools: ${result.tools.join(', ')}\n`);
  process.stdout.write(`  MCP App bytes: ${result.appBytes}\n`);
  process.stdout.write(`  standalone artifact bytes: ${result.artifactBytes}\n`);
  process.stdout.write(`  privacy-safe connector stderr: ${result.stderrBytes} bytes inspected\n`);
  return { ok: true, ...result };
}

const isMain = process.argv[1]
  && existsSync(process.argv[1])
  && resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isMain) {
  try {
    await runDoctor(parseDoctorArgs(process.argv.slice(2)));
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown doctor failure';
    process.stderr.write(`\u2717 Motif local connector doctor failed: ${message}\n`);
    process.exitCode = 1;
  }
}
