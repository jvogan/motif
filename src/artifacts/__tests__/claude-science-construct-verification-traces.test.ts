import { describe, expect, it } from 'vitest';
import { reverseComplement } from '../../bio/reverse-complement';
import { constructVariantDisplayPosition } from '../claude-science-construct-verification-display';
import {
  constructVariantTraceReadIds,
  constructVerificationTraceTarget,
  type ConstructVerificationTraceRecord,
} from '../claude-science-construct-verification-traces';
import {
  verifyArtifactConstruct,
  type ArtifactConstructObservedVariant,
  type ArtifactConstructVerificationResult,
} from '../claude-science-construct-verification';
import { traceTemplateCoordinateLabel } from '../ClaudeScienceSangerTraceViewer';
import { sha256HexSync } from '../claude-science-sha256';

function deterministicDna(length: number, seed: number): string {
  const bases = ['A', 'C', 'G', 'T'] as const;
  let state = seed >>> 0;
  let sequence = '';
  for (let index = 0; index < length; index += 1) {
    state = (Math.imul(state, 1_664_525) + 1_013_904_223) >>> 0;
    sequence += bases[(state >>> 28) & 3];
  }
  return sequence;
}

function swapBase(base: string): string {
  return base === 'A' ? 'G' : 'A';
}

type Read = { id: string; name: string; baseCalls: string; qualityScores?: number[] };

function run(sequence: string, reads: Read[], topology: 'linear' | 'circular' = 'linear') {
  const result = verifyArtifactConstruct({
    reference: { id: 'ref', name: 'pTEST predicted', sequence, topology, sha256: sha256HexSync(sequence) },
    reads: reads.map((read) => ({
      id: read.id,
      name: read.name,
      baseCalls: read.baseCalls,
      qualityScores: read.qualityScores ?? new Array(read.baseCalls.length).fill(40),
      sha256: sha256HexSync(read.baseCalls),
    })),
    requiredRegions: [{ id: 'full-reference', name: 'Full predicted construct', start: 0, end: sequence.length, minDepth: 1, requireBothStrands: false }],
    expectedVariants: [],
    thresholds: { minCoverageFraction: 0, minDepth: 1, requireBothStrands: false },
  });
  const records = new Map<string, ConstructVerificationTraceRecord>(reads.map((read) => [read.id, {
    id: read.id,
    name: read.name,
    sha256: sha256HexSync(read.baseCalls),
    sangerTrace: { baseCalls: read.baseCalls },
  }]));
  const reference: ConstructVerificationTraceRecord = { id: 'ref', name: 'pTEST predicted', sha256: sha256HexSync(sequence) };
  return { result, records, reference };
}

function variantAt(result: ArtifactConstructVerificationResult, type: string, start: number): ArtifactConstructObservedVariant {
  const variant = result.variants.observed.find((candidate) => candidate.type === type && candidate.referenceStart === start);
  if (!variant) throw new Error(`no ${type} at ${start}: ${JSON.stringify(result.variants.observed.map((v) => [v.type, v.referenceStart]))}`);
  return variant;
}

function mappedReadIds(result: ArtifactConstructVerificationResult): string[] {
  return result.reads.filter((read) => read.status === 'mapped').map((read) => read.id);
}

describe('construct verification trace layout', () => {
  // Reference bases 0-based 60..239 are read; the forward read carries a 1 bp
  // insertion after 0-based 99 and both reads carry a substitution at 150.
  const reference = deterministicDna(300, 0x7ace);
  const withSnp = `${reference.slice(0, 150)}${swapBase(reference[150])}${reference.slice(151)}`;
  const forward = `${withSnp.slice(60, 100)}T${withSnp.slice(100, 200)}`;
  const reverse = reverseComplement(withSnp.slice(110, 240));

  it('opens a substitution at its reference base, numbered as the verification table numbers it', () => {
    const { result, records, reference: referenceRecord } = run(reference, [
      { id: 'f', name: 'clone_F.ab1', baseCalls: forward },
      { id: 'r', name: 'clone_R.ab1', baseCalls: reverse },
    ]);
    expect(mappedReadIds(result)).toEqual(['f', 'r']);
    const variant = variantAt(result, 'substitution', 150);
    expect(constructVariantTraceReadIds(result, variant)).toEqual(['f', 'r']);

    const target = constructVerificationTraceTarget({ result, variant, reference: referenceRecord, records });
    expect(target).not.toBeNull();
    const { alignment, column, rowId } = target!;
    // The slice starts at the first read base: 0-based 60, 1-based 61.
    expect(alignment.referenceNumbering).toEqual({ rowId: 'reference', firstResiduePosition: 61 });
    // 90 reference bases from 60 up to 150, plus the one inserted column upstream.
    expect(column).toBe(91);
    const template = alignment.rows.find((row) => row.id === 'reference')!;
    expect(template.aligned[column]).toBe(reference[150]);
    expect(alignment.rows.filter((row) => row.id !== 'reference').map((row) => row.aligned[column])).toEqual([
      swapBase(reference[150]),
      swapBase(reference[150]),
    ]);
    // The readout names the base the way the table does.
    expect(constructVariantDisplayPosition(variant, reference.length)).toBe('151');
    expect(traceTemplateCoordinateLabel(alignment, template, column)).toBe('Reference position 151');
    expect(rowId).toBe('read-1');
  });

  it('keeps every call of each read in reference orientation, so the rows link to their traces', () => {
    const { result, records, reference: referenceRecord } = run(reference, [
      { id: 'f', name: 'clone_F.ab1', baseCalls: forward },
      { id: 'r', name: 'clone_R.ab1', baseCalls: reverse },
    ]);
    const { alignment } = constructVerificationTraceTarget({
      result,
      variant: variantAt(result, 'substitution', 150),
      reference: referenceRecord,
      records,
    })!;
    const rows = new Map(alignment.rows.map((row) => [row.sourceRecordId, row.aligned.replace(/-/g, '')]));
    expect(rows.get('f')).toBe(forward);
    expect(rows.get('r')).toBe(reverseComplement(reverse));
    expect(rows.get('ref')).toBe(reference.slice(60, 240));
    expect(alignment.rows.map((row) => row.inputSha256)).toEqual([
      sha256HexSync(reference),
      sha256HexSync(forward),
      sha256HexSync(reverse),
    ]);
  });

  it('opens an insertion on its inserted call, after the base the table names', () => {
    const { result, records, reference: referenceRecord } = run(reference, [
      { id: 'f', name: 'clone_F.ab1', baseCalls: forward },
      { id: 'r', name: 'clone_R.ab1', baseCalls: reverse },
    ]);
    const variant = variantAt(result, 'insertion', 100);
    // The reverse read starts at 110, so only the forward read covers it.
    expect(constructVariantTraceReadIds(result, variant)).toEqual(['f']);
    const { alignment, column } = constructVerificationTraceTarget({ result, variant, reference: referenceRecord, records })!;
    const template = alignment.rows.find((row) => row.id === 'reference')!;
    expect(alignment.rows).toHaveLength(2);
    expect(template.aligned[column]).toBe('-');
    expect(alignment.rows[1].aligned[column]).toBe('T');
    expect(constructVariantDisplayPosition(variant, reference.length)).toBe('after 100');
    expect(traceTemplateCoordinateLabel(alignment, template, column)).toBe('Insertion after reference position 100');
  });

  it('names the same alignment for two variants that the same reads cover', () => {
    const second = `${withSnp.slice(0, 180)}${swapBase(withSnp[180])}${withSnp.slice(181)}`;
    const forwardTwo = `${second.slice(60, 100)}T${second.slice(100, 200)}`;
    const reverseTwo = reverseComplement(second.slice(110, 240));
    const { result, records, reference: referenceRecord } = run(reference, [
      { id: 'f', name: 'clone_F.ab1', baseCalls: forwardTwo },
      { id: 'r', name: 'clone_R.ab1', baseCalls: reverseTwo },
    ]);
    const first = constructVerificationTraceTarget({ result, variant: variantAt(result, 'substitution', 150), reference: referenceRecord, records })!;
    const next = constructVerificationTraceTarget({ result, variant: variantAt(result, 'substitution', 180), reference: referenceRecord, records })!;
    expect(next.alignment.id).toBe(first.alignment.id);
    expect(next.column - first.column).toBe(30);
  });

  it('draws the ends trimmed for low quality ungapped beside the mapped part', () => {
    const read = withSnp.slice(60, 200);
    const qualityScores = read.split('').map((_, index) => (index < 12 ? 4 : 40));
    const { result, records, reference: referenceRecord } = run(reference, [
      { id: 'f', name: 'clone_F.ab1', baseCalls: read, qualityScores },
    ]);
    expect(result.reads[0].trim.removedFromStart).toBeGreaterThan(0);
    expect(result.reads[0].mapping?.referenceStart).toBeGreaterThan(60);
    const target = constructVerificationTraceTarget({ result, variant: variantAt(result, 'substitution', 150), reference: referenceRecord, records })!;
    expect(target.alignment.referenceNumbering?.firstResiduePosition).toBe(61);
    expect(target.alignment.rows.map((row) => row.aligned)).toEqual([reference.slice(60, 200), read]);
    expect(target.column).toBe(90);
  });

  it('stops at a circular origin and draws a read’s calls past it beyond the reference row', () => {
    const circular = deterministicDna(300, 0xc1c1);
    const mutated = `${circular.slice(0, 20)}${swapBase(circular[20])}${circular.slice(21)}`;
    const acrossOrigin = `${mutated.slice(250)}${mutated.slice(0, 70)}`;
    const { result, records, reference: referenceRecord } = run(circular, [
      { id: 'f', name: 'origin_F.ab1', baseCalls: acrossOrigin },
    ], 'circular');
    expect(result.reads[0].mapping?.wraps).toBe(true);
    const variant = variantAt(result, 'substitution', 20);
    const { alignment, column } = constructVerificationTraceTarget({ result, variant, reference: referenceRecord, records })!;
    const template = alignment.rows[0];
    expect(alignment.referenceNumbering?.firstResiduePosition).toBe(1);
    expect(template.aligned).toBe(`${'-'.repeat(50)}${circular.slice(0, 70)}`);
    expect(alignment.rows[1].aligned).toBe(acrossOrigin);
    expect(column).toBe(70);
    expect(traceTemplateCoordinateLabel(alignment, template, column)).toBe('Reference position 21');
  });

  it('offers nothing where no mapped read covers the variant', () => {
    const { result, records, reference: referenceRecord } = run(reference, [
      { id: 'f', name: 'clone_F.ab1', baseCalls: forward },
    ]);
    const uncovered = { type: 'substitution', referenceStart: 280, referenceEnd: 281, reference: 'A', alternate: 'G' };
    expect(constructVariantTraceReadIds(result, uncovered)).toEqual([]);
    expect(constructVerificationTraceTarget({ result, variant: uncovered, reference: referenceRecord, records })).toBeNull();
    // A read whose trace is gone from the workspace cannot be laid out either.
    expect(constructVerificationTraceTarget({
      result,
      variant: variantAt(result, 'substitution', 150),
      reference: referenceRecord,
      records: new Map(),
    })).toBeNull();
  });
});
