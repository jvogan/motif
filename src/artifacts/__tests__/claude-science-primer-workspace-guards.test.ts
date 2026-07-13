import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const component = readFileSync(new URL('../ClaudeSciencePrimerWorkspace.tsx', import.meta.url), 'utf8');
const css = readFileSync(new URL('../claude-science-primer-workspace.css', import.meta.url), 'utf8');
const host = readFileSync(new URL('../motif-artifact.tsx', import.meta.url), 'utf8');

describe('Claude Science primer workspace source guards', () => {
  it('keeps all mutations behind explicit host callbacks', () => {
    expect(component).toContain('onAddAnnotations?:');
    expect(component).toContain('onSimulatePcr?:');
    expect(component).toContain('onUseForCloning?:');
    expect(component).not.toContain('useSequenceStore');
    expect(component).not.toContain('innerHTML');
    expect(component).not.toContain('localStorage');
  });

  it('keeps advanced cloning tails disclosed and labels long-lived controls', () => {
    expect(component).toContain('<details className="motif-cs-primer-advanced">');
    expect(component).toContain('aria-live="polite"');
    expect(component).toContain('aria-label="Ranked primer pairs"');
    expect(component).toContain("role={embedded ? 'region' : 'dialog'}");
    expect(component).toContain("aria-label={embedded ? 'Primer design' : undefined}");
    expect(component).toContain('preparationContext?: ClaudeSciencePrimerPreparationContext | null;');
    expect(component).toContain('initialForwardTail?: string;');
    expect(component).toContain('initialReverseTail?: string;');
    expect(component).toContain('aria-label="Cloning preparation context"');
    expect(component).toContain("preparationContext ? 'Save primer plan' : 'Use in cloning'");
    expect(component).toContain('It does not create an amplicon or modify the source record');
    expect(component).toContain('No homology tail was inferred');
    expect(component).toContain("if (preferFullRecord) return { start: 1, end: sequenceLength };");
  });

  it('preserves cloning actions, provenance, and save-then-advance behavior', () => {
    expect(host).toContain('cloningPrimerRequest.actionIds.flatMap((actionId) =>');
    expect(host).toContain('requestSha256: handoff.preparationContext.requestSha256');
    expect(host).toContain('actionId: handoff.preparationContext.actionId');
    expect(host).toContain('actionKind: handoff.preparationContext.actionKind');
    expect(host).toContain('orientation: handoff.preparationContext.orientation');
    expect(host).toContain("if (!junction?.overlapSequence) return { forward: undefined, reverse: undefined };");
    expect(host).toContain('No prepared amplicon was created.');
    expect(host).toContain('navigateCloningPrimerRecord(wrappedIndex);');
    expect(host).toContain("setShowPrimerDesign(false);\n    showWorkbenchNotice('Primer-plan worklist saved. Returned to the existing cloning draft. No amplicon was created.');");
  });

  it('uses theme tokens and quiet selected states without glow or one-sided accent rails', () => {
    expect(css).toContain('var(--bg-primary)');
    expect(css).toContain('var(--text-primary)');
    expect(css).toContain('.motif-cs-primer-pair-row[data-selected]');
    expect(css).toContain('.motif-cs-primer-preparation-context');
    expect(css).not.toMatch(/box-shadow:\s*0\s+0\s+\d/);
    expect(css).not.toMatch(/border-left:\s*[2-9]px/);
    expect(css).not.toContain('linear-gradient');
  });

  it('bounds both workspace axes and adapts at narrow widths', () => {
    expect(css).toContain('max-width: calc(100vw - 16px)');
    expect(css).toContain('max-height: calc(100dvh - 16px)');
    expect(css).toContain('@media (max-width: 840px)');
    expect(css).toContain('scrollbar-gutter: stable');
  });
});
