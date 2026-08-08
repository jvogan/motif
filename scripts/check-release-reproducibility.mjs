#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, lstatSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const outputDirectory = join(root, 'dist-motif');
const buildScript = join(root, 'scripts', 'build-claude-science-artifact.mjs');

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function hashFiles(directory, base = directory, output = {}) {
  for (const entry of readdirSync(directory, { withFileTypes: true }).sort((left, right) => left.name.localeCompare(right.name))) {
    const path = join(directory, entry.name);
    const stat = lstatSync(path);
    if (stat.isSymbolicLink()) throw new Error(`Reproducibility output contains a symbolic link: ${relative(base, path)}`);
    if (entry.isDirectory()) hashFiles(path, base, output);
    else if (entry.isFile()) output[relative(base, path).split(sep).join('/')] = sha256(readFileSync(path));
    else throw new Error(`Reproducibility output contains a special file: ${relative(base, path)}`);
  }
  return output;
}

function buildOnce() {
  const result = spawnSync(process.execPath, [buildScript], { cwd: root, stdio: 'inherit' });
  if (result.status !== 0) throw new Error(`Deterministic build failed with status ${result.status ?? 'unknown'}`);
  return hashFiles(outputDirectory);
}

export function checkReleaseReproducibility() {
  rmSync(outputDirectory, { recursive: true, force: true });
  const first = buildOnce();
  rmSync(outputDirectory, { recursive: true, force: true });
  const second = buildOnce();
  const firstJson = JSON.stringify(first, null, 2);
  const secondJson = JSON.stringify(second, null, 2);
  if (firstJson !== secondJson) {
    const names = [...new Set([...Object.keys(first), ...Object.keys(second)])].sort();
    const differences = names.filter(name => first[name] !== second[name]);
    throw new Error(`Two clean builds differ in ${differences.length} file(s): ${differences.join(', ')}`);
  }
  return { fileCount: Object.keys(second).length, outputSha256: sha256(secondJson) };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    if (!existsSync(join(root, 'node_modules'))) throw new Error('Maintainer reproducibility checks require installed build dependencies');
    const result = checkReleaseReproducibility();
    console.log(`Two clean release builds match: ${result.fileCount} files, inventory hash ${result.outputSha256}.`);
  } catch (error) {
    console.error(`Release reproducibility failed: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  }
}
