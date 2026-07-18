// @vitest-environment jsdom

import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  ClaudeScienceNotesPanel,
  type ClaudeScienceNotesPanelProps,
} from '../ClaudeScienceNotesPanel';
import type { ArtifactNote } from '../claude-science-workspace-collections';

const notes: ArtifactNote[] = [
  {
    id: 'workspace-note',
    title: '<b>Workspace plan</b>',
    body: '<img src=x onerror="globalThis.pwned=true"> Keep as text.',
    format: 'markdown',
    scope: 'workspace',
    createdAt: '2026-07-12T16:00:00.000Z',
    updatedAt: '2026-07-12T16:00:00.000Z',
  },
  {
    id: 'record-note',
    title: 'Record QC',
    body: 'Confirm the insert orientation.',
    format: 'plain',
    scope: 'record',
    recordId: 'pUC19',
    createdAt: '2026-07-12T17:00:00.000Z',
    updatedAt: '2026-07-12T17:00:00.000Z',
  },
  {
    id: 'range-note',
    body: 'Promoter window',
    format: 'plain',
    scope: 'range',
    recordId: 'pUC19',
    range: { start: 9, end: 30 },
    createdAt: '2026-07-12T18:00:00.000Z',
    updatedAt: '2026-07-12T18:00:00.000Z',
  },
  {
    id: 'other-record-note',
    body: 'Other construct',
    format: 'plain',
    scope: 'record',
    recordId: 'pBR322',
    createdAt: '2026-07-12T19:00:00.000Z',
    updatedAt: '2026-07-12T19:00:00.000Z',
  },
];

function props(overrides: Partial<ClaudeScienceNotesPanelProps> = {}): ClaudeScienceNotesPanelProps {
  return {
    notes,
    activeRecordId: 'pUC19',
    activeRecordName: 'pUC19',
    selectedRange: { start: 9, end: 30 },
    onAdd: vi.fn(),
    onUpdate: vi.fn(),
    onConfirmAnchor: vi.fn(),
    onRemove: vi.fn(),
    onReveal: vi.fn(),
    ...overrides,
  };
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('ClaudeScienceNotesPanel', () => {
  it('filters workspace and active-record notes and renders HTML-looking content as inert text', async () => {
    const user = userEvent.setup();
    const onReveal = vi.fn();
    const view = render(<ClaudeScienceNotesPanel {...props({ onReveal })} />);

    expect(screen.getByText('<b>Workspace plan</b>')).toBeTruthy();
    expect(screen.getByText(/<img src=x onerror=/)).toBeTruthy();
    expect(view.container.querySelector('img')).toBeNull();
    expect(view.container.querySelector('script')).toBeNull();

    await user.click(screen.getByRole('button', { name: 'Record' }));
    const list = screen.getByTestId('notes-list');
    expect(within(list).getByText('Record QC')).toBeTruthy();
    expect(within(list).getByText('Promoter window')).toBeTruthy();
    expect(within(list).queryByText('<b>Workspace plan</b>')).toBeNull();
    expect(within(list).queryByText('Other construct')).toBeNull();

    const rangeNote = screen.getByTestId('note-range-note');
    expect(within(rangeNote).getByText(/pUC19 · 10–30/)).toBeTruthy();
    await user.click(within(rangeNote).getByRole('button', { name: 'Reveal' }));
    expect(onReveal).toHaveBeenCalledWith(notes[2]);

    await user.click(screen.getByRole('button', { name: 'Workspace' }));
    expect(within(list).getByText('<b>Workspace plan</b>')).toBeTruthy();
    expect(within(list).queryByRole('button', { name: 'Reveal' })).toBeNull();
  });

  it('defaults a new note to the selected range and submits a controlled Markdown note', async () => {
    const user = userEvent.setup();
    const onAdd = vi.fn();
    render(<ClaudeScienceNotesPanel {...props({ notes: [], onAdd })} />);

    await user.click(screen.getByText('Add note', { selector: 'summary span' }));
    const scope = screen.getByLabelText('Scope') as HTMLSelectElement;
    expect(scope.value).toBe('range');
    expect(document.activeElement).toBe(screen.getByLabelText('Title'));

    await user.type(screen.getByLabelText('Title'), '  Review window  ');
    await user.type(screen.getByLabelText('Note'), '**Check** this promoter.');
    await user.click(screen.getByRole('button', { name: 'Markdown' }));
    await user.click(screen.getByRole('button', { name: 'Add note' }));

    expect(onAdd).toHaveBeenCalledWith({
      title: 'Review window',
      body: '**Check** this promoter.',
      format: 'markdown',
      scope: 'range',
      recordId: 'pUC19',
      range: { start: 9, end: 30 },
    });
    expect(screen.getByRole('status').textContent).toContain('Note added.');
  });

  it('requires note text and falls back from record scope to workspace without an active record', async () => {
    const user = userEvent.setup();
    const onAdd = vi.fn();
    render(<ClaudeScienceNotesPanel {...props({
      notes: [],
      activeRecordId: null,
      activeRecordName: null,
      selectedRange: null,
      onAdd,
    })} />);

    expect((screen.getByRole('button', { name: 'Record' }) as HTMLButtonElement).disabled).toBe(true);
    await user.click(screen.getByText('Add note', { selector: 'summary span' }));
    expect((screen.getByLabelText('Scope') as HTMLSelectElement).value).toBe('workspace');
    await user.click(screen.getByRole('button', { name: 'Add note' }));
    expect(screen.getByRole('alert').textContent).toContain('Note body is required.');
    expect(onAdd).not.toHaveBeenCalled();
  });

  it('supports focused editing and a reversible two-step inline delete confirmation', async () => {
    const user = userEvent.setup();
    const onUpdate = vi.fn();
    const onRemove = vi.fn();
    render(<ClaudeScienceNotesPanel {...props({ notes: [notes[1]], onUpdate, onRemove })} />);

    const note = screen.getByTestId('note-record-note');
    const edit = within(note).getByRole('button', { name: 'Edit' });
    await user.click(edit);
    const title = within(note).getByLabelText('Title for Record QC');
    expect(document.activeElement).toBe(title);
    await user.clear(title);
    await user.type(title, 'Updated QC');
    const body = within(note).getByLabelText('Note');
    await user.clear(body);
    await user.type(body, 'Orientation confirmed.');
    await user.click(within(note).getByRole('button', { name: 'Update' }));
    expect(onUpdate).toHaveBeenCalledWith('record-note', {
      title: 'Updated QC',
      body: 'Orientation confirmed.',
      format: 'plain',
    });

    const deleteButton = within(note).getByRole('button', { name: 'Delete Record QC' });
    await user.click(deleteButton);
    const cancel = within(note).getByRole('button', { name: 'Cancel' });
    expect(document.activeElement).toBe(cancel);
    await user.keyboard('{Escape}');
    expect(document.activeElement).toBe(deleteButton);
    expect(onRemove).not.toHaveBeenCalled();

    await user.click(deleteButton);
    await user.click(within(note).getByRole('button', { name: 'Delete note' }));
    expect(onRemove).toHaveBeenCalledWith('record-note');
    expect(screen.getByRole('status').textContent).toContain('Note deleted.');
  });

  it('surfaces a remapped range for explicit scientific confirmation', async () => {
    const user = userEvent.setup();
    const onConfirmAnchor = vi.fn();
    const reviewNote: ArtifactNote = {
      ...notes[2],
      provenance: {
        source: 'motif-for-claude-science-artifact',
        operation: 'sequence_edit_anchor_review',
        metadata: {
          motifRangeAnchor: {
            status: 'review',
            previousRange: { start: 9, end: 30 },
            currentRange: { start: 9, end: 31 },
            edit: { start: 20, deletedLength: 0, insertedLength: 1, oldLength: 100 },
            editedAt: '2026-07-18T18:00:00.000Z',
          },
        },
      },
    };

    render(<ClaudeScienceNotesPanel {...props({ notes: [reviewNote], onConfirmAnchor })} />);
    expect(screen.getByText('Review range anchor.')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Confirm anchor' }));
    expect(onConfirmAnchor).toHaveBeenCalledWith(reviewNote.id);
    expect(screen.getByRole('status').textContent).toContain('Range anchor confirmed.');
  });
});
