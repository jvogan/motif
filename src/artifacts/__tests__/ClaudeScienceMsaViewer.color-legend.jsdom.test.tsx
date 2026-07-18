/** @vitest-environment jsdom */

import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { SequenceType } from '../../bio/types';
import {
  ClaudeScienceMsaViewer,
  type ClaudeScienceMsaViewerProps,
} from '../ClaudeScienceMsaViewer';
import { normalizeArtifactAlignment, type MsaColorScheme } from '../claude-science-msa';
import {
  DEFAULT_CLAUDE_SCIENCE_MSA_VIEW_PREFERENCES,
  type ClaudeScienceMsaColorMode,
} from '../claude-science-msa-view-preferences';

function alignmentFor(molecule: SequenceType) {
  const sequences = molecule === 'protein'
    ? ['ACDEFGHIKLMNPQRSTVWY', 'ACDEYGHIKLMNPQRSTVWF']
    : molecule === 'rna'
      ? ['ACGUN', 'ACGUU']
      : ['ACGTN', 'ACGTT'];
  return normalizeArtifactAlignment({
    id: `${molecule}-alignment`,
    name: `${molecule} alignment`,
    molecule,
    rows: sequences.map((aligned, index) => ({
      id: `row-${index + 1}`,
      name: `Sequence ${index + 1}`,
      aligned,
    })),
  });
}

function renderViewer(
  molecule: SequenceType,
  colorScheme: MsaColorScheme,
  colorMode: ClaudeScienceMsaColorMode = 'residue',
) {
  const alignment = alignmentFor(molecule);
  const props: ClaudeScienceMsaViewerProps = {
    records: [],
    alignments: [alignment],
    activeAlignmentId: alignment.id,
    viewPreferences: {
      ...DEFAULT_CLAUDE_SCIENCE_MSA_VIEW_PREFERENCES,
      colorMode,
      colorScheme,
      shadeMode: 'none',
    },
    onActiveAlignmentChange: vi.fn(),
    onViewPreferencesChange: vi.fn(),
    onSaveAlignment: (nextAlignment) => nextAlignment,
    onUpdateAlignmentTemplate: () => null,
    onDeleteAlignment: vi.fn(),
    onImportRecords: async () => ({ records: [], message: '', tone: 'status' }),
    onCopy: async () => true,
    onDownload: vi.fn(),
  };
  return render(<ClaudeScienceMsaViewer {...props} />);
}

function legendEntries(legend: HTMLElement): Array<[string | null, string | null]> {
  return Array.from(legend.querySelectorAll<HTMLElement>('.motif-cs-msa-color-legend-item'))
    .map((item) => [
      item.querySelector<HTMLElement>('.motif-cs-msa-color-legend-swatch')?.getAttribute('data-color-key')
        ?? item.querySelector<HTMLElement>('.motif-cs-msa-color-legend-swatch')?.getAttribute('data-tone')
        ?? null,
      item.lastElementChild?.textContent ?? null,
    ]);
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('ClaudeScienceMsaViewer residue colour key', () => {
  it('renders nucleotide swatches, RNA U, and ambiguity for a nucleotide alignment', () => {
    renderViewer('rna', 'nucleotide');

    const legend = screen.getByTestId('msa-color-legend');
    expect(legend.getAttribute('role')).toBe('group');
    expect(legend.getAttribute('aria-label')).toBe('Nucleotide residue colour key');
    expect(legendEntries(legend)).toEqual([
      ['nt-a', 'A'],
      ['nt-c', 'C'],
      ['nt-g', 'G'],
      ['nt-t', 'T'],
      ['nt-t', 'U'],
      ['nt-other', 'Other / ambiguous'],
    ]);
  });

  it('uses the automatic molecule tone mapping for automatic schemes', () => {
    renderViewer('dna', 'auto');

    const legend = screen.getByTestId('msa-color-legend');
    expect(legend.getAttribute('aria-label')).toBe('Automatic nucleotide residue colour key');
    expect(legendEntries(legend)).toEqual([
      ['a', 'A'],
      ['c', 'C'],
      ['g', 'G'],
      ['t', 'T'],
      ['ambiguous', 'Other / ambiguous'],
    ]);
  });

  it('renders every protein chemistry group for the clustal scheme', () => {
    renderViewer('protein', 'clustal');

    const legend = screen.getByTestId('msa-color-legend');
    expect(legend.getAttribute('aria-label')).toBe('Clustal protein residue colour key');
    expect(legendEntries(legend)).toEqual([
      ['cl-hydrophobic', 'Hydrophobic'],
      ['cl-positive', 'Positive'],
      ['cl-negative', 'Negative'],
      ['cl-polar', 'Polar'],
      ['cl-aromatic', 'Aromatic'],
      ['cl-glycine', 'Glycine'],
      ['cl-proline', 'Proline'],
      ['cl-cysteine', 'Cysteine'],
      ['cl-other', 'Other / ambiguous'],
    ]);
  });

  it('hides the key when residue shading is monochrome and none', () => {
    renderViewer('dna', 'auto', 'mono');

    expect(screen.queryByTestId('msa-color-legend')).toBeNull();
  });
});
