import { featureTypeLabel, regulatoryClassFeatureType } from './genbank-parser';
import type { Feature } from './types';

/**
 * The /regulatory_class values a feature carries, trimmed, empty ones dropped.
 * The reader keeps every qualifier in file order as `motifQualifiers`; a
 * feature built without it may still hold one value as `regulatory_class`.
 */
function regulatoryClasses(metadata: Feature['metadata']): string[] {
  const entries = metadata.motifQualifiers;
  if (Array.isArray(entries)) {
    return entries.flatMap((entry: unknown) => {
      if (!entry || typeof entry !== 'object') return [];
      const { key, value } = entry as { key?: unknown; value?: unknown };
      return typeof key === 'string' && key.toLowerCase() === 'regulatory_class' && typeof value === 'string' && value.trim()
        ? [value.trim()]
        : [];
    });
  }
  const value = metadata.regulatory_class;
  return typeof value === 'string' && value.trim() ? [value.trim()] : [];
}

/**
 * The type a person reads on screen: the Inspector, the sequence track and the
 * map's titles. A `regulatory` feature with one /regulatory_class names it,
 * "regulatory (minus_10_signal)", because `regulatory` alone does not say what
 * the element is. A class the reader maps to another type ("promoter", kept
 * after a retype to `regulatory`) is not named: Basic GenBank writes "other"
 * in its place. Exports keep featureTypeLabel, which writes the bare type.
 */
export function featureTypeDisplay(feature: Pick<Feature, 'type' | 'metadata'>): string {
  const label = featureTypeLabel(feature);
  if (feature.type !== 'regulatory') return label;
  const classes = regulatoryClasses(feature.metadata);
  return classes.length === 1 && !regulatoryClassFeatureType(classes[0]) ? `${label} (${classes[0]})` : label;
}
