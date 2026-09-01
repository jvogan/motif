/** @vitest-environment jsdom */

import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  ClaudeScienceCloningDesignWorkspace,
  type ClaudeScienceCloningDesignRecord,
  type ClaudeScienceCloningDesignWorkspaceProps,
} from '../ClaudeScienceCloningDesignWorkspace';

function part(id: string, left: string, insert: string, right: string): ClaudeScienceCloningDesignRecord {
  return {
    id,
    name: id,
    molecule: 'dna',
    sequence: `GGTCTCN${left}${insert}${right}NGAGACC`,
    group: 'Modular parts',
  };
}

const records: ClaudeScienceCloningDesignRecord[] = [
  part('promoter', 'GGAG', 'ATGAAATTT', 'AATG'),
  part('cds', 'AATG', 'CCCGGGTTT', 'GCTT'),
];

function props(overrides: Partial<ClaudeScienceCloningDesignWorkspaceProps> = {}): ClaudeScienceCloningDesignWorkspaceProps {
  return {
    records,
    onClose: vi.fn(),
    onDesignPrimers: vi.fn(),
    onSave: vi.fn(),
    ...overrides,
  };
}

/** Every visible word inside the workspace, with the accessible-only text dropped. */
function visibleWords(): string[] {
  const root = screen.getByTestId('cloning-design-workspace');
  const skip = new Set(['OPTION', 'SCRIPT', 'STYLE']);
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const words: string[] = [];
  let node = walker.nextNode();
  while (node) {
    const owner = node.parentElement;
    const hidden = owner?.closest('.motif-cs-visually-hidden') ?? null;
    if (owner && !skip.has(owner.tagName) && hidden === null) {
      for (const word of (node.nodeValue ?? '').split(/\s+/)) {
        if (/[A-Za-z0-9]/.test(word)) words.push(word);
      }
    }
    node = walker.nextNode();
  }
  return words;
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('cloning design blocked-input copy', () => {
  it('states the two-part requirement at the add control and describes the Add Part button with it', () => {
    render(<ClaudeScienceCloningDesignWorkspace {...props({ initialRecordIds: ['promoter'] })} />);

    const hint = screen.getByTestId('cloning-design-add-hint');
    expect(hint.textContent).toBe('Add a second part to check fusion boundaries and assembly order.');
    const addButton = screen.getByTestId('cloning-design-add-part');
    expect(addButton.getAttribute('aria-describedby')).toBe(hint.id);
    expect(addButton.hasAttribute('disabled')).toBe(false);
  });

  it('states the requirement on three surfaces, one per job: act, track, route', () => {
    render(<ClaudeScienceCloningDesignWorkspace {...props({ initialRecordIds: ['promoter'] })} />);

    expect(screen.getAllByText(/Add a second part/).map((node) => node.tagName))
      .toEqual(['P', 'SPAN', 'STRONG']);
    expect(screen.getByTestId('cloning-design-add-hint').tagName).toBe('P');
    expect(screen.getByText('Add a second part', { selector: 'strong' })
      .closest('.motif-cs-cloning-design-check')).toBeTruthy();
    expect(screen.getByTestId('cloning-design-product-empty').textContent)
      .toBe('Two Parts NeededAdd a second part in step 02.');
    expect(screen.queryByText('Cloning design requires at least two ordered DNA inputs.')).toBeNull();
    expect(screen.queryByText(/Issues & Warnings/)).toBeNull();
  });

  it('keeps one word for the unchecked state in both review slots', () => {
    render(<ClaudeScienceCloningDesignWorkspace {...props({ initialRecordIds: ['promoter'] })} />);

    const required = screen.getByText('Required', { selector: 'dt' });
    expect(required.parentElement?.textContent).toBe('RequiredNot checked');
    expect(screen.getByText('Preparation Checklist').parentElement?.textContent).toContain('Not checked');
    expect(screen.queryByText('Not evaluated')).toBeNull();
  });

  it('drops the order-checked claim while no order can be checked', () => {
    render(<ClaudeScienceCloningDesignWorkspace {...props({ initialRecordIds: ['promoter'] })} />);
    expect(screen.queryByRole('button', { name: 'Order Checked' })).toBeNull();
  });

  it('names the real shortfall when two rows are present but one is unreadable', () => {
    const mixed: ClaudeScienceCloningDesignRecord[] = [
      records[0],
      { id: 'broken', name: 'broken', molecule: 'dna', sequence: 'NOT-DNA' },
    ];
    render(<ClaudeScienceCloningDesignWorkspace {...props({
      records: mixed,
      initialRecordIds: ['promoter', 'broken'],
    })} />);

    expect(screen.getByTestId('cloning-design-product-empty').textContent)
      .toBe('Two Usable Parts Needed1 of 2 parts cannot be read as DNA. See Issues & Warnings.');
    expect(screen.getByText('Fix an unusable part').parentElement?.textContent)
      .toContain('Checks start at 2 usable parts.');
    expect(screen.queryByTestId('cloning-design-add-hint')).toBeNull();
    expect(screen.getByText(/^Issues & Warnings/)).toBeTruthy();
  });

  it('leaves every string untouched once two usable parts are ordered', async () => {
    const user = userEvent.setup();
    render(<ClaudeScienceCloningDesignWorkspace {...props({ initialRecordIds: ['promoter'] })} />);
    await user.click(screen.getByTestId('cloning-design-add-part'));

    expect(screen.queryByTestId('cloning-design-add-hint')).toBeNull();
    expect(screen.queryByText(/Add a second part/)).toBeNull();
    expect(screen.queryByText('Two Parts Needed')).toBeNull();
    expect(screen.getByRole('button', { name: 'Order Checked' })).toBeTruthy();
    const required = screen.getByText('Required', { selector: 'dt' });
    expect(required.parentElement?.textContent).toMatch(/^Required\d+$/);
    expect(screen.getByText('Preparation Checklist').parentElement?.textContent)
      .toMatch(/^Preparation Checklist\d+$/);
  });

  it('states the unfixable-inputs case once per region instead of twice in one sentence', async () => {
    const user = userEvent.setup();
    render(<ClaudeScienceCloningDesignWorkspace {...props({ initialRecordIds: ['promoter'] })} />);
    await user.click(screen.getByRole('tab', { name: /Gibson/ }));

    expect(screen.getByTestId('cloning-design-product-empty').textContent)
      .toBe('Review Blocking IssuesNo preparation step can fix these inputs.');
    expect(screen.getByText('Review blocking issues').parentElement?.textContent)
      .toBe('Review blocking issuesSee Issues & Warnings.');
    expect(screen.getByText('Cloning design requires at least two ordered DNA inputs.')).toBeTruthy();
  });

  it('shows none of the four deleted statements of the same requirement', () => {
    render(<ClaudeScienceCloningDesignWorkspace {...props({ initialRecordIds: ['promoter'] })} />);

    const words = visibleWords().join(' ');
    for (const deleted of [
      'Add Another DNA Input',
      'Golden Gate preparation is not evaluated until at least 2 DNA inputs are present.',
      'Preparation has not been evaluated. Add at least 2 DNA inputs to check fusion boundaries and assembly order.',
      'Cloning design requires at least two ordered DNA inputs.',
      'Not evaluated',
      'Order Checked',
    ]) {
      expect(words).not.toContain(deleted);
    }
  });
});
