#!/usr/bin/env node

import { randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { GATE_RECEIPT_SCHEMA, GATE_RUN_SCHEMA, GATE_STEPS } from './lib/gate-steps.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const receiptDirectory = join(root, 'test-results', 'gate-receipts');

function gitHead() {
  const result = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' });
  if (result.status !== 0 || !/^[0-9a-f]{40}\n?$/.test(result.stdout ?? '')) {
    throw new Error('Canonical gate requires a Git commit so its receipts can be bound to exact source');
  }
  return result.stdout.trim();
}

function writeJson(path, value) {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}

export function runGate({ env = process.env } = {}) {
  const commit = gitHead();
  const runId = randomUUID();
  rmSync(receiptDirectory, { recursive: true, force: true });
  mkdirSync(receiptDirectory, { recursive: true });
  writeJson(join(receiptDirectory, 'run.json'), {
    schema: GATE_RUN_SCHEMA,
    runId,
    commit,
    startedAt: new Date().toISOString(),
    expectedSteps: GATE_STEPS.map(({ id }) => id),
  });

  for (const step of GATE_STEPS) {
    const startedAt = new Date();
    console.log(`\n=== ${step.label} ===`);
    const executable = process.platform === 'win32' && step.command[0] === 'npm' ? 'npm.cmd' : step.command[0];
    const result = spawnSync(executable, step.command.slice(1), {
      cwd: root,
      env: { ...env, MOTIF_GATE_RUN_ID: runId, MOTIF_GATE_COMMIT: commit },
      stdio: 'inherit',
      shell: false,
    });
    const finishedAt = new Date();
    const exitCode = result.status ?? 1;
    writeJson(join(receiptDirectory, `${step.id}.json`), {
      schema: GATE_RECEIPT_SCHEMA,
      runId,
      commit,
      step: step.id,
      label: step.label,
      command: step.command,
      startedAt: startedAt.toISOString(),
      finishedAt: finishedAt.toISOString(),
      durationMs: finishedAt.getTime() - startedAt.getTime(),
      exitCode,
      signal: result.signal ?? null,
    });
    if (exitCode !== 0) return exitCode;
  }

  const report = spawnSync(process.execPath, [join(root, 'scripts', 'report-gate-coverage.mjs')], {
    cwd: root,
    env: { ...env, MOTIF_GATE_RUN_ID: runId, MOTIF_GATE_COMMIT: commit },
    stdio: 'inherit',
    shell: false,
  });
  return report.status ?? 1;
}

try {
  process.exitCode = runGate();
} catch (error) {
  console.error(`Gate failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
}
