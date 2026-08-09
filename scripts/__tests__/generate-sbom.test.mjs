import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, it } from 'vitest';

import { createDeterministicSbom } from '../generate-sbom.mjs';

const fixtures = [];

afterEach(() => {
  for (const directory of fixtures.splice(0)) rmSync(directory, { recursive: true, force: true });
});

function writePackage(directory, name, version) {
  const packageDirectory = join(directory, 'node_modules', ...name.split('/'));
  mkdirSync(packageDirectory, { recursive: true });
  writeFileSync(join(packageDirectory, 'package.json'), `${JSON.stringify({ name, version })}\n`);
}

describe('deterministic SBOM dependency scopes', () => {
  it('classifies declared identities as direct even when hoisted', () => {
    const directory = mkdtempSync(join(tmpdir(), 'motif-sbom-test-'));
    fixtures.push(directory);
    writeFileSync(join(directory, 'package.json'), `${JSON.stringify({
      name: 'fixture-workspace',
      version: '1.0.0',
      dependencies: { 'declared-runtime': '1.0.0' },
      devDependencies: { 'declared-build': '2.0.0' },
    })}\n`);
    writeFileSync(join(directory, 'package-lock.json'), `${JSON.stringify({
      lockfileVersion: 3,
      packages: {
        '': { dependencies: { 'declared-runtime': '1.0.0' }, devDependencies: { 'declared-build': '2.0.0' } },
        'node_modules/declared-runtime': { version: '1.0.0' },
        'node_modules/declared-build': { version: '2.0.0' },
        'node_modules/hoisted-transitive': { version: '3.0.0' },
        'node_modules/declared-runtime/node_modules/nested-transitive': { version: '4.0.0' },
      },
    })}\n`);
    writePackage(directory, 'declared-runtime', '1.0.0');
    writePackage(directory, 'declared-build', '2.0.0');
    writePackage(directory, 'hoisted-transitive', '3.0.0');
    const nestedDirectory = join(directory, 'node_modules', 'declared-runtime', 'node_modules', 'nested-transitive');
    mkdirSync(nestedDirectory, { recursive: true });
    writeFileSync(join(nestedDirectory, 'package.json'), `${JSON.stringify({ name: 'nested-transitive', version: '4.0.0' })}\n`);

    const byName = new Map(createDeterministicSbom(directory).components.map(component => [component.name, component]));
    expect(byName.get('declared-runtime')?.scope).toBe('direct');
    expect(byName.get('declared-build')?.scope).toBe('direct');
    expect(byName.get('hoisted-transitive')?.scope).toBe('transitive');
    expect(byName.get('nested-transitive')?.scope).toBe('transitive');
  });

  it('resolves license files relative to the requested workspace', () => {
    const directory = mkdtempSync(join(tmpdir(), 'motif-sbom-license-test-'));
    fixtures.push(directory);
    writeFileSync(join(directory, 'package.json'), `${JSON.stringify({
      name: 'fixture-workspace',
      version: '1.0.0',
      dependencies: { 'fixture-license-package': '1.0.0' },
    })}\n`);
    writeFileSync(join(directory, 'package-lock.json'), `${JSON.stringify({
      lockfileVersion: 3,
      packages: {
        '': { dependencies: { 'fixture-license-package': '1.0.0' } },
        'node_modules/fixture-license-package': { version: '1.0.0' },
      },
    })}\n`);
    writePackage(directory, 'fixture-license-package', '1.0.0');
    writeFileSync(join(directory, 'node_modules/fixture-license-package/LICENSE'), 'fixture license\n');

    const component = createDeterministicSbom(directory).components.find(
      (candidate) => candidate.name === 'fixture-license-package',
    );
    expect(component).toMatchObject({
      scope: 'direct',
      licenseFile: 'node_modules/fixture-license-package/LICENSE',
    });
    expect(component?.licenseSha256).toMatch(/^[a-f0-9]{64}$/u);
  });
});
