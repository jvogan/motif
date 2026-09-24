/** @vitest-environment jsdom */

import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ClaudeScienceAgentResultsPanel } from '../ClaudeScienceAgentResultsPanel';
import type { ArtifactAnalysisResult } from '../claude-science-analysis-results';
import { verifyArtifactConstruct } from '../claude-science-construct-verification';
import { buildArtifactConstructVerificationArtifacts } from '../claude-science-construct-verification-artifacts';
import {
  constructVerificationTraceTarget,
  type ConstructVerificationTraceTarget,
} from '../claude-science-construct-verification-traces';
import type { ClaudeScienceConstructVerificationRecord } from '../ClaudeScienceConstructVerificationWorkspace';
import { sha256HexSync } from '../claude-science-sha256';

function deterministicDna(length: number, seed: number): string {
  const bases = ['A', 'C', 'G', 'T'] as const;
  let state = seed >>> 0;
  let sequence = '';
  for (let index = 0; index < length; index += 1) {
    state = (Math.imul(state, 1_664_525) + 1_013_904_223) >>> 0;
    sequence += bases[(state >>> 28) & 3];
  }
  return sequence;
}

function savedVerification() {
  const reference = deterministicDna(240, 0xdef);
  const variant = Array.from(reference, (base, index) => (index === 17 ? (base === 'A' ? 'G' : 'A') : base)).join('');
  const result = verifyArtifactConstruct({
    reference: { id: 'ref', name: 'pTarget predicted', sequence: reference, topology: 'linear', sha256: sha256HexSync(reference) },
    reads: [{ id: 'read-f', name: 'read-f', baseCalls: variant, qualityScores: new Array(variant.length).fill(40), sha256: sha256HexSync(variant) }],
    requiredRegions: [{ id: 'full-reference', name: 'Full predicted construct', start: 0, end: reference.length, minDepth: 1, requireBothStrands: false }],
    expectedVariants: [],
    thresholds: { minCoverageFraction: 1, minDepth: 1, requireBothStrands: false },
  });
  return buildArtifactConstructVerificationArtifacts(result, ['e'.repeat(64)], {
    resultId: 'cv-saved',
    assetId: 'cv-saved-report',
    createdAt: CREATED_AT,
  });
}

const CREATED_AT = '2026-07-12T20:00:00.000Z';

function verificationResult(
  id: string,
  state: 'consistent' | 'needs_review' | 'inconsistent',
): ArtifactAnalysisResult {
  return {
    id,
    kind: 'construct_verification',
    name: `Construct verification — ${state}`,
    status: 'complete',
    summary: `${state.replace('_', ' ')} · 2/2 reads mapped · 100.0% at ≥1×`,
    inputRecordIds: ['ref', 'read-f', 'read-r'],
    dependsOnResultIds: [],
    assetIds: [],
    parameters: {},
    data: {
      referenceRecordId: 'ref',
      readRecordIds: ['read-f', 'read-r'],
      state,
      referenceLength: 180,
      coveredBases: 180,
      coverageFraction: 1,
      mappedReadCount: 2,
      requiredRegionCount: 1,
      passingRegionCount: 1,
      observedVariantCount: state === 'inconsistent' ? 7 : 0,
      expectedVariantCount: 0,
      unexpectedVariantCount: state === 'inconsistent' ? 7 : 0,
      missingExpectedVariantCount: 0,
      reasonCodes: state === 'consistent' ? [] : ['unexpected_variant'],
    },
    createdAt: CREATED_AT,
    provenance: { source: 'motif-for-claude-science-artifact', engine: 'motif-construct-verification', engineVersion: '1' },
  };
}

afterEach(cleanup);

describe('ClaudeScienceAgentResultsPanel construct verification rows', () => {
  it('makes the verdict the row badge and demotes the finished-run status', () => {
    render(
      <ClaudeScienceAgentResultsPanel
        results={[
          verificationResult('cv-consistent', 'consistent'),
          verificationResult('cv-review', 'needs_review'),
          verificationResult('cv-inconsistent', 'inconsistent'),
        ]}
        assets={[]}
        recordNames={{ ref: 'pMOTIF predicted' }}
        onRevealRecord={vi.fn()}
        onRemove={vi.fn()}
      />,
    );

    const expected = [
      ['cv-consistent', 'consistent', 'Consistent'],
      ['cv-review', 'needs_review', 'Needs review'],
      ['cv-inconsistent', 'inconsistent', 'Inconsistent'],
    ] as const;
    for (const [id, state, label] of expected) {
      const row = screen.getByTestId(`analysis-result-${id}`);
      const cluster = row.querySelector('.motif-cs-agent-result-state');
      const badges = Array.from(cluster?.children ?? []);
      // The verdict is the first badge in the heading's state cluster.
      expect(badges[0]?.getAttribute('data-testid')).toBe('analysis-result-verdict');
      expect(badges[0]?.getAttribute('data-verdict')).toBe(state);
      expect(badges[0]?.textContent).toBe(label);
      // The run status keeps its data-status contract but is demoted.
      const status = within(row).getByText('complete');
      expect(status.getAttribute('data-status')).toBe('complete');
      expect(status.hasAttribute('data-demoted')).toBe(true);
      // The verdict is not repeated as an uncoloured lower-case fact.
      expect(within(row).queryByText('Verdict')).toBeNull();
    }
  });

  it('leaves the run status as the badge for results that carry no verdict', () => {
    const table: ArtifactAnalysisResult = {
      id: 'table-1',
      kind: 'table',
      name: 'QC measurements',
      status: 'complete',
      inputRecordIds: [],
      dependsOnResultIds: [],
      assetIds: [],
      parameters: {},
      data: { columns: [{ id: 'a', label: 'A', type: 'string' }], rows: [['x']] },
      createdAt: CREATED_AT,
      provenance: { source: 'claude-science' },
    };
    render(
      <ClaudeScienceAgentResultsPanel results={[table]} assets={[]} recordNames={{}} onRevealRecord={vi.fn()} onRemove={vi.fn()} />,
    );
    const row = screen.getByTestId('analysis-result-table-1');
    expect(within(row).queryByTestId('analysis-result-verdict')).toBeNull();
    expect(within(row).getByText('complete').hasAttribute('data-demoted')).toBe(false);
  });

  it('reopens the saved evidence from the report asset, numbered from 1', () => {
    const { result, asset } = savedVerification();
    expect(result.data.state).toBe('inconsistent');
    const before = asset.content;
    render(
      <ClaudeScienceAgentResultsPanel
        results={[result]}
        assets={[asset]}
        recordNames={{ ref: 'pTarget predicted', 'read-f': 'Clone 3 F.ab1' }}
        onRevealRecord={vi.fn()}
        onRemove={vi.fn()}
      />,
    );
    const row = screen.getByTestId('analysis-result-cv-saved');
    expect(within(row).queryByTestId('construct-verification-panel')).toBeNull();
    const open = within(row).getByTestId('analysis-result-open-evidence');
    expect(open.getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(open);
    expect(open.getAttribute('aria-expanded')).toBe('true');
    expect(open.textContent).toBe('Hide evidence');

    const evidence = within(row).getByTestId('analysis-result-verification-evidence');
    expect(document.getElementById(open.getAttribute('aria-controls') ?? '')?.contains(evidence)).toBe(true);
    const panel = within(evidence).getByTestId('construct-verification-panel');
    expect(within(panel).getByText('Inconsistent')).toBeTruthy();
    const facts = within(panel).getByLabelText('Verification summary facts');
    const fact = (label: string) => within(facts).getByText(label).nextElementSibling?.textContent;
    expect(fact('Mapped reads')).toBe('1 / 1');
    expect(fact('Unexpected')).toBe('1');
    // The report keeps a mean depth, so it is shown rather than "—".
    expect(fact('Mean depth')).toBe('1.0×');
    const table = within(panel).getByTestId('construct-verification-variant-table');
    expect(within(within(table).getAllByRole('row')[1]).getAllByRole('cell')[0]?.textContent).toBe('18');
    expect(within(panel).getByText(/^1 unexpected substitution: [ACGT]18[ACGT]\./)).toBeTruthy();
    expect(within(evidence).getByText(/saved JSON report keeps 0-based, end-exclusive coordinates/)).toBeTruthy();
    // Reading the report does not change it.
    expect(asset.content).toBe(before);
  });

  it('says so when the saved report asset is missing', () => {
    const { result } = savedVerification();
    render(
      <ClaudeScienceAgentResultsPanel results={[result]} assets={[]} recordNames={{}} onRevealRecord={vi.fn()} onRemove={vi.fn()} />,
    );
    const open = screen.getByTestId('analysis-result-open-evidence') as HTMLButtonElement;
    expect(open.disabled).toBe(true);
  });

  it('paints each verdict with the evidence panel verdict token', () => {
    const here = dirname(fileURLToPath(import.meta.url));
    const css = readFileSync(resolve(here, '..', 'claude-science-agent-results.css'), 'utf8');
    const rule = (selector: string) => {
      const start = css.indexOf(`${selector} {`);
      expect(start).toBeGreaterThanOrEqual(0);
      return css.slice(start, css.indexOf('}', start));
    };
    expect(rule('.motif-cs-agent-result-verdict[data-verdict="consistent"]')).toContain('var(--green)');
    expect(rule('.motif-cs-agent-result-verdict[data-verdict="needs_review"]')).toContain('var(--amber)');
    expect(rule('.motif-cs-agent-result-verdict[data-verdict="inconsistent"]')).toContain('var(--red)');
    const demoted = rule('.motif-cs-agent-result-status[data-demoted]');
    expect(demoted).toContain('color: var(--text-muted)');
    expect(demoted).not.toContain('var(--green)');
  });
});

describe('a saved verification variant row opens its traces', () => {
  // One read over the whole 240 bp reference with a substitution at 0-based 17,
  // which every table numbers 18.
  function savedRun() {
    const reference = deterministicDna(240, 0xdef);
    const read = Array.from(reference, (base, index) => (index === 17 ? (base === 'A' ? 'G' : 'A') : base)).join('');
    const engine = verifyArtifactConstruct({
      reference: { id: 'ref', name: 'pTarget predicted', sequence: reference, topology: 'linear', sha256: sha256HexSync(reference) },
      reads: [{ id: 'read-f', name: 'read-f', baseCalls: read, qualityScores: new Array(read.length).fill(40), sha256: sha256HexSync(read) }],
      requiredRegions: [{ id: 'full-reference', name: 'Full predicted construct', start: 0, end: reference.length, minDepth: 1, requireBothStrands: false }],
      expectedVariants: [],
      thresholds: { minCoverageFraction: 1, minDepth: 1, requireBothStrands: false },
    });
    const built = buildArtifactConstructVerificationArtifacts(engine, ['e'.repeat(64)], {
      resultId: 'cv-saved',
      assetId: 'cv-saved-report',
      createdAt: CREATED_AT,
    });
    const records: ClaudeScienceConstructVerificationRecord[] = [
      { id: 'ref', name: 'pTarget predicted', sequence: reference, topology: 'linear', sha256: sha256HexSync(reference) },
      { id: 'read-f', name: 'Clone 3 F.ab1', sequence: read, topology: 'linear', sha256: sha256HexSync(read), sangerTrace: { baseCalls: read } },
    ];
    return { engine, ...built, records, read };
  }

  function renderSaved(
    options: {
      records?: ClaudeScienceConstructVerificationRecord[];
      content?: string;
      onInspect?: (target: ConstructVerificationTraceTarget) => void;
    } = {},
  ) {
    const saved = savedRun();
    const asset = options.content === undefined
      ? saved.asset
      : { ...saved.asset, content: options.content, sha256: sha256HexSync(options.content) };
    render(
      <ClaudeScienceAgentResultsPanel
        results={[saved.result]}
        assets={[asset]}
        recordNames={{ ref: 'pTarget predicted', 'read-f': 'Clone 3 F.ab1' }}
        onRevealRecord={vi.fn()}
        onRemove={vi.fn()}
        verificationRecords={options.records ?? saved.records}
        onInspectVerificationVariant={options.onInspect}
      />,
    );
    fireEvent.click(screen.getByTestId('analysis-result-open-evidence'));
    const evidence = screen.getByTestId('analysis-result-verification-evidence');
    const table = within(evidence).getByTestId('construct-verification-variant-table');
    const row = within(table).getAllByRole('row')[1];
    return { saved, evidence, row };
  }

  it('opens the traces the live table would, at the base the row names', () => {
    const onInspect = vi.fn();
    const { saved, evidence, row } = renderSaved({ onInspect });
    const position = within(row).getByRole('button', { name: 'Show the traces at reference position 18' });
    expect(position.textContent).toBe('18');
    expect(position.getAttribute('type')).toBe('button');
    expect(row.hasAttribute('data-actionable')).toBe(true);
    expect(within(evidence).queryByTestId('saved-verification-traces-note')).toBeNull();

    fireEvent.click(position);
    expect(onInspect).toHaveBeenCalledTimes(1);
    const target = onInspect.mock.calls[0][0] as ConstructVerificationTraceTarget;
    const byId = new Map(saved.records.map((record) => [record.id, record]));
    const live = constructVerificationTraceTarget({
      result: saved.engine,
      variant: saved.engine.variants.observed[0],
      reference: byId.get('ref')!,
      records: byId,
    })!;
    expect(target.column).toBe(17);
    expect(target.column).toBe(live.column);
    expect(target.rowId).toBe(live.rowId);
    expect(target.alignment.id).toBe(live.alignment.id);
    expect(target.alignment.rows.map((alignmentRow) => [alignmentRow.sourceRecordId, alignmentRow.aligned]))
      .toEqual([['ref', byId.get('ref')!.sequence], ['read-f', saved.read]]);

    // The rest of the row takes a pointer too, as in the live table.
    fireEvent.click(within(row).getAllByRole('cell')[1]);
    expect(onInspect).toHaveBeenCalledTimes(2);
  });

  it('says in the row when the read was edited since the run, and opens nothing', () => {
    const onInspect = vi.fn();
    const saved = savedRun();
    // One call changed after the run, far from the variant.
    const flipped = `${saved.read.slice(0, 200)}${saved.read[200] === 'A' ? 'C' : 'A'}${saved.read.slice(201)}`;
    const edited = saved.records.map((record) => (record.id === 'read-f'
      ? { ...record, sangerTrace: { baseCalls: flipped } }
      : record));
    const { evidence, row } = renderSaved({ onInspect, records: edited });
    expect(within(row).queryByRole('button')).toBeNull();
    expect(row.hasAttribute('data-actionable')).toBe(false);
    expect(within(row).getAllByRole('cell')[0].textContent).toBe('18Read edited since this run');
    expect(within(evidence).getByTestId('saved-verification-traces-note').textContent)
      .toBe('Traces unavailable: Clone 3 F.ab1 has been edited since this run. A row only that read covers cannot open.');
    fireEvent.click(within(row).getAllByRole('cell')[1]);
    expect(onInspect).not.toHaveBeenCalled();
  });

  it.each([
    {
      state: 'untouched',
      records: (records: ReturnType<typeof savedRun>['records']) => records,
      cell: '18',
      note: null,
    },
    {
      // Typing over a read's bases unlinks its chromatogram and keeps the record.
      state: 'edited, trace dropped',
      records: (records: ReturnType<typeof savedRun>['records']) => records.map((record) => (
        record.id === 'read-f' ? { ...record, sangerTrace: undefined } : record)),
      cell: '18Read edited since this run',
      note: 'Traces unavailable: Clone 3 F.ab1 has been edited since this run. A row only that read covers cannot open.',
    },
    {
      state: 'removed',
      records: (records: ReturnType<typeof savedRun>['records']) => records.filter((record) => record.id !== 'read-f'),
      cell: '18Read not in this workspace',
      note: 'Traces unavailable: read-f is not in this workspace. A row only that read covers cannot open.',
    },
  ])('gives a $state read its own note', ({ records, cell, note }) => {
    const saved = savedRun();
    const { evidence, row } = renderSaved({ onInspect: vi.fn(), records: records(saved.records) });
    expect(within(row).getAllByRole('cell')[0].textContent).toBe(cell);
    expect(within(evidence).queryByTestId('saved-verification-traces-note')?.textContent ?? null).toBe(note);
  });

  it('says in the row when the reference is not in this workspace', () => {
    const saved = savedRun();
    const { evidence, row } = renderSaved({ onInspect: vi.fn(), records: saved.records.filter((record) => record.id !== 'ref') });
    expect(within(row).queryByRole('button')).toBeNull();
    expect(within(row).getAllByRole('cell')[0].textContent).toBe('18Reference not in this workspace');
    expect(within(evidence).getByTestId('saved-verification-traces-note').textContent)
      .toBe('Traces unavailable: pTarget predicted is not in this workspace, so these rows cannot open its traces.');
  });

  it('keeps an older report’s rows plain, and says why', () => {
    const saved = savedRun();
    const report = JSON.parse(saved.asset.content) as { reads: Array<{ mapping: Record<string, unknown> | null }> };
    report.reads.forEach((read) => { delete read.mapping?.cigar; });
    const { evidence, row } = renderSaved({ onInspect: vi.fn(), content: `${JSON.stringify(report, null, 2)}\n` });
    expect(within(row).queryByRole('button')).toBeNull();
    expect(within(row).getAllByRole('cell')[0].textContent).toBe('18');
    expect(within(evidence).getByTestId('saved-verification-traces-note').textContent)
      .toMatch(/^This verification was saved before saved reports kept each read's map/);
  });

  it('stays plain text in a host that cannot open traces', () => {
    const { evidence, row } = renderSaved();
    expect(within(row).queryByRole('button')).toBeNull();
    expect(within(row).getAllByRole('cell')[0].textContent).toBe('18');
    expect(within(evidence).queryByTestId('saved-verification-traces-note')).toBeNull();
  });
});
