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
const MCP_SERVER_NAME = 'motif';
const MAX_CODEX_OUTPUT_BYTES = 4 * 1024 * 1024;
const SEMVER_PATTERN = /^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/u;
const MARKETPLACE_NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u;

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

function assertMarketplaceName(value, label = 'Marketplace name') {
  if (typeof value !== 'string' || !MARKETPLACE_NAME_PATTERN.test(value)) {
    throw new Error(`${label} is missing or invalid.`);
  }
  return value;
}

function pluginIdentity(candidate) {
  if (!candidate || typeof candidate !== 'object' || candidate.name !== PLUGIN_NAME) return undefined;
  const marketplaceName = assertMarketplaceName(candidate.marketplaceName, 'Installed Motif marketplace name');
  const pluginId = `${PLUGIN_NAME}@${marketplaceName}`;
  if (candidate.pluginId !== pluginId) {
    throw new Error('The installed Motif plugin identity does not match its marketplace name.');
  }
  return { pluginId, marketplaceName };
}

export function parseInstalledPlugin(stdout, options = {}) {
  let listing;
  try {
    listing = JSON.parse(stdout);
  } catch {
    throw new Error('Codex plugin listing was not valid JSON.');
  }
  if (!listing || typeof listing !== 'object' || !Array.isArray(listing.installed)) {
    throw new Error('Codex plugin listing did not contain an installed plugin array.');
  }
  const requestedMarketplaceName = options.marketplaceName === undefined
    ? undefined
    : assertMarketplaceName(options.marketplaceName, 'Requested marketplace name');
  const motifPlugins = [];
  for (const candidate of listing.installed) {
    if (candidate?.name !== PLUGIN_NAME) continue;
    const identity = pluginIdentity(candidate);
    if (!identity) continue;
    if (requestedMarketplaceName === undefined || identity.marketplaceName === requestedMarketplaceName) {
      motifPlugins.push({ candidate, ...identity });
    }
  }
  if (motifPlugins.length === 0) {
    const requestedPluginId = requestedMarketplaceName
      ? `${PLUGIN_NAME}@${requestedMarketplaceName}`
      : PLUGIN_NAME;
    throw new Error(`Motif is not installed in this Codex profile. Install ${requestedPluginId} and start a new thread.`);
  }
  if (motifPlugins.length > 1) {
    throw new Error('More than one Motif plugin is installed. Re-run with --marketplace <name> to select one.');
  }
  const { candidate: plugin, pluginId, marketplaceName } = motifPlugins[0];
  if (plugin.installed !== true || plugin.enabled !== true) {
    throw new Error(`Motif is present but not installed and enabled in this Codex profile: ${pluginId}.`);
  }
  if (typeof plugin.version !== 'string' || !SEMVER_PATTERN.test(plugin.version)) {
    throw new Error('The installed Motif plugin version is missing or invalid.');
  }
  return { ...plugin, pluginId, marketplaceName };
}

export function installedPluginRoot(codexHome, plugin) {
  if (!plugin || typeof plugin !== 'object' || plugin.name !== PLUGIN_NAME) {
    throw new Error('Installed Motif plugin metadata is missing or invalid.');
  }
  const marketplaceName = assertMarketplaceName(plugin.marketplaceName, 'Installed Motif marketplace name');
  if (typeof plugin.version !== 'string' || !SEMVER_PATTERN.test(plugin.version)) {
    throw new Error('Installed Motif plugin version is missing or invalid.');
  }
  const home = resolve(codexHome);
  const cacheRoot = resolve(home, 'plugins', 'cache');
  const pluginRoot = resolve(cacheRoot, marketplaceName, PLUGIN_NAME, plugin.version);
  if (!isWithinRoot(cacheRoot, pluginRoot)) throw new Error('Installed Motif plugin path escapes the Codex plugin cache.');
  return pluginRoot;
}

export async function inspectInstalledCodexPlugin(options = {}) {
  const runCodex = options.runCodex ?? runCodexCommand;
  const codexHome = options.codexHome ?? process.env.CODEX_HOME ?? resolve(homedir(), '.codex');
  const plugin = parseInstalledPlugin(runCodex(['plugin', 'list', '--json']), {
    marketplaceName: options.marketplaceName,
  });
  const mcpState = runCodex(['mcp', 'get', MCP_SERVER_NAME]);
  if (!/^\s*enabled:\s*true\s*$/mu.test(mcpState)) {
    throw new Error('Motif is installed, but its MCP server is not enabled in the active Codex profile.');
  }
  const pluginRoot = installedPluginRoot(codexHome, plugin);
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
    pluginId: plugin.pluginId,
    version: plugin.version,
    pluginRoot,
    tools: inspected.protocol.tools,
    resources: inspected.protocol.resources,
    appBytes: inspected.protocol.appBytes,
  };
}

export function parseInstalledDoctorArgs(args) {
  const options = { marketplaceName: undefined, help: false };
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === '--help' || arg === '-h') {
      options.help = true;
      continue;
    }
    if (arg === '--marketplace') {
      const value = args[index + 1];
      if (!value || value.startsWith('--')) throw new Error('--marketplace requires a value');
      options.marketplaceName = assertMarketplaceName(value, 'Requested marketplace name');
      index += 1;
      continue;
    }
    throw new Error(`Unknown option: ${arg}`);
  }
  return options;
}

function usage() {
  return `Verify the installed Motif Codex plugin without changing it.\n\nUsage:\n  npm run codex:doctor:installed -- [--marketplace <name>]\n\nOptions:\n  --marketplace <name>  Select Motif when more than one marketplace installs it.\n  --help                Show this help.\n`;
}

async function main() {
  const options = parseInstalledDoctorArgs(process.argv.slice(2));
  if (options.help) {
    process.stdout.write(usage());
    return;
  }
  const result = await inspectInstalledCodexPlugin(options);
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
