# Motif for Claude Science plugin

Motif for Claude Science is a portable molecular-biology workbench packaged as
a self-contained HTML file and a Claude plugin. It supports annotated DNA, RNA,
and protein records; sequence and map inspection; restriction analysis;
multiple-sequence alignment; Sanger trace review; cloning and primer-design
workspaces; notes; and typed analysis results.

## Build outputs

From the repository root:

```bash
npm run build:motif
```

The deterministic build writes only to `dist-motif/`:

- `motif-template.html` — the self-contained template before payload injection
- `motif-artifact.html` — the ready-to-open standalone workbench
- `motif-for-claude-science/` — the unpacked Claude plugin
- `motif-for-claude-science.zip` — the uploadable plugin archive
- `motif-for-claude-science.checksums.json` — archive and file SHA-256 values
- `motif-for-claude-science-skill/SKILL.md` — standalone compatibility skill

The archive has `.claude-plugin/` at its root. For a session-only Claude Code
review, load either the archive or unpacked directory:

```bash
claude --plugin-dir ./dist-motif/motif-for-claude-science.zip
claude --plugin-dir ./dist-motif/motif-for-claude-science
```

The skill is namespaced as
`/motif-for-claude-science:motif-for-claude-science`.

## Generate a preloaded workbench

The bundled helper validates a JSON payload before replacing the embedded data
slot. It accepts a path or standard input and refuses to overwrite an existing
output unless `--force` is explicit.

```bash
node ./skills/motif-for-claude-science/scripts/create-artifact.mjs \
  --payload ./inventory.json \
  --out ./motif-artifact.html
```

The top-level payload schema is `motif.claude-science.inventory.v1`. Payloads
may include records, alignments, Sanger traces attached to records, notes,
workflow history, typed analysis results, and inert text/JSON assets. HTML,
SVG, binary assets, malformed references, and over-limit data are rejected.

## External MSA runner

`scripts/run-msa.mjs` runs MAFFT, MUSCLE, or Clustal Omega outside the browser
and produces a validated Motif payload. The runner:

- spawns an argument array without a command shell;
- runs exactly the requested engine and never silently falls back;
- resolves an explicit executable, a Motif environment variable, the standard
  Claude Science `msa-tools` environment, or `PATH` in a documented order;
- maps output by generated safe FASTA IDs rather than row position;
- verifies that each ungapped output row equals its input; and
- records engine version, portable argv, executable and data hashes, discovery
  source, and `usedFallback: false` without leaking temporary paths or raw logs.

```bash
node ./skills/motif-for-claude-science/scripts/run-msa.mjs \
  --engine muscle --molecule dna --in ./unaligned.fasta \
  --out ./alignment-payload.json

node ./skills/motif-for-claude-science/scripts/create-artifact.mjs \
  --payload ./alignment-payload.json --out ./motif-artifact.html
```

Supported environment variables are `MOTIF_MSA_MAFFT_PATH`,
`MOTIF_MSA_MUSCLE_PATH`, `MOTIF_MSA_CLUSTAL_OMEGA_PATH`,
`MOTIF_MSA_EXECUTABLE`, and `MOTIF_MSA_TOOLS_DIR`. Invalid explicit
configuration is an error. Windows batch wrappers are intentionally excluded
because they require a shell.

The HTML itself cannot start native executables. Its bounded local alignment
preview is labeled as a Motif browser preview and must never be represented as
MAFFT, MUSCLE, or Clustal Omega.

## Sanger data

The workbench imports Applied Biosystems `.ab1` and `.abi` files through Add
Entry or drag and drop. It retains called bases, Phred quality values, peak
positions, four dye channels, and allowlisted run metadata already stored in
ABIF. It does not claim to re-base-call raw signal. The Alignment workspace can
auto-orient likely reverse-primer reads for its bounded preview and display a
scrollable chromatogram with mismatch navigation.

Database JSON and workspace ZIP preserve the trace. FASTA and basic
GenBank/GFF3 exports are intentionally lossy because those formats cannot carry
an electropherogram.

## Runtime and persistence boundaries

The HTML exposes bounded `window.motif*` functions inside its own page. A
plugin installation does not make those globals callable by Claude. An agent
may use them only through a verified browser bridge and must confirm the visible
result. `window.motifHelp()` is the runtime source of truth for current
functions, schemas, limits, and examples.

Edits are session-owned until exported. Database JSON and workspace ZIP are
the complete checkpoint/restore boundary. The portable HTML is not an
encrypted vault, a compliance system, or a durable shared database.

This plugin does not include a Motif MCP connector or claim that an older
connector has been rebranded. Native Claude Science live-frame integration is
a separate, pending workstream and is intentionally outside this bundle.

## Validate

```bash
npm run typecheck
npm test
npm run test:plugin
npm run test:e2e
npm run validate:plugin
```

The last command requires the Claude CLI. Preserve `LICENSE`,
`THIRD_PARTY_NOTICES.md`, and record-level reference provenance when
redistributing the bundle.
