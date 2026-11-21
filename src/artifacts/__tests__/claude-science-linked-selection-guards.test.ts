import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { selectedRangeReadout } from '../motif-artifact';

const here = dirname(fileURLToPath(import.meta.url));
const artifactSource = readFileSync(resolve(here, '..', 'motif-artifact.tsx'), 'utf8');

function between(source: string, start: string, end: string): string {
  const from = source.indexOf(start);
  expect(from, `missing ${start}`).toBeGreaterThanOrEqual(0);
  const to = source.indexOf(end, from + start.length);
  expect(to, `missing ${end}`).toBeGreaterThan(from);
  return source.slice(from, to);
}

describe('a new selection replaces every other kind of selection', () => {
  // Each entry point that selects something must also drop the caret, the
  // selected object and the selected range, or the sequence keeps blinking a
  // caret from an earlier click beside the new selection.
  const entryPoints: [string, string, string][] = [
    ['a map drag or a ring click', 'const beginMapRangeSelection = useCallback(', '}, [layout.mode, recordId, sequence.length]);'],
    ['a feature', 'const handleFeatureClick = useCallback(', '}, [inlineTranslationTracks, recordId]);'],
    ['a restriction site', 'const handleRestrictionClick = useCallback(', '}, [recordId, requestSequenceFocus]);'],
    ['a range from a list, a digest fragment, a find match or a gel band', 'const selectSequenceRange = useLatestCallback(', '\n  });'],
    ['a residue', 'const selectTranslationCodon = useCallback(', '}, [recordId, sequence.length, topology, translateStrand]);'],
  ];

  it.each(entryPoints)('%s drops the caret', (_name, start, end) => {
    const body = between(artifactSource, start, end);
    expect(body).toContain('setCaret(null);');
    expect(body).toMatch(/setSelection\((null|\{ kind: '(feature|restriction)')/);
    expect(body).toContain('setMapRangesByRecord(');
  });
});

describe('a record switch is view state', () => {
  it('remembers the selection in a ref, never in the payload or the durable artifact state', () => {
    const remember = between(artifactSource, 'const rememberRecordSelection = useCallback(', '}, []);');
    expect(remember).toContain('rememberedSelectionsRef.current[active.recordId] = {');
    expect(remember).not.toMatch(/setPayload|artifactStateRef\.current =|payloadRef\.current =/);
    const recall = between(artifactSource, 'const recallRecordSelection = useCallback(', '}, []);');
    expect(recall).not.toMatch(/setPayload|artifactStateRef\.current =|payloadRef\.current =/);
  });

  it('forgets every remembered selection when the workspace is replaced', () => {
    const reset = between(artifactSource, 'const resetWorkspaceViewState = useCallback(', '}, []);');
    expect(reset).toContain('rememberedSelectionsRef.current = createRecordMap();');
    expect(reset).toContain('selectionEpochRef.current += 1;');
  });
});

describe('double- and triple-click in the sequence', () => {
  const click = between(artifactSource, 'const handleBasesClick = useCallback(', '}, [features, onFeaturePick, selectLocalRange, sequence.length, topology]);');

  it('acts only on the base a plain click just placed, and never waits on a timer', () => {
    // A single click is handled on release; the double-click acts
    // from the click event that follows, so nothing delays the single click.
    expect(click).toContain('const base = lastClickBaseRef.current;');
    expect(click).toContain('if (base === null || event.detail < 2) return;');
    expect(click).not.toMatch(/setTimeout|requestAnimationFrame/);
    const release = between(artifactSource, 'const handleBasesPointerUp = useCallback(', 'const handleBasesClick = useCallback(');
    // A plain click on a base (caret or read-only) and one on a line's number.
    expect(release.match(/lastClickBaseRef\.current = anchor;/g)).toHaveLength(3);
    expect(release).toContain('lastClickBaseRef.current = null;');
  });

  it('selects the feature the way a click on its ribbon does, else the 10-base group; a triple-click selects the line', () => {
    expect(click).toContain('smallestFeatureAt(');
    expect(click).toContain('!isSourceFeature(candidate, sequence.length)');
    expect(click).toContain('suppressNextFocusScrollRef.current = true;\n          onFeaturePick(feature.id);');
    expect(click).toContain('decadeRangeAt(base, sequence.length)');
    expect(click).toContain('lineRangeAt(base, basesPerLineRef.current, sequence.length)');
    expect(click).toContain('window.getSelection()?.removeAllRanges();');
    expect(artifactSource).toContain('onClick={handleBasesClick}');
  });

  it('selects the feature without scrolling, since the clicked base is already under the pointer', () => {
    // onFeatureSelect is the map's handler: it requests a reveal of the
    // feature's first line. The double-click takes the same selection without it.
    expect(click).not.toContain('onFeatureSelect(');
    expect(artifactSource).toContain('onFeaturePick={handleFeatureClick}');
    const pick = between(artifactSource, 'const handleFeatureClick = useCallback(', '}, [inlineTranslationTracks, recordId]);');
    expect(pick).not.toContain('requestSequenceFocus');
  });
});

describe('amino acids picked for copy', () => {
  it('are dropped when another selection replaces the one their pick made', () => {
    const effect = between(artifactSource, 'const aaTrackPickRef = useRef<', '}, [aaCopyBufferIsSelected, focusKey, selectedAaTrackId]);');
    // The pick's own selection is taken on the first commit after the pick...
    expect(effect).toContain('aaTrackPickRef.current = { trackId: selectedAaTrackId, focusKey };');
    // ...and any later change of the selection clears the row and the copy buffer.
    expect(effect).toContain('if (aaTrackPickRef.current.focusKey === focusKey) return;');
    expect(effect).toContain("setSelectedAaTrackId(null);\n    setSelectedAaTrackText('');");
    expect(effect).toContain('window.getSelection()?.removeAllRanges();');
  });
});

describe('a primer picked in a primer list', () => {
  it('reads like a feature in both status lines: name, bases, length and strand', () => {
    expect(selectedRangeReadout({ start: 142, end: 162, primer: { label: 'Forward primer', strand: 1 } }, 2686, 'dna'))
      .toBe('Forward primer · 143–162 · 20 bp · + strand');
    expect(selectedRangeReadout({ start: 452, end: 473, primer: { label: 'Reverse primer', strand: -1 } }, 2686, 'dna'))
      .toBe('Reverse primer · 453–473 · 21 bp · − strand');
    expect(selectedRangeReadout({ start: 2680, end: 2700, primer: { label: 'Forward primer', strand: 1 } }, 2686, 'dna'))
      .toBe('Forward primer · 2,681–14 · 20 bp · across the origin · + strand');
    // Any other range reads as bases and length only.
    expect(selectedRangeReadout({ start: 142, end: 162 }, 2686, 'dna')).toBe('143–162 · 20 bp');
  });

  it('selects its site through the host, and the Notes panel never receives the primer', () => {
    const select = between(artifactSource, 'const selectPrimerSite = useCallback(', '}, [recordId, selectSequenceRangeAndReveal, sequence.length, topology]);');
    expect(select).toContain('primerSiteRange(site, sequence.length, topology)');
    expect(select).toContain('selectSequenceRangeAndReveal(range.start, range.end);');
    expect(select).toContain('primer: { label: site.label, strand: site.strand }');
    expect(artifactSource).toContain('onSelectPrimer={selectPrimerSite}');
    // A note saves the range it is given, so it gets the coordinates only.
    expect(artifactSource).toContain('? { start: selectedMapRange.start, end: selectedMapRange.end }');
    expect(artifactSource).not.toContain('? { ...selectedMapRange }');
  });
});
