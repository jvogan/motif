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
    const toggleTopology = sliceBetween(
      artifactSource,
      'const toggleTopology = useCallback',
      'const addCustomEnzyme = useCallback',
    );

    expect(artifactSource).toContain('const topology = vector.topology;');
    expect(artifactSource).not.toContain('topologyOverrides');
    expect(toggleTopology).toMatch(/const nextTopology(?:: Topology)? = topology === 'circular' \? 'linear' : 'circular';/);
    expect(toggleTopology).toContain('record.id === recordId ? { ...record, topology: nextTopology } : record');
    expect(toggleTopology).toContain('payloadRef.current = nextPayload;');
  });
});
