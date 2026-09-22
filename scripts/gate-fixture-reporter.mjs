import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { GATE_FIXTURES, GATE_FIXTURE_SCHEMA } from './lib/gate-fixtures.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

export function fixtureOutcomes(suite, rootDirectory, definitions = GATE_FIXTURES) {
  return definitions.map(({ id, name, file, title }) => {
    const sourceExists = existsSync(resolve(rootDirectory, file));
    const tests = suite.allTests().filter(test => (
      resolve(test.location.file) === resolve(rootDirectory, file) && test.title === title
    ));
    const counts = { passed: 0, skipped: 0, failed: 0, missing: 0 };
    for (const test of tests) {
      if (!test.results.length) counts.missing++;
      else if (test.results.every(result => result.status === 'skipped')) counts.skipped++;
      else if (test.expectedStatus === 'passed' && test.results.every(result => result.status === 'passed')) counts.passed++;
      else counts.failed++;
    }
    const status = !sourceExists && !tests.length ? 'not-applicable'
      : !tests.length || counts.missing ? 'missing'
        : counts.failed ? 'failed'
          : counts.skipped ? 'skipped' : 'executed';
    return { id, name, status, counts };
  });
}

export default class GateFixtureReporter {
  onBegin(_config, suite) { this.suite = suite; }

  onEnd(result) {
    const { MOTIF_GATE_RUN_ID: runId, MOTIF_GATE_COMMIT: commit, MOTIF_GATE_STEP: step } = process.env;
    if (!runId || !commit || step !== 'core-browser-workflows') {
      throw new Error('Fixture evidence requires the core browser gate invocation');
    }
    const directory = join(root, 'test-results', 'gate-receipts');
    mkdirSync(directory, { recursive: true });
    // Store only fixed check identifiers and counts; never fixture paths or browser diagnostics.
    writeFileSync(join(directory, 'fixtures.json'), `${JSON.stringify({
      schema: GATE_FIXTURE_SCHEMA, runId, commit, step, status: result.status,
      checks: fixtureOutcomes(this.suite, root),
    }, null, 2)}\n`);
  }
}
