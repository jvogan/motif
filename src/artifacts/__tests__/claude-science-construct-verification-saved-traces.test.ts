import { describe, expect, it } from 'vitest';
import { reverseComplement } from '../../bio/reverse-complement';
import {
  appendArtifactAnalysisAsset,
  appendArtifactAnalysisWorkspaceResult,
} from '../claude-science-analysis-results';
import {
  artifactConstructReadEvidenceSha256,
  buildArtifactConstructVerificationArtifacts,
  constructReadMappingCigar,
} from '../claude-science-construct-verification-artifacts';
import { constructVerificationSavedTraces } from '../claude-science-construct-verification-display';
import {
  constructVariantTraceReadIds,
  constructVerificationTraceTarget,
  type ConstructVerificationTraceTarget,
} from '../claude-science-construct-verification-traces';
import {
  verifyArtifactConstruct,
  type ArtifactConstructVerificationResult,
} from '../claude-science-construct-verification';
import { sha256HexSync } from '../claude-science-sha256';

// The plugin ships a generated copy of the saved-report validator; check it too.
const PLUGIN_VALIDATOR_PATH = '../motif-for-claude-science-plugin/skills/motif-for-claude-science/scripts/analysis-validator.mjs';

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
type WorkspaceRecord = {
  id: string;
  name: string;
  sequence: string;
  topology: 'linear' | 'circular';
  sha256: string;
  sangerTrace?: { baseCalls: string; qualityScores?: number[] };
};

function run(sequence: string, reads: Read[], topology: 'linear' | 'circular' = 'linear') {
  const scored = reads.map((read) => ({ ...read, qualityScores: read.qualityScores ?? new Array(read.baseCalls.length).fill(40) }));
  const result = verifyArtifactConstruct({
    reference: { id: 'ref', name: 'pTEST predicted', sequence, topology, sha256: sha256HexSync(sequence) },
    reads: scored.map((read) => ({ ...read, sha256: sha256HexSync(read.baseCalls) })),
    requiredRegions: [{ id: 'full-reference', name: 'Full predicted construct', start: 0, end: sequence.length, minDepth: 1, requireBothStrands: false }],
    expectedVariants: [],
    thresholds: { minCoverageFraction: 0, minDepth: 1, requireBothStrands: false },
  });
  const built = buildArtifactConstructVerificationArtifacts(
    result,
    scored.map((read) => artifactConstructReadEvidenceSha256(read)),
    { resultId: 'cv-result', assetId: 'cv-report', createdAt: '2026-09-23T12:00:00.000Z' },
  );
  // The workspace's own records, as the host hands them to the Results panel.
  const records: WorkspaceRecord[] = [
    { id: 'ref', name: 'pTEST predicted', sequence, topology, sha256: sha256HexSync(sequence) },
    ...scored.map((read) => ({
      id: read.id,
      name: read.name,
      sequence: read.baseCalls,
      topology: 'linear' as const,
      sha256: sha256HexSync(read.baseCalls),
      sangerTrace: { baseCalls: read.baseCalls, qualityScores: read.qualityScores },
    })),
  ];
  return { result, built, records };
}

function report(built: { asset: { content: string } }) {
  return JSON.parse(built.asset.content) as { reads: Array<Record<string, unknown> & { mapping: Record<string, unknown> | null }> };
}

/** What a target shows; createdAt is the moment it was built and differs by construction. */
function shown(target: ConstructVerificationTraceTarget | null) {
  if (!target) return null;
  const { createdAt: _createdAt, ...alignment } = target.alignment;
  return { ...target, alignment };
}

// The forward read covers 0-based 60..199 with a 1 bp insertion after 99; the
// reverse read covers 110..259 and lacks one base past the forward read's end,
// at a base unlike both neighbours so the engine cannot shift the deletion.
// Both carry a substitution at 150.
const REFERENCE = deterministicDna(300, 0x7ace);
const DELETED = Array.from({ length: 30 }, (_, offset) => 215 + offset)
  .find((index) => REFERENCE[index - 1] !== REFERENCE[index] && REFERENCE[index] !== REFERENCE[index + 1])!;
const WITH_SNP = `${REFERENCE.slice(0, 150)}${swapBase(REFERENCE[150])}${REFERENCE.slice(151)}`;
const FORWARD = `${WITH_SNP.slice(60, 100)}T${WITH_SNP.slice(100, 200)}`;
const REVERSE = reverseComplement(`${WITH_SNP.slice(110, DELETED)}${WITH_SNP.slice(DELETED + 1, 260)}`);

function roundTrip(result: ArtifactConstructVerificationResult, built: { asset: { content: string } }, records: WorkspaceRecord[]) {
  const saved = constructVerificationSavedTraces(built.asset.content, records);
  if (saved.status !== 'ready') throw new Error(`saved traces not ready: ${saved.status}`);
  const byId = new Map(records.map((record) => [record.id, record]));
  const reference = byId.get('ref')!;
  for (const variant of result.variants.observed) {
    expect(constructVariantTraceReadIds(saved.result, variant)).toEqual(constructVariantTraceReadIds(result, variant));
    expect(shown(constructVerificationTraceTarget({ result: saved.result, variant, reference: saved.reference, records: saved.records })))
      .toEqual(shown(constructVerificationTraceTarget({ result, variant, reference, records: byId })));
  }
  return saved;
}

describe('a saved verification report carries each mapped read’s CIGAR', () => {
  it('writes M, I and D runs in reference order for every mapped read and nothing else', () => {
    const { result, built } = run(REFERENCE, [
      { id: 'f', name: 'clone_F.ab1', baseCalls: FORWARD },
      { id: 'r', name: 'clone_R.ab1', baseCalls: REVERSE },
      { id: 'stray', name: 'stray.ab1', baseCalls: deterministicDna(150, 0x5eed) },
    ]);
    expect(result.reads.map((read) => read.status)).toEqual(['mapped', 'mapped', expect.not.stringMatching(/^mapped$/)]);
    const reads = report(built).reads;
    expect(reads[0].mapping?.cigar).toBe('40M1I100M');
    expect(reads[1].mapping?.cigar).toBe(`${DELETED - 110}M1D${259 - DELETED}M`);
    expect(reads[2].mapping === null || !('cigar' in reads[2].mapping)).toBe(true);
  });

  it('leaves the CIGAR out when the column map does not spell the mapping’s counts', () => {
    expect(constructReadMappingCigar([{ operation: 'match' }, { operation: 'match' }, { operation: 'insertion' }, { operation: 'deletion' }]))
      .toBe('2M1I1D');
    expect(constructReadMappingCigar([{ operation: 'match' }, { operation: 'gap' }])).toBe('');
    const { result } = run(REFERENCE, [{ id: 'f', name: 'clone_F.ab1', baseCalls: FORWARD }]);
    const damaged = structuredClone(result);
    damaged.reads[0].mapping!.coordinateMap.columns.pop();
    const built = buildArtifactConstructVerificationArtifacts(
      damaged,
      [artifactConstructReadEvidenceSha256({ baseCalls: FORWARD, qualityScores: new Array(FORWARD.length).fill(40) })],
      { resultId: 'cv-result', assetId: 'cv-report', createdAt: '2026-09-23T12:00:00.000Z' },
    );
    expect(report(built).reads[0].mapping).not.toHaveProperty('cigar');
  });

  it('stays small: twelve 1,000-call reads on a 10 kb reference add under 600 bytes', () => {
    const reference = deterministicDna(10_000, 0x10b);
    const reads = Array.from({ length: 12 }, (_, index) => {
      const start = index * 750;
      const slice = reference.slice(start, start + 1_000);
      // One substitution, and an inserted and a deleted base on every other read.
      const edited = index % 2
        ? `${slice.slice(0, 300)}A${slice.slice(300, 600)}${slice.slice(601, 999)}`
        : `${slice.slice(0, 500)}${swapBase(slice[500])}${slice.slice(501)}`;
      return { id: `read-${index}`, name: `read_${index}.ab1`, baseCalls: index % 3 === 1 ? reverseComplement(edited) : edited };
    });
    const { result, built } = run(reference, reads);
    expect(result.reads.every((read) => read.status === 'mapped')).toBe(true);
    const withoutCigar = { ...report(built) };
    withoutCigar.reads = withoutCigar.reads.map((read) => {
      const { cigar: _cigar, ...mapping } = read.mapping ?? {};
      return { ...read, mapping };
    });
    const bytes = (value: unknown) => new TextEncoder().encode(`${JSON.stringify(value, null, 2)}\n`).byteLength;
    const growth = bytes(report(built)) - bytes(withoutCigar);
    expect(growth).toBeGreaterThan(0);
    expect(growth).toBeLessThan(600);
    const longest = Math.max(...report(built).reads.map((read) => String(read.mapping?.cigar ?? '').length));
    expect(longest).toBeLessThan(40);
  });
});

describe('both saved-report validators and the CIGAR', () => {
  function mutate(built: ReturnType<typeof run>['built'], change: (reads: ReturnType<typeof report>['reads']) => void) {
    const parsed = report(built);
    change(parsed.reads);
    const content = `${JSON.stringify(parsed, null, 2)}\n`;
    return { result: built.result, asset: { ...built.asset, content, sha256: sha256HexSync(content) } };
  }

  async function validators() {
    const plugin = await import(/* @vite-ignore */ PLUGIN_VALIDATOR_PATH);
    return [
      { name: 'app', appendAsset: appendArtifactAnalysisAsset, appendResult: appendArtifactAnalysisWorkspaceResult },
      { name: 'plugin', appendAsset: plugin.appendArtifactAnalysisAsset, appendResult: plugin.appendArtifactAnalysisWorkspaceResult },
    ] as const;
  }

  const base = () => run(REFERENCE, [
    { id: 'f', name: 'clone_F.ab1', baseCalls: FORWARD },
    { id: 'r', name: 'clone_R.ab1', baseCalls: REVERSE },
  ]).built;

  it('accept a report with the CIGAR, and an older report without it', async () => {
    const withCigar = base();
    expect(withCigar.asset.content).toContain('"cigar": "40M1I100M"');
    const without = mutate(withCigar, (reads) => reads.forEach((read) => { delete read.mapping?.cigar; }));
    expect(without.asset.content).not.toContain('cigar');
    for (const validator of await validators()) {
      for (const built of [withCigar, without]) {
        const assets = validator.appendAsset(undefined, built.asset);
        expect(() => validator.appendResult(assets, built.result), validator.name).not.toThrow();
      }
    }
  });

  it('reject a CIGAR that is malformed, repeats a run, disagrees with the counts, or sits on a read that is not mapped', async () => {
    const cases: Array<[string, (reads: ReturnType<typeof report>['reads']) => void, RegExp]> = [
      ['malformed', (reads) => { reads[0].mapping!.cigar = '40M1X100M'; }, /cigar must be a CIGAR of M, I and D runs/],
      ['zero run', (reads) => { reads[0].mapping!.cigar = '40M0I1I100M'; }, /cigar must be a CIGAR of M, I and D runs/],
      ['not a string', (reads) => { reads[0].mapping!.cigar = 141; }, /cigar must be a CIGAR of M, I and D runs/],
      ['repeated run', (reads) => { reads[0].mapping!.cigar = '20M20M1I100M'; }, /must not repeat an operation/],
      ['count mismatch', (reads) => { reads[0].mapping!.cigar = '39M1I100M'; }, /must agree with the mapping's match, substitution, insertion and deletion counts/],
      ['moved insertion is fine but a dropped one is not', (reads) => { reads[0].mapping!.cigar = '140M'; }, /must agree with the mapping's/],
    ];
    for (const validator of await validators()) {
      for (const [label, change, message] of cases) {
        const broken = mutate(base(), change);
        const assets = validator.appendAsset(undefined, broken.asset);
        expect(() => validator.appendResult(assets, broken.result), `${validator.name}: ${label}`).toThrow(message);
      }
    }
    // A read the engine scored at low identity keeps a mapping but is not evidence.
    const low = run(REFERENCE, [
      { id: 'f', name: 'clone_F.ab1', baseCalls: FORWARD },
      { id: 'other', name: 'other.ab1', baseCalls: deterministicDna(200, 0x0bad) },
    ]);
    expect(low.result.reads[1].status).not.toBe('mapped');
    expect(low.result.reads[1].mapping).not.toBeNull();
    const onUnmapped = mutate(low.built, (reads) => { reads[1].mapping!.cigar = '200M'; });
    for (const validator of await validators()) {
      const assets = validator.appendAsset(undefined, onUnmapped.asset);
      expect(() => validator.appendResult(assets, onUnmapped.result), validator.name).toThrow(/cigar may only be present on a mapped read/);
    }
  });
});

describe('a saved report opens the traces the live table opens', () => {
  it('rebuilds each read’s column map exactly, through a substitution, an insertion, a deletion and a reverse read', () => {
    const { result, built, records } = run(REFERENCE, [
      { id: 'f', name: 'clone_F.ab1', baseCalls: FORWARD },
      { id: 'r', name: 'clone_R.ab1', baseCalls: REVERSE },
    ]);
    expect(result.variants.observed.map((variant) => [variant.type, variant.referenceStart])).toEqual([
      ['insertion', 100],
      ['substitution', 150],
      ['deletion', DELETED],
    ]);
    const saved = roundTrip(result, built, records);
    expect(saved.result.reads.map((read) => read.mapping?.coordinateMap.columns))
      .toEqual(result.reads.map((read) => read.mapping?.coordinateMap.columns));
    expect(saved.unavailableReads).toEqual([]);
  });

  it('keeps the ends trimmed for low quality beside the mapped part', () => {
    const read = WITH_SNP.slice(60, 200);
    const qualityScores = read.split('').map((_, index) => (index < 12 || index > 130 ? 4 : 40));
    const { result, built, records } = run(REFERENCE, [{ id: 'f', name: 'clone_F.ab1', baseCalls: read, qualityScores }]);
    expect(result.reads[0].trim.removedFromStart).toBeGreaterThan(0);
    expect(result.reads[0].trim.removedFromEnd).toBeGreaterThan(0);
    const saved = roundTrip(result, built, records);
    expect(saved.result.reads[0].mapping?.coordinateMap.columns).toEqual(result.reads[0].mapping?.coordinateMap.columns);
  });

  it('places a read across a circular origin', () => {
    const circular = deterministicDna(300, 0xc1c1);
    const mutated = `${circular.slice(0, 20)}${swapBase(circular[20])}${circular.slice(21)}`;
    const { result, built, records } = run(circular, [
      { id: 'f', name: 'origin_F.ab1', baseCalls: `${mutated.slice(250)}${mutated.slice(0, 70)}` },
      { id: 'r', name: 'origin_R.ab1', baseCalls: reverseComplement(`${mutated.slice(270)}${mutated.slice(0, 40)}`) },
    ], 'circular');
    expect(result.reads.map((read) => read.mapping?.wraps)).toEqual([true, true]);
    const saved = roundTrip(result, built, records);
    expect(saved.result.reads.map((read) => read.mapping?.coordinateMap.columns))
      .toEqual(result.reads.map((read) => read.mapping?.coordinateMap.columns));
  });
});

describe('what a saved report says when its records are not the run’s', () => {
  const both = () => run(REFERENCE, [
    { id: 'f', name: 'clone_F.ab1', baseCalls: FORWARD },
    { id: 'r', name: 'clone_R.ab1', baseCalls: REVERSE },
  ]);

  it('leaves out a read that was edited or removed, by name, and lays the rest out', () => {
    const { result, built, records } = both();
    const edited = records.map((record) => (record.id === 'r'
      ? { ...record, sangerTrace: { baseCalls: `${REVERSE.slice(0, 5)}${swapBase(REVERSE[5])}${REVERSE.slice(6)}` } }
      : record));
    const editedSaved = constructVerificationSavedTraces(built.asset.content, edited);
    expect(editedSaved.status).toBe('ready');
    if (editedSaved.status !== 'ready') return;
    expect(editedSaved.unavailableReads).toEqual([{ id: 'r', name: 'clone_R.ab1', gap: 'edited' }]);
    expect(editedSaved.result.reads.map((read) => read.id)).toEqual(['f']);
    // The deletion only the reverse read covers: the saved row cannot open, and says which read it lost.
    const deletion = result.variants.observed.find((variant) => variant.type === 'deletion')!;
    expect(constructVariantTraceReadIds(editedSaved.result, deletion)).toEqual([]);
    expect(constructVariantTraceReadIds(editedSaved.unavailable, deletion)).toEqual(['r']);
    const substitution = result.variants.observed.find((variant) => variant.type === 'substitution')!;
    expect(constructVariantTraceReadIds(editedSaved.result, substitution)).toEqual(['f']);

    const removed = constructVerificationSavedTraces(built.asset.content, records.filter((record) => record.id !== 'r'));
    expect(removed.status === 'ready' && removed.unavailableReads).toEqual([{ id: 'r', name: 'clone_R.ab1', gap: 'missing' }]);
  });

  it('calls a read edited, not missing, when its edit dropped the trace but the record is still here', () => {
    // Typing over a read's bases unlinks its chromatogram: the record stays in
    // the workspace with no sangerTrace. It was reported as "not in this workspace".
    const { built, records } = both();
    const untraced = records.map((record) => (record.id === 'r' ? { ...record, sangerTrace: undefined } : record));
    const saved = constructVerificationSavedTraces(built.asset.content, untraced);
    expect(saved.status === 'ready' && saved.unavailableReads).toEqual([{ id: 'r', name: 'clone_R.ab1', gap: 'edited' }]);
    const untouched = constructVerificationSavedTraces(built.asset.content, records);
    expect(untouched.status === 'ready' && untouched.unavailableReads).toEqual([]);
  });

  it('opens nothing when the reference was edited or removed, and says which', () => {
    const { result, built, records } = both();
    const editedReference = records.map((record) => (record.id === 'ref'
      ? { ...record, sequence: `${REFERENCE.slice(0, 10)}${swapBase(REFERENCE[10])}${REFERENCE.slice(11)}` }
      : record));
    const edited = constructVerificationSavedTraces(built.asset.content, editedReference);
    expect(edited.status === 'no_reference' && edited.gap).toBe('edited');
    if (edited.status !== 'no_reference') return;
    expect(result.variants.observed.map((variant) => constructVariantTraceReadIds(edited.unavailable, variant).length > 0))
      .toEqual([true, true, true]);
    const removed = constructVerificationSavedTraces(built.asset.content, records.filter((record) => record.id !== 'ref'));
    expect(removed.status === 'no_reference' && removed.gap).toBe('missing');
  });

  it('keeps a report saved before the CIGAR as it was: no read map, so nothing to open', () => {
    const { built, records } = both();
    const parsed = report(built);
    parsed.reads.forEach((read) => { delete read.mapping?.cigar; });
    expect(constructVerificationSavedTraces(JSON.stringify(parsed), records)).toEqual({ status: 'no_read_map' });
    expect(constructVerificationSavedTraces('not json', records)).toEqual({ status: 'no_read_map' });
  });
});
