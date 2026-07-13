/**
 * Agarose gel electrophoresis simulation.
 * Simulates DNA fragment migration and renders ASCII art gel images.
 * All functions are pure — no side effects.
 */

// ─── Constants ─────────────────────────────────────────────────────────────

/** Standard 1 kb DNA ladder fragment sizes (bp) */
export const LADDER_1KB: number[] = [
  10000, 8000, 6000, 5000, 4000, 3000, 2000, 1500, 1000, 750, 500, 250,
];

/** Standard 100 bp DNA ladder fragment sizes (bp) */
export const LADDER_100BP: number[] = [
  1500, 1000, 900, 800, 700, 600, 500, 400, 300, 200, 100,
];

/**
 * Log-linear migration constants for different agarose percentages.
 * distance = a - b * log10(size), clamped to [0, 1].
 */
const AGAROSE_CONSTANTS: Record<number, { a: number; b: number }> = {
  0.8: { a: 1.0, b: 0.22 },
  1.0: { a: 1.1, b: 0.25 },
  1.5: { a: 1.2, b: 0.28 },
  2.0: { a: 1.3, b: 0.32 },
};

// ─── Types ─────────────────────────────────────────────────────────────────

export interface GelBand {
  /** Fragment size in base pairs */
  size: number;
  /** Fragment name or "Ladder" */
  label: string;
  /** 0-indexed lane number */
  lane: number;
  /** Relative migration distance: 0 = top (wells), 1 = bottom */
  migrationDistance: number;
  /** Visual intensity 0–1 */
  intensity: number;
}

export interface GelResult {
  bands: GelBand[];
  ladderBands: GelBand[];
  /** Lane labels (first is always "M" for marker/ladder) */
  lanes: string[];
  agarosePercent: number;
  /** Rendered ASCII gel */
  ascii: string;
}

export interface GelOptions {
  /** Agarose percentage, default 1.0 */
  agarosePercent?: number;
  /** Ladder fragment sizes, default LADDER_1KB */
  ladder?: number[];
  /** Character width per lane, default 8 */
  width?: number;
  /** Character height of the gel body, default 30 */
  height?: number;
}

// ─── Core functions ─────────────────────────────────────────────────────────

/**
 * Calculate relative migration distance for a fragment.
 * Uses a log-linear relationship: distance = a - b * log10(size).
 * Returns a value clamped to [0, 1].
 */
export function migrationDistance(sizeBP: number, agarosePercent: number): number {
  // Find nearest defined agarose constant (round to supported values)
  const supported = [0.8, 1.0, 1.5, 2.0];
  const nearest = supported.reduce((prev, curr) =>
    Math.abs(curr - agarosePercent) < Math.abs(prev - agarosePercent) ? curr : prev,
  );

  const { a, b } = AGAROSE_CONSTANTS[nearest];
  const raw = a - b * Math.log10(Math.max(sizeBP, 1));
  return Math.min(1, Math.max(0, raw));
}

/**
 * Simulate gel electrophoresis for one or more DNA samples.
 * The first lane is always the marker/ladder.
 */
export function simulateGel(
  samples: Array<{ name: string; fragments: number[] }>,
  options?: GelOptions,
): GelResult {
  const agarosePercent = options?.agarosePercent ?? 1.0;
  const ladderSizes = options?.ladder ?? LADDER_1KB;
  const laneWidth = options?.width ?? 8;
  const gelHeight = options?.height ?? 30;

  // Lane 0 = ladder, lanes 1..N = samples
  const laneLabels = ['M', ...samples.map(s => s.name)];

  // Build ladder bands (lane 0)
  const ladderBands: GelBand[] = ladderSizes.map(size => ({
    size,
    label: formatSize(size),
    lane: 0,
    migrationDistance: migrationDistance(size, agarosePercent),
    intensity: 0.6, // dimmer to distinguish from samples
  }));

  // Build sample bands
  const sampleBands: GelBand[] = [];
  samples.forEach((sample, sIdx) => {
    const laneIdx = sIdx + 1;
    const uniqueSizes = [...new Set(sample.fragments)].sort((a, b) => b - a);
    for (const size of uniqueSizes) {
      // Count duplicates for intensity
      const count = sample.fragments.filter(f => f === size).length;
      sampleBands.push({
        size,
        label: formatSize(size),
        lane: laneIdx,
        migrationDistance: migrationDistance(size, agarosePercent),
        intensity: Math.min(1, 0.6 + count * 0.2),
      });
    }
  });

  const ascii = renderGelASCII(
    { bands: sampleBands, ladderBands, lanes: laneLabels, agarosePercent },
    { width: laneWidth, height: gelHeight },
  );

  return {
    bands: sampleBands,
    ladderBands,
    lanes: laneLabels,
    agarosePercent,
    ascii,
  };
}

/**
 * Format a size in bp for display (e.g. 1000 → "1kb", 500 → "500").
 */
function formatSize(bp: number): string {
  if (bp >= 1000 && bp % 1000 === 0) return `${bp / 1000}kb`;
  if (bp >= 1000) return `${(bp / 1000).toFixed(1)}kb`;
  return String(bp);
}

/**
 * Render a GelResult as ASCII art.
 */
export function renderGelASCII(
  result: Omit<GelResult, 'ascii'>,
  options?: { width?: number; height?: number },
): string {
  const laneWidth = options?.width ?? 8;
  const gelHeight = options?.height ?? 30;
  const numLanes = result.lanes.length;

  // ── Build the size label column (right side) ──────────────────────────
  // Gather all unique migration distances and their size labels from ladder
  const ladderRows = new Map<number, string>(); // row → label
  for (const band of result.ladderBands) {
    const row = Math.round(band.migrationDistance * (gelHeight - 1));
    // Prefer smaller sizes when two bands map to the same row
    const existing = ladderRows.get(row);
    if (!existing || band.size < parseSizeBP(existing)) {
      ladderRows.set(row, band.label);
    }
  }

  // ── Initialize the gel grid ───────────────────────────────────────────
  // grid[row][lane] = cell string of width laneWidth
  const grid: string[][] = Array.from({ length: gelHeight }, () =>
    Array.from({ length: numLanes }, () => ' '.repeat(laneWidth)),
  );

  // ── Place bands in the grid ───────────────────────────────────────────
  const allBands = [...result.ladderBands, ...result.bands];
  for (const band of allBands) {
    const row = Math.round(band.migrationDistance * (gelHeight - 1));
    if (row < 0 || row >= gelHeight) continue;

    const isLadder = band.lane === 0;
    const bandChar = isLadder ? '──' : '══';
    const cell = ' '.repeat(Math.floor((laneWidth - 2) / 2)) + bandChar + ' '.repeat(laneWidth - Math.floor((laneWidth - 2) / 2) - 2);
    grid[row][band.lane] = cell.slice(0, laneWidth);
  }

  // ── Render ────────────────────────────────────────────────────────────
  const lines: string[] = [];

  // Header: lane labels
  const headerParts = result.lanes.map(name => {
    const padded = name.slice(0, laneWidth).padStart(Math.floor(laneWidth / 2 + name.length / 2)).padEnd(laneWidth);
    return padded;
  });
  lines.push('     ' + headerParts.join(''));

  // Top border
  const topBorder =
    '  ┌' +
    result.lanes.map((_, i) => '─'.repeat(laneWidth) + (i < numLanes - 1 ? '┬' : '┐')).join('');
  lines.push(topBorder);

  // Gel body rows
  for (let row = 0; row < gelHeight; row++) {
    const cells = grid[row].map(cell => '│' + cell).join('');
    const sizeLabel = ladderRows.get(row) ?? '';
    lines.push('  ' + cells + '│' + (sizeLabel ? '  ' + sizeLabel : ''));
  }

  // Bottom border
  const bottomBorder =
    '  └' +
    result.lanes.map((_, i) => '─'.repeat(laneWidth) + (i < numLanes - 1 ? '┴' : '┘')).join('');
  lines.push(bottomBorder);

  return lines.join('\n');
}

/** Parse a size label back to bp for comparison. */
function parseSizeBP(label: string): number {
  if (label.endsWith('kb')) {
    return parseFloat(label) * 1000;
  }
  return parseInt(label, 10) || 0;
}
