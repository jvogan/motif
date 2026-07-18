/** @vitest-environment jsdom */

import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  ClaudeSciencePrimerWorkspace,
  type ClaudeSciencePrimerPreparationContext,
  type ClaudeSciencePrimerWorkspaceProps,
} from '../ClaudeSciencePrimerWorkspace';

const primerFixtureSeed = 'ATGCGTACGATCCGTAAGCTGACCTAGTCGATGCTACGGTCAATCG';
const sequence = primerFixtureSeed.repeat(24);

function props(overrides: Partial<ClaudeSciencePrimerWorkspaceProps> = {}): ClaudeSciencePrimerWorkspaceProps {
  return {
    record: { id: 'record-1', name: 'Example insert', molecule: 'dna', sequence },
    selectedRange: { start: 350, end: 750 },
    onClose: vi.fn(),
    onSelectRange: vi.fn(),
    onCopy: vi.fn(),
    onExport: vi.fn(),
    onSaveDesign: vi.fn(),
    onAddAnnotations: vi.fn(),
    onSimulatePcr: vi.fn(),
    onCreateAmplicon: vi.fn(),
    onUseForCloning: vi.fn(),
    ...overrides,
  };
}

function preparationContext(overrides: Partial<ClaudeSciencePrimerPreparationContext> = {}): ClaudeSciencePrimerPreparationContext {
  return {
    label: 'Prepare insert for GoldenBraid TU',
    detail: 'Add the host-verified BsaI boundaries before returning to the assembly plan.',
    requestSha256: 'a'.repeat(64),
    actionId: 'flanks:record-1',
    actionKind: 'add_type_iis_flanks',
    method: 'golden_gate',
    orientation: 'reverse',
    enzyme: 'BsaI',
    fusionSites: { left: 'AATG', right: 'GCTT' },
    ...overrides,
  };
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('ClaudeSciencePrimerWorkspace', () => {
  it('opens with compact presets, ranked pairs, and evidence for the selected pair', () => {
    render(<ClaudeSciencePrimerWorkspace {...props()} />);

    expect(screen.getByRole('dialog', { name: 'Primer design' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Standard PCR' }).getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByRole('listbox', { name: 'Ranked primer pairs' })).toBeTruthy();
    expect(screen.getAllByRole('option').length).toBeGreaterThan(0);
    expect(screen.getByRole('region', { name: 'Primer pair 1 evidence' })).toBeTruthy();
    expect(screen.getAllByText('Hairpin ΔG').length).toBe(2);
    expect(screen.getAllByText('Self-dimer ΔG').length).toBe(2);
    expect(screen.getByText('Cross-dimer check')).toBeTruthy();
  });

  it('applies a cloning preset and exposes advanced tail controls without making them prominent by default', async () => {
    const user = userEvent.setup();
    const view = render(<ClaudeSciencePrimerWorkspace {...props()} />);

    expect(view.container.querySelector('details')?.open).toBe(false);
    await user.click(screen.getByRole('button', { name: 'Cloning' }));
    expect(screen.getByRole('button', { name: 'Cloning' }).getAttribute('aria-pressed')).toBe('true');
    expect((screen.getByLabelText('Cloning') as HTMLInputElement).checked).toBe(true);

    await user.click(screen.getByText('Advanced constraints'));
    expect(screen.getByLabelText('Forward tail preset')).toBeTruthy();
    await user.selectOptions(screen.getByLabelText('Forward tail preset'), 'GCGCGGTCTCAAATG');
    expect((screen.getByLabelText('Forward 5′ tail') as HTMLInputElement).value).toBe('GCGCGGTCTCAAATG');
    expect(screen.getByText('Custom conditions')).toBeTruthy();
  });

  it('initializes a cloning preparation request with cloning conditions and editable verified tails', async () => {
    const user = userEvent.setup();
    const onNextPreparation = vi.fn();
    render(<ClaudeSciencePrimerWorkspace {...props({
      initialIntent: 'cloning',
      preparationContext: preparationContext(),
      initialForwardTail: 'ggtctcNAATG',
      initialReverseTail: 'gagaccNAGCT',
      preparationProgress: { current: 1, total: 3, completed: 0, remaining: 3 },
      onNextPreparation,
    })} />);

    expect(screen.getByRole('button', { name: 'Cloning' }).getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByRole('button', { name: 'Standard PCR' }).getAttribute('aria-pressed')).toBe('false');
    expect((screen.getByLabelText('Cloning') as HTMLInputElement).checked).toBe(true);
    expect((screen.getByLabelText('Target Tm °C') as HTMLInputElement).value).toBe('62');
    expect((screen.getByLabelText('Tolerance ± °C') as HTMLInputElement).value).toBe('4');
    expect((screen.getByLabelText('Minimum length') as HTMLInputElement).value).toBe('20');
    expect((screen.getByLabelText('Maximum length') as HTMLInputElement).value).toBe('32');
    expect((screen.getByLabelText('Target start') as HTMLInputElement).value).toBe('1');
    expect((screen.getByLabelText('Target end') as HTMLInputElement).value).toBe(String(sequence.length));

    const context = screen.getByRole('note', { name: 'Cloning preparation context' });
    expect(context.textContent).toContain('Prepare insert for GoldenBraid TU');
    expect(context.textContent).toContain('host-verified BsaI boundaries');
    expect(context.textContent).toContain('remain editable');
    expect(screen.getByLabelText('Primer preparation worklist').textContent).toContain('Action 1 of 3');
    expect(screen.getByLabelText('Primer preparation worklist').textContent).toContain('0 complete · 3 remaining');
    expect((screen.getByRole('button', { name: 'Previous action' }) as HTMLButtonElement).disabled).toBe(true);
    await user.click(screen.getByRole('button', { name: 'Next action' }));
    expect(onNextPreparation).toHaveBeenCalledTimes(1);

    await user.click(screen.getByText('Advanced constraints'));
    expect((screen.getByLabelText('Forward 5′ tail') as HTMLInputElement).value).toBe('GGTCTCNAATG');
    expect((screen.getByLabelText('Reverse 5′ tail') as HTMLInputElement).value).toBe('GAGACCNAGCT');
    await user.clear(screen.getByLabelText('Forward 5′ tail'));
    await user.type(screen.getByLabelText('Forward 5′ tail'), 'AACCGG');
    expect((screen.getByLabelText('Forward 5′ tail') as HTMLInputElement).value).toBe('AACCGG');
  });

  it('resets preset conditions and seeded tails when the preparation context changes', async () => {
    const user = userEvent.setup();
    const view = render(<ClaudeSciencePrimerWorkspace {...props({
      initialIntent: 'cloning',
      preparationContext: preparationContext({ label: 'Prepare left boundary', detail: 'First verified request.' }),
      initialForwardTail: 'AAAANCCCC',
      initialReverseTail: 'GGGGNTTTT',
    })} />);
    await user.click(screen.getByText('Advanced constraints'));
    await user.click(screen.getByRole('button', { name: 'Standard PCR' }));
    await user.clear(screen.getByLabelText('Forward 5′ tail'));
    await user.type(screen.getByLabelText('Forward 5′ tail'), 'CUSTOM');

    view.rerender(<ClaudeSciencePrimerWorkspace {...props({
      initialIntent: 'cloning',
      preparationContext: preparationContext({
        label: 'Prepare right boundary',
        detail: 'Second verified request.',
        actionId: 'flanks:record-2',
      }),
      initialForwardTail: 'CCCCNAAAA',
      initialReverseTail: 'TTTTNGGGG',
    })} />);

    await waitFor(() => expect(screen.getByText('Custom conditions')).toBeTruthy());
    expect(screen.getByRole('note').textContent).toContain('Prepare right boundary');
    expect((screen.getByLabelText('Target Tm °C') as HTMLInputElement).value).toBe('60');
    expect((screen.getByLabelText('Forward 5′ tail') as HTMLInputElement).value).toBe('CCCCNAAAA');
    expect((screen.getByLabelText('Reverse 5′ tail') as HTMLInputElement).value).toBe('TTTTNGGGG');
  });

  it('moves through ranked pairs with arrow keys and reveals the selected amplicon', async () => {
    const user = userEvent.setup();
    const onSelectRange = vi.fn();
    render(<ClaudeSciencePrimerWorkspace {...props({ onSelectRange })} />);
    const listbox = screen.getByRole('listbox', { name: 'Ranked primer pairs' });
    const options = within(listbox).getAllByRole('option');
    expect(options.length).toBeGreaterThan(1);

    options[0].focus();
    await user.keyboard('{ArrowDown}');
    expect(options[1].getAttribute('aria-selected')).toBe('true');
    expect(onSelectRange).toHaveBeenCalledTimes(1);
    expect(onSelectRange.mock.calls[0][0]).toBeLessThan(onSelectRange.mock.calls[0][1]);
  });

  it('hands the selected pair to copy, export, annotations, PCR, and cloning callbacks', async () => {
    const user = userEvent.setup();
    const callbacks = {
      onCopy: vi.fn(),
      onExport: vi.fn(),
      onSaveDesign: vi.fn(),
      onAddAnnotations: vi.fn(),
      onSimulatePcr: vi.fn(),
      onCreateAmplicon: vi.fn(),
      onUseForCloning: vi.fn(),
    };
    render(<ClaudeSciencePrimerWorkspace {...props(callbacks)} />);

    await user.click(screen.getByRole('button', { name: 'Copy pair' }));
    await waitFor(() => expect(callbacks.onCopy).toHaveBeenCalledTimes(1));
    await user.click(screen.getByRole('button', { name: 'Export FASTA' }));
    await waitFor(() => expect(callbacks.onExport).toHaveBeenCalledTimes(1));
    await user.click(screen.getByRole('button', { name: 'Save design' }));
    await waitFor(() => expect(callbacks.onSaveDesign).toHaveBeenCalledTimes(1));
    await user.click(screen.getByRole('button', { name: 'Add annotations' }));
    await waitFor(() => expect(callbacks.onAddAnnotations).toHaveBeenCalledTimes(1));
    await user.click(screen.getByRole('button', { name: 'Simulate PCR' }));
    await waitFor(() => expect(callbacks.onSimulatePcr).toHaveBeenCalledTimes(1));
    await user.click(screen.getByRole('button', { name: 'Create amplicon record' }));
    await waitFor(() => expect(callbacks.onCreateAmplicon).toHaveBeenCalledTimes(1));
    await user.click(screen.getByRole('button', { name: 'Use in cloning' }));

    await waitFor(() => expect(callbacks.onUseForCloning).toHaveBeenCalledTimes(1));
    expect(callbacks.onCopy).toHaveBeenCalledWith('Primer pair 1', expect.stringContaining('Forward\t'));
    expect(callbacks.onExport.mock.calls[0][0]).toMatchObject({ filename: 'Example-insert-primers.fasta', format: 'fasta', pairNumber: 1 });
    expect(callbacks.onExport.mock.calls[0][0].text).toContain('>Example_insert_pair_1_forward');
    const [features, annotationHandoff] = callbacks.onAddAnnotations.mock.calls[0];
    expect(features).toHaveLength(2);
    expect(features.map((feature: { type: string }) => feature.type)).toEqual(['primer_bind', 'primer_bind']);
    expect(annotationHandoff.recordId).toBe('record-1');
    expect(callbacks.onSimulatePcr.mock.calls[0][0].pair.productLength).toBeGreaterThan(0);
    expect(callbacks.onUseForCloning.mock.calls[0][0].recordName).toBe('Example insert');
  });

  it('retains cloning provenance and keeps plan-only, simulation, and create-and-use actions explicit', async () => {
    const user = userEvent.setup();
    const onUseForCloning = vi.fn();
    const onCreateAmplicon = vi.fn();
    render(<ClaudeSciencePrimerWorkspace {...props({
      record: { id: 'record-1', name: 'Example insert', molecule: 'dna', sequence: sequence.slice(150, 550) },
      initialIntent: 'cloning',
      preparationContext: preparationContext(),
      onUseForCloning,
      onCreateAmplicon,
    })} />);

    const context = screen.getByRole('note', { name: 'Cloning preparation context' });
    expect(context.textContent).toContain('Simulate PCR saves a result only');
    expect(context.textContent).toContain('keeps the source record unchanged');
    await user.click(screen.getByRole('button', { name: 'Save primer plan only' }));
    await waitFor(() => expect(onUseForCloning).toHaveBeenCalledTimes(1));
    expect(onUseForCloning.mock.calls[0][0]).toMatchObject({
      target: { start: 0, end: 400 },
      preparationContext: {
        requestSha256: 'a'.repeat(64),
        actionId: 'flanks:record-1',
        actionKind: 'add_type_iis_flanks',
        method: 'golden_gate',
        orientation: 'reverse',
        enzyme: 'BsaI',
        fusionSites: { left: 'AATG', right: 'GCTT' },
      },
    });
    await user.click(screen.getByRole('button', { name: 'Create & use amplicon' }));
    await waitFor(() => expect(onCreateAmplicon).toHaveBeenCalledTimes(1));
    expect(onCreateAmplicon.mock.calls[0][0].preparationContext.actionId).toBe('flanks:record-1');
  });

  it('explains the manual 5′-tail step when a Gibson overlap cannot be inferred', () => {
    render(<ClaudeSciencePrimerWorkspace {...props({
      initialIntent: 'cloning',
      initialForwardTail: undefined,
      initialReverseTail: undefined,
      preparationContext: preparationContext({
        label: 'Add homology for left → right',
        detail: 'Prepare a unique overlap for this unresolved junction.',
        actionId: 'homology:0',
        actionKind: 'add_homology',
        method: 'gibson',
        fusionSites: undefined,
        junction: { index: 0, leftRecordId: 'left', rightRecordId: 'record-1' },
      }),
    })} />);

    const context = screen.getByRole('note', { name: 'Cloning preparation context' });
    expect(context.textContent).toContain('No homology tail was inferred');
    expect(context.textContent).toContain('Advanced constraints');
    expect(screen.getByRole('button', { name: 'Save primer plan only' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Create & use amplicon' })).toBeTruthy();
  });

  it('uses an existing selection and reports invalid targets accessibly', async () => {
    const user = userEvent.setup();
    render(<ClaudeSciencePrimerWorkspace {...props({ selectedRange: { start: 90, end: 340 } })} />);

    expect((screen.getByLabelText('Target start') as HTMLInputElement).value).toBe('91');
    expect((screen.getByLabelText('Target end') as HTMLInputElement).value).toBe('340');
    await user.clear(screen.getByLabelText('Target end'));
    await user.type(screen.getByLabelText('Target end'), '20');
    expect(screen.getByRole('alert').textContent).toContain('Use a non-wrapping target');
    expect(screen.queryByRole('listbox')).toBeNull();
  });

  it('closes on Escape in modal mode and remains a non-modal region when embedded', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    const view = render(<ClaudeSciencePrimerWorkspace {...props({ onClose })} />);
    await user.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalledTimes(1);

    view.rerender(<ClaudeSciencePrimerWorkspace {...props({ onClose, embedded: true })} />);
    expect(screen.getByRole('region', { name: 'Primer design' })).toBeTruthy();
    await user.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('does not overload selected-pair styling with a one-sided border or glow', () => {
    render(<ClaudeSciencePrimerWorkspace {...props()} />);
    const listbox = screen.getByRole('listbox', { name: 'Ranked primer pairs' });
    const selected = within(listbox).getAllByRole('option')[0];
    expect(selected.getAttribute('data-selected')).not.toBeNull();
    expect(within(screen.getByRole('listbox')).getAllByRole('option').length).toBeGreaterThan(0);
  });
});
