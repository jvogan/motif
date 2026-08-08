#!/usr/bin/env node

import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { compareConnectorInventory, checkLockfilePolicy, loadDependencyPolicy } from './lib/supply-chain-policy.mjs';
import { verifyReleaseBundle } from './lib/motif-release-bundle.mjs';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));

function readJson(path, label) {
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch (error) {
    throw new Error(`${label} is not valid JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
}

export function checkSupplyChainPolicy(rootPath = root) {
  const workspace = resolve(rootPath);
  const summary = checkLockfilePolicy(workspace);
  const { inventory } = loadDependencyPolicy(workspace);
  const releasePath = join(workspace, 'dist-motif', 'motif-for-claude-science-release');
  if (existsSync(releasePath)) {
    const generated = readJson(join(releasePath, 'connector-inventory.json'), 'Generated connector inventory');
    compareConnectorInventory(inventory, generated);
    verifyReleaseBundle(releasePath, { expectedVersion: readJson(join(workspace, 'package.json'), 'package.json').version });
  }
  return { ...summary, releaseChecked: existsSync(releasePath) };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const result = checkSupplyChainPolicy();
    console.log(`Supply-chain policy passed: ${result.packageCount} lockfile packages; ${result.connectorPackageCount} bundled connector packages; release checked: ${result.releaseChecked}.`);
  } catch (error) {
    console.error(`Supply-chain policy failed: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  }
}
