// @vitest-environment jsdom

import { act, waitFor } from '@testing-library/react';
import { beforeAll, describe, expect, it } from 'vitest';
import './motif-workbench-jsdom-setup';
import '../motif-artifact';

// The whole workbench, mounted the way the artifact mounts itself, with records
// long enough to reach the restriction scanner's work and result limits.

type RuntimeRecord = { id: string; seq: string };
type RuntimeSummary = { text: string; data: { restriction: Record<string, unknown> | null } };
type RuntimeWindow = {
  motifGetInventory: () => RuntimeRecord[];
  motifRenderInventory: (records: unknown[]) => void;
  motifSetRestrictionSources: (sources: unknown) => string[];
  motifListRestrictionSources: () => Array<{ id: string; active: boolean }>;
  motifDescribe: () => RuntimeSummary | null;
  motifGetWorkspace: () => Record<string, unknown>;
  motifReplaceWorkspace: (workspace: unknown, options?: { discardUnsavedChanges?: boolean }) => number;
};

const runtime = () => window as unknown as RuntimeWindow;
const recoveryPanel = () => document.querySelector('section.motif-cs-panel[role="alert"]');

beforeAll(async () => {
  await waitFor(() => expect(document.querySelector('.motif-cs-sequence')).not.toBeNull());
});

function seededDna(length: number, seed: number): string {
  let state = seed >>> 0;
  const out: string[] = [];
  for (let index = 0; index < length; index += 1) {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    out.push('ACGT'[state >>> 30]);
  }
  return out.join('');
}

// A complete replacement, so the source selection a previous test stored for
// its record does not hold the next test's inventory replacement back.
async function loadRecord(id: string, seq: string) {
  await act(async () => {
    runtime().motifReplaceWorkspace(
      { records: [{ id, name: id, molecule: 'dna', topology: 'circular', seq, features: [] }] },
      { discardUnsavedChanges: true },
    );
  });
  await waitFor(() => expect(runtime().motifGetInventory().map((record) => record.id)).toEqual([id]));
}

describe('the full enzyme list on a record past the scan work limit', () => {
  it('scans what fits, says what it skipped, and keeps the workbench mounted', async () => {
    await loadRecord('large-all', seededDna(120_000, 7));
    let selected: string[] = [];
    await act(async () => {
      selected = runtime().motifSetRestrictionSources(['all']);
    });

    expect(selected).toEqual(['all']);
    expect(recoveryPanel()).toBeNull();
    expect(runtime().motifListRestrictionSources().find((source) => source.id === 'all')?.active).toBe(true);
    expect(runtime().motifGetInventory().map((record) => record.id)).toEqual(['large-all']);

    const scanLimit = runtime().motifDescribe()?.data.restriction?.scanLimit as
      | { code: string; scannedEnzymeCount: number; requestedEnzymeCount: number }
      | undefined;
    expect(scanLimit?.code).toBe('scan_work_limit');
    expect(scanLimit!.scannedEnzymeCount).toBeGreaterThan(0);
    expect(scanLimit!.scannedEnzymeCount).toBeLessThan(scanLimit!.requestedEnzymeCount);
    expect(runtime().motifDescribe()?.text).toContain('Restriction scan limit:');
    expect(runtime().motifDescribe()?.data.restriction?.enzymesThatCut).toBeGreaterThan(0);
    expect(document.body.textContent).toContain(
      `Scanned ${scanLimit!.scannedEnzymeCount.toLocaleString()} of ${scanLimit!.requestedEnzymeCount.toLocaleString()} selected enzymes`,
    );

    // A shorter record under the same selection scans the whole list again.
    await loadRecord('short-all', seededDna(4_000, 11));
    await act(async () => {
      runtime().motifSetRestrictionSources(['all']);
    });
    expect(runtime().motifDescribe()?.data.restriction?.scanLimit).toBeUndefined();
    expect(document.body.textContent).not.toContain('selected enzymes because');
  }, 60_000);
});

describe('a low-complexity record past the scan result limit', () => {
  it('keeps only enzymes that were scanned completely and keeps the workbench mounted', async () => {
    // A GC repeat puts a four-base GCGC site at every other base; at 88 kb the
    // full list fits the work budget but not the result budget.
    await loadRecord('gc-repeat', 'GC'.repeat(44_000));
    await act(async () => {
      runtime().motifSetRestrictionSources(['all']);
    });
    expect(recoveryPanel()).toBeNull();
    const scanLimit = runtime().motifDescribe()?.data.restriction?.scanLimit as
      | { code: string; scannedEnzymeCount: number; requestedEnzymeCount: number }
      | undefined;
    expect(scanLimit?.code).toBe('result_limit');
    expect(scanLimit!.scannedEnzymeCount).toBeLessThan(scanLimit!.requestedEnzymeCount);
  }, 60_000);
});
