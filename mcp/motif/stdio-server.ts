#!/usr/bin/env node

import { access, readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';

import { createMotifClaudeScienceServer } from './server.js';
import { artifactTemplateCandidates, inferredConnectorRoot, trustedConfiguredRoot } from './stdio-paths.js';

type PackageManifest = { version?: unknown };

const moduleDirectory = dirname(fileURLToPath(import.meta.url));
const inferredRoot = inferredConnectorRoot(moduleDirectory);

async function firstExistingPath(candidates: string[], label: string): Promise<string> {
  for (const candidate of candidates) {
    try {
      await access(candidate);
      return candidate;
    } catch {
      // Try the next supported development or packaged layout.
    }
  }
  throw new Error(`${label} is missing. Rebuild or reinstall the Motif for Claude Science plugin.`);
}

async function readVersion(configuredRoot: string | undefined): Promise<string> {
  const candidates = [
    ...(configuredRoot ? [resolve(configuredRoot, 'package.json')] : []),
    resolve(moduleDirectory, '../.claude-plugin/plugin.json'),
    resolve(inferredRoot, 'package.json'),
  ];
  for (const candidate of candidates) {
    try {
      const manifest = JSON.parse(await readFile(candidate, 'utf8')) as PackageManifest;
      if (typeof manifest.version === 'string' && manifest.version.trim()) return manifest.version;
    } catch {
      // Fall through to the next supported manifest location.
    }
  }
  return '0.3.6';
}

async function readRuntimeBuildId(workbenchPath: string): Promise<string> {
  const html = await readFile(workbenchPath, 'utf8');
  const runtimeBuildId = html.match(/<meta name="motif-build-id" content="([a-f0-9]{64})"\s*\/?>/u)?.[1];
  if (!runtimeBuildId) {
    throw new Error('Motif MCP App build identity is missing. Rebuild or reinstall the connector.');
  }
  return runtimeBuildId;
}

async function main(): Promise<void> {
  const configuredRoot = trustedConfiguredRoot(process.env.MOTIF_ROOT, inferredRoot);
  const traceEnabled = process.env.MOTIF_MCP_TRACE === '1'
    || process.env.MOTIF_MCP_TRACE === 'true';
  const version = await readVersion(configuredRoot);
  const workbenchPath = await firstExistingPath([
    ...(configuredRoot ? [resolve(configuredRoot, 'dist-motif/claude-science/motif-mcp-app.html')] : []),
    resolve(moduleDirectory, 'motif-mcp-app.html'),
    resolve(inferredRoot, 'dist-motif/claude-science/motif-mcp-app.html'),
  ], 'Motif MCP App resource');
  const artifactTemplatePath = await firstExistingPath(
    artifactTemplateCandidates(moduleDirectory, configuredRoot, inferredRoot),
    'Motif artifact template',
  );
  const runtimeBuildId = await readRuntimeBuildId(workbenchPath);
  const server = createMotifClaudeScienceServer({
    version,
    runtimeBuildId,
    readWorkbenchHtml: () => readFile(workbenchPath, 'utf8'),
    readArtifactTemplate: () => readFile(artifactTemplatePath, 'utf8'),
    ...(traceEnabled ? {
      trace: event => console.error(`[motif-mcp-trace] ${JSON.stringify(event)}`),
    } : {}),
  });
  await server.connect(new StdioServerTransport());
  console.error(`[motif-claude-science] v${version} ready on stdio`);
}

main().catch((error: unknown) => {
  console.error('[motif-claude-science] Fatal error:', error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
