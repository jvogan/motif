/** @vitest-environment jsdom */

import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  ClaudeScienceAssemblyWorkspace,
  type ClaudeScienceAssemblyRecord,
  type ClaudeScienceAssemblyWorkspaceProps,
} from '../ClaudeScienceAssemblyWorkspace';

function bsaIRecord(
  id: string,
  leftOverhang: string,
  insert: string,
  rightOverhang: string,
): ClaudeScienceAssemblyRecord {
  return {
    id,
    name: id,
    molecule: 'dna',
    sequence: `GGTCTCN${leftOverhang}${insert}${rightOverhang}NGAGACC`,
  };
}

const plainRecords: ClaudeScienceAssemblyRecord[] = [
  {
    id: 'left',
    name: 'Left fragment',
    molecule: 'dna',
    sequence: 'AAAACCCC',
    overhang5: '',
    overhang3: 'CAGT',
    overhang3Type: '5prime',
  },
  {
    id: 'right',
    name: 'Right fragment',
    molecule: 'dna',
    sequence: 'GGGGTTTT',
    overhang5: 'ACTG',
    overhang5Type: '5prime',
    overhang3: '',
  },
  {
    id: 'blunt',
    name: 'Blunt fragment',
    molecule: 'dna',
    sequence: 'ATGCATGC',
    overhang5: '',
    overhang3: '',
  },
  {
    id: 'unknown',
    name: 'Unknown ends',
    molecule: 'dna',
    sequence: 'GCGCGCGC',
  },
];

function idFactory(...ids: string[]): () => string {
  let index = 0;
  return () => ids[index++] ?? `generated-${index}`;
}

function props(overrides: Partial<ClaudeScienceAssemblyWorkspaceProps> = {}): ClaudeScienceAssemblyWorkspaceProps {
  return {
    records: plainRecords,
    onClose: vi.fn(),
    onSave: vi.fn(),
    createId: idFactory('row-1', 'row-2', 'save-1'),
    now: () => '2026-07-12T20:00:00.000Z',
    ...overrides,
  };
}

function partNames(): string[] {
  return screen.getAllByTestId(/assembly-part-row-/).map((row) => (
    (within(row).getByRole('combobox') as HTMLSelectElement).selectedOptions[0]?.textContent ?? ''
  ));
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('ClaudeScienceAssemblyWorkspace', () => {
  it('presents quiet method tabs and distinguishes unknown, blunt, and sticky ends', async () => {
    const user = userEvent.setup();
    render(<ClaudeScienceAssemblyWorkspace {...props()} />);

    expect(screen.getByRole('dialog', { name: 'Assembly workspace' })).toBeTruthy();
    expect(screen.getByRole('tab', { name: 'Golden Gate' }).getAttribute('aria-selected')).toBe('true');
    expect(screen.getByLabelText('Type IIS enzyme')).toBeTruthy();
    expect(partNames()).toEqual(['Left fragment', 'Right fragment']);

    await user.click(screen.getByRole('tab', { name: 'Traditional ligation' }));

    expect(screen.queryByLabelText('Type IIS enzyme')).toBeNull();
    expect(screen.getAllByText('5′ CAGT').length).toBeGreaterThan(0);
    expect(screen.getAllByText('5′ ACTG').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Blunt').length).toBeGreaterThan(0);
    expect(screen.getByTestId('assembly-plan-status').dataset.state).toBe('ready');
    expect(screen.getByTestId('assembly-plan-status').textContent).toContain('Ends support this order');
    expect(screen.getByTestId('assembly-save-product').textContent).toContain('Save ligation product');
    expect(within(screen.getByTestId('assembly-junction-table')).getByText('Compatible')).toBeTruthy();

    await user.selectOptions(screen.getByLabelText('Part 2'), 'unknown');
    expect(screen.getAllByText('Unknown').length).toBeGreaterThan(0);
    expect(screen.getByTestId('assembly-plan-status').dataset.state).toBe('blocked');
    expect(within(screen.getByTestId('assembly-junction-table')).getAllByText('Unknown').length).toBeGreaterThan(0);
    expect(screen.getAllByText(/Digest or linearize it first/)).toHaveLength(2);
  });

  it('adds, removes, and reorders parts with both pointer and keyboard controls', async () => {
    const user = userEvent.setup();
    render(<ClaudeScienceAssemblyWorkspace {...props({
      createId: idFactory('row-1', 'row-2', 'row-3'),
    })} />);

    await user.selectOptions(screen.getByLabelText('Record to add'), 'blunt');
    await user.click(screen.getByTestId('assembly-add-part'));
    expect(partNames()).toEqual(['Left fragment', 'Right fragment', 'Blunt fragment']);

    await user.click(screen.getByRole('button', { name: 'Move Blunt fragment up' }));
    expect(partNames()).toEqual(['Left fragment', 'Blunt fragment', 'Right fragment']);
    expect(screen.getByRole('status').textContent).toContain('position 2');

    const secondPart = screen.getByLabelText('Part 2');
    secondPart.focus();
    await user.keyboard('{Alt>}{ArrowUp}{/Alt}');
    expect(partNames()).toEqual(['Blunt fragment', 'Left fragment', 'Right fragment']);

    await user.click(screen.getByRole('button', { name: 'Remove Left fragment' }));
    expect(partNames()).toEqual(['Blunt fragment', 'Right fragment']);
    expect(screen.getByRole('status').textContent).toContain('removed');
  });

  it('atomically hands a ready Golden Gate product and workflow result to the host', async () => {
    const user = userEvent.setup();
    const onSave = vi.fn().mockResolvedValue(undefined);
    const records = [
      bsaIRecord('Promoter', 'AAAA', 'CCCC', 'GATG'),
      bsaIRecord('Backbone', 'GATG', 'GGGG', 'AAAA'),
    ];
    render(<ClaudeScienceAssemblyWorkspace {...props({
      records,
      onSave,
      createId: idFactory('row-1', 'row-2', 'save-ready'),
    })} />);

    expect(screen.getByTestId('assembly-plan-status').dataset.state).toBe('ready');
    const saveProduct = screen.getByTestId('assembly-save-product') as HTMLButtonElement;
    expect(saveProduct.disabled).toBe(false);
    await user.clear(screen.getByLabelText('Product name'));
    await user.type(screen.getByLabelText('Product name'), 'Reporter plasmid');
    await user.click(saveProduct);

    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
    const payload = onSave.mock.calls[0][0];
    expect(payload).toMatchObject({
      intent: 'product',
      plan: { kind: 'golden_gate', status: 'ready', topology: 'circular' },
      workflowResult: {
        id: 'assembly-save-ready',
        kind: 'golden_gate',
        outputRecordIds: ['assembly-product-save-ready'],
      },
      derivedRecord: {
        id: 'assembly-product-save-ready',
        name: 'Reporter plasmid',
        topology: 'circular',
        group: 'Assembly products',
      },
    });
    expect(screen.getByRole('status').textContent).toContain('saved with its workflow result');
    expect(saveProduct.disabled).toBe(true);
    expect(saveProduct.textContent).toBe('Saved');

    await user.click(saveProduct);
    expect(onSave).toHaveBeenCalledTimes(1);

    await user.type(screen.getByLabelText('Product name'), ' v2');
    expect(saveProduct.disabled).toBe(false);
    expect(saveProduct.textContent).toBe('Save product');
  });

  it('saves an honest blocked result without inventing a product', async () => {
    const user = userEvent.setup();
    const onSave = vi.fn();
    render(<ClaudeScienceAssemblyWorkspace {...props({
      onSave,
      createId: idFactory('row-1', 'row-2', 'blocked-save'),
    })} />);

    expect(screen.getByTestId('assembly-plan-status').dataset.state).toBe('blocked');
    expect((screen.getByTestId('assembly-save-product') as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByRole('button', { name: 'Save blocked result' })).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Save blocked result' }));

    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
    expect(onSave.mock.calls[0][0]).toMatchObject({
      intent: 'result',
      plan: { status: 'blocked' },
      workflowResult: {
        id: 'assembly-blocked-save',
        outputRecordIds: [],
        result: { status: 'blocked', productLength: null },
      },
    });
    expect(onSave.mock.calls[0][0].derivedRecord).toBeUndefined();
    expect((screen.getByRole('button', { name: 'Result saved' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('surfaces internal Type IIS sites as a named domestication requirement', () => {
    const records = [
      bsaIRecord('Internal insert', 'AAAA', 'CCGGTCTCAA', 'GATG'),
      bsaIRecord('Backbone', 'GATG', 'GGGG', 'AAAA'),
    ];
    render(<ClaudeScienceAssemblyWorkspace {...props({ records })} />);

    expect(screen.getByText('Domestication required')).toBeTruthy();
    expect(screen.getAllByText(/Internal insert contain/).length).toBeGreaterThan(0);
    expect(screen.getByText(/cannot be assembled honestly/)).toBeTruthy();
  });

  it('bounds the ordered-part UI at the same 100-part limit as the planner', () => {
    const records = Array.from({ length: 101 }, (_, index): ClaudeScienceAssemblyRecord => ({
      id: `part-${index + 1}`,
      name: `Part ${index + 1}`,
      molecule: 'dna',
      sequence: 'ATGC',
      overhang5: '',
      overhang3: '',
    }));
    render(<ClaudeScienceAssemblyWorkspace {...props({
      records,
      initialRecordIds: records.map((record) => record.id),
      createId: idFactory(),
    })} />);

    expect(screen.getAllByTestId(/assembly-part-row-/)).toHaveLength(100);
    expect((screen.getByTestId('assembly-add-part') as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByTestId('assembly-add-part').textContent).toBe('100-part limit');
  });

  it('closes with Escape and reports host save failures without claiming success', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    const onSave = vi.fn(() => Promise.reject(new Error('Workspace is read-only.')));
    render(<ClaudeScienceAssemblyWorkspace {...props({ onClose, onSave })} />);

    const close = screen.getByRole('button', { name: 'Close assembly workspace' });
    expect(document.activeElement).toBe(close);
    await user.keyboard('{Shift>}{Tab}{/Shift}');
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Save blocked result' }));

    await user.click(screen.getByRole('button', { name: 'Save blocked result' }));
    expect((await screen.findByRole('alert')).textContent).toContain('Workspace is read-only.');
    expect(screen.getByRole('status').textContent).toBe('');

    await user.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
