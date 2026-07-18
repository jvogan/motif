import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const here = dirname(fileURLToPath(import.meta.url));
const artifactSource = readFileSync(resolve(here, '..', 'motif-artifact.tsx'), 'utf8');
const artifactCss = readFileSync(resolve(here, '..', 'motif-artifact.css'), 'utf8');
const primerWorkspaceSource = readFileSync(resolve(here, '..', 'ClaudeSciencePrimerWorkspace.tsx'), 'utf8');

function sliceBetween(startNeedle: string, endNeedle: string): string {
  const start = artifactSource.indexOf(startNeedle);
  expect(start, `missing source marker: ${startNeedle}`).toBeGreaterThanOrEqual(0);
  const end = artifactSource.indexOf(endNeedle, start);
  expect(end, `missing end marker: ${endNeedle}`).toBeGreaterThan(start);
  return artifactSource.slice(start, end);
}

describe('Claude Science accessibility and interaction guards', () => {
  it('uses deterministic named sequence views', () => {
    expect(artifactSource).toContain("onClick={() => setSequenceViewMode('standard')}");
    expect(artifactSource).toContain("onClick={() => setSequenceViewMode('detail')}");
    expect(artifactSource).not.toContain("current === 'standard' ? 'detail' : 'standard'");
    expect(artifactSource).not.toContain("current === 'detail' ? 'standard' : 'detail'");
  });

  it('connects record tabs to a keyboard-skippable tab panel', () => {
    expect(artifactSource).toContain('<a className="motif-cs-skip-link" href="#motif-cs-workspace">Skip to workspace</a>');
    expect(artifactSource).toContain('aria-controls="motif-cs-workspace"');
    expect(artifactSource).toContain("role={payload.records.length > 0 ? 'tabpanel' : 'region'}");
    expect(artifactSource).toContain('aria-labelledby={payload.records.length > 0 ? `motif-cs-record-tab-${activeRecordTabIndex}` : undefined}');
    expect(artifactSource).toContain("aria-label={payload.records.length === 0 ? 'Sequence workspace; no records open' : undefined}");
    expect(artifactSource).toContain("role={payload.records.length > 0 ? 'tablist' : undefined}");
    expect(artifactCss).toContain('.motif-cs-skip-link:focus-visible');
  });

  it('returns focus to the corresponding top control when a pane disappears', () => {
    expect(artifactSource).toContain('const collapsePaneAndRestoreFocus = useCallback');
    expect(artifactSource).toContain('data-pane-toggle={pane}');
    expect(artifactSource).toContain('`[data-pane-toggle="${pane}"]`');
    expect(artifactSource).toContain("collapsePaneAndRestoreFocus('inventory')");
    expect(artifactSource).toContain("collapsePaneAndRestoreFocus('sequence')");
    expect(artifactSource).toContain("collapsePaneAndRestoreFocus('map')");
    expect(artifactSource).toContain("collapsePaneAndRestoreFocus('tools')");
  });

  it('announces and disables pane-local collapse controls for the last visible or docked content pane', () => {
    expect(artifactSource).toContain('const canHideContentPane = (pane:');
    expect(artifactSource.match(/disabled=\{!canHideContentPane\('/g)).toHaveLength(3);
    expect(artifactSource).toContain('Keep one content pane docked in the workspace');
    expect(artifactCss).toContain('.motif-cs-pane-collapse:disabled');
  });

  it('offers a keyboard alternative to drag-only pane reordering', () => {
    expect(artifactSource).toContain('const handlePaneToggleKeyDown = useCallback');
    expect(artifactSource).toContain("event.altKey || !event.shiftKey");
    expect(artifactSource).toContain('aria-keyshortcuts={paneReorderAvailable');
    expect(artifactSource).toContain('onKeyDown={(event) => handlePaneToggleKeyDown(pane, event)}');
  });

  it('exposes strand, frame, and residue selection state to assistive technology', () => {
    const translationPanel = sliceBetween('function TranslationPanel({', 'const GUIDE_GC_LOW = 0.4;');
    expect(translationPanel).toContain("aria-pressed={strand === 'sense'}");
    expect(translationPanel).toContain("aria-pressed={strand === 'antisense'}");
    expect(translationPanel).toContain('aria-pressed={frame === value}');
    expect(translationPanel).toContain('role="button"');
    expect(translationPanel).toContain('onKeyDown={(event) => handleResidueKeyDown(event, residueIndex)}');
    expect(translationPanel).toContain("event.key !== 'Enter' && event.key !== ' '");
  });

  it('supports keyboard sequence selection with explicit custom-textbox semantics', () => {
    const sequenceText = sliceBetween('function SequenceText({', "if (typeof document !== 'undefined') {");
    expect(sequenceText).toContain('const handleSequenceKeyDown = useCallback');
    expect(sequenceText).toContain("event.shiftKey && !event.metaKey && !event.ctrlKey && !event.altKey");
    expect(sequenceText).toContain('role="textbox"');
    expect(sequenceText).toContain('aria-multiline="true"');
    expect(sequenceText).toContain('aria-readonly={!editable}');
    expect(sequenceText).toContain('aria-keyshortcuts="Shift+ArrowLeft Shift+ArrowRight Shift+Home Shift+End"');
  });

  it('filters pane, sequence, and floating-window drags by primary pointer identity', () => {
    expect(artifactSource.match(/if \(!event\.isPrimary \|\| event\.button !== 0\) return;/g)?.length ?? 0).toBeGreaterThanOrEqual(4);
    expect(artifactSource).toContain('if (moveEvent.pointerId !== pointerId) return;');
    expect(artifactSource).toContain('if (endEvent.pointerId !== pointerId) return;');
    expect(artifactSource).toContain('event.pointerId !== dragPointerIdRef.current');
    expect(artifactSource).toContain('if (moveEvent.pointerId !== dragRef.current?.pointerId) return;');
  });

  it('describes the floating corner as a two-dimensional keyboard resize action', () => {
    const floatingWindow = sliceBetween('function FloatingWindow({', '// One stable Translate panel:');
    expect(floatingWindow).toContain('className="motif-cs-window-resize"');
    expect(floatingWindow).toContain('type="button"');
    expect(floatingWindow).toContain('Resize ${title} window in 2 dimensions');
    expect(floatingWindow).toContain('aria-keyshortcuts="ArrowLeft ArrowRight ArrowUp ArrowDown"');
    expect(floatingWindow).not.toContain('aria-orientation="horizontal"');
    expect(floatingWindow).toContain("window.addEventListener('blur', endDragFromBlur)");
    expect(floatingWindow).toContain("dragSurface.addEventListener('lostpointercapture', endLostPointerCapture)");
  });

  it('keeps a background workflow mounted but inert while a child workflow is active', () => {
    const floatingWindow = sliceBetween('function FloatingWindow({', '// One stable Translate panel:');
    expect(floatingWindow).toContain('inactive = false');
    expect(floatingWindow).toContain('if (inactive) return;');
    expect(floatingWindow).toContain('aria-hidden={inactive || undefined}');
    expect(floatingWindow).toContain('inert={inactive || undefined}');
    expect(floatingWindow).toContain('data-inactive={inactive || undefined}');
    expect(artifactCss).toContain('.motif-cs-window[data-inactive]');
    expect(artifactCss).toContain('pointer-events: none');
  });

  it('keeps validation feedback inline and polite', () => {
    expect(artifactSource).toContain('className="motif-cs-import-status" data-error={statusError || undefined} role={statusError ? \'alert\' : \'status\'} aria-live={statusError ? \'assertive\' : \'polite\'} aria-atomic="true"');
    expect(artifactSource).toContain('className="motif-cs-chip" role="status" aria-live="polite" aria-atomic="true"');
    expect(artifactCss).toMatch(/\.motif-cs-import-status\s*\{[\s\S]*?overflow-wrap:\s*anywhere/);
  });

  it('associates range and custom-enzyme errors with their fields', () => {
    expect(artifactSource.match(/aria-describedby=\{!rangeValidation\.valid \? 'motif-cs-feature-range-error' : undefined\}/g)).toHaveLength(2);
    expect(artifactSource).toContain('id="motif-cs-feature-range-error"');
    expect(artifactSource.match(/aria-describedby=\{!rangeValidation\.valid \? 'motif-cs-translation-range-error' : undefined\}/g)).toHaveLength(2);
    expect(artifactSource).toContain('id="motif-cs-translation-range-error"');
    expect(artifactSource.match(/aria-describedby=\{status \? 'motif-cs-add-enzyme-status' : undefined\}/g)).toHaveLength(2);
    expect(artifactSource).toContain('id="motif-cs-add-enzyme-status"');
  });

  it('gives every primer numeric field stable browser metadata', () => {
    const names = [
      'primer-target-start',
      'primer-target-end',
      'primer-target-tm',
      'primer-tm-tolerance',
      'primer-min-length',
      'primer-max-length',
      'primer-min-gc',
      'primer-max-gc',
      'primer-flanking-window',
    ];
    for (const name of names) {
      expect(primerWorkspaceSource).toContain(`name="${name}"`);
    }
    expect(primerWorkspaceSource.match(/name="primer-[^"]+" type="number" inputMode=/g)).toHaveLength(names.length);
    expect(primerWorkspaceSource.match(/name="primer-[^"]+" type="number" inputMode="(?:numeric|decimal)" autoComplete="off"/g)).toHaveLength(names.length);
  });
});
