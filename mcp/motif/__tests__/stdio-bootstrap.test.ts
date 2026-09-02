import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import {
  loadMotifRuntimeAssets,
  readMotifVersion,
} from '../stdio-bootstrap.js';

const temporaryDirectories: string[] = [];
const runtimeBuildId = 'b'.repeat(64);

async function temporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'motif-mcp-bootstrap-'));
  temporaryDirectories.push(directory);
  return directory;
}

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map(directory => rm(directory, { recursive: true, force: true })));
});

describe('Motif MCP stdio bootstrap', () => {
  it('loads, verifies, and returns immutable startup asset bytes', async () => {
    const directory = await temporaryDirectory();
    const workbenchPath = join(directory, 'app.html');
    const templatePath = join(directory, 'template.html');
    const workbenchHtml = `<meta name="motif-build-id" content="${runtimeBuildId}"><main>app</main>`;
    const templateHtml = `<meta name="motif-build-id" content="${runtimeBuildId}"><script type="application/json" id="motif-artifact-data">{}</script>`;
    await writeFile(workbenchPath, workbenchHtml, 'utf8');
    await writeFile(templatePath, templateHtml, 'utf8');

    const assets = await loadMotifRuntimeAssets(workbenchPath, templatePath);
    await writeFile(workbenchPath, 'changed after startup', 'utf8');
    await writeFile(templatePath, 'changed after startup', 'utf8');

    expect(assets).toEqual({ workbenchHtml, artifactTemplateHtml: templateHtml, runtimeBuildId });
  });

  it('rejects mismatched identities, missing data tags, and oversized assets', async () => {
    const directory = await temporaryDirectory();
    const workbenchPath = join(directory, 'app.html');
    const templatePath = join(directory, 'template.html');
    await writeFile(workbenchPath, `<meta name="motif-build-id" content="${runtimeBuildId}">`, 'utf8');
    await writeFile(templatePath, `<meta name="motif-build-id" content="${'c'.repeat(64)}"><script type="application/json" id="motif-artifact-data">{}</script>`, 'utf8');
    await expect(loadMotifRuntimeAssets(workbenchPath, templatePath)).rejects.toThrow(/inconsistent build identities/u);

    await writeFile(templatePath, `<meta name="motif-build-id" content="${runtimeBuildId}">`, 'utf8');
    await expect(loadMotifRuntimeAssets(workbenchPath, templatePath)).rejects.toThrow(/missing its embedded data tag/u);

    await writeFile(templatePath, `<meta name="motif-build-id" content="${runtimeBuildId}"><script type="application/json" id="motif-artifact-data">{}</script>`, 'utf8');
    await expect(loadMotifRuntimeAssets(workbenchPath, templatePath, { maxBytes: 32 })).rejects.toThrow(/no larger than 32 bytes/u);
  });

  it('fails closed on a malformed existing version manifest', async () => {
    const directory = await temporaryDirectory();
    const missingPath = join(directory, 'missing.json');
    const malformedPath = join(directory, 'malformed.json');
    const laterValidPath = join(directory, 'valid.json');
    await writeFile(malformedPath, '{"version":', 'utf8');
    await writeFile(laterValidPath, '{"version":"9.9.9"}', 'utf8');

    await expect(readMotifVersion([
      { path: missingPath, label: 'Missing manifest' },
      { path: malformedPath, label: 'Existing manifest' },
      { path: laterValidPath, label: 'Later manifest' },
    ])).rejects.toThrow('Existing manifest is malformed JSON.');
  });

  it('uses the first valid existing manifest and a validated fallback only when all are absent', async () => {
    const directory = await temporaryDirectory();
    const manifestPath = join(directory, 'manifest.json');
    await writeFile(manifestPath, '{"version":"1.2.3-beta.1+build.4"}', 'utf8');
    await expect(readMotifVersion([{ path: manifestPath, label: 'Manifest' }])).resolves.toBe('1.2.3-beta.1+build.4');
    await expect(readMotifVersion([{ path: join(directory, 'absent.json'), label: 'Absent' }], '0.3.6')).resolves.toBe('0.3.6');
    await expect(readMotifVersion([], 'not-semver')).rejects.toThrow(/fallback version/u);
  });
});
