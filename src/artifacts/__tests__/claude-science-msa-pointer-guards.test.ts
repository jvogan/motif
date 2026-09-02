import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const here = dirname(fileURLToPath(import.meta.url));
const viewerSource = readFileSync(resolve(here, '..', 'ClaudeScienceMsaViewer.tsx'), 'utf8');
const msaCss = readFileSync(resolve(here, '..', 'claude-science-msa.css'), 'utf8');

describe('Claude Science MSA pointer interaction guards', () => {
  it('keeps compact and indirect pointer targets at the 24px floor', () => {
    expect(msaCss).toMatch(/html \.motif-cs-map-column[^{}]+\.motif-cs-pane-collapse\s*\{[^}]*width:\s*24px;[^}]*height:\s*24px;/s);
    expect(msaCss).toMatch(/\.motif-cs-msa-workspace \.motif-cs-msa-overview\s*\{[^}]*height:\s*24px;/s);
    expect(msaCss).toMatch(/\.motif-cs-msa-workspace \.motif-cs-msa-zoom-range\s*\{[^}]*min-height:\s*24px;/s);
    expect(msaCss).toMatch(/\.motif-cs-msa-row-select::before\s*\{[^}]*height:\s*24px;/s);
    expect(msaCss).toMatch(/\.motif-cs-msa-elision-marker::before\s*\{[^}]*width:\s*max\(24px, 100%\);/s);
  });

  it('keeps direct-manipulation cursors truthful', () => {
    expect(msaCss).toMatch(/\.motif-cs-msa-workspace \.motif-cs-msa-matrix-scroll\s*\{\s*cursor:\s*crosshair;/);
    expect(msaCss).toMatch(/\.motif-cs-msa-overview\[data-scrubbing='true'\]\s*\{\s*cursor:\s*grabbing;/);
    expect(msaCss).toMatch(/\.motif-cs-msa-zoom-range\s*\{[^}]*cursor:\s*ew-resize;/s);
    expect(viewerSource).toContain("event.currentTarget.dataset.scrubbing = 'true';");
    expect(viewerSource).toContain('delete event.currentTarget.dataset.scrubbing;');
  });

  it('disables held-edge motion for reduced-motion users and locks wheel gesture axes', () => {
    expect(viewerSource).toContain("window.matchMedia?.('(prefers-reduced-motion: reduce)')");
    expect(viewerSource).toContain('if (reducedMotionRef.current) {');
    expect(viewerSource).toContain('resolveMsaWheelGesture(');
  });

  it('renders measurable overview ticks with a two-pixel floor', () => {
    expect(viewerSource).toContain('(2.1 * overviewBinCount) / overviewPlotWidth');
    expect(viewerSource).toContain('data-msa-overview-difference="true"');
  });

  it('retains the first screen target across a row-name multi-click', () => {
    expect(viewerSource).toContain('const sameScreenPoint =');
    expect(viewerSource).toContain('onTemplateChange(repeatedPointerClick ? previous.rowId : rowId);');
  });
});
