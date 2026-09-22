#!/usr/bin/env node

import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { assertCleanGateSource } from './lib/gate-source.mjs';
import { GATE_FIXTURES, GATE_FIXTURE_SCHEMA } from './lib/gate-fixtures.mjs';
import { GATE_RECEIPT_SCHEMA, GATE_RUN_SCHEMA, GATE_STEPS } from './lib/gate-steps.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

function readJson(path, label) {
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch (error) {
    throw new Error(`${label} is missing or invalid: ${error instanceof Error ? error.message : String(error)}`);
  }
}

export function reportGateCoverage(env = process.env, rootDirectory = root, steps = GATE_STEPS) {
  const receiptDirectory = join(rootDirectory, 'test-results', 'gate-receipts');
  rmSync(join(rootDirectory, 'dist-motif', 'gate-coverage.json'), { force: true });
  const run = readJson(join(receiptDirectory, 'run.json'), 'Gate run receipt');
  const commit = assertCleanGateSource(rootDirectory);
  if (run.schema !== GATE_RUN_SCHEMA || run.commit !== commit || run.runId !== env.MOTIF_GATE_RUN_ID) {
    throw new Error('Gate run receipt is stale or does not match this exact commit and invocation');
  }
  const expectedSteps = steps.map(({ id }) => id);
  if (JSON.stringify(run.expectedSteps) !== JSON.stringify(expectedSteps)) throw new Error('Gate run step declaration is stale');

  const receipts = steps.map((step) => {
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

  const evidence = readJson(join(receiptDirectory, 'fixtures.json'), 'Browser fixture evidence');
  if (evidence.schema !== GATE_FIXTURE_SCHEMA || evidence.runId !== run.runId
    || evidence.commit !== commit || evidence.step !== 'core-browser-workflows' || evidence.status !== 'passed') {
    throw new Error('Browser fixture evidence is stale or unsuccessful');
  }
  if (JSON.stringify(evidence.checks?.map(({ id }) => id)) !== JSON.stringify(GATE_FIXTURES.map(({ id }) => id))) {
    throw new Error('Browser fixture evidence does not match the declared checks');
  }
  const fixtureChecks = evidence.checks;
  for (const check of fixtureChecks) {
    const { passed, skipped, failed, missing } = check.counts ?? {};
    if (![passed, skipped, failed, missing].every(value => Number.isSafeInteger(value) && value >= 0)
      || failed || missing
      || !['executed', 'skipped', 'not-applicable'].includes(check.status)
      || (check.status === 'executed' && (!passed || skipped))
      || (check.status === 'skipped' && !skipped)
      || (check.status === 'not-applicable' && (passed || skipped))) {
      throw new Error('Browser fixture evidence is incomplete or unsuccessful');
    }
  }
  assertCleanGateSource(rootDirectory, commit);
  const report = {
    schema: 'motif.gate-coverage.v3',
    runId: run.runId,
    commit,
    executed: receipts.map(({ step, label, command, startedAt, finishedAt, durationMs }) => ({
      step, label, command, startedAt, finishedAt, durationMs,
    })),
    fixtureChecks,
    note: 'Executed checks are supported by successful, exact-commit receipts. Fixture statuses come from browser test results for this invocation.',
  };
  mkdirSync(join(rootDirectory, 'dist-motif'), { recursive: true });
  writeFileSync(join(rootDirectory, 'dist-motif', 'gate-coverage.json'), `${JSON.stringify(report, null, 2)}\n`);
  console.log(`Gate coverage recorded ${receipts.length} successful exact-commit steps for ${commit}.`);
  for (const check of fixtureChecks) console.log(`  ${check.status}: ${check.name}`);
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
