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
  it('clears same-id transient state when replacing the whole inventory', () => {
    const resetState = sliceBetween(
      artifactSource,
      'const resetRecordTransientState = useCallback',
      'useEffect(() => {\n    payloadRef.current = payload;',
    );
    const renderInventory = sliceBetween(
      artifactSource,
      'window.motifRenderInventory = (entriesOrPayload) => {',
      '// Append helper',
    );

    expect(resetState).toContain('setMapRangesByRecord({});');
    expect(resetState).toContain('setMapViewportsByRecord({});');
    expect(resetState).toContain('setTranslationLayersByRecord({});');
    expect(resetState).toContain('setHiddenFeatureTranslationsByRecord({});');
    expect(resetState).toContain('sequenceScrollByRecordRef.current = {};');
    expect(resetState).toContain('editHistoryRef.current = {};');
    expect(renderInventory).toContain('resetRecordTransientState();');
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
