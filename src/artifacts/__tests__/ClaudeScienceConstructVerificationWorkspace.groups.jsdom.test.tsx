/** @vitest-environment jsdom */

import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  ClaudeScienceConstructVerificationWorkspace,
  type ClaudeScienceConstructVerificationRecord,
} from '../ClaudeScienceConstructVerificationWorkspace';

function reference(id: string, group?: string): ClaudeScienceConstructVerificationRecord {
  return { id, name: `Predicted ${id}`, sequence: 'ACGT'.repeat(60), topology: 'linear', sha256: 'a'.repeat(64), ...(group ? { group } : {}) };
}

function read(id: string, group?: string): ClaudeScienceConstructVerificationRecord {
  return {
    id,
    name: `${id}.ab1`,
    sequence: 'ACGT'.repeat(40),
    topology: 'linear',
    sha256: 'b'.repeat(64),
    sangerTrace: { baseCalls: 'ACGT'.repeat(40), qualityScores: Array.from({ length: 160 }, () => 40) },
    sangerEvidenceSha256: 'c'.repeat(64),
    ...(group ? { group } : {}),
  };
}

function checkedReadNames(): string[] {
  const list = screen.getByTestId('construct-verification-read-list');
  return Array.from(list.querySelectorAll<HTMLInputElement>('input[type="checkbox"]'))
    .filter((input) => input.checked)
    .map((input) => input.closest('label')?.querySelector('strong')?.textContent ?? '');
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('ClaudeScienceConstructVerificationWorkspace read groups', () => {
  const records = [
    reference('ref-3', 'Clone 3'),
    reference('ref-5', 'Clone 5'),
    read('c5-f', 'Clone 5'),
    read('c3-f', 'Clone 3'),
    read('c5-r', 'Clone 5'),
    read('c3-r', 'Clone 3'),
  ];

  it("starts with the reference's group selected, not every read in the workspace", () => {
    render(
      <ClaudeScienceConstructVerificationWorkspace embedded records={records} initialReferenceId="ref-3" onVerify={vi.fn()} onSave={vi.fn()} />,
    );
    expect(checkedReadNames()).toEqual(['c3-f.ab1', 'c3-r.ab1']);
    expect(screen.getByText(/2 of 4 reads selected/)).toBeTruthy();
    expect(screen.getByTestId('construct-verification-read-default').textContent).toBe('Reads in “Clone 3”, the reference\'s group, start selected.');

    // Groups are listed, the reference's own first.
    const list = screen.getByTestId('construct-verification-read-list');
    const headings = Array.from(list.querySelectorAll('.motif-cs-verification-read-group-heading span'), (span) => span.textContent);
    expect(headings).toEqual(['Clone 3 · 2', 'Clone 5 · 2']);

    fireEvent.click(within(list).getByRole('button', { name: 'Select the reads in Clone 5' }));
    expect(checkedReadNames()).toEqual(['c3-f.ab1', 'c3-r.ab1', 'c5-f.ab1', 'c5-r.ab1']);
  });

  it('follows the reference to its group when the reference changes', () => {
    render(
      <ClaudeScienceConstructVerificationWorkspace embedded records={records} initialReferenceId="ref-3" onVerify={vi.fn()} onSave={vi.fn()} />,
    );
    fireEvent.change(screen.getByTestId('construct-verification-reference'), { target: { value: 'ref-5' } });
    expect(checkedReadNames()).toEqual(['c5-f.ab1', 'c5-r.ab1']);
  });

  it('keeps the ungrouped case working: ungrouped reads go with an ungrouped reference', () => {
    render(
      <ClaudeScienceConstructVerificationWorkspace
        embedded
        records={[reference('ref'), read('a'), read('b'), read('other', 'Clone 9')]}
        initialReferenceId="ref"
        onVerify={vi.fn()}
        onSave={vi.fn()}
      />,
    );
    expect(checkedReadNames()).toEqual(['a.ab1', 'b.ab1']);
  });

  it('offers AB1 import when there are no reads, and selects the reads it imports', () => {
    const onImportReads = vi.fn();
    const view = render(
      <ClaudeScienceConstructVerificationWorkspace
        embedded
        records={[reference('ref', 'Design')]}
        initialReferenceId="ref"
        onVerify={vi.fn()}
        onSave={vi.fn()}
        onImportReads={onImportReads}
      />,
    );
    const importButton = screen.getByTestId('construct-verification-import');
    expect(importButton.textContent).toBe('Import AB1 reads…');
    const input = screen.getByTestId('construct-verification-import-input') as HTMLInputElement;
    expect(input.accept).toBe('.ab1,.abi');
    const click = vi.spyOn(input, 'click');
    fireEvent.click(importButton);
    expect(click).toHaveBeenCalledTimes(1);

    const file = new File(['ABIF'], 'clone1_F.ab1', { type: 'application/octet-stream' });
    fireEvent.change(input, { target: { files: [file] } });
    expect(onImportReads).toHaveBeenCalledTimes(1);

    // The importer puts the reads in its own group; they are still selected.
    view.rerender(
      <ClaudeScienceConstructVerificationWorkspace
        embedded
        records={[reference('ref', 'Design'), read('clone1_F', 'Imported AB1')]}
        initialReferenceId="ref"
        onVerify={vi.fn()}
        onSave={vi.fn()}
        onImportReads={onImportReads}
      />,
    );
    expect(checkedReadNames()).toEqual(['clone1_F.ab1']);
  });

  it('shows no import control when the host offers no importer', () => {
    render(
      <ClaudeScienceConstructVerificationWorkspace embedded records={[reference('ref')]} initialReferenceId="ref" onVerify={vi.fn()} onSave={vi.fn()} />,
    );
    expect(screen.queryByTestId('construct-verification-import')).toBeNull();
  });
});
