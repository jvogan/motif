import type { RestrictionSite } from '../bio/types';

/** Names in the order their first visible sites appear along the map. */
export function visibleCutterNames(sites: readonly Pick<RestrictionSite, 'enzyme' | 'position'>[]): string[] {
  const firstPositions = new Map<string, number>();
  for (const { enzyme, position } of sites) {
    const first = firstPositions.get(enzyme);
    if (first === undefined || position < first) firstPositions.set(enzyme, position);
  }
  return [...firstPositions].sort(([a, firstA], [b, firstB]) =>
    firstA - firstB || a.localeCompare(b)).map(([name]) => name);
}
