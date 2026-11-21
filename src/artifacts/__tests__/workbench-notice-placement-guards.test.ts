import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const here = dirname(fileURLToPath(import.meta.url));
const artifactSource = readFileSync(resolve(here, '..', 'motif-artifact.tsx'), 'utf8');
const artifactCss = readFileSync(resolve(here, '..', 'motif-artifact.css'), 'utf8');

// The bodies of the top-level rules whose selector list is exactly `selector`, in order.
const ruleBody = (css: string, selector: string, count = 1): string => {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s*');
  const matches = [...css.matchAll(new RegExp(`(?:^|\\n)${escaped}\\s*\\{([^}]*)\\}`, 'g'))];
  expect(matches, selector).toHaveLength(count);
  return matches.map((match) => match[1]).join(';');
};
const declarations = (body: string): Record<string, string> => Object.fromEntries(
  body.split(';').map((line) => line.replace(/\/\*[\s\S]*?\*\//g, '').trim()).filter(Boolean).map((line) => {
    const colon = line.indexOf(':');
    return [line.slice(0, colon).trim(), line.slice(colon + 1).trim()];
  }),
);

describe('workbench notice placement', () => {
  it('floats in the vertical middle of the frame, off the top bar, and lets clicks through its body', () => {
    const notice = declarations(ruleBody(artifactCss, '.motif-cs-workbench-notice'));
    expect(notice.position).toBe('absolute');
    expect(notice.inset).toBe('0');
    expect(notice.width).toBe('fit-content');
    expect(notice.height).toBe('fit-content');
    expect(notice.margin).toBe('auto');
    expect(notice['pointer-events']).toBe('none');
    // No edge anchor: a top, bottom, left or right offset would pin it to chrome.
    for (const edge of ['top', 'bottom', 'left', 'right', 'transform']) expect(notice[edge], edge).toBeUndefined();
  });

  it('gives the pointer back only to its own buttons', () => {
    const buttons = declarations(ruleBody(artifactCss, '.motif-cs-workbench-notice-action,\n.motif-cs-workbench-notice-dismiss'));
    expect(buttons['pointer-events']).toBe('auto');
    expect(artifactSource).toContain('className="motif-cs-window-icon motif-cs-workbench-notice-dismiss"');
    expect(artifactSource).toContain('aria-label="Dismiss notice"');
  });

  it('keeps the in-pane recovery notice in flow and fully clickable', () => {
    const pane = declarations(ruleBody(artifactCss, '.motif-cs-workbench-notice.motif-cs-pane-notice', 2));
    expect(pane.position).toBe('static');
    expect(pane.width).toBe('auto');
    expect(pane.height).toBe('auto');
    expect(pane['pointer-events']).toBe('auto');
  });

  it('holds stacked panes at the left edge of the middle, and only there', () => {
    const media = artifactCss.match(/@media \(max-width: 899px\) \{\s*\.motif-cs-workbench-notice:not\(\.motif-cs-pane-notice\) \{([^}]*)\}\s*\}/);
    expect(media).not.toBeNull();
    const stacked = declarations(media![1]);
    expect(stacked).toEqual({ left: '8px', 'margin-left': '0' });
    expect(artifactCss.match(/\.motif-cs-workbench-notice:not\(\.motif-cs-pane-notice\)/g)).toHaveLength(1);
  });

  it('announces the notice through an alert or status live region', () => {
    expect(artifactSource).toContain("role={workbenchNotice.tone === 'error' ? 'alert' : 'status'}");
    expect(artifactSource).toContain("aria-live={workbenchNotice.tone === 'error' ? 'assertive' : 'polite'}");
    expect(artifactSource).toContain('<span className="motif-cs-workbench-notice-text">{workbenchNotice.message}</span>');
  });
});
