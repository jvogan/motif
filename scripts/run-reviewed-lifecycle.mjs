#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import {
  existsSync,
  lstatSync,
  readFileSync,
} from 'node:fs';
import { delimiter, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkLockfilePolicy, loadDependencyPolicy } from './lib/supply-chain-policy.mjs';

const INSTALL_LIFECYCLE_KEYS = ['preinstall', 'install', 'postinstall'];
const MAX_SCRIPT_BYTES = 4096;
const MAX_SCRIPT_OUTPUT_BYTES = 2 * 1024 * 1024;
const SCRIPT_TIMEOUT_MS = 120_000;

function readJson(path, label) {
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch (error) {
    throw new Error(`${label} is not valid JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function packageName(lockPath, manifest) {
  if (typeof manifest?.name === 'string' && manifest.name.trim()) return manifest.name;
  const relative = lockPath.replace(/^node_modules\//u, '');
  const segments = relative.split('/node_modules/').at(-1)?.split('/') ?? [];
  return segments[0]?.startsWith('@') ? segments.slice(0, 2).join('/') : segments[0] ?? lockPath;
}

function packageDirectory(root, lockPath) {
  const directory = resolve(root, lockPath);
  const relativePath = relative(root, directory);
  if (!relativePath || relativePath === '..' || relativePath.startsWith(`..${sep}`) || relativePath.startsWith('/')) {
    throw new Error(`Lifecycle package path escapes the workspace: ${lockPath}`);
  }
  if (!existsSync(directory)) return null;
  const stat = lstatSync(directory);
  if (stat.isSymbolicLink() || !stat.isDirectory()) {
    throw new Error(`Lifecycle package directory must be a real directory: ${lockPath}`);
  }
  return directory;
}

function lifecycleEnvironment(root, identity, version, key, metadata, manifestPath) {
  const [name] = identity.lastIndexOf('@') > 0
    ? [identity.slice(0, identity.lastIndexOf('@'))]
    : [identity];
  const binDirectory = join(root, 'node_modules', '.bin');
  return {
    ...process.env,
    PATH: `${binDirectory}${delimiter}${process.env.PATH ?? ''}`,
    INIT_CWD: root,
    npm_lifecycle_event: key,
    npm_package_name: name,
    npm_package_version: version,
    npm_package_json: manifestPath,
    npm_package_resolved: metadata.resolved ?? '',
    npm_package_integrity: metadata.integrity ?? '',
    npm_package_optional: metadata.optional ? 'true' : 'false',
    npm_package_dev: metadata.dev ? 'true' : 'false',
    npm_package_peer: metadata.peer ? 'true' : 'false',
    npm_package_dev_optional: metadata.devOptional ? 'true' : 'false',
  };
}

function runScript({ root, identity, version, key, command, metadata, packagePath }) {
  if (typeof command !== 'string' || command.length === 0 || Buffer.byteLength(command, 'utf8') > MAX_SCRIPT_BYTES || command.includes('\0')) {
    throw new Error(`${identity} ${key} script is outside the bounded reviewed command format`);
  }
  const manifestPath = join(packagePath, 'package.json');
  const result = spawnSync(command, {
    cwd: packagePath,
    env: lifecycleEnvironment(root, identity, version, key, metadata, manifestPath),
    encoding: 'utf8',
    shell: true,
    timeout: SCRIPT_TIMEOUT_MS,
    maxBuffer: MAX_SCRIPT_OUTPUT_BYTES,
    windowsHide: true,
  });
  if (result.error || result.status !== 0) {
    const reason = result.error?.message ?? `exit status ${result.status ?? 'unknown'}${result.signal ? ` (${result.signal})` : ''}`;
    throw new Error(`Reviewed lifecycle script failed for ${identity} ${key}: ${reason}`);
  }
  return { identity, key };
}

/**
 * Run only install-time scripts that passed the lockfile, registry, integrity,
 * exact identity, lifecycle, and binding policy. CI must install with
 * --ignore-scripts before calling this function.
 */
export function runReviewedLifecycle(rootPath = process.cwd()) {
  const root = resolve(rootPath);
  const policyResult = checkLockfilePolicy(root);
  const { policy } = loadDependencyPolicy(root);
  const packageJson = readJson(join(root, 'package.json'), 'package.json');
  const lock = readJson(join(root, 'package-lock.json'), 'package-lock.json');
  const allowScripts = packageJson.allowScripts ?? {};
  const allowedLifecycleScripts = policy.allowedLifecycleScripts ?? {};
  const executed = [];

  for (const [lockPath, metadata] of Object.entries(lock.packages ?? {}).sort(([left], [right]) => left.localeCompare(right))) {
    if (lockPath === '' || !metadata || typeof metadata !== 'object') continue;
    const directory = packageDirectory(root, lockPath);
    if (!directory) {
      if (!metadata.optional && metadata.hasInstallScript) {
        throw new Error(`Reviewed lifecycle package is missing after --ignore-scripts install: ${lockPath}`);
      }
      continue;
    }
    const manifestPath = join(directory, 'package.json');
    if (!existsSync(manifestPath)) {
      if (metadata.hasInstallScript) throw new Error(`Reviewed lifecycle package manifest is missing: ${lockPath}`);
      continue;
    }
    const manifest = readJson(manifestPath, `Package manifest ${manifestPath}`);
    const name = packageName(lockPath, manifest);
    const version = metadata.version;
    const identity = `${name}@${version}`;
    const allowed = allowedLifecycleScripts[identity];
    const installKeys = INSTALL_LIFECYCLE_KEYS.filter(key => typeof manifest.scripts?.[key] === 'string' && manifest.scripts[key].trim());
    if (installKeys.length === 0) continue;
    if (!Array.isArray(allowed) || allowScripts[identity] !== true) {
      throw new Error(`${identity} has an install-time script but no exact executable approval`);
    }
    for (const key of installKeys) {
      if (!allowed.includes(key)) throw new Error(`${identity} ${key} is not in the exact executable lifecycle allowlist`);
      executed.push(runScript({
        root,
        identity,
        version,
        key,
        command: manifest.scripts[key],
        metadata,
        packagePath: directory,
      }));
    }
  }
  return { ...policyResult, executed };
}

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const result = runReviewedLifecycle(root);
    console.log(`Reviewed lifecycle policy passed: ${result.executed.length} exact install script${result.executed.length === 1 ? '' : 's'} executed.`);
  } catch (error) {
    console.error(`Reviewed lifecycle policy failed: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  }
}
