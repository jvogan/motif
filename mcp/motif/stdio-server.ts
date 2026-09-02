#!/usr/bin/env node

import { access } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { createMotifClaudeScienceServer } from './server.js';
import { loadMotifRuntimeAssets, readMotifVersion } from './stdio-bootstrap.js';
import { artifactTemplateCandidates, inferredConnectorRoot, trustedConfiguredRoot } from './stdio-paths.js';
import { createMotifStdioServerTransport } from './stdio-transport.js';

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
  throw new Error(`${label} is missing. Rebuild or reinstall the Motif plugin.`);
}

async function main(): Promise<void> {
  const configuredRoot = trustedConfiguredRoot(process.env.MOTIF_ROOT, inferredRoot);
  const traceEnabled = process.env.MOTIF_MCP_TRACE === '1'
    || process.env.MOTIF_MCP_TRACE === 'true';
  const version = await readMotifVersion([
    ...(configuredRoot ? [{ path: resolve(configuredRoot, 'package.json'), label: 'Configured Motif package manifest' }] : []),
    { path: resolve(moduleDirectory, '../.claude-plugin/plugin.json'), label: 'Packaged Motif plugin manifest' },
    { path: resolve(inferredRoot, 'package.json'), label: 'Motif package manifest' },
  ]);
  const workbenchPath = await firstExistingPath([
    ...(configuredRoot ? [resolve(configuredRoot, 'dist-motif/claude-science/motif-mcp-app.html')] : []),
    resolve(moduleDirectory, 'motif-mcp-app.html'),
    resolve(inferredRoot, 'dist-motif/claude-science/motif-mcp-app.html'),
  ], 'Motif MCP App resource');
  const artifactTemplatePath = await firstExistingPath(
    artifactTemplateCandidates(moduleDirectory, configuredRoot, inferredRoot),
    'Motif artifact template',
  );
  const runtimeAssets = await loadMotifRuntimeAssets(workbenchPath, artifactTemplatePath);
  const server = createMotifClaudeScienceServer({
    version,
    runtimeBuildId: runtimeAssets.runtimeBuildId,
    readWorkbenchHtml: async () => runtimeAssets.workbenchHtml,
    readArtifactTemplate: async () => runtimeAssets.artifactTemplateHtml,
    ...(traceEnabled ? {
      trace: event => console.error(`[motif-mcp-trace] ${JSON.stringify(event)}`),
    } : {}),
  });
  await server.connect(createMotifStdioServerTransport());
  console.error(`[motif] v${version} ready on stdio`);
}

main().catch((error: unknown) => {
  console.error('[motif] Fatal error:', error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
