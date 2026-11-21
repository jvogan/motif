import { expect, it } from 'vitest';
import { ABI_IMPORT_LIMITS, AbiImportError, parseAbiImport } from '../abi-import';

function makeBaseCallFile(calls: string): Uint8Array {
  const directoryOffset = 34;
  const payloadOffset = 62;
  const bytes = new Uint8Array(payloadOffset + calls.length);
  const view = new DataView(bytes.buffer);
  const encoder = new TextEncoder();
  function entry(offset: number, tag: string, number: number, type: number, size: number, count: number, dataOffset: number) {
    bytes.set(encoder.encode(tag), offset);
    view.setUint32(offset + 4, number);
    view.setUint16(offset + 8, type);
    view.setUint16(offset + 10, size);
    view.setUint32(offset + 12, count);
    view.setUint32(offset + 16, count * size);
    view.setUint32(offset + 20, dataOffset);
  }
  bytes.set(encoder.encode('ABIF'));
  view.setUint16(4, 101);
  entry(6, 'tdir', 1, 1023, 28, 1, directoryOffset);
  entry(directoryOffset, 'PBAS', 2, 2, 1, calls.length, payloadOffset);
  bytes.set(encoder.encode(calls), payloadOffset);
  return bytes;
}

it('trims only trailing ABIF base-call padding', () => {
  const calls = 'A'.repeat(12);
  const padding = '\0'.repeat(ABI_IMPORT_LIMITS.maxBaseCalls - calls.length - 1);
  expect(parseAbiImport(makeBaseCallFile(calls + padding)).sequence).toBe(calls);
  expect(() => parseAbiImport(makeBaseCallFile(calls + padding + 'A'))).toThrowError(AbiImportError);
});
