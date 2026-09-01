import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { CHANNEL_DASH } from '../ClaudeScienceSangerTraceViewer';

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

  it('adapts construct-verification candidates to the engine bounds before launch', () => {
    expect(artifactSource).toContain('ARTIFACT_CONSTRUCT_VERIFICATION_TEXT_LIMITS');
    expect(artifactSource).toContain('record.id.length > ARTIFACT_CONSTRUCT_VERIFICATION_TEXT_LIMITS.maxIdLength');
    expect(artifactSource).toContain('record.sequence.length > ARTIFACT_CONSTRUCT_VERIFICATION_LIMITS.maxReferenceLength');
    expect(artifactSource).not.toContain('readCount >= ARTIFACT_CONSTRUCT_VERIFICATION_LIMITS.maxReads');
    expect(artifactSource).toContain('name: boundedArtifactConstructName(record.name)');
    expect(artifactSource).toContain('excluded by verifier limits');
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

  it('persists view position separately from the inspected call and does not replay handled jumps', () => {
    expect(traceSource).toContain('positionColumn: number | null;');
    expect(traceSource).toContain('handledJump: { column: number; token: number } | null;');
    expect(traceSource).toContain('initialSession?.positionColumn ?? null');
    expect(traceSource).toContain('initialSession?.handledJump');
    expect(traceSource).toContain('setPositionColumn(next);');
    expect(traceSource).toContain('scrollColumnIntoView(next, behavior);');
    expect(traceSource).toContain('handledJump?.alignmentId === alignment.id');
    expect(traceSource).toContain('&& handledJump.column === jumpColumn');
    expect(traceSource).toContain('&& handledJump.token === jumpToken');
    expect(traceSource).toContain('handledJumpRef.current = { alignmentId: alignment.id, column: jumpColumn, token: jumpToken };');
    expect(traceSource).toContain('positionColumn ?? viewportCenterColumn');
    expect(traceSource).toContain("onChange={(event) => movePositionToColumn(Number(event.target.value), 'auto')}");

    const scrollOnlyStart = traceSource.indexOf('const scrollColumnIntoView = useCallback');
    const scrollOnlyEnd = traceSource.indexOf('const movePositionToColumn = useCallback', scrollOnlyStart);
    const scrollOnly = traceSource.slice(scrollOnlyStart, scrollOnlyEnd);
    expect(scrollOnlyStart).toBeGreaterThan(-1);
    expect(scrollOnlyEnd).toBeGreaterThan(scrollOnlyStart);
    expect(scrollOnly).not.toContain('setSelectedColumn');
    expect(scrollOnly).not.toContain('setPositionColumn');
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

/* The chromatogram's four dye channels are told apart by hue alone unless a
   curve also carries a dash. Simulating the shipped tokens shows hue is not
   enough: see CHANNEL_DASH in ClaudeScienceSangerTraceViewer for the numbers.
   This guard recomputes them from the stylesheet so that changing --red,
   --green, --purple or --text-primary, or dropping a dash, fails here rather
   than silently in a dark theme. */
const THEME_BLOCKS: Record<string, string> = {
  light: 'html[data-theme="light"]',
  'claude-light': 'html[data-theme="claude-light"]',
  dark: 'html[data-theme="dark"]',
  'claude-dark': 'html[data-theme="claude-dark"]',
};

function themeTokens(selector: string): Record<string, string> {
  const at = artifactCss.indexOf(selector);
  if (at < 0) throw new Error(`no theme block for ${selector}`);
  const open = artifactCss.indexOf('{', at);
  const body = artifactCss.slice(open + 1, artifactCss.indexOf('\n}', open));
  const tokens: Record<string, string> = {};
  for (const [, name, value] of body.matchAll(/(--[\w-]+):\s*([^;]+);/g)) tokens[name] = value.trim();
  return tokens;
}

function srgb(hex: string): [number, number, number] {
  const m = /^#([\da-f]{6})$/i.exec(hex);
  if (!m) throw new Error(`not a hex colour: ${hex}`);
  const n = Number.parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

const toLinear = (v: number) => (v / 255 <= 0.04045 ? v / 255 / 12.92 : (((v / 255) + 0.055) / 1.055) ** 2.4);
const encode = (v: number) => {
  const c = Math.max(0, Math.min(1, v));
  return c <= 0.0031308 ? c * 12.92 : (1.055 * c ** (1 / 2.4)) - 0.055;
};
const apply = (m: number[][], v: number[]) => m.map((row) => (row[0] * v[0]) + (row[1] * v[1]) + (row[2] * v[2]));
const RGB_TO_LMS = [[0.31399, 0.63951, 0.04649], [0.15537, 0.75789, 0.08670], [0.01775, 0.10945, 0.87262]];
const LMS_TO_RGB = [[5.47221, -4.6419, 0.16963], [-1.1252, 2.29317, -0.1678], [0.02980, -0.19318, 1.16364]];

/** Viénot-Brettel-Mollon dichromat simulation, returning linear sRGB. */
function simulate(rgb: [number, number, number], kind: 'normal' | 'protan' | 'deutan'): number[] {
  const linear = rgb.map(toLinear);
  if (kind === 'normal') return linear;
  const lms = apply(RGB_TO_LMS, linear);
  const collapsed = kind === 'protan'
    ? [(2.02344 * lms[1]) - (2.52581 * lms[2]), lms[1], lms[2]]
    : [lms[0], (0.494207 * lms[0]) + (1.24827 * lms[2]), lms[2]];
  return apply(LMS_TO_RGB, collapsed).map(encode).map((v) => toLinear(v * 255));
}

function lab(linear: number[]): number[] {
  const x = (0.4124 * linear[0]) + (0.3576 * linear[1]) + (0.1805 * linear[2]);
  const y = (0.2126 * linear[0]) + (0.7152 * linear[1]) + (0.0722 * linear[2]);
  const z = (0.0193 * linear[0]) + (0.1192 * linear[1]) + (0.9505 * linear[2]);
  const f = (t: number) => (t > 0.008856 ? Math.cbrt(t) : (7.787 * t) + (16 / 116));
  const [fx, fy, fz] = [f(x / 0.95047), f(y), f(z / 1.08883)];
  return [(116 * fy) - 16, 500 * (fx - fy), 200 * (fy - fz)];
}

const deltaE = (a: number[], b: number[]) => Math.hypot(...lab(a).map((v, i) => v - lab(b)[i]));

describe('Sanger chromatogram channels stay separable without hue', () => {
  const TRACE_SOURCE: Record<string, string> = { A: '--green', C: '--purple', G: '--text-primary', T: '--red' };
  const PAIRS: Array<[string, string]> = [['A', 'C'], ['A', 'G'], ['A', 'T'], ['C', 'G'], ['C', 'T'], ['G', 'T']];
  const SEPARABLE_BY_HUE = 25;

  it('keeps the trace tokens pointing at the four theme colours the guard measures', () => {
    for (const [base, token] of Object.entries(TRACE_SOURCE)) {
      expect(artifactCss).toContain(`--motif-cs-trace-${base.toLowerCase()}: var(${token});`);
    }
  });

  it('gives a dash to every pair that red-green colour vision collapses', () => {
    const collapsed: string[] = [];
    for (const [theme, selector] of Object.entries(THEME_BLOCKS)) {
      const tokens = themeTokens(selector);
      for (const kind of ['protan', 'deutan'] as const) {
        for (const [x, y] of PAIRS) {
          const distance = deltaE(
            simulate(srgb(tokens[TRACE_SOURCE[x]]), kind),
            simulate(srgb(tokens[TRACE_SOURCE[y]]), kind),
          );
          if (distance >= SEPARABLE_BY_HUE) continue;
          collapsed.push(`${x}/${y} ${theme} ${kind} ΔE ${distance.toFixed(1)}`);
          // Hue has run out for this pair, so the dash patterns must differ.
          expect(
            CHANNEL_DASH[x as 'A'].join(','),
            `${x} and ${y} are ΔE ${distance.toFixed(1)} apart under ${kind} in ${theme}`,
          ).not.toBe(CHANNEL_DASH[y as 'A'].join(','));
        }
      }
    }
    // The measurement this guard exists for: without it the test could pass by
    // finding nothing to check.
    expect(collapsed.length).toBeGreaterThan(0);
  });

  it('leaves the two solid channels far enough apart to need no dash', () => {
    const solid = (['A', 'C', 'G', 'T'] as const).filter((base) => CHANNEL_DASH[base].length === 0);
    expect(solid).toEqual(['A', 'G']);
    for (const [theme, selector] of Object.entries(THEME_BLOCKS)) {
      const tokens = themeTokens(selector);
      for (const kind of ['normal', 'protan', 'deutan'] as const) {
        const distance = deltaE(
          simulate(srgb(tokens[TRACE_SOURCE.A]), kind),
          simulate(srgb(tokens[TRACE_SOURCE.G]), kind),
        );
        expect(distance, `A vs G under ${kind} in ${theme}`).toBeGreaterThanOrEqual(SEPARABLE_BY_HUE);
      }
    }
  });

  it('strokes the dash onto both trace canvases and clears it before the next pass', () => {
    expect(traceSource.match(/context\.setLineDash\(CHANNEL_DASH\[displayBase\]\);/g)).toHaveLength(2);
    expect(traceSource.match(/context\.setLineDash\(\[\]\);/g)).toHaveLength(2);
  });

  it('repeats the same two patterns in the legend key', () => {
    expect(artifactCss).toContain('.motif-cs-sanger-legend [data-base="C"] i {\n  border-top-style: dotted;');
    expect(artifactCss).toContain('.motif-cs-sanger-legend [data-base="T"] i {\n  border-top-style: dashed;');
    // The two solid channels must not pick up a pattern the canvas never draws.
    expect(artifactCss).not.toContain('.motif-cs-sanger-legend [data-base="A"] i');
    expect(artifactCss).not.toContain('.motif-cs-sanger-legend [data-base="G"] i');
    // The legend is no longer a colour key alone. This reads traceSource: the
    // label lives in the viewer, and asserting it against motif-artifact.tsx
    // passed vacuously.
    expect(traceSource).toContain('aria-label="Chromatogram channel key"');
    expect(traceSource).not.toContain('aria-label="Chromatogram channel colors"');
  });
});
