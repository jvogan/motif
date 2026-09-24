/**
 * Presentational renderer for the sequence map. Consumes a fully-projected
 * MapLayout (from computeMapLayout) and maps it to SVG — it never re-derives
 * biological ranges. Circular and linear share this component because the layout
 * is already projected; only the center label is circular-specific.
 *
 * Interaction is delegated at the SVG root where practical; per-object handlers
 * are lightweight. Hover styling is CSS-only (no per-pointermove React state).
 */
import {
  memo,
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  Fragment,
  type CSSProperties,
  type KeyboardEvent,
} from 'react';
import type {
  MapLayout,
  MapFeatureRender,
  MapRestrictionRender,
  MapRestrictionDensityTick,
  MapCoordinateTick,
  MapLabelRender,
} from '../../plasmid-map/types';
import type { MapRangeOverlayRender } from '../../plasmid-map/range-overlays';
import {
  restrictionClusterEnzymes,
  restrictionLabelTokenEnzyme,
  restrictionLabelTokens,
  type RestrictionClusterEnzyme,
} from '../../plasmid-map/restriction-display';
import { linearSelectionEdgePaths } from '../../plasmid-map/selection-overlay';
import { keepSettledSquares, measureMoreHitSquares, type HitRect } from '../../plasmid-map/more-hit-area';
import type { FeatureType } from '../../bio/types';
import { featureDisplayTokens } from '../sequence-stack/feature-display-colors';
import './plasmid-map.css';

type ThemeName = Parameters<typeof featureDisplayTokens>[1];

interface SvgPoint {
  x: number;
  y: number;
}

interface MapViewport {
  k: number;
  tx: number;
  ty: number;
}

export interface SequenceMapViewProps {
  layout: MapLayout;
  theme: ThemeName;
  /**
   * Static/inactive embedded maps render the same deterministic SVG but do not
   * attach feature/restriction/pan/zoom handlers. The host can still activate
   * the block on a normal click, then re-render this view as interactive.
   */
  interactive?: boolean;
  selectedFeatureId?: string | null;
  activeClusterId?: string | null;
  /** Projected biological range overlays (saved highlights, comments, ORFs, etc.). */
  rangeOverlays?: readonly MapRangeOverlayRender[];
  selectedRangeOverlayId?: string | null;
  /** SVG paths for the current sequence selection projected onto the map. */
  selectionPaths?: readonly string[];
  viewport?: MapViewport;
  onFeatureClick?: (featureId: string) => void;
  /**
   * A restriction cluster, or one enzyme in it. `enzyme` is set when the click named
   * one — a name in the cluster's label, or a cluster that holds only one enzyme — and
   * `tickIds` are then that enzyme's sites alone.
   */
  onRestrictionClick?: (clusterId: string, tickIds: readonly string[], enzyme?: string) => void;
  /**
   * Asked for when a press lands on a multi-enzyme cluster's "+N" tail, its tick, or
   * the gap between two names, and on Enter/Space on the cluster: the host lists the
   * cluster's enzymes so one can be picked. `anchor` is the element pressed, for
   * placing the list, and focus should return to it. Without this handler those
   * presses select the whole cluster, as they always did.
   */
  onRestrictionMenu?: (clusterId: string, enzymes: readonly RestrictionClusterEnzyme[], anchor: Element) => void;
  onRangeOverlayClick?: (overlayId: string) => void;
  onBackgroundClick?: () => void;
  /**
   * Wheel is the map's ONLY viewport gesture: plain wheel translates, ctrl/pinch
   * scales. There is deliberately no drag-to-pan — background drag belongs to the
   * host's range selection, and this component used to advertise a pan (data-pannable,
   * cursor:grab, onPanStart/Move/End) that nothing ever wired, so a grab cursor invited
   * a drag that moved nothing. An affordance nobody implements is worse than none.
   *
   * Return false to decline a wheel event: it is then neither prevented nor stopped,
   * so the page or pane around the map scrolls. The host declines the plain wheel at
   * Fit, where there is nothing off-frame to pan to.
   */
  onWheelZoom?: (point: SvgPoint, deltaX: number, deltaY: number, deltaMode: number, ctrlKey: boolean, shiftKey: boolean) => boolean;
  /** Dock-fill linear maps are height-stretched by CSS; center their content in that viewport. */
  centerLinearContent?: boolean;
}

const DEFAULT_VIEWPORT: MapViewport = { k: 1, tx: 0, ty: 0 };
const NO_MORE_HITS: ReadonlyMap<string, HitRect> = new Map();
const RESTRICTION_DENSITY_TICK_STYLE = {
  stroke: 'var(--border, var(--text-secondary, #8a8a8a))',
} as CSSProperties;
const MAX_RESTRICTION_DENSITY_TICKS = 512;
/** Keep circular map text legible without letting deep zoom turn it into dominant,
 * oversized geometry: enzyme labels, feature labels, coordinate labels and the centre
 * title grow with the zoom up to this multiple of their fitted size, then hold. */
const MAX_RESTRICTION_ANNOTATION_VISUAL_SCALE = 1.6;
const MAP_NUMBER_FORMAT = new Intl.NumberFormat();

type RovingMapKeyDown = (
  event: KeyboardEvent<SVGGElement>,
  interactionIndex: number,
  activate: () => void,
) => void;

type RenderedRestrictionDensityTick = MapRestrictionDensityTick;

interface LabelSegment {
  text: string;
  typeIIS: boolean;
  /** The enzyme this token names, when it names exactly one in the cluster. */
  enzyme?: string | null;
}

interface RestrictionDensityRender {
  ticks: readonly RenderedRestrictionDensityTick[];
  binned: boolean;
}

function mapInteractionKey(kind: 'feature' | 'restriction', id: string): string {
  return `${kind}:${id}`;
}

function restrictionAccessibleName(restriction: MapRestrictionRender): string {
  const titleName = restriction.title?.split(' · ', 1)[0]?.trim();
  const name = titleName || restriction.label?.text || 'Restriction site';
  const coordinate = Math.max(0, Math.trunc(restriction.anchorBp)) + 1;
  const siteCount = restriction.tickIds.length;
  const kind = siteCount === 1 ? 'site' : 'cluster';
  // "cut sites", not "map ticks". One noun across every surface that counts them: this
  // name, the cluster's own tooltip ("N sites"), and the overflow chip ("N unnamed
  // sites", over a title reading "N of M cut sites"). A third word for the same thing
  // left a screen-reader user reconciling ticks against sites against the label's "+N",
  // which counts enzyme NAMES and is the one quantity here in a different unit.
  //
  // The chip's noun carries a qualifier the other two do not, and that is deliberate:
  // this name and the tooltip count ALL of one cluster's cut sites, while the chip
  // counts the map's cut sites whose enzyme no drawn label states. Same unit, narrower
  // set — and its title prints the subset against the total in that unit, so the two
  // numbers reconcile instead of standing side by side. The chip could not do that
  // while it counted sites under an unlabelled CLUSTER, a set nothing else here names.
  const siteWord = siteCount === 1 ? 'cut site' : 'cut sites';
  return `${name}, restriction ${kind} at ${MAP_NUMBER_FORMAT.format(coordinate)} bp, ${MAP_NUMBER_FORMAT.format(siteCount)} ${siteWord}`;
}

function restrictionAnnotationSemanticScale(zoom: number): number {
  const safeZoom = Number.isFinite(zoom) ? Math.max(1, zoom) : 1;
  return Math.min(safeZoom, MAX_RESTRICTION_ANNOTATION_VISUAL_SCALE) / safeZoom;
}

/** A scale of `scale` about (x, y), or nothing while the text is at its natural size. */
function counterScaleAbout(scale: number, x: number, y: number): string | undefined {
  return scale < 0.9999 ? `translate(${x} ${y}) scale(${scale}) translate(${-x} ${-y})` : undefined;
}

function roundDensityCoordinate(value: number): number {
  return Math.round(value * 1000) / 1000;
}

/**
 * Dense records can contain tens of thousands of raw restriction sites. Those
 * sites already have clustered interactive controls; this decorative substrate
 * only needs to preserve their spatial density. Aggregate into sequence-space
 * bins so occupied regions remain visible without allowing SVG node count to
 * scale with record length.
 */
function buildRestrictionDensityRender(
  densityTicks: readonly MapRestrictionDensityTick[],
  sequenceLength: number,
): RestrictionDensityRender {
  if (densityTicks.length <= MAX_RESTRICTION_DENSITY_TICKS) {
    return { ticks: densityTicks, binned: densityTicks.some((tick) => (tick.siteCount ?? 1) > 1) };
  }

  interface DensityBin {
    firstId: string;
    count: number;
    anchorBp: number;
    x1: number;
    y1: number;
    x2: number;
    y2: number;
  }

  const bins: Array<DensityBin | undefined> = new Array(MAX_RESTRICTION_DENSITY_TICKS);
  const usableLength = Number.isFinite(sequenceLength) && sequenceLength > 0 ? sequenceLength : 0;

  densityTicks.forEach((densityTick, sourceIndex) => {
    const sequenceRatio = usableLength > 0 && Number.isFinite(densityTick.anchorBp)
      ? densityTick.anchorBp / usableLength
      : sourceIndex / densityTicks.length;
    const boundedRatio = Math.max(0, Math.min(1 - Number.EPSILON, sequenceRatio));
    const binIndex = Math.floor(boundedRatio * MAX_RESTRICTION_DENSITY_TICKS);
    const sourceCount = densityTick.siteCount ?? 1;
    const bin = bins[binIndex];
    if (bin) {
      bin.count += sourceCount;
      bin.anchorBp += densityTick.anchorBp * sourceCount;
      bin.x1 += densityTick.tick.x1 * sourceCount;
      bin.y1 += densityTick.tick.y1 * sourceCount;
      bin.x2 += densityTick.tick.x2 * sourceCount;
      bin.y2 += densityTick.tick.y2 * sourceCount;
      return;
    }
    bins[binIndex] = {
      firstId: densityTick.id,
      count: sourceCount,
      anchorBp: densityTick.anchorBp * sourceCount,
      x1: densityTick.tick.x1 * sourceCount,
      y1: densityTick.tick.y1 * sourceCount,
      x2: densityTick.tick.x2 * sourceCount,
      y2: densityTick.tick.y2 * sourceCount,
    };
  });

  const ticks: RenderedRestrictionDensityTick[] = [];
  bins.forEach((bin, binIndex) => {
    if (!bin) return;
    ticks.push({
      id: `density-bin-${binIndex}-${bin.firstId}`,
      siteCount: bin.count,
      anchorBp: roundDensityCoordinate(bin.anchorBp / bin.count),
      tick: {
        x1: roundDensityCoordinate(bin.x1 / bin.count),
        y1: roundDensityCoordinate(bin.y1 / bin.count),
        x2: roundDensityCoordinate(bin.x2 / bin.count),
        y2: roundDensityCoordinate(bin.y2 / bin.count),
      },
    });
  });

  return { ticks, binned: true };
}

function svgPointFromClient(svg: SVGSVGElement, clientX: number, clientY: number): SvgPoint | null {
  const ctm = svg.getScreenCTM();
  if (!ctm) return null;
  const point = svg.createSVGPoint();
  point.x = clientX;
  point.y = clientY;
  const local = point.matrixTransform(ctm.inverse());
  return { x: local.x, y: local.y };
}

function activateKey(handler: () => void) {
  return (e: KeyboardEvent) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      handler();
    }
  };
}

function MapText({
  label,
  className,
  segments,
  textTransform,
}: {
  label: MapLabelRender;
  className: string;
  /** Applied to the text alone, outside its rotation; the leader keeps its geometry. */
  textTransform?: string;
  /** Per-token breakdown; when present the visible text is rebuilt from these
   * tspans (Type IIS tokens get their own class) instead of the flat label.text.
   * The reconstructed string is byte-identical to label.text. A token that names an
   * enzyme carries it as data-enzyme, and the "+N" tail carries data-label-more, so
   * a click can tell which part of a cluster label it landed on. */
  segments?: readonly LabelSegment[];
}) {
  const rawId = useId();
  // On-arc inline labels ride a baseline arc via <textPath> so long names follow
  // the feature curve. The path itself is invisible; direction encodes the flip.
  if (label.arcPath) {
    const pathId = `motif-lbl-${rawId.replace(/:/g, '')}`;
    return (
      <>
        {label.leader.length > 1 && (
          <polyline className="motif-pm-leader" points={label.leader.map((p) => `${p.x},${p.y}`).join(' ')} />
        )}
        <path id={pathId} className="motif-pm-label-arc-path" d={label.arcPath} fill="none" stroke="none" />
        <text className={className} textAnchor="middle" dominantBaseline={label.baseline ?? 'middle'}>
          <textPath xlinkHref={`#${pathId}`} startOffset="50%">
            {label.text}
          </textPath>
        </text>
      </>
    );
  }
  return (
    <>
      {label.leader.length > 1 && (
        <polyline className="motif-pm-leader" points={label.leader.map((p) => `${p.x},${p.y}`).join(' ')} />
      )}
      <text
        className={className}
        x={label.x}
        y={label.y}
        textAnchor={label.anchor}
        dominantBaseline={label.baseline}
        transform={[textTransform, label.rotate ? `rotate(${label.rotate} ${label.x} ${label.y})` : undefined]
          .filter(Boolean).join(' ') || undefined}
      >
        {segments && segments.length > 0
          ? segments.map((seg, i) => (
              <Fragment key={i}>
                {/* Separators are bare text nodes (normal ink): enzyme tokens join
                    with ", " and the "+N" overflow tail (always "+"-prefixed, never
                    first) with " " — matching clusterLabelText exactly. Only the
                    enzyme <tspan> carries the Type IIS class, so commas/tail stay ink. */}
                {i > 0 ? (seg.text.startsWith('+') ? ' ' : ', ') : null}
                <tspan
                  className={seg.typeIIS ? 'motif-pm-restriction-enz--typeiis' : undefined}
                  data-enzyme={seg.enzyme ?? undefined}
                  data-label-more={seg.text.startsWith('+') || undefined}
                >
                  {seg.text}
                </tspan>
              </Fragment>
            ))
          : label.text}
      </text>
    </>
  );
}

const FeatureShape = memo(function FeatureShape({
  feature,
  theme,
  selected,
  interactive,
  interactionIndex,
  tabIndex,
  onRovingFocus,
  onRovingKeyDown,
  onClick,
  textScale,
}: {
  feature: MapFeatureRender;
  theme: ThemeName;
  selected: boolean;
  interactive: boolean;
  interactionIndex: number;
  tabIndex: 0 | -1;
  onRovingFocus?: (interactionIndex: number) => void;
  onRovingKeyDown?: RovingMapKeyDown;
  onClick?: (id: string) => void;
  /** 1 at Fit; below 1 once a circular map is zoomed past the text cap. */
  textScale: number;
}) {
  const base = useMemo(
    () => featureDisplayTokens({ type: feature.type as FeatureType, color: feature.color }, theme).base,
    [feature.type, feature.color, theme],
  );
  const style = { '--pm-base': base } as CSSProperties;
  const strandLabel = feature.displayStrand === -1 ? 'reverse strand' : feature.displayStrand === 0 ? 'directionless' : 'forward strand';
  return (
    <g
      className="motif-pm-feature"
      data-feature-id={feature.id}
      data-selected={selected || undefined}
      data-strand={feature.displayStrand}
      data-map-interaction-index={interactive ? interactionIndex : undefined}
      style={style}
      role={interactive ? 'button' : undefined}
      tabIndex={interactive ? tabIndex : undefined}
      aria-label={feature.title ?? `${feature.name}, ${feature.type}, ${strandLabel}`}
      aria-pressed={interactive ? selected : undefined}
      onClick={interactive ? (e) => {
        e.stopPropagation();
        onRovingFocus?.(interactionIndex);
        onClick?.(feature.id);
      } : undefined}
      onFocus={interactive ? () => onRovingFocus?.(interactionIndex) : undefined}
      onKeyDown={interactive ? (event) => {
        onRovingKeyDown?.(event, interactionIndex, () => onClick?.(feature.id));
      } : undefined}
    >
      {feature.title ? <title>{feature.title}</title> : null}
      {feature.segmentPaths.map((d, i) => (
        <path key={`hit-${i}`} className="motif-pm-feature-hit" d={d} />
      ))}
      {feature.segmentPaths.map((d, i) => (
        <path key={i} className="motif-pm-feature-body" d={d} />
      ))}
      {feature.label ? (
        <FeatureAnnotation label={feature.label} textScale={textScale} />
      ) : null}
    </g>
  );
});

/**
 * A feature's name, held at the text cap as the map zooms. A name at the end of a
 * leader shrinks toward that end, so the gap between them keeps its proportion and
 * the name stays inside the space it already had; the leader is drawn at full zoom.
 * Pulling the name in along its leader instead, as an enzyme name is pulled toward
 * its tick, put it on top of the enzyme names that had been pulled in the same way.
 * A name with no leader shrinks about its own anchor. A name that rides the
 * feature's arc cannot move without leaving the arc, so only its font shrinks,
 * centred where it sits.
 */
function FeatureAnnotation({ label, textScale }: { label: MapLabelRender; textScale: number }) {
  const scaled = textScale < 0.9999;
  if (label.arcPath) {
    return (
      <g
        className="motif-pm-feature-annotation"
        data-semantic-scale={scaled ? textScale : undefined}
        style={scaled ? ({ '--pm-zoom-text-scale': textScale } as CSSProperties) : undefined}
      >
        <MapText label={label} className="motif-pm-feature-label" />
      </g>
    );
  }
  const origin = label.leader.length > 1 ? label.leader[label.leader.length - 1] : { x: label.x, y: label.y };
  return (
    <g className="motif-pm-feature-annotation" data-semantic-scale={scaled ? textScale : undefined}>
      <MapText
        label={label}
        className="motif-pm-feature-label"
        textTransform={counterScaleAbout(textScale, origin.x, origin.y)}
      />
    </g>
  );
}

const RestrictionMark = memo(function RestrictionMark({
  restriction,
  annotationScale,
  circular = false,
  moreHit = null,
  active,
  interactive,
  interactionIndex,
  tabIndex,
  onRovingFocus,
  onRovingKeyDown,
  onClick,
  onMenu,
}: {
  restriction: MapRestrictionRender;
  annotationScale: number;
  /** A circular map's tail gets an invisible 24x24 press target (see more-hit-area). */
  circular?: boolean;
  /** That target, in this group's user units. */
  moreHit?: HitRect | null;
  active: boolean;
  interactive: boolean;
  interactionIndex: number;
  tabIndex: 0 | -1;
  onRovingFocus?: (interactionIndex: number) => void;
  onRovingKeyDown?: RovingMapKeyDown;
  onClick?: (clusterId: string, tickIds: readonly string[], enzyme?: string) => void;
  onMenu?: (clusterId: string, enzymes: readonly RestrictionClusterEnzyme[], anchor: Element) => void;
}) {
  const enzymes = useMemo(
    () => restrictionClusterEnzymes(restriction),
    [restriction],
  );
  const onlyEnzyme = enzymes.length === 1 ? enzymes[0] : null;
  const hasMenu = !!onMenu && enzymes.length > 1;
  // A press on a name selects that enzyme. A cluster of one enzyme IS that enzyme,
  // wherever it is pressed. Anything else on a crowded cluster — its "+N" tail, its
  // tick, the gap between two names, or Enter — asks the host for the list of what
  // it holds, so the reader picks one instead of getting all of them.
  const activate = (target: Element | null, anchor: Element) => {
    const named = target?.closest?.('[data-enzyme]')?.getAttribute('data-enzyme');
    const entry = named ? enzymes.find((candidate) => candidate.enzyme === named) : onlyEnzyme;
    if (entry) {
      onClick?.(restriction.clusterId, entry.tickIds, entry.enzyme);
      return;
    }
    if (hasMenu) {
      onMenu?.(restriction.clusterId, enzymes, anchor);
      return;
    }
    onClick?.(restriction.clusterId, restriction.tickIds);
  };
  // Segmented labels color per-enzyme via <tspan>; data-segmented tells the CSS to
  // drop the aggregate whole-label tint (unsegmented linear labels keep it).
  // Must reproduce clusterLabelText's join rule exactly: mismatch silently falls back
  // to the flat label and drops per-enzyme Type IIS coloring, with no error anywhere.
  const segmentedText = restriction.labelSegments
    ?.map((seg, i) => `${i > 0 ? (seg.text.startsWith('+') ? ' ' : ', ') : ''}${seg.text}`)
    .join('');
  const segmented =
    !!restriction.label && !!restriction.labelSegments && restriction.labelSegments.length > 0 && segmentedText === restriction.label.text;
  // Every label is drawn as tokens so each name is its own target. An unsegmented
  // (linear) label is split by the same join rule; its tokens carry no Type IIS class,
  // so the whole-label tint it keeps still paints them.
  const labelSegments = useMemo((): readonly LabelSegment[] | undefined => {
    if (!restriction.label) return undefined;
    const base: readonly LabelSegment[] = segmented && restriction.labelSegments
      ? restriction.labelSegments
      : restrictionLabelTokens(restriction.label.text).map((text) => ({ text, typeIIS: false }));
    return base.map((seg) => ({ ...seg, enzyme: restrictionLabelTokenEnzyme(seg.text, enzymes) }));
  }, [enzymes, restriction.label, restriction.labelSegments, segmented]);
  const annotationTransform = counterScaleAbout(annotationScale, restriction.tick.x2, restriction.tick.y2);
  // The "+N" tail is the only part of the label that opens the rest of the cluster,
  // and on a small circular map it drew about 4x7 CSS px. The map places a square
  // for every tail in one read of the drawing (see SequenceMapView's moreHits).
  const hasTail = interactive && circular && hasMenu && !!restriction.label;
  return (
    <g
      className="motif-pm-restriction"
      data-cluster-id={restriction.clusterId}
      data-active={active || undefined}
      data-typeiis={restriction.hasTypeIIS || undefined}
      data-segmented={segmented || undefined}
      data-map-interaction-index={interactive ? interactionIndex : undefined}
      role={interactive ? 'button' : undefined}
      tabIndex={interactive ? tabIndex : undefined}
      aria-label={restrictionAccessibleName(restriction)}
      aria-pressed={interactive ? active : undefined}
      aria-haspopup={interactive && hasMenu ? 'menu' : undefined}
      onClick={interactive ? (e) => {
        e.stopPropagation();
        onRovingFocus?.(interactionIndex);
        const target = e.target instanceof Element ? e.target : null;
        activate(target, target ?? e.currentTarget);
      } : undefined}
      onFocus={interactive ? () => onRovingFocus?.(interactionIndex) : undefined}
      onKeyDown={interactive ? (event) => {
        const group = event.currentTarget;
        onRovingKeyDown?.(event, interactionIndex, () => activate(
          null,
          group.querySelector('.motif-pm-restriction-label') ?? group,
        ));
      } : undefined}
    >
      {restriction.title ? <title>{restriction.title}</title> : null}
      <line
        className="motif-pm-tick-hit"
        x1={restriction.tick.x1}
        y1={restriction.tick.y1}
        x2={restriction.tick.x2}
        y2={restriction.tick.y2}
        pointerEvents="stroke"
        aria-hidden="true"
      />
      {hasTail && moreHit ? (
        <rect
          className="motif-pm-restriction-more-hit"
          x={moreHit.x}
          y={moreHit.y}
          width={moreHit.width}
          height={moreHit.height}
          fill="none"
          pointerEvents="all"
          aria-hidden="true"
        />
      ) : null}
      <line
        className="motif-pm-tick"
        x1={restriction.tick.x1}
        y1={restriction.tick.y1}
        x2={restriction.tick.x2}
        y2={restriction.tick.y2}
      />
      {restriction.label ? (
        <g
          className="motif-pm-restriction-annotation"
          data-semantic-scale={annotationTransform ? annotationScale : undefined}
          transform={annotationTransform}
        >
          <MapText
            label={restriction.label}
            className="motif-pm-restriction-label"
            segments={labelSegments}
          />
        </g>
      ) : null}
    </g>
  );
});

function RestrictionDensityTick({ densityTick }: { densityTick: RenderedRestrictionDensityTick }) {
  const siteCount = densityTick.siteCount ?? 1;
  const densityStyle = siteCount > 1
    ? {
        ...RESTRICTION_DENSITY_TICK_STYLE,
        strokeOpacity: Math.min(0.82, 0.5 + Math.log2(siteCount) * 0.04),
        strokeWidth: Math.min(1.8, 1.1 + Math.log2(siteCount) * 0.09),
      }
    : RESTRICTION_DENSITY_TICK_STYLE;
  return (
    <line
      className="motif-pm-tick"
      data-site-count={siteCount}
      x1={densityTick.tick.x1}
      y1={densityTick.tick.y1}
      x2={densityTick.tick.x2}
      y2={densityTick.tick.y2}
      style={densityStyle}
    />
  );
}

function CoordinateTick({ coord, textScale }: { coord: MapCoordinateTick; textScale: number }) {
  // The number scales about whichever end of its tick it stands beside, so the gap
  // between them keeps its proportion instead of growing with the zoom.
  const { tick, label } = coord;
  const nearFirstEnd = label
    && Math.hypot(label.x - tick.x1, label.y - tick.y1) < Math.hypot(label.x - tick.x2, label.y - tick.y2);
  const counterScale = label
    ? counterScaleAbout(textScale, nearFirstEnd ? tick.x1 : tick.x2, nearFirstEnd ? tick.y1 : tick.y2)
    : undefined;
  const rotate = label?.rotate ? `rotate(${label.rotate} ${label.x} ${label.y})` : undefined;
  const transform = [counterScale, rotate].filter(Boolean).join(' ') || undefined;
  return (
    <g aria-hidden="true">
      <line className="motif-pm-coord-tick" x1={coord.tick.x1} y1={coord.tick.y1} x2={coord.tick.x2} y2={coord.tick.y2} />
      {coord.label ? (
        <text
          className="motif-pm-coord-label"
          x={coord.label.x}
          y={coord.label.y}
          textAnchor={coord.label.anchor}
          transform={transform}
        >
          {coord.label.text}
        </text>
      ) : null}
    </g>
  );
}

export const SequenceMapView = memo(function SequenceMapView({
  layout,
  theme,
  interactive = true,
  selectedFeatureId,
  activeClusterId,
  rangeOverlays,
  selectedRangeOverlayId,
  selectionPaths,
  viewport = DEFAULT_VIEWPORT,
  onFeatureClick,
  onRestrictionClick,
  onRestrictionMenu,
  onRangeOverlayClick,
  onBackgroundClick,
  onWheelZoom,
  centerLinearContent = false,
}: SequenceMapViewProps) {
  const svgRef = useRef<SVGSVGElement>(null);
  const onWheelZoomRef = useRef(onWheelZoom);
  onWheelZoomRef.current = onWheelZoom;
  const isCircular = layout.mode === 'circular';
  const preserveAspectRatio = isCircular || centerLinearContent ? 'xMidYMid meet' : 'xMidYMin meet';
  // Protein maps count residues, not base pairs.
  const unit = layout.sequenceType === 'protein' ? 'aa' : 'bp';
  const centerTitle = layout.centerTitle ?? {
    lines: [{ text: layout.name, fontSize: 15, baselineY: layout.center.y - 2 }],
    lenBaselineY: layout.center.y + 16,
  };
  const isZoomed = viewport.k > 1.0001;
  const isPanned = Math.abs(viewport.tx) > 0.01 || Math.abs(viewport.ty) > 0.01;
  const hasViewportTransform = isZoomed || isPanned;
  const viewportTransform = hasViewportTransform ? `translate(${viewport.tx} ${viewport.ty}) scale(${viewport.k})` : undefined;
  // Zoom magnifies the drawing, and the words on it stop growing at the cap: enzyme
  // and feature names, coordinate numbers and the centre title alike. A linear map
  // keeps scaling its text with the zoom; that wants a re-layout, not a cap.
  const circularTextScale = isCircular ? restrictionAnnotationSemanticScale(viewport.k) : 1;
  const rangeOverlaysInteractive = interactive && !!onRangeOverlayClick;
  const rawSelectionGradientId = useId();
  const selectionGradientId = `motif-pm-selection-gradient-${rawSelectionGradientId.replace(/:/g, '')}`;
  const selectionEdgeGradientId = `motif-pm-selection-edge-gradient-${rawSelectionGradientId.replace(/:/g, '')}`;
  const selectionGradientRadius = Math.max(1, layout.radius * 1.08);
  // A stroke can only name a paint server by url(), and the id is generated per
  // instance, so hand it to the stylesheet as a custom property rather than letting
  // CSS guess it. A host that styles the selection edges reads
  // --motif-pm-selection-edge-gradient with its own colour as the fallback.
  const selectionEdgeGradientStyle = useMemo(
    () => ({ '--motif-pm-selection-edge-gradient': `url(#${selectionEdgeGradientId})` }) as CSSProperties,
    [selectionEdgeGradientId],
  );
  // A linear selection is a band 18px tall on a drawing 274px deep (measured on the
  // synthetic pUC19 once bundled, at 1440x900), so it marks the ruler and says nothing about the restriction band
  // or the feature rows the same bases run through. These carry each span's two
  // boundaries down to where the coordinate gridlines stop.
  const linearSelectionEdges = useMemo(
    () => selectionPaths?.flatMap((d) => linearSelectionEdgePaths(layout, d)) ?? [],
    [selectionPaths, layout],
  );
  // Arrow keys walk the map in sequence order: clockwise from the origin on a
  // ring, left to right on a line. Features and sites interleave, each at the
  // first base its accessible name announces (a feature's start, a site's
  // position), so the coordinates a screen reader speaks only climb within a
  // lap. The keys used to follow the record's feature list and then every site,
  // so focus jumped back and forth around the map between features and then
  // began a second lap for the sites. Paint order stays layout order; only the
  // roving index follows position.
  const mapInteractionModel = useMemo(() => {
    const keys = [
      ...layout.features.map((feature) => ({ key: mapInteractionKey('feature', feature.id), bp: feature.startBp })),
      ...layout.restrictions.map((restriction) => ({
        key: mapInteractionKey('restriction', restriction.clusterId),
        bp: restriction.anchorBp,
      })),
    ]
      // A stable sort, so a feature and a site at one base keep the feature first.
      .sort((a, b) => a.bp - b.bp)
      .map((item) => item.key);
    return {
      keys,
      indexByKey: new Map(keys.map((key, index) => [key, index])),
    };
  }, [layout.features, layout.restrictions]);
  const selectedMapInteractionKey = selectedFeatureId
    ? mapInteractionKey('feature', selectedFeatureId)
    : activeClusterId
      ? mapInteractionKey('restriction', activeClusterId)
      : null;
  const [rovingMapInteractionKey, setRovingMapInteractionKey] = useState<string | null>(() => (
    selectedMapInteractionKey && mapInteractionModel.indexByKey.has(selectedMapInteractionKey)
      ? selectedMapInteractionKey
      : mapInteractionModel.keys[0] ?? null
  ));
  const effectiveRovingMapInteractionKey = rovingMapInteractionKey
    && mapInteractionModel.indexByKey.has(rovingMapInteractionKey)
    ? rovingMapInteractionKey
    : selectedMapInteractionKey && mapInteractionModel.indexByKey.has(selectedMapInteractionKey)
      ? selectedMapInteractionKey
      : mapInteractionModel.keys[0] ?? null;
  const effectiveRovingMapInteractionIndex = effectiveRovingMapInteractionKey
    ? mapInteractionModel.indexByKey.get(effectiveRovingMapInteractionKey) ?? -1
    : -1;
  const restrictionDensityRender = useMemo(
    () => buildRestrictionDensityRender(layout.restrictionDensityTicks, layout.length),
    [layout.length, layout.restrictionDensityTicks],
  );
  const restrictionDensitySourceCount = useMemo(
    () => layout.restrictionDensityTicks.reduce((sum, tick) => sum + (tick.siteCount ?? 1), 0),
    [layout.restrictionDensityTicks],
  );
  // Each "+N" tail on a circular map gets a 24x24 CSS px square clear of every other
  // target (see more-hit-area). One read of the drawn map, after the marks are laid
  // out, places all of them; a read per mark cost 19 reads a commit on pBR322.
  const measuresTails = interactive && isCircular && !!onRestrictionMenu;
  const [moreHits, setMoreHits] = useState<ReadonlyMap<string, HitRect>>(NO_MORE_HITS);
  useLayoutEffect(() => {
    const svg = svgRef.current;
    const next = measuresTails && svg ? measureMoreHitSquares(svg) : NO_MORE_HITS;
    setMoreHits((current) => keepSettledSquares(current, next));
  }, [circularTextScale, layout, measuresTails]);

  const handleMapItemFocus = useCallback((interactionIndex: number) => {
    const key = mapInteractionModel.keys[interactionIndex];
    if (key) setRovingMapInteractionKey(key);
  }, [mapInteractionModel]);

  const focusMapItem = useCallback((interactionIndex: number) => {
    const key = mapInteractionModel.keys[interactionIndex];
    if (!key) return;
    setRovingMapInteractionKey(key);
    svgRef.current
      ?.querySelector<SVGGElement>(`[data-map-interaction-index="${interactionIndex}"]`)
      ?.focus();
  }, [mapInteractionModel]);

  const handleMapItemKeyDown = useCallback<RovingMapKeyDown>((event, interactionIndex, activate) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      event.stopPropagation();
      handleMapItemFocus(interactionIndex);
      activate();
      return;
    }

    const itemCount = mapInteractionModel.keys.length;
    if (itemCount === 0) return;
    let nextIndex: number | null = null;
    if (event.key === 'ArrowRight' || event.key === 'ArrowDown') {
      nextIndex = (interactionIndex + 1) % itemCount;
    } else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') {
      nextIndex = (interactionIndex - 1 + itemCount) % itemCount;
    } else if (event.key === 'Home') {
      nextIndex = 0;
    } else if (event.key === 'End') {
      nextIndex = itemCount - 1;
    }
    if (nextIndex === null) return;
    event.preventDefault();
    event.stopPropagation();
    focusMapItem(nextIndex);
  }, [focusMapItem, handleMapItemFocus, mapInteractionModel]);

  useEffect(() => {
    if (!interactive) return undefined;
    const el = svgRef.current;
    if (!el) return;

    const onWheelNative = (ev: globalThis.WheelEvent) => {
      const wheelZoom = onWheelZoomRef.current;
      if (!wheelZoom) return;
      const point = svgPointFromClient(el, ev.clientX, ev.clientY);
      if (!point) return;
      const consumed = wheelZoom(point, ev.deltaX, ev.deltaY, ev.deltaMode, ev.ctrlKey, ev.shiftKey);
      if (!consumed) return;
      ev.preventDefault();
      ev.stopPropagation();
    };

    el.addEventListener('wheel', onWheelNative, { passive: false });
    return () => el.removeEventListener('wheel', onWheelNative);
  }, [interactive]);

  return (
    <svg
      ref={svgRef}
      className="motif-plasmid-map"
      viewBox={layout.contentViewBox ?? layout.viewBox}
      role={interactive ? 'group' : 'img'}
      aria-label={`${layout.name}, ${layout.length.toLocaleString()} ${unit}, ${
        isCircular ? 'circular map' : 'linear map'
      }`}
      preserveAspectRatio={preserveAspectRatio}
      style={selectionEdgeGradientStyle}
      data-interactive={interactive ? 'true' : undefined}
      onClick={interactive ? () => onBackgroundClick?.() : undefined}
    >
      {/* Background-clear lives on the SVG root above, so clicking ANY
          non-interactive area (inner ring, center label, coord numbers, gaps)
          deselects — features/restrictions stopPropagation so their clicks never
          reach it. The rect stays outside the zoom transform as the full-view
          transparent hit surface.

          It carries NO pointer handlers on purpose. Whatever drag the host wants over
          the map (range selection, in this app) it listens for on its own wrapper and
          receives by bubbling; a handler here would only be able to compete with that.
          Viewport translation is the wheel's job — see onWheelZoom. */}
      <rect
        className="motif-pm-bg"
        x={layout.bg.x}
        y={layout.bg.y}
        width={layout.bg.width}
        height={layout.bg.height}
      />
      {isCircular && selectionPaths && selectionPaths.length > 0 ? (
        <defs>
          <radialGradient
            id={selectionGradientId}
            gradientUnits="userSpaceOnUse"
            cx={layout.center.x}
            cy={layout.center.y}
            r={selectionGradientRadius}
          >
            <stop className="motif-pm-selection-stop motif-pm-selection-stop-center" offset="0%" />
            <stop className="motif-pm-selection-stop motif-pm-selection-stop-mid" offset="56%" />
            <stop className="motif-pm-selection-stop motif-pm-selection-stop-edge" offset="100%" />
          </radialGradient>
          {/* The radial edge lines ride the same ramp as the fill, just opaque
              enough to read as lines: faint where they approach the center label,
              solid where they meet the backbone. Both are userSpaceOnUse and
              centered on the map, so a line's fade tracks its own radius. */}
          <radialGradient
            id={selectionEdgeGradientId}
            gradientUnits="userSpaceOnUse"
            cx={layout.center.x}
            cy={layout.center.y}
            r={selectionGradientRadius}
          >
            <stop className="motif-pm-selection-edge-stop motif-pm-selection-edge-stop-center" offset="0%" />
            <stop className="motif-pm-selection-edge-stop motif-pm-selection-edge-stop-mid" offset="56%" />
            <stop className="motif-pm-selection-edge-stop motif-pm-selection-edge-stop-edge" offset="100%" />
          </radialGradient>
        </defs>
      ) : null}
      <g className="motif-pm-viewport" transform={viewportTransform}>
        {layout.coordinates.some((coord) => coord.grid) ? (
          <g className="motif-pm-coordinate-grid" aria-hidden="true">
            {layout.coordinates.map((coord) =>
              coord.grid ? (
                <line
                  key={`grid-${coord.bp}`}
                  className="motif-pm-coord-grid"
                  x1={coord.grid.x1}
                  y1={coord.grid.y1}
                  x2={coord.grid.x2}
                  y2={coord.grid.y2}
                  vectorEffect="non-scaling-stroke"
                />
              ) : null,
            )}
          </g>
        ) : null}
        <path className="motif-pm-backbone" d={layout.backbonePath} />

        {rangeOverlays && rangeOverlays.length > 0 ? (
          <g
            className="motif-pm-range-overlays"
            aria-label="Map range overlays"
            data-interactive={rangeOverlaysInteractive || undefined}
          >
            {rangeOverlays.map((overlay) => (
              <g
                key={overlay.id}
                className="motif-pm-range-overlay"
                data-overlay-id={overlay.id}
                data-overlay-kind={overlay.kind}
                data-overlay-variant={overlay.variant}
                data-selected={overlay.id === selectedRangeOverlayId || undefined}
                style={{ '--pm-range-color': overlay.color } as CSSProperties}
                role={rangeOverlaysInteractive ? 'button' : undefined}
                tabIndex={rangeOverlaysInteractive ? 0 : undefined}
                aria-label={overlay.title}
                aria-pressed={rangeOverlaysInteractive ? overlay.id === selectedRangeOverlayId : undefined}
                onClick={rangeOverlaysInteractive ? (e) => {
                  e.stopPropagation();
                  onRangeOverlayClick?.(overlay.id);
                } : undefined}
                onKeyDown={rangeOverlaysInteractive ? activateKey(() => onRangeOverlayClick?.(overlay.id)) : undefined}
              >
                <title>{overlay.title}</title>
                {overlay.paths.map((d, i) => (
                  <path
                    key={`hit-${i}`}
                    className="motif-pm-range-overlay-hit"
                    d={d}
                    aria-hidden="true"
                    focusable="false"
                    data-overlay-path-index={i}
                  />
                ))}
                {overlay.paths.map((d, i) => (
                  <path
                    key={`shape-${i}`}
                    className="motif-pm-range-overlay-shape"
                    d={d}
                    data-overlay-path-index={i}
                  />
                ))}
              </g>
            ))}
          </g>
        ) : null}

        {selectionPaths && selectionPaths.length > 0 ? (
          <g className="motif-pm-selection-layer" aria-hidden="true">
            {selectionPaths.map((d, i) => (
              <path
                key={i}
                className="motif-pm-selection"
                d={d}
                fill={isCircular ? `url(#${selectionGradientId})` : undefined}
              />
            ))}
          </g>
        ) : null}

        {/* Own group, not more children of the layer above: the artifact styles a
            circular selection's edges with :nth-child(3n+2)/(3n+3) over that
            layer's children, and an extra path in it would shift every span's
            triplet. Painted here, before the coordinate numbers and the feature
            and enzyme names, so a boundary line passes behind a glyph instead of
            through it — the same order the coordinate gridlines already draw in. */}
        {linearSelectionEdges.length > 0 ? (
          <g className="motif-pm-selection-edges" aria-hidden="true">
            {linearSelectionEdges.map((d, i) => (
              <path key={i} className="motif-pm-selection-edge" d={d} />
            ))}
          </g>
        ) : null}

        <g className="motif-pm-coords">
          {layout.coordinates.map((coord) => (
            <CoordinateTick key={`c${coord.bp}`} coord={coord} textScale={circularTextScale} />
          ))}
        </g>

        {layout.overflows?.length ? (
          // Paint the help target before interactive annotations. It remains
          // reachable in empty map space, while a feature/restriction painted
          // over any part of its generous text-sized rect wins hit testing.
          <g className="motif-pm-overflows">
            {layout.overflows.map((overflow) => (
              <g
                key={overflow.id}
                className="motif-pm-overflow-chip"
                data-kind={overflow.kind}
                onPointerDown={(e) => e.stopPropagation()}
              >
                <title>
                  {restrictionDensityRender.binned && overflow.kind === 'restriction-labels'
                    ? overflow.title.replace(
                        'All density ticks remain visible.',
                        'All sites remain represented in the binned density summary.',
                      )
                    : overflow.title}
                </title>
                <rect
                  className="motif-pm-overflow-hit"
                  x={overflow.hit.x}
                  y={overflow.hit.y}
                  width={overflow.hit.width}
                  height={overflow.hit.height}
                />
                <text
                  className="motif-pm-overflow"
                  x={overflow.x}
                  y={overflow.y}
                  textAnchor={overflow.anchor}
                  data-kind={overflow.kind}
                >
                  {overflow.text}
                </text>
              </g>
            ))}
          </g>
        ) : null}

        <g className="motif-pm-features">
          {layout.features.map((feature) => {
            const interactionIndex = mapInteractionModel.indexByKey.get(mapInteractionKey('feature', feature.id)) ?? -1;
            return (
            <FeatureShape
              key={feature.id}
              feature={feature}
              theme={theme}
              selected={feature.id === selectedFeatureId}
              interactive={interactive}
              interactionIndex={interactionIndex}
              tabIndex={effectiveRovingMapInteractionIndex === interactionIndex ? 0 : -1}
              onRovingFocus={handleMapItemFocus}
              onRovingKeyDown={handleMapItemKeyDown}
              onClick={onFeatureClick}
              textScale={circularTextScale}
            />
            );
          })}
        </g>

        <g
          className="motif-pm-restriction-density"
          aria-hidden="true"
          pointerEvents="none"
          data-binned={restrictionDensityRender.binned || undefined}
          data-source-count={restrictionDensitySourceCount}
          data-rendered-count={restrictionDensityRender.ticks.length}
        >
          {restrictionDensityRender.ticks.map((densityTick) => (
            <RestrictionDensityTick key={densityTick.id} densityTick={densityTick} />
          ))}
        </g>

        <g className="motif-pm-restrictions">
          {layout.restrictions.map((restriction) => {
            const interactionIndex = mapInteractionModel.indexByKey.get(mapInteractionKey('restriction', restriction.clusterId)) ?? -1;
            return (
            <RestrictionMark
              key={restriction.clusterId}
              restriction={restriction}
              annotationScale={circularTextScale}
              circular={isCircular}
              moreHit={moreHits.get(restriction.clusterId) ?? null}
              active={restriction.clusterId === activeClusterId}
              interactive={interactive}
              interactionIndex={interactionIndex}
              tabIndex={effectiveRovingMapInteractionIndex === interactionIndex ? 0 : -1}
              onRovingFocus={handleMapItemFocus}
              onRovingKeyDown={handleMapItemKeyDown}
              onClick={onRestrictionClick}
              onMenu={onRestrictionMenu}
            />
            );
          })}
        </g>

        {isCircular ? (
          <g
            className="motif-pm-center"
            aria-hidden="true"
            transform={counterScaleAbout(circularTextScale, layout.center.x, layout.center.y)}
          >
            {centerTitle.lines.map((line, i) => (
              <text
                key={i}
                className="motif-pm-center-name"
                x={layout.center.x}
                y={line.baselineY}
                textAnchor="middle"
                // Inline style (not the fontSize attr) so it wins over the
                // stylesheet's font-size and the 2-line notch actually applies.
                style={{ fontSize: `${line.fontSize}px` }}
              >
                {line.text}
              </text>
            ))}
            <text
              className="motif-pm-center-len"
              x={layout.center.x}
              y={centerTitle.lenBaselineY}
              textAnchor="middle"
              style={centerTitle.lenFontSize ? { fontSize: `${centerTitle.lenFontSize}px` } : undefined}
            >
              {layout.length.toLocaleString()} {unit}
            </text>
          </g>
        ) : null}
      </g>
    </svg>
  );
});
