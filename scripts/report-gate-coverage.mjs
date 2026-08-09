#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { GATE_RECEIPT_SCHEMA, GATE_RUN_SCHEMA, GATE_STEPS } from './lib/gate-steps.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const receiptDirectory = join(root, 'test-results', 'gate-receipts');

function readJson(path, label) {
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch (error) {
    throw new Error(`${label} is missing or invalid: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function currentCommit() {
  const result = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' });
  if (result.status !== 0 || !/^[0-9a-f]{40}\n?$/.test(result.stdout ?? '')) throw new Error('Cannot resolve current Git commit');
  return result.stdout.trim();
}

export function reportGateCoverage(env = process.env) {
  const run = readJson(join(receiptDirectory, 'run.json'), 'Gate run receipt');
  const commit = currentCommit();
  if (run.schema !== GATE_RUN_SCHEMA || run.commit !== commit || run.runId !== env.MOTIF_GATE_RUN_ID) {
    throw new Error('Gate run receipt is stale or does not match this exact commit and invocation');
  }
  const expectedSteps = GATE_STEPS.map(({ id }) => id);
  if (JSON.stringify(run.expectedSteps) !== JSON.stringify(expectedSteps)) throw new Error('Gate run step declaration is stale');

  const receipts = GATE_STEPS.map((step) => {
    const receipt = readJson(join(receiptDirectory, `${step.id}.json`), `Gate receipt for ${step.id}`);
    if (
      receipt.schema !== GATE_RECEIPT_SCHEMA
      || receipt.runId !== run.runId
      || receipt.commit !== commit
      || receipt.step !== step.id
      || receipt.exitCode !== 0
      || JSON.stringify(receipt.command) !== JSON.stringify(step.command)
    ) {
      throw new Error(`Gate receipt for ${step.id} is stale, unsuccessful, or does not match the declared command`);
    }
    return receipt;
  });

  const fixtureChecks = [
    ['synthetic demo preflight', env.MOTIF_DEMO_ARTIFACT_URL, 'MOTIF_DEMO_ARTIFACT_URL'],
    ['pathway demo preflight', env.MOTIF_PATHWAY_ARTIFACT_URL, 'MOTIF_PATHWAY_ARTIFACT_URL'],
    ['real Sanger fixture audit', env.MOTIF_REAL_AB1_DIR, 'MOTIF_REAL_AB1_DIR'],
    ['external MSA payload audit', env.MOTIF_REAL_MSA_PAYLOADS, 'MOTIF_REAL_MSA_PAYLOADS'],
  ].map(([name, value, requirement]) => ({ name, status: value ? 'executed' : 'fixture-gated', requirement }));
  const report = {
    schema: 'motif.gate-coverage.v2',
    runId: run.runId,
    commit,
    executed: receipts.map(({ step, label, command, startedAt, finishedAt, durationMs }) => ({
      step, label, command, startedAt, finishedAt, durationMs,
    })),
    fixtureChecks,
    note: 'Executed checks are supported by successful, exact-commit receipts. Fixture-gated checks remain explicitly separate.',
  };
  mkdirSync(join(root, 'dist-motif'), { recursive: true });
  writeFileSync(join(root, 'dist-motif', 'gate-coverage.json'), `${JSON.stringify(report, null, 2)}\n`);
  console.log(`Gate coverage recorded ${receipts.length} successful exact-commit steps for ${commit}.`);
  for (const check of fixtureChecks) console.log(`  ${check.status}: ${check.name} (${check.requirement})`);
  return report;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    reportGateCoverage();
  } catch (error) {
    console.error(`Gate coverage report failed: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  }
}
