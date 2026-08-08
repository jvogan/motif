#!/usr/bin/env node

import {
  existsSync,
  readdirSync,
} from 'node:fs';
import { basename, dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  DEFAULT_CLAUDE_SCIENCE_CONFIG_PATH,
  readLocalMcpConfig,
  writeLocalMcpConfigAtomically,
} from './lib/motif-local-mcp-config.mjs';
import { resolveReleaseBundleRoot, verifyReleaseBundle } from './lib/motif-release-bundle.mjs';
import { isDirectScriptExecution } from './lib/direct-script.mjs';

const defaultBundle = resolveReleaseBundleRoot(fileURLToPath(import.meta.url));

function parseArgs(args) {
  const options = { bundle: defaultBundle, config: DEFAULT_CLAUDE_SCIENCE_CONFIG_PATH, backup: null, dryRun: false, help: false };
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === '--help' || arg === '-h') options.help = true;
    else if (arg === '--dry-run') options.dryRun = true;
    else if (arg === '--bundle' || arg === '--config' || arg === '--backup') {
      const value = args[++index];
      if (!value || value.startsWith('--')) throw new Error(`${arg} requires a path`);
      if (arg === '--bundle') options.bundle = resolve(value);
      if (arg === '--config') options.config = resolve(value);
      if (arg === '--backup') options.backup = resolve(value);
    } else throw new Error(`Unknown option: ${arg}`);
  }
  return options;
}

function selectBackup(configPath, requested) {
  const directory = dirname(configPath);
  const prefix = `${basename(configPath)}.before-motif-local-`;
  if (requested) {
    if (!isAbsolute(requested) || dirname(requested) !== directory || !basename(requested).startsWith(prefix)) throw new Error('Rollback backup must be a sibling Motif private backup');
    if (!existsSync(requested)) throw new Error('Requested rollback backup does not exist');
    return requested;
  }
  const backups = readdirSync(directory, { withFileTypes: true })
    .filter(entry => entry.isFile() && entry.name.startsWith(prefix))
    .map(entry => join(directory, entry.name))
    .sort();
  const backup = backups.at(-1);
  if (!backup) throw new Error('No Motif private configuration backup is available for rollback');
  return backup;
}

export function rollbackRelease(args = process.argv.slice(2)) {
  const options = parseArgs(args);
  if (options.help) return { help: 'node rollback-motif-claude-science-release.mjs [--bundle <directory>] [--config <path>] [--backup <path>] [--dry-run]\n' };
  verifyReleaseBundle(options.bundle);
  const backupPath = selectBackup(options.config, options.backup);
  const current = readLocalMcpConfig(options.config);
  const backup = readLocalMcpConfig(backupPath);
  if (!backup.originalBytes) throw new Error('Rollback backup is empty');
  if (options.dryRun) return { changed: !current.originalBytes || !current.originalBytes.equals(backup.originalBytes), backupPath, dryRun: true };
  const result = writeLocalMcpConfigAtomically(options.config, backup.config, current);
  return { changed: true, restoredFrom: backupPath, backupPath: result.backupPath };
}

if (isDirectScriptExecution(process.argv[1], fileURLToPath(import.meta.url))) {
  try {
    const result = rollbackRelease();
    if (result.help) process.stdout.write(result.help);
    else process.stdout.write(result.dryRun ? `Rollback candidate: ${result.backupPath}\n` : `Restored Claude Science configuration from ${result.restoredFrom}. Current state backed up at ${result.backupPath ?? 'none'}.\n`);
  } catch (error) {
    process.stderr.write(`Motif release rollback failed: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}
