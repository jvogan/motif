import { charCodesTag, charTag, encodeAbif, shortTag } from './synthetic-abif';

/** Minimal deterministic ABIF input used by the standalone browser fixture. */
export function buildAbiFixture(): Uint8Array {
  return encodeAbif([
    charTag('PBAS', 2, 'ATGC'),
    charCodesTag('PCON', 2, [40, 39, 38, 37]),
    shortTag('PLOC', 2, [0, 1, 2, 3]),
    charTag('FWO_', 1, 'GATC'),
    shortTag('DATA', 9, [90, 91, 92, 93]),
    shortTag('DATA', 10, [10, 11, 12, 13]),
    shortTag('DATA', 11, [20, 21, 22, 23]),
    shortTag('DATA', 12, [30, 31, 32, 33]),
  ]);
}
