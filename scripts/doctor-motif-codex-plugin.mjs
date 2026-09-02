#!/usr/bin/env node

import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { open, readFile, realpath, stat } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT_PATH = fileURLToPath(import.meta.url);
const EXPECTED_PLUGIN_NAME = 'motif-for-claude-science';
const EXPECTED_SERVER_NAME = 'motif-claude-science';
const REQUIRED_TOOLS = ['motif_create_workbench_artifact', 'motif_open_workbench'];
const MCP_APP_MIME_TYPE = 'text/html;profile=mcp-app';
const PLUGIN_ROOT_TOKEN = '${PLUGIN_ROOT}';
const SEMVER_PATTERN = /^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/u;
const BUILD_ID_PATTERN = /<meta name="motif-build-id" content="([a-f0-9]{64})"\s*\/?>/u;
const DEFAULT_TIMEOUT_MS = 10_000;
const DEFAULT_MAX_MESSAGE_BYTES = 16 * 1024 * 1024;
const DEFAULT_MAX_STDOUT_BYTES = 32 * 1024 * 1024;
const MAX_STDERR_BYTES = 64 * 1024;
const MAX_JSON_FILE_BYTES = 1024 * 1024;
const MAX_RUNTIME_ASSET_BYTES = 8 * 1024 * 1024;
const MINIMUM_NODE_22_MINOR = 13;
const REQUIRED_NODE_RANGE = '^22.13.0 || >=24.0.0';
const INTEGRITY_SCHEMA = 'motif.codex-runtime-integrity.v1';
const INTEGRITY_FILES = [
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

function usage() {
  return `Verify a staged Motif Codex plugin without installing or changing it.

Usage:
  node doctor-motif-codex-plugin.mjs --plugin-root <path> [options]

Options:
  --plugin-root <path>  Staged motif-for-claude-science plugin directory.
  --files-only          Validate the package without starting its MCP server.
  --timeout-ms <n>      Per-request timeout from 1000 to 30000 (default: 10000).
  --help                Show this help.

The protocol check uses a minimal environment, bounded stdout/stderr, strict
newline-delimited JSON-RPC framing, and TERM-to-KILL process cleanup.
`;
}

export function parseDoctorArgs(args) {
  const options = {
    pluginRoot: undefined,
    filesOnly: false,
    timeoutMs: DEFAULT_TIMEOUT_MS,
    help: false,
  };
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === '--help' || arg === '-h') {
      options.help = true;
      continue;
    }
    if (arg === '--files-only') {
      options.filesOnly = true;
      continue;
    }
    if (arg === '--plugin-root' || arg === '--timeout-ms') {
      const value = args[index + 1];
      if (!value || value.startsWith('--')) throw new Error(`${arg} requires a value`);
      index += 1;
      if (arg === '--plugin-root') options.pluginRoot = value;
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
  if (!options.help && !options.pluginRoot) {
    throw new Error('--plugin-root is required; point it at the staged plugin directory');
  }
  return options;
}

export function isSupportedNodeVersion(version = process.versions.node) {
  const match = /^(\d+)\.(\d+)\.(\d+)(?:[-+].*)?$/u.exec(version);
  if (!match) return false;
  const major = Number(match[1]);
  const minor = Number(match[2]);
  return major >= 24 || (major === 22 && minor >= MINIMUM_NODE_22_MINOR);
}

function assertSupportedNode(version = process.versions.node) {
  if (!isSupportedNodeVersion(version)) {
    throw new Error(
      `Node.js ${version} is unsupported. Use Node.js 22.13 or newer in the 22.x line, or Node.js 24 or newer.`,
    );
  }
}

function assertPlainObject(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} must contain a JSON object.`);
  }
}

async function readBoundedBytes(path, label, maximumBytes) {
  let handle;
  try {
    handle = await open(path, 'r');
    const metadata = await handle.stat();
    if (!metadata.isFile() || metadata.size <= 0 || metadata.size > maximumBytes) {
      throw new Error(`${label} must be a non-empty regular file no larger than ${maximumBytes} bytes.`);
    }
    const bytes = await handle.readFile();
    if (bytes.byteLength > maximumBytes) throw new Error(`${label} exceeds ${maximumBytes} bytes.`);
    return bytes;
  } catch (error) {
    if (error instanceof Error && error.message.startsWith(label)) throw error;
    throw new Error(`${label} is missing or unreadable. Rebuild the staged Codex plugin.`);
  } finally {
    await handle?.close();
  }
}

async function readBoundedFile(path, label, maximumBytes) {
  const bytes = await readBoundedBytes(path, label, maximumBytes);
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    throw new Error(`${label} must be valid UTF-8.`);
  }
}

async function readJson(path, label) {
  const text = await readBoundedFile(path, label, MAX_JSON_FILE_BYTES);
  try {
    const value = JSON.parse(text);
    assertPlainObject(value, label);
    return value;
  } catch (error) {
    if (error instanceof Error && error.message.startsWith(label)) throw error;
    throw new Error(`${label} contains malformed JSON. Rebuild the staged Codex plugin.`);
  }
}

function isWithinRoot(root, candidate) {
  const pathFromRoot = relative(root, candidate);
  return pathFromRoot === '' || (!pathFromRoot.startsWith(`..${sep}`) && pathFromRoot !== '..' && !isAbsolute(pathFromRoot));
}

async function requireContainedFile(root, relativePath, label) {
  const requestedPath = resolve(root, relativePath);
  if (!isWithinRoot(root, requestedPath)) throw new Error(`${label} resolves outside the plugin root.`);
  let actualPath;
  try {
    actualPath = await realpath(requestedPath);
  } catch {
    throw new Error(`${label} is missing. Rebuild the staged Codex plugin.`);
  }
  if (!isWithinRoot(root, actualPath)) throw new Error(`${label} points outside the plugin root.`);
  const metadata = await stat(actualPath);
  if (!metadata.isFile()) throw new Error(`${label} must be a regular file.`);
  return actualPath;
}

function expandPluginRoot(value, pluginRoot) {
  if (typeof value !== 'string') throw new Error('Codex MCP command and arguments must be strings.');
  const expanded = value.replaceAll(PLUGIN_ROOT_TOKEN, pluginRoot);
  if (expanded.includes(PLUGIN_ROOT_TOKEN)) {
    throw new Error('Codex MCP configuration contains an unresolved PLUGIN_ROOT placeholder.');
  }
  return expanded;
}

export async function inspectStagedPlugin(pluginRootInput) {
  assertSupportedNode();
  let pluginRoot;
  try {
    pluginRoot = await realpath(resolve(pluginRootInput));
  } catch {
    throw new Error(`Staged plugin root does not exist: ${resolve(pluginRootInput)}`);
  }
  const rootMetadata = await stat(pluginRoot);
  if (!rootMetadata.isDirectory()) throw new Error(`Staged plugin root is not a directory: ${pluginRoot}`);

  const paths = {
    pluginManifest: await requireContainedFile(pluginRoot, '.codex-plugin/plugin.json', 'Codex plugin manifest'),
    mcpManifest: await requireContainedFile(pluginRoot, '.mcp.json', 'Codex MCP manifest'),
    privacy: await requireContainedFile(pluginRoot, 'PRIVACY.md', 'privacy policy'),
    terms: await requireContainedFile(pluginRoot, 'TERMS.md', 'terms of use'),
    packageManifest: await requireContainedFile(pluginRoot, 'package.json', 'staged package manifest'),
    integrityManifest: await requireContainedFile(pluginRoot, 'motif-runtime-integrity.json', 'runtime integrity manifest'),
    launcher: await requireContainedFile(pluginRoot, 'server/motif-mcp-server.mjs', 'packaged MCP launcher'),
    app: await requireContainedFile(pluginRoot, 'server/motif-mcp-app.html', 'packaged MCP App'),
    template: await requireContainedFile(pluginRoot, 'server/motif-template.html', 'packaged artifact template'),
    skill: await requireContainedFile(pluginRoot, 'skills/motif-for-codex/SKILL.md', 'Codex Motif skill'),
    skillInterface: await requireContainedFile(
      pluginRoot,
      'skills/motif-for-codex/agents/openai.yaml',
      'Codex Motif skill interface',
    ),
  };
  const [pluginManifest, mcpManifest, packageManifest, integrityManifest, appHtml, templateHtml] = await Promise.all([
    readJson(paths.pluginManifest, 'Codex plugin manifest'),
    readJson(paths.mcpManifest, 'Codex MCP manifest'),
    readJson(paths.packageManifest, 'staged package manifest'),
    readJson(paths.integrityManifest, 'runtime integrity manifest'),
    readBoundedFile(paths.app, 'packaged MCP App', MAX_RUNTIME_ASSET_BYTES),
    readBoundedFile(paths.template, 'packaged artifact template', MAX_RUNTIME_ASSET_BYTES),
  ]);
  await Promise.all([
    readBoundedFile(paths.launcher, 'packaged MCP launcher', MAX_RUNTIME_ASSET_BYTES),
    readBoundedFile(paths.skill, 'Codex Motif skill', MAX_JSON_FILE_BYTES),
    readBoundedFile(paths.skillInterface, 'Codex Motif skill interface', MAX_JSON_FILE_BYTES),
    readBoundedFile(paths.privacy, 'privacy policy', MAX_JSON_FILE_BYTES),
    readBoundedFile(paths.terms, 'terms of use', MAX_JSON_FILE_BYTES),
  ]);

  if (pluginManifest.name !== EXPECTED_PLUGIN_NAME) {
    throw new Error(`Codex plugin manifest name must be ${EXPECTED_PLUGIN_NAME}.`);
  }
  if (!SEMVER_PATTERN.test(pluginManifest.version ?? '')) {
    throw new Error('Codex plugin manifest has a missing or invalid semantic version.');
  }
  if (pluginManifest.version !== packageManifest.version) {
    throw new Error('Codex plugin and staged package versions do not match. Rebuild the staged plugin.');
  }
  if (pluginManifest.mcpServers !== './.mcp.json' || pluginManifest.skills !== './skills/') {
    throw new Error('Codex plugin manifest does not reference the bundled MCP manifest and skills directory.');
  }
  if (packageManifest.name !== EXPECTED_PLUGIN_NAME || packageManifest.private !== true) {
    throw new Error('Staged package metadata must retain the Motif package name and private flag.');
  }
  if (packageManifest.engines?.node !== REQUIRED_NODE_RANGE) {
    throw new Error(`Staged package metadata must declare Node.js ${REQUIRED_NODE_RANGE}.`);
  }

  if (
    integrityManifest.schema !== INTEGRITY_SCHEMA
    || integrityManifest.algorithm !== 'sha256'
    || integrityManifest.version !== pluginManifest.version
  ) {
    throw new Error('Runtime integrity manifest metadata is invalid. Rebuild the staged plugin.');
  }
  assertPlainObject(integrityManifest.files, 'runtime integrity manifest files');
  const integrityPaths = Object.keys(integrityManifest.files).sort();
  if (JSON.stringify(integrityPaths) !== JSON.stringify([...INTEGRITY_FILES].sort())) {
    throw new Error('Runtime integrity manifest file inventory is incomplete or unexpected. Rebuild the staged plugin.');
  }
  for (const relativePath of INTEGRITY_FILES) {
    const path = await requireContainedFile(pluginRoot, relativePath, `integrity file ${relativePath}`);
    const bytes = await readBoundedBytes(path, `integrity file ${relativePath}`, MAX_RUNTIME_ASSET_BYTES);
    const actualSha256 = createHash('sha256').update(bytes).digest('hex');
    if (integrityManifest.files[relativePath] !== actualSha256) {
      throw new Error(`Runtime integrity check failed for ${relativePath}. Rebuild the staged plugin.`);
    }
  }

  assertPlainObject(mcpManifest.mcpServers, 'Codex MCP server map');
  const server = mcpManifest.mcpServers.motif;
  assertPlainObject(server, 'Codex MCP server entry');
  if (server.command !== 'node') {
    throw new Error('Codex MCP server command must be "node"; reinstall or rebuild the plugin.');
  }
  if (!Array.isArray(server.args) || server.args.length !== 1) {
    throw new Error('Codex MCP server must have exactly one launcher argument.');
  }
  const expandedLauncher = expandPluginRoot(server.args[0], pluginRoot);
  if (resolve(expandedLauncher) !== paths.launcher) {
    throw new Error('Codex MCP server launcher does not resolve to the bundled server.');
  }

  const appBuildId = BUILD_ID_PATTERN.exec(appHtml)?.[1];
  const templateBuildId = BUILD_ID_PATTERN.exec(templateHtml)?.[1];
  if (!appBuildId || !templateBuildId || appBuildId !== templateBuildId) {
    throw new Error('Packaged MCP App and artifact template have missing or inconsistent build identities.');
  }
  if (!templateHtml.includes('<script type="application/json" id="motif-artifact-data">')) {
    throw new Error('Packaged artifact template is missing its embedded Motif data slot.');
  }

  return {
    pluginRoot,
    version: pluginManifest.version,
    runtimeBuildId: appBuildId,
    command: process.execPath,
    args: [paths.launcher],
    paths,
  };
}

function minimalEnvironment() {
  return {
    HOME: homedir(),
    PATH: '/usr/bin:/bin:/usr/sbin:/sbin',
    TMPDIR: process.env.TMPDIR || tmpdir(),
    LANG: 'C.UTF-8',
  };
}

function exitPromise(child) {
  if (child.exitCode !== null || child.signalCode !== null) return Promise.resolve();
  return new Promise(resolvePromise => child.once('exit', resolvePromise));
}

async function waitForExit(child, timeoutMs) {
  if (child.exitCode !== null || child.signalCode !== null) return true;
  let timer;
  const exited = await Promise.race([
    exitPromise(child).then(() => true),
    new Promise(resolvePromise => {
      timer = setTimeout(() => resolvePromise(false), timeoutMs);
    }),
  ]);
  clearTimeout(timer);
  return exited;
}

export async function terminateChild(child, options = {}) {
  const stdinGraceMs = options.stdinGraceMs ?? 250;
  const termGraceMs = options.termGraceMs ?? 500;
  const killGraceMs = options.killGraceMs ?? 500;
  if (child.exitCode !== null || child.signalCode !== null) return 'already-exited';
  child.stdin?.end();
  if (await waitForExit(child, stdinGraceMs)) return 'stdin';
  child.kill('SIGTERM');
  if (await waitForExit(child, termGraceMs)) return 'sigterm';
  child.kill('SIGKILL');
  if (await waitForExit(child, killGraceMs)) return 'sigkill';
  throw new Error('Packaged MCP server did not exit after SIGKILL. Stop it manually and retry.');
}

class BoundedJsonRpcClient {
  constructor(child, options = {}) {
    this.child = child;
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.maxMessageBytes = options.maxMessageBytes ?? DEFAULT_MAX_MESSAGE_BYTES;
    this.maxStdoutBytes = options.maxStdoutBytes ?? DEFAULT_MAX_STDOUT_BYTES;
    this.nextId = 1;
    this.pending = new Map();
    this.buffer = Buffer.alloc(0);
    this.stdoutBytes = 0;
    this.protocolError = null;
    this.onData = chunk => this.handleData(Buffer.from(chunk));
    this.onError = error => this.failProtocol(`packaged MCP server stdout failed (${error.code ?? 'unknown'})`);
    child.stdout.on('data', this.onData);
    child.stdout.once('error', this.onError);
    child.once('error', error => this.failProtocol(`packaged MCP server failed to start (${error.code ?? 'unknown'})`));
    child.once('exit', (code, signal) => {
      if (this.buffer.length > 0 && !this.protocolError) {
        this.failProtocol('packaged MCP server ended with an incomplete JSON-RPC frame');
      } else if (this.pending.size > 0 && !this.protocolError) {
        this.failProtocol(`packaged MCP server exited before replying (${signal ?? code ?? 'unknown'})`);
      }
    });
  }

  handleData(chunk) {
    if (this.protocolError) return;
    this.stdoutBytes += chunk.length;
    if (this.stdoutBytes > this.maxStdoutBytes) {
      this.failProtocol(`packaged MCP server stdout exceeded the ${this.maxStdoutBytes}-byte session limit`);
      return;
    }
    this.buffer = this.buffer.length === 0 ? chunk : Buffer.concat([this.buffer, chunk]);
    if (this.buffer.length > this.maxMessageBytes && this.buffer.indexOf(0x0a) === -1) {
      this.failProtocol(`packaged MCP server emitted a JSON-RPC frame larger than ${this.maxMessageBytes} bytes`);
      return;
    }
    while (!this.protocolError) {
      const newline = this.buffer.indexOf(0x0a);
      if (newline === -1) break;
      const frame = this.buffer.subarray(0, newline);
      this.buffer = this.buffer.subarray(newline + 1);
      if (frame.length > this.maxMessageBytes) {
        this.failProtocol(`packaged MCP server emitted a JSON-RPC frame larger than ${this.maxMessageBytes} bytes`);
        return;
      }
      if (frame.length === 0 || (frame.length === 1 && frame[0] === 0x0d)) continue;
      this.handleFrame(frame);
    }
  }

  handleFrame(frame) {
    let line;
    try {
      line = new TextDecoder('utf-8', { fatal: true }).decode(frame).replace(/\r$/u, '');
    } catch {
      this.failProtocol('packaged MCP server wrote invalid UTF-8 to protocol stdout');
      return;
    }
    let message;
    try {
      message = JSON.parse(line);
    } catch {
      this.failProtocol('packaged MCP server wrote non-JSON data to protocol stdout');
      return;
    }
    if (!message || typeof message !== 'object' || Array.isArray(message) || message.jsonrpc !== '2.0') {
      this.failProtocol('packaged MCP server wrote an invalid JSON-RPC object to protocol stdout');
      return;
    }
    if (message.id === undefined) {
      if (typeof message.method !== 'string') {
        this.failProtocol('packaged MCP server wrote an invalid JSON-RPC notification to protocol stdout');
      }
      return;
    }
    if (typeof message.method === 'string') {
      this.failProtocol('packaged MCP server made an unsupported reverse JSON-RPC request');
      return;
    }
    const pending = this.pending.get(message.id);
    if (!pending) {
      this.failProtocol('packaged MCP server replied with an unknown JSON-RPC request ID');
      return;
    }
    const hasResult = Object.hasOwn(message, 'result');
    const hasError = Object.hasOwn(message, 'error');
    if (hasResult === hasError) {
      this.failProtocol('packaged MCP server reply must contain exactly one of result or error');
      return;
    }
    this.pending.delete(message.id);
    clearTimeout(pending.timer);
    if (hasError) {
      const code = message.error && typeof message.error === 'object' ? message.error.code : 'unknown';
      pending.reject(new Error(`MCP ${pending.method} failed with code ${code}`));
    } else {
      pending.resolve(message.result);
    }
  }

  failProtocol(message) {
    if (!this.protocolError) this.protocolError = new Error(message);
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(this.protocolError);
    }
    this.pending.clear();
  }

  request(method, params = {}) {
    if (this.protocolError) return Promise.reject(this.protocolError);
    if (this.child.exitCode !== null || this.child.signalCode !== null || !this.child.stdin.writable) {
      return Promise.reject(new Error(`MCP ${method} could not run because the packaged server is not writable`));
    }
    const id = this.nextId;
    this.nextId += 1;
    const request = Buffer.from(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`, 'utf8');
    if (request.length > this.maxMessageBytes) {
      return Promise.reject(new Error(`MCP ${method} request exceeds the doctor message limit`));
    }
    return new Promise((resolvePromise, rejectPromise) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        rejectPromise(new Error(`MCP ${method} timed out after ${this.timeoutMs}ms`));
      }, this.timeoutMs);
      this.pending.set(id, { resolve: resolvePromise, reject: rejectPromise, timer, method });
      try {
        this.child.stdin.write(request, error => {
          if (!error) return;
          const pending = this.pending.get(id);
          if (!pending) return;
          this.pending.delete(id);
          clearTimeout(pending.timer);
          pending.reject(new Error(`MCP ${method} could not be written to the packaged server`));
        });
      } catch {
        const pending = this.pending.get(id);
        if (pending) {
          this.pending.delete(id);
          clearTimeout(pending.timer);
        }
        rejectPromise(new Error(`MCP ${method} could not be written to the packaged server`));
      }
    });
  }

  notify(method, params = {}) {
    if (this.protocolError || !this.child.stdin.writable) return;
    const notification = Buffer.from(`${JSON.stringify({ jsonrpc: '2.0', method, params })}\n`, 'utf8');
    if (notification.length > this.maxMessageBytes) throw new Error(`MCP ${method} notification exceeds the doctor message limit`);
    this.child.stdin.write(notification);
  }

  detach() {
    this.child.stdout.off('data', this.onData);
    this.child.stdout.off('error', this.onError);
  }
}

function captureStderr(stream) {
  const chunks = [];
  let bytes = 0;
  let truncated = false;
  stream.on('data', chunk => {
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
  return () => ({ text: Buffer.concat(chunks).toString('utf8'), bytes, truncated });
}

function toolResourceUri(tool) {
  return tool?._meta?.ui?.resourceUri ?? tool?._meta?.['ui/resourceUri'];
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function sanitizedDiagnostics(text, pluginRoot) {
  return text
    .replaceAll(pluginRoot, '[plugin-root]')
    .replaceAll(homedir(), '[home]')
    .replace(/[\u0000-\u001f\u007f-\u009f]+/gu, ' ')
    .replace(/\s+/gu, ' ')
    .trim()
    .slice(0, 1024);
}

export async function inspectProtocol(packageInfo, options = {}) {
  const child = spawn(packageInfo.command, packageInfo.args, {
    cwd: packageInfo.pluginRoot,
    env: minimalEnvironment(),
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  const stderrSnapshot = captureStderr(child.stderr);
  const client = new BoundedJsonRpcClient(child, options);
  try {
    const initialized = await client.request('initialize', {
      protocolVersion: '2025-06-18',
      capabilities: {},
      clientInfo: { name: 'motif-codex-plugin-doctor', version: '1.0.0' },
    });
    assert(initialized?.serverInfo?.name === EXPECTED_SERVER_NAME, `server identity is not ${EXPECTED_SERVER_NAME}`);
    client.notify('notifications/initialized');

    const listedTools = await client.request('tools/list');
    const tools = Array.isArray(listedTools?.tools) ? listedTools.tools : [];
    for (const requiredTool of REQUIRED_TOOLS) {
      assert(tools.some(tool => tool?.name === requiredTool), `tools/list is missing ${requiredTool}`);
    }
    const openTool = tools.find(tool => tool?.name === 'motif_open_workbench');
    const workbenchUri = toolResourceUri(openTool);
    assert(typeof workbenchUri === 'string' && workbenchUri.startsWith('ui://motif/'), 'open tool is missing its Motif UI resource URI');

    const listedResources = await client.request('resources/list');
    const resources = Array.isArray(listedResources?.resources) ? listedResources.resources : [];
    assert(resources.some(resource => resource?.uri === workbenchUri), 'resources/list is missing the workbench resource');

    const resourceResult = await client.request('resources/read', { uri: workbenchUri });
    const app = resourceResult?.contents?.find(item => item?.uri === workbenchUri);
    assert(app?.mimeType === MCP_APP_MIME_TYPE, 'workbench resource has the wrong MCP App MIME type');
    assert(typeof app?.text === 'string' && app.text.length > 0, 'workbench resource does not contain HTML');
    const liveBuildId = BUILD_ID_PATTERN.exec(app.text)?.[1];
    assert(liveBuildId === packageInfo.runtimeBuildId, 'served workbench build identity does not match the staged assets');

    const opened = await client.request('tools/call', {
      name: 'motif_open_workbench',
      arguments: { content: '>motif-doctor\nACGT', filename: 'motif-doctor.fasta' },
    });
    assert(opened?.isError !== true, 'motif_open_workbench returned an error');
    assert(opened?.structuredContent?.schema === 'motif.mcp.workbench.v1', 'open result schema is not Motif-owned');
    assert(opened?.structuredContent?.recordCount === 1, 'tiny FASTA did not produce one record');
    assert(opened?.structuredContent?.residueCount === 4, 'tiny FASTA did not retain four residues');
    assert(opened?.structuredContent?.runtimeBuildId === liveBuildId, 'open result build identity does not match the workbench resource');

    const stderr = stderrSnapshot();
    assert(!stderr.truncated, `packaged MCP server stderr exceeded the ${MAX_STDERR_BYTES}-byte limit`);
    return {
      protocolVersion: initialized.protocolVersion,
      tools: tools.map(tool => tool.name).filter(name => typeof name === 'string').sort(),
      resources: resources.length,
      appBytes: Buffer.byteLength(app.text, 'utf8'),
      stdoutBytes: client.stdoutBytes,
      stderrBytes: stderr.bytes,
    };
  } catch (error) {
    const diagnostics = stderrSnapshot();
    const detail = sanitizedDiagnostics(diagnostics.text, packageInfo.pluginRoot);
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(
      `${message}. Rebuild the staged plugin and rerun the doctor.${detail ? ` Server diagnostic: ${detail}` : ''}`,
      { cause: error },
    );
  } finally {
    await terminateChild(child);
    client.detach();
  }
}

export async function runDoctor(options) {
  if (options.help) {
    process.stdout.write(usage());
    return { ok: true, help: true };
  }
  const packageInfo = await inspectStagedPlugin(options.pluginRoot);
  if (options.filesOnly) {
    process.stdout.write('\u2713 Motif Codex plugin files passed\n');
    process.stdout.write(`  plugin: ${packageInfo.pluginRoot}\n`);
    process.stdout.write(`  version: ${packageInfo.version}\n`);
    process.stdout.write(`  runtime build: ${packageInfo.runtimeBuildId.slice(0, 12)}\n`);
    return { ok: true, filesOnly: true, ...packageInfo };
  }
  const protocol = await inspectProtocol(packageInfo, { timeoutMs: options.timeoutMs });
  process.stdout.write('\u2713 Motif Codex plugin doctor passed\n');
  process.stdout.write(`  plugin: ${packageInfo.pluginRoot}\n`);
  process.stdout.write(`  Node.js: ${process.versions.node}\n`);
  process.stdout.write(`  version: ${packageInfo.version}\n`);
  process.stdout.write(`  protocol: ${protocol.protocolVersion}\n`);
  process.stdout.write(`  tools: ${protocol.tools.join(', ')}\n`);
  process.stdout.write(`  resources: ${protocol.resources}; MCP App bytes: ${protocol.appBytes}\n`);
  process.stdout.write(`  bounded protocol: ${protocol.stdoutBytes} stdout bytes; ${protocol.stderrBytes} stderr bytes\n`);
  return { ok: true, ...packageInfo, ...protocol };
}

const isMain = process.argv[1] && resolve(process.argv[1]) === SCRIPT_PATH;
if (isMain) {
  try {
    await runDoctor(parseDoctorArgs(process.argv.slice(2)));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`\u2717 Motif Codex plugin doctor failed: ${message}\n`);
    process.stderr.write('  Run with --help for usage; this doctor never installs or changes the plugin.\n');
    process.exitCode = 1;
  }
}
