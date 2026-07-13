export const NO_COLOR_VALUE = 'var(--feature-neutral)';

// A balanced, evenly-spaced hue set (medium saturation so each reads clearly in
// both light and dark themes). Twelve in a 6x2 grid + the "No color" option.
export const DEFAULT_STANDARD_COLORS = [
  '#5b8def', '#39b5c9', '#2fbfa4', '#46c26b', '#8fc740', '#e0b83c',
  '#e89b3e', '#e8794e', '#e0655f', '#db6a9e', '#a47be0', '#8a93a8',
] as const;
