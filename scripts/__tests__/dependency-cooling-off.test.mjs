import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { describe, expect, it } from 'vitest';
import { checkDependencyCoolingOff } from '../check-dependency-cooling-off.mjs';

const NOW = Date.parse('2026-08-08T00:00:00.000Z');
const RESOLVED = 'https://registry.npmjs.org/reviewed-package/-/reviewed-package-1.0.0.tgz';
const INTEGRITY = 'sha512-AAAA=';
const COMMIT_SHA_40 = 'a'.repeat(40);
const COMMIT_SHA_64 = 'b'.repeat(64);

function fixture({ publishedAt = '2026-07-01T00:00:00.000Z', currentVersion = '1.0.0', baselineVersion = '0.9.0', exceptions = [] } = {}) {
  const directory = mkdtempSync(join(tmpdir(), 'motif-cooling-off-test-'));
  mkdirSync(join(directory, 'security'), { recursive: true });
  const currentResolved = RESOLVED.replace('1.0.0', currentVersion);
  writeFileSync(join(directory, 'package-lock.json'), JSON.stringify({
    lockfileVersion: 3,
    packages: {
      '': { dependencies: { 'reviewed-package': currentVersion } },
      'node_modules/reviewed-package': { version: currentVersion, resolved: currentResolved, integrity: INTEGRITY },
    },
  }));
  writeFileSync(join(directory, 'package.json'), JSON.stringify({ dependencies: { 'reviewed-package': currentVersion } }));
  writeFileSync(join(directory, 'security/dependency-policy.json'), JSON.stringify({
    schema: 'motif.dependency-policy.v1',
    registry: 'https://registry.npmjs.org/',
    coolingOffDays: 7,
    coolingOffExceptions: exceptions,
    directDependenciesMustBeExact: true,
    allowedLifecycleScripts: {},
    allowedBindingGyp: [],
    reviewedConnectorInventory: 'security/connector-inventory.json',
  }));
  writeFileSync(join(directory, 'security/connector-inventory.json'), JSON.stringify({
    schema: 'motif.reviewed-connector-inventory.v1',
    packages: [{ name: 'reviewed-package', packagePath: ['reviewed-package'], licenseFile: 'reviewed-LICENSE.txt' }],
  }));
  const baseline = JSON.stringify({
    lockfileVersion: 3,
    packages: {
      '': { dependencies: { 'reviewed-package': baselineVersion } },
      'node_modules/reviewed-package': { version: baselineVersion, resolved: RESOLVED.replace('1.0.0', baselineVersion), integrity: INTEGRITY },
    },
  });
  return {
    directory,
    baseline,
    metadata: JSON.stringify({
      name: 'reviewed-package',
      time: { [currentVersion]: publishedAt },
      versions: { [currentVersion]: { version: currentVersion, dist: { tarball: currentResolved, integrity: INTEGRITY } } },
    }),
  };
}

function fetchFrom(text) {
  return async () => ({ ok: true, status: 200, text: async () => text });
}

describe('dependency cooling-off policy', () => {
  it('fails closed in CI without a real event baseline', async () => {
    const fixtureData = fixture();
    await expect(checkDependencyCoolingOff(fixtureData.directory, {
      environment: { CI: 'true' },
      now: NOW,
      fetchImpl: fetchFrom(fixtureData.metadata),
    })).rejects.toThrow(/full immutable 40- or 64-hex commit ID/);
    await expect(checkDependencyCoolingOff(fixtureData.directory, {
      environment: { CI: 'true', MOTIF_COOLING_OFF_BASE_SHA: '0000000000000000000000000000000000000000' },
      now: NOW,
      fetchImpl: fetchFrom(fixtureData.metadata),
    })).rejects.toThrow(/full immutable 40- or 64-hex commit ID/);
    rmSync(fixtureData.directory, { recursive: true, force: true });
  });

  it.each([COMMIT_SHA_40, COMMIT_SHA_64])('accepts a full immutable %s baseline in CI', async (baseSha) => {
    const fixtureData = fixture({ publishedAt: '2026-07-01T00:00:00.000Z' });
    await expect(checkDependencyCoolingOff(fixtureData.directory, {
      baseLockfileText: fixtureData.baseline,
      environment: { CI: 'true', MOTIF_COOLING_OFF_BASE_SHA: baseSha },
      now: NOW,
      fetchImpl: fetchFrom(fixtureData.metadata),
    })).resolves.toMatchObject({ baseline: baseSha, changedPackageCount: 1 });
    rmSync(fixtureData.directory, { recursive: true, force: true });
  });

  it('accepts an explicitly supplied baseline under ambient CI', async () => {
    const fixtureData = fixture({ publishedAt: '2026-07-01T00:00:00.000Z' });
    await expect(checkDependencyCoolingOff(fixtureData.directory, {
      baseLockfileText: fixtureData.baseline,
      environment: { CI: 'true' },
      now: NOW,
      fetchImpl: fetchFrom(fixtureData.metadata),
    })).resolves.toMatchObject({ changedPackageCount: 1 });
    rmSync(fixtureData.directory, { recursive: true, force: true });
  });

  it('rejects abbreviated, malformed, and all-zero CI baselines', async () => {
    const fixtureData = fixture();
    for (const baseSha of ['a'.repeat(39), 'a'.repeat(41), `${'a'.repeat(63)}g`, '0'.repeat(64)]) {
      await expect(checkDependencyCoolingOff(fixtureData.directory, {
        baseLockfileText: fixtureData.baseline,
        environment: { CI: 'true', MOTIF_COOLING_OFF_BASE_SHA: baseSha },
        now: NOW,
        fetchImpl: fetchFrom(fixtureData.metadata),
      })).rejects.toThrow(/full immutable 40- or 64-hex commit ID/);
    }
    rmSync(fixtureData.directory, { recursive: true, force: true });
  });

  it('rejects a changed dependency younger than seven days', async () => {
    const fixtureData = fixture({ publishedAt: '2026-08-06T00:00:00.000Z' });
    await expect(checkDependencyCoolingOff(fixtureData.directory, {
      baseLockfileText: fixtureData.baseline,
      now: NOW,
      fetchImpl: fetchFrom(fixtureData.metadata),
    })).rejects.toThrow(/only 2\.00 days old/);
    rmSync(fixtureData.directory, { recursive: true, force: true });
  });

  it('rejects expired exceptions before checking registry metadata', async () => {
    const fixtureData = fixture({
      publishedAt: '2026-08-07T00:00:00.000Z',
      exceptions: [{ name: 'reviewed-package', version: '1.0.0', rationale: 'urgent security repair', reviewer: 'security-team', expiresAt: '2026-08-07T23:59:59.000Z' }],
    });
    await expect(checkDependencyCoolingOff(fixtureData.directory, {
      baseLockfileText: fixtureData.baseline,
      now: NOW,
      fetchImpl: fetchFrom(fixtureData.metadata),
    })).rejects.toThrow(/expired/);
    rmSync(fixtureData.directory, { recursive: true, force: true });
  });

  it('accepts a young exact version only with a live, reviewed exception', async () => {
    const fixtureData = fixture({
      publishedAt: '2026-08-07T00:00:00.000Z',
      exceptions: [{ name: 'reviewed-package', version: '1.0.0', rationale: 'urgent security repair', reviewer: 'security-team', expiresAt: '2026-08-15T00:00:00.000Z' }],
    });
    await expect(checkDependencyCoolingOff(fixtureData.directory, {
      baseLockfileText: fixtureData.baseline,
      now: NOW,
      fetchImpl: fetchFrom(fixtureData.metadata),
    })).resolves.toMatchObject({ changedPackageCount: 1, checked: [{ exception: true }] });
    rmSync(fixtureData.directory, { recursive: true, force: true });
  });

  it('fails closed on tampered registry timestamps and tarball metadata', async () => {
    const future = fixture({ publishedAt: '2026-08-09T00:00:00.000Z' });
    await expect(checkDependencyCoolingOff(future.directory, {
      baseLockfileText: future.baseline,
      now: NOW,
      fetchImpl: fetchFrom(future.metadata),
    })).rejects.toThrow(/future/);
    rmSync(future.directory, { recursive: true, force: true });

    const tampered = fixture();
    const metadata = JSON.parse(tampered.metadata);
    metadata.versions['1.0.0'].dist.tarball = 'https://registry.npmjs.org/reviewed-package/-/wrong.tgz';
    await expect(checkDependencyCoolingOff(tampered.directory, {
      baseLockfileText: tampered.baseline,
      now: NOW,
      fetchImpl: fetchFrom(JSON.stringify(metadata)),
    })).rejects.toThrow(/tarball mismatch/);
    rmSync(tampered.directory, { recursive: true, force: true });
  });

  it('does not make registry requests when the lockfile has no changed entries', async () => {
    const fixtureData = fixture();
    let calls = 0;
    const result = await checkDependencyCoolingOff(fixtureData.directory, {
      baseLockfileText: readCurrent(fixtureData.directory),
      now: NOW,
      fetchImpl: async () => { calls += 1; return { ok: true, status: 200, text: async () => fixtureData.metadata }; },
    });
    expect(result.changedPackageCount).toBe(0);
    expect(calls).toBe(0);
    rmSync(fixtureData.directory, { recursive: true, force: true });
  });
});

function readCurrent(directory) {
  return readFileSync(join(directory, 'package-lock.json'), 'utf8');
}
