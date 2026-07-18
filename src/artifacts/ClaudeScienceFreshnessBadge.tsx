/* eslint-disable react-refresh/only-export-components -- exports inert freshness text formatters for result panels and tests */
import './claude-science-freshness.css';

export type ScientificFreshnessDisplayReason = {
  code: string;
  message?: string;
  recordId?: string;
  rowId?: string;
  field?: string;
  expected?: string;
  actual?: string;
};

export type ScientificFreshnessDisplayEvaluation = {
  state: 'fresh' | 'stale' | 'unverified';
  reasons: readonly ScientificFreshnessDisplayReason[];
};

export type ClaudeScienceFreshnessBadgeProps = {
  evaluation: ScientificFreshnessDisplayEvaluation;
  recordNames?: Readonly<Record<string, string>>;
  showReason?: boolean;
};

const STATE_LABELS: Record<ScientificFreshnessDisplayEvaluation['state'], string> = {
  fresh: 'Fresh',
  stale: 'Stale',
  unverified: 'Unverified',
};

function readableCode(code: string): string {
  const normalized = code.replaceAll('_', ' ').replaceAll('-', ' ').trim();
  if (!normalized) return 'Saved input identity could not be verified';
  return `${normalized.charAt(0).toUpperCase()}${normalized.slice(1)}`;
}

function subjectForReason(
  reason: ScientificFreshnessDisplayReason,
  recordNames: Readonly<Record<string, string>>,
): string {
  const id = reason.recordId ?? reason.rowId;
  return id ? recordNames[id] ?? id : 'An input';
}

export function scientificFreshnessReasonText(
  reason: ScientificFreshnessDisplayReason,
  recordNames: Readonly<Record<string, string>> = {},
): string {
  const subject = subjectForReason(reason, recordNames);
  switch (reason.code) {
    case 'record_missing':
    case 'input_record_missing':
    case 'missing_input_record':
    case 'source_record_missing':
    case 'missing_source_record':
      return `${subject} is no longer in this workspace.`;
    case 'sequence_attestation_missing':
    case 'input_sha256_missing':
    case 'missing_input_sha256':
    case 'input_hash_missing':
    case 'missing_input_hash':
      return `${subject} was saved without a sequence fingerprint.`;
    case 'sequence_attestation_invalid':
      return `${subject}'s saved sequence fingerprint is invalid.`;
    case 'sequence_hash_mismatch':
    case 'input_sha256_mismatch':
    case 'sequence_changed':
    case 'sequence_mismatch':
    case 'row_sequence_changed':
      return `${subject}'s sequence has changed since this was created.`;
    case 'topology_attestation_missing':
      return `${subject} was saved without a topology attestation.`;
    case 'topology_attestation_invalid':
      return `${subject}'s saved topology attestation is invalid.`;
    case 'topology_changed':
    case 'topology_mismatch':
      return `${subject}'s topology has changed since this was created.`;
    case 'end_chemistry_attestation_missing':
      return `${subject} was saved without end-chemistry attestations.`;
    case 'end_chemistry_attestation_invalid':
      return `${subject}'s saved end-chemistry attestation is invalid.`;
    case 'end_chemistry_missing':
      return `${subject}'s current end chemistry is incomplete.`;
    case 'end_chemistry_changed':
    case 'end_chemistry_mismatch':
    case 'overhang_changed':
      return `${subject}'s end chemistry has changed since this was created.`;
    case 'alignment_row_source_unattested':
      return `${subject} is not linked to an attested source record.`;
    case 'input_count_mismatch':
    case 'hash_count_mismatch':
      return 'Saved input fingerprints do not align with the recorded inputs.';
    case 'source_identity_unverified':
    case 'input_identity_unverified':
      return `${subject}'s saved identity is incomplete.`;
    default:
      return reason.message?.trim()
        || `${readableCode(reason.code)}${reason.field ? ` (${reason.field})` : ''}.`;
  }
}

export function scientificFreshnessSummary(
  evaluation: ScientificFreshnessDisplayEvaluation,
  recordNames: Readonly<Record<string, string>> = {},
): string {
  if (evaluation.state === 'fresh') return 'Saved inputs match the current workspace.';
  const first = evaluation.reasons[0];
  const base = first
    ? scientificFreshnessReasonText(first, recordNames)
    : evaluation.state === 'stale'
      ? 'A saved input no longer matches the current workspace.'
      : 'Saved input identity is incomplete.';
  const remaining = evaluation.reasons.length - 1;
  return remaining > 0 ? `${base} ${remaining.toLocaleString()} more issue${remaining === 1 ? '' : 's'}.` : base;
}

export function ClaudeScienceFreshnessBadge({
  evaluation,
  recordNames = {},
  showReason = false,
}: ClaudeScienceFreshnessBadgeProps) {
  const summary = scientificFreshnessSummary(evaluation, recordNames);
  return (
    <span className="motif-cs-freshness" data-freshness={evaluation.state}>
      <span className="motif-cs-freshness-badge" title={summary} aria-label={`${STATE_LABELS[evaluation.state]}: ${summary}`}>
        <span aria-hidden="true" />
        {STATE_LABELS[evaluation.state]}
      </span>
      {showReason && evaluation.state !== 'fresh' ? (
        <span className="motif-cs-freshness-reason">{summary}</span>
      ) : null}
    </span>
  );
}

export default ClaudeScienceFreshnessBadge;
