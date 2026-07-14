#!/usr/bin/env node

import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  DEFAULT_CLAUDE_SCIENCE_CONFIG_PATH,
  MOTIF_LOCAL_CONNECTOR_NAME,
  describeMotifLocalMismatch,
  desiredMotifLocalServer,
  motifLocalServerMatches,
  preflightConnectorFiles,
  readLocalMcpConfig,
  updateLocalMcpConfigFile,
} from './lib/motif-local-mcp-config.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

function usage() {
  return `Register the local Motif connector with Claude Science.

Usage:
  node scripts/configure-motif-claude-science-local.mjs [options]

Options:
  --check           Verify the build and existing registration without writing.
  --remove          Remove only the managed motif-local registration.
  --dry-run         Validate and report the requested change without writing.
  --config <path>   Use an alternate local-mcp.json path (primarily for testing).
  --help            Show this help.

The installer preserves every unrelated server and unknown top-level setting.
Before a changed config is installed or removed, it writes a mode-0600 backup
beside the original and replaces the JSON atomically.
`;
}

export function parseConfigureArgs(args) {
  const options = {
    mode: 'install',
    dryRun: false,
    configPath: DEFAULT_CLAUDE_SCIENCE_CONFIG_PATH,
    help: false,
  };
  let selectedMode = null;
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === '--help' || arg === '-h') {
      options.help = true;
      continue;
    }
    if (arg === '--dry-run') {
      options.dryRun = true;
      continue;
    }
    if (arg === '--check' || arg === '--remove') {
      if (selectedMode) throw new Error(`${arg} cannot be combined with ${selectedMode}`);
      selectedMode = arg;
      options.mode = arg === '--check' ? 'check' : 'remove';
      continue;
    }
    if (arg === '--config') {
      const value = args[index + 1];
      if (!value || value.startsWith('--')) throw new Error('--config requires a path');
      options.configPath = resolve(value);
      index += 1;
      continue;
    }
    throw new Error(`Unknown option: ${arg}`);
  }
  if (options.mode === 'check' && options.dryRun) {
    throw new Error('--dry-run is not meaningful with --check');
  }
  return options;
}

function printClaudeScienceNextSteps() {
  process.stdout.write(`  Motif checkout: ${root}\n`);
  process.stdout.write('  Next:\n');
  process.stdout.write('    1. In Claude Science, grant this exact folder under Customize -> Permissions.\n');
  process.stdout.write('    2. Fully quit Claude Science with Cmd-Q, then reopen it.\n');
  process.stdout.write('    3. Open Customize -> Connectors -> motif-local and press Reconnect.\n');
}

export function runConfigure(options) {
  if (options.help) {
    process.stdout.write(usage());
    return { ok: true, changed: false };
  }

  const desired = options.mode === 'remove' ? undefined : desiredMotifLocalServer(root);
  if (options.mode !== 'remove') preflightConnectorFiles(root, { requireBuild: true });

  if (options.mode === 'check') {
    const document = readLocalMcpConfig(options.configPath);
    const existing = document.config.servers.find(server => server?.name === MOTIF_LOCAL_CONNECTOR_NAME);
    if (!motifLocalServerMatches(existing, desired)) {
      const fields = describeMotifLocalMismatch(existing, desired);
      process.stderr.write(`\u2717 ${MOTIF_LOCAL_CONNECTOR_NAME} registration needs attention\n`);
      process.stderr.write(`  mismatched managed fields: ${fields.join(', ')}\n`);
      return { ok: false, changed: false, fields };
    }
    process.stdout.write(`\u2713 ${MOTIF_LOCAL_CONNECTOR_NAME} build and registration are ready\n`);
    return { ok: true, changed: false };
  }

  const result = updateLocalMcpConfigFile({
    configPath: options.configPath,
    desired,
    mode: options.mode,
    dryRun: options.dryRun,
  });
  const action = options.mode === 'remove' ? 'removal' : 'registration';
  if (!result.changed) {
    process.stdout.write(`\u2713 ${MOTIF_LOCAL_CONNECTOR_NAME} ${action} is already up to date\n`);
    if (options.mode === 'install') printClaudeScienceNextSteps();
    return { ok: true, ...result };
  }
  if (options.dryRun) {
    process.stdout.write(`\u2713 ${MOTIF_LOCAL_CONNECTOR_NAME} ${action} passed dry-run validation; no files changed\n`);
    return { ok: true, ...result };
  }
  process.stdout.write(`\u2713 ${MOTIF_LOCAL_CONNECTOR_NAME} ${action} written atomically\n`);
  if (result.backupPath) process.stdout.write('  previous config backed up with private file permissions\n');
  if (options.mode === 'install') printClaudeScienceNextSteps();
  return { ok: true, ...result };
}

const isMain = process.argv[1]
  && existsSync(process.argv[1])
  && resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isMain) {
  try {
    const result = runConfigure(parseConfigureArgs(process.argv.slice(2)));
    if (!result.ok) process.exitCode = 1;
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown configuration error';
    process.stderr.write(`\u2717 Motif local connector was not changed: ${message}\n`);
    process.exitCode = 1;
  }
}
