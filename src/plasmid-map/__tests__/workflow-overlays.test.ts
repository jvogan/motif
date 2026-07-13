import { describe, expect, it } from 'vitest';

import type { DiffSegment } from '../../bio/sequence-diff';
import type { PCRResult } from '../../bio/pcr';
import { computeMapLayout } from '../layout';
import { projectRangeOverlays } from '../range-overlays';
import {
  compareDiffSegmentRangeOverlayInputs,
  compareOverlaySetToMapRangeInputs,
  digestFragmentRangeOverlayInputs,
  primerCandidateRangeOverlayInputs,
  pcrResultRangeOverlayInputs,
  workflowOverlayToMapRangeInput,
  workflowOverlaysToMapRangeInputs,
} from '../workflow-overlays';

function circularLayout() {
  return computeMapLayout({
    mode: 'circular',
    name: 'Workflow circle',
    length: 1000,
    topology: 'circular',
    sequenceType: 'dna',
    features: [],
    restrictionSites: [],
    width: 420,
    height: 420,
  });
}

function linearLayout() {
  return computeMapLayout({
    mode: 'linear',
    name: 'Workflow linear',
    length: 1000,
    topology: 'linear',
    sequenceType: 'dna',
    features: [],
    restrictionSites: [],
    width: 620,
    height: 260,
  });
}

describe('workflow overlay adapters', () => {
  it('maps structured workflow DTOs into the common map range overlay contract', () => {
    const digest = workflowOverlayToMapRangeInput({
      id: 'digest-frag-a',
      workflow: 'restriction_digest',
      role: 'fragment',
      label: 'EcoRI fragment',
      space: 'source',
      enzyme: 'EcoRI',
      ranges: [{ start: 980, end: 1020, topology: 'circular', sequenceLength: 1000, wrapsOrigin: true }],
    });
    const primer = workflowOverlayToMapRangeInput({
      id: 'primer-fwd-a',
      workflow: 'primer_design',
      role: 'primer_binding',
      label: 'Forward primer',
      space: 'source',
      primerDirection: 'forward',
      tm: 61,
      ranges: [{ start: 120, end: 142, topology: 'linear', sequenceLength: 1000 }],
    });
    const compare = workflowOverlayToMapRangeInput({
      id: 'compare-ins-a',
      workflow: 'sequence_compare',
      role: 'insertion',
      label: 'Inserted bases',
      space: 'source',
      ranges: [{ start: 25, end: 25, topology: 'linear', sequenceLength: 1000 }],
    });

    expect(digest).toMatchObject({
      id: 'digest:digest-frag-a',
      objectId: 'digest-frag-a',
      kind: 'digest',
      variant: 'fragment',
      color: '#7c3aed',
      ranges: [{ start: 980, end: 1020 }],
    });
    expect(primer).toMatchObject({
      id: 'design:primer-fwd-a',
      objectId: 'primer-fwd-a',
      kind: 'design',
      variant: 'primer-forward',
      color: '#15803d',
      ranges: [{ start: 120, end: 142 }],
    });
    expect(compare).toMatchObject({
      id: 'compare:compare-ins-a',
      objectId: 'compare-ins-a',
      kind: 'compare',
      variant: 'insertion',
      color: '#047857',
      ranges: [{ start: 25, end: 26 }],
    });

    expect(workflowOverlaysToMapRangeInputs([
      {
        id: 'bad',
        workflow: 'primer_design',
        role: 'amplicon',
        label: '',
        space: 'source',
        ranges: [{ start: 10, end: 20, topology: 'linear', sequenceLength: 1000 }],
      },
      {
        id: 'amplicon-a',
        workflow: 'pcr',
        role: 'amplicon',
        label: 'PCR amplicon',
        space: 'source',
        ranges: [{ start: 10, end: 20, topology: 'linear', sequenceLength: 1000 }],
      },
    ])).toHaveLength(1);
  });

  it('projects digest fragments on linear maps', () => {
    const layout = linearLayout();
    const inputs = digestFragmentRangeOverlayInputs([
      {
        startInOriginal: 100,
        endInOriginal: 420,
        length: 320,
        leftEnzyme: 'EcoRI',
        rightEnzyme: 'BamHI',
      },
    ], layout.length);

    expect(inputs).toMatchObject([{
      id: 'digest:fragment:0:100:420',
      objectId: 'digest:fragment:0:100:420',
      kind: 'digest',
      variant: 'fragment',
      label: 'Digest fragment 1 (EcoRI to BamHI, 320 bp)',
      color: '#7c3aed',
      ranges: [{ start: 100, end: 420 }],
    }]);

    const overlays = projectRangeOverlays(layout, inputs);
    expect(overlays).toHaveLength(1);
    expect(overlays[0].primaryRange).toEqual({ start: 100, end: 420 });
    expect(overlays[0].focusedRanges).toBeNull();
    expect(overlays[0].paths[0]).not.toMatch(/NaN|Infinity/);
  });

  it('splits circular origin-wrapping digest fragments without renderer math', () => {
    const layout = circularLayout();
    const inputs = digestFragmentRangeOverlayInputs([
      {
        startInOriginal: 980,
        endInOriginal: 1020,
        length: 40,
        leftEnzyme: 'BsaI',
        rightEnzyme: 'BbsI',
      },
    ], layout.length);

    expect(inputs[0].ranges).toEqual([{ start: 980, end: 1020 }]);

    const overlays = projectRangeOverlays(layout, inputs);
    expect(overlays).toHaveLength(1);
    expect(overlays[0].kind).toBe('digest');
    expect(overlays[0].paths).toHaveLength(2);
    expect(overlays[0].primaryRange).toEqual({ start: 980, end: 1000 });
    expect(overlays[0].focusedRanges).toEqual([
      { start: 980, end: 1000 },
      { start: 0, end: 20 },
    ]);
    expect(overlays[0].paths.join(' ')).not.toMatch(/NaN|Infinity/);
  });

  it('projects primer design candidates as strand-specific design overlays', () => {
    const layout = linearLayout();
    const inputs = primerCandidateRangeOverlayInputs([
      { direction: 'forward', start: 120, end: 142, length: 22, tm: 61.34 },
      { direction: 'reverse', start: 640, end: 663, length: 23, tm: 60.12 },
    ], layout.length);

    expect(inputs.map((input) => [input.kind, input.variant, input.ranges[0]])).toEqual([
      ['design', 'primer-forward', { start: 120, end: 142 }],
      ['design', 'primer-reverse', { start: 640, end: 663 }],
    ]);
    expect(inputs[0].label).toBe('Forward primer 22 nt (61.3 C)');
    expect(inputs[1].label).toBe('Reverse primer 23 nt (60.1 C)');

    const overlays = projectRangeOverlays(layout, inputs);
    expect(overlays).toHaveLength(2);
    expect(overlays.every((overlay) => overlay.paths.every((d) => !/(NaN|Infinity)/.test(d)))).toBe(true);
  });

  it('projects circular PCR amplicons across the origin', () => {
    const layout = circularLayout();
    const result = {
      productLength: 140,
      forward: {
        bindStart: 920,
        bindEnd: 942,
        bindingSequence: 'A'.repeat(22),
        tail: '',
        tm: 61,
        gcPercent: 50,
      },
      reverse: {
        bindStart: 38,
        bindEnd: 60,
        bindingSequence: 'T'.repeat(22),
        tail: '',
        tm: 60,
        gcPercent: 50,
      },
    } satisfies Pick<PCRResult, 'productLength' | 'forward' | 'reverse'>;

    const inputs = pcrResultRangeOverlayInputs(result, layout.length, 'circular');
    const amplicon = inputs.find((input) => input.variant === 'amplicon');
    expect(amplicon?.ranges).toEqual([{ start: 920, end: 1060 }]);

    const overlay = projectRangeOverlays(layout, amplicon ? [amplicon] : [])[0];
    expect(overlay.kind).toBe('design');
    expect(overlay.paths).toHaveLength(2);
    expect(overlay.primaryRange).toEqual({ start: 920, end: 1000 });
    expect(overlay.focusedRanges).toEqual([
      { start: 920, end: 1000 },
      { start: 0, end: 60 },
    ]);
  });

  it('projects compare diff segments and keeps insertions selectable as anchors', () => {
    const layout = linearLayout();
    const segments: DiffSegment[] = [
      { op: 'match', seq1Start: 0, seq2Start: 0, seq1Text: 'AAAA', seq2Text: 'AAAA', length: 4 },
      { op: 'mismatch', seq1Start: 4, seq2Start: 4, seq1Text: 'C', seq2Text: 'G', length: 1 },
      { op: 'insertion', seq1Start: 5, seq2Start: 5, seq1Text: '-', seq2Text: 'TT', length: 2 },
      { op: 'deletion', seq1Start: 5, seq2Start: 7, seq1Text: 'GG', seq2Text: '--', length: 2 },
    ];

    const inputs = compareDiffSegmentRangeOverlayInputs(segments, layout.length);
    expect(inputs.map((input) => [input.variant, input.ranges[0]])).toEqual([
      ['mismatch', { start: 4, end: 5 }],
      ['insertion', { start: 5, end: 6 }],
      ['deletion', { start: 5, end: 7 }],
    ]);

    const overlays = projectRangeOverlays(layout, inputs);
    expect(overlays.map((overlay) => overlay.kind)).toEqual(['compare', 'compare', 'compare']);
    expect(overlays.every((overlay) => overlay.paths.every((d) => !/(NaN|Infinity)/.test(d)))).toBe(true);
  });

  it('converts compare overlay sets without promoting diffs to saved variants', () => {
    const inputs = compareOverlaySetToMapRangeInputs({
      schemaVersion: 1,
      id: 'compare-a',
      engine: 'motif-sequence-diff',
      algorithm: 'needleman-wunsch',
      reference: { blockId: 'ref', name: 'Reference', type: 'dna', length: 1000 },
      query: { blockId: 'query', name: 'Query', type: 'dna', length: 1000 },
      projectionBlockId: 'ref',
      projectionRole: 'reference',
      summary: {
        identity: 99.1,
        mismatches: 1,
        insertions: 1,
        deletions: 0,
        alignedLength: 1002,
        segmentCount: 2,
      },
      items: [
        {
          id: 'cmp-0',
          segmentIndex: 0,
          op: 'mismatch',
          alignmentStart: 10,
          alignmentEnd: 11,
          referenceRange: { start: 10, end: 11 },
          queryRange: { start: 10, end: 11 },
          referenceAnchor: 10,
          queryAnchor: 10,
          referenceText: 'A',
          queryText: 'G',
          projection: {
            blockId: 'ref',
            role: 'reference',
            ranges: [{ start: 10, end: 11 }],
            anchorOnly: false,
            primaryRange: { start: 10, end: 11 },
            focusedRanges: null,
          },
          label: 'A/G mismatch',
        },
        {
          id: 'cmp-1',
          segmentIndex: 1,
          op: 'insertion',
          alignmentStart: 25,
          alignmentEnd: 27,
          referenceRange: null,
          queryRange: { start: 25, end: 27 },
          referenceAnchor: 25,
          queryAnchor: 25,
          referenceText: '-',
          queryText: 'TT',
          projection: {
            blockId: 'ref',
            role: 'reference',
            ranges: [{ start: 25, end: 26 }],
            anchorOnly: true,
            primaryRange: { start: 25, end: 26 },
            focusedRanges: null,
          },
          label: 'TT insertion',
        },
      ],
    });

    expect(inputs.map((input) => [input.kind, input.variant, input.id, input.ranges[0]])).toEqual([
      ['compare', 'mismatch', 'compare:cmp-0', { start: 10, end: 11 }],
      ['compare', 'insertion', 'compare:cmp-1', { start: 25, end: 26 }],
    ]);
  });
});
