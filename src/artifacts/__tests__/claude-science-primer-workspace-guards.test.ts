import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const component = readFileSync(new URL('../ClaudeSciencePrimerWorkspace.tsx', import.meta.url), 'utf8');
const css = readFileSync(new URL('../claude-science-primer-workspace.css', import.meta.url), 'utf8');
const host = readFileSync(new URL('../motif-artifact.tsx', import.meta.url), 'utf8');
const materialization = readFileSync(new URL('../claude-science-pcr-materialization.ts', import.meta.url), 'utf8');

describe('Claude Science primer workspace source guards', () => {
  it('keeps all mutations behind explicit host callbacks', () => {
    expect(component).toContain('onAddAnnotations?:');
    expect(component).toContain('onSimulatePcr?:');
    expect(component).toContain('onCreateAmplicon?:');
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
    expect(component).toContain('Save primer plan only');
    expect(component).toContain('Create & use amplicon');
    expect(component).toContain('Simulate PCR: saves a PCR result.');
    expect(component).toContain('Keeps the original record.');
    expect(component).toContain('Enter the 5′ tail under Advanced constraints before saving.');
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
    expect(host).toContain('materializePcrAmplicon({');
    expect(host).toContain('replacePreparedPart({');
    expect(host).toContain('PCR simulation saved in Results only. No sequence record was created.');
    expect(host).toContain('engineVersion: simulation.provenance.engineVersion');
    expect(host).toContain('productAssembly: simulation.provenance.productAssembly');
    expect(host).toContain('topology: template.topology');
    expect(materialization).toContain('topology: sourceRecord.topology');
    expect(host).toContain('navigateCloningPrimerRecord(wrappedIndex);');
    expect(host).toContain("setShowPrimerDesign(false);\n    showWorkbenchNotice('Primer-plan worklist saved. Returned to the existing cloning draft. No amplicon was created.');");
  });

  it('uses theme tokens and quiet selected states without glow or one-sided accent rails', () => {
    expect(css).toContain('var(--bg-primary)');
    expect(css).toContain('var(--text-primary)');
    expect(css).toContain('.motif-cs-primer-pair-row[data-selected]');
    expect(css).toContain('.motif-cs-primer-preparation-context');
    // No glow: a blurred shadow is banned. The chosen purpose is the one "on" fill with no
    // ring, inside the group's field edge, like every segmented control.
    expect(css).not.toMatch(/box-shadow:\s*0\s+0\s+[1-9]/);
    expect(css).toMatch(/\.motif-cs-primer-intent label\[data-checked\] \{[^}]*background: var\(--bg-active\);[^}]*box-shadow: none;/);
    expect(css).not.toMatch(/border-left:\s*[2-9]px/);
    expect(css).not.toContain('linear-gradient');
  });

  it('bounds both workspace axes and adapts at narrow widths', () => {
    expect(css).toContain('max-width: calc(100vw - 16px)');
    expect(css).toContain('max-height: calc(100dvh - 16px)');
    // The window stacks on its own width, not the viewport's, so a window
    // narrower than the panel still gets the narrow layout.
    expect(css).toContain('container-type: inline-size');
    expect(css).toContain('@container (max-width: 760px)');
    expect(css).toContain('@container (max-width: 520px)');
    expect(css).not.toContain('@media (max-width: 840px)');
    expect(css).toMatch(/@container \(max-width: 520px\)[\s\S]*\.motif-cs-primer-footer-actions\s*\{[^}]*width:\s*100%;[^}]*grid-template-columns:\s*repeat\(2,/);
    expect(css).toMatch(/\.motif-cs-primer-footer-actions\s*\{[^}]*flex-wrap:\s*wrap;/s);
    expect(css).toContain('scrollbar-gutter: stable');
  });

  it('keeps one header, no kicker lines, and no sub-12px or hardcoded type', () => {
    expect(component).not.toContain('motif-cs-primer-eyebrow');
    expect(component).not.toContain('motif-cs-primer-result-badge');
    expect(css).not.toMatch(/font-size:\s*(?:[0-9]|1[01])(?:\.\d+)?px/);
    expect(css).not.toMatch(/font:\s*(?:[0-9]|1[01])(?:\.\d+)?px/);
    expect(css).not.toMatch(/text-transform:\s*uppercase|letter-spacing:\s*[0-9.]/);
  });

  it('shows the window before the design runs', () => {
    expect(component).toContain('useDeferredValue<PrimerDesignParams | null>(parameters, null)');
    expect(component).toContain('Finding pairs…');
    // No action may carry a pair that belongs to the previous settings.
    expect(component).toContain('selectedPair && designParameters && !designPending');
  });
});
