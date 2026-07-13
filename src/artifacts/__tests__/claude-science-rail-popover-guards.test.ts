import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const here = dirname(fileURLToPath(import.meta.url));
const artifactSource = readFileSync(resolve(here, '..', 'motif-artifact.tsx'), 'utf8');
const artifactCss = readFileSync(resolve(here, '..', 'motif-artifact.css'), 'utf8');
const dataSettingsSource = readFileSync(resolve(here, '..', 'ClaudeScienceDataSettings.tsx'), 'utf8');
const primerWorkspaceSource = readFileSync(resolve(here, '..', 'ClaudeSciencePrimerWorkspace.tsx'), 'utf8');

describe('Claude Science rail popover regression guards', () => {
  it('dismisses tool popovers with Escape, their close button, or an outside pointer press', () => {
    const dismissEffectStart = artifactSource.indexOf('const openPanel = () =>');
    const dismissEffectEnd = artifactSource.indexOf('}, [toolsPinned]);', dismissEffectStart);
    const dismissEffect = artifactSource.slice(dismissEffectStart, dismissEffectEnd);
    expect(artifactSource).toContain('data-testid="rail-popover-close"');
    expect(artifactSource).toContain('aria-label={`Close ${title}`}');
    expect(artifactSource).toContain("document.addEventListener('keydown', closeFromEscape)");
    expect(artifactSource).toContain("panel.querySelector<HTMLElement>(':scope > summary')?.focus({ preventScroll: true })");
    expect(dismissEffect).toContain("document.addEventListener('pointerdown', closeFromOutsidePointer, true)");
    expect(dismissEffect).toContain("document.removeEventListener('pointerdown', closeFromOutsidePointer, true)");
  });

  it('keeps Annotations open while record-specific editor state resets', () => {
    expect(artifactSource).toContain('useEffect(() => {\n    setOpen(defaultOpen);\n  }, [defaultOpen]);');
    expect(artifactSource).toContain('useEffect(() => {\n    setEditorOpen(false);\n    setShownFeatureCount(ANNOTATION_LIST_PAGE_SIZE);\n    setShownTranslationCount(ANNOTATION_LIST_PAGE_SIZE);\n  }, [recordId]);');
    expect(artifactSource).not.toContain('}, [defaultOpen, recordId]);');
  });

  it('keeps annotation rows bounded while revealing externally selected off-page rows', () => {
    const featureListStart = artifactSource.indexOf('function FeatureList({');
    const featureListEnd = artifactSource.indexOf('function RailPopoverTitle(', featureListStart);
    const featureList = artifactSource.slice(featureListStart, featureListEnd);

    expect(artifactSource).toContain('const ANNOTATION_LIST_PAGE_SIZE = 120;');
    expect(featureList).toContain('const visibleFeatures = features.slice(0, shownFeatureCount);');
    expect(featureList).toContain('if (selectedFeatureIndex >= shownFeatureCount)');
    expect(featureList).toContain('visibleFeatures.push(features[selectedFeatureIndex]);');
    expect(featureList).toContain('visibleFeatures.map((feature) => (');
    expect(featureList).toContain('data-active={feature.id === selectedFeatureId || undefined}');

    expect(featureList).toContain('const visibleTranslationTracks = translationTracks.slice(0, shownTranslationCount);');
    expect(featureList).toContain('translationTracks.slice(shownTranslationCount).forEach((track) => {');
    expect(featureList).toContain('if (isTranslationTrackActive(track)) visibleTranslationTracks.push(track);');
    expect(featureList).toContain('visibleTranslationTracks.map((track) => {');
    expect(featureList).not.toContain('translationTracks.map((track) => {');
    expect(featureList).toContain('setShownTranslationCount((count) => Math.min(translationTracks.length, count + ANNOTATION_LIST_PAGE_SIZE))');
    expect(featureList).toContain('more translations');
  });

  it('keeps the close control visible while a long editor scrolls', () => {
    expect(artifactCss).toMatch(
      /\.motif-cs-inspector\[data-tools-pinned="false"\] \.motif-cs-rail-popover-title\s*\{[\s\S]*?position:\s*sticky;[\s\S]*?top:\s*0;/,
    );
    expect(artifactCss).toContain('.motif-cs-rail-popover-close');
  });

  it('keeps the collapsed rail and its open popover interactive above floating workspaces', () => {
    expect(artifactCss).toMatch(
      /\.motif-cs-inspector\[data-tools-pinned="false"\]\s*\{[\s\S]*?z-index:\s*70;[\s\S]*?pointer-events:\s*none;/,
    );
    expect(artifactCss).toMatch(
      /\.motif-cs-inspector\[data-tools-pinned="false"\] \.motif-cs-pane-title,[\s\S]*?\.motif-cs-inspector\[data-tools-pinned="false"\] \.motif-cs-panel\s*\{[\s\S]*?pointer-events:\s*auto;/,
    );
    expect(artifactCss).toMatch(
      /\.motif-cs-inspector\[data-tools-pinned="false"\] \.motif-cs-panel\[open\] > \.motif-cs-tool-panel-body\s*\{[\s\S]*?z-index:\s*70;/,
    );
    expect(artifactCss).toMatch(/\.motif-cs-window\s*\{[\s\S]*?z-index:\s*60;/);
    const compactLayout = artifactCss.slice(artifactCss.indexOf('@media (max-width: 1535px)'));
    expect(compactLayout).toMatch(
      /\.motif-cs-inspector\[data-tools-pinned="false"\]\s*\{[\s\S]*?z-index:\s*70;/,
    );
    expect(artifactCss).toMatch(
      /\.motif-cs-window:has\(\.motif-cs-msa-workspace\)[\s\S]*?\.motif-cs-window-body\s*\{[\s\S]*?padding-right:\s*58px;/,
    );
  });

  it('requires an explicit second action in the detailed annotation editors', () => {
    expect(artifactSource).toContain('function ConfirmDeleteButton({');
    expect(artifactSource).toContain('{armed ? confirmLabel : idleLabel}');
    expect(artifactSource).toContain('noun="selected feature"');
    expect(artifactSource).toContain('noun="translation layer"');
    expect(artifactSource).toContain('event.stopPropagation();');
    expect(artifactCss).toContain('.motif-cs-confirm-delete[data-armed="true"]');
  });

  it('keeps external selections quiet and offers selected pinned translations a row delete action', () => {
    expect(artifactSource).not.toContain('autoOpenOnSelection');
    expect(artifactSource).not.toContain('editorAutoOpen');
    expect(artifactSource).toContain('const canDelete = active;');
    expect(artifactSource).toContain("if (layerId.startsWith('feat:'))");
    expect(artifactSource).toContain('setHiddenFeatureTranslationsByRecord');
    expect(artifactSource).toContain('aria-label={`Delete pinned translation ${track.label}`}');
    expect(artifactSource).toContain('onDeleteTranslationTrack(track.id);');
    expect(artifactSource).toContain("fallback?.focus({ preventScroll: true })");
    expect(artifactCss).toContain('.motif-cs-translation-row-delete');
  });

  it('shows local sequence context for every visible motif hit', () => {
    expect(artifactSource).toContain('function motifHitContext(');
    expect(artifactSource).toContain('const context = motifHitContext(sequence, hit, cleanedMotifLength, 10, topology);');
    expect(artifactSource).toContain('className="motif-cs-motif-hit-position"');
    expect(artifactSource).toContain('className="motif-cs-motif-hit-context"');
    expect(artifactSource).toContain('<mark>{context.match}</mark>');
    expect(artifactSource).toContain('aria-label={`Jump to motif hit at ${hit + 1}: ${contextLabel}`}');
    expect(artifactCss).toContain('.motif-cs-motif-hit-list');
    expect(artifactCss).toContain('.motif-cs-motif-hit-context mark');
    expect(artifactSource).not.toContain('className="motif-cs-hit-chip"');
  });

  it('scopes guide generation to the active feature or selected range', () => {
    expect(artifactSource).toContain('function findGuidesInRange(');
    expect(artifactSource).toContain('const scopedSequence = sequenceForRange(sequence, range, topology);');
    expect(artifactSource).toContain('const start = coordinateAtRangeOffset(spans, guide.start);');
    expect(artifactSource).toContain('scopeRange={guideScopeRange}');
    expect(artifactSource).toContain('findGuidesInRange(sequence, sequenceType, nuclease, activeScopeRange, topology)');
    expect(artifactSource).toContain("<span>{activeScopeRange ? 'Selected range' : 'Whole record'}</span>");
    expect(artifactSource).toContain('previewSelectionRef.current = `${start}:${end}`;');
    expect(artifactSource).toContain('if (previewSelectionRef.current === scopeKey)');
    expect(artifactCss).toContain('.motif-cs-guide-scope[data-scoped="true"] strong');
  });

  it('offers shared translation controls in the rail and a detachable window', () => {
    expect(artifactSource).toContain('data-rail-tool="translation"');
    expect(artifactSource).toContain('<TranslationPanel');
    expect(artifactSource).toContain('onOpenFloating={openTranslationsWindow}');
    expect(artifactSource).toContain('>Add AA track</button>');
    expect(artifactSource).toContain('>New protein</button>');
    expect(artifactSource).toContain('>Pop out</button>');
    expect(artifactCss).toContain('.motif-cs-translation-tool-body > .motif-cs-translation-body');
  });

  it('materializes selected feature and translation annotations as derived records', () => {
    expect(artifactSource).toContain('const addSelectedFeatureRecord = useCallback(() => {');
    expect(artifactSource).toContain("operation: 'extract_feature'");
    expect(artifactSource).toContain('onCreateRecord={addSelectedFeatureRecord}');
    expect(artifactSource).toContain('title="Extract the selected feature as a new inventory entry"');
    expect(artifactSource).toContain('const addTranslationTrackRecord = useCallback((track: InlineTranslationTrack) => {');
    expect(artifactSource).toContain('onAddRecord={() => addTranslationTrackRecord(selectedTranslationLayer)}');
    expect(artifactSource).toMatch(/function TranslationLayerEditor\([\s\S]*?>New protein<\/button>/);
    expect(artifactSource).toContain("selectedInlineTranslationTrack?.source === 'feature'");
    expect(artifactSource).toContain('onCreateProteinRecord={');
  });

  it('uses the production primer engine for a selected-region rail workflow', () => {
    expect(primerWorkspaceSource).toContain('designPrimerPairWithDiagnostics');
    expect(artifactSource).toContain('data-rail-tool="primer-design"');
    expect(artifactSource).toContain('data-testid="open-primer-workspace"');
    expect(artifactSource).toContain('<ClaudeSciencePrimerWorkspace');
    expect(artifactSource).toContain('selectedRange={cloningPrimerRequest ? null : guideScopeRange}');
    expect(primerWorkspaceSource).toContain('targetStart: targetStart - 1');
    expect(artifactSource).toContain('const addFeatures = useCallback((featureInputs: readonly ArtifactFeatureInput[]) => {');
    expect(primerWorkspaceSource).toContain('primerToFeature(handoff.pair.forward');
    expect(primerWorkspaceSource).toContain('primerToFeature(handoff.pair.reverse');
    expect(primerWorkspaceSource).toContain('onSelectRange?.(pair.forward.start, pair.reverse.end)');
    expect(artifactSource).toContain('onSaveDesign={(handoff) => {');
    expect(artifactSource).toContain('savePrimerDesignResult(handoff);');
  });

  it('invalidates primer results when a same-length sequence edit changes the template', () => {
    expect(primerWorkspaceSource).toContain('[record.sequence]');
    expect(primerWorkspaceSource).toContain('[normalizedSequence, parameters, validationMessage]');
  });

  it('invalidates actionable primer pairs whenever design inputs change', () => {
    expect(primerWorkspaceSource).toContain('const parameters = useMemo<PrimerDesignParams>');
    expect(primerWorkspaceSource).toContain('const result = useMemo<PrimerPairResult | null>');
    expect(primerWorkspaceSource).toContain('const markCustom = useCallback(() => {');
    expect(primerWorkspaceSource).toMatch(/value=\{targetStart\}[\s\S]*?markCustom\(\)/);
    expect(primerWorkspaceSource).toMatch(/value=\{targetEnd\}[\s\S]*?markCustom\(\)/);
    expect(primerWorkspaceSource).toMatch(/value=\{targetTm\}[\s\S]*?markCustom\(\)/);
    expect(primerWorkspaceSource).toMatch(/value=\{minLength\}[\s\S]*?markCustom\(\)/);
    expect(primerWorkspaceSource).toMatch(/value=\{maxLength\}[\s\S]*?markCustom\(\)/);
  });

  it('does not reset a selected feature editor when unrelated annotations are added', () => {
    expect(artifactSource).toMatch(/useEffect\(\(\) => \{\s*if \(selectedFeature\) return;\s*setName\(`misc_feature_/);
    expect(artifactSource).toContain('}, [featureCount, selectedFeature, sequenceLength, sequenceType]);');
  });

  it('clears a selected AA track when selection context changes', () => {
    const backgroundHandler = artifactSource.slice(
      artifactSource.indexOf('const handleMapBackgroundClick = useCallback(() => {'),
      artifactSource.indexOf('const handleFeatureClick = useCallback', artifactSource.indexOf('const handleMapBackgroundClick = useCallback(() => {')),
    );
    const restrictionHandler = artifactSource.slice(
      artifactSource.indexOf('const handleRestrictionClick = useCallback'),
      artifactSource.indexOf('const handleSequenceRestrictionClick = useCallback', artifactSource.indexOf('const handleRestrictionClick = useCallback')),
    );
    expect(backgroundHandler).toContain('setSelectedTranslationLayerByRecord');
    expect(restrictionHandler).toContain('setSelectedTranslationLayerByRecord');
  });

  it('keeps explicit restriction-source off choices sticky and reports both cut bonds', () => {
    const sourceToggle = artifactSource.slice(
      artifactSource.indexOf('const setEnzymeSourceEnabled = useCallback'),
      artifactSource.indexOf('const setEnzymeVisible = useCallback'),
    );
    expect(sourceToggle).toContain('delete lastVisibleEnzymeSourcesRef.current[recordId]');
    expect(artifactSource).toContain('const cutLabel = geometry');
    expect(artifactSource).toContain('`cuts ${geometry.senseCut + 1}/${geometry.antisenseCut + 1}`');
    expect(artifactSource).toContain("overhang === '5prime' ? \"5′\" : overhang === '3prime' ? \"3′\" : 'blunt'");
  });

  it('fails closed on wrapped primer targets while preserving circular translation scopes', () => {
    expect(primerWorkspaceSource).toContain('selectedRange.end > selectedRange.start');
    expect(primerWorkspaceSource).toContain('Use a non-wrapping target inside');
    expect(artifactSource).toContain('topology={topology}');
    expect(artifactSource).toContain("endIndex1 < startIndex1 && topology !== 'circular'");
    expect(artifactSource).toContain('const internalEndIndex = endIndex1 < startIndex1 ? sequenceLength + endIndex1 : endIndex1;');
    expect(artifactSource).toContain('mapRangeLabel({ start: track.start, end: track.end }, sequenceLength)');
  });

  it('distinguishes reverse-complement copy and record creation actions', () => {
    expect(artifactSource).toMatch(/>\s*Copy rev comp\s*<\/button>/);
    expect(artifactSource).toContain('>New rev comp</button>');
    expect(artifactSource).not.toContain('>Rev comp</button>\n            <button className="motif-cs-mini-button" type="button" onClick={onAddReverseComplement}');
  });

  it('wraps narrow rail labels and marks the open tool without a one-sided accent bar', () => {
    expect(artifactCss).toMatch(/\.motif-cs-inspector\[data-tools-pinned="true"\] details\[open\] > \.motif-cs-panel-head\s*\{[\s\S]*?box-shadow:\s*inset 0 0 0 1px/);
    expect(artifactCss).toMatch(/\.motif-cs-inspector\[data-tools-pinned="false"\] \.motif-cs-panel\[open\] > \.motif-cs-panel-head\s*\{[\s\S]*?border-color:[\s\S]*?box-shadow:\s*none/);
    expect(artifactCss).toMatch(/\.motif-cs-row\[data-active="true"\]\s*\{[\s\S]*?box-shadow:\s*none/);
    expect(artifactCss).toMatch(/\.motif-cs-theme-choice\[data-active="true"\]\s*\{[\s\S]*?box-shadow:\s*none/);
    expect(artifactCss).toMatch(/\.motif-cs-inspector\[data-tools-pinned="true"\] \.motif-cs-panel-head > span:first-of-type\s*\{[\s\S]*?white-space:\s*normal/);
    expect(artifactCss).toMatch(/\.motif-cs-motif-hit-context\s*\{[\s\S]*?white-space:\s*normal[\s\S]*?overflow-wrap:\s*anywhere/);
  });

  it('gives workflow history a distinct rail icon from analysis', () => {
    const workflowStart = artifactSource.indexOf('data-rail-tool="workflows"');
    const workflowEnd = artifactSource.indexOf('data-rail-tool="alignment"', workflowStart);
    const workflowPanel = artifactSource.slice(workflowStart, workflowEnd);
    expect(workflowPanel).toContain('<History className="motif-cs-panel-icon"');
    expect(workflowPanel).not.toContain('<Activity className="motif-cs-panel-icon"');
  });

  it('keeps Settings and About as the last inward-opening rail tool', () => {
    expect(artifactSource).toContain('data-rail-tool="settings"');
    expect(artifactSource).toContain('<Settings className="motif-cs-panel-icon"');
    expect(artifactSource).toContain('<strong>Motif for Claude Science</strong>');
    expect(artifactSource).toContain("const MOTIF_ARTIFACT_VERSION = '0.2.0';");
    expect(artifactSource).toContain('<span>Version {MOTIF_ARTIFACT_VERSION}</span>');
    expect(artifactSource).not.toContain('__APP_VERSION__');
    expect(artifactSource).toContain('Motif is an open-source, AI-native molecular biology suite for researchers.');
    expect(artifactSource).toContain('<span>By Jacob Vogan</span>');
    expect(artifactSource).toContain('type="radio"');
    expect(artifactSource).toContain('name="settings-theme"');
    expect(dataSettingsSource).toContain('Reset display');
    expect(artifactSource).toContain('Download a workspace backup to carry records, alignments, notes, results');
    expect(artifactCss).toContain('.motif-cs-about-block');
    expect(artifactCss).toContain('.motif-cs-theme-grid');
  });

  it('lets dense rail popovers open taller and resize from a visible corner', () => {
    expect(artifactCss).toMatch(/\.motif-cs-inspector\[data-tools-pinned="false"\] \.motif-cs-panel\[open\] > \.motif-cs-tool-panel-body\s*\{[\s\S]*?max-width:\s*min\(620px,[\s\S]*?resize:\s*both/);
    expect(artifactCss).toContain('background-image: linear-gradient(135deg');
    expect(artifactCss).toMatch(/@media \(max-width: 1280px\)[\s\S]*?max-height:\s*min\(calc\(100vh - var\(--rail-popover-fixed-top\) - 22px\), 600px\)/);
  });

  it('cleans up floating-window pointer listeners when a drag is interrupted', () => {
    expect(artifactSource).toContain('const dragCleanupRef = useRef<(() => void) | null>(null);');
    expect(artifactSource).toContain('const stopActiveDrag = useCallback((commit: boolean) => {');
    expect(artifactSource).toContain('dragCleanupRef.current?.();');
    expect(artifactSource).toContain('useEffect(() => () => stopActiveDrag(false), [stopActiveDrag]);');
    expect(artifactSource).toContain('stopActiveDrag(true);');
    expect(artifactSource).toContain('dragCleanupRef.current = removeDragListeners;');
  });
});
