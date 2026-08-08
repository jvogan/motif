#!/usr/bin/env node

import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  DEFAULT_CLAUDE_SCIENCE_CONFIG_PATH,
  desiredMotifLocalServer,
  motifLocalServerMatches,
  readLocalMcpConfig,
  resolveNodeBinary,
} from './lib/motif-local-mcp-config.mjs';
import { readTrustedManifestDigest, resolveReleaseBundleRoot, verifyReleaseBundle } from './lib/motif-release-bundle.mjs';
import { isDirectScriptExecution } from './lib/direct-script.mjs';

const defaultBundle = resolveReleaseBundleRoot(fileURLToPath(import.meta.url));

function parseArgs(args) {
  const options = { bundle: defaultBundle, config: DEFAULT_CLAUDE_SCIENCE_CONFIG_PATH, node: null, manifestSha256: null, manifestSha256File: null, skipConfig: false, help: false };
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === '--help' || arg === '-h') options.help = true;
    else if (arg === '--skip-config') options.skipConfig = true;
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

export function doctorRelease(args = process.argv.slice(2), environment = process.env) {
  const options = parseArgs(args);
  if (options.help) return { help: 'node doctor-motif-claude-science-release.mjs [--bundle <directory>] [--manifest-sha256-file <path>] [--config <path>] [--skip-config]\n' };
  if (options.manifestSha256 && options.manifestSha256File) throw new Error('Choose either --manifest-sha256 or --manifest-sha256-file, not both');
  const expectedManifestSha256 = options.manifestSha256File
    ? readTrustedManifestDigest(options.manifestSha256File)
    : options.manifestSha256;
  const verified = verifyReleaseBundle(options.bundle, { expectedManifestSha256 });
  const nodeBinary = resolveNodeBinary({
    environment: options.node ? { ...environment, MOTIF_NODE_BIN: options.node } : environment,
    current: process.execPath,
  });
  const result = { bundle: verified.root, version: verified.manifest.version, runtimeBuildId: verified.manifest.runtimeBuildId, manifestSha256: verified.manifestSha256, externalManifestDigestMatched: verified.externalManifestDigestMatched, nodeBinary };
  if (options.skipConfig) return { ...result, config: 'skipped' };
  const document = readLocalMcpConfig(options.config);
  const desired = desiredMotifLocalServer(verified.root, { nodeBinary });
  const managed = document.config.servers.find(server => server?.name === 'motif-local');
  if (!motifLocalServerMatches(managed, desired)) throw new Error('motif-local is missing or does not point to this verified release bundle');
  return { ...result, config: 'matched' };
}

if (isDirectScriptExecution(process.argv[1], fileURLToPath(import.meta.url))) {
  try {
    const result = doctorRelease();
    if (result.help) process.stdout.write(result.help);
    else process.stdout.write(`Motif bundle integrity verified: v${result.version} (${result.runtimeBuildId.slice(0, 12)}). ${result.externalManifestDigestMatched ? 'External manifest digest matched.' : 'No external manifest digest was supplied.'} ${result.config === 'skipped' ? 'Configuration check skipped.' : 'motif-local registration matches.'}\n`);
  } catch (error) {
    process.stderr.write(`Motif release doctor failed: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}
