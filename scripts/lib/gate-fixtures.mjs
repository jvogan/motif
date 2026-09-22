export const GATE_FIXTURE_SCHEMA = 'motif.gate-fixtures.v1';
export const GATE_FIXTURES = Object.freeze([
  {
    id: 'real-sanger', name: 'real Sanger fixture audit',
    file: 'e2e/claude-science-real-sanger.spec.ts',
    title: 'directly imports and selects a real AB1 plate from the MSA file picker',
  },
  {
    id: 'external-msa', name: 'external MSA payload audit',
    file: 'e2e/claude-science-real-sanger.spec.ts',
    title: 'imports a plate, links three external alignments, and reviews reverse traces',
  },
]);
