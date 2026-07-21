import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const here = dirname(fileURLToPath(import.meta.url));
const artifactSource = readFileSync(resolve(here, '..', 'motif-artifact.tsx'), 'utf8');

function sliceBetween(source: string, startNeedle: string, endNeedle: string): string {
  const start = source.indexOf(startNeedle);
  expect(start, `missing source marker: ${startNeedle}`).toBeGreaterThanOrEqual(0);
  const end = source.indexOf(endNeedle, start);
  expect(end, `missing end marker after ${startNeedle}: ${endNeedle}`).toBeGreaterThan(start);
  return source.slice(start, end);
}

describe('Claude Science record lifecycle guards', () => {
  it('clears view state while preserving durable state during records-only replacement', () => {
    const resetViewState = sliceBetween(
      artifactSource,
      'const resetWorkspaceViewState = useCallback',
      'const resetRecordTransientState = useCallback',
    );
    const resetAllRecordState = sliceBetween(
      artifactSource,
      'const resetRecordTransientState = useCallback',
      'const resetWorkflowWindowState = useCallback',
    );
    const renderInventory = sliceBetween(
      artifactSource,
      'window.motifRenderInventory = (entriesOrPayload) => {',
      '// Append helper',
    );

    expect(resetViewState).toContain('setMapRangesByRecord({});');
    expect(resetViewState).toContain('setMapViewportsByRecord({});');
    expect(resetViewState).toContain('sequenceScrollByRecordRef.current = {};');
    expect(resetViewState).toContain('editHistoryRef.current = {};');
    expect(resetViewState).not.toContain('setTranslationLayersByRecord({});');
    expect(resetViewState).not.toContain('setHiddenFeatureTranslationsByRecord({});');
    expect(resetAllRecordState).toContain('setTranslationLayersByRecord({});');
    expect(resetAllRecordState).toContain('setHiddenFeatureTranslationsByRecord({});');
    expect(renderInventory).toContain('resetWorkspaceViewState();');
    expect(renderInventory).not.toContain('resetRecordTransientState();');
  });

  it('stores topology on the record so the UI, API, and exports agree', () => {
    // Renamed from toggleTopology when #34 moved conversion out of the map
    // panel: it now takes a target rather than flipping, because the two
    // Entry Details buttons name the state they set. The invariant this guard
    // exists for is unchanged — topology lives on the record, one copy.
    const convertTopology = sliceBetween(
      artifactSource,
      'const convertRecordTopology = useCallback',
      'const addCustomEnzyme = useCallback',
    );

    expect(artifactSource).toContain('const topology = vector.topology;');
    expect(artifactSource).not.toContain('topologyOverrides');
    expect(convertTopology).toContain('(nextTopology: Topology)');
    expect(convertTopology).toContain('record.id === recordId ? { ...record, topology: nextTopology } : record');
    expect(convertTopology).toContain('payloadRef.current = nextPayload;');
  });

  it('lets the map be drawn as a line without converting the molecule', () => {
    // #34. The map's shape control used to call the conversion above, so asking
    // for a different picture rewrote the record. The drawing is now its own
    // state.
    //
    // The size of the science it moved, measured against findRestrictionSites
    // rather than counted off the SVG: pUC19 yields 325 sites circular and 324
    // linear, the lost one being BtgZI at 2576, which straddles the origin. The
    // drawn tick count changes by far more than that between the two modes (76
    // against 49), but almost all of it is the two layouts drawing the same
    // sites differently — circular clusters them, linear draws all of them with
    // a density track and a "+N more sites" chip — so the tick count is the
    // wrong instrument for a claim about the data.
    //
    // This is NOT the banned per-view topology override. That was shadow state
    // that could make the map and an export disagree about the molecule; this
    // decides a DRAWING and never reaches the record, which is why the ban
    // above still stands and must keep standing.
    expect(artifactSource).toContain('const [mapRenderModeByRecord, setMapRenderModeByRecord] = useState<Record<string, MapMode>>({});');

    // The seam: computeMapLayout takes the render mode, not a mode derived from
    // topology on the spot. `topology` still travels into the layout so feature
    // segmentation stays true to the molecule.
    const layoutCall = sliceBetween(artifactSource, '() => computeMapLayout({', 'useEffect(');
    expect(layoutCall).toContain('mode: mapRenderMode,');
    expect(layoutCall).toContain('topology,');
    expect(layoutCall).not.toContain('mode: mapModeForBlock(topology, sequenceType)');

    // The drawing control must never write to the record. Anything that calls
    // setPayload from the map's shape toggle is the defect coming back.
    const setRenderMode = sliceBetween(
      artifactSource,
      'const setMapRenderMode = useCallback',
      'const mapViewport =',
    );
    expect(setRenderMode).not.toContain('setPayload');
    expect(setRenderMode).not.toContain('topology');

    // Converting DOES clear an explicit drawing choice, so a record converted to
    // linear is not still drawn as a ring.
    const convertTopology = sliceBetween(
      artifactSource,
      'const convertRecordTopology = useCallback',
      'const addCustomEnzyme = useCallback',
    );
    expect(convertTopology).toContain('setMapRenderModeByRecord');

    // Conversion is reachable from Entry Details — the panel that already edits
    // record fields — and NOT from the map panel.
    expect(artifactSource).toContain('onConvertTopology={convertRecordTopology}');
    expect(artifactSource).toContain('aria-label="Convert molecule topology"');
    const mapShapeToggle = sliceBetween(
      artifactSource,
      'className="motif-cs-segmented motif-cs-shape-toggle"',
      '</div>',
    );
    expect(mapShapeToggle).toContain('setMapRenderMode(');
    expect(mapShapeToggle).not.toContain('convertRecordTopology');
  });
});
