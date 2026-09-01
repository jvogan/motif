#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import { homedir } from 'node:os';
import { isAbsolute, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  inspectProtocol,
  inspectStagedPlugin,
} from './doctor-motif-codex-plugin.mjs';

const SCRIPT_PATH = fileURLToPath(import.meta.url);
const PLUGIN_NAME = 'motif-for-claude-science';
const MARKETPLACE_NAME = 'motif-local';
const PLUGIN_ID = `${PLUGIN_NAME}@${MARKETPLACE_NAME}`;
const MCP_SERVER_NAME = 'motif';
const MAX_CODEX_OUTPUT_BYTES = 4 * 1024 * 1024;
const SEMVER_PATTERN = /^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/u;

function isWithinRoot(root, candidate) {
  const pathFromRoot = relative(root, candidate);
  return pathFromRoot === ''
    || (!pathFromRoot.startsWith(`..${sep}`) && pathFromRoot !== '..' && !isAbsolute(pathFromRoot));
}

function boundedDiagnostic(value) {
  return String(value ?? '')
    .replace(/[\u0000-\u001f\u007f-\u009f]+/gu, ' ')
    .replace(/\s+/gu, ' ')
    .trim()
    .slice(0, 512);
}

export function runCodexCommand(args, options = {}) {
  const executable = options.executable ?? 'codex';
  const result = spawnSync(executable, args, {
    encoding: 'utf8',
    shell: false,
    maxBuffer: MAX_CODEX_OUTPUT_BYTES,
  });
  if (result.error || result.status !== 0) {
    const detail = boundedDiagnostic(result.stderr || result.error?.message);
    throw new Error(`Codex command failed: codex ${args.join(' ')}${detail ? ` (${detail})` : ''}`);
  }
  return result.stdout ?? '';
}

export function parseInstalledPlugin(stdout) {
  let listing;
  try {
    listing = JSON.parse(stdout);
  } catch {
    throw new Error('Codex plugin listing was not valid JSON.');
  }
  if (!listing || typeof listing !== 'object' || !Array.isArray(listing.installed)) {
    throw new Error('Codex plugin listing did not contain an installed plugin array.');
  }
  const plugin = listing.installed.find(candidate => candidate?.pluginId === PLUGIN_ID);
  if (!plugin) {
    throw new Error(`Motif is not installed in this Codex profile. Install ${PLUGIN_ID} and start a new thread.`);
  }
  if (plugin.installed !== true || plugin.enabled !== true) {
    throw new Error(`Motif is present but not installed and enabled in this Codex profile: ${PLUGIN_ID}.`);
  }
  if (plugin.name !== PLUGIN_NAME || plugin.marketplaceName !== MARKETPLACE_NAME) {
    throw new Error('The installed Motif plugin identity does not match the private marketplace.');
  }
  if (typeof plugin.version !== 'string' || !SEMVER_PATTERN.test(plugin.version)) {
    throw new Error('The installed Motif plugin version is missing or invalid.');
  }
  return plugin;
}

export function installedPluginRoot(codexHome, version) {
  const home = resolve(codexHome);
  const pluginRoot = resolve(home, 'plugins', 'cache', MARKETPLACE_NAME, PLUGIN_NAME, version);
  if (!isWithinRoot(home, pluginRoot)) throw new Error('Installed Motif plugin path escapes CODEX_HOME.');
  return pluginRoot;
}

export async function inspectInstalledCodexPlugin(options = {}) {
  const runCodex = options.runCodex ?? runCodexCommand;
  const codexHome = options.codexHome ?? process.env.CODEX_HOME ?? resolve(homedir(), '.codex');
  const plugin = parseInstalledPlugin(runCodex(['plugin', 'list', '--json']));
  const mcpState = runCodex(['mcp', 'get', MCP_SERVER_NAME]);
  if (!/^\s*enabled:\s*true\s*$/mu.test(mcpState)) {
    throw new Error('Motif is installed, but its MCP server is not enabled in the active Codex profile.');
  }
  const pluginRoot = installedPluginRoot(codexHome, plugin.version);
  const inspectPackage = options.inspectPackage ?? (async root => {
    const packageInfo = await inspectStagedPlugin(root);
    const protocol = await inspectProtocol(packageInfo, { timeoutMs: 10_000 });
    return { packageInfo, protocol };
  });
  const inspected = await inspectPackage(pluginRoot);
  if (inspected.packageInfo.version !== plugin.version) {
    throw new Error('Codex plugin metadata and the installed Motif package version do not match.');
  }
  return {
    pluginId: PLUGIN_ID,
    version: plugin.version,
    pluginRoot,
    tools: inspected.protocol.tools,
    resources: inspected.protocol.resources,
    appBytes: inspected.protocol.appBytes,
  };
}

async function main() {
  const result = await inspectInstalledCodexPlugin();
  process.stdout.write('\u2713 Installed Motif Codex plugin doctor passed\n');
  process.stdout.write(`  plugin: ${result.pluginId}\n`);
  process.stdout.write(`  version: ${result.version}\n`);
  process.stdout.write(`  cache: ${result.pluginRoot}\n`);
  process.stdout.write(`  tools: ${result.tools.join(', ')}\n`);
  process.stdout.write(`  resources: ${result.resources}; MCP App bytes: ${result.appBytes}\n`);
  process.stdout.write('  Start a new Codex thread after any install or upgrade.\n');
}

if (process.argv[1] && resolve(process.argv[1]) === SCRIPT_PATH) {
  main().catch(error => {
    process.stderr.write(`\u2717 Installed Motif Codex plugin doctor failed: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
