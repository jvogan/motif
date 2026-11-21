import type { MapFeatureRender } from './types';

/** How many names the "+N features" tooltip lists before it says "and N more". */
export const UNNAMED_FEATURES_LISTED = 5;

/**
 * The tooltip of the circular map's "+N features" control: which features the ring
 * leaves without a name, in map order (by first base), then what a click does. It
 * lists the unnamed features themselves ("Not named on the map: ..."), so the
 * reader is not pointed at the features that do have names. Null when every
 * feature is named.
 */
export function unnamedFeaturesTitle(features: readonly MapFeatureRender[]): string | null {
  const unnamed = features
    .filter((feature) => !feature.label && feature.name.trim() !== '')
    .sort((a, b) => a.startBp - b.startBp);
  if (unnamed.length === 0) return null;
  const listed = unnamed.slice(0, UNNAMED_FEATURES_LISTED).map((feature) => feature.name);
  const rest = unnamed.length - listed.length;
  const names = rest > 0 ? `${listed.join(', ')} and ${rest} more` : listed.join(', ');
  return `Not named on the map: ${names}. Click to list all features.`;
}
