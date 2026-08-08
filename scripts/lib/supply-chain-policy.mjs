import {
  existsSync,
  lstatSync,
  readFileSync,
  readdirSync,
  realpathSync,
} from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';

const LIFECYCLE_KEYS = ['preinstall', 'install', 'postinstall', 'prepare'];
const SHA512_INTEGRITY = /^sha512-[A-Za-z0-9+/=]+$/u;
const EXACT_VERSION = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/u;

function packageIdentity(name, version) {
  return `${name}@${version}`;
}

function splitPackageIdentity(identity) {
  const marker = identity.lastIndexOf('@');
  if (marker <= 0) return null;
  const name = identity.slice(0, marker);
  const version = identity.slice(marker + 1);
  return name && EXACT_VERSION.test(version) ? { name, version } : null;
}

function lockContainsIdentity(lock, name, version) {
  return Object.entries(lock.packages ?? {}).some(([lockPath, metadata]) => (
    lockPath !== '' && packageName(null, lockPath) === name && metadata.version === version
  ));
}

function readJson(path, label) {
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch (error) {
    throw new Error(`${label} is not valid JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function assertSafeLockPackagePath(lockPath) {
  if (typeof lockPath !== 'string' || !lockPath.startsWith('node_modules/') || lockPath.includes('\\')) {
    throw new Error(`Dependency lock package path is unsafe: ${lockPath}`);
  }
  const segments = lockPath.split('/');
  if (segments.some(segment => !segment || segment === '.' || segment === '..')) {
    throw new Error(`Dependency lock package path is unsafe: ${lockPath}`);
  }
}

function packageDirectory(root, lockPath) {
  const directory = join(root, lockPath);
  let stat;
  try {
    stat = lstatSync(directory);
  } catch (error) {
    if (error?.code === 'ENOENT') return null;
    throw error;
  }
  if (stat.isSymbolicLink() || !stat.isDirectory()) {
    throw new Error(`Dependency package directory is not a real directory: ${directory}`);
  }
  return directory;
}

function packageManifest(root, lockPath) {
  const directory = packageDirectory(root, lockPath);
  if (!directory) return null;
  const path = join(directory, 'package.json');
  if (!existsSync(path)) return null;
  const stat = lstatSync(path);
  if (stat.isSymbolicLink() || !stat.isFile()) throw new Error(`Package manifest is not a regular file: ${path}`);
  return readJson(path, `Package manifest ${path}`);
}

function packageName(manifest, lockPath) {
  if (typeof manifest?.name === 'string' && manifest.name.trim()) return manifest.name;
  const relative = lockPath.replace(/^node_modules\//u, '');
  const segments = relative.split('/node_modules/').at(-1)?.split('/') ?? [];
  if (segments[0]?.startsWith('@')) return segments.slice(0, 2).join('/');
  return segments[0] ?? lockPath;
}

function assertRegistryTarball(resolved, name, version, registry) {
  let url;
  try {
    url = new URL(resolved);
  } catch {
    throw new Error(`Dependency ${name}@${version} has a non-URL resolved source`);
  }
  if (`${url.origin}/` !== registry) {
    throw new Error(`Dependency ${name}@${version} resolves outside the reviewed registry: ${url.origin}`);
  }
  const basename = name.split('/').at(-1);
  if (!url.pathname.endsWith(`/${basename}-${version}.tgz`)) {
    throw new Error(`Dependency ${name}@${version} has an unexpected registry tarball path`);
  }
}

function packageFiles(directory, output = [], packageRoot = null) {
  if (!existsSync(directory)) return output;
  const resolvedPackageRoot = packageRoot ?? realpathSync(directory);
  for (const entry of readdirSync(directory, { withFileTypes: true }).sort((left, right) => left.name.localeCompare(right.name))) {
    const path = join(directory, entry.name);
    const stat = lstatSync(path);
    if (stat.isSymbolicLink()) {
      // npm may create local .bin command links inside a nested dependency
      // tree. They are safe to ignore only when their resolved target remains
      // inside this package; every other package symlink is a release-policy
      // violation (and must not hide a binding or license file).
      if (!path.split(/[\\/]/u).includes('.bin')) {
        throw new Error(`Dependency package contains a symbolic link: ${path}`);
      }
      let target;
      try {
        target = realpathSync(path);
      } catch {
        throw new Error(`Dependency package contains a broken .bin symbolic link: ${path}`);
      }
      const local = relative(resolvedPackageRoot, target);
      if (local === '..' || local.startsWith(`..${sep}`) || local.startsWith('/') || local.startsWith('\\')) {
        throw new Error(`Dependency package .bin symbolic link escapes its package: ${path}`);
      }
      continue;
    }
    if (entry.isDirectory()) packageFiles(path, output, resolvedPackageRoot);
    else if (entry.isFile()) output.push(path);
    else throw new Error(`Dependency package contains an unsupported file: ${path}`);
  }
  return output;
}

export function loadDependencyPolicy(root) {
  const policyPath = resolve(root, 'security/dependency-policy.json');
  const inventoryPath = resolve(root, 'security/connector-inventory.json');
  const policy = readJson(policyPath, 'Dependency policy');
  const inventory = readJson(inventoryPath, 'Reviewed connector inventory');
  if (policy.schema !== 'motif.dependency-policy.v1') throw new Error('Dependency policy schema is unsupported');
  if (policy.reviewedConnectorInventory !== 'security/connector-inventory.json') throw new Error('Dependency policy must point to the reviewed connector inventory');
  if (inventory.schema !== 'motif.reviewed-connector-inventory.v1') throw new Error('Connector inventory schema is unsupported');
  if (!Array.isArray(inventory.packages) || inventory.packages.length === 0) throw new Error('Connector inventory must contain packages');
  return { policy, inventory, policyPath, inventoryPath };
}

export function checkLockfilePolicy(rootPath = process.cwd()) {
  const root = resolve(rootPath);
  const { policy, inventory } = loadDependencyPolicy(root);
  const packageJson = readJson(join(root, 'package.json'), 'package.json');
  const lock = readJson(join(root, 'package-lock.json'), 'package-lock.json');
  if (lock.lockfileVersion !== 3) throw new Error(`package-lock.json must use lockfileVersion 3 (found ${lock.lockfileVersion})`);
  const rootPackage = lock.packages?.[''];
  if (!rootPackage) throw new Error('package-lock.json is missing its root package entry');

  const lifecyclePolicy = policy.allowedLifecycleScripts ?? {};
  for (const [identity, scripts] of Object.entries(lifecyclePolicy)) {
    const parsed = splitPackageIdentity(identity);
    if (!parsed || !Array.isArray(scripts) || scripts.some(key => !LIFECYCLE_KEYS.includes(key))) {
      throw new Error(`Lifecycle policy entry is not an exact reviewed package/version: ${identity}`);
    }
    if (!lockContainsIdentity(lock, parsed.name, parsed.version)) {
      throw new Error(`Lifecycle policy entry is stale or unreviewed: ${identity}`);
    }
  }
  const npmAllowScripts = packageJsonAllowScripts(packageJson);
  for (const [identity, approval] of Object.entries(npmAllowScripts)) {
    const parsed = splitPackageIdentity(identity);
    if (!parsed || typeof approval !== 'boolean') {
      throw new Error(`package.json allowScripts entry must pin an exact package/version: ${identity}`);
    }
    if (!lockContainsIdentity(lock, parsed.name, parsed.version)) {
      throw new Error(`package.json allowScripts entry is stale or unreviewed: ${identity}`);
    }
  }

  const directGroups = ['dependencies', 'devDependencies', 'optionalDependencies'];
  for (const group of directGroups) {
    const declaredNames = Object.keys(packageJson[group] ?? {}).sort();
    const lockedNames = Object.keys(rootPackage[group] ?? {}).sort();
    if (JSON.stringify(declaredNames) !== JSON.stringify(lockedNames)) {
      throw new Error(`package-lock root ${group} does not exactly match package.json`);
    }
    for (const [name, declared] of Object.entries(packageJson[group] ?? {})) {
      if (policy.directDependenciesMustBeExact && !EXACT_VERSION.test(declared)) {
        throw new Error(`${group}.${name} must be pinned to an exact semver version (found ${declared})`);
      }
      if (rootPackage[group]?.[name] !== declared) {
        throw new Error(`package-lock root ${group}.${name} does not match package.json (${declared})`);
      }
    }
  }

  const packages = Object.entries(lock.packages ?? {}).filter(([path]) => path !== '');
  const lifecycleFindings = [];
  const bindingFindings = [];
  for (const [lockPath, metadata] of packages) {
    assertSafeLockPackagePath(lockPath);
    const manifest = packageManifest(root, lockPath);
    const name = packageName(manifest, lockPath);
    const version = metadata.version;
    if (typeof version !== 'string' || !EXACT_VERSION.test(version)) throw new Error(`${lockPath} has no exact version`);
    if (typeof metadata.resolved !== 'string') throw new Error(`${lockPath} is missing a resolved registry tarball`);
    assertRegistryTarball(metadata.resolved, name, version, policy.registry);
    if (typeof metadata.integrity !== 'string' || !SHA512_INTEGRITY.test(metadata.integrity)) {
      throw new Error(`${lockPath} is missing a sha512 integrity value`);
    }
    const scripts = manifest?.scripts ?? {};
    const lifecycleKeys = LIFECYCLE_KEYS.filter(key => typeof scripts[key] === 'string' && scripts[key].trim());
    const identity = packageIdentity(name, version);
    if (metadata.hasInstallScript || lifecycleKeys.length > 0) {
      const allowed = lifecyclePolicy[identity];
      if (!Array.isArray(allowed)) lifecycleFindings.push(`${identity} is not in allowedLifecycleScripts`);
      for (const key of lifecycleKeys) {
        if (!allowed?.includes(key)) lifecycleFindings.push(`${identity} lifecycle script ${key} is not allowlisted`);
      }
      if (metadata.hasInstallScript && npmAllowScripts[identity] === undefined) lifecycleFindings.push(`${identity} has an install script but no exact package.json allowScripts decision`);
    }
    const packageDirectory = join(root, lockPath);
    const hasBinding = packageFiles(packageDirectory).some(path => path.endsWith('/binding.gyp') || path.endsWith('\\binding.gyp'));
    if (hasBinding && !policy.allowedBindingGyp?.includes(name)) bindingFindings.push(`${name}@${version} contains binding.gyp`);
  }
  if (lifecycleFindings.length > 0) throw new Error(`Lifecycle-script policy violation: ${lifecycleFindings.join('; ')}`);
  if (bindingFindings.length > 0) throw new Error(`binding.gyp policy violation: ${bindingFindings.join('; ')}`);

  const names = inventory.packages.map(entry => entry.name);
  if (new Set(names).size !== names.length) throw new Error('Reviewed connector inventory contains duplicate package names');
  for (const entry of inventory.packages) {
    const lockPath = `node_modules/${entry.name}`;
    const metadata = lock.packages?.[lockPath];
    if (!metadata) throw new Error(`Reviewed connector package is absent from package-lock.json: ${entry.name}`);
    if (!entry.packagePath || !Array.isArray(entry.packagePath) || entry.packagePath.join('/') !== entry.name) {
      throw new Error(`Connector inventory packagePath is invalid for ${entry.name}`);
    }
    if (typeof entry.licenseFile !== 'string' || !entry.licenseFile.endsWith('-LICENSE.txt')) {
      throw new Error(`Connector inventory license filename is invalid for ${entry.name}`);
    }
  }

  return {
    packageCount: packages.length,
    connectorPackageCount: inventory.packages.length,
    lifecycleAllowlist: Object.keys(policy.allowedLifecycleScripts ?? {}).sort(),
    bindingAllowlist: [...(policy.allowedBindingGyp ?? [])].sort(),
  };
}

function packageJsonAllowScripts(packageJson) {
  const value = packageJson.allowScripts;
  if (value === undefined) return {};
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('package.json allowScripts must be an object of exact package/version decisions');
  return value;
}

export function compareConnectorInventory(expected, generated) {
  const expectedEntries = expected.packages.map(entry => ({
    name: entry.name,
    packagePath: entry.packagePath,
    licenseFile: `licenses/${entry.licenseFile}`,
  })).sort((left, right) => left.name.localeCompare(right.name));
  const generatedEntries = generated.packages.map(entry => ({
    name: entry.name,
    packagePath: entry.packagePath,
    licenseFile: entry.licenseFile,
  })).sort((left, right) => left.name.localeCompare(right.name));
  if (JSON.stringify(expectedEntries) !== JSON.stringify(generatedEntries)) {
    throw new Error(`Bundled connector inventory drift: expected ${expectedEntries.map(entry => entry.name).join(', ')}, generated ${generatedEntries.map(entry => entry.name).join(', ')}`);
  }
}
