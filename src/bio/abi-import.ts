/**
 * Bounded reader for Applied Biosystems ABIF / AB1 chromatogram files.
 *
 * The public trace result deliberately contains only JSON-compatible values.
 * It can therefore live in `SequenceBlock.sourceMetadata` and round-trip through
 * SQLite, IndexedDB, workspace backups, and a future standalone artifact
 * without a typed-array or binary-blob encoding step.
 */

export const SANGER_TRACE_SCHEMA = 'motif.sanger-trace.v1' as const;

export const ABI_IMPORT_LIMITS = {
  maxFileBytes: 10 * 1024 * 1024,
  maxDirectoryEntries: 16_384,
  maxBaseCalls: 100_000,
  maxTraceSamplesPerChannel: 500_000,
  maxTotalTraceSamples: 2_000_000,
  maxOptionalMetadataBytes: 65_536,
  maxOptionalMetadataText: 4_096,
} as const;

export type SangerBase = 'A' | 'C' | 'G' | 'T';

export interface SangerTraceChannels {
  A: number[];
  C: number[];
  G: number[];
  T: number[];
}

export interface SangerTraceSourceMetadata {
  format: 'ABIF';
  abifVersion: number;
  baseCallsTag: 'PBAS2' | 'PBAS1';
  qualityScoresTag: 'PCON2' | 'PCON1' | null;
  peakPositionsTag: 'PLOC2' | 'PLOC1' | null;
  channelTags: Partial<Record<SangerBase, 'DATA9' | 'DATA10' | 'DATA11' | 'DATA12'>>;
  sampleName?: string;
  sampleWell?: string;
  instrumentModel?: string;
  dyeSetName?: string;
  dataCollectionSoftwareVersion?: string;
  basecallerVersion?: string;
}

/** Stable, versioned, JSON-serializable Sanger chromatogram contract. */
export interface SangerTraceData {
  schema: typeof SANGER_TRACE_SCHEMA;
  version: 1;
  /** Calls exactly as stored by the selected PBAS tag. */
  baseCalls: string;
  /** Alias retained for record-oriented consumers. */
  sequence: string;
  qualityScores: number[];
  peakPositions: number[];
  channels: SangerTraceChannels;
  /** Largest decoded channel length after FWO_1 mapping. */
  sampleCount: number;
  /** FWO_1 base order, for example `GATC`; null when absent or invalid. */
  dyeOrder: string | null;
  /** RevC1 storage flag. This is not the read's orientation to a template. */
  storedReverseComplement: boolean | null;
  warnings: string[];
  metadata: SangerTraceSourceMetadata;
}

export interface AbiImportRecord {
  name: string;
  sequence: string;
  qualityScores: number[];
  warnings: string[];
  sangerTrace: SangerTraceData;
  /** Compatibility fields used by the existing intake route. */
  metadata: {
    peakPositions: number[];
    traceLength: number;
  };
}

type AbiDirectoryEntry = {
  entryOffset: number;
  tagName: string;
  tagNumber: number;
  elementType: number;
  elementSize: number;
  elementCount: number;
  dataSize: number;
  dataOffset: number;
};

const ABIF_ROOT_OFFSET = 6;
const ABIF_DIRECTORY_ENTRY_SIZE = 28;
const DATA_FIELD_OFFSET = 20;

const ABI_TYPE_BYTE = 1;
const ABI_TYPE_CHAR = 2;
const ABI_TYPE_SHORT = 4;
const ABI_TYPE_LONG = 5;
const ABI_TYPE_PSTRING = 18;
const ABI_TYPE_CSTRING = 19;
const ABI_TYPE_DIRECTORY = 1023;

export class AbiImportError extends Error {
  constructor(message: string) {
    super(`Invalid ABI/AB1 file: ${message}`);
    this.name = 'AbiImportError';
  }
}

function fail(message: string): never {
  throw new AbiImportError(message);
}

function toDataView(input: ArrayBuffer | Uint8Array): DataView {
  if (input instanceof Uint8Array) {
    return new DataView(input.buffer, input.byteOffset, input.byteLength);
  }
  return new DataView(input);
}

function assertRange(view: DataView, offset: number, length: number, label: string): void {
  if (!Number.isSafeInteger(offset) || !Number.isSafeInteger(length) || offset < 0 || length < 0) {
    fail(`${label} has an invalid byte range.`);
  }
  if (offset > view.byteLength || length > view.byteLength - offset) {
    fail(`${label} points outside the ${view.byteLength.toLocaleString()}-byte file.`);
  }
}

function checkedProduct(left: number, right: number, label: string): number {
  if (!Number.isSafeInteger(left) || !Number.isSafeInteger(right) || left < 0 || right < 0) {
    fail(`${label} contains an invalid count or element size.`);
  }
  const product = left * right;
  if (!Number.isSafeInteger(product)) fail(`${label} byte size overflows the supported range.`);
  return product;
}

function readTagName(view: DataView, offset: number): string {
  assertRange(view, offset, 4, 'ABIF tag name');
  return String.fromCharCode(
    view.getUint8(offset),
    view.getUint8(offset + 1),
    view.getUint8(offset + 2),
    view.getUint8(offset + 3),
  );
}

function readDirectoryEntry(view: DataView, offset: number): AbiDirectoryEntry {
  assertRange(view, offset, ABIF_DIRECTORY_ENTRY_SIZE, 'ABIF directory entry');
  return {
    entryOffset: offset,
    tagName: readTagName(view, offset),
    tagNumber: view.getUint32(offset + 4, false),
    elementType: view.getUint16(offset + 8, false),
    elementSize: view.getUint16(offset + 10, false),
    elementCount: view.getUint32(offset + 12, false),
    dataSize: view.getUint32(offset + 16, false),
    dataOffset: view.getUint32(offset + 20, false),
  };
}

function entryKey(entry: Pick<AbiDirectoryEntry, 'tagName' | 'tagNumber'>): string {
  return `${entry.tagName}${entry.tagNumber}`;
}

function readDirectory(view: DataView): { version: number; entries: Map<string, AbiDirectoryEntry> } {
  assertRange(view, 0, ABIF_ROOT_OFFSET + ABIF_DIRECTORY_ENTRY_SIZE, 'ABIF header');
  if (readTagName(view, 0) !== 'ABIF') fail('signature is not ABIF.');
  if (view.byteLength > ABI_IMPORT_LIMITS.maxFileBytes) {
    fail(`file exceeds the ${ABI_IMPORT_LIMITS.maxFileBytes.toLocaleString()}-byte safety limit.`);
  }

  const version = view.getUint16(4, false);
  if (version === 0) fail('format version is missing.');
  const root = readDirectoryEntry(view, ABIF_ROOT_OFFSET);
  if (root.tagName !== 'tdir' || root.tagNumber !== 1) {
    fail('root directory entry is missing or malformed.');
  }
  if (root.elementType !== ABI_TYPE_DIRECTORY) {
    fail(`root directory has element type ${root.elementType}; expected ${ABI_TYPE_DIRECTORY}.`);
  }
  if (root.elementSize !== ABIF_DIRECTORY_ENTRY_SIZE) {
    fail(`root directory entry size is ${root.elementSize}; expected ${ABIF_DIRECTORY_ENTRY_SIZE}.`);
  }
  if (root.elementCount === 0) fail('root directory is empty.');
  if (root.elementCount > ABI_IMPORT_LIMITS.maxDirectoryEntries) {
    fail(`directory contains ${root.elementCount.toLocaleString()} entries; limit is ${ABI_IMPORT_LIMITS.maxDirectoryEntries.toLocaleString()}.`);
  }
  const expectedDirectoryBytes = checkedProduct(
    root.elementCount,
    root.elementSize,
    'ABIF root directory',
  );
  // Instrument writers commonly include small payloads stored after the last
  // directory entry in the root dataSize. The directory itself must fit, but
  // an exact equality check rejects valid 3100/3730 files.
  if (root.dataSize < expectedDirectoryBytes) {
    fail(`root directory declares ${root.dataSize.toLocaleString()} bytes; at least ${expectedDirectoryBytes.toLocaleString()} are required.`);
  }
  // A non-empty ABIF directory is always larger than the four-byte inline
  // field, so root.dataOffset is an actual absolute file offset.
  assertRange(view, root.dataOffset, root.dataSize, 'ABIF root directory');

  const entries = new Map<string, AbiDirectoryEntry>();
  for (let index = 0; index < root.elementCount; index += 1) {
    const offset = root.dataOffset + (index * root.elementSize);
    const entry = readDirectoryEntry(view, offset);
    const key = entryKey(entry);
    if (entries.has(key)) fail(`directory contains duplicate ${key} entries.`);
    entries.set(key, entry);
  }
  return { version, entries };
}

function payloadOffset(view: DataView, entry: AbiDirectoryEntry, label: string): number {
  const offset = entry.dataSize <= 4
    ? entry.entryOffset + DATA_FIELD_OFFSET
    : entry.dataOffset;
  assertRange(view, offset, entry.dataSize, label);
  return offset;
}

function validateDescriptor(
  entry: AbiDirectoryEntry,
  label: string,
  expectedTypes: readonly number[],
  expectedElementSize: number,
  maxElements: number,
): void {
  if (!expectedTypes.includes(entry.elementType)) {
    fail(`${label} has element type ${entry.elementType}; expected ${expectedTypes.join(' or ')}.`);
  }
  if (entry.elementSize !== expectedElementSize) {
    fail(`${label} has element size ${entry.elementSize}; expected ${expectedElementSize}.`);
  }
  if (entry.elementCount > maxElements) {
    fail(`${label} contains ${entry.elementCount.toLocaleString()} elements; limit is ${maxElements.toLocaleString()}.`);
  }
  const expectedDataSize = checkedProduct(entry.elementCount, entry.elementSize, label);
  if (entry.dataSize !== expectedDataSize) {
    fail(`${label} declares ${entry.elementCount.toLocaleString()} elements × ${entry.elementSize} bytes but dataSize is ${entry.dataSize.toLocaleString()}.`);
  }
}

function readBytes(
  view: DataView,
  entry: AbiDirectoryEntry,
  label: string,
  expectedTypes: readonly number[],
  maxElements: number,
): number[] {
  validateDescriptor(entry, label, expectedTypes, 1, maxElements);
  const offset = payloadOffset(view, entry, label);
  const values = new Array<number>(entry.elementCount);
  for (let index = 0; index < entry.elementCount; index += 1) {
    values[index] = view.getUint8(offset + index);
  }
  return values;
}

function bytesToAscii(bytes: readonly number[]): string {
  let output = '';
  const chunkSize = 8_192;
  for (let start = 0; start < bytes.length; start += chunkSize) {
    const chunk = bytes.slice(start, start + chunkSize);
    output += String.fromCharCode(...chunk);
  }
  return output;
}

function readChars(
  view: DataView,
  entry: AbiDirectoryEntry,
  label: string,
  maxElements: number,
): string {
  return bytesToAscii(readBytes(view, entry, label, [ABI_TYPE_CHAR], maxElements));
}

function readShorts(
  view: DataView,
  entry: AbiDirectoryEntry,
  label: string,
  maxElements: number,
): number[] {
  validateDescriptor(entry, label, [ABI_TYPE_SHORT], 2, maxElements);
  const offset = payloadOffset(view, entry, label);
  const values = new Array<number>(entry.elementCount);
  for (let index = 0; index < entry.elementCount; index += 1) {
    // ABIF type 4 is a signed 16-bit short. Baseline-subtracted trace values
    // can be negative, so Uint16 would turn a small negative signal into a
    // visually enormous positive spike.
    values[index] = view.getInt16(offset + (index * 2), false);
  }
  return values;
}

function readPeakPositions(
  view: DataView,
  entry: AbiDirectoryEntry,
  label: string,
  maxElements: number,
): number[] {
  if (entry.elementType === ABI_TYPE_SHORT) {
    return readShorts(view, entry, label, maxElements);
  }
  if (entry.elementType !== ABI_TYPE_LONG) {
    fail(`${label} has element type ${entry.elementType}; expected ${ABI_TYPE_SHORT} or ${ABI_TYPE_LONG}.`);
  }
  validateDescriptor(entry, label, [ABI_TYPE_LONG], 4, maxElements);
  const offset = payloadOffset(view, entry, label);
  const values = new Array<number>(entry.elementCount);
  for (let index = 0; index < entry.elementCount; index += 1) {
    values[index] = view.getInt32(offset + (index * 4), false);
  }
  return values;
}

function sanitizeOptionalText(value: string): string | undefined {
  const printable = Array.from(value, (char) => {
    const code = char.charCodeAt(0);
    return code < 32 || code === 127 ? ' ' : char;
  }).join('');
  const clean = printable
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, ABI_IMPORT_LIMITS.maxOptionalMetadataText);
  return clean || undefined;
}

function readOptionalString(
  view: DataView,
  entries: Map<string, AbiDirectoryEntry>,
  key: string,
  warnings: string[],
): string | undefined {
  const entry = entries.get(key);
  if (!entry) return undefined;
  try {
    validateDescriptor(
      entry,
      key,
      [ABI_TYPE_CHAR, ABI_TYPE_PSTRING, ABI_TYPE_CSTRING],
      1,
      ABI_IMPORT_LIMITS.maxOptionalMetadataBytes,
    );
    const raw = readBytes(
      view,
      entry,
      key,
      [ABI_TYPE_CHAR, ABI_TYPE_PSTRING, ABI_TYPE_CSTRING],
      ABI_IMPORT_LIMITS.maxOptionalMetadataBytes,
    );
    if (entry.elementType === ABI_TYPE_PSTRING) {
      if (raw.length === 0) return undefined;
      const declaredLength = raw[0];
      if (declaredLength > raw.length - 1) {
        warnings.push(`${key} Pascal-string length exceeds its payload; source metadata was ignored.`);
        return undefined;
      }
      return sanitizeOptionalText(bytesToAscii(raw.slice(1, 1 + declaredLength)));
    }
    const content = entry.elementType === ABI_TYPE_CSTRING && raw.at(-1) === 0
      ? raw.slice(0, -1)
      : raw;
    return sanitizeOptionalText(bytesToAscii(content));
  } catch (error) {
    warnings.push(`${key} source metadata was ignored: ${error instanceof Error ? error.message : String(error)}`);
    return undefined;
  }
}

function firstEntry(
  entries: Map<string, AbiDirectoryEntry>,
  preferredKey: string,
  fallbackKey: string,
  warnings: string[],
): { entry: AbiDirectoryEntry; key: string } | null {
  const preferred = entries.get(preferredKey);
  if (preferred) return { entry: preferred, key: preferredKey };
  const fallback = entries.get(fallbackKey);
  if (!fallback) return null;
  warnings.push(`${preferredKey} was absent; used ${fallbackKey} edited-call fallback.`);
  return { entry: fallback, key: fallbackKey };
}

function emptyChannels(): SangerTraceChannels {
  return { A: [], C: [], G: [], T: [] };
}

function isValidDyeOrder(value: string): boolean {
  return /^[ACGT]{4}$/.test(value) && new Set(value).size === 4;
}

function parseStoredReverseComplement(
  view: DataView,
  entries: Map<string, AbiDirectoryEntry>,
): boolean | null {
  const entry = entries.get('RevC1');
  if (!entry) return null;
  const values = readShorts(view, entry, 'RevC1', 1);
  if (values.length !== 1) fail('RevC1 must contain exactly one short value.');
  return values[0] !== 0;
}

export function parseAbiImport(
  input: ArrayBuffer | Uint8Array,
  fallbackName = 'Imported chromatogram',
): AbiImportRecord {
  const view = toDataView(input);
  const { version, entries } = readDirectory(view);
  const warnings: string[] = [];

  // PBAS2 / PCON2 / PLOC2 are the original basecaller values and preserve the
  // parser's historic behavior. Edited tag #1 values are deliberate fallbacks
  // only for files that omit the corresponding #2 tag.
  const baseCallsSource = firstEntry(entries, 'PBAS2', 'PBAS1', warnings);
  if (!baseCallsSource) fail('file did not contain PBAS2 or PBAS1 base calls.');
  const sequence = readChars(
    view,
    baseCallsSource.entry,
    baseCallsSource.key,
    ABI_IMPORT_LIMITS.maxBaseCalls,
  ).replace(/\0+$/, '');
  if (!sequence) fail('base-call payload is empty.');
  if (!/^[ACGTRYSWKMBDHVNacgtryswkmbdhvn]+$/.test(sequence)) {
    fail(`${baseCallsSource.key} contains non-IUPAC base-call characters.`);
  }

  const qualitySource = firstEntry(entries, 'PCON2', 'PCON1', warnings);
  const qualityScores = qualitySource
    ? readBytes(
        view,
        qualitySource.entry,
        qualitySource.key,
        [ABI_TYPE_BYTE, ABI_TYPE_CHAR],
        ABI_IMPORT_LIMITS.maxBaseCalls,
      )
    : [];
  if (!qualitySource) warnings.push('PCON2/PCON1 quality scores were absent.');
  if (qualityScores.length > 0 && qualityScores.length !== sequence.length) {
    warnings.push(`Quality-score count (${qualityScores.length}) does not match base-call count (${sequence.length}).`);
  }

  const peakSource = firstEntry(entries, 'PLOC2', 'PLOC1', warnings);
  const peakPositions = peakSource
    ? readPeakPositions(
        view,
        peakSource.entry,
        peakSource.key,
        ABI_IMPORT_LIMITS.maxBaseCalls,
      )
    : [];
  if (!peakSource) warnings.push('PLOC2/PLOC1 peak positions were absent.');
  if (peakPositions.some((position) => position < 0)) fail(`${peakSource?.key ?? 'PLOC'} contains a negative peak position.`);
  if (peakPositions.length > 0 && peakPositions.length !== sequence.length) {
    warnings.push(`Peak-position count (${peakPositions.length}) does not match base-call count (${sequence.length}).`);
  }

  let dyeOrder: string | null = null;
  const dyeOrderEntry = entries.get('FWO_1');
  if (dyeOrderEntry) {
    const candidate = readChars(view, dyeOrderEntry, 'FWO_1', 4).replace(/\0/g, '').toUpperCase();
    if (isValidDyeOrder(candidate)) dyeOrder = candidate;
    else warnings.push(`FWO_1 dye order “${candidate || '(empty)'}” is invalid; trace channels were left unmapped.`);
  } else {
    warnings.push('FWO_1 dye order was absent; trace channels were left unmapped.');
  }

  const rawTraceChannels: number[][] = [];
  let totalTraceSamples = 0;
  for (let channelIndex = 0; channelIndex < 4; channelIndex += 1) {
    const tagNumber = 9 + channelIndex;
    const key = `DATA${tagNumber}`;
    const entry = entries.get(key);
    if (!entry) {
      rawTraceChannels.push([]);
      warnings.push(`${key} analyzed trace channel was absent.`);
      continue;
    }
    const values = readShorts(
      view,
      entry,
      key,
      ABI_IMPORT_LIMITS.maxTraceSamplesPerChannel,
    );
    totalTraceSamples += values.length;
    if (totalTraceSamples > ABI_IMPORT_LIMITS.maxTotalTraceSamples) {
      fail(`analyzed trace channels exceed the ${ABI_IMPORT_LIMITS.maxTotalTraceSamples.toLocaleString()}-sample aggregate limit.`);
    }
    rawTraceChannels.push(values);
  }

  const channels = emptyChannels();
  const channelTags: SangerTraceSourceMetadata['channelTags'] = {};
  if (dyeOrder) {
    for (let index = 0; index < 4; index += 1) {
      const base = dyeOrder[index] as SangerBase;
      channels[base] = rawTraceChannels[index];
      if (rawTraceChannels[index].length > 0) {
        channelTags[base] = `DATA${9 + index}` as 'DATA9' | 'DATA10' | 'DATA11' | 'DATA12';
      }
    }
  }

  const channelLengths = rawTraceChannels.map((channel) => channel.length);
  const populatedChannelLengths = channelLengths.filter((length) => length > 0);
  const rawSampleCount = populatedChannelLengths.length > 0 ? Math.max(...populatedChannelLengths) : 0;
  const sampleCount = Math.max(0, channels.A.length, channels.C.length, channels.G.length, channels.T.length);
  if (new Set(populatedChannelLengths).size > 1) {
    warnings.push(`Analyzed trace channel lengths differ (${channelLengths.join(', ')} samples).`);
  }
  if (peakPositions.some((position) => rawSampleCount > 0 && position >= rawSampleCount)) {
    warnings.push('One or more peak positions fall outside the decoded trace sample range.');
  }

  const storedReverseComplement = parseStoredReverseComplement(view, entries);
  const sampleName = readOptionalString(view, entries, 'SMPL1', warnings);
  const sampleWell = readOptionalString(view, entries, 'TUBE1', warnings);
  const instrumentModel = readOptionalString(view, entries, 'MODL1', warnings);
  const dyeSetName = readOptionalString(view, entries, 'DySN1', warnings);
  const dataCollectionSoftwareVersion = readOptionalString(view, entries, 'SVER1', warnings);
  const basecallerVersion = readOptionalString(view, entries, 'SVER2', warnings);

  const sourceMetadata: SangerTraceSourceMetadata = {
    format: 'ABIF',
    abifVersion: version,
    baseCallsTag: baseCallsSource.key as 'PBAS2' | 'PBAS1',
    qualityScoresTag: qualitySource ? qualitySource.key as 'PCON2' | 'PCON1' : null,
    peakPositionsTag: peakSource ? peakSource.key as 'PLOC2' | 'PLOC1' : null,
    channelTags,
    ...(sampleName ? { sampleName } : {}),
    ...(sampleWell ? { sampleWell } : {}),
    ...(instrumentModel ? { instrumentModel } : {}),
    ...(dyeSetName ? { dyeSetName } : {}),
    ...(dataCollectionSoftwareVersion ? { dataCollectionSoftwareVersion } : {}),
    ...(basecallerVersion ? { basecallerVersion } : {}),
  };

  const sangerTrace: SangerTraceData = {
    schema: SANGER_TRACE_SCHEMA,
    version: 1,
    baseCalls: sequence,
    sequence,
    qualityScores: [...qualityScores],
    peakPositions: [...peakPositions],
    channels,
    sampleCount,
    dyeOrder,
    storedReverseComplement,
    warnings: [...warnings],
    metadata: sourceMetadata,
  };

  return {
    name: fallbackName,
    sequence,
    qualityScores,
    warnings: [...warnings],
    sangerTrace,
    metadata: {
      peakPositions,
      // Historic compatibility field: DATA10 length was previously returned
      // even when FWO_1 was absent. Keep the decoded raw sample length here;
      // the versioned trace's sampleCount instead follows its mapped channels.
      traceLength: rawSampleCount,
    },
  };
}
