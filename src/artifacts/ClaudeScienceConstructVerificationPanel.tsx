import { useId, useMemo, useState } from 'react';
import {
  constructConflictCount,
  constructLowConfidenceCount,
  constructReferenceRangeLabel,
  constructVariantDisplayPosition,
  constructVerificationFindings,
} from './claude-science-construct-verification-display';
import './claude-science-construct-verification.css';

type ArtifactConstructVerificationState = 'consistent' | 'needs_review' | 'inconsistent';

type ArtifactConstructVerificationReasonPresentation = {
  code: string;
  severity: string;
  message: string;
  readId?: string;
  regionId?: string;
  variantId?: string;
};

type ArtifactConstructVerificationVariantPresentation = {
  id?: string;
  position?: number;
  referencePosition?: number;
  referenceStart?: number;
  referenceEnd?: number;
  type?: string;
  reference?: string;
  ref?: string;
  observed?: string;
  alternate?: string;
  alt?: string;
  supportingReadIds?: readonly string[];
  supportingReads?: number;
  support?: number;
  quality?: number;
  meanQuality?: number | null;
  confidence?: 'high' | 'low';
  depth?: number;
  status?: 'observed' | 'low_confidence' | 'not_observed' | 'not_covered';
  observedVariantId?: string;
};

type ArtifactConstructVerificationRegionPresentation = {
  id?: string;
  name?: string;
  label?: string;
  start?: number;
  end?: number;
  wraps?: boolean;
  length?: number;
  minDepth?: number;
  requireBothStrands?: boolean;
  coveredBases?: number;
  basesMeetingMinDepth?: number;
  coveredFraction?: number;
  minimumDepth?: number;
  maximumDepth?: number;
  meanDepth?: number;
  forwardCoveredBases?: number;
  reverseCoveredBases?: number;
  bothStrandsCoveredBases?: number;
  status?: string;
};

type ArtifactConstructVerificationReadPresentation = {
  id: string;
  name?: string;
  rawLength: number;
  meanQuality: number | null;
  status: string;
  trim?: {
    rawStart?: number;
    rawEnd?: number;
    trimmedLength?: number;
    removedFromStart?: number;
    removedFromEnd?: number;
  };
  mapping: {
    orientation: 'forward' | 'reverse';
    referenceStart?: number;
    referenceEnd?: number;
    referenceSpan?: number;
    wraps?: boolean;
    secondBestScore?: number | null;
    alignedBases?: number;
    alignedLength?: number;
    identity?: number;
    insertions?: number;
    deletions?: number;
  } | null;
};

/**
 * Narrow structural view of the frozen construct-verification result. Keeping
 * the presentation boundary independent lets this branch remain UI-only while
 * the engine result remains directly assignable. No sequence evaluation lives
 * in this component.
 */
export type ArtifactConstructVerificationPresentationResult = {
  schema: string;
  version: number;
  state: ArtifactConstructVerificationState;
  reasons: readonly ArtifactConstructVerificationReasonPresentation[];
  reference: {
    id?: string;
    recordId?: string;
    name?: string;
    length?: number;
    topology?: string;
  };
  reads: readonly ArtifactConstructVerificationReadPresentation[];
  thresholds?: {
    minMappingIdentity?: number;
  };
  coverage: {
    depth?: readonly number[];
    forward?: readonly number[];
    reverse?: readonly number[];
    coveredBases: number;
    basesMeetingMinDepth?: number;
    coveredFraction: number;
    meanDepth?: number;
    requiredRegions: readonly ArtifactConstructVerificationRegionPresentation[];
  };
  consensus: {
    calls: readonly { status: string }[];
  };
  variants: {
    observed: readonly ArtifactConstructVerificationVariantPresentation[];
    expected: readonly ArtifactConstructVerificationVariantPresentation[];
    unexpected: readonly ArtifactConstructVerificationVariantPresentation[];
    missingExpected: readonly ArtifactConstructVerificationVariantPresentation[];
  };
  provenance?: {
    engine?: string;
    engineVersion?: string;
    workUnits?: number;
  };
};

export type ClaudeScienceConstructVerificationPanelProps = {
  result: ArtifactConstructVerificationPresentationResult;
  referenceName?: string;
  readNames?: Readonly<Record<string, string>>;
  /** Opens the reads' traces at a variant. Without it the variant rows are plain text. */
  onInspectVariant?: (variant: ArtifactConstructVerificationVariantPresentation) => void;
  /** Whether a mapped read covers the variant, so there is a trace to open. */
  canInspectVariant?: (variant: ArtifactConstructVerificationVariantPresentation) => boolean;
  /** Why a row that cannot open its traces cannot, said in the row; nothing for a row with no trace to open. */
  variantTraceUnavailable?: (variant: ArtifactConstructVerificationVariantPresentation) => string | undefined;
};

type VariantClassification = 'expected' | 'unexpected' | 'missing_expected' | 'uncertain';
type VariantFilter = 'all' | VariantClassification;

type ClassifiedVariant = {
  classification: VariantClassification;
  variant: ArtifactConstructVerificationVariantPresentation;
  key: string;
};

const VERDICT_COPY: Record<ArtifactConstructVerificationState, { label: string; summary: string }> = {
  consistent: {
    label: 'Consistent',
    summary: 'Observed read evidence is consistent with the predicted construct within the recorded thresholds.',
  },
  needs_review: {
    label: 'Needs review',
    summary: 'The evidence is incomplete or contains findings that need scientific review before acceptance.',
  },
  inconsistent: {
    label: 'Inconsistent',
    summary: 'Observed read evidence conflicts with the predicted construct or a required expectation is missing.',
  },
};

const CLASSIFICATION_LABELS: Record<VariantClassification, string> = {
  expected: 'Expected',
  unexpected: 'Unexpected',
  missing_expected: 'Missing expected',
  uncertain: 'Low confidence',
};

const PRIMARY_REASON_LIMIT = 4;
const TOTAL_REASON_LIMIT = 24;
const VARIANT_LIMIT = 100;
const READ_LIMIT = 48;
const REGION_LIMIT = 48;

function boundedPercent(fraction: number | undefined): number | null {
  if (!Number.isFinite(fraction)) return null;
  return Math.min(100, Math.max(0, (fraction ?? 0) * 100));
}

function formatPercent(fraction: number | undefined, digits = 1): string {
  const percent = boundedPercent(fraction);
  return percent === null ? '—' : `${percent.toFixed(digits)}%`;
}

function formatNumber(value: number | undefined, suffix = ''): string {
  return Number.isFinite(value) ? `${(value ?? 0).toLocaleString()}${suffix}` : '—';
}

function formatQuality(value: number | null | undefined): string {
  return Number.isFinite(value) ? `Q${(value ?? 0).toFixed(1)}` : '—';
}

function readableToken(value: string | undefined): string {
  if (!value) return '—';
  return value.replaceAll('_', ' ').replaceAll('-', ' ');
}


function variantAlleles(variant: ArtifactConstructVerificationVariantPresentation): string {
  const reference = variant.reference ?? variant.ref ?? '—';
  const observed = variant.observed ?? variant.alternate ?? variant.alt ?? '—';
  return `${reference} → ${observed}`;
}

function variantSupport(variant: ArtifactConstructVerificationVariantPresentation): string {
  const count = variant.supportingReadIds?.length ?? variant.supportingReads ?? variant.support;
  if (Number.isFinite(count)) return formatNumber(count, count === 1 ? ' read' : ' reads');
  return Number.isFinite(variant.depth) ? formatNumber(variant.depth, '× depth') : '—';
}

function variantQuality(variant: ArtifactConstructVerificationVariantPresentation): string {
  const quality = variant.quality ?? variant.meanQuality;
  return Number.isFinite(quality) ? `Q${(quality ?? 0).toFixed(1)}` : '—';
}

/** "18" -> "…reference position 18"; "19–21" -> "…positions 19–21"; "after 50" -> "…the insertion after reference position 50". */
function variantTraceLabel(variant: ArtifactConstructVerificationVariantPresentation, position: string): string {
  const side = /^(after|before) (.+)$/.exec(position);
  if (variant.type === 'insertion' && side) return `Show the traces at the insertion ${side[1]} reference position ${side[2]}`;
  return `Show the traces at reference position${position.includes('–') ? 's' : ''} ${position}`;
}

function variantKey(variant: ArtifactConstructVerificationVariantPresentation, index: number): string {
  if (variant.id) return variant.id;
  const position = variant.position ?? variant.referencePosition ?? variant.referenceStart;
  const reference = variant.reference ?? variant.ref;
  const observed = variant.observed ?? variant.alternate ?? variant.alt;
  if (position === undefined && reference === undefined && observed === undefined) return `anonymous:${index}`;
  return `${position ?? ''}:${reference ?? ''}:${observed ?? ''}`;
}

function classifiedVariants(
  result: ArtifactConstructVerificationPresentationResult,
): ClassifiedVariant[] {
  const output: ClassifiedVariant[] = [];
  const seen = new Set<string>();
  result.variants.unexpected.forEach((variant, index) => {
    const classification: VariantClassification = variant.confidence === 'low' ? 'uncertain' : 'unexpected';
    const baseKey = variantKey(variant, index);
    if (seen.has(baseKey)) return;
    seen.add(baseKey);
    output.push({ classification, variant, key: `${classification}:${baseKey}` });
  });
  const observedById = new Map(result.variants.observed.map((variant) => [variant.id, variant]));
  result.variants.expected.forEach((expected, index) => {
    const observed = expected.observedVariantId ? observedById.get(expected.observedVariantId) : undefined;
    const displayVariant = observed
      ? { ...expected, support: observed.support, supportingReadIds: observed.supportingReadIds, meanQuality: observed.meanQuality }
      : expected;
    const classification: VariantClassification = expected.status === 'observed'
      ? 'expected'
      : expected.status === 'low_confidence'
        ? 'uncertain'
        : 'missing_expected';
    const baseKey = variantKey(displayVariant, index);
    if (seen.has(baseKey)) return;
    seen.add(baseKey);
    output.push({ classification, variant: displayVariant, key: `${classification}:${baseKey}` });
  });
  return output;
}

function meanDepth(depth: readonly number[] | undefined): number | null {
  if (!depth?.length) return null;
  let total = 0;
  for (const value of depth) total += value;
  return total / depth.length;
}

function regionName(region: ArtifactConstructVerificationRegionPresentation, index: number): string {
  return region.name ?? region.label ?? region.id ?? `Required region ${index + 1}`;
}

function regionRange(region: ArtifactConstructVerificationRegionPresentation, referenceLength?: number): string {
  return constructReferenceRangeLabel(region.start, region.end, referenceLength) ?? '—';
}

function regionStrands(region: ArtifactConstructVerificationRegionPresentation): string {
  const forward = (region.forwardCoveredBases ?? 0) > 0;
  const reverse = (region.reverseCoveredBases ?? 0) > 0;
  if (forward && reverse) return 'Forward + reverse';
  if (forward) return 'Forward only';
  if (reverse) return 'Reverse only';
  return 'No strand support';
}

function readPlacement(read: ArtifactConstructVerificationReadPresentation, referenceLength?: number): string {
  const range = constructReferenceRangeLabel(
    read.mapping?.referenceStart,
    read.mapping?.referenceEnd,
    referenceLength,
  );
  if (read.status === 'mapped') {
    return `${readableToken(read.mapping?.orientation)} · mapped · ${range ? `ref ${range}` : 'No mapped range'}`;
  }
  // A rejected read is not on the reference. Its best hit is named as such, with
  // no strand, so it does not read like the mapped rows around it.
  return `${readableToken(read.status)} · not mapped${range ? ` (best hit ref ${range})` : ''}`;
}

export function ClaudeScienceConstructVerificationPanel({
  result,
  referenceName,
  readNames = {},
  onInspectVariant,
  canInspectVariant,
  variantTraceUnavailable,
}: ClaudeScienceConstructVerificationPanelProps) {
  const sectionId = useId();
  const [variantFilter, setVariantFilter] = useState<VariantFilter>('all');
  const verdict = VERDICT_COPY[result.state];
  const allVariants = useMemo(() => classifiedVariants(result), [result]);
  const matchingVariants = useMemo(() => allVariants.filter((entry) => (
    variantFilter === 'all' || entry.classification === variantFilter
  )), [allVariants, variantFilter]);
  const filteredVariants = matchingVariants.slice(0, VARIANT_LIMIT);
  const filteredVariantCount = matchingVariants.length;
  const forwardReads = result.reads.filter((read) => read.status === 'mapped' && read.mapping?.orientation === 'forward').length;
  const reverseReads = result.reads.filter((read) => read.status === 'mapped' && read.mapping?.orientation === 'reverse').length;
  const mappedReads = result.reads.filter((read) => read.status === 'mapped').length;
  const readQualities = result.reads.flatMap((read) => read.meanQuality === null ? [] : [read.meanQuality]);
  const meanReadQuality = readQualities.length
    ? readQualities.reduce((total, value) => total + value, 0) / readQualities.length
    : undefined;
  const variantsByReadId = useMemo(() => {
    const counts = new Map<string, number>();
    result.variants.observed.forEach((variant) => {
      variant.supportingReadIds?.forEach((readId) => counts.set(readId, (counts.get(readId) ?? 0) + 1));
    });
    return counts;
  }, [result.variants.observed]);
  const averageDepth = result.coverage.meanDepth ?? meanDepth(result.coverage.depth);
  const coveragePercent = boundedPercent(result.coverage.coveredFraction);
  // One line per kind of finding, the ones that decided the verdict first.
  const findings = useMemo(() => constructVerificationFindings(result, readNames), [readNames, result]);
  const primaryReasons = findings.slice(0, PRIMARY_REASON_LIMIT);
  const additionalReasons = findings.slice(PRIMARY_REASON_LIMIT, TOTAL_REASON_LIMIT);
  const omittedReasons = Math.max(0, findings.length - TOTAL_REASON_LIMIT);
  const conflictCount = constructConflictCount(result.reasons);
  const lowConfidenceCount = constructLowConfidenceCount(result);
  const referenceLabel = referenceName
    ?? result.reference.name
    ?? result.reference.recordId
      ?? result.reference.id
      ?? 'Predicted construct';
  const expectedVariantCount = result.variants.expected.length;
  const unexpectedVariantCount = result.variants.unexpected.filter((variant) => variant.confidence !== 'low').length;
  const missingExpectedCount = result.variants.missingExpected.length;
  const acceptedCoveredBases = result.coverage.basesMeetingMinDepth ?? result.coverage.coveredBases;

  return (
    <section
      className="motif-cs-construct-verification"
      aria-label={`Construct verification: ${verdict.label}`}
      data-testid="construct-verification-panel"
    >
      <header className="motif-cs-construct-verification-verdict" data-verdict={result.state}>
        <span className="motif-cs-construct-verification-rail" aria-hidden="true" />
        <div className="motif-cs-construct-verification-heading">
          <span className="motif-cs-construct-verification-eyebrow">Construct verification</span>
          <strong>{verdict.label}</strong>
          <p>{verdict.summary}</p>
        </div>
        <div className="motif-cs-construct-verification-reference">
          <span>Predicted reference</span>
          <strong title={referenceLabel}>{referenceLabel}</strong>
          <span>{formatNumber(result.reference.length, ' bp')} · {readableToken(result.reference.topology)}</span>
        </div>
      </header>

      <dl className="motif-cs-construct-verification-facts" aria-label="Verification summary facts">
        <div><dt>Reference coverage</dt><dd>{formatPercent(result.coverage.coveredFraction)}</dd></div>
        <div><dt>Mapped reads</dt><dd>{mappedReads.toLocaleString()} / {result.reads.length.toLocaleString()}</dd></div>
        <div><dt>Strand support</dt><dd>{forwardReads.toLocaleString()} F · {reverseReads.toLocaleString()} R</dd></div>
        <div><dt>Mean depth</dt><dd>{averageDepth === null ? '—' : `${averageDepth.toFixed(1)}×`}</dd></div>
        <div><dt>Unexpected</dt><dd>{unexpectedVariantCount.toLocaleString()}</dd></div>
        <div data-fact="conflicts"><dt>Conflicts</dt><dd>{conflictCount === null ? '—' : conflictCount.toLocaleString()}</dd></div>
        <div data-fact="low-confidence"><dt>Low confidence</dt><dd>{lowConfidenceCount.toLocaleString()}</dd></div>
        <div><dt>Mean read quality</dt><dd>{formatQuality(meanReadQuality)}</dd></div>
      </dl>

      <div className="motif-cs-construct-verification-coverage">
        <div className="motif-cs-construct-verification-coverage-label">
          <span>Reference bases with accepted read coverage</span>
          <strong>{acceptedCoveredBases.toLocaleString()} bp · {formatPercent(result.coverage.coveredFraction)}</strong>
        </div>
        <progress
          aria-label={`Reference coverage ${formatPercent(result.coverage.coveredFraction)}`}
          max={100}
          value={coveragePercent ?? 0}
        />
      </div>

      <section className="motif-cs-construct-verification-section" aria-labelledby={`${sectionId}-findings`}>
        <div className="motif-cs-construct-verification-section-heading">
          <span id={`${sectionId}-findings`}>Review findings</span>
          <small>
            {findings.length.toLocaleString()} finding{findings.length === 1 ? '' : 's'}
            {findings.length !== result.reasons.length ? ` · ${result.reasons.length.toLocaleString()} reason${result.reasons.length === 1 ? '' : 's'}` : ''}
          </small>
        </div>
        {primaryReasons.length ? (
          <>
            <ul className="motif-cs-construct-verification-reasons">
              {primaryReasons.map((finding) => (
                <li className="motif-cs-construct-verification-reason" key={finding.key} data-severity={finding.severity} data-code={finding.code}>
                  <span className="motif-cs-construct-verification-reason-code">{readableToken(finding.severity)} · {readableToken(finding.code)}</span>
                  <span>{finding.message}</span>
                </li>
              ))}
            </ul>
            {additionalReasons.length ? (
              <details className="motif-cs-construct-verification-disclosure">
                <summary>Show {additionalReasons.length.toLocaleString()} more finding{additionalReasons.length === 1 ? '' : 's'}</summary>
                <ul className="motif-cs-construct-verification-reasons">
                  {additionalReasons.map((finding) => (
                    <li className="motif-cs-construct-verification-reason" key={finding.key} data-severity={finding.severity} data-code={finding.code}>
                      <span className="motif-cs-construct-verification-reason-code">{readableToken(finding.severity)} · {readableToken(finding.code)}</span>
                      <span>{finding.message}</span>
                    </li>
                  ))}
                </ul>
                {omittedReasons ? <p className="motif-cs-construct-verification-empty">{omittedReasons.toLocaleString()} additional findings are outside this bounded preview.</p> : null}
              </details>
            ) : null}
          </>
        ) : (
          <p className="motif-cs-construct-verification-empty">No review findings were recorded for this result.</p>
        )}
      </section>

      <section className="motif-cs-construct-verification-section" aria-labelledby={`${sectionId}-variants`}>
        <div className="motif-cs-construct-verification-section-heading">
          <span id={`${sectionId}-variants`}>Variant evidence</span>
          <label className="motif-cs-construct-verification-filter">
            <span>Show</span>
            <select value={variantFilter} onChange={(event) => setVariantFilter(event.target.value as VariantFilter)}>
              <option value="all">All evidence ({allVariants.length.toLocaleString()})</option>
              <option value="unexpected">Unexpected ({unexpectedVariantCount.toLocaleString()})</option>
              <option value="expected">Expected ({expectedVariantCount.toLocaleString()})</option>
              <option value="missing_expected">Missing expected ({missingExpectedCount.toLocaleString()})</option>
              <option value="uncertain">Low confidence</option>
            </select>
          </label>
        </div>
        {filteredVariants.length ? (
          <div
            className="motif-cs-construct-verification-table-scroll"
            tabIndex={0}
            aria-label="Scrollable variant evidence table"
            data-testid="construct-verification-variant-table"
          >
            {/* The roles keep this a table for assistive technology where a
                narrow panel lays each row out as a grid. */}
            <table className="motif-cs-construct-verification-table motif-cs-construct-verification-variants" role="table">
              <thead role="rowgroup">
                <tr role="row">
                  <th role="columnheader" title="1-based reference position, as in the sequence view">Position</th>
                  <th role="columnheader">Change</th>
                  <th role="columnheader">Type</th>
                  <th role="columnheader">Assessment</th>
                  <th role="columnheader">Support</th>
                  <th role="columnheader">Quality</th>
                </tr>
              </thead>
              <tbody role="rowgroup">
                {filteredVariants.map(({ classification, variant, key }) => {
                  const position = constructVariantDisplayPosition(variant, result.reference.length);
                  const inspect = onInspectVariant && (canInspectVariant?.(variant) ?? true)
                    ? () => onInspectVariant(variant)
                    : undefined;
                  const unavailable = inspect ? undefined : variantTraceUnavailable?.(variant);
                  return (
                    <tr
                      key={key}
                      role="row"
                      data-actionable={inspect ? true : undefined}
                      // The whole row opens the traces for a pointer; the
                      // Position button is the keyboard and screen-reader way in.
                      onClick={inspect ? (event) => {
                        if (event.target instanceof Element && event.target.closest('button')) return;
                        if (!window.getSelection()?.isCollapsed) return;
                        inspect();
                      } : undefined}
                    >
                      <td role="cell" data-numeric>
                        {inspect ? (
                          <button
                            type="button"
                            className="motif-cs-construct-verification-position"
                            aria-label={variantTraceLabel(variant, position)}
                            title={variantTraceLabel(variant, position)}
                            onClick={inspect}
                          >{position}</button>
                        ) : position}
                        {unavailable ? <small className="motif-cs-construct-verification-no-trace">{unavailable}</small> : null}
                      </td>
                      <td role="cell" data-sequence>{variantAlleles(variant)}</td>
                      <td role="cell">{readableToken(variant.type)}</td>
                      <td role="cell"><span className="motif-cs-construct-verification-tag" data-classification={classification}>{CLASSIFICATION_LABELS[classification]}</span></td>
                      <td role="cell" data-numeric>{variantSupport(variant)}</td>
                      <td role="cell" data-numeric>{variantQuality(variant)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {filteredVariantCount > VARIANT_LIMIT ? (
              <p className="motif-cs-construct-verification-empty">Showing the first {VARIANT_LIMIT.toLocaleString()} of {filteredVariantCount.toLocaleString()} matching variants.</p>
            ) : null}
          </div>
        ) : (
          <p className="motif-cs-construct-verification-empty">No variant evidence matches this view.</p>
        )}
      </section>

      {result.coverage.requiredRegions.length ? (
        <section className="motif-cs-construct-verification-section" aria-labelledby={`${sectionId}-regions`}>
          <div className="motif-cs-construct-verification-section-heading">
            <span id={`${sectionId}-regions`}>Required &amp; junction coverage</span>
            <small>{result.coverage.requiredRegions.length.toLocaleString()} region{result.coverage.requiredRegions.length === 1 ? '' : 's'}</small>
          </div>
          <div className="motif-cs-construct-verification-table-scroll" tabIndex={0} aria-label="Scrollable required region coverage table">
            <table className="motif-cs-construct-verification-table">
              <thead><tr><th>Region</th><th title="1-based, inclusive">Reference range</th><th>Coverage</th><th>Strands</th><th>Status</th></tr></thead>
              <tbody>
                {result.coverage.requiredRegions.slice(0, REGION_LIMIT).map((region, index) => (
                  <tr key={region.id ?? `${regionName(region, index)}:${index}`}>
                    <td>{regionName(region, index)}</td>
                    <td data-numeric>{regionRange(region, result.reference.length)}</td>
                    <td data-numeric>{formatPercent(region.coveredFraction)}</td>
                    <td>{regionStrands(region)}</td>
                    <td>{readableToken(region.status)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {result.coverage.requiredRegions.length > REGION_LIMIT ? (
              <p className="motif-cs-construct-verification-empty">Showing the first {REGION_LIMIT.toLocaleString()} required regions.</p>
            ) : null}
          </div>
        </section>
      ) : null}

      <section className="motif-cs-construct-verification-section" aria-labelledby={`${sectionId}-reads`}>
        <div className="motif-cs-construct-verification-section-heading">
          <span id={`${sectionId}-reads`}>Read evidence</span>
          <small>{result.reads.length.toLocaleString()} read{result.reads.length === 1 ? '' : 's'}</small>
        </div>
        {result.reads.length ? (
          <details className="motif-cs-construct-verification-disclosure">
            <summary>Inspect mapped reads and quality</summary>
            <div className="motif-cs-construct-verification-read-grid">
              {result.reads.slice(0, READ_LIMIT).map((read) => {
                const label = readNames[read.id] ?? read.name ?? read.id;
                const variantCount = variantsByReadId.get(read.id) ?? 0;
                return (
                  <article className="motif-cs-construct-verification-read" key={read.id}>
                    <strong>{label}</strong>
                    <span>{readPlacement(read, result.reference.length)}</span>
                    <span>{read.rawLength.toLocaleString()} calls · {formatQuality(read.meanQuality)} · {variantCount.toLocaleString()} variant{variantCount === 1 ? '' : 's'}</span>
                  </article>
                );
              })}
            </div>
            {result.reads.length > READ_LIMIT ? (
              <p className="motif-cs-construct-verification-empty">Showing the first {READ_LIMIT.toLocaleString()} reads.</p>
            ) : null}
          </details>
        ) : (
          <p className="motif-cs-construct-verification-empty">No read evidence was recorded.</p>
        )}
      </section>

      <footer className="motif-cs-construct-verification-provenance">
        <span>{result.schema} · v{result.version.toLocaleString()}</span>
        {result.provenance?.engine ? (
          <span>{result.provenance.engine}{result.provenance.engineVersion ? ` ${result.provenance.engineVersion}` : ''}</span>
        ) : null}
      </footer>
    </section>
  );
}

export default ClaudeScienceConstructVerificationPanel;
