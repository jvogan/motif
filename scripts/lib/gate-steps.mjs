export const GATE_STEPS = Object.freeze([
  { id: 'typecheck', label: 'Typecheck', command: ['npm', 'run', 'typecheck'] },
  { id: 'lint', label: 'Lint', command: ['npm', 'run', 'lint'] },
  { id: 'repository-language', label: 'Repository language policy', command: ['npm', 'run', 'check:repository-language'] },
  { id: 'unit-tests', label: 'Unit tests', command: ['npm', 'test'] },
  { id: 'release-alignment', label: 'Release alignment', command: ['npm', 'run', 'check:release-alignment'] },
  { id: 'runtime-compatibility', label: 'Runtime compatibility', command: ['npm', 'run', 'check:runtime-compatibility'] },
  { id: 'security-audit', label: 'Security audit', command: ['npm', 'run', 'security:audit'] },
  { id: 'supply-chain-policy', label: 'Supply-chain policy', command: ['npm', 'run', 'security:policy'] },
  { id: 'reviewed-lifecycle', label: 'Motif-owned dependency preparation', command: ['npm', 'run', 'security:lifecycle'] },
  { id: 'dependency-cooling-off', label: 'Dependency cooling-off policy', command: ['npm', 'run', 'security:cooling-off'] },
  { id: 'plugin-checks', label: 'Plugin checks', command: ['npm', 'run', 'test:plugin'] },
  { id: 'connector-checks', label: 'Connector checks', command: ['npm', 'run', 'test:connector'] },
  { id: 'css-token-checks', label: 'CSS token checks', command: ['npm', 'run', 'check:css-tokens'] },
  { id: 'aria-controls', label: 'ARIA control checks', command: ['npm', 'run', 'check:aria-controls'] },
  { id: 'build', label: 'Build distributables', command: ['npm', 'run', 'build:motif'] },
  { id: 'codex-plugin-checks', label: 'Codex plugin checks', command: ['npm', 'run', 'test:codex-plugin'] },
  { id: 'post-build-release-verification', label: 'Post-build release verification', command: ['npm', 'run', 'security:verify-release'] },
  { id: 'reproducibility', label: 'Reproducible release build', command: ['npm', 'run', 'security:reproducibility'] },
  { id: 'release-budgets', label: 'Release budgets', command: ['npm', 'run', 'security:budgets'] },
  { id: 'core-browser-workflows', label: 'Core browser workflows', command: ['npm', 'run', 'test:e2e'] },
  { id: 'msa-browser-workflows', label: 'MSA interaction workflows', command: ['npm', 'run', 'test:e2e:msa'] },
]);

export const GATE_RECEIPT_SCHEMA = 'motif.gate-step.v1';
export const GATE_RUN_SCHEMA = 'motif.gate-run.v1';
