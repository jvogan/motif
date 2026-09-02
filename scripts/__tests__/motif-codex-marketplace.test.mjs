import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  buildMotifCodexMarketplace,
  motifCodexMarketplaceRoot,
  motifCodexMarketplaceManifest,
} from '../build-motif-codex-marketplace.mjs';

const root = resolve(import.meta.dirname, '..', '..');
const temporaryRoots = [];

afterEach(() => {
  for (const directory of temporaryRoots.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe('Motif private Codex marketplace', () => {
  it('keeps the registered marketplace outside the replaceable build directory', () => {
    expect(motifCodexMarketplaceRoot(root)).toBe(join(root, '.motif', 'codex-marketplace'));
    expect(motifCodexMarketplaceRoot(root)).not.toContain(`${join(root, 'dist-motif')}/`);
  });

  it('uses the reviewed local marketplace shape and a contained plugin path', () => {
    expect(motifCodexMarketplaceManifest()).toEqual({
      name: 'motif-local',
      interface: { displayName: 'Motif Local' },
      plugins: [
        {
          name: 'motif-for-claude-science',
          source: {
            source: 'local',
            path: './plugins/motif-for-claude-science',
          },
          policy: {
            installation: 'AVAILABLE',
            authentication: 'ON_INSTALL',
          },
          category: 'Science',
        },
      ],
    });
  });

  it('stages a self-contained marketplace without changing Codex configuration', () => {
    const temporaryRoot = mkdtempSync(join(tmpdir(), 'motif-codex-marketplace-'));
    temporaryRoots.push(temporaryRoot);
    const marketplaceRoot = join(temporaryRoot, 'marketplace');
    const runtimeRootDirectory = join(temporaryRoot, 'runtime');
    const runtimeFixtures = [
      ['dist-motif/claude-science/motif-mcp-server.mjs', 'fixture server'],
      ['dist-motif/claude-science/motif-mcp-app.html', '<!doctype html><title>Fixture App</title>'],
      ['dist-motif/motif-template.html', '<!doctype html><title>Fixture Template</title>'],
    ];
    for (const [relativePath, contents] of runtimeFixtures) {
      const path = join(runtimeRootDirectory, relativePath);
      mkdirSync(resolve(path, '..'), { recursive: true });
      writeFileSync(path, contents);
    }
    const result = buildMotifCodexMarketplace({
      rootDirectory: root,
      runtimeRootDirectory,
      marketplaceRoot,
    });

    const manifest = JSON.parse(readFileSync(result.marketplacePath, 'utf8'));
    const pluginPath = join(marketplaceRoot, manifest.plugins[0].source.path);
    expect(manifest).toEqual(motifCodexMarketplaceManifest());
    expect(existsSync(join(pluginPath, '.codex-plugin', 'plugin.json'))).toBe(true);
    expect(existsSync(join(pluginPath, '.mcp.json'))).toBe(true);
    expect(existsSync(join(pluginPath, 'server', 'motif-mcp-server.mjs'))).toBe(true);
    expect(existsSync(join(pluginPath, 'server', 'motif-mcp-app.html'))).toBe(true);
    expect(existsSync(join(pluginPath, 'server', 'motif-template.html'))).toBe(true);
    expect(readFileSync(join(pluginPath, 'server', 'motif-mcp-server.mjs'), 'utf8')).toBe('fixture server');
  });
});
