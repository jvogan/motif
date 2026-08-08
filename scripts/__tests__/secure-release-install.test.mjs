import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { doctorRelease } from '../doctor-motif-claude-science-release.mjs';
import { formatInstallResult, installRelease } from '../install-motif-claude-science-release.mjs';
import {
  RELEASE_MAX_BUNDLE_FILES,
  RELEASE_MAX_BUNDLE_ENTRIES,
  RELEASE_MAX_DIRECTORY_DEPTH,
  RELEASE_MAX_DIRECTORY_NODES,
  resolveReleaseBundleRoot,
  verifyReleaseBundle,
} from '../lib/motif-release-bundle.mjs';
import { isDirectScriptExecution } from '../lib/direct-script.mjs';
import { compareConnectorInventory, checkLockfilePolicy } from '../lib/supply-chain-policy.mjs';
import { MAX_LOCAL_MCP_CONFIG_BYTES } from '../lib/motif-local-mcp-config.mjs';
import { rollbackRelease } from '../rollback-motif-claude-science-release.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const temporaryDirectories = [];
const runtimeBuildId = 'a'.repeat(64);

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function writeFixture({ wrongProduct = false, unsafePath = false } = {}) {
  const directory = mkdtempSync(join(tmpdir(), 'motif-release-test-'));
  temporaryDirectories.push(directory);
  const files = {
    'package.json': JSON.stringify({ name: 'motif-for-claude-science', version: '0.3.0' }) + '\n',
    'dist-motif/claude-science/motif-mcp-server.mjs': 'motif-claude-science motif_open_workbench motif_create_workbench_artifact\n',
    'dist-motif/claude-science/motif-mcp-app.html': `${wrongProduct ? 'Other product' : 'Motif for Claude Science'} motif.mcp.workbench.v1 content="${runtimeBuildId}"\n`,
    'dist-motif/motif-template.html': `Motif for Claude Science content="${runtimeBuildId}"\n`,
    'scripts/run-motif-claude-science-mcp.sh': '#!/usr/bin/env bash\n# motif-claude-science\nMOTIF_ROOT\n',
    'installer.mjs': 'no dependencies\n',
    'install-motif-claude-science-release.mjs': readFileSync(join(root, 'scripts', 'install-motif-claude-science-release.mjs'), 'utf8'),
    'doctor-motif-claude-science-release.mjs': readFileSync(join(root, 'scripts', 'doctor-motif-claude-science-release.mjs'), 'utf8'),
    'rollback-motif-claude-science-release.mjs': readFileSync(join(root, 'scripts', 'rollback-motif-claude-science-release.mjs'), 'utf8'),
    'lib/direct-script.mjs': readFileSync(join(root, 'scripts', 'lib', 'direct-script.mjs'), 'utf8'),
    'lib/motif-local-mcp-config.mjs': readFileSync(join(root, 'scripts', 'lib', 'motif-local-mcp-config.mjs'), 'utf8'),
    'lib/motif-release-bundle.mjs': readFileSync(join(root, 'scripts', 'lib', 'motif-release-bundle.mjs'), 'utf8'),
  };
  for (const [relativePath, content] of Object.entries(files)) {
    const path = join(directory, relativePath);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, content);
  }
  const checksumFiles = Object.fromEntries(
    Object.keys(files).sort((left, right) => left.localeCompare(right)).map((relativePath) => [
      relativePath,
      sha256(readFileSync(join(directory, relativePath))),
    ]),
  );
  const checksumFilename = 'motif-for-claude-science-release.checksums.json';
  const checksumBytes = `${JSON.stringify({ schema: 'motif.release.checksums.v1', algorithm: 'sha256', files: checksumFiles }, null, 2)}\n`;
  writeFileSync(join(directory, checksumFilename), checksumBytes);
  const manifest = {
    schema: 'motif.release.manifest.v1',
    product: 'Motif for Claude Science',
    connectorName: 'motif-local',
    version: '0.3.0',
    runtimeBuildId,
    checksumsFile: checksumFilename,
    checksumsSha256: sha256(checksumBytes),
    requiredFiles: Object.keys(files).sort((left, right) => left.localeCompare(right)),
    paths: {
      launcher: unsafePath ? '../outside.sh' : 'scripts/run-motif-claude-science-mcp.sh',
      server: 'dist-motif/claude-science/motif-mcp-server.mjs',
      app: 'dist-motif/claude-science/motif-mcp-app.html',
      template: 'dist-motif/motif-template.html',
    },
  };
  writeFileSync(join(directory, 'release-manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  return directory;
}

function runReleaseCli(bundle, scriptName, args) {
  const result = spawnSync(process.execPath, [join(bundle, scriptName), ...args], {
    encoding: 'utf8',
    env: { ...process.env, MOTIF_NODE_BIN: process.execPath },
  });
  return {
    ...result,
    output: `${result.stdout ?? ''}${result.stderr ?? ''}`,
  };
}

function temporaryConfig(initial) {
  const directory = mkdtempSync(join(tmpdir(), 'motif-config-test-'));
  temporaryDirectories.push(directory);
  const configPath = join(directory, 'mcp', 'local-mcp.json');
  mkdirSync(dirname(configPath), { recursive: true });
  const bytes = `${JSON.stringify(initial, null, 2)}\n`;
  writeFileSync(configPath, bytes);
  return { configPath, bytes };
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

describe('checksum-verified Motif release installation', () => {
  it('fails closed for an unresolvable or oversized direct-entry path', () => {
    expect(() => isDirectScriptExecution(join(tmpdir(), 'missing-release-helper.mjs'), fileURLToPath(import.meta.url)))
      .toThrow(/Cannot resolve argv\[1\]/);
    expect(() => isDirectScriptExecution(`/tmp/${'x'.repeat(4096)}`, fileURLToPath(import.meta.url)))
      .toThrow(/exceeds 4096 bytes/);
  });

  it('resolves both source and packaged helper locations to the bundle root', () => {
    const bundle = writeFixture();
    const canonicalBundle = realpathSync(bundle);
    expect(resolveReleaseBundleRoot(join(bundle, 'install-motif-claude-science-release.mjs'))).toBe(canonicalBundle);
    expect(resolveReleaseBundleRoot(join(bundle, 'scripts', 'install-motif-claude-science-release.mjs'))).toBe(canonicalBundle);
  });

  it('installs without node_modules, preserves unrelated config, and verifies identity', () => {
    const bundle = writeFixture();
    const canonicalBundle = realpathSync(bundle);
    const { configPath, bytes } = temporaryConfig({
      custom: { keep: true },
      servers: [{ name: 'unrelated', command: '/private/unrelated', args: [] }],
    });
    expect(existsSync(join(bundle, 'node_modules'))).toBe(false);
    const result = installRelease(['--bundle', bundle, '--config', configPath, '--node', process.execPath]);
    expect(result.changed).toBe(true);
    expect(result.backupPath).toBeTruthy();
    expect(readFileSync(result.backupPath, 'utf8')).toBe(bytes);
    const installed = JSON.parse(readFileSync(configPath, 'utf8'));
    expect(installed.custom).toEqual({ keep: true });
    expect(installed.servers[0].name).toBe('unrelated');
    expect(installed.servers[1]).toMatchObject({
      name: 'motif-local',
      env: { MOTIF_ROOT: canonicalBundle, MOTIF_NODE_BIN: process.execPath },
    });
    expect(doctorRelease(['--bundle', bundle, '--config', configPath, '--node', process.execPath]).config).toBe('matched');
  });

  it('reports dry-run registration without claiming the configuration changed', () => {
    const bundle = writeFixture();
    const { configPath, bytes } = temporaryConfig({ servers: [] });
    const result = installRelease([
      '--bundle', bundle,
      '--config', configPath,
      '--node', process.execPath,
      '--dry-run',
    ]);
    expect(result).toMatchObject({ changed: true, dryRun: true, backupPath: null });
    expect(readFileSync(configPath, 'utf8')).toBe(bytes);
    expect(formatInstallResult(result)).toContain(
      'Dry run: motif-local would be registered; Claude Science configuration was not changed.',
    );
    expect(formatInstallResult(result)).not.toContain('Registered motif-local.');
  });

  it('executes every packaged helper through a /tmp-style parent alias', () => {
    const bundle = writeFixture();
    const aliasParent = join(mkdtempSync(join(tmpdir(), 'motif-release-alias-parent-')), 'alias');
    temporaryDirectories.push(dirname(aliasParent));
    symlinkSync(dirname(bundle), aliasParent, 'dir');
    const aliasBundle = join(aliasParent, basename(bundle));
    const { configPath, bytes } = temporaryConfig({ servers: [] });

    const install = runReleaseCli(aliasBundle, 'install-motif-claude-science-release.mjs', [
      '--config', configPath,
      '--node', process.execPath,
    ]);
    expect(install.status).toBe(0);
    expect(install.output).toContain('Registered motif-local.');
    expect(readFileSync(configPath, 'utf8')).not.toBe(bytes);
    const installed = JSON.parse(readFileSync(configPath, 'utf8'));
    expect(installed.servers.find((server) => server.name === 'motif-local').env.MOTIF_ROOT).toBe(realpathSync(bundle));

    const doctor = runReleaseCli(aliasBundle, 'doctor-motif-claude-science-release.mjs', [
      '--config', configPath,
      '--node', process.execPath,
    ]);
    expect(doctor.status).toBe(0);
    expect(doctor.output).toContain('motif-local registration matches.');

    const dryRun = runReleaseCli(aliasBundle, 'install-motif-claude-science-release.mjs', [
      '--bundle', aliasBundle,
      '--config', configPath,
      '--node', process.execPath,
      '--dry-run',
    ]);
    expect(dryRun.status).toBe(0);
    expect(dryRun.output).toContain('configuration was not changed.');

    const rollback = runReleaseCli(aliasBundle, 'rollback-motif-claude-science-release.mjs', [
      '--bundle', aliasBundle,
      '--config', configPath,
      '--dry-run',
    ]);
    expect(rollback.status).toBe(0);
    expect(rollback.output).toContain('Rollback candidate:');

    const explicitDoctor = runReleaseCli(aliasBundle, 'doctor-motif-claude-science-release.mjs', [
      '--bundle', aliasBundle,
      '--skip-config',
    ]);
    expect(explicitDoctor.status).toBe(0);
    expect(explicitDoctor.output).toContain('Configuration check skipped.');
  });

  it('rejects tampering before changing configuration', () => {
    const bundle = writeFixture();
    const { configPath, bytes } = temporaryConfig({ servers: [] });
    writeFileSync(join(bundle, 'installer.mjs'), 'tampered\n');
    expect(() => installRelease(['--bundle', bundle, '--config', configPath, '--node', process.execPath])).toThrow(/checksum mismatch/);
    expect(readFileSync(configPath, 'utf8')).toBe(bytes);
  });

  it('rejects a validly checksummed bundle with the wrong product identity', () => {
    expect(() => verifyReleaseBundle(writeFixture({ wrongProduct: true }))).toThrow(/MCP App identity/);
  });

  it('rejects path traversal in release metadata', () => {
    expect(() => verifyReleaseBundle(writeFixture({ unsafePath: true }))).toThrow(/unsafe path/);
  });

  it('bounds unexpected release-file traversal before comparing the manifest', () => {
    const bundle = writeFixture();
    for (let index = 0; index < RELEASE_MAX_BUNDLE_FILES; index += 1) {
      writeFileSync(join(bundle, `unexpected-${String(index).padStart(3, '0')}.txt`), 'x\n');
    }
    expect(() => verifyReleaseBundle(bundle)).toThrow(/file count exceeds/);
  });

  it('bounds hostile empty-directory traversal by node count and depth', () => {
    const nodeBundle = writeFixture();
    for (let index = 0; index < RELEASE_MAX_DIRECTORY_NODES; index += 1) {
      mkdirSync(join(nodeBundle, `empty-${String(index).padStart(3, '0')}`));
    }
    expect(() => verifyReleaseBundle(nodeBundle)).toThrow(/directory count exceeds/);

    const depthBundle = writeFixture();
    let current = depthBundle;
    for (let index = 0; index <= RELEASE_MAX_DIRECTORY_DEPTH; index += 1) {
      current = join(current, `nested-${String(index).padStart(2, '0')}`);
      mkdirSync(current);
    }
    expect(() => verifyReleaseBundle(depthBundle)).toThrow(/directory depth exceeds/);
  });

  it('bounds a flat hostile directory before sorting its entries', () => {
    const bundle = writeFixture();
    for (let index = 0; index <= RELEASE_MAX_BUNDLE_ENTRIES; index += 1) {
      mkdirSync(join(bundle, `flat-${String(index).padStart(3, '0')}`));
    }
    expect(() => verifyReleaseBundle(bundle)).toThrow(/entry count exceeds/);
  });

  it('restores the exact private backup and preserves the current state as a new backup', () => {
    const bundle = writeFixture();
    const { configPath, bytes } = temporaryConfig({ servers: [{ name: 'unrelated', command: '/private/unrelated', args: [] }] });
    const installed = installRelease(['--bundle', bundle, '--config', configPath, '--node', process.execPath]);
    const rollback = rollbackRelease(['--bundle', bundle, '--config', configPath, '--backup', installed.backupPath]);
    expect(rollback.changed).toBe(true);
    expect(readFileSync(configPath, 'utf8')).toBe(bytes);
    expect(rollback.backupPath).toBeTruthy();
    expect(readFileSync(rollback.backupPath, 'utf8')).toContain('motif-local');
  });

  it('rejects oversized or symlinked rollback backups before reading them', () => {
    const bundle = writeFixture();
    const { configPath } = temporaryConfig({ servers: [] });
    const backupPath = join(dirname(configPath), `${basename(configPath)}.before-motif-local-test`);
    writeFileSync(backupPath, Buffer.alloc(MAX_LOCAL_MCP_CONFIG_BYTES + 1, 0x20));
    expect(() => rollbackRelease(['--bundle', bundle, '--config', configPath, '--backup', backupPath]))
      .toThrowError(expect.objectContaining({ code: 'config_too_large' }));

    const targetPath = join(dirname(configPath), 'rollback-target.json');
    writeFileSync(targetPath, '{"servers":[]}\n');
    rmSync(backupPath, { force: true });
    symlinkSync(targetPath, backupPath);
    expect(() => rollbackRelease(['--bundle', bundle, '--config', configPath, '--backup', backupPath]))
      .toThrow(/must not be a symbolic link/);
  });
});

describe('reviewed dependency policy', () => {
  it('rejects range declarations and non-registry lock sources', () => {
    const directory = mkdtempSync(join(tmpdir(), 'motif-policy-test-'));
    temporaryDirectories.push(directory);
    cpSync(join(root, 'security'), join(directory, 'security'), { recursive: true });
    const packagePath = join(directory, 'package.json');
    const lockPath = join(directory, 'package-lock.json');
    const packageJson = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
    const lock = JSON.parse(readFileSync(join(root, 'package-lock.json'), 'utf8'));
    packageJson.dependencies['lucide-react'] = '^0.563.0';
    writeFileSync(packagePath, JSON.stringify(packageJson));
    writeFileSync(lockPath, JSON.stringify(lock));
    expect(() => checkLockfilePolicy(directory)).toThrow(/exact semver/);

    packageJson.dependencies['lucide-react'] = '0.563.0';
    lock.packages['node_modules/lucide-react'].resolved = 'https://example.invalid/lucide-react.tgz';
    writeFileSync(packagePath, JSON.stringify(packageJson));
    writeFileSync(lockPath, JSON.stringify(lock));
    expect(() => checkLockfilePolicy(directory)).toThrow(/outside the reviewed registry/);
  });

  it('rejects unallowlisted lifecycle scripts and binding.gyp files', () => {
    const directory = mkdtempSync(join(tmpdir(), 'motif-policy-lifecycle-test-'));
    temporaryDirectories.push(directory);
    mkdirSync(join(directory, 'node_modules', 'reviewed-package'), { recursive: true });
    mkdirSync(join(directory, 'security'), { recursive: true });
    writeFileSync(join(directory, 'package.json'), JSON.stringify({
      name: 'policy-fixture',
      dependencies: { 'reviewed-package': '1.0.0' },
    }));
    writeFileSync(join(directory, 'package-lock.json'), JSON.stringify({
      lockfileVersion: 3,
      packages: {
        '': { dependencies: { 'reviewed-package': '1.0.0' } },
        'node_modules/reviewed-package': {
          version: '1.0.0',
          resolved: 'https://registry.npmjs.org/reviewed-package/-/reviewed-package-1.0.0.tgz',
          integrity: 'sha512-AAAA=',
          hasInstallScript: true,
        },
      },
    }));
    writeFileSync(join(directory, 'security/dependency-policy.json'), JSON.stringify({
      schema: 'motif.dependency-policy.v1',
      registry: 'https://registry.npmjs.org/',
      directDependenciesMustBeExact: true,
      allowedLifecycleScripts: {},
      allowedBindingGyp: [],
      reviewedConnectorInventory: 'security/connector-inventory.json',
    }));
    writeFileSync(join(directory, 'security/connector-inventory.json'), JSON.stringify({
      schema: 'motif.reviewed-connector-inventory.v1',
      packages: [{ name: 'reviewed-package', packagePath: ['reviewed-package'], licenseFile: 'reviewed-LICENSE.txt' }],
    }));
    writeFileSync(join(directory, 'node_modules/reviewed-package/package.json'), JSON.stringify({
      name: 'reviewed-package',
      version: '1.0.0',
      scripts: { postinstall: 'node install.js' },
    }));
    writeFileSync(join(directory, 'node_modules/reviewed-package/binding.gyp'), '{}\n');
    expect(() => checkLockfilePolicy(directory)).toThrow(/Lifecycle-script policy violation/);
    writeFileSync(join(directory, 'node_modules/reviewed-package/package.json'), JSON.stringify({ name: 'reviewed-package', version: '1.0.0' }));
    const lock = JSON.parse(readFileSync(join(directory, 'package-lock.json'), 'utf8'));
    delete lock.packages['node_modules/reviewed-package'].hasInstallScript;
    writeFileSync(join(directory, 'package-lock.json'), JSON.stringify(lock));
    expect(() => checkLockfilePolicy(directory)).toThrow(/binding.gyp policy violation/);
  });

  it('rejects unsafe lockfile paths before reading outside the workspace', () => {
    const directory = mkdtempSync(join(tmpdir(), 'motif-policy-path-test-'));
    temporaryDirectories.push(directory);
    cpSync(join(root, 'security'), join(directory, 'security'), { recursive: true });
    cpSync(join(root, 'package.json'), join(directory, 'package.json'));
    const lock = JSON.parse(readFileSync(join(root, 'package-lock.json'), 'utf8'));
    lock.packages['../outside-package'] = {
      version: '1.0.0',
      resolved: 'https://registry.npmjs.org/outside-package/-/outside-package-1.0.0.tgz',
      integrity: 'sha512-AAAA=',
    };
    writeFileSync(join(directory, 'package-lock.json'), JSON.stringify(lock));
    expect(() => checkLockfilePolicy(directory)).toThrow(/lock package path is unsafe/);
  });

  it('rejects package-tree symlinks instead of silently skipping them', () => {
    const directory = mkdtempSync(join(tmpdir(), 'motif-policy-symlink-test-'));
    temporaryDirectories.push(directory);
    mkdirSync(join(directory, 'node_modules', 'reviewed-package'), { recursive: true });
    mkdirSync(join(directory, 'security'), { recursive: true });
    writeFileSync(join(directory, 'package.json'), JSON.stringify({
      name: 'policy-fixture',
      dependencies: { 'reviewed-package': '1.0.0' },
    }));
    writeFileSync(join(directory, 'package-lock.json'), JSON.stringify({
      lockfileVersion: 3,
      packages: {
        '': { dependencies: { 'reviewed-package': '1.0.0' } },
        'node_modules/reviewed-package': {
          version: '1.0.0',
          resolved: 'https://registry.npmjs.org/reviewed-package/-/reviewed-package-1.0.0.tgz',
          integrity: 'sha512-AAAA=',
        },
      },
    }));
    writeFileSync(join(directory, 'security/dependency-policy.json'), JSON.stringify({
      schema: 'motif.dependency-policy.v1',
      registry: 'https://registry.npmjs.org/',
      directDependenciesMustBeExact: true,
      allowedLifecycleScripts: {},
      allowedBindingGyp: [],
      reviewedConnectorInventory: 'security/connector-inventory.json',
    }));
    writeFileSync(join(directory, 'security/connector-inventory.json'), JSON.stringify({
      schema: 'motif.reviewed-connector-inventory.v1',
      packages: [{ name: 'reviewed-package', packagePath: ['reviewed-package'], licenseFile: 'reviewed-LICENSE.txt' }],
    }));
    writeFileSync(join(directory, 'node_modules/reviewed-package/package.json'), JSON.stringify({
      name: 'reviewed-package',
      version: '1.0.0',
    }));
    const outside = join(directory, 'outside.txt');
    writeFileSync(outside, 'outside\n');
    symlinkSync(outside, join(directory, 'node_modules/reviewed-package/linked.txt'));
    expect(() => checkLockfilePolicy(directory)).toThrow(/package contains a symbolic link/);
  });

  it('rejects a new lifecycle-script version until its exact review is added', () => {
    const directory = mkdtempSync(join(tmpdir(), 'motif-policy-version-test-'));
    temporaryDirectories.push(directory);
    cpSync(join(root, 'security'), join(directory, 'security'), { recursive: true });
    cpSync(join(root, 'package.json'), join(directory, 'package.json'));
    const lock = JSON.parse(readFileSync(join(root, 'package-lock.json'), 'utf8'));
    lock.packages['node_modules/esbuild'].version = '0.28.2';
    writeFileSync(join(directory, 'package-lock.json'), JSON.stringify(lock));
    expect(() => checkLockfilePolicy(directory)).toThrow(/stale or unreviewed/);
  });

  it('detects bundled connector inventory drift', () => {
    const expected = { packages: [{ name: 'a', packagePath: ['a'], licenseFile: 'a-LICENSE.txt' }, { name: 'b', packagePath: ['b'], licenseFile: 'b-LICENSE.txt' }] };
    expect(() => compareConnectorInventory(expected, { packages: [{ name: 'a', packagePath: ['a'], licenseFile: 'licenses/a-LICENSE.txt' }] })).toThrow(/inventory drift/);
  });
});
