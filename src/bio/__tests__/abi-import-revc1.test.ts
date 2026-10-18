import { describe, expect, it } from 'vitest';
import { parseAbiImport } from '../abi-import';

const ABI_TYPE_CHAR = 2;
const ABI_TYPE_SHORT = 4;
const ABIF_ROOT_OFFSET = 6;
const ABIF_DIRECTORY_ENTRY_SIZE = 28;
const DIRECTORY_DATA_OFFSET = ABIF_ROOT_OFFSET + ABIF_DIRECTORY_ENTRY_SIZE;

interface SyntheticTag {
  name: string;
  number: number;
  elementType: number;
  elementSize: number;
  count: number;
  payload: number[];
}

function writeTag(view: DataView, offset: number, tag: SyntheticTag, dataOffset: number, dataSize: number): void {
  for (let index = 0; index < 4; index += 1) {
    view.setUint8(offset + index, tag.name.charCodeAt(index));
  }
  view.setUint32(offset + 4, tag.number, false);
  view.setUint16(offset + 8, tag.elementType, false);
  view.setUint16(offset + 10, tag.elementSize, false);
  view.setUint32(offset + 12, tag.count, false);
  view.setUint32(offset + 16, dataSize, false);
  view.setUint32(offset + 20, dataOffset, false);
}

/** Builds a minimal ABIF file whose directory holds exactly the supplied tags. */
function buildAbif(tags: readonly SyntheticTag[]): ArrayBuffer {
  const directoryBytes = tags.length * ABIF_DIRECTORY_ENTRY_SIZE;
  const payloadBytes = tags
    .filter((tag) => tag.payload.length > 4)
    .reduce((sum, tag) => sum + tag.payload.length, 0);
  const buffer = new ArrayBuffer(DIRECTORY_DATA_OFFSET + directoryBytes + payloadBytes);
  const view = new DataView(buffer);
  for (let index = 0; index < 4; index += 1) view.setUint8(index, 'ABIF'.charCodeAt(index));
  view.setUint16(4, 101, false);
  writeTag(view, ABIF_ROOT_OFFSET, {
    name: 'tdir',
    number: 1,
    elementType: 1023,
    elementSize: ABIF_DIRECTORY_ENTRY_SIZE,
    count: tags.length,
    payload: [],
  }, DIRECTORY_DATA_OFFSET, directoryBytes);

  let payloadCursor = DIRECTORY_DATA_OFFSET + directoryBytes;
  tags.forEach((tag, index) => {
    const entryOffset = DIRECTORY_DATA_OFFSET + index * ABIF_DIRECTORY_ENTRY_SIZE;
    if (tag.payload.length <= 4) {
      writeTag(view, entryOffset, tag, 0, tag.payload.length);
      tag.payload.forEach((byte, byteIndex) => view.setUint8(entryOffset + 20 + byteIndex, byte));
      return;
    }
    writeTag(view, entryOffset, tag, payloadCursor, tag.payload.length);
    tag.payload.forEach((byte, byteIndex) => view.setUint8(payloadCursor + byteIndex, byte));
    payloadCursor += tag.payload.length;
  });
  return buffer;
}

const ascii = (value: string): number[] => Array.from(value, (char) => char.charCodeAt(0));
const shortBytes = (value: number): number[] => [(value >> 8) & 0xff, value & 0xff];

const BASE_TAGS: readonly SyntheticTag[] = [
  { name: 'PBAS', number: 2, elementType: ABI_TYPE_CHAR, elementSize: 1, count: 4, payload: ascii('ACGT') },
];

describe('ABIF optional RevC1 handling', () => {
  it('imports a valid RevC1 short value as the stored reverse-complement flag', () => {
    const record = parseAbiImport(buildAbif([
      ...BASE_TAGS,
      { name: 'RevC', number: 1, elementType: ABI_TYPE_SHORT, elementSize: 2, count: 1, payload: shortBytes(1) },
    ]));
    expect(record.sequence).toBe('ACGT');
    expect(record.sangerTrace.storedReverseComplement).toBe(true);
    expect(record.warnings.join(' ')).not.toMatch(/RevC1/);
  });

  it('keeps the trace importable when RevC1 has the wrong element type', () => {
    const record = parseAbiImport(buildAbif([
      ...BASE_TAGS,
      { name: 'RevC', number: 1, elementType: ABI_TYPE_CHAR, elementSize: 1, count: 1, payload: ascii('x') },
    ]));
    expect(record.sequence).toBe('ACGT');
    expect(record.sangerTrace.storedReverseComplement).toBeNull();
    expect(record.warnings).toContainEqual(expect.stringMatching(/^RevC1 source metadata was ignored: /));
    expect(record.sangerTrace.warnings).toEqual(record.warnings);
  });
});
