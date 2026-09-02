import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { restrictionCutGeometry } from '../motif-artifact';
import { RESTRICTION_ENZYMES_FULL } from '../../bio/enzyme-data';
import type { RestrictionEnzyme, RestrictionSite, Topology } from '../../bio/types';

const here = dirname(fileURLToPath(import.meta.url));
const artifactSource = readFileSync(resolve(here, '..', 'motif-artifact.tsx'), 'utf8');

function enzyme(name: string): RestrictionEnzyme {
  const found = RESTRICTION_ENZYMES_FULL.find((candidate) => candidate.name === name);
  expect(found, `enzyme missing from the catalog: ${name}`).toBeDefined();
  return found!;
}

function siteAt(name: string, position: number, strand: 1 | -1 = 1): RestrictionSite {
  const source = enzyme(name);
  return {
    enzyme: source.name,
    position,
    cutPosition: position + source.cutOffset,
    recognitionSequence: source.recognitionSequence,
    overhang: source.overhang ?? 'blunt',
    strand,
  };
}

function span(name: string, position: number, length: number, topology: Topology = 'linear', strand: 1 | -1 = 1) {
  const geometry = restrictionCutGeometry(siteAt(name, position, strand), enzyme(name), length, topology);
  expect(geometry, `no geometry for ${name} at ${position}`).not.toBeNull();
  return geometry!;
}

describe('restriction cut-span geometry', () => {
  it('spans the four bases EcoRI leaves single-stranded, not the whole recognition site', () => {
    // G^AATTC / CTTAA^G at position 100: nicks after motif bases 1 and 5, so the
    // 5' overhang is AATT — four of the six recognised bases.
    const geometry = span('EcoRI', 100, 2686, 'circular');
    expect([geometry.senseCut, geometry.antisenseCut]).toEqual([101, 105]);
    expect([geometry.spanStart, geometry.spanEnd]).toEqual([101, 105]);
    expect(geometry.spanEnd - geometry.spanStart).toBe(4);
    expect(geometry.spanStart).toBeGreaterThan(100);
    expect(geometry.spanEnd).toBeLessThan(106);
  });

  it('gives a 3\' cutter the same bases as a 5\' cutter but the opposite stem order', () => {
    // KpnI is GGTAC^C / C^CATGG: the same four-base span as EcoRI, reached from
    // the other side, so the sense nick is the high bond rather than the low one.
    const kpnI = span('KpnI', 100, 2686, 'circular');
    expect([kpnI.senseCut, kpnI.antisenseCut]).toEqual([105, 101]);
    expect([kpnI.spanStart, kpnI.spanEnd]).toEqual([101, 105]);
    expect(kpnI.senseCut).toBeGreaterThan(kpnI.antisenseCut);

    const ecoRI = span('EcoRI', 100, 2686, 'circular');
    expect(ecoRI.senseCut).toBeLessThan(ecoRI.antisenseCut);
    expect(kpnI.spanEnd - kpnI.spanStart).toBe(ecoRI.spanEnd - ecoRI.spanStart);
  });

  it('leaves a blunt cutter no span to draw', () => {
    const smaI = span('SmaI', 100, 2686, 'circular');
    expect([smaI.senseCut, smaI.antisenseCut]).toEqual([103, 103]);
    expect(smaI.spanEnd - smaI.spanStart).toBe(0);
  });

  it('puts the Type IIS span outside the recognition sequence it belongs to', () => {
    // BsaI is GGTCTC(1/5): both nicks land past the six recognised bases, so the
    // span never overlaps the recognition wash.
    const bsaI = span('BsaI', 100, 2686, 'circular');
    expect([bsaI.senseCut, bsaI.antisenseCut]).toEqual([107, 111]);
    expect([bsaI.spanStart, bsaI.spanEnd]).toEqual([107, 111]);
    expect(bsaI.spanStart).toBeGreaterThanOrEqual(100 + 'GGTCTC'.length);

    // A reverse-strand match mirrors the whole construction: the span lands
    // before the recognition sequence instead of after it.
    const reverse = span('BsaI', 100, 2686, 'circular', -1);
    expect([reverse.senseCut, reverse.antisenseCut]).toEqual([95, 99]);
    expect([reverse.spanStart, reverse.spanEnd]).toEqual([95, 99]);
    expect(reverse.spanEnd).toBeLessThanOrEqual(100);
  });

  it('keeps a span that crosses the origin four bases wide instead of inverting it', () => {
    // BsaI at 2678 on a 2,686 bp circle nicks at 2685 and 2689. Ordering the raw
    // bonds keeps the span short; ordering the wrapped ones would have claimed
    // the 2,682 bases running the other way round the molecule.
    const geometry = span('BsaI', 2678, 2686, 'circular');
    expect([geometry.senseCut, geometry.antisenseCut]).toEqual([2685, 3]);
    expect([geometry.spanStart, geometry.spanEnd]).toEqual([2685, 2689]);
    expect(geometry.spanEnd - geometry.spanStart).toBe(4);
    expect(Math.min(geometry.senseCut, geometry.antisenseCut)).toBe(3);

    // The same trap on the other side: a reverse-strand site near base 0 nicks at
    // a negative raw bond, which wraps to the tail of the molecule.
    const before = span('BsaI', 3, 2686, 'circular', -1);
    expect([before.senseCut, before.antisenseCut]).toEqual([2684, 2]);
    expect([before.spanStart, before.spanEnd]).toEqual([-2, 2]);
    expect(before.spanEnd - before.spanStart).toBe(4);
  });

  it('drops a linear site whose cut falls off the end of the molecule', () => {
    expect(restrictionCutGeometry(siteAt('BsaI', 240, 1), enzyme('BsaI'), 245, 'linear')).toBeNull();
    expect(restrictionCutGeometry(siteAt('BsaI', 240, 1), enzyme('BsaI'), 245, 'circular')).not.toBeNull();
  });

  it('draws a span for every catalogued sticky cutter and for no blunt one', () => {
    const disagreements: string[] = [];
    for (const source of RESTRICTION_ENZYMES_FULL) {
      const site: RestrictionSite = {
        enzyme: source.name,
        position: 500,
        cutPosition: 500 + source.cutOffset,
        recognitionSequence: source.recognitionSequence,
        overhang: source.overhang ?? 'blunt',
        strand: 1,
      };
      const geometry = restrictionCutGeometry(site, source, 2686, 'circular');
      if (!geometry) { disagreements.push(`${source.name}: no geometry`); continue; }
      const width = geometry.spanEnd - geometry.spanStart;
      if (width < 0) disagreements.push(`${source.name}: negative span ${width}`);
      if ((width === 0) !== (source.overhang === 'blunt')) {
        disagreements.push(`${source.name}: span ${width} but overhang ${source.overhang}`);
      }
    }
    expect(disagreements).toEqual([]);
    expect(RESTRICTION_ENZYMES_FULL.length).toBeGreaterThan(150);
  });
});

describe('restriction cut-span rendering', () => {
  it('clips the span to the line and the topology before painting it', () => {
    expect(artifactSource).toContain(
      'for (const range of normalizeSpan(spanStart, spanEnd, sequence.length, topology)) {',
    );
    expect(artifactSource).toContain('className="motif-cs-seq-cut-span"');
    expect(artifactSource).toContain('data-span-start={range.start}');
    expect(artifactSource).toContain('data-span-end={range.end}');
  });

  it('leaves the enzyme cut bonds and overhang polarity in the label text, not only in the overlay', () => {
    // The overlay is aria-hidden, so the staircase must not become the only place
    // the cut positions are stated.
    expect(artifactSource).toContain('<div className="motif-cs-seq-overlay" aria-hidden="true">');
    expect(artifactSource).toContain(
      '`cuts ${primaryGeometry.senseCut + 1} and ${primaryGeometry.antisenseCut + 1}`',
    );
    expect(artifactSource).toContain('primary.overhang === \'5prime\' ? "5 prime" : "3 prime"');
  });
});
