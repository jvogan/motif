#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { existsSync, lstatSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const packageNameFromLockPath = lockPath => lockPath.replace(/^node_modules\//u, '').split('/node_modules/').at(-1);

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

function declaredDependencyNames(packageJson) {
  const names = new Set();
  for (const field of ['dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies']) {
    for (const name of Object.keys(packageJson[field] ?? {})) names.add(name);
  }
  return names;
}

function packageManifest(lockPath) {
  const path = join(root, lockPath, 'package.json');
  if (!existsSync(path)) return {};
  const stat = lstatSync(path);
  if (stat.isSymbolicLink() || !stat.isFile()) throw new Error(`Package manifest is not a regular file: ${path}`);
  return readJson(path);
}

function licenseFile(workspace, lockPath, manifest) {
  const directory = join(workspace, lockPath);
  if (!existsSync(directory)) return null;
  const candidates = readdirSync(directory)
    .filter(name => /^(?:license|copying|notice)(?:\.|$)/iu.test(name))
    .sort();
  const candidate = candidates.find(name => lstatSync(join(directory, name)).isFile());
  return candidate ? join(directory, candidate) : (manifest.license ? null : null);
}

export function createDeterministicSbom(rootPath = root) {
  const workspace = resolve(rootPath);
  const lock = readJson(join(workspace, 'package-lock.json'));
  const packageJson = readJson(join(workspace, 'package.json'));
  const declaredDependencies = declaredDependencyNames(packageJson);
  const components = Object.entries(lock.packages ?? {})
    .filter(([lockPath]) => lockPath !== '')
    .map(([lockPath, metadata]) => {
      const manifestPath = join(workspace, lockPath, 'package.json');
      const manifest = existsSync(manifestPath) ? readJson(manifestPath) : {};
      const name = typeof manifest.name === 'string' && manifest.name ? manifest.name : packageNameFromLockPath(lockPath);
      const licensePath = licenseFile(workspace, lockPath, manifest);
      return {
        name,
        version: metadata.version,
        scope: declaredDependencies.has(name) ? 'direct' : 'transitive',
        resolved: metadata.resolved,
        integrity: metadata.integrity,
        license: manifest.license ?? null,
        licenseFile: licensePath ? licensePath.slice(workspace.length + 1).split('\\').join('/') : null,
        licenseSha256: licensePath ? sha256(readFileSync(licensePath)) : null,
      };
    })
    .sort((left, right) => `${left.name}@${left.version}`.localeCompare(`${right.name}@${right.version}`));
  return {
    schema: 'motif.sbom.cyclonedx-lite.v1',
    product: packageJson.name,
    version: packageJson.version,
    lockfileVersion: lock.lockfileVersion,
    components,
  };
}

export function writeDeterministicSbom(outputPath, rootPath = root) {
  const sbom = createDeterministicSbom(rootPath);
  writeFileSync(outputPath, `${JSON.stringify(sbom, null, 2)}\n`);
  return sbom;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const output = process.argv[2] ? resolve(process.argv[2]) : join(root, 'dist-motif', 'motif-sbom.json');
  writeDeterministicSbom(output);
  console.log(`Wrote deterministic SBOM ${output}`);
}
