// @vitest-environment jsdom

import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { act, Fragment, useRef } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it } from 'vitest';
import { orderPaneSlots, useKeepScrollAcrossPaneReorder } from '../motif-artifact';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

type PaneKey = 'inventory' | 'sequence' | 'map' | 'tools';

const here = dirname(fileURLToPath(import.meta.url));
const artifactSource = readFileSync(resolve(here, '..', 'motif-artifact.tsx'), 'utf8');

let root: Root | null = null;

/** A workspace like the artifact's: one keyed slot per pane, each with a pane and a separator. */
function Workspace({ order }: { order: PaneKey[] }) {
  const mainRef = useRef<HTMLElement | null>(null);
  useKeepScrollAcrossPaneReorder(mainRef, order);
  const slot = (pane: PaneKey) => (
    <Fragment key={pane}>
      <section data-pane-key={pane}><div className="scroller" data-scroller={pane} /></section>
      <div role="separator" data-after={pane} />
    </Fragment>
  );
  return (
    <main ref={mainRef}>
      {orderPaneSlots(order, { inventory: slot('inventory'), sequence: slot('sequence'), map: slot('map'), tools: slot('tools') })}
    </main>
  );
}

/**
 * jsdom keeps no scroll offsets, so each scroller gets a stored one, and the
 * workspace's insertBefore drops it the way a browser does when it re-inserts
 * a scroller; `resets` counts the offsets a move dropped.
 */
function mount(initial: PaneKey[]) {
  const container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => root!.render(<Workspace order={initial} />));
  const main = container.querySelector('main')!;
  const resets = { count: 0 };
  for (const scroller of main.querySelectorAll<HTMLElement>('.scroller')) {
    let top = 0;
    Object.defineProperty(scroller, 'scrollTop', { configurable: true, get: () => top, set: (value: number) => { top = value; } });
  }
  const insertBefore = main.insertBefore.bind(main);
  main.insertBefore = (<T extends Node>(node: T, child: Node | null): T => {
    if (node instanceof HTMLElement) {
      for (const scroller of node.querySelectorAll<HTMLElement>('.scroller')) {
        if (scroller.scrollTop !== 0) resets.count += 1;
        scroller.scrollTop = 0;
      }
    }
    return insertBefore(node, child);
  }) as typeof main.insertBefore;
  const panes = () => Array.from(main.querySelectorAll<HTMLElement>(':scope > [data-pane-key]')).map((pane) => pane.dataset.paneKey);
  const children = () => Array.from(main.children).map((child) => (child as HTMLElement).dataset.paneKey ?? `|${(child as HTMLElement).dataset.after}`);
  return { main, panes, children, resets };
}

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  document.body.replaceChildren();
});

describe('workspace pane DOM order', () => {
  it('writes the panes in paneOrder, so Tab visits them in the order they are drawn', () => {
    const { panes, children } = mount(['inventory', 'sequence', 'map', 'tools']);
    expect(panes()).toEqual(['inventory', 'sequence', 'map', 'tools']);
    // Each pane's separator follows it rather than trailing another pane.
    expect(children()).toEqual(['inventory', '|inventory', 'sequence', '|sequence', 'map', '|map', 'tools', '|tools']);
  });

  it('moves the pane nodes, not only their CSS order, when the user reorders panes', () => {
    const { main, panes } = mount(['inventory', 'sequence', 'map', 'tools']);
    const sequence = main.querySelector('[data-pane-key="sequence"]');
    act(() => root!.render(<Workspace order={['inventory', 'map', 'sequence', 'tools']} />));
    expect(panes()).toEqual(['inventory', 'map', 'sequence', 'tools']);
    // The same node moved: nothing inside it remounted.
    expect(main.querySelector('[data-pane-key="sequence"]')).toBe(sequence);
    act(() => root!.render(<Workspace order={['sequence', 'inventory', 'map', 'tools']} />));
    expect(panes()).toEqual(['sequence', 'inventory', 'map', 'tools']);
  });

  it('fills in panes a saved order leaves out, in the default order', () => {
    expect(orderPaneSlots(['map'], { inventory: 'i', sequence: 's', map: 'm', tools: 't' })).toEqual(['m', 'i', 's', 't']);
  });

  it('gives a moved pane its scroll offset back', () => {
    const { main, resets } = mount(['inventory', 'sequence', 'map', 'tools']);
    const scroller = main.querySelector<HTMLElement>('[data-scroller="sequence"]')!;
    scroller.scrollTop = 1107;
    scroller.dispatchEvent(new Event('scroll'));
    act(() => root!.render(<Workspace order={['inventory', 'map', 'sequence', 'tools']} />));
    // Precondition: the move really dropped the offset.
    expect(resets.count).toBe(1);
    expect(scroller.scrollTop).toBe(1107);
  });

  it('renders the artifact workspace through orderPaneSlots, not in a fixed order', () => {
    const start = artifactSource.indexOf('id="motif-cs-workspace"');
    const end = artifactSource.indexOf('</main>', start);
    expect(start).toBeGreaterThan(0);
    const workspace = artifactSource.slice(start, end);
    expect(workspace).toContain('{orderPaneSlots(paneOrder, {');
    for (const pane of ['inventory', 'sequence', 'map', 'tools']) {
      expect(workspace).toContain(`${pane}: paneVisibility.${pane} ? (\n          <Fragment key="${pane}">`);
      expect(workspace).not.toContain(`{paneVisibility.${pane} ? (`);
    }
    expect(artifactSource).toContain('useKeepScrollAcrossPaneReorder(workspaceMainRef, paneOrder);');
  });
});
