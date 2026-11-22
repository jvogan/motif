import { ABI_IMPORT_LIMITS } from '../bio/abi-import';
import {
  MAX_ARTIFACT_DATABASE_JSON_CHARACTERS,
  MAX_ARTIFACT_JSON_BYTES,
  MAX_ARTIFACT_RECORDS,
} from './claude-science-session';

export const MOTIF_MAX_IMPORT_FILE_BYTES = MAX_ARTIFACT_JSON_BYTES;
// UTF-8 uses at most three bytes per UTF-16 code unit, including astral scalars.
export const MOTIF_MAX_DATABASE_IMPORT_FILE_BYTES = MAX_ARTIFACT_DATABASE_JSON_CHARACTERS * 3;

export function isAbiImportFile(file: Pick<File, 'name'>): boolean {
  return /\.(?:ab1|abi)$/i.test(file.name);
}

export const INVALID_UTF8_FILE_MESSAGE = 'The file contains invalid UTF-8. Save it as UTF-8 and retry.';

export type ArtifactTextEncoding = 'utf-8' | 'windows-1252';

export async function readArtifactUtf8Text(file: Pick<Blob, 'arrayBuffer'>): Promise<string> {
  const bytes = await file.arrayBuffer();
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes).replace(/\r(?!\n)/g, '\n');
  } catch {
    throw new Error(INVALID_UTF8_FILE_MESSAGE);
  }
}

/**
 * Text for record intake: strict UTF-8 first. Bytes that are not UTF-8 are read
 * as Windows-1252, which decodes every byte, so the caller can still tell an
 * image or a binary sequence file from text saved in a legacy encoding.
 */
export async function readArtifactImportText(
  file: Pick<Blob, 'arrayBuffer'>,
): Promise<{ text: string; encoding: ArtifactTextEncoding }> {
  const bytes = await file.arrayBuffer();
  const inventoryName = 'inventory.json';
  if (bytes.byteLength >= 30 + inventoryName.length) {
    const header = new DataView(bytes);
    // Workspace exports put inventory.json first. Read only its local header.
    if (header.getUint32(0, true) === 0x04034b50 && header.getUint16(26, true) === inventoryName.length
      && new TextDecoder().decode(new Uint8Array(bytes, 30, inventoryName.length)) === inventoryName) {
      throw new Error('this is a Motif workspace ZIP, so extract inventory.json and import it');
    }
  }
  let text: string;
  let encoding: ArtifactTextEncoding = 'utf-8';
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    text = new TextDecoder('windows-1252').decode(bytes);
    encoding = 'windows-1252';
  }
  return { text: text.replace(/\r(?!\n)/g, '\n'), encoding };
}

function isDatabaseJsonFile(file: Pick<File, 'name' | 'type'>): boolean {
  return file.type === 'application/json' || /\.json$/iu.test(file.name);
}

type DatabaseFile = { file: File; database: Record<string, unknown> };
type StagedFileImport =
  | { kind: 'records' }
  | { kind: 'database'; value: DatabaseFile }
  | { kind: 'rejected'; message: string };

/** Reject oversized selections before any read and release each file before the next read. */
export async function stageArtifactFileImport(
  files: FileList | readonly File[],
  stage: (file: File, maxBytes: number) => Promise<Exclude<StagedFileImport, { kind: 'records' }> | undefined>,
): Promise<StagedFileImport> {
  if (files.length > MAX_ARTIFACT_RECORDS) {
    return { kind: 'rejected', message: `Choose at most ${MAX_ARTIFACT_RECORDS} files at a time.` };
  }
  const pending = Array.from(files);
  const selectionLimit = pending.length === 1 && isDatabaseJsonFile(pending[0])
    ? MOTIF_MAX_DATABASE_IMPORT_FILE_BYTES
    : MOTIF_MAX_IMPORT_FILE_BYTES;
  if (pending.reduce((bytes, file) => bytes + file.size, 0) > selectionLimit) {
    return {
      kind: 'rejected',
      message: `Import files cannot exceed ${Math.round(selectionLimit / (1024 * 1024))} MB.`,
    };
  }
  for (const file of pending) {
    const limit = isAbiImportFile(file) ? ABI_IMPORT_LIMITS.maxFileBytes : selectionLimit;
    const outcome = await stage(file, limit);
    if (!outcome) continue;
    return outcome.kind === 'rejected' || pending.length === 1
      ? outcome
      : { kind: 'rejected', message: 'Restore one Workspace JSON file at a time; no files were imported.' };
  }
  return { kind: 'records' };
}
