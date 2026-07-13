function encodeAscii(value: string): Uint8Array {
  return Uint8Array.from(value, (character) => character.charCodeAt(0));
}

function encodeShorts(values: number[]): Uint8Array {
  const bytes = new Uint8Array(values.length * 2);
  const view = new DataView(bytes.buffer);
  values.forEach((value, index) => view.setInt16(index * 2, value, false));
  return bytes;
}

function writeTagName(view: DataView, offset: number, tag: string): void {
  for (let index = 0; index < 4; index += 1) view.setUint8(offset + index, tag.charCodeAt(index));
}

/** Minimal deterministic ABIF input used by the standalone browser campaign. */
export function buildAbiFixture(): Uint8Array {
  const tags = [
    { name: 'PBAS', number: 2, type: 2, size: 1, count: 4, data: encodeAscii('ATGC') },
    { name: 'PCON', number: 2, type: 2, size: 1, count: 4, data: Uint8Array.of(40, 39, 38, 37) },
    { name: 'PLOC', number: 2, type: 4, size: 2, count: 4, data: encodeShorts([0, 1, 2, 3]) },
    { name: 'FWO_', number: 1, type: 2, size: 1, count: 4, data: encodeAscii('GATC') },
    { name: 'DATA', number: 9, type: 4, size: 2, count: 4, data: encodeShorts([90, 91, 92, 93]) },
    { name: 'DATA', number: 10, type: 4, size: 2, count: 4, data: encodeShorts([10, 11, 12, 13]) },
    { name: 'DATA', number: 11, type: 4, size: 2, count: 4, data: encodeShorts([20, 21, 22, 23]) },
    { name: 'DATA', number: 12, type: 4, size: 2, count: 4, data: encodeShorts([30, 31, 32, 33]) },
  ];
  const rootOffset = 6;
  const directoryOffset = 34;
  const entrySize = 28;
  const directorySize = tags.length * entrySize;
  const externalSize = tags.reduce((sum, tag) => sum + (tag.data.length > 4 ? tag.data.length : 0), 0);
  const buffer = new ArrayBuffer(directoryOffset + directorySize + externalSize);
  const view = new DataView(buffer);

  writeTagName(view, 0, 'ABIF');
  view.setUint16(4, 101, false);
  writeTagName(view, rootOffset, 'tdir');
  view.setUint32(rootOffset + 4, 1, false);
  view.setUint16(rootOffset + 8, 1023, false);
  view.setUint16(rootOffset + 10, entrySize, false);
  view.setUint32(rootOffset + 12, tags.length, false);
  view.setUint32(rootOffset + 16, buffer.byteLength - directoryOffset, false);
  view.setUint32(rootOffset + 20, directoryOffset, false);

  let externalOffset = directoryOffset + directorySize;
  tags.forEach((tag, index) => {
    const offset = directoryOffset + (index * entrySize);
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
