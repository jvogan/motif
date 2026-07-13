/** @vitest-environment jsdom */

import { useState } from 'react';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  ClaudeScienceMsaViewer,
  type ClaudeScienceMsaViewerProps,
} from '../ClaudeScienceMsaViewer';
import { DEFAULT_CLAUDE_SCIENCE_MSA_VIEW_PREFERENCES } from '../claude-science-msa-view-preferences';

type MsaRecord = ClaudeScienceMsaViewerProps['records'][number];

function traceRecord(id: string, sequence: string): MsaRecord {
  return {
    id,
    name: id,
    type: 'dna',
    topology: 'linear',
    sequence,
    sangerTrace: {
      schema: 'motif.sanger-trace.v1',
      version: 1,
      baseCalls: sequence,
      sequence,
      qualityScores: [],
      peakPositions: [],
      channels: { A: [], C: [], G: [], T: [] },
      sampleCount: 0,
      dyeOrder: null,
      storedReverseComplement: false,
      warnings: [],
      metadata: {
        format: 'ABIF',
        abifVersion: 101,
        baseCallsTag: 'PBAS2',
        qualityScoresTag: null,
        peakPositionsTag: null,
        channelTags: {},
        sampleName: id,
      },
    },
  };
}

function Harness({
  initialRecords,
  importedRecords,
  activeRecordId,
}: {
  initialRecords: MsaRecord[];
  importedRecords: MsaRecord[];
  activeRecordId: string;
}) {
  const [records, setRecords] = useState<MsaRecord[]>(initialRecords);
  return (
    <ClaudeScienceMsaViewer
      records={records}
      alignments={[]}
      activeRecordId={activeRecordId}
      activeAlignmentId={null}
      viewPreferences={DEFAULT_CLAUDE_SCIENCE_MSA_VIEW_PREFERENCES}
      onActiveAlignmentChange={vi.fn()}
      onViewPreferencesChange={vi.fn()}
      onSaveAlignment={(alignment) => alignment}
      onUpdateAlignmentTemplate={() => null}
      onDeleteAlignment={vi.fn()}
      onImportRecords={async () => {
        setRecords((current) => [...current, ...importedRecords]);
        return {
          records: importedRecords,
          message: `Imported ${importedRecords.length} records`,
          tone: 'status',
        };
      }}
      onCopy={async () => true}
      onDownload={vi.fn()}
    />
  );
}

function selectedRecordNames(): string[] {
  return Array.from(document.querySelectorAll<HTMLElement>('.motif-cs-msa-record-option[data-active="true"]'))
    .map((row) => row.querySelector<HTMLElement>('.motif-cs-msa-record-name')?.textContent ?? '');
}

async function importFiles(files: File[]): Promise<void> {
  fireEvent.change(screen.getByLabelText('Choose sequence files for alignment'), { target: { files } });
  await waitFor(() => expect(screen.getByText(/Imported \d+ records/)).toBeTruthy());
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('ClaudeScienceMsaViewer AB1 intake selection', () => {
  it('selects imported AB1 reads without silently retaining an unrelated active record', async () => {
    const unrelated: MsaRecord = {
      id: 'puc19',
      name: 'pUC19',
      type: 'dna',
      topology: 'circular',
      sequence: 'G'.repeat(180),
    };
    const reads = [
      traceRecord('plate-read-01', 'AACCTTAACCATTAACCTAT'.repeat(4)),
      traceRecord('plate-read-02', 'AACCTTAACCATTAACCTAC'.repeat(4)),
    ];
    render(<Harness initialRecords={[unrelated]} importedRecords={reads} activeRecordId={unrelated.id} />);

    await importFiles([
      new File(['trace-one'], 'plate-read-01.ab1'),
      new File(['trace-two'], 'plate-read-02.ab1'),
    ]);

    await waitFor(() => expect(selectedRecordNames()).toEqual(['plate-read-01', 'plate-read-02']));
    fireEvent.click(screen.getByTestId('msa-selected-only'));
    const unrelatedRow = within(screen.getByTestId('msa-record-list')).getByText('pUC19').closest('label');
    expect(unrelatedRow?.getAttribute('data-active')).toBeNull();
    expect((unrelatedRow?.querySelector('input') as HTMLInputElement).checked).toBe(false);
    expect((screen.getByLabelText('Initial template') as HTMLSelectElement).value).toBe('plate-read-01');
    expect(screen.getByTestId('msa-source-link-status').textContent).toContain('selected 2 imported AB1 reads · initial template plate-read-01');
  });

  it('retains a biologically related current template for imported AB1 reads', async () => {
    const templateSequence = 'AACCGTTAACGATCGGATCCTAGGCTAATCG'.repeat(4);
    const template: MsaRecord = {
      id: 'chosen-template',
      name: 'Chosen Sanger template',
      type: 'dna',
      topology: 'linear',
      sequence: templateSequence,
    };
    const reads = [
      traceRecord('forward-read', templateSequence.slice(8, 96)),
      traceRecord('second-read', templateSequence.slice(20, 108)),
    ];
    render(<Harness initialRecords={[template]} importedRecords={reads} activeRecordId={template.id} />);

    await importFiles([
      new File(['trace-one'], 'forward-read.ab1'),
      new File(['trace-two'], 'second-read.ab1'),
    ]);

    await waitFor(() => expect(selectedRecordNames()).toEqual(['Chosen Sanger template', 'forward-read', 'second-read']));
    expect((screen.getByLabelText('Initial template') as HTMLSelectElement).value).toBe('chosen-template');
    expect(screen.getByTestId('msa-source-link-status').textContent).toContain('initial template Chosen Sanger template');
  });

  it('retains an explicitly chosen template even when sequence context is intentionally unusual', async () => {
    const initialRecords: MsaRecord[] = [
      { id: 'starting-record', name: 'Starting record', type: 'dna', topology: 'linear', group: 'Manual review', sequence: 'A'.repeat(120) },
      { id: 'manual-template', name: 'Manual template', type: 'dna', topology: 'linear', group: 'Manual review', sequence: 'C'.repeat(120) },
    ];
    const reads = [
      traceRecord('unusual-read-01', 'AACCTTAACCATTAACCTAT'.repeat(4)),
      traceRecord('unusual-read-02', 'AACCTTAACCATTAACCTAC'.repeat(4)),
    ];
    render(<Harness initialRecords={initialRecords} importedRecords={reads} activeRecordId="starting-record" />);
    fireEvent.change(screen.getByLabelText('Initial template'), { target: { value: 'manual-template' } });

    await importFiles([
      new File(['trace-one'], 'unusual-read-01.ab1'),
      new File(['trace-two'], 'unusual-read-02.ab1'),
    ]);

    await waitFor(() => expect(selectedRecordNames()).toEqual(['Manual template', 'unusual-read-01', 'unusual-read-02']));
    expect((screen.getByLabelText('Initial template') as HTMLSelectElement).value).toBe('manual-template');
  });

  it('preserves the existing template-selection behavior for ordinary FASTA imports', async () => {
    const current: MsaRecord = {
      id: 'current-template',
      name: 'Current template',
      type: 'dna',
      topology: 'linear',
      sequence: 'G'.repeat(120),
    };
    const fastaRecords: MsaRecord[] = [
      { id: 'fasta-a', name: 'FASTA A', type: 'dna', topology: 'linear', sequence: 'AACCTT'.repeat(16) },
      { id: 'fasta-b', name: 'FASTA B', type: 'dna', topology: 'linear', sequence: 'AACCTA'.repeat(16) },
    ];
    render(<Harness initialRecords={[current]} importedRecords={fastaRecords} activeRecordId={current.id} />);

    await importFiles([
      new File(['>fasta-a\nAACCTT'], 'fasta-a.fasta', { type: 'text/plain' }),
      new File(['>fasta-b\nAACCTA'], 'fasta-b.fasta', { type: 'text/plain' }),
    ]);

    await waitFor(() => expect(selectedRecordNames()).toEqual(['Current template', 'FASTA A', 'FASTA B']));
    expect((screen.getByLabelText('Initial template') as HTMLSelectElement).value).toBe('current-template');
  });

  it('reserves one preview slot for the current template at the ten-record FASTA limit', async () => {
    const current: MsaRecord = {
      id: 'current-template',
      name: 'Current template',
      type: 'dna',
      topology: 'linear',
      sequence: 'G'.repeat(120),
    };
    const fastaRecords: MsaRecord[] = Array.from({ length: 10 }, (_, index) => ({
      id: `fasta-${index + 1}`,
      name: `FASTA ${index + 1}`,
      type: 'dna' as const,
      topology: 'linear' as const,
      sequence: `${'AACCTT'.repeat(15)}${index % 4 === 0 ? 'A' : 'C'}`,
    }));
    render(<Harness initialRecords={[current]} importedRecords={fastaRecords} activeRecordId={current.id} />);

    await importFiles(fastaRecords.map((record) => (
      new File([`>${record.id}\n${record.sequence}`], `${record.id}.fasta`, { type: 'text/plain' })
    )));

    await waitFor(() => expect(selectedRecordNames()).toHaveLength(10));
    expect(selectedRecordNames()).toEqual(['Current template', ...fastaRecords.slice(0, 9).map((record) => record.name)]);
    expect((screen.getByLabelText('Initial template') as HTMLSelectElement).value).toBe('current-template');
    expect(screen.getByTestId('msa-source-link-status').textContent).toContain('1 over the 10-record preview limit');
  });

  it('reserves one preview slot for an explicitly chosen template at the ten-read AB1 limit', async () => {
    const initialRecords: MsaRecord[] = [
      { id: 'starting-record', name: 'Starting record', type: 'dna', topology: 'linear', group: 'Manual review', sequence: 'A'.repeat(120) },
      { id: 'manual-template', name: 'Manual template', type: 'dna', topology: 'linear', group: 'Manual review', sequence: 'C'.repeat(120) },
    ];
    const reads = Array.from({ length: 10 }, (_, index) => (
      traceRecord(`plate-read-${index + 1}`, `${'AACCTTAACCATTAACCTAC'.repeat(3)}${index % 4 === 0 ? 'A' : 'C'}`)
    ));
    render(<Harness initialRecords={initialRecords} importedRecords={reads} activeRecordId="starting-record" />);
    fireEvent.change(screen.getByLabelText('Initial template'), { target: { value: 'manual-template' } });

    await importFiles(reads.map((record) => new File(['trace'], `${record.id}.ab1`)));

    await waitFor(() => expect(selectedRecordNames()).toHaveLength(10));
    expect(selectedRecordNames()).toEqual(['Manual template', ...reads.slice(0, 9).map((record) => record.name)]);
    expect((screen.getByLabelText('Initial template') as HTMLSelectElement).value).toBe('manual-template');
    expect(screen.getByTestId('msa-source-link-status').textContent).toContain(
      'selected 9 imported AB1 reads · initial template Manual template',
    );
    expect(screen.getByTestId('msa-source-link-status').textContent).toContain('1 over the 10-record preview limit');
  });
});
