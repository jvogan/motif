import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { assertCleanGateSource } from '../lib/gate-source.mjs';
import { GATE_FIXTURES, GATE_FIXTURE_SCHEMA, isOptionalFixture } from '../lib/gate-fixtures.mjs';
import { GATE_RECEIPT_SCHEMA, GATE_RUN_SCHEMA } from '../lib/gate-steps.mjs';
import { fixtureOutcomes } from '../gate-fixture-reporter.mjs';
import { runGate } from '../run-gate.mjs';
import { reportGateCoverage } from '../report-gate-coverage.mjs';

const temporaryRoots = [];
const git = (root, ...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
function put(root, name, value) {
  const path = join(root, name);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, typeof value === 'string' ? value : `${JSON.stringify(value)}\n`);
}
function workspace() {
  const root = mkdtempSync(join(tmpdir(), 'motif-gate-test-'));
  temporaryRoots.push(root);
  git(root, 'init', '-q');
  git(root, 'config', 'user.name', 'Test');
  git(root, 'config', 'user.email', 'test@example.invalid');
  git(root, 'config', 'commit.gpgsign', 'false');
  put(root, '.gitignore', readFileSync(new URL('../../.gitignore', import.meta.url), 'utf8'));
  put(root, 'source.txt', 'committed source\n');
  git(root, 'add', '.');
  git(root, 'commit', '-qm', 'Test fixture');
  return root;
}
const executedCheck = { status: 'executed', counts: { passed: 1, skipped: 0, failed: 0, missing: 0 } };
const skippedCheck = { status: 'skipped', counts: { passed: 0, skipped: 1, failed: 0, missing: 0 } };
const notApplicableCheck = { status: 'not-applicable', counts: { passed: 0, skipped: 0, failed: 0, missing: 0 } };
const missingCheck = { status: 'missing', counts: { passed: 0, skipped: 0, failed: 0, missing: 0 } };
function evidence(root, definitions = GATE_FIXTURES) {
  const commit = git(root, 'rev-parse', 'HEAD');
  const runId = 'test-invocation';
  const steps = [{ id: 'core-browser-workflows', command: ['npm', 'run', 'test:e2e'], label: 'Browser tests' }];
  put(root, 'test-results/gate-receipts/run.json', {
    schema: GATE_RUN_SCHEMA, runId, commit, expectedSteps: steps.map(step => step.id),
  });
  put(root, 'test-results/gate-receipts/core-browser-workflows.json', {
    schema: GATE_RECEIPT_SCHEMA, runId, commit, step: steps[0].id, command: steps[0].command, exitCode: 0,
  });
  const fixtures = {
    schema: GATE_FIXTURE_SCHEMA, runId, commit, step: 'core-browser-workflows', status: 'passed',
    checks: definitions.map((definition) => ({
      id: definition.id, name: definition.name,
      ...structuredClone(isOptionalFixture(definition) ? skippedCheck : executedCheck),
    })),
  };
  put(root, 'test-results/gate-receipts/fixtures.json', fixtures);
  return { env: { MOTIF_GATE_RUN_ID: runId }, steps, fixtures };
}
afterEach(() => {
  for (const root of temporaryRoots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe('committed gate source boundary', () => {
  it.each(['modified', 'staged', 'untracked', 'deleted'])('rejects %s source', mode => {
    const root = workspace();
    if (mode === 'deleted') rmSync(join(root, 'source.txt'));
    else put(root, mode === 'untracked' ? 'new-source.txt' : 'source.txt', 'changed');
    if (mode === 'staged') git(root, 'add', 'source.txt');
    expect(() => assertCleanGateSource(root)).toThrow(/clean committed source/);
  });
  it('allows ignored outputs but rejects a different commit', () => {
    const root = workspace();
    const head = assertCleanGateSource(root);
    put(root, 'dist-motif/artifact.html', 'generated output');
    expect(assertCleanGateSource(root, head)).toBe(head);
    git(root, 'commit', '--allow-empty', '-qm', 'Next fixture');
    expect(() => assertCleanGateSource(root, head)).toThrow(/commit changed/);
  });
  it('allows the generated scanner report without ignoring other untracked files', () => {
    const root = workspace();
    const head = assertCleanGateSource(root);
    put(root, 'results.sarif', '{}');
    expect(assertCleanGateSource(root, head)).toBe(head);
    put(root, 'unexpected-source.txt', 'uncommitted');
    expect(() => assertCleanGateSource(root, head)).toThrow(/clean committed source/);
  });
  it('rejects mutation by a successful gate step before recording success', () => {
    const root = workspace();
    expect(() => runGate({ rootDirectory: root, steps: [{
      id: 'mutator', label: 'Mutation probe',
      command: [process.execPath, '-e', "require('node:fs').writeFileSync('source.txt', 'changed')"],
    }] })).toThrow(/clean committed source/);
    expect(existsSync(join(root, 'test-results/gate-receipts/mutator.json'))).toBe(false);
    expect(existsSync(join(root, 'dist-motif/gate-coverage.json'))).toBe(false);
  });
});

describe('browser fixture outcomes', () => {
  const definition = { id: 'fixture', name: 'Fixture audit', file: 'fixture.spec.ts', title: 'fixture test' };
  function outcome(root, statuses, expectedStatus = 'passed', overrides = {}) {
    const tests = statuses.map(results => ({
      title: definition.title, location: { file: join(root, definition.file) }, expectedStatus,
      results: results.map(status => ({ status })),
    }));
    return fixtureOutcomes({ allTests: () => tests }, root, [{ ...definition, ...overrides }])[0];
  }
  it('reports an absent spec file as missing unless the fixture is optional', () => {
    const root = workspace();
    expect(outcome(root, []).status).toBe('missing');
    expect(outcome(root, [], 'passed', { required: true }).status).toBe('missing');
    expect(outcome(root, [], 'passed', { optional: true }).status).toBe('not-applicable');
    expect(() => outcome(root, [], 'passed', { optional: true, required: true })).toThrow(/both required and optional/);
  });
  it('requires observed successful results and distinguishes absent, missing and skipped tests', () => {
    const root = workspace();
    put(root, definition.file, '// fixture');
    expect(outcome(root, [], 'passed', { optional: true }).status).toBe('missing');
    expect(outcome(root, []).status).toBe('missing');
    expect(outcome(root, [[]]).status).toBe('missing');
    expect(outcome(root, [['skipped']]).status).toBe('skipped');
    expect(outcome(root, [['passed']]).status).toBe('executed');
    expect(outcome(root, [['passed'], ['skipped']]).status).toBe('skipped');
    expect(outcome(root, [['failed', 'passed']]).status).toBe('failed');
    expect(outcome(root, [['failed']], 'failed').status).toBe('failed');
  });
});

describe('coverage evidence verification', () => {
  it('declares an always-executed fixture and keeps real-data fixtures optional', () => {
    expect(GATE_FIXTURES.filter(definition => !isOptionalFixture(definition)).map(({ id }) => id)).toEqual(['synthetic-sanger']);
    expect(GATE_FIXTURES.filter(isOptionalFixture).map(({ id }) => id)).toEqual(['real-sanger', 'external-msa']);
    for (const { file } of GATE_FIXTURES) expect(existsSync(new URL(`../../${file}`, import.meta.url))).toBe(true);
  });
  it('uses actual skip receipts even when fixture environment variables are set', () => {
    const root = workspace();
    const { env, steps } = evidence(root);
    const report = reportGateCoverage({ ...env, MOTIF_REAL_MSA_PAYLOADS: 'missing.json', MOTIF_DEMO_ARTIFACT_URL: 'http://example.invalid' }, root, steps);
    for (const check of report.fixtureChecks) {
      const definition = GATE_FIXTURES.find(({ id }) => id === check.id);
      expect(check.status).toBe(isOptionalFixture(definition) ? 'skipped' : 'executed');
    }
  });
  describe('required and optional fixture statuses', () => {
    const optionalDefinition = { id: 'optional-audit', name: 'Optional audit', file: 'optional.spec.ts', title: 'optional', optional: true };
    const requiredDefinition = { id: 'required-audit', name: 'Required audit', file: 'required.spec.ts', title: 'required', required: true };
    const definitions = [optionalDefinition, requiredDefinition];
    function verify(optionalCheck, requiredCheck) {
      const root = workspace();
      const { env, steps, fixtures } = evidence(root, definitions);
      Object.assign(fixtures.checks[0], structuredClone(optionalCheck));
      Object.assign(fixtures.checks[1], structuredClone(requiredCheck));
      put(root, 'test-results/gate-receipts/fixtures.json', fixtures);
      return () => reportGateCoverage(env, root, steps, definitions);
    }
    it('accepts an optional fixture whose spec file is absent', () => {
      expect(verify(notApplicableCheck, executedCheck)().fixtureChecks.map(({ status }) => status))
        .toEqual(['not-applicable', 'executed']);
    });
    it('accepts a skipped optional fixture beside an executed required fixture', () => {
      expect(verify(skippedCheck, executedCheck)().fixtureChecks.map(({ status }) => status))
        .toEqual(['skipped', 'executed']);
    });
    it.each([
      ['missing', missingCheck],
      ['skipped', skippedCheck],
      ['not-applicable', notApplicableCheck],
    ])('rejects a required fixture reported as %s', (_label, requiredCheck) => {
      expect(verify(skippedCheck, requiredCheck)).toThrow(/fixture evidence/);
    });
    it('rejects an optional fixture reported as missing', () => {
      expect(verify(missingCheck, executedCheck)).toThrow(/fixture evidence/);
    });
    it('derives the required fixture status end to end when its spec file is deleted', () => {
      const root = workspace();
      const [optionalOutcome, requiredOutcome] = fixtureOutcomes({ allTests: () => [] }, root, definitions);
      expect(optionalOutcome.status).toBe('not-applicable');
      expect(requiredOutcome.status).toBe('missing');
      const { env, steps, fixtures } = evidence(root, definitions);
      fixtures.checks = [optionalOutcome, requiredOutcome];
      put(root, 'test-results/gate-receipts/fixtures.json', fixtures);
      expect(() => reportGateCoverage(env, root, steps, definitions)).toThrow(/fixture evidence/);
    });
  });
  it('rejects edited source after a successful report and removes stale success output', () => {
    const root = workspace();
    const { env, steps } = evidence(root);
    reportGateCoverage(env, root, steps);
    put(root, 'source.txt', 'changed after the run');
    expect(() => reportGateCoverage(env, root, steps)).toThrow(/clean committed source/);
    expect(existsSync(join(root, 'dist-motif/gate-coverage.json'))).toBe(false);
  });
  it.each(['absent', 'stale', 'failed-run', 'missing-test', 'failed-test', 'false-pass', 'wrong-step'])('rejects %s browser evidence', mode => {
    const root = workspace();
    const { env, steps, fixtures } = evidence(root);
    if (mode === 'stale') fixtures.runId = 'earlier-invocation';
    if (mode === 'failed-run') fixtures.status = 'failed';
    if (mode === 'missing-test') fixtures.checks[0].status = 'missing';
    if (mode === 'failed-test') fixtures.checks[0].counts.failed = 1;
    if (mode === 'false-pass') Object.assign(fixtures.checks[0], { status: 'executed', counts: { passed: 0, skipped: 1, failed: 0, missing: 0 } });
    if (mode === 'wrong-step') fixtures.step = 'msa-browser-workflows';
    put(root, 'test-results/gate-receipts/fixtures.json', fixtures);
    if (mode === 'absent') rmSync(join(root, 'test-results/gate-receipts/fixtures.json'));
    expect(() => reportGateCoverage(env, root, steps)).toThrow(/fixture evidence/);
  });
  it('rejects obsolete unguarded receipts', () => {
    const root = workspace();
    const { env, steps } = evidence(root);
    const file = 'test-results/gate-receipts/run.json';
    const run = JSON.parse(readFileSync(join(root, file), 'utf8'));
    put(root, file, { ...run, schema: 'motif.gate-run.v1' });
    expect(() => reportGateCoverage(env, root, steps)).toThrow(/stale/);
  });
});
