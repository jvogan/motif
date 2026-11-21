/**
 * Reads the drawn circular map for placeSelectedNameCallout: the selected feature's
 * outline, every other name, the centre title, the selection's edges and the leaders,
 * all in screen px, then hands the placement back in the SVG's own units. Reading
 * only: nothing here moves or restyles what the map already drew.
 */
import type { MapFeatureRender, MapLayout, Pt } from '../../plasmid-map/types';
import {
  placeSelectedNameCallout,
  type CalloutBox,
} from '../../plasmid-map/selected-name-callout';

/** The callout as drawn, in the SVG root's user units. */
export interface SelectedNameRender {
  text: string;
  x: number;
  y: number;
  width: number;
  height: number;
  radius: number;
  fontSize: number;
  /** Polyline points, or null when the plate sits right against its feature. */
  leader: string | null;
}

/** On-screen size the name never goes under. */
const MIN_FONT_PX = 12;
/** Space between the plate's edge and the name, left and right. */
const PLATE_PAD_X_PX = 3;
const PLATE_RADIUS_PX = 3;
const PLATE_LINE_HEIGHT = 1.3;
const SAMPLE_STEP_PX = 1.5;
const MAX_SAMPLES_PER_SHAPE = 4000;

/** Feature names, enzyme names, ruler numerals and the centre title. */
const NAME_SELECTOR = '.motif-pm-feature-label, .motif-pm-restriction-label, .motif-pm-coord-label, .motif-pm-center text, .motif-pm-overflow';
/** The selection's wash and edges, and the leaders other names hang from. */
const LINE_SELECTOR = '.motif-pm-selection-layer path, .motif-pm-selection-edges path, .motif-pm-leader';

type Matrix = Pick<DOMMatrix, 'a' | 'b' | 'c' | 'd' | 'e' | 'f'>;

function apply(m: Matrix, x: number, y: number): Pt {
  return { x: m.a * x + m.c * y + m.e, y: m.b * x + m.d * y + m.f };
}

function scaleOf(m: Matrix): number {
  return Math.hypot(m.a, m.b) || 1;
}

function sampleShape(el: SVGGeometryElement, out: Pt[]): void {
  const m = el.getScreenCTM();
  if (!m || typeof el.getTotalLength !== 'function') return;
  let total: number;
  try {
    total = el.getTotalLength();
  } catch {
    return;
  }
  if (!Number.isFinite(total) || total <= 0) return;
  const n = Math.min(MAX_SAMPLES_PER_SHAPE, Math.max(1, Math.ceil((total * scaleOf(m)) / SAMPLE_STEP_PX)));
  for (let i = 0; i <= n; i += 1) {
    const p = el.getPointAtLength((total * i) / n);
    out.push(apply(m, p.x, p.y));
  }
}

let measureContext: CanvasRenderingContext2D | null | undefined;

function textWidth(text: string, font: string, fontPx: number): number {
  if (measureContext === undefined) {
    try {
      measureContext = document.createElement('canvas').getContext('2d');
    } catch {
      measureContext = null;
    }
  }
  if (measureContext) {
    measureContext.font = font;
    const width = measureContext.measureText(text).width;
    if (Number.isFinite(width) && width > 0) return width;
  }
  return text.length * fontPx * 0.6;
}

function rectOf(el: Element): CalloutBox | null {
  const r = el.getBoundingClientRect();
  return r.width > 0 && r.height > 0 ? { x: r.left, y: r.top, width: r.width, height: r.height } : null;
}

export function measureSelectedName(
  svg: SVGSVGElement,
  feature: MapFeatureRender,
  layout: MapLayout,
  textScale: number,
): SelectedNameRender | null {
  const viewport = svg.querySelector<SVGGElement>('.motif-pm-viewport');
  // A document without layout (a test DOM) has nothing to measure.
  if (typeof svg.getScreenCTM !== 'function' || typeof viewport?.getScreenCTM !== 'function') return null;
  const rootCtm = svg.getScreenCTM();
  const viewCtm = viewport?.getScreenCTM();
  if (!viewport || !rootCtm || !viewCtm || !(rootCtm.a > 0)) return null;
  const group = [...viewport.querySelectorAll<SVGGElement>('.motif-pm-feature')]
    .find((candidate) => candidate.getAttribute('data-feature-id') === feature.id);
  if (!group) return null;

  const outline: Pt[] = [];
  group.querySelectorAll<SVGGeometryElement>('.motif-pm-feature-body').forEach((body) => sampleShape(body, outline));
  if (outline.length === 0) return null;

  const center = apply(viewCtm, layout.center.x, layout.center.y);
  let sumX = 0;
  let sumY = 0;
  let inner = Infinity;
  let outer = 0;
  for (const p of outline) {
    const dx = p.x - center.x;
    const dy = p.y - center.y;
    const d = Math.hypot(dx, dy);
    if (d <= 0) continue;
    sumX += dx / d;
    sumY += dy / d;
    inner = Math.min(inner, d);
    outer = Math.max(outer, d);
  }
  if (!Number.isFinite(inner) || (sumX === 0 && sumY === 0)) return null;

  // The size the other names have on screen in this drawing, never under 12px.
  const sample = viewport.querySelector<SVGTextElement>('.motif-pm-feature-label');
  const style = getComputedStyle(sample ?? svg);
  const sampleCtm = sample?.getScreenCTM();
  const sampleFont = parseFloat(style.fontSize);
  const drawnPx = sample && sampleCtm && Number.isFinite(sampleFont)
    ? sampleFont * scaleOf(sampleCtm)
    : 16 * scaleOf(viewCtm) * textScale;
  const fontPx = Math.max(MIN_FONT_PX, Math.round(drawnPx * 10) / 10);
  const font = `${style.fontWeight || '400'} ${fontPx}px ${style.fontFamily || 'sans-serif'}`;
  const width = Math.ceil(textWidth(feature.name, font, fontPx) + 1) + PLATE_PAD_X_PX * 2;
  const height = Math.ceil(fontPx * PLATE_LINE_HEIGHT);

  const names: CalloutBox[] = [];
  viewport.querySelectorAll(NAME_SELECTOR).forEach((el) => {
    const box = rectOf(el);
    if (box) names.push(box);
  });
  const lines: Pt[] = [];
  viewport.querySelectorAll<SVGGeometryElement>(LINE_SELECTOR).forEach((el) => sampleShape(el, lines));

  const svgBox = rectOf(svg);
  const holder = svg.parentElement ? rectOf(svg.parentElement) : null;
  if (!svgBox) return null;
  const left = Math.max(svgBox.x, holder?.x ?? -Infinity);
  const top = Math.max(svgBox.y, holder?.y ?? -Infinity);
  const right = Math.min(svgBox.x + svgBox.width, holder ? holder.x + holder.width : Infinity);
  const bottom = Math.min(svgBox.y + svgBox.height, holder ? holder.y + holder.height : Infinity);

  const placed = placeSelectedNameCallout({
    center,
    angle: Math.atan2(sumY, sumX),
    innerRadius: inner,
    outerRadius: outer,
    ringRadius: layout.radius * scaleOf(viewCtm),
    width,
    height,
    feature: outline,
    lines,
    names,
    bounds: { x: left + 1, y: top + 1, width: right - left - 2, height: bottom - top - 2 },
  });
  if (!placed) return null;

  const s = rootCtm.a;
  const toRoot = (p: Pt): Pt => ({ x: (p.x - rootCtm.e) / s, y: (p.y - rootCtm.f) / rootCtm.d });
  const round = (v: number) => Math.round(v * 100) / 100;
  const origin = toRoot({ x: placed.box.x, y: placed.box.y });
  return {
    text: feature.name,
    x: round(origin.x),
    y: round(origin.y),
    width: round(placed.box.width / s),
    height: round(placed.box.height / s),
    radius: round(PLATE_RADIUS_PX / s),
    fontSize: round(fontPx / s),
    leader: placed.leader
      ? placed.leader.map(toRoot).map((p) => `${round(p.x)},${round(p.y)}`).join(' ')
      : null,
  };
}

export function sameSelectedName(a: SelectedNameRender | null, b: SelectedNameRender | null): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  return a.text === b.text && a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height
    && a.radius === b.radius && a.fontSize === b.fontSize && a.leader === b.leader;
}
