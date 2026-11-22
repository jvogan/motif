#!/usr/bin/env node

import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { constants, cpSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isDirectScriptExecution } from './lib/direct-script.mjs';
import { assertCleanGateSource } from './lib/gate-source.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const outputDirectory = join(root, 'dist-motif');
const buildScript = 'scripts/build-claude-science-artifact.mjs';

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

function buildOnce(commit) {
  const checkout = mkdtempSync(join(tmpdir(), 'motif-reproducibility-'));
  try {
    const archive = join(checkout, 'source.tar');
    const source = join(checkout, 'source');
    execFileSync('git', ['archive', '--format=tar', '-o', archive, commit], { cwd: root });
    mkdirSync(source);
    execFileSync('tar', ['-xf', archive, '-C', source]);
    // Bundled module identities include their path relative to the source root.
    // Install dependencies into the same relative layout in both clean builds.
    cpSync(join(root, 'node_modules'), join(source, 'node_modules'), {
      recursive: true,
      verbatimSymlinks: true,
      mode: constants.COPYFILE_FICLONE,
    });
    const result = spawnSync(process.execPath, [buildScript], { cwd: source, stdio: 'inherit' });
    if (result.status !== 0) throw new Error(`Deterministic build failed with status ${result.status ?? 'unknown'}`);
    return hashFiles(join(source, 'dist-motif'));
  } finally {
    rmSync(checkout, { recursive: true, force: true });
  }
}

export function compareBuildInventories(first, second) {
  const firstJson = JSON.stringify(first, null, 2);
  const secondJson = JSON.stringify(second, null, 2);
  if (firstJson !== secondJson) {
    const names = [...new Set([...Object.keys(first), ...Object.keys(second)])].sort();
    const differences = names.filter(name => first[name] !== second[name]);
    throw new Error(`Two clean builds differ in ${differences.length} file(s): ${differences.join(', ')}`);
  }
  return { fileCount: Object.keys(second).length, outputSha256: sha256(secondJson) };
}

// Inside the gate, the build that earlier steps tested is the first build. Other
// gate steps add their own outputs beside it (the Codex skills-only plugin, for
// one), so only the files a clean release build produces are compared, and each
// of them must be present and identical.
function gateOutputFor(cleanBuild) {
  const gateOutput = hashFiles(outputDirectory);
  return Object.fromEntries(Object.keys(cleanBuild).map(name => [name, gateOutput[name] ?? null]));
}

export function checkReleaseReproducibility() {
  const reuse = process.env.MOTIF_GATE_STEP === 'reproducibility';
  const commit = assertCleanGateSource(root, process.env.MOTIF_GATE_COMMIT);
  const clean = buildOnce(commit);
  const first = reuse ? gateOutputFor(clean) : buildOnce(commit);
  return compareBuildInventories(first, clean);
}

if (isDirectScriptExecution(process.argv[1], fileURLToPath(import.meta.url))) {
  try {
    if (!existsSync(join(root, 'node_modules'))) throw new Error('Maintainer reproducibility checks require installed build dependencies');
    const result = checkReleaseReproducibility();
    console.log(`Two clean release builds match: ${result.fileCount} files, inventory hash ${result.outputSha256}.`);
  } catch (error) {
    console.error(`Release reproducibility failed: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  }
}
