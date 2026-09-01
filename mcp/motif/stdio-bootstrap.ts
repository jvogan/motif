import { open, readFile, type FileHandle } from 'node:fs/promises';

export const MAX_MOTIF_RUNTIME_ASSET_BYTES = 8 * 1024 * 1024;

const BUILD_ID_META_PATTERN = /<meta name="motif-build-id" content="([a-f0-9]{64})"\s*\/?>/u;
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
};

async function readBoundedUtf8File(
  path: string,
  label: string,
  maxBytes: number,
): Promise<string> {
  let handle: FileHandle | undefined;
  try {
    handle = await open(path, 'r');
    const stat = await handle.stat();
    if (!stat.isFile() || stat.size <= 0 || stat.size > maxBytes) {
      throw new Error(`${label} must be a non-empty regular file no larger than ${maxBytes.toLocaleString()} bytes.`);
    }
    const bytes = await handle.readFile();
    if (bytes.byteLength > maxBytes) {
      throw new Error(`${label} exceeds the maximum supported size of ${maxBytes.toLocaleString()} bytes.`);
    }
    try {
      return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    } catch {
      throw new Error(`${label} is not valid UTF-8.`);
    }
  } catch (error) {
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
    throw new Error('Motif runtime resources have missing or inconsistent build identities.');
  }
  if (!ARTIFACT_DATA_TAG_PATTERN.test(artifactTemplateHtml)) {
    throw new Error('Motif artifact template is missing its embedded data tag.');
  }
  return {
    workbenchHtml,
    artifactTemplateHtml,
    runtimeBuildId: workbenchBuildId,
  };
}

export async function readMotifVersion(
  candidates: MotifVersionManifestCandidate[],
  fallbackVersion = '0.3.6',
): Promise<string> {
  for (const candidate of candidates) {
    let text: string;
    try {
      text = await readFile(candidate.path, 'utf8');
    } catch (error) {
      if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') continue;
      throw new Error(`${candidate.label} could not be read.`);
    }
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
