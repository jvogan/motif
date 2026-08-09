#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadDependencyPolicy } from './lib/supply-chain-policy.mjs';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const DAY_MS = 24 * 60 * 60 * 1000;
const MAX_VERSION_METADATA_BYTES = 2 * 1024 * 1024;
// Established packages such as Vite have packuments above 32 MiB. Keep the
// registry read bounded while allowing their exact publish time to be checked.
const MAX_PACKUMENT_BYTES = 64 * 1024 * 1024;
const NPM_VERSION_METADATA_ACCEPT = 'application/json';
const IMMUTABLE_COMMIT_ID = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/iu;

function isImmutableCommitId(value) {
  return typeof value === 'string' && IMMUTABLE_COMMIT_ID.test(value) && !/^0+$/u.test(value);
}

function readJson(path, label) {
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch (error) {
    throw new Error(`${label} is not valid JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function packageName(lockPath) {
  const marker = lockPath.lastIndexOf('/node_modules/');
  const relative = marker >= 0 ? lockPath.slice(marker + '/node_modules/'.length) : lockPath.replace(/^node_modules\//u, '');
  if (relative.startsWith('@')) return relative.split('/').slice(0, 2).join('/');
  return relative.split('/')[0] ?? relative;
}

function lockEntries(lock) {
  return Object.entries(lock.packages ?? {})
    .filter(([path, metadata]) => path !== '' && typeof metadata?.version === 'string')
    .map(([path, metadata]) => ({
      path,
      name: packageName(path),
      version: metadata.version,
      resolved: metadata.resolved,
      integrity: metadata.integrity,
    }));
}

function readBaselineLockfile(workspace, options) {
  const environment = options.environment ?? process.env;
  const configuredRef = options.baseRef
    ?? environment.MOTIF_COOLING_OFF_BASE_SHA
    ?? environment.MOTIF_COOLING_OFF_BASE_REF;
  const hasExplicitBaseline = options.baseLockfileText !== undefined
    || options.baseLockfilePath !== undefined;
  if (environment.CI && !hasExplicitBaseline && !configuredRef) {
    throw new Error('Cooling-off policy requires the event base commit in CI; it must be a full immutable 40- or 64-hex commit ID');
  }
  if (environment.CI && configuredRef !== undefined && !isImmutableCommitId(configuredRef)) {
    throw new Error('Cooling-off policy requires a valid nonzero baseline reference: the event base commit must be a full immutable 40- or 64-hex commit ID');
  }
  if (options.baseLockfileText) return JSON.parse(options.baseLockfileText);
  if (options.baseLockfilePath) return readJson(resolve(workspace, options.baseLockfilePath), 'Cooling-off baseline lockfile');
  const ref = configuredRef ?? 'HEAD^';
  if (typeof ref !== 'string' || !ref.trim() || /^0+$/u.test(ref)) {
    throw new Error('Cooling-off policy requires a valid nonzero baseline reference');
  }
  try {
    const text = execFileSync('git', ['show', `${ref}:package-lock.json`], {
      cwd: workspace,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      maxBuffer: 8 * 1024 * 1024,
    });
    return JSON.parse(text);
  } catch (error) {
    throw new Error(`Cooling-off policy requires a readable baseline package-lock.json (${ref}): ${error instanceof Error ? error.message : String(error)}`);
  }
}

function changedEntries(current, baseline) {
  const oldByPath = new Map(lockEntries(baseline).map(entry => [entry.path, entry]));
  return lockEntries(current).filter((entry) => {
    const old = oldByPath.get(entry.path);
    return !old
      || old.name !== entry.name
      || old.version !== entry.version
      || old.resolved !== entry.resolved
      || old.integrity !== entry.integrity;
  });
}

function exceptionMap(policy, now) {
  const exceptions = policy.coolingOffExceptions ?? [];
  if (!Array.isArray(exceptions)) throw new Error('coolingOffExceptions must be an array');
  const map = new Map();
  for (const exception of exceptions) {
    if (!exception || typeof exception !== 'object') throw new Error('Cooling-off exception must be an object');
    const { name, version, rationale, reviewer, expiresAt } = exception;
    if (typeof name !== 'string' || !name || typeof version !== 'string' || !/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/u.test(version)) {
      throw new Error('Cooling-off exceptions require an exact package name and version');
    }
    if (typeof rationale !== 'string' || rationale.trim().length < 12 || typeof reviewer !== 'string' || !reviewer.trim()) {
      throw new Error(`${name}@${version} cooling-off exception requires a rationale and reviewer`);
    }
    const expiry = Date.parse(expiresAt ?? '');
    if (!Number.isFinite(expiry) || expiry <= now) throw new Error(`${name}@${version} cooling-off exception is expired or has an invalid expiry`);
    const key = `${name}@${version}`;
    if (map.has(key)) throw new Error(`Duplicate cooling-off exception for ${key}`);
    map.set(key, exception);
  }
  return map;
}

function registryUrl(registry, name) {
  const base = registry.endsWith('/') ? registry : `${registry}/`;
  return new URL(encodeURIComponent(name), base).toString();
}

function registryVersionUrl(registry, name, version) {
  const packageUrl = registryUrl(registry, name);
  return new URL(encodeURIComponent(version), `${packageUrl}/`).toString();
}

async function requestRegistry(fetchImpl, url, accept) {
  let response;
  try {
    response = await fetchImpl(url, {
      headers: { accept },
      redirect: 'error',
    });
  } catch (error) {
    throw new Error(`Registry metadata request failed for ${url}: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (!response?.ok) throw new Error(`Registry metadata request failed for ${url}: HTTP ${response?.status ?? 'unknown'}`);
  return response;
}

function chunkBytes(chunk) {
  return typeof chunk === 'string' ? new TextEncoder().encode(chunk).byteLength : chunk?.byteLength ?? 0;
}

async function readBoundedResponseText(response, url, maxBytes, label) {
  let bytes = 0;
  const chunks = [];
  const decoder = new TextDecoder('utf-8', { fatal: true });
  const append = (chunk) => {
    bytes += chunkBytes(chunk);
    if (bytes > maxBytes) throw new Error(`Registry ${label} response exceeded ${maxBytes} bytes for ${url}`);
    try {
      if (typeof chunk === 'string') {
        chunks.push(decoder.decode());
        chunks.push(chunk);
      } else {
        chunks.push(decoder.decode(chunk, { stream: true }));
      }
    } catch (error) {
      throw new Error(`Registry metadata response was not valid UTF-8 for ${url}: ${error instanceof Error ? error.message : String(error)}`);
    }
  };

  if (response.body?.getReader) {
    const reader = response.body.getReader();
    try {
      while (true) {
        const next = await reader.read();
        if (next.done) break;
        append(next.value);
      }
    } catch (error) {
      await reader.cancel().catch(() => {});
      throw error;
    } finally {
      reader.releaseLock();
    }
  } else if (response.body?.[Symbol.asyncIterator]) {
    for await (const chunk of response.body) append(chunk);
  } else if (typeof response.text === 'function') {
    append(await response.text());
  } else {
    throw new Error(`Registry metadata response had no readable body for ${url}`);
  }
  try {
    chunks.push(decoder.decode());
  } catch (error) {
    throw new Error(`Registry metadata response was not valid UTF-8 for ${url}: ${error instanceof Error ? error.message : String(error)}`);
  }
  return chunks.join('');
}

async function readRegistryPublishMetadata(fetchImpl, url, version) {
  const response = await requestRegistry(fetchImpl, url, 'application/json');
  let metadata;
  try {
    metadata = JSON.parse(await readBoundedResponseText(response, url, MAX_PACKUMENT_BYTES, 'packument'));
  } catch (error) {
    if (error instanceof Error && /response exceeded/u.test(error.message)) throw error;
    throw new Error(`Registry packument response was not JSON for ${url}: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) {
    throw new Error(`Registry packument response was not an object for ${url}`);
  }
  if (typeof metadata.name !== 'string') throw new Error(`Registry packument has no package name for ${url}`);
  if (!metadata.time || typeof metadata.time !== 'object' || Array.isArray(metadata.time)) {
    throw new Error(`Registry packument has no publish-time object for ${metadata.name}`);
  }
  const publishedAt = metadata.time[version];
  if (typeof publishedAt !== 'string') throw new Error(`Registry packument has no exact ${version} publish timestamp for ${metadata.name}`);
  return { name: metadata.name, publishedAt };
}

async function readRegistryVersionMetadata(fetchImpl, url, entry) {
  const response = await requestRegistry(fetchImpl, url, NPM_VERSION_METADATA_ACCEPT);
  let metadata;
  try {
    metadata = JSON.parse(await readBoundedResponseText(response, url, MAX_VERSION_METADATA_BYTES, 'version metadata'));
  } catch (error) {
    if (error instanceof Error && /response exceeded/u.test(error.message)) throw error;
    throw new Error(`Registry version metadata response was not JSON for ${url}: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) {
    throw new Error(`Registry version metadata was not an object for ${url}`);
  }
  const version = metadata.versions?.[entry.version]
    ?? (metadata.version === entry.version ? metadata : undefined);
  if (!version || typeof version !== 'object' || Array.isArray(version) || version.version !== entry.version) {
    throw new Error(`Registry metadata has no exact ${entry.name}@${entry.version} version`);
  }
  return { name: metadata.name ?? version.name, version };
}

async function readRegistryMetadata(fetchImpl, registry, entry) {
  const versionUrl = registryVersionUrl(registry, entry.name, entry.version);
  const packumentUrl = registryUrl(registry, entry.name);
  const [versionMetadata, publishMetadata] = await Promise.all([
    readRegistryVersionMetadata(fetchImpl, versionUrl, entry),
    readRegistryPublishMetadata(fetchImpl, packumentUrl, entry.version),
  ]);
  if (versionMetadata.name !== entry.name || publishMetadata.name !== entry.name) {
    throw new Error(`Registry metadata name mismatch for ${entry.name}@${entry.version}`);
  }
  return {
    name: entry.name,
    versions: { [entry.version]: versionMetadata.version },
    time: { [entry.version]: publishMetadata.publishedAt },
  };
}

function assertRegistryIdentity(entry, metadata, registry) {
  if (metadata.name !== entry.name) throw new Error(`Registry metadata name mismatch for ${entry.name}@${entry.version}`);
  const version = metadata.versions?.[entry.version];
  if (!version || version.version !== entry.version) throw new Error(`Registry metadata has no exact ${entry.name}@${entry.version} version`);
  if (!version.dist || version.dist.tarball !== entry.resolved) throw new Error(`Registry tarball mismatch for ${entry.name}@${entry.version}`);
  if (version.dist.integrity !== entry.integrity) throw new Error(`Registry integrity mismatch for ${entry.name}@${entry.version}`);
  const registryOrigin = new URL(registry).origin;
  if (new URL(entry.resolved).origin !== registryOrigin) throw new Error(`Lockfile source is outside the reviewed registry for ${entry.name}@${entry.version}`);
  const publishedAt = metadata.time?.[entry.version];
  const publishedMs = Date.parse(publishedAt ?? '');
  if (!Number.isFinite(publishedMs)) throw new Error(`Registry publish timestamp is missing or invalid for ${entry.name}@${entry.version}`);
  return publishedMs;
}

export async function checkDependencyCoolingOff(rootPath = root, options = {}) {
  const workspace = resolve(rootPath);
  const environment = options.environment ?? process.env;
  const { policy } = loadDependencyPolicy(workspace);
  const current = readJson(join(workspace, 'package-lock.json'), 'package-lock.json');
  const baseline = readBaselineLockfile(workspace, options);
  const now = options.now instanceof Date ? options.now.getTime() : Number(options.now ?? Date.now());
  if (!Number.isFinite(now)) throw new Error('Cooling-off checker requires a finite current timestamp');
  const exceptionByIdentity = exceptionMap(policy, now);
  const changed = changedEntries(current, baseline);
  const unique = [...new Map(changed.map(entry => [`${entry.name}@${entry.version}`, entry])).values()];
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  if (typeof fetchImpl !== 'function') throw new Error('Cooling-off checker requires fetch or an injected registry client');
  const checked = [];
  for (const entry of unique) {
    if (typeof entry.resolved !== 'string' || typeof entry.integrity !== 'string') throw new Error(`Changed dependency ${entry.name}@${entry.version} lacks a registry source or integrity`);
    const identity = `${entry.name}@${entry.version}`;
    const metadata = await readRegistryMetadata(fetchImpl, policy.registry, entry);
    const publishedMs = assertRegistryIdentity(entry, metadata, policy.registry);
    const ageDays = (now - publishedMs) / DAY_MS;
    if (ageDays < 0) throw new Error(`Registry publish timestamp is in the future for ${identity}`);
    if (ageDays < Number(policy.coolingOffDays ?? 7) && !exceptionByIdentity.has(identity)) {
      throw new Error(`${identity} is only ${ageDays.toFixed(2)} days old; cooling-off requires ${policy.coolingOffDays} days`);
    }
    checked.push({ identity, ageDays: Number(ageDays.toFixed(2)), exception: exceptionByIdentity.has(identity) });
  }
  return {
    coolingOffDays: Number(policy.coolingOffDays ?? 7),
    changedPackageCount: unique.length,
    checked,
    baseline: options.baseLockfilePath
      ?? options.baseRef
      ?? environment.MOTIF_COOLING_OFF_BASE_SHA
      ?? environment.MOTIF_COOLING_OFF_BASE_REF
      ?? 'HEAD^',
  };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const result = await checkDependencyCoolingOff();
    console.log(`Dependency cooling-off passed: ${result.changedPackageCount} changed package version${result.changedPackageCount === 1 ? '' : 's'} checked; ${result.coolingOffDays}-day window.`);
  } catch (error) {
    console.error(`Dependency cooling-off failed: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  }
}
