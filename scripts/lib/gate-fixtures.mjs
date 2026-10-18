export const GATE_FIXTURE_SCHEMA = 'motif.gate-fixtures.v1';
// A required fixture must be observed executing and passing in every gate run.
// An optional fixture depends on non-vendored data; it may skip, and it may be
// reported as not applicable when its spec file is absent.
export const GATE_FIXTURES = Object.freeze([
  {
    id: 'synthetic-sanger', name: 'synthetic Sanger plate intake',
    file: 'e2e/claude-science-synthetic-sanger.spec.ts',
    title: 'directly imports and selects a synthetic AB1 plate from the MSA file picker',
    required: true,
  },
  {
    id: 'real-sanger', name: 'real Sanger fixture audit',
    file: 'e2e/claude-science-real-sanger.spec.ts',
    title: 'directly imports and selects a real AB1 plate from the MSA file picker',
    optional: true,
  },
  {
    id: 'external-msa', name: 'external MSA payload audit',
    file: 'e2e/claude-science-real-sanger.spec.ts',
    title: 'imports a plate, links three external alignments, and reviews reverse traces',
    optional: true,
  },
]);

/** Fixtures are required unless explicitly marked optional; both markers together are a declaration error. */
export function isOptionalFixture(definition) {
  if (definition.optional === true && definition.required === true) {
    throw new Error(`Gate fixture ${definition.id} cannot be both required and optional`);
  }
  return definition.optional === true;
}
