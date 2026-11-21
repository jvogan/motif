import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { GATE_FIXTURES, GATE_FIXTURE_SCHEMA, isOptionalFixture } from './lib/gate-fixtures.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

export function testOutcomes(tests) {
  const counts = { passed: 0, skipped: 0, failed: 0, missing: 0 };
  for (const test of tests) {
    if (!test.results.length) counts.missing++;
    else if (test.results.every(result => result.status === 'skipped')) counts.skipped++;
    else if (test.expectedStatus === 'passed' && test.results.every(result => result.status === 'passed')) counts.passed++;
    else counts.failed++;
  }
  return counts;
}

export function fixtureOutcomes(suite, rootDirectory, definitions = GATE_FIXTURES) {
  return definitions.map((definition) => {
    const { id, name, file, title } = definition;
    const optional = isOptionalFixture(definition);
    const sourcePath = resolve(rootDirectory, file);
    const sourceExists = existsSync(sourcePath);
    const tests = suite.allTests().filter(test => (
      resolve(test.location.file) === sourcePath && test.title === title
    ));
    const counts = testOutcomes(tests);
    // Only an optional fixture whose spec file is absent is not applicable. A
    // required fixture with no spec file or no observed result is missing, so
    // deleting or renaming its spec cannot turn the check green.
    const status = optional && !sourceExists && !tests.length ? 'not-applicable'
      : !sourceExists || !tests.length || counts.missing ? 'missing'
        : counts.failed ? 'failed'
          : counts.skipped ? 'skipped' : 'executed';
    return { id, name, status, counts };
  });
}

export default class GateFixtureReporter {
  onBegin(_config, suite) { this.suite = suite; }

  onEnd(result) {
    const { MOTIF_GATE_RUN_ID: runId, MOTIF_GATE_COMMIT: commit, MOTIF_GATE_STEP: step } = process.env;
    const core = step === 'core-browser-workflows';
    if (!runId || !commit || (!core && step !== 'msa-browser-workflows')) {
      throw new Error('Fixture evidence requires a browser gate invocation');
    }
    const primaryFile = resolve(root, core
      ? 'e2e/claude-science-artifact.spec.ts'
      : 'e2e/claude-science-msa-interactions.spec.ts');
    const primary = this.suite.allTests().filter(test => resolve(test.location.file) === primaryFile);
    const directory = join(root, 'test-results', 'gate-receipts');
    mkdirSync(directory, { recursive: true });
    // Store only fixed check identifiers and counts; never fixture paths or browser diagnostics.
    writeFileSync(join(directory, core ? 'fixtures.json' : 'msa-fixtures.json'), `${JSON.stringify({
      schema: GATE_FIXTURE_SCHEMA, runId, commit, step, status: result.status,
      suite: testOutcomes(primary),
      checks: core ? fixtureOutcomes(this.suite, root) : [],
    }, null, 2)}\n`);
  }
}
