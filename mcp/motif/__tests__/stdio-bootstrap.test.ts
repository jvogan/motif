import { mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import {
  loadMotifRuntimeAssets,
  MOTIF_CHECKOUT_REPAIR,
  MOTIF_PACKAGED_REPAIR,
  readMotifVersion,
} from '../stdio-bootstrap.js';

const temporaryDirectories: string[] = [];
const runtimeBuildId = 'b'.repeat(64);
const meta = `<meta name="motif-build-id" content="${runtimeBuildId}">`;
const artifactTag = '<script type="application/json" id="motif-artifact-data">{}</script>';
const end = '</body></html>';
const templateHtml = meta + artifactTag + end;
const appHtml = meta + artifactTag + '<script data-motif-mcp-app-bridge>void 0;</script>' + end;

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
    const workbenchHtml = appHtml;
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

  it('requires the exact template, bridge, server and plugin version from the staged build', async () => {
    const dir = await temporaryDirectory();
    const appPath = join(dir, 'app.html');
    const templatePath = join(dir, 'template.html');
    const serverPath = join(dir, 'server.mjs');
    const version = '1.0.0';
    const server = 'export {};';
    const id = createHash('sha256').update(version).update('\0').update(server).update('\0').update(appHtml).digest('hex');
    const stamp = `<meta name="motif-connector-binding" content="${id}">\n`;
    const options = { connector: { serverPath, version, requireBinding: true } };
    await Promise.all([
      writeFile(appPath, stamp + appHtml),
      writeFile(templatePath, templateHtml),
      writeFile(serverPath, server),
    ]);
    await expect(loadMotifRuntimeAssets(appPath, templatePath, options)).resolves.toMatchObject({ runtimeBuildId });
    await writeFile(serverPath, server + '\n');
    await expect(loadMotifRuntimeAssets(appPath, templatePath, options)).rejects.toThrow(
      `Motif server, App, or release version is from a different build. ${MOTIF_PACKAGED_REPAIR}`,
    );
    await writeFile(serverPath, server);
    await expect(loadMotifRuntimeAssets(appPath, templatePath, {
      connector: { ...options.connector, version: '1.0.1' },
    })).rejects.toThrow(/different build/u);
    // A checkout whose version changed after its last build names the build command.
    await expect(loadMotifRuntimeAssets(appPath, templatePath, {
      connector: { ...options.connector, version: '1.0.1', requireBinding: false },
    })).rejects.toThrow(
      'Motif server, App, or release version is from a different build. Run `npm run build:motif` in the Motif checkout, then reconnect the connector.',
    );
    expect(MOTIF_CHECKOUT_REPAIR).toContain('npm run build:motif');
    await writeFile(appPath, stamp + appHtml.replace('void 0;', 'void 1;'));
    await expect(loadMotifRuntimeAssets(appPath, templatePath, options)).rejects.toThrow(/different build/u);
    await writeFile(appPath, stamp + templateHtml);
    await expect(loadMotifRuntimeAssets(appPath, templatePath, options)).rejects.toThrow(/bridge.*does not match/u);
  });

  it('rejects symlinked runtime files and oversized version manifests', async () => {
    const dir = await temporaryDirectory();
    const appPath = join(dir, 'app.html');
    const templatePath = join(dir, 'template.html');
    const original = join(dir, 'original.html');
    const manifest = join(dir, 'package.json');
    await writeFile(original, appHtml);
    await symlink(original, appPath);
    await writeFile(templatePath, templateHtml);
    await expect(loadMotifRuntimeAssets(appPath, templatePath)).rejects.toThrow(/resource could not be read/u);
    await writeFile(manifest, '{"version":"1.0.0"}' + ' '.repeat(128 * 1024));
    await expect(readMotifVersion([{ path: manifest, label: 'Manifest' }])).rejects.toThrow(/no larger than/u);
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
