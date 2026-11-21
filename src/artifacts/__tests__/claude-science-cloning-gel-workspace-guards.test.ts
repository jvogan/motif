import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const here = dirname(fileURLToPath(import.meta.url));
const read = (name: string) => readFileSync(resolve(here, '..', name), 'utf8');
const cloningSource = read('ClaudeScienceCloningDesignWorkspace.tsx');
const cloningCss = read('claude-science-cloning-design-workspace.css');
const assemblySource = read('ClaudeScienceAssemblyWorkspace.tsx');
const gelSource = read('ClaudeScienceGelWorkspace.tsx');
const artifactCss = read('motif-artifact.css');

function rule(css: string, selector: string): string {
  const escaped = selector.replace(/[.[\]()*+?^${}|:"=>~-]/g, '\\$&');
  return [...css.matchAll(new RegExp(`(?:^|\\n)${escaped}\\s*\\{([^}]*)\\}`, 'g'))].map((match) => match[1]).join('\n');
}

/** The first `condition` block that contains `marker`, brace-matched to its own close. */
function mediaBlockContaining(css: string, condition: string, marker: string): string {
  for (let from = 0; ; ) {
    const open = css.indexOf(condition, from);
    expect(open, `no ${condition} block contains ${marker}`).toBeGreaterThanOrEqual(0);
    let depth = 0;
    let end = -1;
    for (let i = css.indexOf('{', open); i < css.length; i += 1) {
      if (css[i] === '{') depth += 1;
      else if (css[i] === '}') {
        depth -= 1;
        if (depth === 0) {
          end = i;
          break;
        }
      }
    }
    expect(end, `unbalanced braces after ${condition}`).toBeGreaterThan(open);
    const block = css.slice(open, end + 1);
    if (block.includes(marker)) return block;
    from = open + condition.length;
  }
}

describe('cloning design workspace', () => {
  it('has one header, no kicker, no step numbers, and no tab captions', () => {
    expect(cloningSource).not.toContain('motif-cs-cloning-design-kicker');
    expect(cloningCss).not.toContain('.motif-cs-cloning-design-kicker');
    expect(cloningSource).toContain('<h2 id={titleId}>Cloning design</h2>');
    expect(cloningSource).not.toMatch(/<span>0\d<\/span>/);
    expect(cloningSource).not.toContain('<span>{plan.kind ===');
    expect(cloningSource).not.toContain('Type IIS & modular standards');
    expect(cloningSource).not.toContain('Overlap assembly');
    expect(cloningCss).not.toContain('.motif-cs-cloning-design-methods small');
  });

  it('labels a part row by words and keeps each target at least 28px', () => {
    for (const label of ['>Up</button>', '>Down</button>', '>Remove</button>']) {
      expect(cloningSource).toContain(label);
    }
    const actions = rule(cloningCss, '.motif-cs-cloning-design-part-actions button');
    expect(actions).toContain('min-width: var(--control-h-sm);');
    expect(actions).toContain('height: var(--control-h-sm);');
    expect(actions).toContain('font-size: var(--fs-sm);');
    expect(rule(cloningCss, '.motif-cs-cloning-design-fusion-editor summary')).toContain('line-height: var(--control-h-sm);');
  });

  it('uses sentence case for field labels and section headings', () => {
    for (const text of ['Assembly route', 'Compatibility profile', 'Design name', 'Search records', 'Record to add', 'Product preview']) {
      expect(cloningSource).toContain(text);
    }
    for (const text of ['Assembly Route', 'Design Name', 'Search Inventory', 'Product Preview', 'Preparation Checklist']) {
      expect(cloningSource).not.toContain(text);
    }
    expect(rule(cloningCss, '.motif-cs-cloning-design-section-head h3')).toContain('font-size: var(--fs-md);');
  });

  it('shows summary values whole instead of cutting them to an ellipsis', () => {
    const value = cloningCss.match(/\.motif-cs-cloning-design-summary dd \{([^}]*)\}/)?.[1] ?? '';
    expect(value).toContain('overflow-wrap: anywhere;');
    expect(value).not.toContain('text-overflow: ellipsis;');
  });
});

describe('status lines', () => {
  it('draws only saves and hand-offs, and announces every other note without drawing it', () => {
    expect(cloningSource).toContain('const RESULT_STATUS = /\\b(saved|replaced|opened|started)\\b/;');
    expect(cloningSource).toContain('data-quiet={!RESULT_STATUS.test(status) || undefined}');
    expect(cloningCss).toContain('.motif-cs-cloning-design-feedback p[role="status"][data-quiet] {');
    expect(assemblySource).toContain('data-quiet={!/\\bsaved\\b/.test(status) || undefined}');
    expect(artifactCss).toContain('.motif-cs-assembly-live-status[data-quiet] {');
    // The element stays in the page, so the live region still announces.
    expect(rule(cloningCss, '.motif-cs-cloning-design-feedback p[role="status"][data-quiet]')).not.toContain('display: none;');
    expect(rule(artifactCss, '.motif-cs-assembly-live-status[data-quiet]')).not.toContain('display: none;');
  });
});

describe('assembly workspace', () => {
  it('drops the kicker lines and labels part actions with words', () => {
    expect(assemblySource).not.toContain('motif-cs-kicker');
    expect(assemblySource).toContain('<h2 id={titleId}>Assembly</h2>');
    expect(assemblySource).toMatch(/aria-label=\{`Move \$\{record\.name\} up`\}[\s\S]*?\n\s+Up\n/);
    expect(assemblySource).toMatch(/aria-label=\{`Move \$\{record\.name\} down`\}[\s\S]*?\n\s+Down\n/);
    expect(assemblySource).toMatch(/aria-label=\{`Remove \$\{record\.name\}`\}[\s\S]*?>\s+Remove\s+<\/button>/);
    const actions = rule(artifactCss, '.motif-cs-assembly-part-actions button');
    expect(actions).toContain('min-width: var(--control-h-sm);');
    expect(actions).toContain('height: var(--control-h-sm);');
  });

  it('stacks the assembly into one column below 920px', () => {
    expect(artifactCss).toMatch(/@media \(max-width: 920px\)[\s\S]*?\.motif-cs-assembly-part-row \{\s*grid-template-columns: 22px minmax\(0, 1fr\);/);
  });
});

describe('gel workspace', () => {
  it('has one title, no kicker, and no second Close when the window supplies one', () => {
    expect(gelSource).not.toContain('motif-cs-kicker');
    expect(gelSource).toContain('<h2>Gel preview</h2>');
    expect(gelSource).toContain('{embedded ? null : <button className="motif-cs-mini-button" type="button" onClick={onClose}>Close</button>}');
    expect(gelSource).not.toContain('Interpretation limit.');
    expect(gelSource).toContain("isSaved ? 'Saved' : 'Save result'");
  });

  it('keeps lane actions at 28px and puts each source lane on one row', () => {
    const action = rule(artifactCss, '.motif-cs-gel-source-summary .motif-cs-text-button');
    expect(action).toContain('min-height: var(--control-h-sm);');
    expect(action).toContain('font-size: var(--fs-sm);');
    const stacked = mediaBlockContaining(artifactCss, '@media (max-width: 599.98px)', '.motif-cs-gel-source-row > span');
    expect(stacked).toMatch(/\.motif-cs-gel-source-row > span \{\s*grid-template-columns: minmax\(0, 1fr\) auto;/);
    expect(rule(artifactCss, '.motif-cs-gel-agarose-control input[type="range"]')).toContain('height: var(--control-h-sm);');
  });

  it('stands the setup beside the preview from 600px up and puts the preview first below it', () => {
    // Stacked at 700px the setup would take 468 of the layout's 625px and leave 118px of the
    // plate, with its lane labels under the footer. A window is the whole panel under 600px
    // (WINDOW_FILL_QUERY), and only there does the layout stack.
    const stacked = mediaBlockContaining(artifactCss, '@media (max-width: 599.98px)', '.motif-cs-gel-workspace-layout');
    expect(stacked).toMatch(/\.motif-cs-gel-workspace-layout \{\s*grid-template-columns: minmax\(0, 1fr\);/);
    expect(stacked).toMatch(/\.motif-cs-gel-preview-column \{\s*order: -1;/);
    expect(artifactCss).not.toMatch(/@media \(max-width: 760px\) \{\s*\.motif-cs-gel-workspace-layout/);
    // The preview comes first, so there is no jump link to a preview below the fold.
    expect(gelSource).not.toContain('View preview');
    expect(artifactCss).not.toContain('motif-cs-gel-mobile-preview-link');
  });

  it('draws the ladder choice as one segmented control without a second box', () => {
    const segmented = rule(artifactCss, '.motif-cs-gel-ladder-picker .motif-cs-segmented');
    expect(segmented).toContain('border: 0;');
    expect(segmented).toContain('padding: 0;');
  });

  it('keeps the name and its action on one row at 480px', () => {
    expect(artifactCss).toMatch(/@media \(max-width: 480px\)[\s\S]*?\.motif-cs-gel-workspace-footer \{\s*grid-template-columns: minmax\(0, 1fr\) auto;/);
  });
});

describe('workspace controls that must not appear, disappear or move on a click', () => {
  it('keeps the gel Clear button in place, disabled with a reason when no lane is ticked', () => {
    expect(gelSource).toContain('disabled={effectiveSelection.length === 0}');
    expect(gelSource).toContain("title={effectiveSelection.length === 0 ? 'No lanes are selected' : 'Deselect every lane'}");
    // It renders always, not only once a lane is ticked, which would move the row's other contents.
    expect(gelSource).not.toMatch(/effectiveSelection\.length > 0 \? \(\s*<button className="motif-cs-text-button"/);
    const clear = rule(artifactCss, '.motif-cs-gel-source-summary .motif-cs-text-button:disabled');
    expect(clear).toContain('color: var(--text-muted);');
    expect(clear).not.toContain('opacity');
  });

  it('reserves the window scrollbar gutter so a scrollbar appearing cannot rewrap the content', () => {
    expect(rule(artifactCss, '.motif-cs-window-body')).toContain('scrollbar-gutter: stable;');
    // ...but not on the phone-width sheet, where the reserved gutter would take width the labels need.
    expect(rule(artifactCss, '.motif-cs-window[data-fill] .motif-cs-window-body')).toContain('scrollbar-gutter: auto;');
  });

  it('reserves the assembly status row and never dims a disabled control with opacity', () => {
    expect(rule(artifactCss, '.motif-cs-assembly-live-status')).toContain('min-height: calc(1.4 * var(--fs-xs));');
    expect(rule(artifactCss, '.motif-cs-assembly-live-status[data-quiet]')).toContain('color: transparent;');
    expect(rule(artifactCss, '.motif-cs-assembly-part-actions button:disabled')).not.toContain('opacity');
    expect(cloningCss).not.toMatch(/button:disabled\s*\{[^}]*opacity/);
  });
});
