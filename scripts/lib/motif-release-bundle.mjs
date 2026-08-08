import { createHash } from 'node:crypto';
import {
  existsSync,
  lstatSync,
  opendirSync,
  readFileSync,
  realpathSync,
} from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';

export const RELEASE_MANIFEST_FILENAME = 'release-manifest.json';
export const RELEASE_CHECKSUM_FILENAME = 'motif-for-claude-science-release.checksums.json';
export const RELEASE_PRODUCT = 'Motif for Claude Science';
export const RELEASE_CONNECTOR_NAME = 'motif-local';
export const RELEASE_MAX_FILES = 128;
// The checksum manifest is capped at RELEASE_MAX_FILES; the bundle also has
// the two manifest files themselves. Keep traversal bounded before an
// unexpected-file comparison can walk an attacker-controlled tree.
export const RELEASE_MAX_BUNDLE_FILES = RELEASE_MAX_FILES + 2;
export const RELEASE_MAX_DIRECTORY_NODES = 512;
export const RELEASE_MAX_DIRECTORY_DEPTH = 32;
// Count every directory entry before retaining it for deterministic sorting.
// Keep this combined cap independent of the recursive directory/file checks so
// a flat hostile directory cannot force an unbounded readdir allocation.
export const RELEASE_MAX_BUNDLE_ENTRIES = RELEASE_MAX_BUNDLE_FILES + RELEASE_MAX_DIRECTORY_NODES;
export const RELEASE_MAX_FILE_BYTES = 64 * 1024 * 1024;
export const RELEASE_MAX_TOTAL_BYTES = 128 * 1024 * 1024;

/**
 * Resolve the bundle root for a release helper. Source helpers live in the
 * repository's scripts directory; packaged helpers are copied to the bundle
 * root. The manifest is the unambiguous marker for the latter layout.
 */
export function resolveReleaseBundleRoot(scriptPath) {
  const scriptDirectory = realpathSync(resolve(dirname(scriptPath)));
  const packagedRoot = resolve(scriptDirectory, RELEASE_MANIFEST_FILENAME);
  return existsSync(packagedRoot) ? scriptDirectory : resolve(scriptDirectory, '..');
}

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function canonicalRoot(bundlePath) {
  const path = resolve(bundlePath);
  if (!existsSync(path)) throw new Error(`Release bundle does not exist: ${path}`);
  const stat = lstatSync(path);
  if (stat.isSymbolicLink() || !stat.isDirectory()) throw new Error('Release bundle must be a real directory');
  return realpathSync(path);
}

function safeRelativePath(value, label) {
  if (typeof value !== 'string' || !value || value.includes('\\') || value.startsWith('/') || value.includes('\0')) {
    throw new Error(`${label} must be a relative POSIX path inside the release bundle`);
  }
  const segments = value.split('/');
  if (segments.some(segment => !segment || segment === '.' || segment === '..')) {
    throw new Error(`${label} contains an unsafe path`);
  }
  return value;
}

function resolveBundlePath(root, relativePath, label) {
  const safe = safeRelativePath(relativePath, label);
  const candidate = resolve(root, ...safe.split('/'));
  const local = relative(root, candidate);
  if (local === '..' || local.startsWith(`..${sep}`) || local.startsWith('/') || local.includes(`..${sep}`)) {
    throw new Error(`${label} escapes the release bundle`);
  }
  let current = root;
  for (const segment of safe.split('/')) {
    current = join(current, segment);
    if (!existsSync(current)) break;
    const stat = lstatSync(current);
    if (stat.isSymbolicLink()) throw new Error(`${label} must not traverse a symbolic link`);
  }
  return candidate;
}

function assertRegularBundleFile(root, relativePath, label = relativePath) {
  const path = resolveBundlePath(root, relativePath, label);
  if (!existsSync(path)) throw new Error(`${label} is missing from the release bundle`);
  const stat = lstatSync(path);
  if (stat.isSymbolicLink() || !stat.isFile()) throw new Error(`${label} must be a regular file`);
  if (stat.size > RELEASE_MAX_FILE_BYTES) throw new Error(`${label} exceeds the release file-size limit`);
  return path;
}

function listFiles(root, directory = root, output = [], state = { directoryNodes: 0, entries: 0 }, depth = 0) {
  state.directoryNodes += 1;
  if (state.directoryNodes > RELEASE_MAX_DIRECTORY_NODES) {
    throw new Error(`Release bundle directory count exceeds the ${RELEASE_MAX_DIRECTORY_NODES}-directory limit`);
  }
  if (depth > RELEASE_MAX_DIRECTORY_DEPTH) {
    throw new Error(`Release bundle directory depth exceeds the ${RELEASE_MAX_DIRECTORY_DEPTH}-level limit`);
  }
  const directoryHandle = opendirSync(directory);
  const entries = [];
  try {
    while (true) {
      const entry = directoryHandle.readSync();
      if (entry === null) break;
      state.entries += 1;
      if (state.entries > RELEASE_MAX_BUNDLE_ENTRIES) {
        throw new Error(`Release bundle entry count exceeds the ${RELEASE_MAX_BUNDLE_ENTRIES}-entry limit`);
      }
      entries.push(entry);
    }
  } finally {
    directoryHandle.closeSync();
  }
  entries.sort((left, right) => left.name.localeCompare(right.name));
  for (const entry of entries) {
    const path = join(directory, entry.name);
    const stat = lstatSync(path);
    if (stat.isSymbolicLink()) throw new Error(`Release bundle contains a symbolic link: ${relative(root, path)}`);
    if (entry.isDirectory()) listFiles(root, path, output, state, depth + 1);
    else if (entry.isFile()) {
      if (stat.size > RELEASE_MAX_FILE_BYTES) throw new Error(`Release file exceeds the size limit: ${relative(root, path)}`);
      if (output.length >= RELEASE_MAX_BUNDLE_FILES) {
        throw new Error(`Release bundle file count exceeds the ${RELEASE_MAX_BUNDLE_FILES}-file limit`);
      }
      output.push(relative(root, path).split(sep).join('/'));
    } else throw new Error(`Release bundle contains a special file: ${relative(root, path)}`);
  }
  return output;
}

function readJson(path, label, maxBytes = 4 * 1024 * 1024) {
  const stat = lstatSync(path);
  if (stat.size > maxBytes) throw new Error(`${label} exceeds the JSON size limit`);
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    throw new Error(`${label} is not valid JSON`);
  }
}

function assertArrayOfStrings(value, label) {
  if (!Array.isArray(value) || value.some(item => typeof item !== 'string')) throw new Error(`${label} must be an array of strings`);
}

export function verifyReleaseBundle(bundlePath, { expectedVersion = null } = {}) {
  const root = canonicalRoot(bundlePath);
  const manifestPath = assertRegularBundleFile(root, RELEASE_MANIFEST_FILENAME, 'Release manifest');
  const checksumPath = assertRegularBundleFile(root, RELEASE_CHECKSUM_FILENAME, 'Release checksum manifest');
  const manifest = readJson(manifestPath, 'Release manifest');
  const checksums = readJson(checksumPath, 'Release checksum manifest');
  if (manifest.schema !== 'motif.release.manifest.v1') throw new Error('Unsupported Motif release manifest schema');
  if (manifest.product !== RELEASE_PRODUCT) throw new Error('Release product identity is not Motif for Claude Science');
  if (manifest.connectorName !== RELEASE_CONNECTOR_NAME) throw new Error('Release connector identity is not motif-local');
  if (expectedVersion !== null && manifest.version !== expectedVersion) throw new Error(`Release version mismatch: expected ${expectedVersion}, found ${manifest.version}`);
  if (!/^\d+\.\d+\.\d+$/u.test(manifest.version ?? '')) throw new Error('Release manifest version is invalid');
  if (!/^[a-f0-9]{64}$/u.test(manifest.runtimeBuildId ?? '')) throw new Error('Release runtime build identity is invalid');
  if (manifest.checksumsFile !== RELEASE_CHECKSUM_FILENAME || !/^[a-f0-9]{64}$/u.test(manifest.checksumsSha256 ?? '')) throw new Error('Release checksum metadata is invalid');
  if (sha256(readFileSync(checksumPath)) !== manifest.checksumsSha256) throw new Error('Release checksum manifest has been tampered with');
  if (checksums.schema !== 'motif.release.checksums.v1' || checksums.algorithm !== 'sha256' || !checksums.files || typeof checksums.files !== 'object' || Array.isArray(checksums.files)) {
    throw new Error('Unsupported Motif release checksum schema');
  }
  const checksumEntries = Object.entries(checksums.files);
  if (checksumEntries.length === 0 || checksumEntries.length > RELEASE_MAX_FILES) throw new Error('Release checksum file count is outside the supported bound');
  checksumEntries.forEach(([, digest]) => {
    if (!/^[a-f0-9]{64}$/u.test(digest)) throw new Error('Release checksum entries must be SHA-256 hex digests');
  });
  const expectedFiles = [];
  for (const [relativePath, digest] of checksumEntries.sort(([left], [right]) => left.localeCompare(right))) {
    const path = assertRegularBundleFile(root, relativePath);
    if (sha256(readFileSync(path)) !== digest) throw new Error(`Release checksum mismatch: ${relativePath}`);
    expectedFiles.push(relativePath);
  }
  const actualFiles = listFiles(root);
  const metadataFiles = [RELEASE_MANIFEST_FILENAME, RELEASE_CHECKSUM_FILENAME];
  const expectedAll = [...expectedFiles, ...metadataFiles].sort((left, right) => left.localeCompare(right));
  if (JSON.stringify(actualFiles) !== JSON.stringify(expectedAll)) {
    throw new Error('Release bundle contains an unexpected or missing file');
  }
  assertArrayOfStrings(manifest.requiredFiles, 'Release requiredFiles');
  for (const required of manifest.requiredFiles) assertRegularBundleFile(root, required, `Required release artifact ${required}`);
  const paths = manifest.paths;
  if (!paths || typeof paths !== 'object') throw new Error('Release manifest paths are missing');
  const launcherPath = assertRegularBundleFile(root, paths.launcher, 'Release launcher');
  const serverPath = assertRegularBundleFile(root, paths.server, 'Release connector server');
  const appPath = assertRegularBundleFile(root, paths.app, 'Release connector App');
  const templatePath = assertRegularBundleFile(root, paths.template, 'Release artifact template');
  const packagePath = assertRegularBundleFile(root, 'package.json', 'Release package manifest');
  const packageJson = readJson(packagePath, 'Release package manifest');
  if (packageJson.name !== 'motif-for-claude-science' || packageJson.version !== manifest.version) throw new Error('Release package identity does not match the manifest');
  const app = readFileSync(appPath, 'utf8');
  const template = readFileSync(templatePath, 'utf8');
  const server = readFileSync(serverPath, 'utf8');
  const launcher = readFileSync(launcherPath, 'utf8');
  if (!app.includes(RELEASE_PRODUCT) || !app.includes('motif.mcp.workbench.v1') || !app.includes(`content="${manifest.runtimeBuildId}"`)) throw new Error('Release MCP App identity is missing or inconsistent');
  if (!template.includes(RELEASE_PRODUCT) || !template.includes(`content="${manifest.runtimeBuildId}"`)) throw new Error('Release artifact template identity is missing or inconsistent');
  for (const marker of ['motif-claude-science', 'motif_open_workbench', 'motif_create_workbench_artifact']) {
    if (!server.includes(marker)) throw new Error(`Release connector server is missing identity marker ${marker}`);
  }
  if (!launcher.includes('MOTIF_ROOT') || !launcher.includes('motif-claude-science')) throw new Error('Release launcher identity is missing');
  const totalSize = actualFiles.reduce((sum, relativePath) => sum + lstatSync(resolve(root, relativePath)).size, 0);
  if (totalSize > RELEASE_MAX_TOTAL_BYTES) throw new Error('Release bundle exceeds the total size limit');
  return { root, manifest, checksums, paths: { launcher: launcherPath, server: serverPath, app: appPath, template: templatePath } };
}
