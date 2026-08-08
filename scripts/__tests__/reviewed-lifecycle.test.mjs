import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { runReviewedLifecycle } from '../run-reviewed-lifecycle.mjs';

const temporaryDirectories = [];

function fixture({ version = '1.0.0', policyVersion = version, allowed = true } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'motif-reviewed-lifecycle-test-'));
  temporaryDirectories.push(root);
  const packageDirectory = join(root, 'node_modules', 'reviewed-package');
  mkdirSync(packageDirectory, { recursive: true });
  mkdirSync(join(root, 'security'), { recursive: true });
  const markerPath = join(root, 'marker.txt');
  writeFileSync(join(packageDirectory, 'write-marker.mjs'), `import { writeFileSync } from 'node:fs';\nwriteFileSync(${JSON.stringify(markerPath)}, process.env.npm_package_name + '@' + process.env.npm_package_version + ':' + process.env.npm_lifecycle_event);\n`);
  writeFileSync(join(packageDirectory, 'package.json'), JSON.stringify({
    name: 'reviewed-package',
    version,
    scripts: { postinstall: 'node write-marker.mjs' },
  }));
  writeFileSync(join(root, 'package.json'), JSON.stringify({
    name: 'lifecycle-fixture',
    version: '1.0.0',
    private: true,
    dependencies: { 'reviewed-package': version },
    allowScripts: allowed ? { [`reviewed-package@${policyVersion}`]: true } : {},
  }));
  writeFileSync(join(root, 'package-lock.json'), JSON.stringify({
    lockfileVersion: 3,
    packages: {
      '': { dependencies: { 'reviewed-package': version } },
      'node_modules/reviewed-package': {
        version,
        resolved: `https://registry.npmjs.org/reviewed-package/-/reviewed-package-${version}.tgz`,
        integrity: 'sha512-AAAA=',
        hasInstallScript: true,
      },
    },
  }));
  writeFileSync(join(root, 'security', 'dependency-policy.json'), JSON.stringify({
    schema: 'motif.dependency-policy.v1',
    registry: 'https://registry.npmjs.org/',
    directDependenciesMustBeExact: true,
    allowedLifecycleScripts: allowed ? { [`reviewed-package@${policyVersion}`]: ['postinstall'] } : {},
    allowedBindingGyp: [],
    reviewedConnectorInventory: 'security/connector-inventory.json',
  }));
  writeFileSync(join(root, 'security', 'connector-inventory.json'), JSON.stringify({
    schema: 'motif.reviewed-connector-inventory.v1',
    packages: [{ name: 'reviewed-package', packagePath: ['reviewed-package'], licenseFile: 'reviewed-LICENSE.txt' }],
  }));
  return { root, markerPath };
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

describe('bounded reviewed lifecycle execution', () => {
  it('fails policy before an unreviewed script can execute', () => {
    const { root, markerPath } = fixture({ allowed: false });
    expect(() => runReviewedLifecycle(root)).toThrow(/Lifecycle-script policy violation/);
    expect(existsSync(markerPath)).toBe(false);
  });

  it('executes only the exact approved package/version lifecycle command', () => {
    const { root, markerPath } = fixture();
    const result = runReviewedLifecycle(root);
    expect(result.executed).toEqual([{ identity: 'reviewed-package@1.0.0', key: 'postinstall' }]);
    expect(readFileSync(markerPath, 'utf8')).toBe('reviewed-package@1.0.0:postinstall');
  });

  it('rejects a changed lifecycle version before execution', () => {
    const { root, markerPath } = fixture({ version: '1.0.1', policyVersion: '1.0.0' });
    expect(() => runReviewedLifecycle(root)).toThrow(/stale or unreviewed/);
    expect(existsSync(markerPath)).toBe(false);
  });
});
