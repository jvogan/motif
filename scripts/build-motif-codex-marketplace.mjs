#!/usr/bin/env node

import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { buildMotifCodexPlugin } from './build-motif-codex-plugin.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const pluginName = 'motif-for-claude-science';
const marketplaceName = 'motif-local';

export function motifCodexMarketplaceRoot(rootDirectory = root) {
  return join(rootDirectory, '.motif', 'codex-marketplace');
}

export function motifCodexMarketplaceManifest() {
  return {
    name: marketplaceName,
    interface: {
      displayName: 'Motif Local',
    },
    plugins: [
      {
        name: pluginName,
        source: {
          source: 'local',
          path: `./plugins/${pluginName}`,
        },
        policy: {
          installation: 'AVAILABLE',
          authentication: 'ON_INSTALL',
        },
        category: 'Education & Research',
      },
    ],
  };
}

export function buildMotifCodexMarketplace({
  rootDirectory = root,
  runtimeRootDirectory = rootDirectory,
  marketplaceRoot = motifCodexMarketplaceRoot(rootDirectory),
} = {}) {
  const outputDirectory = join(marketplaceRoot, 'plugins', pluginName);
  const artifactDirectory = dirname(marketplaceRoot);
  const zipPath = join(artifactDirectory, 'motif-for-codex-marketplace.zip');
  const checksumPath = join(artifactDirectory, 'motif-for-codex-marketplace.checksums.json');
  const marketplacePath = join(marketplaceRoot, '.agents', 'plugins', 'marketplace.json');

  rmSync(marketplaceRoot, { recursive: true, force: true });
  const plugin = buildMotifCodexPlugin({
    rootDirectory,
    runtimeRootDirectory,
    outputDirectory,
    zipPath,
    checksumPath,
  });
  mkdirSync(dirname(marketplacePath), { recursive: true });
  writeFileSync(
    marketplacePath,
    `${JSON.stringify(motifCodexMarketplaceManifest(), null, 2)}\n`,
  );

  return {
    ...plugin,
    marketplaceRoot,
    marketplacePath,
    marketplaceName,
  };
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  try {
    const result = buildMotifCodexMarketplace();
    console.log(`Wrote private Codex marketplace ${result.marketplaceRoot}`);
    console.log(`Marketplace name: ${result.marketplaceName}`);
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  }
}
