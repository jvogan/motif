#!/usr/bin/env node

import { writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(new URL('..', import.meta.url).pathname);

export function reportGateCoverage(env = process.env) {
  const fixtureChecks = [
    {
      name: 'standalone artifact browser workflows',
      status: env.MOTIF_ARTIFACT_URL ? 'executed' : 'fixture-gated',
      requirement: 'MOTIF_ARTIFACT_URL is supplied by the canonical runner',
    },
    {
      name: 'synthetic demo preflight',
      status: env.MOTIF_DEMO_ARTIFACT_URL ? 'executed' : 'fixture-gated',
      requirement: 'MOTIF_DEMO_ARTIFACT_URL',
    },
    {
      name: 'pathway demo preflight',
      status: env.MOTIF_PATHWAY_ARTIFACT_URL ? 'executed' : 'fixture-gated',
      requirement: 'MOTIF_PATHWAY_ARTIFACT_URL',
    },
    {
      name: 'real Sanger fixture audit',
      status: env.MOTIF_REAL_AB1_DIR ? 'executed' : 'fixture-gated',
      requirement: 'MOTIF_REAL_AB1_DIR',
    },
    {
      name: 'external MSA payload audit',
      status: env.MOTIF_REAL_MSA_PAYLOADS ? 'executed' : 'fixture-gated',
      requirement: 'MOTIF_REAL_MSA_PAYLOADS',
    },
  ];
  const report = {
    schema: 'motif.gate-coverage.v1',
    executed: [
      'typecheck', 'lint', 'repository language policy', 'unit tests', 'release alignment', 'runtime compatibility',
      'npm audit', 'supply-chain policy', 'reviewed lifecycle scripts', 'dependency cooling-off policy', 'plugin checks', 'connector checks',
      'style/accessibility guards', 'build', 'reproducibility', 'release budgets',
      'core browser workflows', 'MSA interaction workflows',
    ],
    fixtureChecks,
    note: 'Fixture-gated checks are intentionally reported separately from executed checks; no fixture is silently treated as a pass.',
  };
  writeFileSync(join(root, 'dist-motif/gate-coverage.json'), `${JSON.stringify(report, null, 2)}\n`);
  console.log('Gate coverage:');
  console.log(`  executed: ${report.executed.join(', ')}`);
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
