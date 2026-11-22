import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const here = dirname(fileURLToPath(import.meta.url));
const artifactSource = readFileSync(resolve(here, '..', 'motif-artifact.tsx'), 'utf8');
const artifactCss = readFileSync(resolve(here, '..', 'motif-artifact.css'), 'utf8');
const findSource = readFileSync(resolve(here, '..', 'claude-science-find.ts'), 'utf8');
const toolbarSource = readFileSync(resolve(here, '..', '..', 'components', 'plasmid-map', 'MapViewToolbar.tsx'), 'utf8');

function sliceBetween(source: string, startNeedle: string, endNeedle: string): string {
  const start = source.indexOf(startNeedle);
  expect(start, `missing source marker: ${startNeedle}`).toBeGreaterThanOrEqual(0);
  const end = source.indexOf(endNeedle, start);
  expect(end, `missing end marker after ${startNeedle}: ${endNeedle}`).toBeGreaterThan(start);
  return source.slice(start, end);
}

describe('Claude Science map workspace regression guards', () => {
  it('keeps motif, guide, and digest coordinates correct across a circular origin', () => {
    expect(artifactSource).toContain('findSequenceMatches(sequence, searchMotif, sequenceType, topology)');
    expect(findSource).toContain("topology: Topology = 'linear',");
    expect(findSource).toContain('sequence + sequence.slice(0, Math.max(0, length - 1))');
    expect(artifactSource).toContain('motifHitContext(sequence, hit, cleanedMotifLength, 10, topology)');
    expect(artifactSource).toContain('forward: motifRectsByLine(forward, findLength, sequence.length, topology, basesPerLine),');
    expect(artifactSource).toContain('reverse: motifRectsByLine(reverse, findLength, sequence.length, topology, basesPerLine),');
    expect(artifactSource).toContain('const findCurrentRanges = findCurrent ? normalizeSpan(findCurrent.start, findCurrent.end, sequence.length, topology) : [];');
    expect(artifactSource).toContain('Math.max(0, sortedHits[sortedHits.length - 1] + motifLength - sequenceLength)');
    expect(artifactSource).toContain('function collectCircularGuidesOnStrand(');
    expect(artifactSource).toContain("if (nuclease.targetsRna && sequenceType !== 'rna') return [];");
    expect(artifactSource).toContain("return findGuides(scopedSequence, sequenceType, nuclease, 'linear').map((guide) => {");
    expect(artifactSource).toContain('function digestFragmentRangeLabel(fragment: DigestFragment, sequenceLength: number)');
    expect(artifactSource).toContain('`${start}-${sequenceLength} / 1-${wrappedEnd} (wrap)`');
  });

  it('toggles from the displayed restriction-label state', () => {
    expect(artifactSource).toMatch(
      /const toggleRestrictionLabels = useCallback\(\(\) => \{[\s\S]*?\[recordId\]: !showRestrictionLabels,[\s\S]*?\}, \[recordId, showRestrictionLabels\]\);/,
    );
  });

  it('shares restriction controls between Map Visibility and the Tools rail', () => {
    expect(artifactSource).toContain('const renderRestrictionSiteControls = (includeMapSummary = false): ReactNode => {');
    expect(artifactSource).toContain('{isDnaRecord ? renderRestrictionSiteControls(true) : null}');
    expect(artifactSource).toContain('data-rail-tool="restriction-sites"');
    expect(artifactSource).toContain('{renderRestrictionSiteControls(false)}');
    expect(artifactSource).toContain('requestSequenceFocus();\n    setLockedTranslateTarget(null);');
  });

  it('defaults restriction labels on instead of pre-judging them by site count', () => {
    // A site-count threshold here switched labelling off wholesale on any record
    // past it, which on the bundled vectors meant 8 of 13 drew every tick and
    // named none. Site count is the wrong quantity — labels are per CLUSTER, and
    // the layout engine already caps candidates (maxRestrictionLabels), culls by
    // geometry, and reports the remainder through the "+N more sites" chip. Only
    // the per-record user override may decide this.
    expect(artifactSource).toContain(
      'const showRestrictionLabels = restrictionLabelsByRecord[recordId] ?? true;',
    );
    expect(artifactSource).not.toMatch(/visibleRestrictionSites\.length\s*<=/);
  });

  it('reveals an explicitly added enzyme without enabling a source group', () => {
    const addCustomEnzyme = sliceBetween(
      artifactSource,
      'const addCustomEnzyme = useCallback',
      'const setEnzymeSourceEnabled = useCallback',
    );

    expect(addCustomEnzyme).toContain('hidden.delete(enzyme.name)');
    expect(addCustomEnzyme).toContain('}, [recordId]);');
    expect(addCustomEnzyme).not.toContain('setEnzymeSourcesByRecord');
  });

  it('keeps map controls in the pane heading and the circular readout on a reachable edge', () => {
    // The compact control group belongs inside the pane heading. Its position
    // therefore cannot change when the canvas switches between the tall
    // circular and short linear layouts.
    const base = sliceBetween(artifactCss, '.motif-cs-map-hint {', '}');
    const toolbar = sliceBetween(artifactCss, '.motif-cs-map-toolbar {', '}');
    expect(toolbar).toMatch(/flex:\s*0 0 auto/);
    expect(toolbar).toMatch(/min-height:\s*28px/);
    expect(toolbar).not.toMatch(/position:\s*absolute/);
    expect(toolbar).not.toMatch(/\btop:/);
    expect(toolbar).not.toMatch(/\bbottom:/);
    // The group renders from MapViewToolbar; the heading places that component.
    expect(toolbarSource).toContain('className="motif-cs-map-toolbar"');
    const toolbarIndex = artifactSource.indexOf('<MapViewToolbar');
    const frameIndex = artifactSource.indexOf('ref={mapFrameRef}');
    expect(toolbarIndex).toBeGreaterThanOrEqual(0);
    expect(frameIndex).toBeGreaterThan(toolbarIndex);
    expect(base).toMatch(/bottom:\s*12px/);

    // Between 768px and 1535px the circular map frame can extend below its
    // column's visible edge, so keep the transient readout on the reachable top
    // edge. This has no relationship to toolbar placement.
    const circular = sliceBetween(
      artifactCss,
      '.motif-cs-map-frame[data-map-mode="circular"] .motif-cs-map-hint {',
      '}',
    );
    expect(circular).toMatch(/top:\s*12px/);
    // Clearing `bottom` is what actually moves it: the base rule's `bottom: 12px`
    // would otherwise combine with a `top` and stretch the element across the
    // whole frame rather than relocating it.
    expect(circular).toMatch(/bottom:\s*auto/);

    // Scope. The rule must not reach 1536px and up, where the column does fit its
    // frame and the lower-left corner is reachable, or the linear map.
    const scoped = sliceBetween(
      artifactCss,
      '@media (min-width: 768px) and (max-width: 1535px) {\n  .motif-cs-map-frame[data-map-mode="circular"] .motif-cs-map-hint {',
      '}',
    );
    expect(scoped, 'the circular readout override escaped its breakpoint band').toMatch(/top:\s*12px/);
    const linear = sliceBetween(
      artifactCss,
      '.motif-cs-map-frame[data-map-mode="linear"] .motif-cs-map-hint {',
      '}',
    );
    expect(linear, 'the linear readout must keep its own corner').toMatch(/right:\s*12px/);
    expect(linear).not.toMatch(/top:\s*12px/);
  });

  it('sizes the linear map frame to its drawing instead of the drawing to its frame', () => {
    // A linear viewBox is as wide as its pane, so `meet` pins the scale at 1 and
    // every pixel of frame past the drawing is padding. Measured on pUC19, the
    // frame stood 67.3% empty at 1600x1100 and 75.2% at 2000x1400, which left
    // the map's own visibility and digest controls 633.5 and 933.7px below the
    // map they belong to. The three declarations below are what closed that to
    // 49px, and they only work together.
    const linearFrame = sliceBetween(
      artifactCss,
      '.motif-cs-map-frame[data-map-mode="linear"] {',
      '}',
    );
    expect(linearFrame).toMatch(/flex:\s*none;/);
    expect(linearFrame).toMatch(/height:\s*auto;/);
    // `flex: none` is the load-bearing half. As a `flex: 1 1 0` item the frame is
    // grown from a zero basis and any height declared on it is inert — which is
    // how the clamp this rule replaced came to have no effect above 640px.
    expect(linearFrame).not.toMatch(/flex:\s*1\s/);

    const linearSvg = sliceBetween(
      artifactCss,
      '.motif-cs-map-frame[data-map-mode="linear"] .motif-pm-container,',
      '}',
    );
    expect(linearSvg).toContain('.motif-cs-map-frame[data-map-mode="linear"] .motif-plasmid-map');
    expect(linearSvg).toMatch(/height:\s*auto;/);

    // And the layout must not read back the height the frame takes from it.
    // Simulated over the ResizeObserver's own update rule at a 560px pane with 22
    // features and 65 sites, the pair would collapse 435.6 -> 338.3 -> 262.9 -> 200.7px
    // across four passes, hiding a lane on each one, because a scaled-down
    // drawing always measures shorter than the layout that produced it.
    expect(artifactSource).toContain(
      "height: mapRenderMode === 'linear' ? LINEAR_MAP_DEPTH_BUDGET : mapSize.height,",
    );
    expect(artifactSource).not.toMatch(/^ {6}height: mapSize\.height,$/m);
  });

  it('pins the map dock heads as a column footer, open or closed', () => {
    // These two heads are the end of the map workflow and sat below the column's visible
    // edge at every desktop size under 1536 — 138px at 900x700 down to 85px at 1440x1200.
    // The app's first sticky FOOTER; the ten that already exist are headers at `top: 0`.
    const marker = artifactCss.indexOf('Open or closed alike: an open body floats instead of joining the flow');
    expect(marker, 'missing the sticky dock footer comment').toBeGreaterThanOrEqual(0);
    const footer = sliceBetween(artifactCss.slice(marker), '.motif-cs-map-dock-strip {', '}');
    expect(footer).toMatch(/position:\s*sticky/);
    expect(footer).toMatch(/bottom:\s*-10px/);
    // Opaque, or the map scrolls through the footer that is meant to end it.
    expect(footer, 'a transparent sticky footer lets the map show through').toMatch(/background:\s*var\(--bg-primary\)/);
    expect(footer).toMatch(/z-index:/);

    // An open body floats, so the strip keeps its size and stays sticky; un-sticking
    // it on open would move the head just pressed. Open only lifts it.
    const openState = sliceBetween(artifactCss, '.motif-cs-map-dock-strip:has(> details[open]) {', '}');
    expect(openState, 'the open dock strip must keep the footer position').not.toMatch(/position:/);
    expect(openState).toMatch(/z-index:\s*7/);

    // No breakpoint, deliberately: `bottom` engages only while an ancestor scrolls, so
    // 1920 — where the column hides 0px — needs no exemption and must not be given one.
    const stickyIndex = marker + artifactCss.slice(marker).indexOf('.motif-cs-map-dock-strip {');
    const enclosingMedia = artifactCss.lastIndexOf('@media', stickyIndex);
    const enclosingClose = artifactCss.lastIndexOf('\n}', stickyIndex);
    expect(
      enclosingClose > enclosingMedia,
      'the dock footer was wrapped in a media query; it should engage from overflow alone',
    ).toBe(true);
  });
});
