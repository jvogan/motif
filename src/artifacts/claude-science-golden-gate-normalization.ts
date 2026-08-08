import { getGoldenGateEnzyme } from '../bio/golden-gate';
import { reverseComplement } from '../bio/reverse-complement';

/**
 * Legacy artifact records sometimes use a single N as a cut-site spacer in
 * an otherwise fully specified Type IIS flank. The bio engine deliberately
 * rejects ambiguous bases; this adapter-only materialization keeps those
 * records readable without weakening the engine's strict contract.
 */
export type GoldenGateSpacerMaterialization = {
  sequence: string;
  /** Source offsets whose synthetic spacer was deterministically materialized. */
  positions: number[];
};

export function materializeGoldenGateFlankSpacers(
  sequence: string,
  enzymeName: string,
): GoldenGateSpacerMaterialization {
  const normalized = sequence.replace(/\s+/g, '').toUpperCase();
  const enzyme = getGoldenGateEnzyme(enzymeName);
  if (!enzyme || normalized.length === 0) return { sequence: normalized, positions: [] };

  const recognition = enzyme.recognitionSequence.toUpperCase();
  const reverseRecognition = reverseComplement(recognition).toUpperCase();
  const senseStart = normalized.indexOf(recognition);
  const antisenseStart = senseStart === -1
    ? -1
    : normalized.indexOf(reverseRecognition, senseStart + recognition.length);
  if (senseStart === -1 || antisenseStart === -1 || senseStart >= antisenseStart) {
    return { sequence: normalized, positions: [] };
  }

  const overhangLength = enzyme.complementCutOffset - enzyme.cutOffset;
  const chars = normalized.split('');
  const positions = new Set<number>();
  const materialize = (start: number, end: number): void => {
    for (let position = Math.max(0, start); position < Math.min(chars.length, end); position += 1) {
      if (chars[position] !== 'N') continue;
      chars[position] = 'A';
      positions.add(position);
    }
  };

  // Synthetic records place an unspecified spacer between the recognition
  // sequence and the inward-facing overhang on each side. Never rewrite the
  // released insert or an arbitrary ambiguous base elsewhere in the record.
  materialize(
    senseStart + recognition.length,
    Math.min(senseStart + enzyme.cutOffset, antisenseStart),
  );
  const rightCutStart = antisenseStart + recognition.length - enzyme.complementCutOffset;
  materialize(rightCutStart + overhangLength, antisenseStart);

  return { sequence: chars.join(''), positions: [...positions].sort((left, right) => left - right) };
}
