import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// `npm run gate` is the canonical local check sequence. This test turns any
// drift between that sequence and CI into a local failure.

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const workflow = readFileSync(resolve(root, '.github/workflows/ci.yml'), 'utf8');
const pkg = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8'));

// Steps that set the machine up rather than check the source. `npm ci` installs
// dependencies and `npx playwright install` fetches a browser; neither is
// something a local run should repeat on every commit.
const SETUP_ONLY = new Set(['npm ci']);

function npmCommands(script) {
  return script
    .split('&&')
    .map((part) => part.trim())
    .filter((part) => /^npm (run |test\b)/.test(part) && !SETUP_ONLY.has(part));
}

const ciCommands = [
  ...workflow.matchAll(/^\s*run:\s*(.+)$/gm),
].flatMap((match) => npmCommands(match[1]));

const gateCommands = npmCommands(pkg.scripts.gate ?? '');

describe('npm run gate matches CI', () => {
  it('reads a non-trivial list out of both sides', () => {
    // Guard the guard: a regex that stopped matching would make every
    // assertion below pass by comparing two empty lists.
    expect(ciCommands.length).toBeGreaterThan(5);
    expect(gateCommands.length).toBeGreaterThan(5);
  });

  it('runs every check CI runs', () => {
    const missing = ciCommands.filter((command) => !gateCommands.includes(command));
    expect(missing, 'in CI but not in `npm run gate`').toEqual([]);
  });

  it('runs nothing CI does not', () => {
    // The other direction matters too: a gate that checks more than CI turns
    // green CI into an unreliable signal about what the gate proved.
    const extra = gateCommands.filter((command) => !ciCommands.includes(command));
    expect(extra, 'in `npm run gate` but not in CI').toEqual([]);
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
    expect(rootConfig.references?.length ?? 0).toBeGreaterThan(0);
  });
});
