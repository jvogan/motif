#!/usr/bin/env node

import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import semver from 'semver';

const root = resolve(new URL('..', import.meta.url).pathname);
const REVIEWED_NODE = '22.13.0';

function json(relativePath) {
  return JSON.parse(readFileSync(join(root, relativePath), 'utf8'));
}

export function checkRuntimeCompatibility() {
  const packageManifest = json('package.json');
  const lock = json('package-lock.json');
  const rootEngine = packageManifest.engines?.node;
  if (!rootEngine || !semver.satisfies(REVIEWED_NODE, rootEngine)) {
    throw new Error(`package.json engines.node does not accept reviewed Node ${REVIEWED_NODE}: ${rootEngine}`);
  }
  const lockEngine = lock.packages?.['']?.engines?.node;
  if (lockEngine !== rootEngine) throw new Error(`package-lock root engine ${lockEngine} differs from package.json ${rootEngine}`);
  const incompatible = [];
  let engineCount = 0;
  for (const [path, metadata] of Object.entries(lock.packages ?? {})) {
    const range = metadata.engines?.node;
    if (!range) continue;
    engineCount += 1;
    if (!semver.validRange(range) || !semver.satisfies(REVIEWED_NODE, range)) incompatible.push(`${path}: ${range}`);
  }
  if (incompatible.length > 0) {
    throw new Error(`Node ${REVIEWED_NODE} is incompatible with locked packages: ${incompatible.join('; ')}`);
  }
  const nvm = readFileSync(join(root, '.nvmrc'), 'utf8').trim();
  if (nvm !== REVIEWED_NODE) throw new Error(`.nvmrc is ${nvm}, expected ${REVIEWED_NODE}`);
  const workflow = readFileSync(join(root, '.github/workflows/ci.yml'), 'utf8');
  if (!workflow.includes(`node-version: ${REVIEWED_NODE}`)) throw new Error('CI does not pin the reviewed Node runtime');
  return { reviewedNode: REVIEWED_NODE, engineCount, rootEngine };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const result = checkRuntimeCompatibility();
    console.log(`Runtime compatibility passed: Node ${result.reviewedNode}; ${result.engineCount} locked package engine constraints checked.`);
  } catch (error) {
    console.error(`Runtime compatibility failed: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  }
}
