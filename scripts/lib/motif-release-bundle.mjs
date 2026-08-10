import { createHash } from 'node:crypto';
import {
  existsSync,
  closeSync,
  lstatSync,
  opendirSync,
  openSync,
  readFileSync,
  realpathSync,
  readSync,
} from 'node:fs';
import { TextDecoder } from 'node:util';
import { dirname, join, relative, resolve, sep } from 'node:path';

export const RELEASE_MANIFEST_FILENAME = 'release-manifest.json';
export const RELEASE_CHECKSUM_FILENAME = 'motif-for-claude-science-release.checksums.json';
export const RELEASE_ARCHIVE_FILENAME = 'motif-for-claude-science-release.zip';
export const RELEASE_MANIFEST_DIGEST_FILENAME = 'motif-for-claude-science-release.manifest.sha256';
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
export const RELEASE_MAX_TRUSTED_DIGEST_FILE_BYTES = 512;
export const RELEASE_MAX_ARCHIVE_BYTES = 64 * 1024 * 1024;

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

function normalizeTrustedManifestDigest(value) {
  const digest = typeof value === 'string' ? value.trim().toLowerCase() : '';
  if (!/^[a-f0-9]{64}$/u.test(digest)) throw new Error('Trusted release-manifest SHA-256 is invalid');
  return digest;
}

export function readTrustedManifestDigest(digestPath) {
  const path = resolve(digestPath);
  if (!existsSync(path)) throw new Error('Trusted release-manifest checksum file does not exist');
  const stat = lstatSync(path);
  if (stat.isSymbolicLink() || !stat.isFile()) throw new Error('Trusted release-manifest checksum must be a regular file');
  if (stat.size > RELEASE_MAX_TRUSTED_DIGEST_FILE_BYTES) throw new Error('Trusted release-manifest checksum file is oversized');
  const line = readFileSync(path, 'utf8').trim();
  const match = line.match(/^([a-f0-9]{64})(?:\s+\*?release-manifest\.json)?$/iu);
  if (!match) throw new Error('Trusted release-manifest checksum file has an invalid format');
  return normalizeTrustedManifestDigest(match[1]);
}

const ZIP_LOCAL_HEADER_SIGNATURE = 0x04034b50;
const ZIP_CENTRAL_HEADER_SIGNATURE = 0x02014b50;
const ZIP_END_SIGNATURE = 0x06054b50;
const ZIP_UTF8_FLAG = 0x0800;
const ZIP_STORE_METHOD = 0;
const ZIP_MAX_COMMENT_BYTES = 0xffff;

function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function readBoundedArchiveFile(archivePath, maxBytes) {
  const path = resolve(archivePath);
  if (!existsSync(path)) throw new Error('Release ZIP does not exist: ' + path);
  const stat = lstatSync(path);
  if (stat.isSymbolicLink() || !stat.isFile()) throw new Error('Release ZIP must be a regular file');
  if (stat.size > maxBytes) throw new Error('Release ZIP exceeds the archive-size limit');
  const descriptor = openSync(path, 'r');
  try {
    const buffer = Buffer.allocUnsafe(maxBytes + 1);
    let length = 0;
    while (length < buffer.length) {
      const count = readSync(descriptor, buffer, length, buffer.length - length, null);
      if (count === 0) break;
      length += count;
    }
    if (length > maxBytes) throw new Error('Release ZIP exceeds the archive-size limit');
    return buffer.subarray(0, length);
  } finally {
    closeSync(descriptor);
  }
}

function decodeZipName(bytes) {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    throw new Error('Release ZIP entry name is not valid UTF-8');
  }
}

function parseReleaseArchiveBytes(archive) {
  if (archive.length < 22) throw new Error('Release ZIP is truncated');
  const minimumEndOffset = Math.max(0, archive.length - (ZIP_MAX_COMMENT_BYTES + 22));
  let endOffset = -1;
  for (let offset = archive.length - 22; offset >= minimumEndOffset; offset -= 1) {
    if (archive.readUInt32LE(offset) !== ZIP_END_SIGNATURE) continue;
    const commentLength = archive.readUInt16LE(offset + 20);
    if (offset + 22 + commentLength === archive.length) {
      if (commentLength !== 0) throw new Error('Release ZIP comments are not supported');
      endOffset = offset;
      break;
    }
  }
  if (endOffset < 0) throw new Error('Release ZIP has no valid end record');

  const diskNumber = archive.readUInt16LE(endOffset + 4);
  const centralDisk = archive.readUInt16LE(endOffset + 6);
  const entriesOnDisk = archive.readUInt16LE(endOffset + 8);
  const entryCount = archive.readUInt16LE(endOffset + 10);
  const centralSize = archive.readUInt32LE(endOffset + 12);
  const centralOffset = archive.readUInt32LE(endOffset + 16);
  if (diskNumber !== 0 || centralDisk !== 0 || entriesOnDisk !== entryCount) {
    throw new Error('Release ZIP multi-disk archives are not supported');
  }
  if (entryCount === 0xffff || centralSize === 0xffffffff || centralOffset === 0xffffffff) {
    throw new Error('Release ZIP64 archives are not supported');
  }
  if (entryCount > RELEASE_MAX_BUNDLE_FILES) {
    throw new Error('Release ZIP entry count exceeds the supported limit');
  }
  if (centralOffset + centralSize !== endOffset || centralOffset > archive.length) {
    throw new Error('Release ZIP central directory is outside the archive');
  }

  const entries = [];
  const byName = new Map();
  const regions = [];
  let centralCursor = centralOffset;
  let totalBytes = 0;
  for (let index = 0; index < entryCount; index += 1) {
    if (centralCursor + 46 > endOffset || archive.readUInt32LE(centralCursor) !== ZIP_CENTRAL_HEADER_SIGNATURE) {
      throw new Error('Release ZIP central directory is truncated');
    }
    const madeBy = archive.readUInt16LE(centralCursor + 4);
    const flags = archive.readUInt16LE(centralCursor + 8);
    const method = archive.readUInt16LE(centralCursor + 10);
    const checksum = archive.readUInt32LE(centralCursor + 16);
    const compressedSize = archive.readUInt32LE(centralCursor + 20);
    const uncompressedSize = archive.readUInt32LE(centralCursor + 24);
    const nameLength = archive.readUInt16LE(centralCursor + 28);
    const extraLength = archive.readUInt16LE(centralCursor + 30);
    const commentLength = archive.readUInt16LE(centralCursor + 32);
    const externalAttributes = archive.readUInt32LE(centralCursor + 38);
    const localOffset = archive.readUInt32LE(centralCursor + 42);
    const nameStart = centralCursor + 46;
    const nameEnd = nameStart + nameLength;
    const centralEnd = nameEnd + extraLength + commentLength;
    if (centralEnd > endOffset) throw new Error('Release ZIP central entry is truncated');
    if (extraLength !== 0 || commentLength !== 0) throw new Error('Release ZIP central extra fields and comments are not supported');
    if ((flags & ~ZIP_UTF8_FLAG) !== 0 || (flags & ZIP_UTF8_FLAG) === 0) {
      throw new Error('Release ZIP entry uses unsupported flags');
    }
    if (method !== ZIP_STORE_METHOD || compressedSize !== uncompressedSize) {
      throw new Error('Release ZIP entry is not an uncompressed stored file');
    }
    if (compressedSize > RELEASE_MAX_FILE_BYTES) throw new Error('Release ZIP entry exceeds the file-size limit');
    totalBytes += uncompressedSize;
    if (totalBytes > RELEASE_MAX_TOTAL_BYTES) throw new Error('Release ZIP exceeds the total size limit');
    const nameBytes = archive.subarray(nameStart, nameEnd);
    const name = safeRelativePath(decodeZipName(nameBytes), 'Release ZIP entry path');
    if (byName.has(name)) throw new Error('Release ZIP contains a duplicate entry: ' + name);
    if (name.endsWith('/') || (externalAttributes & 0x10) !== 0 || (((madeBy >>> 8) & 0xff) === 3 && (externalAttributes >>> 28) === 0x0a)) {
      throw new Error('Release ZIP contains a directory or symbolic-link entry: ' + name);
    }
    if (localOffset >= centralOffset || localOffset + 30 > centralOffset || archive.readUInt32LE(localOffset) !== ZIP_LOCAL_HEADER_SIGNATURE) {
      throw new Error('Release ZIP local entry offset is invalid: ' + name);
    }
    const localChecksum = archive.readUInt32LE(localOffset + 14);
    const localCompressedSize = archive.readUInt32LE(localOffset + 18);
    const localUncompressedSize = archive.readUInt32LE(localOffset + 22);
    const localFlags = archive.readUInt16LE(localOffset + 6);
    const localMethod = archive.readUInt16LE(localOffset + 8);
    const localNameLength = archive.readUInt16LE(localOffset + 26);
    const localExtraLength = archive.readUInt16LE(localOffset + 28);
    const localNameStart = localOffset + 30;
    const localNameEnd = localNameStart + localNameLength;
    const dataStart = localNameEnd + localExtraLength;
    const dataEnd = dataStart + compressedSize;
    if (localFlags !== flags || localMethod !== method || localChecksum !== checksum || localCompressedSize !== compressedSize || localUncompressedSize !== uncompressedSize || localExtraLength !== 0 || localNameEnd > centralOffset || dataStart > centralOffset || dataEnd > centralOffset) {
      throw new Error('Release ZIP local entry metadata is not canonical: ' + name);
    }
    if (!archive.subarray(localNameStart, localNameEnd).equals(nameBytes)) {
      throw new Error('Release ZIP local and central entry names differ: ' + name);
    }
    const data = archive.subarray(dataStart, dataEnd);
    if (crc32(data) !== checksum) throw new Error('Release ZIP entry checksum mismatch: ' + name);
    regions.push({ start: localOffset, end: dataEnd, name });
    const entry = { name, data, checksum };
    entries.push(entry);
    byName.set(name, entry);
    centralCursor = centralEnd;
  }
  if (centralCursor !== endOffset) throw new Error('Release ZIP contains an unexpected central-directory entry');
  regions.sort((left, right) => left.start - right.start);
  if (regions.length === 0) {
    if (centralOffset !== 0) throw new Error('Release ZIP has a gap before the central directory');
  } else {
    if (regions[0].start !== 0) throw new Error('Release ZIP has a gap before the first local entry');
    for (let index = 1; index < regions.length; index += 1) {
      if (regions[index].start !== regions[index - 1].end) {
        throw new Error('Release ZIP local entries are not contiguous');
      }
    }
    if (regions.at(-1).end !== centralOffset) throw new Error('Release ZIP has a gap before the central directory');
  }
  return { entries, byName };
}

/**
 * Parse only deterministic, stored ZIP entries. No archive extraction is
 * performed: every path, offset, size, checksum, and file type is validated
 * while the bounded archive bytes remain in memory.
 */
export function parseReleaseArchive(archivePath, { maxArchiveBytes = RELEASE_MAX_ARCHIVE_BYTES } = {}) {
  if (!Number.isSafeInteger(maxArchiveBytes) || maxArchiveBytes < 22 || maxArchiveBytes > RELEASE_MAX_ARCHIVE_BYTES) throw new Error('Release ZIP archive-size limit is invalid');
  const archive = readBoundedArchiveFile(archivePath, maxArchiveBytes);
  const parsed = parseReleaseArchiveBytes(archive);
  return {
    ...parsed,
    archiveBytes: archive.length,
    archiveSha256: sha256(archive),
  };
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

function listFiles(root, directory = root, output = [], state = { directoryNodes: 0, entries: 0, totalBytes: 0 }, depth = 0) {
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
      state.totalBytes += stat.size;
      if (state.totalBytes > RELEASE_MAX_TOTAL_BYTES) {
        throw new Error('Release bundle exceeds the total size limit');
      }
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

export function verifyReleaseBundle(bundlePath, { expectedVersion = null, expectedManifestSha256 = null } = {}) {
  const root = canonicalRoot(bundlePath);
  const manifestPath = assertRegularBundleFile(root, RELEASE_MANIFEST_FILENAME, 'Release manifest');
  const checksumPath = assertRegularBundleFile(root, RELEASE_CHECKSUM_FILENAME, 'Release checksum manifest');
  if (lstatSync(manifestPath).size > 4 * 1024 * 1024) throw new Error('Release manifest exceeds the JSON size limit');
  const manifestBytes = readFileSync(manifestPath);
  const manifestSha256 = sha256(manifestBytes);
  const trustedManifestSha256 = expectedManifestSha256 === null ? null : normalizeTrustedManifestDigest(expectedManifestSha256);
  if (trustedManifestSha256 !== null && manifestSha256 !== trustedManifestSha256) {
    throw new Error('Release manifest does not match the externally trusted SHA-256');
  }
  let manifest;
  try {
    manifest = JSON.parse(manifestBytes.toString('utf8'));
  } catch {
    throw new Error('Release manifest is not valid JSON');
  }
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
  const expectedFiles = checksumEntries
    .map(([relativePath]) => safeRelativePath(relativePath, 'Release checksum path'))
    .sort((left, right) => left.localeCompare(right));
  const traversalState = { directoryNodes: 0, entries: 0, totalBytes: 0 };
  const actualFiles = listFiles(root, root, [], traversalState);
  const metadataFiles = [RELEASE_MANIFEST_FILENAME, RELEASE_CHECKSUM_FILENAME];
  const expectedAll = [...expectedFiles, ...metadataFiles].sort((left, right) => left.localeCompare(right));
  if (JSON.stringify(actualFiles) !== JSON.stringify(expectedAll)) {
    throw new Error('Release bundle contains an unexpected or missing file');
  }
  for (const [relativePath, digest] of checksumEntries.sort(([left], [right]) => left.localeCompare(right))) {
    const path = assertRegularBundleFile(root, relativePath);
    if (sha256(readFileSync(path)) !== digest) throw new Error(`Release checksum mismatch: ${relativePath}`);
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
  return {
    root,
    manifest,
    checksums,
    manifestSha256,
    externalManifestDigestMatched: trustedManifestSha256 !== null,
    paths: { launcher: launcherPath, server: serverPath, app: appPath, template: templatePath },
  };
}

export function verifyReleaseArchive(archivePath, {
  releaseDirectory,
  expectedVersion = null,
  expectedManifestSha256 = null,
  maxArchiveBytes = RELEASE_MAX_ARCHIVE_BYTES,
} = {}) {
  if (!releaseDirectory) throw new Error('Release ZIP verification requires the extracted release bundle');
  const verified = verifyReleaseBundle(releaseDirectory, { expectedVersion, expectedManifestSha256 });
  const archive = parseReleaseArchive(archivePath, { maxArchiveBytes });
  const expectedFiles = [
    ...Object.keys(verified.checksums.files),
    RELEASE_MANIFEST_FILENAME,
    RELEASE_CHECKSUM_FILENAME,
  ].sort((left, right) => left.localeCompare(right));
  const actualFiles = archive.entries.map(({ name }) => name).sort((left, right) => left.localeCompare(right));
  if (JSON.stringify(actualFiles) !== JSON.stringify(expectedFiles)) {
    throw new Error('Release ZIP contains an unexpected or missing file');
  }
  for (const relativePath of expectedFiles) {
    const entry = archive.byName.get(relativePath);
    if (!entry) throw new Error('Release ZIP is missing ' + relativePath);
    const expectedDigest = relativePath === RELEASE_MANIFEST_FILENAME
      ? verified.manifestSha256
      : relativePath === RELEASE_CHECKSUM_FILENAME
        ? verified.manifest.checksumsSha256
        : verified.checksums.files[relativePath];
    if (sha256(entry.data) !== expectedDigest) throw new Error('Release ZIP checksum mismatch: ' + relativePath);
  }
  return {
    ...verified,
    archiveBytes: archive.archiveBytes,
    archiveEntries: archive.entries.length,
    archiveSha256: archive.archiveSha256,
  };
}

export function verifyReleaseArtifacts({
  releaseDirectory,
  archivePath,
  manifestDigestPath,
  expectedVersion = null,
  maxArchiveBytes = RELEASE_MAX_ARCHIVE_BYTES,
} = {}) {
  if (!manifestDigestPath) throw new Error('Release verification requires an external manifest digest asset');
  const externalManifestDigest = readTrustedManifestDigest(manifestDigestPath);
  const verified = verifyReleaseArchive(archivePath, {
    releaseDirectory,
    expectedVersion,
    expectedManifestSha256: externalManifestDigest,
    maxArchiveBytes,
  });
  return {
    ...verified,
    externalManifestDigest,
    externalManifestDigestMatched: true,
  };
}
