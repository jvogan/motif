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

describe('Claude Science map workspace regression guards', () => {
  it('keeps motif, guide, and digest coordinates correct across a circular origin', () => {
    expect(artifactSource).toContain("function findMotifHits(sequence: string, motif: string, sequenceType: SequenceType, topology: Topology = 'linear')");
    expect(artifactSource).toContain("sequence + sequence.slice(0, Math.max(0, target.length - 1))");
    expect(artifactSource).toContain('motifHitContext(sequence, hit, cleanedMotifLength, 10, topology)');
    expect(artifactSource).toContain('motifHits.flatMap((hit) => normalizeSpan(hit, hit + motifLength, sequence.length, topology))');
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
});
