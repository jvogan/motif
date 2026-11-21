import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { findORFs } from '../../bio/orf-detection';
import { reverseComplement } from '../../bio/reverse-complement';
import { dnaDuplexMolecularWeight, longestOrfPerStop, prepareArtifactDatabaseRestore } from '../motif-artifact';

const here = dirname(fileURLToPath(import.meta.url));
const artifactSource = readFileSync(resolve(here, '..', 'motif-artifact.tsx'), 'utf8');
const artifactCss = readFileSync(resolve(here, '..', 'motif-artifact.css'), 'utf8');

/** The --fs-* type scale from motif-artifact.css, in px. */
const FONT_SIZE_TOKENS: Record<string, number> = {
  '--fs-xs': 12,
  '--fs-sm': 13,
  '--fs-md': 14,
  '--fs-lg': 16,
  '--fs-xl': 18,
};

/** The source of one top-level function, from its signature to its closing brace. */
function functionSource(name: string): string {
  const start = artifactSource.indexOf(`function ${name}(`);
  expect(start, `function ${name} not found`).toBeGreaterThan(-1);
  const end = artifactSource.indexOf('\n}\n', start);
  return artifactSource.slice(start, end + 2);
}

/** The declarations of the first rule whose selector is exactly `selector`. */
function cssRule(selector: string): string {
  const start = artifactCss.indexOf(`\n${selector} {`);
  expect(start, `${selector} not found`).toBeGreaterThan(-1);
  return artifactCss.slice(start, artifactCss.indexOf('}', start));
}

describe('Analysis mass for a DNA record', () => {
  // Average deoxynucleotide monophosphate masses and water, written out here
  // so the expectation is a hand computation from base composition rather
  // than a second call into the code under test.
  const NMP = { A: 331.2218, C: 307.1971, G: 347.2212, T: 322.2085 };
  const WATER = 18.0153;

  it('is both strands of pUC19, computed from its displayed composition (A604 C604 G624 T746)', () => {
    const sequence = 'A'.repeat(604) + 'C'.repeat(604) + 'G'.repeat(624) + 'T'.repeat(746);
    const n = sequence.length;
    // A closed strand loses one water per nucleotide. The other strand pairs
    // A with T and C with G, so its composition is A746 C624 G604 T604.
    const top = 604 * NMP.A + 604 * NMP.C + 624 * NMP.G + 746 * NMP.T - n * WATER;
    const bottom = 746 * NMP.A + 624 * NMP.C + 604 * NMP.G + 604 * NMP.T - n * WATER;
    expect(top).toBeCloseTo(796195.14, 1);
    expect(dnaDuplexMolecularWeight(sequence, 'circular')).toBeCloseTo(top + bottom, 1);
    expect(dnaDuplexMolecularWeight(sequence, 'circular')).toBeCloseTo(1592869.69, 1);
  });

  it('keeps the linear end chemistry on each strand', () => {
    // ACGTT, 5'-phosphate / 3'-hydroxyl: one water lost per bond, 4 bonds.
    const top = NMP.A + NMP.C + NMP.G + 2 * NMP.T - 4 * WATER;
    const bottom = 2 * NMP.A + NMP.C + NMP.G + NMP.T - 4 * WATER;
    expect(dnaDuplexMolecularWeight('ACGTT', 'linear')).toBeCloseTo(top + bottom, 1);
  });

  it('rounds only after summing both DNA strand masses', () => {
    // 957.6348 + 930.5949 = 1888.2297 Da before display rounding.
    expect(dnaDuplexMolecularWeight('AAA', 'linear')).toBe(1888.23);
  });

  it('labels the duplex, keeps the single strand beside it, and writes Tm in degrees Celsius', () => {
    const panel = functionSource('AnalysisPanel');
    expect(panel).toContain('<span>Mass, dsDNA</span>');
    expect(panel).toContain('<small>ss {massText}</small>');
    expect(panel).toContain("`${tm.toFixed(1)} °C`");
    // Copy stats carries `molecularWeight` and adds the duplex beside it.
    expect(panel).toContain('molecularWeight: mw ?? undefined,');
    expect(panel).toContain('molecularWeightDoubleStranded: duplexMass ?? undefined,');
  });

  it('names the fourth base U in an RNA record composition and T otherwise', () => {
    // The count adds T and U, and the base is named for the sequence type: U in RNA, T otherwise.
    const panel = functionSource('AnalysisPanel');
    expect(panel).toContain("· {sequenceType === 'rna' ? 'U' : 'T'} {composition.T + (composition.U ?? 0)} ·");
    expect(panel).not.toContain('· T {composition.T + (composition.U ?? 0)} ·');
  });
});

describe('Construct Verification with no reads', () => {
  it('says how to add a read, offers the picker, and locks the button only without a reference', () => {
    const start = artifactSource.indexOf('data-rail-tool="construct-verification"');
    const panel = artifactSource.slice(start, artifactSource.indexOf('</details>', start));
    // The workspace opens with no reads (it has its own import); only a
    // missing reference locks the button.
    expect(panel).toContain('disabled={constructVerificationReferenceCount === 0}');
    expect(panel).not.toContain('constructVerificationReadCount === 0 ||');
    expect(panel).not.toContain('|| constructVerificationReadCount === 0');
    expect(panel).not.toContain("'Import a Sanger trace (.ab1) first'");
    expect(panel).toContain('no Sanger reads yet. Import .ab1 or .abi traces, or drop them in the workspace.');
    // The same import the Inventory "+" and a workspace drop use.
    expect(panel).toMatch(/<SangerTraceImportButton\s+onImportFiles=\{\(files\) => importFiles\(files\)\.catch\(\(\) => showWorkbenchNotice\(FILE_IMPORT_FAILED_MESSAGE, 'error'\)\)\}/);
    const button = functionSource('SangerTraceImportButton');
    expect(button).toContain('accept=".ab1,.abi"');
    expect(button).toContain('data-testid="import-sanger-traces"');
  });
});

describe('Restriction Sites panel', () => {
  it('opens its list on the enzymes, with the sites one press away', () => {
    // The per-enzyme checkboxes are the only way to hide one enzyme. After all 77
    // pUC19 site rows they would sit 3,007px down a 323px scroll box.
    const list = functionSource('RestrictionList');
    expect(list).toContain("useState<'enzymes' | 'sites'>('enzymes')");
    // The switch says how the list is ordered, with no counts: the tab head gives
    // the sites shown and the Enzyme sets heading the enzymes searched.
    expect(list).toMatch(/>\s*By enzyme\s*</);
    expect(list).toMatch(/>\s*By position\s*</);
    expect(list).not.toContain('visibleEnzymeCount');
    expect(list).toMatch(/view !== 'sites' \? null : shownSites\.length > 0/);
    expect(list).toMatch(/view !== 'enzymes' \? null : \(/);
  });

  it('makes each enzyme set a checkbox that names the set once, with its size in the title', () => {
    const sources = functionSource('RestrictionSourceControls');
    // A box carries on and off; a count chip with a check mark would read off
    // only by a 12px badge, and its count (the set's size) would sum past the
    // heading's total.
    expect(sources).toContain('type="checkbox"');
    expect(sources).toContain('checked={sources.includes(option.id)}');
    expect(sources).toContain('title={`${option.description} ${option.enzymeCount} enzymes.`}');
    expect(sources).toContain("option.id === 'all' ? `All ${option.enzymeCount}` : option.label");
    expect(sources).not.toContain('aria-pressed');
    expect(sources).not.toContain('motif-cs-source-state');
    expect(sources).not.toContain('Combine groups');
    // One total, after the heading, and the map-names box at the end of that row.
    expect(sources).toMatch(/>Enzyme sets<\/span>\s*<span className="motif-cs-panel-meta">\{enzymeCount\} enzymes<\/span>/);
    expect(sources).toContain('<span>Names on map</span>');
    expect(sources).toContain("title={names.disabled ? 'Show sites first' : \"Write each enzyme's name beside its site\"}");
  });

  it('gives the Tools copy the Sites menu only while the map pane is hidden', () => {
    const start = artifactSource.indexOf('const renderRestrictionSiteControls = ');
    const controls = artifactSource.slice(start, artifactSource.indexOf('\n  };\n', start));
    // One home at a time: the map header's menu while the map shows, this one
    // while it is hidden, wired to the same handler and state.
    expect(controls).toContain('const sitesMenu = !includeMapSummary && !paneVisibility.map ? (');
    expect(controls).toContain('className="motif-cs-map-sites-toggle"');
    expect(controls).toContain('aria-label="Restriction sites"');
    expect(controls).toContain('value={mapSiteMode}');
    expect(controls).toContain('setMapSiteMode(next)');
    expect(controls).toContain('sitesMenu={sitesMenu}');
    // The map's own Sites tab never carries it.
    expect(artifactSource).toContain('{isDnaRecord ? renderRestrictionSiteControls(true) : null}');
    const sources = functionSource('RestrictionSourceControls');
    expect(sources).toContain('{sitesMenu ? null : namesBox}');
  });

  it('writes the set names at 12px or larger on one line, so "Golden Gate" is never cut', () => {
    const check = cssRule('.motif-cs-restriction-check');
    const token = check.match(/font-size:\s*var\((--fs-[a-z]+)\)/)?.[1] ?? '';
    const size = FONT_SIZE_TOKENS[token] ?? Number(check.match(/font-size:\s*([\d.]+)px/)?.[1]);
    expect(size).toBeGreaterThanOrEqual(12);
    expect(check).toMatch(/white-space:\s*nowrap/);
    expect(check).not.toMatch(/text-overflow/);
  });

  it('keeps the Add enzyme placeholders short enough for the popover fields', () => {
    const form = functionSource('AddEnzymeForm');
    const placeholders = [...form.matchAll(/placeholder="([^"]*)"/g)].map((match) => match[1]);
    expect(placeholders).toEqual(['Enzyme name', 'Sequence']);
    expect(cssRule('.motif-cs-add-enzyme-row')).toMatch(/grid-template-columns:\s*minmax\(0, 1fr\) minmax\(0, 1fr\);/);
    expect(cssRule('.motif-cs-add-enzyme-row .motif-cs-mini-button')).toContain('grid-column: 1 / -1;');
  });
});

describe('the Cloning panel', () => {
  it('names the restriction route and opens Digest Preview from it', () => {
    const start = artifactSource.indexOf('data-rail-tool="cloning"');
    const panel = artifactSource.slice(start, artifactSource.indexOf('</details>', start));
    expect(panel).toContain('<strong>Restriction cloning</strong>');
    expect(panel).toMatch(/onClick=\{openDigestPreview\}[\s\S]{0,200}data-testid="open-digest-preview"/);
    // The route is digest first, then ligation: it sits before Quick assembly.
    expect(panel.indexOf('Restriction cloning')).toBeLessThan(panel.indexOf('<strong>Quick assembly</strong>'));
    const opener = artifactSource.slice(artifactSource.indexOf('const openDigestPreview = useCallback('));
    expect(opener.slice(0, 500)).toContain("ensurePaneVisible('map')");
    expect(opener.slice(0, 500)).toContain("openMapDockPanel(mapColumnRef.current, 'Digest Preview')");
  });
});

describe('Results and Workflow Results', () => {
  const panel = (tool: string) => {
    const start = artifactSource.indexOf(`name="motif-cs-tools" data-rail-tool="${tool}"`);
    return artifactSource.slice(start, artifactSource.indexOf('</details>', start));
  };

  it('each names where the other kind of save went and opens that panel', () => {
    const results = panel('analysis-results');
    expect(results).toContain('Digests, gels and quick assemblies are in');
    expect(results).toContain("onClick={() => openRailToolPanel('workflows')}>Workflow results</button>");
    const workflows = panel('workflows');
    expect(workflows).toContain('Primer designs, PCR, assembly plans and verification are in');
    expect(workflows).toContain("onClick={() => openRailToolPanel('analysis-results')}>Analysis results</button>");
  });

  it('titles each rail head with the name its panel shows', () => {
    expect(panel('analysis-results')).toContain('title="Analysis results — primers, PCR, assembly plans, verification"');
    expect(panel('workflows')).toContain('title="Workflow results — digests, gels, quick assemblies"');
    // "Open quick assembly" opens a window titled "Quick assembly", not "Cloning Workspace".
    expect(artifactSource).toContain("assembly: 'Quick assembly',");
    expect(artifactSource).not.toContain("'Cloning Workspace'");
  });
});

describe('Analysis ORF rows', () => {
  // ATG AAA ATG AAA AAA AAA TAA: two in-frame starts, one stop at bases 19-21.
  const orfUnit = 'ATGAAAATGAAAAAAAAATAA';

  it('lists one ORF per strand and stop, from its farthest start, on both strands', () => {
    const sequence = `${orfUnit}CCCCCC${reverseComplement(orfUnit)}`;
    const orfs = findORFs(sequence, 3, undefined, { topology: 'linear' });
    const unitOrfs = orfs.filter((orf) => orf.aminoAcids >= 4 && orf.stopCodon === 'TAA');
    // The scan enters each stop from both starts, on each strand.
    expect(unitOrfs.map((orf) => [orf.strand, orf.aminoAcids])).toEqual(
      expect.arrayContaining([[1, 6], [1, 4], [-1, 6], [-1, 4]]),
    );
    const kept = longestOrfPerStop(orfs, sequence.length).filter((orf) => orf.stopCodon === 'TAA' && orf.aminoAcids >= 4);
    expect(kept.map((orf) => [orf.strand, orf.aminoAcids]).sort()).toEqual([[-1, 6], [1, 6]]);
    // Independent count: the stop codon's first base, read off each strand.
    const stops = new Set(orfs.map((orf) => `${orf.strand}:${orf.strand === -1 ? orf.start : orf.end - 3}`));
    expect(longestOrfPerStop(orfs, sequence.length)).toHaveLength(stops.size);
  });

  it('matches a stop reached across the origin with the same stop reached directly', () => {
    const base = { frame: 1, strand: 1, length: 0, aminoAcids: 0, startCodon: 'ATG', stopCodon: 'TGA' } as const;
    const wrapped = { ...base, start: 2311, end: 2613, length: 302 };
    const direct = { ...base, start: 5, end: 35, length: 30 };
    expect(longestOrfPerStop([wrapped, direct], 2578)).toEqual([wrapped]);
  });

  it('counts the chip, the note, the rows and Copy stats from the same per-stop list', () => {
    const panel = functionSource('AnalysisPanel');
    expect(panel).toContain('const stopOrfs = useMemo(() => longestOrfPerStop(allOrfs, record.sequence.length)');
    expect(panel).toContain('const visibleOrfs = useMemo(() => stopOrfs.slice(0, shownOrfCount), [stopOrfs, shownOrfCount]);');
    expect(panel.match(/\$\{stopOrfs\.length\} ORFs ≥\$\{ANALYSIS_ORF_MIN_AA\} aa/g)).toHaveLength(2);
    expect(panel).toContain('orfCount: stopOrfs.length,');
    expect(panel).toContain('Showing {visibleOrfs.length} of {stopOrfs.length}: the longest ORF per stop.');
    expect(panel).toContain('All {stopOrfs.length}: the longest ORF per stop.');
  });
});

describe('Sequence search on first load', () => {
  it('starts with no query, so nothing is underlined before anyone searches', () => {
    // A prefilled GAATTC underlined pUC19's EcoRI site on first load.
    const restored = prepareArtifactDatabaseRestore({ records: [{ id: 'a', type: 'dna', sequence: 'ATGGAATTCTAA' }] });
    expect(restored.payload.defaultMotif).toBe('');
    // A workspace that names its own default keeps it.
    const named = prepareArtifactDatabaseRestore({ defaultMotif: 'GGCC', records: [{ id: 'a', type: 'dna', sequence: 'ATGGCCTAA' }] });
    expect(named.payload.defaultMotif).toBe('GGCC');
  });

  it('shows a hit count only once there is a query', () => {
    const start = artifactSource.indexOf('data-rail-tool="pattern-search"');
    expect(start).toBeGreaterThan(0);
    const panel = artifactSource.slice(start, artifactSource.indexOf('</details>', start));
    expect(panel).toMatch(/\{hasActiveRecord && cleanedMotifLength > 0 \? \(\s*<span className="motif-cs-chip">\{formatFindTotal\(findResult\)\} hit/);
    expect(panel).toContain('meta={hasActiveRecord && cleanedMotifLength > 0 ? `${formatFindTotal(findResult)} hit');
  });
});

describe('Guide RNA rows', () => {
  it('puts the whole spacer on its own line, with the actions over the first line', () => {
    // A 54px fourth column and a 52px action column would leave the spacer 122-185px
    // for a string that needs 152-190px, and rows would wrap mid-sequence.
    const select = cssRule('.motif-cs-guide-select');
    const columns = select.match(/grid-template-columns:\s*([^;]+);/)?.[1].trim().split(/\s+(?![^(]*\))/);
    expect(columns).toEqual(['14px', 'max-content', 'minmax(0, 1fr)']);
    expect(select).toMatch(/grid-template-areas:\s*"strand pos gc"\s*"spacer spacer spacer";/);
    expect(cssRule('.motif-cs-guide-gc')).toContain('grid-area: gc;');
    expect(cssRule('.motif-cs-guide-spacer')).toContain('grid-area: spacer;');
    const actions = cssRule('.motif-cs-guide-actions');
    expect(actions).toContain('position: absolute;');
    expect(actions).toContain('height: var(--control-h);');
    expect(cssRule('.motif-cs-guide-actions .motif-cs-mini-button')).toContain('min-height: var(--control-h-sm);');
    expect(artifactCss).not.toContain('[data-tools-pinned="true"] .motif-cs-guide-row');
  });

  it('says what the count counts and what the checkbox changes', () => {
    const panel = functionSource('GuideSearchPanel');
    expect(panel).toContain('<RailPopoverTitle title="Guide RNA" meta={guideMeta} />');
    expect(panel).toContain("`${guideChip} site${guides.length === 1 ? '' : 's'}`");
    expect(panel).toContain('<span>Copy as RNA (U)</span>');
    expect(panel).not.toContain('<span>RNA</span>');
  });
});

describe('record tools in an empty workspace', () => {
  // With no record, Sequence search shows no "0 hits", Analysis shows no zero length,
  // mass or GC (and Copy stats stays disabled), and Guide RNA shows no "Whole record 0 bp".
  it('show one no-record line and no count instead of zeros', () => {
    const analysis = functionSource('AnalysisPanel');
    expect(analysis).toContain('const hasRecord = record.id !== EMPTY_ARTIFACT_VECTOR.id;');
    expect(analysis).toMatch(/\{!hasRecord \? \(\s*<p className="motif-cs-muted" data-testid="no-record-note">Add or select a record to see its length, mass and ORFs\.<\/p>/);
    expect(analysis).toMatch(/\{hasRecord && !orfsPending \? \(\s*<span className="motif-cs-chip">/);

    const guide = functionSource('GuideSearchPanel');
    expect(guide).toMatch(/const guideChip = !hasRecord\s*\?\s*undefined/);
    expect(guide).toContain('Add or select a DNA or RNA record to find guide sites.');
    expect(artifactSource).toMatch(/<GuideSearchPanel\s+hasRecord=\{hasActiveRecord\}/);

    expect(artifactSource).toMatch(/\{!hasActiveRecord\s*\? 'Add or select a record to search its sequence\.'/);
    expect(functionSource('TranslationPanel')).toContain("'Add or select a DNA or RNA record to translate it.'");
  });
});

describe('danger buttons', () => {
  it('outrank the plain mini-button rule, except a delete that is not armed yet', () => {
    // `.motif-cs-danger-button` alone (0,1,0) lost on source order to
    // `.motif-cs-mini-button` (0,1,0), so "Clear all data" and "Replace
    // workspace" painted exactly like Cancel.
    const rest = cssRule('.motif-cs-mini-button.motif-cs-danger-button:not(.motif-cs-confirm-delete)');
    expect(rest).toContain('color: var(--red);');
    expect(artifactCss).toContain('.motif-cs-mini-button.motif-cs-danger-button:not(.motif-cs-confirm-delete, :disabled):is(:hover, :focus-visible) {');
    expect(artifactCss).not.toMatch(/\n\.motif-cs-danger-button[\s,:{]/);
    // Every danger button is a mini-button, so the compound selector reaches all of them.
    const dangerButtons = [...artifactSource.matchAll(/className="([^"]*motif-cs-danger-button[^"]*)"/g)].map((match) => match[1]);
    expect(dangerButtons.length).toBeGreaterThan(0);
    for (const className of dangerButtons) {
      expect(className === 'motif-cs-danger-button' || className.includes('motif-cs-mini-button'), className).toBe(true);
    }
  });
});

describe('the collapsed rail height', () => {
  it('fits 16 tools under the top bar of a 720px window', () => {
    // 8px padding twice, a 32px title, and 16 heads of 34px with 3px gaps. The
    // heads' transparent 1px borders made the pitch 39px and the total 672px.
    const head = Number(cssRule('.motif-cs-inspector[data-tools-pinned="false"] .motif-cs-panel-head').match(/min-height:\s*(\d+)px/)?.[1]);
    // The rule that sizes each rail slot (an earlier one only restores pointer events).
    const panelAt = artifactCss.indexOf('.motif-cs-inspector[data-tools-pinned="false"] .motif-cs-panel {\n  position: relative;');
    expect(panelAt).toBeGreaterThan(-1);
    expect(artifactCss.slice(panelAt, artifactCss.indexOf('}', panelAt))).toContain('border-width: 0;');
    const rail = cssRule('.motif-cs-inspector[data-tools-pinned="false"]');
    const gap = Number(rail.match(/gap:\s*(\d+)px/)?.[1]);
    const padding = Number(rail.match(/padding:\s*(\d+)px/)?.[1]);
    const needed = 2 * padding + 32 + 16 * (head + gap);
    expect(needed).toBe(640);
    // The rail scrolls only below the window height it needs under the 70px bar.
    expect(artifactCss).toContain(`@media (max-height: ${70 + needed - 1}px) {`);
    expect(artifactCss).not.toContain('@media (max-height: 731px) {');
  });
});
