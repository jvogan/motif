import type { SequenceType } from '../bio/types';
import { classifyResidueDifference } from './claude-science-msa';

export type AlignmentCoverage = { first: number; last: number } | null;

export type MsaCellOutcome = 'match' | 'substitution' | 'deletion' | 'insertion' | 'uncovered' | 'gap' | 'ambiguous';

export function alignmentCoverage(aligned: string): AlignmentCoverage {
  const first = aligned.search(/[^-.]/);
  if (first < 0) return null;
  for (let last = aligned.length - 1; last >= first; last -= 1) {
    if (aligned[last] !== '-' && aligned[last] !== '.') return { first, last };
  }
  return null;
}

export function coversColumn(coverage: AlignmentCoverage, column: number): boolean {
  return Boolean(coverage && column >= coverage.first && column <= coverage.last);
}

export function classifyMsaCell(
  referenceResidue: string,
  rowResidue: string,
  isColumnCoveredByRow: boolean,
  molecule: SequenceType = 'dna',
  strictDifferences = false,
): MsaCellOutcome {
  if ((referenceResidue === '-' || referenceResidue === '.') && (rowResidue === '-' || rowResidue === '.')) return 'gap';
  if ((rowResidue === '-' || rowResidue === '.') && !isColumnCoveredByRow) return 'uncovered';
  if (referenceResidue === '-' || referenceResidue === '.') return 'insertion';
  if (rowResidue === '-' || rowResidue === '.') return 'deletion';
  if (strictDifferences) return referenceResidue === rowResidue ? 'match' : 'substitution';
  return classifyResidueDifference(referenceResidue, rowResidue, molecule);
}

export function isMsaCellDifference(
  outcome: MsaCellOutcome,
): outcome is Extract<MsaCellOutcome, 'substitution' | 'deletion' | 'insertion'> {
  return outcome === 'substitution' || outcome === 'deletion' || outcome === 'insertion';
}
