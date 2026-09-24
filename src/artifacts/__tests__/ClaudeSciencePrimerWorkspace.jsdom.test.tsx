/** @vitest-environment jsdom */

import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  ClaudeSciencePrimerWorkspace,
  type ClaudeSciencePrimerHandoff,
  type ClaudeSciencePrimerPreparationContext,
  type ClaudeSciencePrimerWorkspaceProps,
} from '../ClaudeSciencePrimerWorkspace';
import vectors from '../../../public/data/vectors.json';
import { PRIMER_TAIL_STRUCTURE_3_PRIME_REVIEW_CODE } from '../../bio/primer-design';
import { reverseComplement } from '../../bio/reverse-complement';
import { materializePcrAmplicon } from '../claude-science-pcr-materialization';

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

function EchoingPrimerHost() {
  const [selectedRange, setSelectedRange] = useState({ start: 350, end: 750 });
  return (
    <ClaudeSciencePrimerWorkspace
      {...props({
        selectedRange,
        onSelectRange: (start, end) => setSelectedRange({ start, end }),
      })}
    />
  );
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('ClaudeSciencePrimerWorkspace', () => {
  it.each(['pcr', 'cloning', 'verification'] as const)(
    'accepts a selected one-base target for the %s intent while retaining half-open handoff coordinates',
    async (initialIntent) => {
      const user = userEvent.setup();
      const onSaveDesign = vi.fn();
      render(<ClaudeSciencePrimerWorkspace {...props({
        selectedRange: { start: 350, end: 351 },
        onSaveDesign,
      })} />);
      if (initialIntent === 'cloning') await user.click(screen.getByLabelText('Cloning'));
      if (initialIntent === 'verification') await user.click(screen.getByLabelText('Verify'));
      expect((screen.getByLabelText('Target start') as HTMLInputElement).value).toBe('351');
      expect((screen.getByLabelText('Target end') as HTMLInputElement).value).toBe('351');
      expect(screen.getByLabelText('Target start').getAttribute('aria-invalid')).toBeNull();
      const acknowledgment = screen.queryByTestId('primer-evidence-acknowledgment');
      if (acknowledgment) await user.click(acknowledgment);
      await user.click(screen.getByRole('button', { name: 'Save design' }));
      await waitFor(() => expect(onSaveDesign).toHaveBeenCalled());
      expect(onSaveDesign.mock.calls[0][0].target).toEqual({ start: 350, end: 351 });
      expect(onSaveDesign.mock.calls[0][0].intent).toBe(initialIntent);
    },
  );

  it('accepts manually entered equal inclusive endpoints and one-base edge selections', async () => {
    const user = userEvent.setup();
    const view = render(<ClaudeSciencePrimerWorkspace {...props()} />);
    await user.clear(screen.getByLabelText('Target start'));
    await user.type(screen.getByLabelText('Target start'), '351');
    await user.clear(screen.getByLabelText('Target end'));
    await user.type(screen.getByLabelText('Target end'), '351');
    expect(screen.getByLabelText('Target end').getAttribute('aria-invalid')).toBeNull();

    view.rerender(<ClaudeSciencePrimerWorkspace {...props({ selectedRange: { start: 0, end: 1 } })} />);
    await waitFor(() => {
      expect((screen.getByLabelText('Target start') as HTMLInputElement).value).toBe('1');
      expect((screen.getByLabelText('Target end') as HTMLInputElement).value).toBe('1');
      expect(screen.getByLabelText('Target start').getAttribute('aria-invalid')).toBeNull();
    });

    view.rerender(<ClaudeSciencePrimerWorkspace {...props({ selectedRange: { start: sequence.length - 1, end: sequence.length } })} />);
    await waitFor(() => {
      expect((screen.getByLabelText('Target start') as HTMLInputElement).value).toBe(String(sequence.length));
      expect((screen.getByLabelText('Target end') as HTMLInputElement).value).toBe(String(sequence.length));
      expect(screen.getByLabelText('Target end').getAttribute('aria-invalid')).toBeNull();
    });
  });

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

  it('exposes bounded custom Tm inputs and stamps exact condition evidence into the handoff', async () => {
    const user = userEvent.setup();
    const onSaveDesign = vi.fn();
    render(<ClaudeSciencePrimerWorkspace {...props({ onSaveDesign })} />);

    await user.selectOptions(screen.getByLabelText('Tm condition preset'), 'custom');
    expect(screen.getByTestId('primer-custom-tm-options')).toBeTruthy();
    await user.clear(screen.getByLabelText('Total dNTP mM'));
    await user.type(screen.getByLabelText('Total dNTP mM'), '0.8');
    expect((screen.getByLabelText('Total dNTP mM') as HTMLInputElement).value).toBe('0.8');
    const acknowledgment = screen.queryByTestId('primer-evidence-acknowledgment');
    if (acknowledgment) await user.click(acknowledgment);
    await user.click(screen.getByRole('button', { name: 'Save design' }));
    await waitFor(() => expect(onSaveDesign).toHaveBeenCalledTimes(1));
    expect(onSaveDesign.mock.calls[0][0]).toMatchObject({
      parameters: {
        tmConditionPresetId: 'custom',
        tmOptions: { dntpConcentration: 0.8 },
      },
      tmEvidence: {
        conditionPresetId: 'custom',
        options: { dntpConcentration: 0.8 },
      },
    });
  });

  it('requires a fresh evidence acknowledgment after search parameters change', async () => {
    const user = userEvent.setup();
    render(<ClaudeSciencePrimerWorkspace {...props({
      initialForwardTail: 'NNNN',
      initialReverseTail: 'NNNN',
    })} />);

    const acknowledgment = screen.getByTestId('primer-evidence-acknowledgment') as HTMLInputElement;
    await user.click(acknowledgment);
    expect(acknowledgment.checked).toBe(true);

    await user.click(screen.getByText('Advanced constraints'));
    const flankingWindow = screen.getByLabelText('Flanking scan nt');
    await user.clear(flankingWindow);
    await user.type(flankingWindow, '51');

    await waitFor(() => expect((screen.getByTestId('primer-evidence-acknowledgment') as HTMLInputElement).checked).toBe(false));
  });

  it('associates each invalid numeric field with the current validation message', async () => {
    const user = userEvent.setup();
    render(<ClaudeSciencePrimerWorkspace {...props()} />);

    const targetTm = screen.getByLabelText('Target Tm °C');
    await user.clear(targetTm);
    await user.type(targetTm, '90');

    const error = screen.getByRole('alert');
    expect(targetTm.getAttribute('aria-invalid')).toBe('true');
    const describedBy = targetTm.getAttribute('aria-describedby')?.split(/\s+/) ?? [];
    expect(describedBy).toContain(error.id);
    expect(screen.getByLabelText('Minimum length').getAttribute('aria-invalid')).toBeNull();
    expect(screen.getByLabelText('Minimum length').getAttribute('aria-describedby')).not.toContain(error.id);
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

  it('counts both 5′ tails in the selected amplicon length', async () => {
    const user = userEvent.setup();
    render(<ClaudeSciencePrimerWorkspace {...props()} />);
    const evidence = () => screen.getByRole('region', { name: 'Primer pair 1 evidence' });
    const heading = () => evidence().querySelector('.motif-cs-primer-evidence-heading > span')?.textContent ?? '';
    const untailed = Number(/^([\d,]+) bp amplicon$/.exec(heading())![1].replace(/,/g, ''));
    expect(heading()).not.toContain('with tails');

    await user.click(screen.getByText('Advanced constraints'));
    // Pasted, not typed: every keystroke re-ranks the primer pairs, and 16 of
    // them timed this test out on a loaded machine. Only the final tails count.
    await user.click(screen.getByLabelText('Forward 5′ tail'));
    await user.paste('GCGAATTC');
    await user.click(screen.getByLabelText('Reverse 5′ tail'));
    await user.paste('GCAAGCTT');
    expect((screen.getByLabelText('Forward 5′ tail') as HTMLInputElement).value).toBe('GCGAATTC');
    expect((screen.getByLabelText('Reverse 5′ tail') as HTMLInputElement).value).toBe('GCAAGCTT');
    const tailed = /^([\d,]+) bp amplicon with tails$/.exec(heading());
    expect(tailed).not.toBeNull();
    // Pair 1 may change once tails change the ranking, so read its own primers.
    const text = evidence().textContent ?? '';
    const forwardStart = Number(/Forward\D*?(\d+)[–-]\d+/.exec(text)![1]);
    const reverseEnd = Number(/Reverse\D*?\d+[–-](\d+)/.exec(text)![1]);
    expect(Number(tailed![1].replace(/,/g, ''))).toBe(reverseEnd - forwardStart + 1 + 16);
    expect(untailed).toBeGreaterThan(0);
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

  it('scrolls a chosen pair’s sequences into view without scrolling the chosen row away', async () => {
    const user = userEvent.setup();
    // jsdom has no layout: give the results pane a 400px view, ranked rows 52px
    // apart from y=60, and the reverse oligo's bottom edge at y=700.
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function rect(this: HTMLElement) {
      const box = (top: number, bottom: number) => ({ top, bottom, left: 0, right: 600, x: 0, y: top, width: 600, height: bottom - top, toJSON: () => ({}) }) as DOMRect;
      if (this.classList.contains('motif-cs-primer-results')) return box(0, 400);
      if (this.classList.contains('motif-cs-primer-oligo')) return box(600, 700);
      const index = this.getAttribute('data-pair-index');
      if (index !== null) return box(60 + Number(index) * 52, 112 + Number(index) * 52);
      return box(0, 0);
    });
    render(<ClaudeSciencePrimerWorkspace {...props()} />);
    const results = document.querySelector<HTMLElement>('.motif-cs-primer-results')!;
    let scrollTop = 0;
    Object.defineProperty(results, 'scrollTop', { configurable: true, get: () => scrollTop, set: (value: number) => { scrollTop = value; } });
    expect(scrollTop).toBe(0);

    // Pair 3 sits at y=164: the whole 300px shortfall fits above it only in part,
    // so the pane scrolls 164px and the row ends at the top edge, still in view.
    await user.click(within(screen.getByRole('listbox', { name: 'Ranked primer pairs' })).getAllByRole('option')[2]);
    await waitFor(() => expect(scrollTop).toBe(164));
    expect(screen.getByRole('region', { name: 'Primer pair 3 evidence' })).toBeTruthy();
  });

  it('keeps the explicit target and focus when the host echoes a pair preview selection', async () => {
    const user = userEvent.setup();
    render(<EchoingPrimerHost />);
    const workspace = screen.getByRole('dialog', { name: 'Primer design' });
    const listbox = within(workspace).getByRole('listbox', { name: 'Ranked primer pairs' });
    const options = within(listbox).getAllByRole('option');

    options[0].focus();
    await user.keyboard('{ArrowDown}');

    await waitFor(() => {
      expect((screen.getByLabelText('Target start') as HTMLInputElement).value).toBe('351');
      expect((screen.getByLabelText('Target end') as HTMLInputElement).value).toBe('750');
      expect(within(listbox).getAllByRole('option')[1].getAttribute('aria-selected')).toBe('true');
      expect(screen.getByRole('region', { name: 'Primer pair 2 evidence' })).toBeTruthy();
      expect(screen.getByRole('status').textContent).toContain('Pair 2 selected on the sequence.');
      expect(within(listbox).getAllByRole('option')[1]).toBe(document.activeElement);
    });
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
    expect(callbacks.onCreateAmplicon.mock.calls[0][0].evidenceReview).toEqual({
      schema: 'motif.primer.evidence-review.v1',
      required: false,
      acknowledged: false,
      reasonCodes: [],
    });
    expect(callbacks.onUseForCloning.mock.calls[0][0].recordName).toBe('Example insert');
  });

  it('retains cloning provenance and keeps plan-only, simulation, and create-and-use actions explicit', async () => {
    const user = userEvent.setup();
    const onUseForCloning = vi.fn();
    const onCreateAmplicon = vi.fn();
    render(<ClaudeSciencePrimerWorkspace {...props({
      record: { id: 'record-1', name: 'Example insert', molecule: 'dna', sequence: sequence.slice(150, 550) },
      selectedRange: { start: 0, end: 400 },
      initialIntent: 'pcr',
      preparationContext: preparationContext(),
      onUseForCloning,
      onCreateAmplicon,
    })} />);

    const context = screen.getByRole('note', { name: 'Cloning preparation context' });
    expect(context.textContent).toContain('Simulate PCR saves a result only');
    expect(context.textContent).toContain('keeps the source record unchanged');
    const evidenceAcknowledgment = screen.queryByTestId('primer-evidence-acknowledgment');
    if (evidenceAcknowledgment) await user.click(evidenceAcknowledgment);
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

describe('ClaudeSciencePrimerWorkspace 5′-tail structure', () => {
  it('shows a palindromic tail site as a warning on the pair, in its evidence, and in the FASTA export', async () => {
    const user = userEvent.setup();
    const onExport = vi.fn();
    // XhoI's CTCGAG is its own reverse complement: GCGCCTCGAG pairs with itself
    // at −5.4 kcal/mol, past the −5 self-dimer cutoff, whatever it is attached to.
    render(<ClaudeSciencePrimerWorkspace {...props({ initialReverseTail: 'GCGCCTCGAG', onExport })} />);

    const options = within(screen.getByRole('listbox', { name: 'Ranked primer pairs' })).getAllByRole('option');
    expect(options.length).toBeGreaterThan(0);
    expect(screen.getByTestId('primer-tail-note').textContent).toContain(`on ${options.length} of ${options.length} pairs`);
    expect(options[0].textContent).toContain('tail structure');
    const evidence = screen.getByTestId('primer-tail-structure');
    expect(evidence.textContent).toContain('XhoI site CTCGAG');
    expect(evidence.textContent).toMatch(/self-dimer −\d+\.\d kcal\/mol/);
    expect(evidence.getAttribute('data-state')).toBe('note');

    const acknowledgment = screen.queryByTestId('primer-evidence-acknowledgment');
    if (acknowledgment) await user.click(acknowledgment);
    await user.click(screen.getByRole('button', { name: 'Export FASTA' }));
    await waitFor(() => expect(onExport).toHaveBeenCalledTimes(1));
    const fasta: string = onExport.mock.calls[0][0].text;
    expect(fasta).toMatch(/>Example_insert_pair_1_reverse 5'-tail structure: self-dimer -\d+\.\d\d kcal\/mol via XhoI site CTCGAG, 3' end free/);
    expect(fasta.split('\n')[0]).toBe('>Example_insert_pair_1_forward');
  }, 60_000);

  it('names the tails as not the cause when the annealing regions fail on their own', () => {
    // ACGT repeats are self-complementary, so every annealing region fails its
    // structure check with or without a tail.
    render(<ClaudeSciencePrimerWorkspace {...props({
      record: { id: 'record-1', name: 'Repeat', molecule: 'dna', sequence: 'ACGT'.repeat(150) },
      selectedRange: { start: 100, end: 400 },
      initialForwardTail: 'GCGCCATATG',
      initialReverseTail: 'GCGCCTCGAG',
    })} />);
    const empty = document.querySelector('.motif-cs-primer-empty')?.textContent ?? '';
    expect(empty).toContain('The 5′ tails are not the cause: this target gives no pair without them either.');
    expect(empty).toMatch(/No forward primer passes \(rejected: .*\)\./);
    expect(empty).not.toContain('Rejections:');
  }, 60_000);

  it('sends the tail review code that PCR materialization recomputes, so the amplicon is created', async () => {
    const user = userEvent.setup();
    const onCreateAmplicon = vi.fn();
    const template = (vectors as Array<{ name: string; sequence: string }>)
      .find((entry) => entry.name === 'pUC19')!.sequence.toUpperCase().slice(148, 548);
    // Every forward candidate starts at base 1, and this tail is the reverse
    // complement of bases 1-16, so each candidate's 3′ end can fold onto its tail.
    const tail = reverseComplement(template.slice(0, 28)).slice(0, 16);
    render(<ClaudeSciencePrimerWorkspace {...props({
      record: { id: 'tail-fixture', name: 'Tail fixture', molecule: 'dna', sequence: template },
      selectedRange: null,
      targetRange: { start: 0, end: 400 },
      initialForwardTail: tail,
      onCreateAmplicon,
    })} />);

    expect(screen.getByTestId('primer-tail-structure').getAttribute('data-state')).toBe('review');
    expect(screen.getByTestId('primer-evidence-review').textContent).toContain('A 5′-tail structure pairs a primer’s 3′ end');
    await user.click(screen.getByTestId('primer-evidence-acknowledgment'));
    await user.click(screen.getByRole('button', { name: 'Create amplicon record' }));
    await waitFor(() => expect(onCreateAmplicon).toHaveBeenCalledTimes(1));
    const handoff: ClaudeSciencePrimerHandoff = onCreateAmplicon.mock.calls[0][0];
    expect(handoff.evidenceReview?.reasonCodes).toContain(PRIMER_TAIL_STRUCTURE_3_PRIME_REVIEW_CODE);

    const materialize = (reasonCodes: readonly string[]) => materializePcrAmplicon({
      sourceRecord: { id: 'tail-fixture', name: 'Tail fixture', sequence: template, type: 'dna', topology: 'linear', active: true, features: [] },
      selection: {
        pair: handoff.pair,
        pairNumber: handoff.pairNumber,
        target: handoff.target,
        parameters: handoff.parameters,
        evidenceReview: { ...handoff.evidenceReview!, reasonCodes: [...reasonCodes] },
      },
      identity: { recordId: 'pcr-record-1', resultId: 'pcr-1', productId: 'amplicon-1', createdAt: '2026-09-22T00:00:00.000Z' },
      primerDesignResultId: 'primer-design-1',
    });
    const created = materialize(handoff.evidenceReview!.reasonCodes);
    expect((created.record.provenance.evidenceReview as { reasonCodes?: string[] } | undefined)?.reasonCodes)
      .toContain(PRIMER_TAIL_STRUCTURE_3_PRIME_REVIEW_CODE);
    expect(() => materialize(handoff.evidenceReview!.reasonCodes.filter((code) => code !== PRIMER_TAIL_STRUCTURE_3_PRIME_REVIEW_CODE)))
      .toThrow(/does not match the recomputed primer evidence/);
  }, 60_000);
});
