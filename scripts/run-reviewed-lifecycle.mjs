#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import {
  chmodSync,
  copyFileSync,
  existsSync,
  lstatSync,
  readFileSync,
} from 'node:fs';
import { arch, endianness, platform } from 'node:os';
import { join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkLockfilePolicy, loadDependencyPolicy } from './lib/supply-chain-policy.mjs';

const ESBUILD_NAME = 'esbuild';
const ESBUILD_VERSION = '0.28.1';
const ESBUILD_IDENTITY = `${ESBUILD_NAME}@${ESBUILD_VERSION}`;
const ESBUILD_PACKAGE_PATH = 'node_modules/esbuild';
const ESBUILD_MANIFEST_PATH = `${ESBUILD_PACKAGE_PATH}/package.json`;
const VERSION_ARGS = ['--version'];
const VERSION_TIMEOUT_MS = 10_000;
const VERSION_OUTPUT_BYTES = 64 * 1024;
const SHA256_HEX = /^[a-f0-9]{64}$/u;

// This is intentionally a closed table. It mirrors the platform package names
// published for this exact esbuild version; there is no package search or
// fallback to a package for another operating system or CPU.
const ESBUILD_PLATFORM_PACKAGES = Object.freeze({
  'aix ppc64 BE': Object.freeze({ packageName: '@esbuild/aix-ppc64', binaryPath: 'bin/esbuild' }),
  'android arm LE': Object.freeze({ packageName: '@esbuild/android-arm', binaryPath: 'bin/esbuild' }),
  'android arm64 LE': Object.freeze({ packageName: '@esbuild/android-arm64', binaryPath: 'bin/esbuild' }),
  'android x64 LE': Object.freeze({ packageName: '@esbuild/android-x64', binaryPath: 'bin/esbuild' }),
  'darwin arm64 LE': Object.freeze({ packageName: '@esbuild/darwin-arm64', binaryPath: 'bin/esbuild' }),
  'darwin x64 LE': Object.freeze({ packageName: '@esbuild/darwin-x64', binaryPath: 'bin/esbuild' }),
  'freebsd arm64 LE': Object.freeze({ packageName: '@esbuild/freebsd-arm64', binaryPath: 'bin/esbuild' }),
  'freebsd x64 LE': Object.freeze({ packageName: '@esbuild/freebsd-x64', binaryPath: 'bin/esbuild' }),
  'linux arm LE': Object.freeze({ packageName: '@esbuild/linux-arm', binaryPath: 'bin/esbuild' }),
  'linux arm64 LE': Object.freeze({ packageName: '@esbuild/linux-arm64', binaryPath: 'bin/esbuild' }),
  'linux ia32 LE': Object.freeze({ packageName: '@esbuild/linux-ia32', binaryPath: 'bin/esbuild' }),
  'linux loong64 LE': Object.freeze({ packageName: '@esbuild/linux-loong64', binaryPath: 'bin/esbuild' }),
  'linux mips64el LE': Object.freeze({ packageName: '@esbuild/linux-mips64el', binaryPath: 'bin/esbuild' }),
  'linux ppc64 LE': Object.freeze({ packageName: '@esbuild/linux-ppc64', binaryPath: 'bin/esbuild' }),
  'linux riscv64 LE': Object.freeze({ packageName: '@esbuild/linux-riscv64', binaryPath: 'bin/esbuild' }),
  'linux s390x BE': Object.freeze({ packageName: '@esbuild/linux-s390x', binaryPath: 'bin/esbuild' }),
  'linux x64 LE': Object.freeze({ packageName: '@esbuild/linux-x64', binaryPath: 'bin/esbuild' }),
  'netbsd arm64 LE': Object.freeze({ packageName: '@esbuild/netbsd-arm64', binaryPath: 'bin/esbuild' }),
  'netbsd x64 LE': Object.freeze({ packageName: '@esbuild/netbsd-x64', binaryPath: 'bin/esbuild' }),
  'openbsd arm64 LE': Object.freeze({ packageName: '@esbuild/openbsd-arm64', binaryPath: 'bin/esbuild' }),
  'openbsd x64 LE': Object.freeze({ packageName: '@esbuild/openbsd-x64', binaryPath: 'bin/esbuild' }),
  'openharmony arm64 LE': Object.freeze({ packageName: '@esbuild/openharmony-arm64', binaryPath: 'bin/esbuild' }),
  'sunos x64 LE': Object.freeze({ packageName: '@esbuild/sunos-x64', binaryPath: 'bin/esbuild' }),
  'win32 arm64 LE': Object.freeze({ packageName: '@esbuild/win32-arm64', binaryPath: 'esbuild.exe' }),
  'win32 ia32 LE': Object.freeze({ packageName: '@esbuild/win32-ia32', binaryPath: 'esbuild.exe' }),
  'win32 x64 LE': Object.freeze({ packageName: '@esbuild/win32-x64', binaryPath: 'esbuild.exe' }),
});

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function readJson(path, label) {
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch (error) {
    throw new Error(`${label} is not valid JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function assertContained(root, path, label) {
  const local = relative(root, path);
  if (!local || local === '..' || local.startsWith(`..${sep}`) || local.startsWith('/') || local.startsWith('\\')) {
    throw new Error(`${label} escapes the workspace`);
  }
}

function assertRelativePath(path, label) {
  if (typeof path !== 'string' || !path || path.startsWith('/') || path.startsWith('\\') || path.includes('..') || path.includes('\\')) {
    throw new Error(`${label} is unsafe`);
  }
}

function regularDirectory(root, relativePath, label) {
  assertRelativePath(relativePath, label);
  const directory = resolve(root, relativePath);
  assertContained(root, directory, label);
  let current = root;
  for (const segment of relativePath.split('/')) {
    current = join(current, segment);
    let stat;
    try {
      stat = lstatSync(current);
    } catch (error) {
      if (error?.code === 'ENOENT') throw new Error(`${label} is missing`);
      throw error;
    }
    if (stat.isSymbolicLink() || !stat.isDirectory()) throw new Error(`${label} must be a real directory`);
  }
  return directory;
}

function regularFile(path, label) {
  let stat;
  try {
    stat = lstatSync(path);
  } catch (error) {
    if (error?.code === 'ENOENT') throw new Error(`${label} is missing`);
    throw error;
  }
  if (stat.isSymbolicLink() || !stat.isFile()) throw new Error(`${label} must be a regular file`);
  return readFileSync(path);
}

function readHashedFile(path, expectedDigest, label) {
  if (!SHA256_HEX.test(expectedDigest)) throw new Error(`${label} has no valid expected SHA-256`);
  const bytes = regularFile(path, label);
  const actualDigest = sha256(bytes);
  if (actualDigest !== expectedDigest) throw new Error(`${label} SHA-256 mismatch`);
  return bytes;
}

function parseHashedJson(path, expectedDigest, label) {
  const bytes = readHashedFile(path, expectedDigest, label);
  try {
    return JSON.parse(bytes.toString('utf8'));
  } catch (error) {
    throw new Error(`${label} is not valid JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function currentPlatformKey() {
  return `${platform()} ${arch()} ${endianness()}`;
}

function assertLockfileEntry(lock, preparation) {
  const expected = preparation.lockfile;
  const entry = lock.packages?.[expected.path];
  if (!entry || typeof entry !== 'object') throw new Error('esbuild lockfile entry is missing');
  if (entry.version !== expected.version || entry.resolved !== expected.resolved || entry.integrity !== expected.integrity) {
    throw new Error('esbuild lockfile identity, resolved source, or integrity does not match policy');
  }
  return entry;
}

function assertPlatformLockfileEntry(lock, platformSpec, preparationSpec) {
  const path = `node_modules/${platformSpec.packageName}`;
  const entry = lock.packages?.[path];
  if (!entry || typeof entry !== 'object' || entry.version !== preparationSpec.version) {
    throw new Error(`Current-platform esbuild package is missing or has the wrong version: ${platformSpec.packageName}`);
  }
  return entry;
}

function verifyVersion(binaryPath, root) {
  let output;
  try {
    output = execFileSync(binaryPath, VERSION_ARGS, {
      cwd: root,
      encoding: 'utf8',
      env: process.platform === 'win32' ? { SystemRoot: process.env.SystemRoot ?? 'C:\\Windows' } : {},
      shell: false,
      timeout: VERSION_TIMEOUT_MS,
      maxBuffer: VERSION_OUTPUT_BYTES,
      windowsHide: true,
    });
  } catch (error) {
    throw new Error(`Verified esbuild binary failed its exact version check: ${error instanceof Error ? error.message : String(error)}`);
  }
  const actual = output.trim();
  if (actual !== ESBUILD_VERSION) throw new Error(`Verified esbuild binary reported ${JSON.stringify(actual)} instead of ${JSON.stringify(ESBUILD_VERSION)}`);
  return actual;
}

/**
 * Prepare the exact locked esbuild binary without invoking its package
 * lifecycle script. The helper reads only fixed package paths, verifies every
 * installed file before trusting it, copies the current-platform executable to
 * esbuild's expected bin path, and performs one exact version check.
 */
export function prepareEsbuild(rootPath = process.cwd(), ...unexpectedArguments) {
  if (unexpectedArguments.length > 0) throw new Error('The Motif-owned preparation helper accepts no command arguments');
  const root = resolve(rootPath);
  const rootStat = lstatSync(root);
  if (rootStat.isSymbolicLink() || !rootStat.isDirectory()) throw new Error('Preparation workspace must be a real directory');
  const policyResult = checkLockfilePolicy(root);
  const { policy } = loadDependencyPolicy(root);
  const preparation = policy.ownedPreparations?.[ESBUILD_IDENTITY];
  if (!preparation) throw new Error(`No exact Motif-owned preparation is registered for ${ESBUILD_IDENTITY}`);
  if (preparation.manifestPath !== ESBUILD_MANIFEST_PATH) throw new Error('esbuild manifest path does not match the fixed preparation path');

  const packageJson = readJson(join(root, 'package.json'), 'package.json');
  const lock = readJson(join(root, 'package-lock.json'), 'package-lock.json');
  if (packageJson.devDependencies?.[ESBUILD_NAME] !== ESBUILD_VERSION
    || lock.packages?.['']?.devDependencies?.[ESBUILD_NAME] !== ESBUILD_VERSION) {
    throw new Error('esbuild is not an exact locked dev dependency');
  }
  assertLockfileEntry(lock, preparation);

  const esbuildDirectory = regularDirectory(root, ESBUILD_PACKAGE_PATH, 'esbuild package directory');
  const esbuildManifest = parseHashedJson(
    join(root, ESBUILD_MANIFEST_PATH),
    preparation.manifestSha256,
    'esbuild package.json',
  );
  if (esbuildManifest.name !== ESBUILD_NAME || esbuildManifest.version !== ESBUILD_VERSION) {
    throw new Error('esbuild package.json identity or version does not match policy');
  }
  const binaryHashes = esbuildManifest['esbuild.binaryHashes'];
  if (!binaryHashes || typeof binaryHashes !== 'object' || Array.isArray(binaryHashes)) {
    throw new Error('esbuild package.json has no usable binary hash map');
  }

  const platformKey = currentPlatformKey();
  const platformSpec = ESBUILD_PLATFORM_PACKAGES[platformKey];
  if (!platformSpec) throw new Error(`No exact esbuild package is reviewed for current platform ${platformKey}`);
  const policyPlatformSpec = preparation.platforms?.[platformKey];
  if (!policyPlatformSpec
    || policyPlatformSpec.package !== platformSpec.packageName
    || policyPlatformSpec.version !== ESBUILD_VERSION
    || policyPlatformSpec.binaryPath !== platformSpec.binaryPath) {
    throw new Error(`esbuild policy has no exact mapping for current platform ${platformKey}`);
  }
  const platformDirectory = regularDirectory(
    root,
    `node_modules/${platformSpec.packageName}`,
    'current-platform esbuild package directory',
  );
  assertPlatformLockfileEntry(lock, platformSpec, policyPlatformSpec);
  const platformManifest = parseHashedJson(
    join(platformDirectory, 'package.json'),
    policyPlatformSpec.manifestSha256,
    'current-platform esbuild package.json',
  );
  if (platformManifest.name !== platformSpec.packageName || platformManifest.version !== ESBUILD_VERSION) {
    throw new Error('current-platform esbuild package identity or version does not match policy');
  }
  if (esbuildManifest.optionalDependencies?.[platformSpec.packageName] !== ESBUILD_VERSION) {
    throw new Error('esbuild optional dependency map does not select the exact current-platform package');
  }

  const binaryHashKey = `${platformSpec.packageName}/${platformSpec.binaryPath}`;
  const expectedBinaryDigest = binaryHashes[binaryHashKey];
  if (!SHA256_HEX.test(expectedBinaryDigest)) {
    throw new Error(`esbuild package.json has no exact binary hash for ${binaryHashKey}`);
  }
  const sourceBinaryPath = join(platformDirectory, platformSpec.binaryPath);
  readHashedFile(sourceBinaryPath, expectedBinaryDigest, 'current-platform esbuild binary');

  const binDirectory = regularDirectory(esbuildDirectory, 'bin', 'esbuild bin directory');
  const targetBinaryPath = join(binDirectory, 'esbuild');
  if (existsSync(targetBinaryPath)) {
    const targetStat = lstatSync(targetBinaryPath);
    if (targetStat.isSymbolicLink() || !targetStat.isFile()) throw new Error('esbuild bin/esbuild must be a regular file');
  }
  copyFileSync(sourceBinaryPath, targetBinaryPath);
  chmodSync(targetBinaryPath, 0o755);
  const targetDigest = sha256(regularFile(targetBinaryPath, 'materialized esbuild binary'));
  if (targetDigest !== expectedBinaryDigest) {
    throw new Error('materialized esbuild binary SHA-256 mismatch');
  }
  const version = verifyVersion(targetBinaryPath, root);
  return {
    ...policyResult,
    prepared: [{
      identity: ESBUILD_IDENTITY,
      platform: platformKey,
      package: platformSpec.packageName,
      binaryPath: targetBinaryPath,
      binarySha256: targetDigest,
      version,
    }],
  };
}

export const runReviewedLifecycle = prepareEsbuild;

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    if (process.argv.length !== 2) throw new Error('The Motif-owned preparation helper accepts no command arguments');
    const result = prepareEsbuild(root);
    console.log(`Motif-owned dependency preparation passed: ${result.prepared.length} exact esbuild binary prepared.`);
  } catch (error) {
    console.error(`Motif-owned dependency preparation failed: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  }
}
