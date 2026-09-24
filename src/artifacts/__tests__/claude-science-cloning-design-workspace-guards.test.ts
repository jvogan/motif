import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const componentPath = path.resolve(__dirname, '../ClaudeScienceCloningDesignWorkspace.tsx');
const cssPath = path.resolve(__dirname, '../claude-science-cloning-design-workspace.css');
const hostPath = path.resolve(__dirname, '../motif-artifact.tsx');
const artifactCssPath = path.resolve(__dirname, '../motif-artifact.css');
const component = fs.readFileSync(componentPath, 'utf8');
const css = fs.readFileSync(cssPath, 'utf8');
const host = fs.readFileSync(hostPath, 'utf8');
const artifactCss = fs.readFileSync(artifactCssPath, 'utf8');

describe('Claude Science cloning design workspace guards', () => {
  it('keeps the host contract typed and delegates biology to the bounded planners', () => {
    expect(component).toContain('planArtifactGoldenGateDesign');
    expect(component).toContain('planArtifactGibsonDesign');
    expect(component).toContain('ClaudeScienceCloningPrimerRequest');
    expect(component).toContain('ClaudeScienceCloningSavePayload');
    expect(component).toContain('requestedRecordIds: string[]');
    expect(component).toContain("requestedOrientations: Array<'forward' | 'reverse'>");
    expect(component).toContain('[...plan.product.orderedRecordIds]');
    expect(component).not.toMatch(/innerHTML|dangerouslySetInnerHTML/);
  });

  it('uses semantic controls and names icon-only actions', () => {
    expect(component).toContain('role="tablist"');
    expect(component).toContain('role="tabpanel"');
    expect(component).toContain('aria-label="Close cloning design workspace"');
    expect(component).toContain('aria-label={`Drag ${record.name} to reorder`}');
    expect(component).toContain('aria-pressed={part.orientation === orientation}');
    expect(component).toContain('aria-label={`Move ${record.name} up`}');
    expect(component).toContain('aria-label={`Move ${record.name} down`}');
    expect(component).toContain('aria-label={`Remove ${record.name}`}');
    expect(component).not.toMatch(/<(?:div|span)[^>]*onClick=/);
  });

  it('keeps GoldenBraid task-first, destination-explicit, and identity-separated from sequence orientation', () => {
    expect(component).toContain("'golden_braid_tu_alpha'");
    expect(component).toContain("'golden_braid_alpha_omega'");
    expect(component).toContain("'golden_braid_omega_alpha'");
    expect(component).toContain('aria-label="Assembly route"');
    expect(component).toContain('aria-label="GoldenBraid destination vector"');
    expect(component).toContain('aria-label="GoldenBraid destination type"');
    expect(component).toContain('goldenBraidRole: \'destination_vector\'');
    expect(component).toContain('goldenBraidSlot: destinationSlot');
    expect(component).toContain('goldenBraidSlot: part.goldenBraidSlot');
    expect(component).toContain('requestedLeftOverhang');
    expect(component).toContain('Set primer fusion sites');
    expect(component).not.toContain('higher-level stacking with SapI');
  });

  it('avoids glowing, one-sided active cards and unsafe broad transitions', () => {
    expect(css).not.toMatch(/box-shadow\s*:/);
    expect(css).not.toMatch(/text-shadow\s*:/);
    expect(css).not.toMatch(/transition\s*:\s*all/);
    expect(css).not.toMatch(/border-left-color\s*:\s*var\(--accent/);
    expect(css).toContain('.motif-cs-cloning-design-methods button[data-selected]');
    expect(css).toContain('.motif-cs-cloning-design-orientation button[data-selected]');
    expect(css).toContain('border-color: var(--border-strong)');
    expect(css).toContain('@media (pointer: coarse)');
    expect(css).toContain('min-width: 44px');
    expect(css).toContain('position: sticky');
    expect(css).toContain('@media (prefers-reduced-motion: reduce)');
  });

  it('renders disabled primary cloning actions as neutral controls', () => {
    expect(artifactCss).toMatch(
      /\.motif-cs-cloning-design \.motif-cs-cloning-design-primary-button:disabled\s*\{[\s\S]*?border-color:\s*var\(--border-subtle\);[\s\S]*?background:\s*var\(--control-bg\);[\s\S]*?color:\s*var\(--text-muted\);[\s\S]*?opacity:\s*1;[\s\S]*?filter:\s*none;/,
    );
  });

  it('sets reading text at 10px or more and keeps smaller sizes for labels and tags', () => {
    // 28 rules set sentence text at 9-9.5px, so 63 of 99 painted text nodes at two
    // parts were 9.5px or smaller; the primer workspace had 17 of 157.
    const smallReadingRules = [...css.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/([^{}]+)\{([^{}]*)\}/g)]
      .filter(([, , body]) => {
        const size = body.match(/font-size:\s*([\d.]+)px/);
        return size !== null && Number(size[1]) <= 9.5 && !/text-transform:\s*uppercase/.test(body);
      })
      .map(([, selector]) => selector.trim().replace(/\s+/g, ' '));
    expect(smallReadingRules).toEqual([
      // Declared but overridden: the broad `button { font: inherit }` rule wins.
      '.motif-cs-cloning-design-quiet-button',
      // The "Closing" tag on a Gibson junction lane.
      '.motif-cs-cloning-design-lane em',
      // "Golden Gate" ellipsizes in the review's 62px Method column above 9.5px.
      '.motif-cs-cloning-design-product dd, .motif-cs-cloning-design-summary dd',
    ]);
  });

  it('shows the window subtitle in full when the title bar has room for it', () => {
    // A 22ch cap cut "Golden Gate profiles + Gibson" to "Golden Gate profiles + Gib…"
    // in a 1,178px title bar. The ellipsis stays for a bar that is too narrow.
    expect(host).toContain('subtitle="Golden Gate profiles + Gibson"');
    const rule = artifactCss.match(/\.motif-cs-window-title small\s*\{([^}]*)\}/)?.[1] ?? '';
    expect(rule).toContain('overflow: hidden;');
    expect(rule).toContain('text-overflow: ellipsis;');
    expect(rule).not.toContain('max-width');
  });

  it('revalidates source hashes and records actual product order before host mutation', () => {
    expect(host).toContain('const verifiedPlan = saved.plan.kind === \'golden_gate_design\'');
    expect(host).toContain('verifiedProvenance.requestSha256 !== saved.provenance.requestSha256');
    expect(host).toContain('saved.product.sequence !== verifiedProduct.sequence');
    expect(host).toContain('const actualOrderedRecordIds = verifiedProduct?.orderedRecordIds ?? saved.requestedRecordIds;');
    expect(host).toContain('parentRecordIds: [...actualOrderedRecordIds]');
    expect(host).toContain('parentOrientations: [...actualOrientations]');
    expect(host).toContain('reviewed?.goldenBraidSlot');
    expect(host).toContain('saved.plan.goldenBraidDirection');
    expect(host).toContain('saved.plan.destinationRecordId');
  });
});
