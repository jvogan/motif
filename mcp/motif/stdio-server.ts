#!/usr/bin/env node

import { access, lstat } from 'node:fs/promises';
import { basename, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { createMotifClaudeScienceServer } from './server.js';
import { loadMotifRuntimeAssets, readMotifVersion } from './stdio-bootstrap.js';
import { artifactTemplateCandidates, inferredConnectorRoot, trustedConfiguredRoot } from './stdio-paths.js';
import { createMotifStdioServerTransport, exitWhenTransportFails } from './stdio-transport.js';

const serverPath = fileURLToPath(import.meta.url);
const moduleDirectory = dirname(serverPath);
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
  const [major, minor] = process.versions.node.split('.').map(Number);
  if (!(major >= 24 || (major === 22 && minor >= 13))) {
    console.error('[motif-claude-science] Node.js 22.13 or newer (22.x) or 24 or newer is required.');
    process.exitCode = 1;
    return;
  }

  const configuredRoot = trustedConfiguredRoot(process.env.MOTIF_ROOT, inferredRoot);
  const traceEnabled = process.env.MOTIF_MCP_TRACE === '1'
    || process.env.MOTIF_MCP_TRACE === 'true';
  const version = await readMotifVersion([
    ...(configuredRoot ? [{ path: resolve(configuredRoot, 'package.json'), label: 'Configured Motif package manifest' }] : []),
    { path: resolve(moduleDirectory, '../.claude-plugin/plugin.json'), label: 'Packaged Motif plugin manifest' },
    { path: resolve(moduleDirectory, '../.codex-plugin/plugin.json'), label: 'Packaged Motif Codex manifest' },
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
  const releaseManifest = await lstat(resolve(inferredRoot, 'release-manifest.json')).catch(error => {
    if (error?.code === 'ENOENT') return undefined;
    throw new Error('Motif release manifest could not be read. Reinstall the connector.');
  });
  const runtimeAssets = await loadMotifRuntimeAssets(workbenchPath, artifactTemplatePath, {
    connector: { serverPath, version, requireBinding: basename(moduleDirectory) === 'server' || releaseManifest !== undefined },
  });
  const server = createMotifClaudeScienceServer({
    version,
    runtimeBuildId: runtimeAssets.runtimeBuildId,
    readWorkbenchHtml: async () => runtimeAssets.workbenchHtml,
    readArtifactTemplate: async () => runtimeAssets.artifactTemplateHtml,
    ...(traceEnabled ? {
      trace: event => console.error(`[motif-mcp-trace] ${JSON.stringify(event)}`),
    } : {}),
  });
  // Surface protocol-level failures (for example oversized or malformed
  // frames) on stderr instead of dropping them silently. Only a bounded,
  // sanitized message is logged; frame content is never included.
  server.server.onerror = (error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    // eslint-disable-next-line no-control-regex
    const bounded = message.replace(/[\u0000-\u001f\u007f-\u009f]+/gu, ' ').trim().slice(0, 256);
    console.error(`[motif] protocol error: ${bounded}`);
  };
  const transport = createMotifStdioServerTransport();
  exitWhenTransportFails(transport);
  await server.connect(transport);
  console.error(`[motif] v${version} ready on stdio`);
}

main().catch((error: unknown) => {
  console.error('[motif] Fatal error:', error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
