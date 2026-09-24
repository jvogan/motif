import { describe, expect, it } from 'vitest';
import { exportPopoverLeft } from '../motif-artifact';

// Geometry measured from the side-by-side workspace (Sequence beside Map).
describe('exportPopoverLeft', () => {
  it('extends over the Map when a right-aligned popover would cover the narrow Sequence column', () => {
    // 1440x900: Export button 560-618, Sequence column 227-678, popover 460 wide.
    expect(exportPopoverLeft({ left: 560, right: 618 }, { left: 227, right: 678 }, 460, 1440)).toBe(560);
    // 1024x768: Export button 394-452, Sequence column 227-512.
    expect(exportPopoverLeft({ left: 394, right: 452 }, { left: 227, right: 512 }, 460, 1024)).toBe(394);
  });

  it('keeps the right-aligned placement when the Sequence column is wide', () => {
    // Stacked workspace: the column spans the window and the button sits at its right end.
    expect(exportPopoverLeft({ left: 1300, right: 1358 }, { left: 227, right: 1380 }, 460, 1440)).toBe(898);
  });

  it('stays inside the viewport either way', () => {
    expect(exportPopoverLeft({ left: 900, right: 958 }, { left: 227, right: 980 }, 460, 1000)).toBeLessThanOrEqual(1000 - 460 - 8);
    expect(exportPopoverLeft({ left: 10, right: 60 }, null, 460, 390)).toBe(8);
  });
});
