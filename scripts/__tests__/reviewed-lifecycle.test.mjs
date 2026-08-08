import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { arch, endianness, platform, tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { prepareEsbuild } from '../run-reviewed-lifecycle.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const temporaryDirectories = [];

function platformKey() {
  return `${platform()} ${arch()} ${endianness()}`;
}

function fixture() {
  const directory = mkdtempSync(join(tmpdir(), 'motif-esbuild-preparation-test-'));
  temporaryDirectories.push(directory);
  cpSync(join(root, 'package.json'), join(directory, 'package.json'));
  cpSync(join(root, 'package-lock.json'), join(directory, 'package-lock.json'));
  cpSync(join(root, 'security'), join(directory, 'security'), { recursive: true });

  const platformPackageName = ({
    'darwin arm64 LE': '@esbuild/darwin-arm64',
    'darwin x64 LE': '@esbuild/darwin-x64',
    'linux x64 LE': '@esbuild/linux-x64',
    'linux arm64 LE': '@esbuild/linux-arm64',
  }[platformKey()]);
  if (!platformPackageName) throw new Error(`Test fixture does not support ${platformKey()}`);

  const esbuildDirectory = join(directory, 'node_modules/esbuild');
  const platformDirectory = join(directory, 'node_modules', platformPackageName);
  mkdirSync(join(esbuildDirectory, 'bin'), { recursive: true });
  mkdirSync(join(platformDirectory, 'bin'), { recursive: true });
  cpSync(join(root, 'node_modules/esbuild/package.json'), join(esbuildDirectory, 'package.json'));
  cpSync(join(root, 'node_modules/esbuild/bin/esbuild'), join(esbuildDirectory, 'bin/esbuild'));
  cpSync(join(root, 'node_modules', platformPackageName, 'package.json'), join(platformDirectory, 'package.json'));
  cpSync(
    join(root, 'node_modules', platformPackageName, platformPackageName.startsWith('@esbuild/win32-') ? 'esbuild.exe' : 'bin/esbuild'),
    join(platformDirectory, platformPackageName.startsWith('@esbuild/win32-') ? 'esbuild.exe' : 'bin/esbuild'),
  );

  const markerPath = join(directory, 'install-js-ran.txt');
  writeFileSync(join(esbuildDirectory, 'install.js'), `require('node:fs').writeFileSync(${JSON.stringify(markerPath)}, 'ran');\n`);
  return {
    directory,
    markerPath,
    manifestPath: join(esbuildDirectory, 'package.json'),
    binaryPath: join(platformDirectory, platformPackageName.startsWith('@esbuild/win32-') ? 'esbuild.exe' : 'bin/esbuild'),
  };
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

describe('Motif-owned esbuild preparation', () => {
  it('prepares the exact current-platform binary without executing install.js', () => {
    const fixtureData = fixture();
    const result = prepareEsbuild(fixtureData.directory);
    expect(result.prepared).toHaveLength(1);
    expect(result.prepared[0].version).toBe('0.28.1');
    expect(existsSync(fixtureData.markerPath)).toBe(false);
    expect(readFileSync(join(fixtureData.directory, 'node_modules/esbuild/bin/esbuild'))).toHaveLength(
      readFileSync(fixtureData.binaryPath).length,
    );
  });

  it('rejects an esbuild manifest tamper before trusting its binary hash map', () => {
    const fixtureData = fixture();
    const manifest = JSON.parse(readFileSync(fixtureData.manifestPath, 'utf8'));
    const key = Object.keys(manifest['esbuild.binaryHashes'])[0];
    manifest['esbuild.binaryHashes'][key] = '0'.repeat(64);
    writeFileSync(fixtureData.manifestPath, JSON.stringify(manifest));
    expect(() => prepareEsbuild(fixtureData.directory)).toThrow(/esbuild package\.json SHA-256 mismatch/);
    expect(existsSync(fixtureData.markerPath)).toBe(false);
  });

  it('rejects current-platform binary tampering before materialization or execution', () => {
    const fixtureData = fixture();
    writeFileSync(fixtureData.binaryPath, Buffer.concat([readFileSync(fixtureData.binaryPath), Buffer.from('tampered')]));
    expect(() => prepareEsbuild(fixtureData.directory)).toThrow(/current-platform esbuild binary SHA-256 mismatch/);
    expect(existsSync(fixtureData.markerPath)).toBe(false);
  });

  it('rejects an esbuild lockfile integrity change', () => {
    const fixtureData = fixture();
    const lockPath = join(fixtureData.directory, 'package-lock.json');
    const lock = JSON.parse(readFileSync(lockPath, 'utf8'));
    lock.packages['node_modules/esbuild'].integrity = 'sha512-AAAA=';
    writeFileSync(lockPath, JSON.stringify(lock));
    expect(() => prepareEsbuild(fixtureData.directory)).toThrow(/lockfile entry does not match policy/);
    expect(existsSync(fixtureData.markerPath)).toBe(false);
  });

  it('accepts no arbitrary command arguments', () => {
    const result = spawnSync(process.execPath, [join(root, 'scripts/run-reviewed-lifecycle.mjs'), '--arbitrary'], {
      cwd: root,
      encoding: 'utf8',
    });
    expect(result.status).not.toBe(0);
    expect(`${result.stdout ?? ''}${result.stderr ?? ''}`).toMatch(/accepts no command arguments/);
  });

  it('passes the repository lifecycle security command after ignore-scripts installation', () => {
    const result = spawnSync(process.execPath, [join(root, 'scripts/run-reviewed-lifecycle.mjs')], {
      cwd: root,
      encoding: 'utf8',
    });
    expect(result.status).toBe(0);
    expect(`${result.stdout ?? ''}${result.stderr ?? ''}`).toMatch(/Motif-owned dependency preparation passed/);
  });
});
