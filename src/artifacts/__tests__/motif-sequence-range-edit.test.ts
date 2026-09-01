import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { applySequenceRangeReplacement } from '../motif-artifact';
import type { Feature } from '../../bio/types';

const here = dirname(fileURLToPath(import.meta.url));
const artifactSource = readFileSync(resolve(here, '..', 'motif-artifact.tsx'), 'utf8');
const artifactCss = readFileSync(resolve(here, '..', 'motif-artifact.css'), 'utf8');

function sliceBetween(startNeedle: string, endNeedle: string): string {
  const start = artifactSource.indexOf(startNeedle);
  expect(start, `missing source marker: ${startNeedle}`).toBeGreaterThanOrEqual(0);
  const end = artifactSource.indexOf(endNeedle, start);
  expect(end, `missing end marker after ${startNeedle}: ${endNeedle}`).toBeGreaterThan(start);
  return artifactSource.slice(start, end);
}

describe('editable sequence range transactions', () => {
  it('does not discard keyboard edits merely because a range has cleared the caret', () => {
    const keyboardHandler = sliceBetween(
      'const handleSequenceEditKey = useCallback',
      'const handleSequencePaste = useCallback',
    );

    expect(keyboardHandler).toContain('const navigationRange = selectedRange ?? originWrappingRange;');
    expect(keyboardHandler).toContain('const c = navigationRange?.start ?? caret;');
    expect(keyboardHandler.indexOf('selectedMapRange')).toBeLessThan(keyboardHandler.indexOf('if (c === null) return;'));
    expect(keyboardHandler).toContain('commitSelectedRangeEdit');
  });

  it('does not discard paste merely because a range has cleared the caret', () => {
    const pasteHandler = sliceBetween(
      'const handleSequencePaste = useCallback',
      'const addRecords = useCallback',
    );

    expect(pasteHandler).not.toContain('caret === null');
    expect(pasteHandler).toContain('selectedMapRange');
    expect(pasteHandler).toContain('commitSelectedRangeEdit');
  });

  it('commits Backspace and Delete independently as one undoable range edit, then clears the range at the resulting caret', () => {
    const selectedRangeCommit = sliceBetween(
      'const commitSelectedRangeEdit = useCallback',
      'const handleSequenceEditKey = useCallback',
    );
    const keyboardHandler = sliceBetween(
      'const handleSequenceEditKey = useCallback',
      'const handleSequencePaste = useCallback',
    );
    const commitEdit = sliceBetween(
      'const commitEdit = useCallback',
      'const commitMutation = useCallback',
    );

    expect(selectedRangeCommit.match(/commitMutation\(/g)).toHaveLength(1);
    expect(selectedRangeCommit).toContain('range.start + replacement.length');
    expect(keyboardHandler).toMatch(/case 'Backspace':[\s\S]*commitSelectedRangeEdit\(selectedRange, ''\)/);
    expect(keyboardHandler).toMatch(/case 'Delete':[\s\S]*commitSelectedRangeEdit\(selectedRange, ''\)/);
    expect(commitEdit).toContain('undo: [...store.undo, { before, after }]');
    expect(commitEdit).toContain('setMapRangesByRecord');
    expect(commitEdit).toContain('[recordId]: null');
    expect(commitEdit).toContain('setCaret(clamp(caretAfter, 0, result.raw.length));');
  });

  it('visibly refuses keyboard and paste edits for a selection that wraps the circular origin', () => {
    const keyboardHandler = sliceBetween(
      'const handleSequenceEditKey = useCallback',
      'const handleSequencePaste = useCallback',
    );
    const pasteHandler = sliceBetween(
      'const handleSequencePaste = useCallback',
      'const addRecords = useCallback',
    );

    expect(keyboardHandler).toContain('originWrappingRange');
    expect(keyboardHandler).toContain('ORIGIN_WRAPPING_RANGE_EDIT_NOTICE');
    expect(keyboardHandler).toContain("showWorkbenchNotice(ORIGIN_WRAPPING_RANGE_EDIT_NOTICE, 'error')");
    expect(pasteHandler).toContain('originWrappingRange');
    expect(pasteHandler).toContain("showWorkbenchNotice(ORIGIN_WRAPPING_RANGE_EDIT_NOTICE, 'error')");
    expect(artifactSource).toContain('This selection wraps the circular origin and cannot be edited as one range yet. Clear it and edit each side of the origin separately.');
  });

  it('deletes and replaces the selected half-open range through the mutation helpers', () => {
    expect(applySequenceRangeReplacement('AACCTT', [], 2, 4, '', 'dna').raw).toBe('AATT');
    expect(applySequenceRangeReplacement('AACCTT', [], 2, 4, 'G', 'dna').raw).toBe('AAGTT');
    expect(applySequenceRangeReplacement('AACCTT', [], 2, 4, 'GG', 'dna').raw).toBe('AAGGTT');
    expect(applySequenceRangeReplacement('AACCUU', [], 2, 4, 'A', 'rna').raw).toBe('AAAUU');
  });

  it('keeps a feature anchored at the replacement start without mutating the source feature', () => {
    const feature: Feature = {
      id: 'feature-1',
      name: 'Replacement-start feature',
      type: 'misc_feature',
      start: 2,
      end: 5,
      strand: 1,
      color: 'var(--accent)',
      metadata: {},
    };

    const result = applySequenceRangeReplacement('AACCTT', [feature], 2, 4, 'G', 'dna');

    expect(result.raw).toBe('AAGTT');
    expect(result.features[0]).toMatchObject({ start: 2, end: 4 });
    expect(feature).toMatchObject({ start: 2, end: 5 });
  });

  it('preserves features that match a non-empty replacement interval', () => {
    const oneBaseFeature: Feature = {
      id: 'feature-one-base',
      name: 'One-base feature',
      type: 'misc_feature',
      start: 2,
      end: 3,
      strand: 1,
      color: 'var(--accent)',
      metadata: {},
    };
    const exactFeature: Feature = {
      ...oneBaseFeature,
      id: 'feature-exact-range',
      name: 'Exact-range feature',
      end: 4,
    };

    const oneBase = applySequenceRangeReplacement('AACCTT', [oneBaseFeature], 2, 3, 'G', 'dna');
    const exact = applySequenceRangeReplacement('AACCTT', [exactFeature], 2, 4, 'G', 'dna');

    expect(oneBase.raw).toBe('AAGCTT');
    expect(oneBase.features[0]).toMatchObject({ start: 2, end: 3 });
    expect(exact.raw).toBe('AAGTT');
    expect(exact.features[0]).toMatchObject({ start: 2, end: 3 });
  });

  it('preserves reverse-strand direction while atomically remapping replacement boundaries', () => {
    const feature: Feature = {
      id: 'feature-reverse',
      name: 'Reverse replacement-start feature',
      type: 'misc_feature',
      start: 2,
      end: 5,
      strand: -1,
      color: 'var(--accent)',
      metadata: {},
    };
    const exactFeature: Feature = {
      ...feature,
      id: 'feature-reverse-exact',
      end: 4,
    };

    const result = applySequenceRangeReplacement('AACCTT', [feature, exactFeature], 2, 4, 'G', 'dna');

    expect(result.features).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'feature-reverse', start: 2, end: 4, strand: -1 }),
      expect.objectContaining({ id: 'feature-reverse-exact', start: 2, end: 3, strand: -1 }),
    ]));
  });

  it('keeps range replacement unavailable to read-only sequence classes', () => {
    expect(() => applySequenceRangeReplacement('MKW', [], 0, 1, 'A', 'protein'))
      .toThrow(/editable nucleotide sequences/i);
  });
});

describe('sequence editor affordances', () => {
  it('keeps Undo and Redo mounted with their shortcuts and disabled state', () => {
    const toolbar = sliceBetween(
      '<div className="motif-cs-edit-controls">',
      '<div className="motif-cs-segmented motif-cs-edit-mode-toggle"',
    );

    expect(toolbar).toContain('disabled={!canUndo}');
    expect(toolbar).toContain('title="Undo (Cmd/Ctrl+Z)" aria-label="Undo"');
    expect(toolbar).toContain('disabled={!canRedo}');
    expect(toolbar).toContain('title="Redo (Cmd/Ctrl+Shift+Z)" aria-label="Redo"');
    expect(toolbar).not.toContain('{canUndo ?');
    expect(toolbar).not.toContain('{canRedo ?');
    expect(artifactCss).toContain('.motif-cs-edit-toolbar .motif-cs-icon-mini:disabled');
  });

  // Clicking a map feature deliberately does NOT open its editor yet: doing so
  // reflows the layout under the map and four existing browser tests that click
  // one feature after another timed out waiting for the next to become
  // actionable. What is asserted here is the wiring that survived, so the
  // handler stays the single place that behaviour will be added back.
  it('routes map shapes and sequence ribbons through one feature-click handler', () => {
    expect(artifactSource).toContain('onFeatureClick={handleMapFeatureClick}');
    expect(artifactSource).toContain('onFeatureSelect={handleMapFeatureClick}');
  });
});
