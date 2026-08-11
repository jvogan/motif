import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { GATE_STEPS } from '../lib/gate-steps.mjs';
import { checkSupplyChainPolicy } from '../check-supply-chain-policy.mjs';

// `npm run gate` is the canonical local and hosted check sequence. The runner
// writes exact-commit receipts for these shared step declarations.

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const workflow = readFileSync(resolve(root, '.github/workflows/ci.yml'), 'utf8');
const pkg = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8'));

describe('npm run gate matches CI', () => {
  it('uses the same receipt-producing runner locally and in hosted CI', () => {
    expect(pkg.scripts.gate).toBe('node scripts/run-gate.mjs');
    expect(workflow.match(/run: npm run gate/g)).toHaveLength(1);
    expect(workflow).toContain('MOTIF_COOLING_OFF_BASE_SHA:');
  });

  it('declares a non-trivial, safely ordered gate', () => {
    const ids = GATE_STEPS.map(({ id }) => id);
    expect(ids.length).toBeGreaterThan(15);
    expect(ids).not.toContain('release-publish');
    expect(pkg.scripts['check:release-publish']).toBe('node scripts/check-release-publish.mjs');
    expect(ids.indexOf('supply-chain-policy')).toBeLessThan(ids.indexOf('reviewed-lifecycle'));
    expect(ids.indexOf('build')).toBeLessThan(ids.indexOf('post-build-release-verification'));
    expect(ids.indexOf('post-build-release-verification')).toBeLessThan(ids.indexOf('reproducibility'));
  });

  it('disables npm lifecycle execution during installation', () => {
    expect(workflow).toContain('run: npm ci --ignore-scripts');
    expect(workflow.indexOf('run: npm ci --ignore-scripts')).toBeLessThan(workflow.indexOf('run: npm run gate'));
  });

  it('retains browser and exact-commit gate evidence', () => {
    expect(workflow).toContain('actions/upload-artifact@043fb46d1a93c77aae656e7c1c64a875d1fc6a0a');
    expect(workflow).toContain('test-results/');
    expect(workflow).toContain('dist-motif/gate-coverage.json');
    expect(workflow).toContain('dist-motif/release-confidence-report.json');
  });

  it('rechecks release review threads on review and review-comment events', () => {
    expect(workflow).toContain('pull_request_review:');
    expect(workflow).toContain('types: [submitted, edited, dismissed]');
    expect(workflow).toContain('pull_request_review_comment:');
    expect(workflow).toContain('types: [created, edited, deleted]');
    expect(workflow).toContain('run: node scripts/check-release-review-threads.mjs --github --require-release');
    expect(workflow).toContain('github.event.pull_request.base.sha || github.event.before');
    expect(workflow).toMatch(/if: startsWith\(github\.head_ref, 'release\/'/u);
    expect(workflow).toContain("startsWith(github.event.pull_request.head.ref, 'release/')");
    expect(workflow).toContain('GH_TOKEN: ${{ github.token }}');
  });

  it('pins every hosted action to an exact 40-character commit SHA', () => {
    const actionRefs = [...workflow.matchAll(/^\s*uses:\s*([^\s#]+)/gm)].map((match) => match[1]);
    expect(actionRefs.length).toBeGreaterThan(0);
    for (const ref of actionRefs) expect(ref).toMatch(/^[^@]+@[a-f0-9]{40}$/);
  });

  it('executes the declared Node 24 compatibility branch', () => {
    expect(workflow).toContain('node-24-compatibility:');
    expect(workflow).toContain('node-version: 24');
    expect(workflow).toContain('run: npm run typecheck');
    expect(workflow).toContain('run: npm test');
  });
});

describe('post-build release verification', () => {
  it('fails before policy work when the generated release is missing', () => {
    const emptyWorkspace = mkdtempSync(join(tmpdir(), 'motif-release-required-'));
    try {
      expect(() => checkSupplyChainPolicy(emptyWorkspace, { requireRelease: true }))
        .toThrow(/Generated release bundle is required/);
    } finally {
      rmSync(emptyWorkspace, { recursive: true, force: true });
    }
  });
});

// The root tsconfig is solution-style: `{"files": [], "references": [...]}`.
// `tsc --noEmit` reads it, finds no files and exits 0, while `tsc -b` follows
// the project references. Build mode is therefore required for a meaningful
// repository-wide typecheck.
describe('the typecheck script builds the project references', () => {
  const typecheck = pkg.scripts.typecheck ?? '';

  it('uses build mode', () => {
    expect(typecheck).toMatch(/\btsc\b.*\s-b\b/);
  });

  it('does not use --noEmit, which is vacuous against a solution-style root', () => {
    expect(typecheck).not.toContain('--noEmit');
  });

  it('still has the empty root file list that makes --noEmit vacuous', () => {
    // Guard the guard. If the root config ever gains its own files/include then
    // --noEmit starts checking something, and the two tests above are defending
    // against a hazard that no longer exists. Fail here so someone re-reads the
    // comment rather than leaving a stale prohibition in place.
    const rootConfig = JSON.parse(readFileSync(resolve(root, 'tsconfig.json'), 'utf8'));
    expect(rootConfig.files).toEqual([]);
    expect(rootConfig.include).toBeUndefined();
    expect(rootConfig.references?.map(({ path }) => path)).toEqual(expect.arrayContaining([
      './tsconfig.mcp.json',
      './tsconfig.e2e.json',
    ]));
  });
});
