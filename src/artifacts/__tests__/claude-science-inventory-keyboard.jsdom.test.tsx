// @vitest-environment jsdom

import { act, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it } from 'vitest';
import { InventoryList } from '../motif-artifact';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

type InventoryRecords = Parameters<typeof InventoryList>[0]['records'];

const record = (id: string, group: string) => ({
  id,
  name: id,
  sequence: 'ACGTACGT',
  topology: 'circular',
  type: 'dna',
  features: [],
  sites: [],
  active: false,
  group,
}) as unknown as InventoryRecords[number];

// Two groups, so the arrows cross a group boundary as they do in the bundled workspace.
const records: InventoryRecords = [
  record('pAlpha-1', 'Alpha'),
  record('pAlpha-2', 'Alpha'),
  record('pBeta-1', 'Beta'),
  record('pBeta-2', 'Beta'),
];

function Harness() {
  const [selected, setSelected] = useState(records[0].id);
  return <InventoryList records={records} selectedRecordId={selected} onSelect={setSelected} />;
}

let root: Root | null = null;

function renderInventory() {
  const container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => root!.render(<Harness />));
  const rows = () => Array.from(container.querySelectorAll<HTMLButtonElement>('.motif-cs-inventory-record-row'));
  const selectedName = () => container.querySelector('.motif-cs-inventory-record-row[aria-current="true"] span[title]')?.getAttribute('title');
  const focusedName = () => (document.activeElement as HTMLElement | null)?.querySelector('span[title]')?.getAttribute('title');
  const press = (key: string) => act(() => {
    document.activeElement!.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
  });
  return { container, rows, selectedName, focusedName, press };
}

describe('Inventory record rows', () => {
  afterEach(() => {
    act(() => root?.unmount());
    root = null;
    document.body.replaceChildren();
  });

  it('are one Tab stop, on the selected record', () => {
    // A row is not its own stop: that would be 13 stops for the bundled records.
    const { rows } = renderInventory();
    expect(rows().map((row) => row.tabIndex)).toEqual([0, -1, -1, -1]);
  });

  it('move the selection with the arrow keys, Home and End, and focus follows it', () => {
    const { rows, selectedName, focusedName, press } = renderInventory();
    act(() => rows()[0].focus());
    const visit = (key: string) => {
      press(key);
      expect(focusedName(), `focus after ${key}`).toBe(selectedName());
      expect(rows().filter((row) => row.tabIndex === 0).length).toBe(1);
      return selectedName();
    };
    expect(visit('ArrowDown')).toBe('pAlpha-2');
    expect(visit('ArrowDown')).toBe('pBeta-1');
    expect(visit('End')).toBe('pBeta-2');
    // Down wraps from the last row to the first, as the record tabs do.
    expect(visit('ArrowDown')).toBe('pAlpha-1');
    expect(visit('End')).toBe('pBeta-2');
    expect(visit('Home')).toBe('pAlpha-1');
    // The tab strip's own keys work here too, and Left wraps as the tabs do.
    expect(visit('ArrowRight')).toBe('pAlpha-2');
    expect(visit('ArrowLeft')).toBe('pAlpha-1');
    expect(visit('ArrowLeft')).toBe('pBeta-2');
  });

  it('are reached from the filter with Down or Enter, and Up from the first row or Escape goes back', () => {
    const { container, rows, selectedName, focusedName, press } = renderInventory();
    const filter = container.querySelector<HTMLInputElement>('input[name="inventory-filter"]')!;
    const type = (value: string) => act(() => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(filter, value);
      filter.dispatchEvent(new Event('input', { bubbles: true }));
    });

    // Down lands on the open record's row and does not change the selection.
    act(() => rows()[1].click());
    act(() => filter.focus());
    press('ArrowDown');
    expect(focusedName()).toBe('pAlpha-2');
    expect(selectedName()).toBe('pAlpha-2');
    press('Escape');
    expect(document.activeElement).toBe(filter);

    // With the open record filtered out, Enter lands on the first row left.
    type('beta');
    press('Enter');
    expect(focusedName()).toBe('pBeta-1');
    expect(selectedName()).toBeUndefined();
    // Up from the first row goes back to the filter rather than wrapping.
    press('ArrowUp');
    expect(document.activeElement).toBe(filter);

    // A filter that matches nothing leaves focus where it is.
    type('zzz');
    press('ArrowDown');
    expect(document.activeElement).toBe(filter);
  });

  it('claim Escape after entering from the filter, and leave it to the page on a clicked row', () => {
    const { container, rows, press } = renderInventory();
    const filter = container.querySelector<HTMLInputElement>('input[name="inventory-filter"]')!;
    let reached = false;
    const listener = (event: KeyboardEvent) => { reached = !event.defaultPrevented; };
    window.addEventListener('keydown', listener);
    act(() => filter.focus());
    press('ArrowDown');
    press('Escape');
    expect(reached).toBe(false);
    expect(document.activeElement).toBe(filter);
    // A row focused another way (a click, or Tab) leaves Escape to the page, which
    // closes the Translation window or clears the selection.
    act(() => rows()[0].focus());
    press('Escape');
    window.removeEventListener('keydown', listener);
    expect(reached).toBe(true);
    expect(document.activeElement).toBe(rows()[0]);
  });

  it('keep a Tab stop when a filter hides the selected record', () => {
    const { container, rows } = renderInventory();
    const filter = container.querySelector<HTMLInputElement>('input[name="inventory-filter"]')!;
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(filter, 'beta');
      filter.dispatchEvent(new Event('input', { bubbles: true }));
    });
    expect(rows().map((row) => row.querySelector('span[title]')?.getAttribute('title'))).toEqual(['pBeta-1', 'pBeta-2']);
    expect(rows().map((row) => row.tabIndex)).toEqual([0, -1]);
  });
});

describe('Inventory list scrolling', () => {
  afterEach(() => {
    act(() => root?.unmount());
    root = null;
    document.body.replaceChildren();
  });

  it('scrolls the list to a record selected from outside it, and no further', () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    const select = (recordId: string) => root!.render(<InventoryList records={records} selectedRecordId={recordId} onSelect={() => {}} />);
    act(() => select(records[0].id));
    const list = container.querySelector<HTMLElement>('.motif-cs-inventory-groups')!;
    // A 100px list whose rows are 30px apart, the fourth row at 150-180px.
    const box = (top: number, bottom: number) => ({ top, bottom, left: 0, right: 200, width: 200, height: bottom - top, x: 0, y: top, toJSON: () => ({}) }) as DOMRect;
    list.getBoundingClientRect = () => box(0, 100);
    const rows = Array.from(container.querySelectorAll<HTMLElement>('.motif-cs-inventory-record-row'));
    rows.forEach((row, index) => { row.getBoundingClientRect = () => box(60 * index - list.scrollTop, 60 * index + 30 - list.scrollTop); });
    expect(list.scrollTop).toBe(0);

    act(() => select('pBeta-2'));
    expect(list.scrollTop).toBe(110);

    // A row already in view does not move the list.
    act(() => select('pBeta-1'));
    expect(list.scrollTop).toBe(110);

    // A row above the view scrolls up to its top edge.
    act(() => select('pAlpha-1'));
    expect(list.scrollTop).toBe(0);
  });
});
