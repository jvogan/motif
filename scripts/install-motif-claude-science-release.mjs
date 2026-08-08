#!/usr/bin/env node

import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  DEFAULT_CLAUDE_SCIENCE_CONFIG_PATH,
  desiredMotifLocalServer,
  resolveNodeBinary,
  updateLocalMcpConfigFile,
} from './lib/motif-local-mcp-config.mjs';
import { readTrustedManifestDigest, resolveReleaseBundleRoot, verifyReleaseBundle } from './lib/motif-release-bundle.mjs';
import { isDirectScriptExecution } from './lib/direct-script.mjs';

const defaultBundle = resolveReleaseBundleRoot(fileURLToPath(import.meta.url));

function parseArgs(args) {
  const options = { bundle: defaultBundle, config: DEFAULT_CLAUDE_SCIENCE_CONFIG_PATH, node: null, manifestSha256: null, manifestSha256File: null, dryRun: false, help: false };
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === '--help' || arg === '-h') options.help = true;
    else if (arg === '--dry-run') options.dryRun = true;
    else if (arg === '--manifest-sha256') {
      const value = args[++index];
      if (!value || value.startsWith('--')) throw new Error(`${arg} requires a SHA-256 value`);
      options.manifestSha256 = value;
    } else if (arg === '--bundle' || arg === '--config' || arg === '--node' || arg === '--manifest-sha256-file') {
      const value = args[++index];
      if (!value || value.startsWith('--')) throw new Error(`${arg} requires a path`);
      if (arg === '--bundle') options.bundle = resolve(value);
      if (arg === '--config') options.config = resolve(value);
      if (arg === '--node') options.node = resolve(value);
      if (arg === '--manifest-sha256-file') options.manifestSha256File = resolve(value);
    } else throw new Error(`Unknown option: ${arg}`);
  }
  return options;
}

function usage() {
  return `Install the checksum-verified Motif connector from this extracted release bundle.

Usage:
  node install-motif-claude-science-release.mjs --manifest-sha256-file <path> [--config <path>] [--node <path>]
  node install-motif-claude-science-release.mjs --bundle <directory> --manifest-sha256 <digest> [--dry-run]
`;
}

function trustedManifestDigest(options) {
  if (options.manifestSha256 && options.manifestSha256File) {
    throw new Error('Choose either --manifest-sha256 or --manifest-sha256-file, not both');
  }
  if (options.manifestSha256File) return readTrustedManifestDigest(options.manifestSha256File);
  if (options.manifestSha256) return options.manifestSha256;
  throw new Error('Installation requires an externally trusted release-manifest SHA-256');
}

export function installRelease(args = process.argv.slice(2), environment = process.env) {
  const options = parseArgs(args);
  if (options.help) return { help: usage() };
  const verified = verifyReleaseBundle(options.bundle, { expectedManifestSha256: trustedManifestDigest(options) });
  const nodeBinary = resolveNodeBinary({
    environment: options.node ? { ...environment, MOTIF_NODE_BIN: options.node } : environment,
    current: process.execPath,
  });
  const desired = desiredMotifLocalServer(verified.root, { nodeBinary });
  const result = updateLocalMcpConfigFile({
    configPath: options.config,
    desired,
    dryRun: options.dryRun,
  });
  return {
    ...result,
    dryRun: options.dryRun,
    bundle: verified.root,
    version: verified.manifest.version,
    runtimeBuildId: verified.manifest.runtimeBuildId,
    manifestSha256: verified.manifestSha256,
    externalManifestDigestMatched: verified.externalManifestDigestMatched,
    nodeBinary,
  };
}

export function formatInstallResult(result) {
  const lines = [`Motif ${result.version} external manifest digest matched; bundle integrity verified.`];
  if (result.dryRun) {
    lines.push(result.changed
      ? 'Dry run: motif-local would be registered; Claude Science configuration was not changed.'
      : 'Dry run: motif-local already matches this release; Claude Science configuration was not changed.');
  } else {
    lines.push(result.changed
      ? `Registered motif-local. Private backup: ${result.backupPath ?? 'none'}`
      : 'motif-local is already registered for this release.');
  }
  lines.push('Run the bundled doctor after reconnecting Claude Science.');
  return `${lines.join('\n')}\n`;
}

if (isDirectScriptExecution(process.argv[1], fileURLToPath(import.meta.url))) {
  try {
    const result = installRelease();
    if (result.help) process.stdout.write(result.help);
    else process.stdout.write(formatInstallResult(result));
  } catch (error) {
    process.stderr.write(`Motif release install failed: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}
