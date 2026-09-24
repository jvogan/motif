import { describe, expect, it } from 'vitest';
import {
  constructConflictCount,
  constructReadSearchWasIncomplete,
  constructReferenceRangeLabel,
  constructVariantDisplayPosition,
  constructVariantFirstBase,
  constructVariantLabel,
  constructVerificationFindings,
  constructVerificationPresentationFromReport,
  type ConstructVerificationDisplayInput,
} from '../claude-science-construct-verification-display';
import { verifyArtifactConstruct, type ArtifactConstructReadInput } from '../claude-science-construct-verification';
import { sha256HexSync } from '../claude-science-sha256';

function deterministicDna(length: number, seed = 0x5eed1234): string {
  const bases = ['A', 'C', 'G', 'T'] as const;
  let state = seed >>> 0;
  let sequence = '';
  for (let index = 0; index < length; index += 1) {
    state = (Math.imul(state, 1_664_525) + 1_013_904_223) >>> 0;
    sequence += bases[(state >>> 28) & 3];
  }
  return sequence;
}

function read(id: string, baseCalls: string, name = id): ArtifactConstructReadInput {
  return {
    id,
    name,
    baseCalls,
    qualityScores: new Array(baseCalls.length).fill(40),
    sha256: sha256HexSync(baseCalls),
  };
}

function verify(sequence: string, reads: ArtifactConstructReadInput[], topology: 'linear' | 'circular' = 'linear') {
  return verifyArtifactConstruct({
    reference: { id: 'reference', name: 'Reference', sequence, topology, sha256: sha256HexSync(sequence) },
    reads,
    requiredRegions: [{ id: 'full-reference', name: 'Full predicted construct', start: 0, end: sequence.length, minDepth: 1, requireBothStrands: false }],
    expectedVariants: [],
    thresholds: { minCoverageFraction: 1, minDepth: 1, requireBothStrands: false },
  });
}

function substituteAt(sequence: string, positions: readonly number[]): string {
  const chars = Array.from(sequence);
  for (const position of positions) chars[position] = chars[position] === 'A' ? 'G' : 'A';
  return chars.join('');
}

describe('construct verification display coordinates', () => {
  it('numbers variants from 1, as the sequence view, alignment and trace do', () => {
    // 0-based 17 is the 18th base.
    expect(constructVariantDisplayPosition({ type: 'substitution', referenceStart: 17, referenceEnd: 18, reference: 'A', alternate: 'G' })).toBe('18');
    expect(constructVariantLabel({ type: 'substitution', referenceStart: 17, referenceEnd: 18, reference: 'A', alternate: 'G' })).toBe('A18G');
    expect(constructVariantFirstBase({ type: 'substitution', referenceStart: 17 })).toBe(18);
    // A deletion of 0-based 18, 19 and 20 removes bases 19–21.
    expect(constructVariantDisplayPosition({ type: 'deletion', referenceStart: 18, referenceEnd: 21, reference: 'ACG', alternate: '' })).toBe('19–21');
    expect(constructVariantLabel({ type: 'deletion', referenceStart: 18, referenceEnd: 21, reference: 'ACG', alternate: '' })).toBe('del 19–21');
    expect(constructVariantDisplayPosition({ type: 'deletion', referenceStart: 18, referenceEnd: 19, reference: 'A', alternate: '' })).toBe('19');
    // Without an end, the deleted allele's length sets it.
    expect(constructVariantDisplayPosition({ type: 'deletion', referenceStart: 420, reference: 'AT', alternate: '' })).toBe('421–422');
    // An insertion at boundary 50 sits between 0-based 49 and 50: after base 50.
    expect(constructVariantDisplayPosition({ type: 'insertion', referenceStart: 50, referenceEnd: 50, reference: '', alternate: 'T' })).toBe('after 50');
    expect(constructVariantLabel({ type: 'insertion', referenceStart: 50, referenceEnd: 50, reference: '', alternate: 'T' })).toBe('ins T after 50');
    expect(constructVariantDisplayPosition({ type: 'insertion', referenceStart: 0, referenceEnd: 0, reference: '', alternate: 'T' })).toBe('before 1');
    expect(constructVariantDisplayPosition({})).toBe('—');
  });

  it('renders 0-based end-exclusive intervals as 1-based inclusive ranges', () => {
    expect(constructReferenceRangeLabel(0, 700)).toBe('1–700');
    expect(constructReferenceRangeLabel(1990, 2030)).toBe('1,991–2,030');
    // A circular interval that ends exactly at the origin reports end 0.
    expect(constructReferenceRangeLabel(100, 0, 180)).toBe('101–180');
    // One that crosses the origin says so.
    expect(constructReferenceRangeLabel(170, 10, 180)).toBe('171–10 across the origin');
    expect(constructReferenceRangeLabel(undefined, 10)).toBeNull();
  });
});

describe('construct verification review findings', () => {
  it('puts the reason that decided the verdict first and collapses repeats to one line per kind', () => {
    const reference = deterministicDna(240, 0xabc);
    // Clone A carries 7 substitutions; clone B is the design. Pooled, the
    // substituted positions have no majority call.
    const positions = [17, 36, 54, 81, 103, 119, 149];
    const cloneA = substituteAt(reference, positions);
    const result = verify(reference, [read('a', cloneA, 'clone A'), read('b', reference, 'clone B')]);
    expect(result.state).toBe('inconsistent');
    const engineOrder = result.reasons.map((reason) => reason.code);
    // Precondition: in the engine's own order the deciding reason is not first.
    expect(engineOrder[0]).not.toBe('conflicting_consensus');
    expect(engineOrder).toContain('conflicting_consensus');

    const findings = constructVerificationFindings(result, { a: 'Clone A.ab1' });
    expect(findings[0]?.code).toBe('conflicting_consensus');
    expect(findings[0]?.severity).toBe('inconsistent');
    expect(findings[0]?.message).toBe('Reads disagree at 7 reference positions, so no consensus base could be called there.');
    // Every inconsistent finding precedes every review finding.
    const firstReview = findings.findIndex((finding) => finding.severity === 'review');
    const lastInconsistent = findings.map((finding) => finding.severity).lastIndexOf('inconsistent');
    expect(firstReview === -1 || firstReview > lastInconsistent).toBe(true);

    const lowConfidence = findings.filter((finding) => finding.code === 'low_confidence_variant');
    expect(lowConfidence).toHaveLength(1);
    expect(lowConfidence[0]?.count).toBe(7);
    // Seven fit on the line; an eighth would read "…, and 2 more".
    expect(lowConfidence[0]?.message).toMatch(/^7 low-confidence substitutions: [ACGT]18[ACGT], [ACGT]37[ACGT], [ACGT]55[ACGT], [ACGT]82[ACGT], [ACGT]104[ACGT], [ACGT]120[ACGT], [ACGT]150[ACGT]\. /);
    for (const finding of findings) expect(finding.message).not.toMatch(/observed:|expectedVariants/);
    expect(findings.length).toBeLessThan(result.reasons.length);
  });

  it('builds unexpected-variant lines from alleles and 1-based positions, not variant ids', () => {
    const reference = deterministicDna(240, 0xdef);
    const variant = substituteAt(reference, [17]);
    const result = verify(reference, [read('f', variant)]);
    expect(result.reasons.find((reason) => reason.code === 'unexpected_variant')?.message).toMatch(/^observed:substitution:17:/);
    const findings = constructVerificationFindings(result);
    const unexpected = findings.find((finding) => finding.code === 'unexpected_variant');
    expect(unexpected?.message).toBe(`1 unexpected substitution: ${reference[17]}18${variant[17]}. Supported with high confidence; not in the expected design.`);
    expect(findings[0]?.code).toBe('unexpected_variant');
  });

  it('lists six labels and counts the rest once more than seven variants share a line', () => {
    const variants = Array.from({ length: 9 }, (_, index) => ({
      id: `v${index}`, type: 'substitution', referenceStart: index * 10, referenceEnd: index * 10 + 1, reference: 'A', alternate: 'C', confidence: 'high' as const,
    }));
    const findings = constructVerificationFindings({
      reasons: variants.map((variant) => ({ code: 'unexpected_variant', severity: 'inconsistent', message: `${variant.id} internal`, variantId: variant.id })),
      reference: { length: 100 },
      reads: [],
      variants: { observed: variants, expected: [], unexpected: variants, missingExpected: [] },
    });
    expect(findings).toHaveLength(1);
    expect(findings[0]?.message).toBe('9 unexpected substitutions: A1C, A11C, A21C, A31C, A41C, A51C, and 3 more. Supported with high confidence; not in the expected design.');
  });

  it('keeps unknown reasons verbatim, one line each', () => {
    const input: ConstructVerificationDisplayInput = {
      reasons: [
        { code: 'future_code', severity: 'review', message: 'A future engine sentence.' },
        { code: 'future_code', severity: 'review', message: 'Another one.' },
      ],
      reference: { length: 100 },
      reads: [],
      variants: { observed: [], expected: [], unexpected: [], missingExpected: [] },
    };
    expect(constructVerificationFindings(input).map((finding) => finding.message)).toEqual([
      'A future engine sentence.',
      'Another one.',
    ]);
  });

  it('reads the conflict count from the engine sentence', () => {
    expect(constructConflictCount([])).toBe(0);
    expect(constructConflictCount([{ code: 'conflicting_consensus', severity: 'inconsistent', message: '1,234 reference positions lack a unique quality-weighted consensus.' }])).toBe(1234);
    expect(constructConflictCount([{ code: 'conflicting_consensus', severity: 'inconsistent', message: 'unparseable' }])).toBeNull();
  });
});

describe('construct verification search-budget message', () => {
  it('maps an exact plasmid-scale read once the seeded search proves it unique', () => {
    // A 2,686 bp random circular reference and an exact 700 bp read: every 20-mer is
    // unique, and the seeded search proves no other placement comes within the margin.
    const reference = deterministicDna(2686, 0x7a11);
    const result = verify(reference, [read('r1', reference.slice(400, 1100), 'clone1_F.ab1')], 'circular');
    const mapped = result.reads[0];
    expect(mapped).toMatchObject({ status: 'mapped', mapping: { referenceStart: 400, secondBestScore: null } });
    expect(constructReadSearchWasIncomplete(mapped!, result.reference)).toBe(false);
    expect(constructVerificationFindings(result).map((entry) => entry.code)).not.toContain('ambiguous_mapping');
  });

  it('says the search was cut short when a full plate leaves a repeat read too little budget', () => {
    // 95 exact reads share the work budget with one read inside a five-copy cassette.
    // Its one miscall rules out the exact-occurrence shortcut, and aligning around all
    // five copies costs more than its share, so the engine cannot prove a runner-up.
    const unique = deterministicDna(5_000, 0x7a11);
    const reference = unique + deterministicDna(1_000, 0xca55e77e).repeat(5);
    const reads = Array.from({ length: 95 }, (_, index) => read(`u${index}`, unique.slice(100, 900)));
    reads.push(read('r1', substituteAt(reference.slice(7_100, 7_900), [400]), 'clone1_F.ab1'));
    const result = verify(reference, reads, 'circular');
    const mapped = result.reads[95];
    expect(mapped?.status).toBe('ambiguous_mapping');
    expect(mapped?.mapping?.secondBestScore).toBeNull();
    expect(constructReadSearchWasIncomplete(mapped!, result.reference)).toBe(true);
    // The engine's saved sentence is unchanged…
    expect(result.reasons.find((reason) => reason.code === 'ambiguous_mapping')?.message)
      .toBe('clone1_F.ab1 does not have a unique best reference mapping.');
    // …but the reader is told the true cause.
    const finding = constructVerificationFindings(result).find((entry) => entry.code === 'ambiguous_mapping');
    expect(finding?.message).toContain('could not be confirmed as a unique match: clone1_F.ab1');
    expect(finding?.message).toContain('search stopped before checking the whole reference');
    expect(finding?.message).not.toContain('does not have a unique best reference mapping');
  });

  it('still reports genuine ambiguity when a second placement was scored', () => {
    const unit = deterministicDna(300, 0x5151);
    const filler = deterministicDna(200, 0x2222);
    const reference = `${unit}${filler}${unit}`;
    const result = verify(reference, [read('dup', unit.slice(50, 250), 'dup.ab1')]);
    const mapped = result.reads[0];
    expect(mapped?.status).toBe('ambiguous_mapping');
    expect(mapped?.mapping?.secondBestScore).not.toBeNull();
    expect(constructReadSearchWasIncomplete(mapped!, result.reference)).toBe(false);
    const finding = constructVerificationFindings(result).find((entry) => entry.code === 'ambiguous_mapping');
    expect(finding?.message).toContain('matches more than one place in the reference too closely to tell apart: dup.ab1');
  });

  it('treats a mapping without a secondBestScore field as unknown, not as a cut-short search', () => {
    expect(constructReadSearchWasIncomplete(
      { id: 'x', status: 'ambiguous_mapping', mapping: { referenceStart: 0, referenceEnd: 10 } },
      { length: 100, topology: 'linear' },
    )).toBe(false);
  });

  it('says the search stopped, not that the read did not align, when the budget ended an unmapped read', () => {
    // A 5,000-call read with no counterpart in a 12 kb reference: aligning it to the
    // whole reference costs more than its work budget, so the search stops first.
    const result = verify(deterministicDna(12_000, 0xabc123), [read('r1', deterministicDna(5_000, 0x5eed + 5_000), 'stray.ab1')]);
    const unmapped = result.reads[0];
    expect(unmapped).toMatchObject({ status: 'unmapped', searchIncomplete: true, mapping: null });
    expect(constructReadSearchWasIncomplete(unmapped!, result.reference)).toBe(true);
    expect(constructVerificationFindings(result).find((entry) => entry.code === 'unmapped_read')?.message).toBe(
      'The in-browser search stopped before it found a close alignment for 1 read: stray.ab1. '
      + 'A full search could still align it to the reference, so it is not counted as evidence.',
    );
  });

  it('keeps "did not align" for an unmapped read without the marker, on its own line', () => {
    const input: ConstructVerificationDisplayInput = {
      reasons: ['a', 'b', 'c'].map((id) => ({ code: 'unmapped_read', severity: 'review', message: `${id}.ab1`, readId: id })),
      reference: { length: 5_000, topology: 'circular' },
      reads: [
        { id: 'a', name: 'a.ab1', status: 'unmapped', mapping: null },
        { id: 'b', name: 'b.ab1', status: 'unmapped', searchIncomplete: true, mapping: null },
        { id: 'c', name: 'c.ab1', status: 'unmapped', searchIncomplete: true, mapping: null },
      ],
      variants: { observed: [], expected: [], unexpected: [], missingExpected: [] },
    };
    expect(constructReadSearchWasIncomplete(input.reads[0], input.reference)).toBe(false);
    expect(constructVerificationFindings(input).map((entry) => [entry.count, entry.message])).toEqual([
      [1, '1 read did not align to the reference: a.ab1.'],
      [2, 'The in-browser search stopped before it found a close alignment for 2 reads: b.ab1, c.ab1. '
        + 'A full search could still align them to the reference, so they are not counted as evidence.'],
    ]);
  });
});

describe('saved report presentation', () => {
  it('reads only reports this engine wrote', () => {
    expect(constructVerificationPresentationFromReport('not json')).toBeNull();
    expect(constructVerificationPresentationFromReport(JSON.stringify({ schema: 'something-else', state: 'consistent' }))).toBeNull();
    expect(constructVerificationPresentationFromReport(JSON.stringify({ schema: 'motif.construct-verification-report.v1', state: 'maybe' }))).toBeNull();
  });

  it('maps report coverage names onto the panel and keeps 0-based variant starts', () => {
    const presentation = constructVerificationPresentationFromReport(JSON.stringify({
      schema: 'motif.construct-verification-report.v1',
      version: 1,
      state: 'needs_review',
      reasons: [{ code: 'ambiguous_mapping', severity: 'review', message: 'r1 does not have a unique best reference mapping.', readId: 'r1' }],
      reference: { id: 'ref', length: 2686, topology: 'circular' },
      reads: [{ id: 'r1', rawLength: 700, meanQuality: 45, status: 'ambiguous_mapping', mapping: { orientation: 'forward', referenceStart: 400, referenceEnd: 1100, referenceSpan: 700, secondBestScore: null } }],
      coverage: { coveredBasesAtAnyDepth: 700, basesMeetingMinDepth: 0, coverageFraction: 0, meanDepth: 0.26, requiredRegions: [] },
      variants: { observed: [{ id: 'v', type: 'substitution', referenceStart: 17, referenceEnd: 18, reference: 'A', alternate: 'G', confidence: 'high' }], expected: [], unexpected: [], missingExpected: [] },
      provenance: { engine: 'motif-construct-verification', engineVersion: '1' },
    }));
    expect(presentation?.coverage).toMatchObject({ coveredBases: 700, basesMeetingMinDepth: 0, coveredFraction: 0, meanDepth: 0.26 });
    expect(presentation?.variants.observed[0]?.referenceStart).toBe(17);
    expect(constructVerificationFindings(presentation!)[0]?.message).toContain('could not be confirmed as a unique match: r1');
  });

  it('carries the search-stopped marker from a saved report and keeps older reports on the plain wording', () => {
    const report = (marker: Record<string, unknown>) => JSON.stringify({
      schema: 'motif.construct-verification-report.v1',
      version: 1,
      state: 'needs_review',
      reasons: [{ code: 'unmapped_read', severity: 'review', message: 'r1.ab1 could not be mapped to the reference.', readId: 'r1' }],
      reference: { id: 'ref', length: 5_000, topology: 'circular' },
      reads: [{ id: 'r1', name: 'r1.ab1', rawLength: 800, meanQuality: 40, status: 'unmapped', ...marker, mapping: null }],
      coverage: { coveredBasesAtAnyDepth: 0, basesMeetingMinDepth: 0, coverageFraction: 0, meanDepth: 0, requiredRegions: [] },
      variants: { observed: [], expected: [], unexpected: [], missingExpected: [] },
      provenance: { engine: 'motif-construct-verification', engineVersion: '1' },
    });
    const stopped = constructVerificationPresentationFromReport(report({ searchIncomplete: true }));
    expect(stopped?.reads[0]).toMatchObject({ status: 'unmapped', searchIncomplete: true });
    expect(constructVerificationFindings(stopped!)[0]?.message)
      .toContain('The in-browser search stopped before it found a close alignment for 1 read: r1.ab1.');

    const older = constructVerificationPresentationFromReport(report({}));
    expect(older?.reads[0]).not.toHaveProperty('searchIncomplete');
    expect(constructVerificationFindings(older!)[0]?.message).toBe('1 read did not align to the reference: r1.ab1.');
  });
});
