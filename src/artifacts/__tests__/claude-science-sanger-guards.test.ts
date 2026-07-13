import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const here = dirname(fileURLToPath(import.meta.url));
const artifactSource = readFileSync(resolve(here, '..', 'motif-artifact.tsx'), 'utf8');
const msaSource = readFileSync(resolve(here, '..', 'ClaudeScienceMsaViewer.tsx'), 'utf8');
const traceSource = readFileSync(resolve(here, '..', 'ClaudeScienceSangerTraceViewer.tsx'), 'utf8');
const artifactCss = readFileSync(resolve(here, '..', 'motif-artifact.css'), 'utf8');
const helperSource = readFileSync(resolve(
  here,
  '..',
  'motif-for-claude-science-plugin',
  'skills',
  'motif-for-claude-science',
  'scripts',
  'create-artifact.mjs',
), 'utf8');

describe('Claude Science Sanger workflow guards', () => {
  it('reads AB1 as bounded binary data and carries the complete JSON-safe trace into a record', () => {
    expect(artifactSource).toContain("if (/\\.(?:ab1|abi)$/i.test(file.name))");
    expect(artifactSource).toContain('if (file.size > ABI_IMPORT_LIMITS.maxFileBytes)');
    expect(artifactSource).toContain('parseAbiImport(await file.arrayBuffer(), baseName)');
    expect(artifactSource).toContain('sangerTrace: parsed.sangerTrace');
    expect(artifactSource).toContain("operation: 'import_ab1'");
    expect(artifactSource).not.toContain('parseAbiImport(await file.text()');
  });

  it('round-trips trace data and detaches it explicitly when calls are edited', () => {
    expect(artifactSource).toContain('sangerTrace?: SangerTraceData;');
    expect(artifactSource).toContain('normalizeArtifactSangerTrace(record.sangerTrace, sequence)');
    expect(artifactSource).toContain('sangerTrace: record.sangerTrace');
    expect(artifactSource).toContain('sangerTrace: snap.sangerTrace');
    expect(artifactSource).toContain('sangerTrace: undefined');
    expect(artifactSource).toContain('Undo restores the trace.');
  });

  it('offers the trace view only for an alignment row that truly links to the calls', () => {
    expect(msaSource).toContain('const traceAvailable = activeAlignment ? hasLinkedSangerTrace(activeAlignment, records) : false;');
    expect(msaSource).toContain("displayMode === 'trace'");
    expect(msaSource).toContain('>Traces</button>');
    expect(msaSource).toContain('<ClaudeScienceSangerTraceViewer');
    expect(traceSource).toContain("return orientation === 'unlinked' ? []");
    expect(traceSource).toContain("traceOrientationForAlignedRow(record.sangerTrace, row.aligned)");
    expect(traceSource).toContain('return candidates.length === 1 ? candidates : [];');
  });

  it('renders a scroll-windowed canvas with quality, mismatch, zoom, pointer, and keyboard controls', () => {
    expect(traceSource).toContain('const drawScrollLeft = scrollerRef.current?.scrollLeft ?? scrollLeft;');
    expect(traceSource).toContain('const visibleStart = Math.max(0, Math.floor(drawScrollLeft / cellWidth) - 2);');
    expect(traceSource).toContain('const stride = Math.max(1, Math.ceil((sampleEnd - sampleStart + 1) / 4_000));');
    expect(traceSource).toContain('if (scrollFrameRef.current !== null) return;');
    expect(traceSource).toContain('onScroll={(event) => handleScroll(event.currentTarget.scrollLeft)}');
    expect(traceSource).toContain('if (canvas.width !== pixelWidth) canvas.width = pixelWidth;');
    expect(traceSource).toContain('traceCenteredScrollLeft(');
    expect(traceSource).toContain('traceFitCellWidth(');
    expect(traceSource).toContain("window.matchMedia?.('(prefers-reduced-motion: reduce)').matches");
    expect(traceSource).toContain('onPointerDown={chooseColumn}');
    expect(traceSource).toContain("event.key !== 'ArrowLeft' && event.key !== 'ArrowRight'");
    expect(traceSource).toContain('type="range"');
    expect(traceSource).toContain('quality.q20Percent.toFixed(1)');
    expect(artifactCss).toMatch(/\.motif-cs-sanger-scroll\s*\{[\s\S]*?overflow-x:\s*auto/);
    expect(artifactCss).toMatch(/\.motif-cs-sanger-canvas:focus-visible\s*\{[\s\S]*?outline:/);
  });

  it('supports a synchronized, virtualized stacked-read review without losing the single-read workflow', () => {
    expect(traceSource).toContain("type SangerViewMode = 'stacked' | 'single';");
    expect(traceSource).toContain("'motif.claude-science.sanger-view.v1'");
    expect(traceSource).toContain('sangerTraceSessionByAlignment');
    expect(traceSource).toContain("data-testid=\"sanger-trace-stack-scroll\"");
    expect(traceSource).toContain("data-testid=\"sanger-trace-lane\"");
    expect(traceSource).toContain("aria-label=\"Chromatogram layout\"");
    expect(traceSource).toContain('index >= firstVisibleLane && index < lastVisibleLane');
    expect(traceSource).toContain('showQuality={showQuality}');
    expect(traceSource).toContain("scroller.closest<HTMLElement>('.motif-cs-window-body')");
    expect(traceSource).toContain("scroller.addEventListener('wheel', chainStackWheel, { passive: false });");
    expect(msaSource).toContain('key={activeAlignment.id}');
    expect(artifactCss).toMatch(/\.motif-cs-sanger-stack-scroll\s*\{[\s\S]*?overflow:\s*auto/);
    expect(artifactCss).toMatch(/\.motif-cs-sanger-stack-scroll\s*\{[\s\S]*?overscroll-behavior-y:\s*auto/);
    expect(artifactCss).toMatch(/\.motif-cs-sanger-lane\[data-active\] \.motif-cs-sanger-lane-header\s*\{[\s\S]*?border-left-color:\s*transparent[\s\S]*?background:\s*color-mix\(in srgb, var\(--accent\) 7%, var\(--bg-secondary\)\)/);
  });

  it('keeps chromatogram styling calm and free of decorative glow effects', () => {
    const sangerCss = artifactCss.slice(
      artifactCss.indexOf('.motif-cs-sanger-viewer'),
      artifactCss.indexOf('/* Stable Translate panel'),
    );
    expect(sangerCss).not.toMatch(/box-shadow|text-shadow|drop-shadow|(?:linear|radial)-gradient/i);
  });

  it('applies the same trace safety boundary to payloads created by the shareable plugin helper', () => {
    expect(helperSource).toContain("const SANGER_TRACE_SCHEMA = 'motif.sanger-trace.v1';");
    expect(helperSource).toContain('function validateSangerTrace(trace, path, recordSequence, recordType)');
    expect(helperSource).toContain('MAX_SANGER_TRACE_SAMPLES_PER_WORKSPACE');
    expect(helperSource).toContain('totalSangerTraceSamples += validateSangerTrace(');
  });
});
