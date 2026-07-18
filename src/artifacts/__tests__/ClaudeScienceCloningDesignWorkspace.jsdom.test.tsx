/** @vitest-environment jsdom */

import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { createRef } from 'react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  ClaudeScienceCloningDesignWorkspace,
  type ClaudeScienceCloningDesignRecord,
  type ClaudeScienceCloningDesignWorkspaceHandle,
  type ClaudeScienceCloningDesignWorkspaceProps,
} from '../ClaudeScienceCloningDesignWorkspace';

function bsaIPart(id: string, left: string, insert: string, right: string): ClaudeScienceCloningDesignRecord {
  return {
    id,
    name: id,
    molecule: 'dna',
    sequence: `GGTCTCN${left}${insert}${right}NGAGACC`,
    group: 'Modular parts',
  };
}

function bsmBIPart(id: string, left: string, insert: string, right: string): ClaudeScienceCloningDesignRecord {
  return {
    id,
    name: id,
    molecule: 'dna',
    sequence: `CGTCTCN${left}${insert}${right}NGAGACG`,
    group: 'GoldenBraid modules',
  };
}

const plainRecords: ClaudeScienceCloningDesignRecord[] = [
  { id: 'vector', name: 'Destination vector', molecule: 'dna', sequence: 'AAAACCCCGGGG', group: 'Vectors', tags: ['backbone'] },
  { id: 'insert', name: 'Reporter insert', molecule: 'dna', sequence: 'ATGAAATTTCCCGGG', group: 'Parts', tags: ['reporter'] },
  { id: 'extra', name: 'Tagged terminator', molecule: 'dna', sequence: 'TTTTGGGGCCCC', group: 'Parts', tags: ['terminator'] },
];

function props(overrides: Partial<ClaudeScienceCloningDesignWorkspaceProps> = {}): ClaudeScienceCloningDesignWorkspaceProps {
  return {
    records: plainRecords,
    onClose: vi.fn(),
    onDesignPrimers: vi.fn(),
    onSave: vi.fn(),
    ...overrides,
  };
}

function partNames(): string[] {
  return screen.getAllByTestId(/cloning-design-part-\d+/).map((row) => (
    (within(row).getByRole('combobox', { name: /^Part \d+$/ }) as HTMLSelectElement).selectedOptions[0]?.textContent ?? ''
  ));
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('ClaudeScienceCloningDesignWorkspace', () => {
  it('presents accessible Golden Gate and Gibson workspaces with compact progressive settings', async () => {
    const user = userEvent.setup();
    render(<ClaudeScienceCloningDesignWorkspace {...props()} />);

    expect(screen.getByRole('dialog', { name: 'Design Workspace' })).toBeTruthy();
    expect(screen.getByRole('tab', { name: /Golden Gate/ }).getAttribute('aria-selected')).toBe('true');
    expect(screen.getByLabelText('Assembly route')).toBeTruthy();
    expect(screen.getByLabelText('Golden Gate profile')).toBeTruthy();
    expect(screen.getByLabelText('Type IIS enzyme')).toBeTruthy();
    expect(screen.getByText('Preparation Checklist')).toBeTruthy();

    const goldenGateTab = screen.getByRole('tab', { name: /Golden Gate/ });
    goldenGateTab.focus();
    await user.keyboard('{ArrowRight}');

    expect(screen.getByRole('tab', { name: /Gibson/ }).getAttribute('aria-selected')).toBe('true');
    expect(document.activeElement).toBe(screen.getByRole('tab', { name: /Gibson/ }));
    expect(screen.queryByLabelText('Golden Gate profile')).toBeNull();
    expect(screen.getByLabelText('Minimum overlap')).toBeTruthy();
    expect(screen.getByLabelText('Maximum overlap')).toBeTruthy();
    expect((screen.getByRole('radio', { name: 'Linear' }) as HTMLInputElement).checked).toBe(true);
    expect(screen.getByTestId('gibson-junction-lanes')).toBeTruthy();

    await user.keyboard('{Home}');
    expect(screen.getByRole('tab', { name: /Golden Gate/ }).getAttribute('aria-selected')).toBe('true');
    expect(document.activeElement).toBe(goldenGateTab);
  });

  it('does not claim preparation is complete before a second Golden Gate input is present', () => {
    const records = [bsaIPart('single-part', 'GGAG', 'ATGAAATTT', 'GCTT')];
    render(<ClaudeScienceCloningDesignWorkspace {...props({ records, initialRecordIds: ['single-part'] })} />);

    expect(screen.getByTestId('cloning-design-product-empty').textContent).toContain('Add Another DNA Input');
    expect(screen.getByText('Preparation Checklist').parentElement?.textContent).toContain('Not evaluated');
    expect(screen.getByText('Add another DNA input').parentElement?.textContent).toContain('Preparation has not been evaluated');
    expect(screen.queryByText('Preparation Complete')).toBeNull();
  });

  it('searches, adds, removes, and reorders inventory records with mouse and keyboard controls', async () => {
    const user = userEvent.setup();
    render(<ClaudeScienceCloningDesignWorkspace {...props()} />);

    expect(partNames()).toEqual(['Destination vector', 'Reporter insert']);
    await user.type(screen.getByPlaceholderText('Name, group, or tag…'), 'terminator');
    expect((screen.getByLabelText('Record to add') as HTMLSelectElement).value).toBe('extra');
    await user.keyboard('{Enter}');
    expect(partNames()).toEqual(['Destination vector', 'Reporter insert', 'Tagged terminator']);

    const dragData = new Map<string, string>();
    const dataTransfer = {
      effectAllowed: 'none',
      dropEffect: 'none',
      setData: (type: string, value: string) => dragData.set(type, value),
      getData: (type: string) => dragData.get(type) ?? '',
    };
    fireEvent.dragStart(screen.getByRole('button', { name: 'Drag Tagged terminator to reorder' }), { dataTransfer });
    fireEvent.dragOver(screen.getByTestId('cloning-design-part-1'), { dataTransfer });
    fireEvent.drop(screen.getByTestId('cloning-design-part-1'), { dataTransfer });
    expect(partNames()).toEqual(['Tagged terminator', 'Destination vector', 'Reporter insert']);

    await user.click(screen.getByRole('button', { name: 'Move Tagged terminator down' }));
    expect(partNames()).toEqual(['Destination vector', 'Tagged terminator', 'Reporter insert']);

    const secondRow = screen.getByTestId('cloning-design-part-2');
    secondRow.focus();
    await user.keyboard('{Alt>}{ArrowUp}{/Alt}');
    expect(partNames()).toEqual(['Tagged terminator', 'Destination vector', 'Reporter insert']);

    await user.click(screen.getByRole('button', { name: 'Remove Destination vector' }));
    expect(partNames()).toEqual(['Tagged terminator', 'Reporter insert']);
    expect(screen.getByRole('status').textContent).toContain('removed');
  });

  it('applies and preserves per-part orientation through reorder and replacement', async () => {
    const user = userEvent.setup();
    const onSave = vi.fn().mockResolvedValue(undefined);
    render(<ClaudeScienceCloningDesignWorkspace {...props({ onSave })} />);

    const reverseInsert = screen.getByRole('button', { name: 'Use Reporter insert in reverse complement orientation' });
    expect(reverseInsert.getAttribute('aria-pressed')).toBe('false');
    await user.click(reverseInsert);
    expect(reverseInsert.getAttribute('aria-pressed')).toBe('true');

    await user.click(screen.getByRole('button', { name: 'Move Reporter insert up' }));
    await user.click(screen.getAllByText('Set primer fusion sites')[0]);
    await user.type(screen.getByLabelText('Left fusion site for Reporter insert'), 'GGAG');
    await user.type(screen.getByLabelText('Right fusion site for Reporter insert'), 'GCTT');
    await user.selectOptions(screen.getByLabelText('Part 1'), 'extra');
    expect(screen.getByRole('button', { name: 'Use Tagged terminator in reverse complement orientation' }).getAttribute('aria-pressed')).toBe('true');
    expect((screen.getByLabelText('Left fusion site for Tagged terminator') as HTMLInputElement).value).toBe('');
    expect((screen.getByLabelText('Right fusion site for Tagged terminator') as HTMLInputElement).value).toBe('');

    await user.click(screen.getByRole('button', { name: 'Save Plan' }));
    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
    expect(onSave.mock.calls[0][0]).toMatchObject({
      orderedRecordIds: ['extra', 'vector'],
      requestedRecordIds: ['extra', 'vector'],
      requestedOrientations: ['reverse', 'forward'],
      provenance: {
        inputRecordIds: ['extra', 'vector'],
        inputOrientations: ['reverse', 'forward'],
      },
    });
  });

  it('guides GoldenBraid TU assembly with an explicit destination and applies the biological source order', async () => {
    const user = userEvent.setup();
    const records = [
      bsaIPart('terminator', 'TGAG', 'TTTTTTTT', 'CGCT'),
      bsaIPart('promoter', 'GGAG', 'CCCCCCCC', 'GATG'),
      bsaIPart('cds', 'GATG', 'ATGAAATTT', 'TGAG'),
      bsaIPart('alpha-destination', 'CGCT', 'ACTGACTGACTG', 'GGAG'),
    ];
    render(<ClaudeScienceCloningDesignWorkspace {...props({ records, initialRecordIds: ['terminator', 'promoter', 'cds'] })} />);

    await user.selectOptions(screen.getByLabelText('Golden Gate profile'), 'moclo-ytk');
    expect(screen.queryByLabelText('Type IIS enzyme')).toBeNull();
    expect(screen.getByTestId('cloning-design-organization-help').textContent).toContain('Reaction: BsmBI');

    await user.selectOptions(screen.getByLabelText('Assembly route'), 'golden_braid_tu_alpha');

    expect(screen.queryByLabelText('Golden Gate profile')).toBeNull();
    expect(screen.queryByLabelText('Type IIS enzyme')).toBeNull();
    expect(screen.getByTestId('cloning-design-organization-help').textContent).toContain('level α destination with BsaI');
    expect(screen.getByTestId('cloning-design-plan-status').dataset.state).toBe('needs_preparation');
    expect((screen.getByRole('button', { name: 'Save Product' }) as HTMLButtonElement).disabled).toBe(true);
    await user.selectOptions(screen.getByLabelText('GoldenBraid destination vector'), 'alpha-destination');
    expect((screen.getByLabelText('GoldenBraid destination type') as HTMLSelectElement).value).toBe('1');
    expect(screen.getByText('GoldenBraid 3.0 Reference')).toBeTruthy();
    expect(screen.getByText(/Next level:/).closest('p')?.textContent).toContain('Level alpha TU with BsmBI');
    expect((screen.getByRole('button', { name: 'Apply Suggested Order' }) as HTMLButtonElement).disabled).toBe(false);
    expect(partNames()).toEqual(['terminator', 'promoter', 'cds']);

    await user.click(screen.getByRole('button', { name: 'Apply Suggested Order' }));
    expect(partNames()).toEqual(['promoter', 'cds', 'terminator']);
    expect((screen.getByRole('button', { name: 'Order Checked' }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByTestId('cloning-design-plan-status').dataset.state).toBe('ready');
  });

  it('models recursive GoldenBraid routes with complementary source types and a separate destination', async () => {
    const user = userEvent.setup();
    const records = [
      bsmBIPart('alpha-one', 'AAAA', 'CCCCCCCC', 'CCCC'),
      bsmBIPart('alpha-two', 'CCCC', 'GGGGGGGG', 'GGGG'),
      bsmBIPart('omega-destination', 'GGGG', 'TTTTTTTT', 'AAAA'),
    ];
    render(<ClaudeScienceCloningDesignWorkspace {...props({ records, initialRecordIds: ['alpha-one', 'alpha-two'] })} />);

    await user.selectOptions(screen.getByLabelText('Assembly route'), 'golden_braid_alpha_omega');
    expect(screen.getByRole('heading', { name: 'Source Modules' })).toBeTruthy();
    expect(screen.getByTestId('cloning-design-organization-help').textContent).toContain('Reaction: BsmBI · Esp3I compatible');
    expect(screen.getByTestId('cloning-design-plan-status').dataset.state).toBe('needs_preparation');
    await user.selectOptions(screen.getByLabelText('GoldenBraid source type for alpha-one'), '1');
    await user.selectOptions(screen.getByLabelText('GoldenBraid source type for alpha-two'), '2');
    await user.selectOptions(screen.getByLabelText('GoldenBraid destination vector'), 'omega-destination');
    await user.selectOptions(screen.getByLabelText('GoldenBraid destination type'), '1R');

    expect(partNames()).toEqual(['alpha-one', 'alpha-two']);
    expect(screen.getByTestId('cloning-design-plan-status').dataset.state).toBe('ready');
    expect(screen.getByTestId('cloning-design-product-preview').textContent).toContain('omega-destination');
    await user.click(screen.getByText('Advanced reaction settings'));
    await user.selectOptions(screen.getByLabelText('GoldenBraid reaction enzyme'), 'Esp3I');
    expect(screen.getByTestId('cloning-design-organization-help').textContent).toContain('Reaction: Esp3I');
  });

  it('hands required part preparation to primer design without inventing a product', async () => {
    const user = userEvent.setup();
    const onDesignPrimers = vi.fn().mockResolvedValue(undefined);
    render(<ClaudeScienceCloningDesignWorkspace {...props({ onDesignPrimers })} />);

    expect(screen.getByTestId('cloning-design-plan-status').dataset.state).toBe('needs_preparation');
    expect(screen.getByTestId('cloning-design-product-empty').textContent).toContain('no product sequence is invented');
    const blockedPrimerActions = screen.getAllByRole('button', { name: 'Set fusion sites first' });
    expect(blockedPrimerActions).toHaveLength(2);
    expect(blockedPrimerActions.every((button) => (button as HTMLButtonElement).disabled)).toBe(true);
    expect(screen.getAllByRole('note').some((note) => note.textContent?.includes('enter both boundaries'))).toBe(true);
    expect(screen.queryByRole('button', { name: 'Start 2-action primer worklist' })).toBeNull();

    await user.click(screen.getAllByText('Set primer fusion sites')[0]);
    await user.type(screen.getByLabelText('Left fusion site for Destination vector'), 'ggag');
    await user.type(screen.getByLabelText('Right fusion site for Destination vector'), 'gctt');
    expect(screen.getByText('Planned fusion GGAG → GCTT')).toBeTruthy();

    await user.click(screen.getByRole('button', { name: 'Open primer workspace' }));
    await waitFor(() => expect(onDesignPrimers).toHaveBeenCalledTimes(1));
    expect(onDesignPrimers.mock.calls[0][0]).toMatchObject({
      method: 'golden_gate',
      actionIds: ['flanks:vector'],
      recordIds: ['vector'],
      plan: {
        kind: 'golden_gate_design',
        product: null,
        parts: expect.arrayContaining([expect.objectContaining({
          recordId: 'vector',
          requestedLeftOverhang: 'GGAG',
          requestedRightOverhang: 'GCTT',
        })]),
      },
    });
    expect(screen.getByRole('status').textContent).toContain('Primer workspace opened');
  });

  it('replaces only the verified prepared part, preserves live draft choices, and replans against the amplicon', async () => {
    const user = userEvent.setup();
    const workspaceRef = createRef<ClaudeScienceCloningDesignWorkspaceHandle>();
    const onDesignPrimers = vi.fn().mockResolvedValue(undefined);
    const onSave = vi.fn().mockResolvedValue(undefined);
    const view = render(<ClaudeScienceCloningDesignWorkspace
      ref={workspaceRef}
      {...props({ onDesignPrimers, onSave })}
    />);

    await user.click(screen.getByRole('button', { name: 'Use Destination vector in reverse complement orientation' }));
    await user.click(screen.getAllByText('Set primer fusion sites')[0]);
    await user.type(screen.getByLabelText('Left fusion site for Destination vector'), 'GGAG');
    await user.type(screen.getByLabelText('Right fusion site for Destination vector'), 'GCTT');
    await user.click(screen.getByRole('button', { name: 'Open primer workspace' }));
    await waitFor(() => expect(onDesignPrimers).toHaveBeenCalledTimes(1));
    const request = onDesignPrimers.mock.calls[0][0];
    const actionId = request.actionIds[0] as string;
    const expectedRequestSha256 = request.plan.provenance.requestSha256 as string;
    const amplicon = bsaIPart('amplicon', 'GGAG', plainRecords[0].sequence, 'GCTT');
    amplicon.name = 'Destination vector · PCR amplicon';

    let replaced = false;
    act(() => {
      replaced = workspaceRef.current?.replacePreparedPart({
        expectedRequestSha256,
        actionId,
        sourceRecordId: 'vector',
        productRecordId: 'amplicon',
        productRecordName: amplicon.name,
      }) ?? false;
      view.rerender(<ClaudeScienceCloningDesignWorkspace
        ref={workspaceRef}
        {...props({ records: [...plainRecords, amplicon], onDesignPrimers, onSave })}
      />);
    });

    expect(replaced).toBe(true);
    expect(partNames()).toEqual(['Destination vector · PCR amplicon', 'Reporter insert']);
    expect(screen.getByRole('button', { name: 'Use Destination vector · PCR amplicon in reverse complement orientation' }).getAttribute('aria-pressed')).toBe('true');
    expect((screen.getByLabelText('Left fusion site for Destination vector · PCR amplicon') as HTMLInputElement).value).toBe('GGAG');
    expect((screen.getByLabelText('Right fusion site for Destination vector · PCR amplicon') as HTMLInputElement).value).toBe('GCTT');
    expect(screen.getByRole('status').textContent).toContain('rechecked');

    await user.click(screen.getByRole('button', { name: 'Save Plan' }));
    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
    expect(onSave.mock.calls[0][0]).toMatchObject({
      requestedRecordIds: ['amplicon', 'insert'],
      requestedOrientations: ['reverse', 'forward'],
      provenance: { inputRecordIds: ['amplicon', 'insert'] },
    });

    let staleReplacement = true;
    act(() => {
      staleReplacement = workspaceRef.current?.replacePreparedPart({
        expectedRequestSha256,
        actionId,
        sourceRecordId: 'vector',
        productRecordId: 'another-product',
        productRecordName: 'Another product',
      }) ?? false;
    });
    expect(staleReplacement).toBe(false);
    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('draft changed'));
    expect(partNames()[0]).toBe('Destination vector · PCR amplicon');
  });

  it('previews and saves a provenance-linked Gibson plan and product', async () => {
    const user = userEvent.setup();
    const onSave = vi.fn().mockResolvedValue(undefined);
    const overlap = 'GCGCGATATCGCGATATCGC';
    const records: ClaudeScienceCloningDesignRecord[] = [
      { id: 'left', name: 'Left arm', molecule: 'dna', sequence: `AAAACCCCGGGG${overlap}` },
      { id: 'right', name: 'Right arm', molecule: 'dna', sequence: `${overlap}TTTTAAAACCCC` },
    ];
    render(<ClaudeScienceCloningDesignWorkspace {...props({ records, onSave, initialMethod: 'gibson' })} />);

    expect(screen.getByTestId('cloning-design-plan-status').dataset.state).toBe('ready');
    expect(screen.getByTestId('cloning-design-product-preview').textContent).toContain('Left arm');
    expect(screen.getByTestId('cloning-design-product-preview').textContent).toContain('Right arm');
    expect(within(screen.getByTestId('gibson-junction-lanes')).getByText('20 bp · 64.0 °C')).toBeTruthy();

    await user.clear(screen.getByRole('textbox', { name: 'Design Name' }));
    await user.type(screen.getByRole('textbox', { name: 'Design Name' }), 'Reporter assembly');
    await user.click(screen.getByRole('button', { name: 'Save Plan' }));
    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
    expect(onSave.mock.calls[0][0]).toMatchObject({
      intent: 'plan',
      method: 'gibson',
      name: 'Reporter assembly',
      product: null,
      orderedRecordIds: ['left', 'right'],
      requestedRecordIds: ['left', 'right'],
      requestedOrientations: ['forward', 'forward'],
      plan: { kind: 'gibson_design', status: 'ready' },
    });
    expect(onSave.mock.calls[0][0].provenance.requestSha256).toMatch(/^[0-9a-f]{64}$/);

    await user.click(screen.getByRole('button', { name: 'Save Product' }));
    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(2));
    expect(onSave.mock.calls[1][0]).toMatchObject({
      intent: 'product',
      product: { topology: 'linear', orderedRecordIds: ['left', 'right'] },
      orderedRecordIds: ['left', 'right'],
      requestedRecordIds: ['left', 'right'],
      requestedOrientations: ['forward', 'forward'],
    });
    expect((screen.getByRole('button', { name: 'Plan Saved' }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole('button', { name: 'Product Saved' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('disables plan persistence when invalid inputs cannot produce provenance', () => {
    const records: ClaudeScienceCloningDesignRecord[] = [
      { id: 'invalid', name: 'Invalid source', molecule: 'dna', sequence: 'NOT-DNA' },
    ];
    render(<ClaudeScienceCloningDesignWorkspace {...props({ records, initialRecordIds: ['invalid'] })} />);

    expect((screen.getByRole('button', { name: 'Save Plan' }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByTestId('cloning-design-plan-status').dataset.state).toBe('blocked');
    expect(screen.getByTestId('cloning-design-product-empty').textContent).toContain('Add Another DNA Input');
    expect(screen.queryByText('Preparation Complete')).toBeNull();
  });

  it('closes with Escape and reports failed host saves honestly', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    const onSave = vi.fn().mockRejectedValue(new Error('Workspace is read-only.'));
    render(<ClaudeScienceCloningDesignWorkspace {...props({ onClose, onSave })} />);

    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Close cloning design workspace' }));
    await user.click(screen.getByRole('button', { name: 'Save Plan' }));
    expect((await screen.findByRole('alert')).textContent).toContain('Workspace is read-only.');
    expect(screen.getByRole('status').textContent).toBe('');

    await user.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
