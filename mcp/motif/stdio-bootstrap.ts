import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import { open, type FileHandle } from 'node:fs/promises';

export const MAX_MOTIF_RUNTIME_ASSET_BYTES = 8 * 1024 * 1024;

const BUILD_ID_META_PATTERN = /<meta name="motif-build-id" content="([a-f0-9]{64})"\s*\/?>/u;
const APP_BRIDGE_PATTERN = /<script data-motif-mcp-app-bridge>\s*[\s\S]+?<\/script>(?=\s*<\/body>\s*<\/html>\s*$)/u;
const DOCUMENT_CLOSE_PATTERN = /<\/body>\s*<\/html>\s*$/u;
const CONNECTOR_BINDING_PATTERN = /<meta name="motif-connector-binding" content="([a-f0-9]{64})">\n/u;
const REPAIR = 'Rebuild or reinstall the Motif connector.';
// A checkout launch runs the build output in place; a packaged launch runs an installed copy.
export const MOTIF_CHECKOUT_REPAIR = 'Run `npm run build:motif` in the Motif checkout, then reconnect the connector.';
export const MOTIF_PACKAGED_REPAIR = 'Reinstall the Motif connector.';
const ARTIFACT_DATA_TAG_PATTERN = /<script type="application\/json" id="motif-artifact-data">[\s\S]*?<\/script>/u;
const SEMVER_PATTERN = /^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/u;

export type MotifVersionManifestCandidate = {
  path: string;
  label: string;
};

export type MotifRuntimeAssets = {
  workbenchHtml: string;
  artifactTemplateHtml: string;
  runtimeBuildId: string;
};

type RuntimeAssetOptions = {
  maxBytes?: number;
  connector?: { serverPath: string; version: string; requireBinding: boolean };
};

async function readBoundedUtf8File(
  path: string,
  label: string,
  maxBytes: number,
  allowMissing: true,
): Promise<string | undefined>;
async function readBoundedUtf8File(path: string, label: string, maxBytes: number): Promise<string>;
async function readBoundedUtf8File(
  path: string,
  label: string,
  maxBytes: number,
  allowMissing = false,
): Promise<string | undefined> {
  let handle: FileHandle | undefined;
  try {
    handle = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0));
    const stat = await handle.stat();
    if (!stat.isFile() || stat.size <= 0 || stat.size > maxBytes) {
      throw new Error(`${label} must be a non-empty regular file no larger than ${maxBytes.toLocaleString()} bytes.`);
    }
    const bytes = Buffer.allocUnsafe(stat.size + 1);
    let used = 0;
    while (used < bytes.length) {
      const { bytesRead } = await handle.read(bytes, used, bytes.length - used, null);
      if (bytesRead === 0) break;
      used += bytesRead;
    }
    if (used !== stat.size) {
      throw new Error(`${label} changed while being read.`);
    }
    try {
      return new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes.subarray(0, used));
    } catch {
      throw new Error(`${label} is not valid UTF-8.`);
    }
  } catch (error) {
    if (allowMissing && (error as NodeJS.ErrnoException)?.code === 'ENOENT') return undefined;
    if (error instanceof Error && error.message.startsWith(label)) throw error;
    throw new Error(`${label} could not be read.`);
  } finally {
    await handle?.close();
  }
}

export async function loadMotifRuntimeAssets(
  workbenchPath: string,
  artifactTemplatePath: string,
  options: RuntimeAssetOptions = {},
): Promise<MotifRuntimeAssets> {
  const maxBytes = options.maxBytes ?? MAX_MOTIF_RUNTIME_ASSET_BYTES;
  const repair = !options.connector ? REPAIR
    : options.connector.requireBinding ? MOTIF_PACKAGED_REPAIR : MOTIF_CHECKOUT_REPAIR;
  if (!Number.isSafeInteger(maxBytes) || maxBytes <= 0) {
    throw new Error('Motif runtime asset byte limit must be a positive safe integer.');
  }
  const [workbenchHtml, artifactTemplateHtml] = await Promise.all([
    readBoundedUtf8File(workbenchPath, 'Motif MCP App resource', maxBytes),
    readBoundedUtf8File(artifactTemplatePath, 'Motif artifact template', maxBytes),
  ]);
  const workbenchBuildId = workbenchHtml.match(BUILD_ID_META_PATTERN)?.[1];
  const templateBuildId = artifactTemplateHtml.match(BUILD_ID_META_PATTERN)?.[1];
  if (!workbenchBuildId || !templateBuildId || workbenchBuildId !== templateBuildId) {
    throw new Error(`Motif runtime resources have missing or inconsistent build identities. ${repair}`);
  }
  if (!ARTIFACT_DATA_TAG_PATTERN.test(artifactTemplateHtml)) {
    throw new Error(`Motif artifact template is missing its embedded data tag. ${repair}`);
  }
  const binding = CONNECTOR_BINDING_PATTERN.exec(workbenchHtml);
  const unboundApp = workbenchHtml.replace(CONNECTOR_BINDING_PATTERN, '');
  const bridge = APP_BRIDGE_PATTERN.exec(unboundApp);
  if (!bridge || !DOCUMENT_CLOSE_PATTERN.test(artifactTemplateHtml)
    || unboundApp.slice(0, bridge.index) !== artifactTemplateHtml.replace(DOCUMENT_CLOSE_PATTERN, '')) {
    throw new Error(`Motif MCP App bridge or template does not match the artifact. ${repair}`);
  }
  const connector = options.connector;
  if (connector && (binding || connector.requireBinding)) {
    const server = await readBoundedUtf8File(connector.serverPath, 'Motif MCP server', maxBytes);
    const expected = createHash('sha256')
      .update(connector.version).update('\0').update(server).update('\0').update(unboundApp)
      .digest('hex');
    if (binding?.[1] !== expected) {
      throw new Error(`Motif server, App, or release version is from a different build. ${repair}`);
    }
  }
  return {
    workbenchHtml,
    artifactTemplateHtml,
    runtimeBuildId: workbenchBuildId,
  };
}

export async function readMotifVersion(
  candidates: MotifVersionManifestCandidate[],
  fallbackVersion = '0.5.1',
): Promise<string> {
  for (const candidate of candidates) {
    const text = await readBoundedUtf8File(candidate.path, candidate.label, 128 * 1024, true);
    if (text === undefined) continue;
    let manifest: unknown;
    try {
      manifest = JSON.parse(text);
    } catch {
      throw new Error(`${candidate.label} is malformed JSON.`);
    }
    if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) {
      throw new Error(`${candidate.label} must contain a JSON object.`);
    }
    const version = (manifest as Record<string, unknown>).version;
    if (typeof version !== 'string' || !SEMVER_PATTERN.test(version)) {
      throw new Error(`${candidate.label} has a missing or invalid semantic version.`);
    }
    return version;
  }
  if (!SEMVER_PATTERN.test(fallbackVersion)) {
    throw new Error('Motif fallback version is not a valid semantic version.');
  }
  return fallbackVersion;
}
