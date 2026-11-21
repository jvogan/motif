/** @vitest-environment jsdom */

import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useMemo, useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ClaudeScienceFindBar } from '../ClaudeScienceFindBar';
import { findSequenceMatches, type FindMatch } from '../claude-science-find';
import { useSequenceFind } from '../claude-science-find-state';

// Built from repeats; the filler is all A, so matches sit only at the planted sites.
const [A, C, G, T] = ['A', 'C', 'G', 'T'];
const ECORI = G + A + A + T + T + C;
const BSAI = G + G + T + C + T + C;
const BSAI_BOTTOM = G + A + G + A + C + C;
// EcoRI at 10 and 40, a bottom-strand BsaI site at 25.
const SEQUENCE = A.repeat(10) + ECORI + A.repeat(9) + BSAI_BOTTOM + A.repeat(9) + ECORI + A.repeat(10);

type HarnessProps = {
  initialQuery?: string;
  settledQuery?: string;
  selection?: { start: number; end: number } | null;
  selectionText?: string | null;
  onSelect: (match: FindMatch) => void;
  onFocusSequence?: () => void;
};

function Harness({ initialQuery = '', settledQuery, selection = null, selectionText = null, onSelect, onFocusSequence = () => {} }: HarnessProps) {
  const [query, setQuery] = useState(initialQuery);
  const searchedQuery = settledQuery ?? query;
  const result = useMemo(() => findSequenceMatches(SEQUENCE, searchedQuery, 'dna', 'linear'), [searchedQuery]);
  const find = useSequenceFind({
    enabled: true,
    recordId: 'record',
    query,
    result,
    resultIsCurrent: searchedQuery === query,
    selection,
    selectionText,
    caret: null,
    onQueryChange: setQuery,
    onSelectMatch: onSelect,
    onOpen: () => {},
    onFocusSequence,
  });
  return (
    <div>
      <button type="button" onClick={find.openFind}>Find</button>
      {find.open ? <ClaudeScienceFindBar find={find} maxLength={256} /> : null}
      <div className="motif-cs-window"><input aria-label="Window field" /></div>
    </div>
  );
}

const field = () => screen.getByRole('searchbox', { name: 'Find in sequence' }) as HTMLInputElement;
const count = () => screen.getByRole('status');

afterEach(() => cleanup());

describe('find bar keys', () => {
  it('does not step through the previous query\'s matches while the new query is searching', async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    const { rerender } = render(<Harness initialQuery={BSAI} settledQuery={ECORI} onSelect={onSelect} />);
    await user.keyboard('{Control>}f{/Control}');
    await user.keyboard('{F3}');
    expect(onSelect).not.toHaveBeenCalled();
    expect(count().textContent).toContain('Searching…');

    rerender(<Harness initialQuery={BSAI} settledQuery={BSAI} onSelect={onSelect} />);
    expect(count().textContent).toBe('1 match');
    await user.keyboard('{F3}');
    expect(onSelect).toHaveBeenCalledExactlyOnceWith({ start: 25, end: 31, strand: -1 });
  });

  it('opens with Cmd/Ctrl+F, finds both strands, and steps with Enter and Shift+Enter', async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    render(<Harness onSelect={onSelect} />);
    expect(screen.queryByRole('search')).toBeNull();

    await user.keyboard('{Control>}f{/Control}');
    expect(document.activeElement).toBe(field());
    expect(count().textContent).toBe('Both strands');

    await user.type(field(), BSAI);
    // One jump after the keys pause, not one per keystroke.
    expect(onSelect).not.toHaveBeenCalled();
    expect(count().textContent).toBe('1 match');
    await waitFor(() => expect(onSelect).toHaveBeenCalledTimes(1));
    expect(onSelect).toHaveBeenLastCalledWith({ start: 25, end: 31, strand: -1 });
    expect(count().textContent).toContain('1 of 1');
    expect(count().textContent).toContain('reverse strand');
    // One match has nowhere to step to: both arrows are off and say why.
    for (const name of ['Previous match', 'Next match']) {
      const arrow = screen.getByRole('button', { name }) as HTMLButtonElement;
      expect(arrow.disabled).toBe(true);
      expect(arrow.title).toBe('Only one match');
    }

    // A new query searches on from the current match, so it lands on the
    // EcoRI site after 25, not the first one in the record.
    await user.clear(field());
    await user.type(field(), ECORI.toLowerCase());
    await waitFor(() => expect(onSelect).toHaveBeenLastCalledWith({ start: 40, end: 46, strand: 1 }));
    expect(count().textContent).toContain('2 of 2');
    expect((screen.getByRole('button', { name: 'Next match' }) as HTMLButtonElement).disabled).toBe(false);
    expect((screen.getByRole('button', { name: 'Previous match' }) as HTMLButtonElement).disabled).toBe(false);

    await user.keyboard('{Shift>}{Enter}{/Shift}');
    expect(onSelect).toHaveBeenLastCalledWith({ start: 10, end: 16, strand: 1 });
    expect(count().textContent).toContain('1 of 2');
    expect(count().textContent).not.toContain('Wrapped');

    await user.keyboard('{Enter}');
    expect(onSelect).toHaveBeenLastCalledWith({ start: 40, end: 46, strand: 1 });
    expect(count().textContent).toContain('2 of 2');

    // Past the last match it wraps and says so.
    await user.keyboard('{Enter}');
    expect(onSelect).toHaveBeenLastCalledWith({ start: 10, end: 16, strand: 1 });
    expect(count().textContent).toContain('Wrapped to the first match');
    expect(count().textContent).toContain('1 of 2');

    await user.keyboard('{Shift>}{Enter}{/Shift}');
    expect(onSelect).toHaveBeenLastCalledWith({ start: 40, end: 46, strand: 1 });
    expect(count().textContent).toContain('Wrapped to the last match');
  });

  it('steps with Cmd/Ctrl+G and F3, with Shift going back', async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    render(<Harness initialQuery={ECORI} onSelect={onSelect} />);
    await user.click(screen.getByRole('button', { name: 'Find' }));
    expect(count().textContent).toBe('2 matches');
    await user.keyboard('{Meta>}g{/Meta}');
    expect(onSelect).toHaveBeenLastCalledWith({ start: 10, end: 16, strand: 1 });
    await user.keyboard('{F3}');
    expect(onSelect).toHaveBeenLastCalledWith({ start: 40, end: 46, strand: 1 });
    await user.keyboard('{Shift>}{F3}{/Shift}');
    expect(onSelect).toHaveBeenLastCalledWith({ start: 10, end: 16, strand: 1 });
    await user.keyboard('{Control>}{Shift>}g{/Shift}{/Control}');
    expect(onSelect).toHaveBeenLastCalledWith({ start: 40, end: 46, strand: 1 });
  });

  it('clears with the x inside the field and keeps typing focus there', async () => {
    const user = userEvent.setup();
    render(<Harness onSelect={vi.fn()} />);
    await user.keyboard('{Control>}f{/Control}');
    expect(screen.queryByRole('button', { name: 'Clear search' })).toBeNull();
    await user.type(field(), ECORI);
    const clear = screen.getByRole('button', { name: 'Clear search' });
    expect(clear.getAttribute('title')).toBe('Clear search');
    await user.click(clear);
    expect(field().value).toBe('');
    expect(document.activeElement).toBe(field());
    expect(screen.queryByRole('button', { name: 'Clear search' })).toBeNull();
    expect(count().textContent).toBe('Both strands');
  });

  it('closes with Escape or Done, returning focus to the sequence without changing the selection', async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    const onFocusSequence = vi.fn();
    render(<Harness initialQuery={ECORI} onSelect={onSelect} onFocusSequence={onFocusSequence} />);
    await user.keyboard('{Control>}f{/Control}');
    await user.keyboard('{Enter}');
    const calls = onSelect.mock.calls.length;
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('search')).toBeNull();
    expect(onFocusSequence).toHaveBeenCalledTimes(1);
    expect(onSelect.mock.calls.length).toBe(calls);

    await user.keyboard('{Control>}f{/Control}');
    await user.click(screen.getByRole('button', { name: 'Done' }));
    expect(screen.queryByRole('search')).toBeNull();
    expect(onFocusSequence).toHaveBeenCalledTimes(2);
  });

  it('refocuses and selects the field when the shortcut is pressed again', async () => {
    const user = userEvent.setup();
    render(<Harness initialQuery={ECORI} onSelect={vi.fn()} />);
    await user.keyboard('{Control>}f{/Control}');
    await user.click(screen.getByRole('button', { name: 'Find' }));
    await user.keyboard('{Control>}f{/Control}');
    expect(document.activeElement).toBe(field());
    expect(field().selectionStart).toBe(0);
    expect(field().selectionEnd).toBe(ECORI.length);
  });

  it('seeds the field from a selected range of 200 bases or fewer', async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    const { unmount } = render(
      <Harness initialQuery="" selection={{ start: 25, end: 31 }} selectionText={BSAI_BOTTOM} onSelect={onSelect} />,
    );
    await user.keyboard('{Control>}f{/Control}');
    expect(field().value).toBe(BSAI_BOTTOM);
    await waitFor(() => expect(onSelect).toHaveBeenLastCalledWith({ start: 25, end: 31, strand: 1 }));
    unmount();

    render(<Harness initialQuery={ECORI} selection={{ start: 0, end: 201 }} selectionText={A.repeat(201)} onSelect={vi.fn()} />);
    await user.keyboard('{Control>}f{/Control}');
    expect(field().value).toBe(ECORI);
  });

  it('leaves Cmd/Ctrl+F to a floating workspace window', async () => {
    const user = userEvent.setup();
    render(<Harness onSelect={vi.fn()} />);
    await user.click(screen.getByRole('textbox', { name: 'Window field' }));
    const event = new KeyboardEvent('keydown', { key: 'f', ctrlKey: true, bubbles: true, cancelable: true });
    act(() => {
      screen.getByRole('textbox', { name: 'Window field' }).dispatchEvent(event);
    });
    expect(event.defaultPrevented).toBe(false);
    expect(screen.queryByRole('search')).toBeNull();
  });

  it('says when a character is not a base and disables stepping', async () => {
    const user = userEvent.setup();
    render(<Harness onSelect={vi.fn()} />);
    await user.keyboard('{Control>}f{/Control}');
    await user.type(field(), 'GA?');
    expect(count().textContent).toBe('Not a base: ?');
    expect((screen.getByRole('button', { name: 'Next match' }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole('button', { name: 'Previous match' }) as HTMLButtonElement).disabled).toBe(true);
  });
});
