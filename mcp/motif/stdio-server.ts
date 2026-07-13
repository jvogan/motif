#!/usr/bin/env node

import { access, readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';

import { createMotifClaudeScienceServer } from './server.js';

type PackageManifest = { version?: unknown };

const moduleDirectory = dirname(fileURLToPath(import.meta.url));
const inferredRoot = resolve(moduleDirectory, '../..');
const configuredRoot = process.env.MOTIF_ROOT?.trim()
  ? resolve(process.env.MOTIF_ROOT)
  : undefined;

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

async function readVersion(): Promise<string> {
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
  return '0.2.0';
}

async function main(): Promise<void> {
  const traceEnabled = process.env.MOTIF_MCP_TRACE === '1'
    || process.env.MOTIF_MCP_TRACE === 'true';
  const version = await readVersion();
  const workbenchPath = await firstExistingPath([
    ...(configuredRoot ? [resolve(configuredRoot, 'dist-motif/claude-science/motif-mcp-app.html')] : []),
    resolve(moduleDirectory, 'motif-mcp-app.html'),
    resolve(inferredRoot, 'dist-motif/claude-science/motif-mcp-app.html'),
  ], 'Motif MCP App resource');
  const artifactTemplatePath = await firstExistingPath([
    ...(configuredRoot ? [resolve(configuredRoot, 'dist-motif/motif-template.html')] : []),
    resolve(moduleDirectory, 'motif-template.html'),
    resolve(inferredRoot, 'dist-motif/motif-template.html'),
  ], 'Motif artifact template');
  const server = createMotifClaudeScienceServer({
    version,
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
