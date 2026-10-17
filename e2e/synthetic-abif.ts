/**
 * Deterministic ABIF (.ab1) builders for browser specs.
 *
 * The bytes hold only what the importer reads: the signature, version, root
 * `tdir` entry and 28-byte directory entries. Payloads of four bytes or fewer
 * are stored inline in the entry's data field; larger payloads follow the
 * directory.
 */

export const ABIF_ELEMENT_TYPE = {
  byte: 1,
  char: 2,
  short: 4,
  long: 5,
  pString: 18,
  cString: 19,
} as const;

const ABIF_VERSION = 101;
const ABIF_ROOT_OFFSET = 6;
const ABIF_DIRECTORY_OFFSET = 34;
const ABIF_DIRECTORY_ENTRY_SIZE = 28;
const ABIF_DIRECTORY_TYPE = 1023;

export interface AbifTag {
  name: string;
  number: number;
  type: number;
  size: number;
  count: number;
  data: Uint8Array;
}

export function encodeAscii(value: string): Uint8Array {
  return Uint8Array.from(value, (character) => character.charCodeAt(0));
}

export function encodeShorts(values: readonly number[]): Uint8Array {
  const bytes = new Uint8Array(values.length * 2);
  const view = new DataView(bytes.buffer);
  values.forEach((value, index) => view.setInt16(index * 2, value, false));
  return bytes;
}

function writeTagName(view: DataView, offset: number, tag: string): void {
  if (tag.length !== 4) throw new Error(`ABIF tag names are four characters; received "${tag}".`);
  for (let index = 0; index < 4; index += 1) view.setUint8(offset + index, tag.charCodeAt(index));
}

export const charTag = (name: string, number: number, value: string): AbifTag => ({
  name, number, type: ABIF_ELEMENT_TYPE.char, size: 1, count: value.length, data: encodeAscii(value),
});

/** Char-typed tag holding raw byte values, as instruments store PCON quality scores. */
export const charCodesTag = (name: string, number: number, values: readonly number[]): AbifTag => ({
  name, number, type: ABIF_ELEMENT_TYPE.char, size: 1, count: values.length, data: Uint8Array.from(values),
});

export const shortTag = (name: string, number: number, values: readonly number[]): AbifTag => ({
  name, number, type: ABIF_ELEMENT_TYPE.short, size: 2, count: values.length, data: encodeShorts(values),
});

/** Serializes a minimal ABIF file whose directory holds exactly the supplied tags. */
export function encodeAbif(tags: readonly AbifTag[]): Uint8Array {
  const directorySize = tags.length * ABIF_DIRECTORY_ENTRY_SIZE;
  const externalSize = tags.reduce((sum, tag) => sum + (tag.data.length > 4 ? tag.data.length : 0), 0);
  const buffer = new ArrayBuffer(ABIF_DIRECTORY_OFFSET + directorySize + externalSize);
  const view = new DataView(buffer);

  writeTagName(view, 0, 'ABIF');
  view.setUint16(4, ABIF_VERSION, false);
  writeTagName(view, ABIF_ROOT_OFFSET, 'tdir');
  view.setUint32(ABIF_ROOT_OFFSET + 4, 1, false);
  view.setUint16(ABIF_ROOT_OFFSET + 8, ABIF_DIRECTORY_TYPE, false);
  view.setUint16(ABIF_ROOT_OFFSET + 10, ABIF_DIRECTORY_ENTRY_SIZE, false);
  view.setUint32(ABIF_ROOT_OFFSET + 12, tags.length, false);
  view.setUint32(ABIF_ROOT_OFFSET + 16, buffer.byteLength - ABIF_DIRECTORY_OFFSET, false);
  view.setUint32(ABIF_ROOT_OFFSET + 20, ABIF_DIRECTORY_OFFSET, false);

  let externalOffset = ABIF_DIRECTORY_OFFSET + directorySize;
  tags.forEach((tag, index) => {
    const offset = ABIF_DIRECTORY_OFFSET + (index * ABIF_DIRECTORY_ENTRY_SIZE);
    writeTagName(view, offset, tag.name);
    view.setUint32(offset + 4, tag.number, false);
    view.setUint16(offset + 8, tag.type, false);
    view.setUint16(offset + 10, tag.size, false);
    view.setUint32(offset + 12, tag.count, false);
    view.setUint32(offset + 16, tag.data.length, false);
    if (tag.data.length <= 4) {
      tag.data.forEach((value, dataIndex) => view.setUint8(offset + 20 + dataIndex, value));
      return;
    }
    view.setUint32(offset + 20, externalOffset, false);
    tag.data.forEach((value, dataIndex) => view.setUint8(externalOffset + dataIndex, value));
    externalOffset += tag.data.length;
  });

  return new Uint8Array(buffer);
}

/** Small seeded PRNG so every run produces byte-identical traces. */
export function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4_294_967_296;
  };
}

const COMPLEMENT: Record<string, string> = { A: 'T', C: 'G', G: 'C', T: 'A' };

export function reverseComplement(sequence: string): string {
  return Array.from(sequence).reverse().map((base) => COMPLEMENT[base] ?? 'N').join('');
}

export interface SyntheticSangerReadOptions {
  baseCalls: string;
  seed: number;
  sampleName?: string;
  well?: string;
  /** FWO_1 order for DATA9..DATA12. */
  dyeOrder?: string;
  samplesPerBase?: number;
}

/**
 * Builds a complete, warning-free ABIF read: PBAS2, PCON2, PLOC2, FWO_1 and
 * four analyzed DATA channels with one Gaussian peak per call in that base's
 * channel above a low noise floor.
 */
export function buildSyntheticSangerRead(options: SyntheticSangerReadOptions): Uint8Array {
  const { baseCalls, seed, sampleName, well } = options;
  const dyeOrder = options.dyeOrder ?? 'GATC';
  const samplesPerBase = options.samplesPerBase ?? 12;
  if (!/^[ACGT]+$/.test(baseCalls)) throw new Error('Synthetic reads use unambiguous A/C/G/T calls.');
  const random = seededRandom(seed);
  const leader = samplesPerBase;
  const sampleCount = leader * 2 + baseCalls.length * samplesPerBase;
  const channels = Array.from(dyeOrder, () => Array.from({ length: sampleCount }, () => Math.floor(random() * 24)));
  const peakPositions: number[] = [];
  const qualityScores: number[] = [];
  const sigma = samplesPerBase / 5;
  Array.from(baseCalls).forEach((base, index) => {
    const center = leader + (index * samplesPerBase) + Math.floor(samplesPerBase / 2);
    const amplitude = 700 + Math.floor(random() * 600);
    const channel = channels[dyeOrder.indexOf(base)];
    for (let offset = -samplesPerBase; offset <= samplesPerBase; offset += 1) {
      const position = center + offset;
      if (position < 0 || position >= sampleCount) continue;
      channel[position] = Math.min(32_767, channel[position] + Math.round(amplitude * Math.exp(-(offset * offset) / (2 * sigma * sigma))));
    }
    peakPositions.push(center);
    qualityScores.push(20 + Math.floor(random() * 41));
  });

  const tags: AbifTag[] = [
    charTag('PBAS', 2, baseCalls),
    charCodesTag('PCON', 2, qualityScores),
    shortTag('PLOC', 2, peakPositions),
    charTag('FWO_', 1, dyeOrder),
    ...channels.map((values, index) => shortTag('DATA', 9 + index, values)),
  ];
  if (sampleName) tags.push(charTag('SMPL', 1, sampleName));
  if (well) tags.push(charTag('TUBE', 1, well));
  return encodeAbif(tags);
}

export interface SyntheticSangerPlateRead {
  fileName: string;
  sampleName: string;
  well: string;
  orientation: 'forward' | 'reverse';
  baseCalls: string;
  bytes: Uint8Array;
}

/**
 * Builds a deterministic plate of reads tiled across one random template.
 * Odd wells hold forward reads; even wells hold reverse-primer reads, which
 * are stored as the reverse complement of their template window and carry
 * `_R_` in the file name.
 */
export function buildSyntheticSangerPlate(readCount: number, seed = 0x5a17): SyntheticSangerPlateRead[] {
  const random = seededRandom(seed);
  const readLength = 96;
  const step = 17;
  const template = Array.from({ length: readLength + (readCount * step) }, () => 'ACGT'[Math.floor(random() * 4)]).join('');
  return Array.from({ length: readCount }, (_, index) => {
    const well = `${'ABCDEFGH'[Math.floor(index / 12)]}${String((index % 12) + 1).padStart(2, '0')}`;
    const orientation = index % 2 === 0 ? 'forward' : 'reverse';
    const window = template.slice(index * step, (index * step) + readLength);
    const baseCalls = orientation === 'forward' ? window : reverseComplement(window);
    const sampleName = `SYN_${well}_${orientation === 'forward' ? 'F_M13F' : 'R_M13R'}`;
    return {
      fileName: `${sampleName}.ab1`,
      sampleName,
      well,
      orientation,
      baseCalls,
      bytes: buildSyntheticSangerRead({ baseCalls, seed: seed + index + 1, sampleName, well }),
    };
  });
}
