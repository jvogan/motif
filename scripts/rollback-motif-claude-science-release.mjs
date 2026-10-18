#!/usr/bin/env node

import {
  existsSync,
  readdirSync,
} from 'node:fs';
import { basename, dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  DEFAULT_CLAUDE_SCIENCE_CONFIG_PATH,
  MOTIF_LOCAL_CONNECTOR_NAME,
  readLocalMcpConfig,
  removeMotifLocalServer,
  validateLocalMcpConfig,
  writeLocalMcpConfigAtomically,
} from './lib/motif-local-mcp-config.mjs';
import { readTrustedManifestDigest, resolveReleaseBundleRoot, verifyReleaseBundle } from './lib/motif-release-bundle.mjs';
import { isDirectScriptExecution } from './lib/direct-script.mjs';

const defaultBundle = resolveReleaseBundleRoot(fileURLToPath(import.meta.url));

function parseArgs(args) {
  const options = {
    bundle: defaultBundle,
    config: DEFAULT_CLAUDE_SCIENCE_CONFIG_PATH,
    backup: null,
    manifestSha256: null,
    manifestSha256File: null,
    dryRun: false,
    help: false,
  };
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === '--help' || arg === '-h') options.help = true;
    else if (arg === '--dry-run') options.dryRun = true;
    else if (arg === '--manifest-sha256') {
      const value = args[++index];
      if (!value || value.startsWith('--')) throw new Error(`${arg} requires a SHA-256 value`);
      options.manifestSha256 = value;
    } else if (arg === '--bundle' || arg === '--config' || arg === '--backup' || arg === '--manifest-sha256-file') {
      const value = args[++index];
      if (!value || value.startsWith('--')) throw new Error(`${arg} requires a path`);
      if (arg === '--bundle') options.bundle = resolve(value);
      if (arg === '--config') options.config = resolve(value);
      if (arg === '--backup') options.backup = resolve(value);
      if (arg === '--manifest-sha256-file') options.manifestSha256File = resolve(value);
    } else throw new Error(`Unknown option: ${arg}`);
  }
  return options;
}

function trustedManifestDigest(options) {
  if (options.manifestSha256 && options.manifestSha256File) {
    throw new Error('Choose either --manifest-sha256 or --manifest-sha256-file, not both');
  }
  if (options.manifestSha256File) return readTrustedManifestDigest(options.manifestSha256File);
  if (options.manifestSha256) return options.manifestSha256;
  throw new Error('Rollback requires an externally trusted release-manifest SHA-256');
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

function isMotifEntry(server) {
  return server !== null && typeof server === 'object' && !Array.isArray(server)
    && server.name === MOTIF_LOCAL_CONNECTOR_NAME;
}

/**
 * Build the rolled-back configuration from the current document. Only the
 * Motif entry is taken from the backup: it replaces the current entry in
 * place, is appended when the current document has none, or is removed when
 * the backup has none. Every other server and top-level key stays as it is
 * now, including anything added after the backup was taken.
 */
function rolledBackConfig(current, backup) {
  validateLocalMcpConfig(current);
  validateLocalMcpConfig(backup);
  const backedUp = backup.servers.find(isMotifEntry);
  if (!backedUp) return removeMotifLocalServer(current).config;
  const index = current.servers.findIndex(isMotifEntry);
  const servers = [...current.servers];
  if (index < 0) servers.push(backedUp);
  else servers[index] = backedUp;
  return { ...current, servers };
}

export function rollbackRelease(args = process.argv.slice(2)) {
  const options = parseArgs(args);
  if (options.help) return {
    help: 'node rollback-motif-claude-science-release.mjs --manifest-sha256-file <path> [--bundle <directory>] [--config <path>] [--backup <path>] [--dry-run]\n',
  };
  const verified = verifyReleaseBundle(options.bundle, { expectedManifestSha256: trustedManifestDigest(options) });
  const backupPath = selectBackup(options.config, options.backup);
  const current = readLocalMcpConfig(options.config);
  const backup = readLocalMcpConfig(backupPath);
  if (!backup.originalBytes) throw new Error('Rollback backup is empty');
  const rolledBack = rolledBackConfig(current.config, backup.config);
  if (options.dryRun) {
    return {
      changed: JSON.stringify(current.config) !== JSON.stringify(rolledBack),
      backupPath,
      dryRun: true,
      manifestSha256: verified.manifestSha256,
      externalManifestDigestMatched: verified.externalManifestDigestMatched,
    };
  }
  const result = writeLocalMcpConfigAtomically(options.config, rolledBack, current);
  return {
    changed: true,
    restoredFrom: backupPath,
    backupPath: result.backupPath,
    manifestSha256: verified.manifestSha256,
    externalManifestDigestMatched: verified.externalManifestDigestMatched,
  };
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
