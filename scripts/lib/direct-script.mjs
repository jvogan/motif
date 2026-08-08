import { realpathSync } from 'node:fs';

// Keep direct-execution checks bounded: a path supplied by a launcher is not
// trusted input, and realpathSync can otherwise receive an arbitrarily long
// string before the helper has validated it.
const MAX_SCRIPT_PATH_BYTES = 4096;

function canonicalScriptPath(value, label) {
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`Cannot resolve ${label}: a script path is required`);
  }
  if (new TextEncoder().encode(value).byteLength > MAX_SCRIPT_PATH_BYTES) {
    throw new Error(`Cannot resolve ${label}: script path exceeds ${MAX_SCRIPT_PATH_BYTES} bytes`);
  }
  try {
    return realpathSync(value);
  } catch (error) {
    throw new Error(`Cannot resolve ${label}: ${error instanceof Error ? error.message : String(error)}`, { cause: error });
  }
}

/**
 * Detect direct `node helper.mjs` execution across filesystem aliases such as
 * macOS /tmp and /private/tmp. A present but unresolvable argv path fails
 * closed instead of silently skipping the CLI body.
 */
export function isDirectScriptExecution(entryPath, modulePath) {
  if (entryPath == null) return false;
  return canonicalScriptPath(entryPath, 'argv[1]') === canonicalScriptPath(modulePath, 'import.meta.url');
}
