/**
 * A click changes what is selected, never where things are. These guards pin
 * the source-level reasons the workbench holds still when a selection starts,
 * changes or ends, and when a drawer or a display switch is toggled. Each guards
 * against a layout jump that a browser measurement can show; the source-level
 * checks here keep the reasons in place.
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { restrictionSelectionReadout } from '../motif-artifact';

const here = dirname(fileURLToPath(import.meta.url));
const artifactSource = readFileSync(resolve(here, '..', 'motif-artifact.tsx'), 'utf8');
const artifactCss = readFileSync(resolve(here, '..', 'motif-artifact.css'), 'utf8');

function cssBlock(selector: string): string {
  for (let at = artifactCss.indexOf(selector); at >= 0; at = artifactCss.indexOf(selector, at + 1)) {
    const rest = artifactCss.slice(at + selector.length);
    if (!/^\s*\{/.test(rest)) continue;
    const open = artifactCss.indexOf('{', at);
    return artifactCss.slice(open + 1, artifactCss.indexOf('}', open));
  }
  throw new Error(`missing CSS selector: ${selector}`);
}

function between(source: string, start: string, end: string): string {
  const from = source.indexOf(start);
  expect(from, `missing ${start}`).toBeGreaterThanOrEqual(0);
  const to = source.indexOf(end, from + start.length);
  expect(to, `missing ${end} after ${start}`).toBeGreaterThan(from);
  return source.slice(from, to);
}

describe('click stability', () => {
  it('keeps the map status line mounted for the whole life of a record', () => {
    // It mounts whether or not a feature is selected: mounting it only with a
    // selection would insert 29px under the map and move every row of the Sequence
    // pane below it down and back.
    const line = between(artifactSource, 'className="motif-cs-map-selection-line"', '</p>');
    expect(artifactSource).toMatch(/const mapSelectionLineElement = hasActiveRecord \? \(\s*<p\s+className="motif-cs-map-selection-line"/);
    // One element with two homes: under the frame, or (one column) in the Sites
    // and Digest row, which renders for every nucleotide record. Exactly one
    // home renders it, so it stays mounted for the whole life of a record.
    expect(artifactSource).toContain('const mapSelectionLineInDock = stackedLayout && isNucleotideRecord;');
    expect(artifactSource).toContain('{mapSelectionLineInDock ? null : mapSelectionLineElement}');
    expect(artifactSource).toContain('{mapSelectionLineInDock ? mapSelectionLineElement : null}');
    expect(artifactSource).toMatch(/\{!hasActiveRecord \|\| !isNucleotideRecord \? null : \(\s*<div className="motif-cs-map-dock-strip" data-readout=\{mapSelectionLineInDock \|\| undefined\}>\s*\{mapSelectionLineInDock \? mapSelectionLineElement : null\}/);
    expect(line).toContain('{mapSelectionLine}');
    expect(artifactSource).toContain("?? (features.some((feature) => !isWholeRecordFeature(feature)) ? 'Click a feature, or drag to select a range' : 'Drag to select a range');");
    const rule = cssBlock('.motif-cs-map-selection-line');
    expect(rule).toMatch(/flex:\s*0 0 auto/);
    expect(rule).toMatch(/line-height:\s*20px/);
    expect(rule).toMatch(/white-space:\s*nowrap/);
  });

  it('reads a picked restriction site at the same position the inspector lists', () => {
    // The inspector lists `site.position + 1` for the selected sites; the readout
    // takes the same sites, so the two cannot disagree. The polylinker cluster is
    // anchored at 423, which is the position every enzyme in it reads.
    const inspector = (sites: { position: number }[]) => sites.map((site) => site.position + 1).join(', ');
    const ecoRI = [{ enzyme: 'EcoRI', position: 395 }];
    expect(restrictionSelectionReadout('EcoRI', ecoRI, 'EcoRI', 422)).toBe(`EcoRI site · ${inspector(ecoRI)}`);
    expect(restrictionSelectionReadout('EcoRI', ecoRI, 'EcoRI', 422)).toBe('EcoRI site · 396');
    // A whole cluster of several enzymes reads a count, never a position.
    const cluster = ['EcoRI', 'SacI', 'KpnI', 'SmaI', 'BamHI', 'XbaI', 'SalI', 'PstI', 'SphI', 'HindIII']
      .map((enzyme, index) => ({ enzyme, position: 395 + index * 6 }));
    expect(restrictionSelectionReadout(null, cluster, 'EcoRI', 422)).toBe('10 enzymes · 10 sites');
    // One enzyme that cuts more than once, picked as a whole, reads a count too.
    const bsaI = [{ enzyme: 'BsaI', position: 1765 }, { enzyme: 'BsaI', position: 2410 }];
    expect(restrictionSelectionReadout('BsaI', bsaI, 'BsaI', 1765)).toBe('BsaI · 2 sites');
    // Large positions keep their thousands separator, as the inspector's list does not need to.
    expect(restrictionSelectionReadout('NotI', [{ enzyme: 'NotI', position: 51233 }], 'NotI', 51233)).toBe('NotI site · 51,234');
    // Both read the one list of selected sites, in the large-record view and after
    // a reverse complement alike, since neither keeps positions of its own.
    expect(artifactSource).toContain('selectedRestrictionSites.map((site) => site.position + 1).join(\', \')');
  });

  it('states a selection once per pane, in one wording, with an en dash and separators', () => {
    expect(artifactSource).toContain("`${(range.start + 1).toLocaleString()}–${end.toLocaleString()}`");
    expect(artifactSource).toContain(".replace(/\\d+/g, (digits) => Number(digits).toLocaleString()).replace(/(\\d)-(\\d)/g, '$1–$2')");
    // Beside "5′→3′" a feature's strand reads "− strand" or "+ strand", never a bare
    // "reverse" that looks like it contradicts the direction the bases are shown in.
    expect(artifactSource).toContain("parts.push(strand === 'reverse' ? '− strand' : strand === 'forward' ? '+ strand' : strand === 'mixed' ? 'both strands' : 'no strand');");
    expect(cssBlock('.motif-cs-selection-label')).toMatch(/gap:\s*var\(--space-1\)/);
    // A picked restriction site reads its own position, not its cluster's anchor.
    const sites = between(artifactSource, 'function restrictionSelectionReadout(', '\n}\n');
    expect(sites).toContain('if (sites.length === 1) return `${enzyme ?? sites[0].enzyme} site · ${(sites[0].position + 1).toLocaleString()}`;');
    expect(artifactSource).toMatch(/restrictionSelectionReadout\(\s*selection\?\.kind === 'restriction' && selection\.enzyme \? selection\.enzyme : null,\s*selectedRestrictionSites,/);
    // The map corner does not repeat the range; the status line states it.
    // A function so the map's error boundary, not the app, catches a throw in it.
    const hint = between(artifactSource, 'const mapStatusHint = () => [', "].filter(Boolean).join(' · ');");
    expect(hint).not.toContain('selectedMapRange');
    // The selection bar has one readout slot, no length chip beside it.
    const label = between(artifactSource, '<span className="motif-cs-selection-label"', '</span>\n                </span>');
    expect(label).not.toContain('motif-cs-chip');
    // A typed-key or paste note takes the same slot instead of adding one.
    expect(label).toContain("className={activeSequenceStatusNote || (!selectionReadout && caret !== null) ? 'motif-cs-edit-hint' : 'motif-cs-selection-name'}");
    expect(label.match(/className=\{/g)).toHaveLength(1);
  });

  it('reveals a linked selection once, before paint, and only when it is not fully visible', () => {
    const reveal = between(artifactSource, 'function revealSequenceBlock(', '\n}\n');
    expect(reveal).toContain('if (rect.top < viewTop + padTop - 0.5 || rect.bottom > viewTop + viewHeight + 0.5) {');
    // The find bar's scroll-padding-top is the least inset, so a find step is one jump.
    expect(reveal).toContain('parseFloat(getComputedStyle(scroller).scrollPaddingTop)');
    expect(reveal).toContain('const inset = Math.max(padTop, Math.min(8, Math.max(0, viewHeight - rect.height)));');
    expect(reveal).not.toContain("behavior: 'smooth'");
    const effect = between(artifactSource, 'const pendingRevealRef = useRef(focusStart !== null);', '}, [basesPerLine, focusKey, focusRequest, focusStart]);');
    expect(effect).toContain('useLayoutEffect(() => {');
    expect(effect).not.toContain('requestAnimationFrame');
    expect(effect).toContain('withExactSequenceLayout(container, () => revealSequenceBlock(container, block));');
    // A view change (tracks, complement) is not a reason to re-reveal.
    expect(effect).not.toContain('detailMode');
    expect(effect).not.toContain('showComplement');
  });

  it('lays every sequence block out at its real height while a scroll position is computed', () => {
    expect(cssBlock('.motif-cs-sequence[data-seq-exact] .motif-cs-seq-block')).toMatch(/content-visibility:\s*visible/);
    expect(artifactSource).toContain("sequenceElement.dataset.seqExact = 'true';");
    // A rewrap restores its anchor in the same frame, not two frames later.
    const rewrap = between(artifactSource, '// A rewrap restores the anchor before the new lines are painted', '}, [basesPerLine, restoreScrollAnchor]);');
    expect(rewrap).not.toContain('requestAnimationFrame');
    // Show tracks and Complement announce the change so the rows on screen keep their place.
    expect(artifactSource.match(/window\.dispatchEvent\(new Event\(SEQUENCE_VIEW_CHANGE_EVENT\)\);/g)).toHaveLength(2);
  });

  it('lets a pointer press focus the sequence without the keyboard ring', () => {
    expect(artifactSource).toContain('containerRef.current?.focus({ preventScroll: true, focusVisible: false } as FocusOptions);');
  });

  it('lets an Escape that closed a drawer or menu leave the selection alone', () => {
    const keys = between(artifactSource, '// Workbench keyboard shortcuts: Esc clears selection', "window.removeEventListener('keydown', onKey);");
    expect(keys).toMatch(/if \(event\.key === 'Escape'\) \{[\s\S]*?if \(event\.defaultPrevented \|\| document\.querySelector\('\[data-tools-drawer="open"\]'\)\) return;/);
    expect(keys).toContain("window.addEventListener('keydown', onKey);");
  });

  it('treats a press that moves less than a click tolerance as a click', () => {
    // Map: a 1-2px tremor neither pans the map nor flashes a range before the click.
    const mapMove = between(artifactSource, 'const handleMapPointerMove = useCallback(', 'const handleMapPointerEnd = useCallback(');
    expect(mapMove).toMatch(/beginMapRangeSelection\(drag\.startBp\);[\s\S]*?if \(!drag\.moved\) return;[\s\S]*?if \(drag\.mode === 'pan'\)/);
    // Sequence: a hit test on the neighbouring base does not make a two-base range.
    const seqMove = between(artifactSource, 'const handleBasesPointerMove = useCallback(', 'const handleBasesPointerUp = useCallback(');
    expect(seqMove).toContain('if (!pastClick && !didDragRef.current) return;');
  });

  it('keeps control widths fixed across states', () => {
    // A heavier label is a wider control, so the Tools button keeps one weight and stays put while its drawer is open.
    expect(cssBlock('.motif-cs-pane-toggle')).toMatch(/font-weight:\s*500/);
    expect(cssBlock('.motif-cs-pane-toggle[data-active="true"]')).not.toMatch(/font-weight/);
    // A display switch keeps its heavier "on" label but reserves that width in both states.
    expect(cssBlock('.motif-cs-display-switch > [data-label]::after')).toMatch(/font-weight:\s*600/);
    expect(cssBlock('.motif-cs-display-switch > [data-label]::after')).toMatch(/height:\s*0/);
    expect(artifactSource).toContain('<span className="motif-cs-toolbar-label" data-label="Tracks">Tracks</span>');
    // The map's Circle | Line pair keeps a fixed width in both states.
    expect(cssBlock('.motif-cs-map-toolbar .motif-cs-map-shape')).toContain('width: calc(4.5ch + 2 * var(--space-2) + 2px);');
    // The switch thumb moves in one frame.
    expect(cssBlock('.motif-cs-switch-track > span')).not.toMatch(/transition:[^;]*transform/);
    // Statuses that appear with the first edit keep their place before it.
    expect(cssBlock('.motif-cs-edit-state[data-idle]')).toMatch(/visibility:\s*hidden/);
    // The export status sits before the title-row Export button in a group
    // packed to the right, so it grows leftward and its arrival moves no control.
    const titleActions = artifactSource.slice(artifactSource.indexOf('<div className="motif-cs-title-actions">'));
    expect(titleActions.indexOf('<ExportDurabilityStatus')).toBeGreaterThanOrEqual(0);
    expect(titleActions.indexOf('<ExportDurabilityStatus')).toBeLessThan(titleActions.indexOf('ref={exportTriggerRef}'));
    expect(cssBlock('.motif-cs-title-actions')).toMatch(/justify-content:\s*flex-end/);
    expect(cssBlock('.motif-cs-sequence-title .motif-cs-export-status[data-resting]')).toMatch(/display:\s*none/);
    // A long receipt cannot push Export or collapse out of the pane or squeeze
    // the name away: it stops at 24ch, it alone shrinks, and the name has a floor.
    expect(cssBlock('.motif-cs-sequence-title .motif-cs-export-status')).toMatch(/max-width:\s*24ch/);
    expect(cssBlock('.motif-cs-sequence-title .motif-cs-export-status')).toMatch(/text-overflow:\s*ellipsis/);
    expect(cssBlock('.motif-cs-sequence-title .motif-cs-title-actions > :not(.motif-cs-export-status)')).toMatch(/flex-shrink:\s*0/);
    expect(cssBlock('.motif-cs-sequence-title > div:first-child')).toMatch(/min-width:\s*min\(104px, 40%\)/);
    expect(artifactSource).toContain("aria-label={copyStatus ?? undefined}");
    expect(artifactSource).toContain("title={copyStatus ? copyStatus : backupStatus === 'saved'");
    // The status line's actions never move when the readout's words change:
    // the readout's basis is fixed (8ch, not its text), it may shrink to 0, the
    // actions neither grow nor shrink, and the line packs them to its far edge.
    expect(cssBlock('.motif-cs-selection-label')).toMatch(/flex:\s*1 1 8ch/);
    expect(cssBlock('.motif-cs-selection-label')).toMatch(/min-width:\s*0/);
    expect(cssBlock('.motif-cs-selection-actions')).toMatch(/flex:\s*0 0 auto/);
    expect(cssBlock('.motif-cs-selection-bar')).toMatch(/justify-content:\s*space-between/);
    // It follows the toolbar in the document and is drawn at the foot.
    expect(cssBlock('.motif-cs-sequence-panel > .motif-cs-selection-bar')).toMatch(/order:\s*1/);
    const chromeAt = artifactSource.indexOf('<div className="motif-cs-sequence-chrome">');
    const barAt = artifactSource.indexOf('className="motif-cs-selection-bar"');
    const viewAt = artifactSource.indexOf('<ArtifactPaneBoundary pane="Sequence" key=');
    expect(chromeAt).toBeGreaterThan(0);
    expect(barAt).toBeGreaterThan(chromeAt);
    expect(barAt).toBeLessThan(viewAt);
  });

  it('keeps the dock controls readable while they wait, disabled, for a selection', () => {
    // Shown at rest, so the shared 0.62 disabled opacity (1.7:1) would not do.
    const disabled = cssBlock('.motif-cs-sequence-panel .motif-cs-selection-actions .motif-cs-mini-button:disabled');
    // The same ink as every other disabled control: --text-secondary at 0.62.
    expect(disabled).toMatch(/color:\s*color-mix\(in srgb, var\(--text-secondary\) 62%, var\(--bg-primary\)\)/);
    expect(disabled).toMatch(/opacity:\s*1/);
    // No box: no button has an edge, so the lighter ink alone says "not now".
    expect(disabled).toMatch(/border-color:\s*transparent/);
  });
});
