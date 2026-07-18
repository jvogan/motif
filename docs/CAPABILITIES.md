# Motif capabilities

What Motif can do today, grouped by area. Each line points at the code that
backs it, so the list stays honest.

## Sequence I/O and formats
- Import raw DNA, RNA, and protein, FASTA, GenBank, Motif JSON, and AB1/ABI.
- Export raw sequence, FASTA and multi-FASTA, basic GenBank/GFF3, CSV, JSON,
  Markdown/HTML/print reports, and a workspace ZIP.
- Source: `src/bio/fasta-parser.ts`, `src/bio/genbank-parser.ts`, `src/artifacts/motif-artifact.tsx`.

## Records and inventory
- Create, group, tag, edit, and delete annotated records with features and notes.
- Substitutions, insertions, deletions, reverse complement, and undo/redo, with
  a session workflow history.
- Source: `src/bio/mutate.ts`, `src/artifacts/claude-science-workspace-collections.ts`.

## Maps
- Topology-aware circular and linear SVG maps with features, coordinates,
  restriction sites and clusters, selections, labels, and pan/zoom.
- Source: `src/components/plasmid-map/`, `src/plasmid-map/layout.ts`.

## Restriction, digest, and gel
- Scan bundled and custom enzymes (including Type IIS), filter by source,
  predict linear and circular digests, and materialize fragment records.
- Render a qualitative agarose gel with ladders.
- Source: `src/bio/restriction-sites.ts`, `src/artifacts/claude-science-digest-workflow.ts`, `src/artifacts/claude-science-gel-preview.ts`.

## Cloning and assembly
- Gibson overlap planning, Golden Gate (kits, internal-site checks, fusion
  compatibility), GoldenBraid TU and alpha/omega workflows, and explicit
  sticky/blunt ligation, all with saveable plans and products.
- Source: `src/artifacts/claude-science-cloning-design.ts`, `src/bio/golden-gate.ts`, `src/bio/golden-braid.ts`, `src/artifacts/claude-science-assembly-workflows.ts`.

## Primer design and PCR
- Rank primer pairs by Tm, GC, length, clamp, hairpin, and self/cross-dimer
  evidence; edit 5' tails; export FASTA; simulate PCR; hand off to cloning.
- Source: `src/artifacts/ClaudeSciencePrimerWorkspace.tsx`, `src/bio/primer-design.ts`, `src/bio/primer-thermodynamics.ts`, `src/bio/pcr.ts`.

## Alignment and MSA
- Bounded in-browser star alignment, aligned FASTA/CLUSTAL import,
  consensus/conservation, identity, and mismatch navigation.
- A no-shell helper runs MAFFT, MUSCLE, or Clustal Omega outside the browser and
  records engine, version, argv, and hashes.
- Source: `src/artifacts/claude-science-msa.ts`, `src/artifacts/ClaudeScienceMsaViewer.tsx`, plugin `scripts/run-msa.mjs`.

## Sanger and AB1
- Parse instrument base calls, Phred quality, peak positions, and four dye
  channels; link traces to alignments; auto-orient reads; view chromatograms
  and mismatches. It reads existing calls and does not re-basecall.
- Source: `src/bio/abi-import.ts`, `src/artifacts/ClaudeScienceSangerTraceViewer.tsx`.

## Analysis
- ORF detection, GC and composition, Tm, molecular weight, six-frame
  translation with codon-table selection, literal motif search, and PAM-based
  CRISPR guide candidates.
- Source: `src/bio/orf-detection.ts`, `src/bio/translate.ts`, `src/artifacts/motif-artifact.tsx`.

## Provenance, results, and checkpoints
- Typed results for primer design, PCR, and assembly plans, plus storage and
  display of externally produced BLAST hits, structure models, reports, and
  tables, each with provenance, inputs, dependencies, and inert assets. Motif
  does not compute BLAST searches or structure models inside the HTML.
- Database JSON restores directly. A workspace ZIP holds the same
  `inventory.json` plus interchange exports; restore it by extracting
  `inventory.json` and loading it from Settings.
- Browser downloads are reported as requests, not verified saves. Confirm the
  Database JSON or ZIP exists and can be reopened before treating it as a
  durable checkpoint.
- Source: `src/artifacts/claude-science-analysis-results.ts`, `src/artifacts/claude-science-session.ts`.

## Claude Science connector
- A bounded full-workbench MCP App (`motif_open_workbench`) plus a fallback that
  returns a self-contained HTML artifact (`motif_create_workbench_artifact`).
- Accepts Motif payloads, FASTA, GenBank, or raw sequence. It does not write a
  database, run external executables, or expose a generic DOM/shell/filesystem
  bridge.
- Source: `mcp/motif/server.ts`, `mcp/motif/payload.ts`, `src/mcp-app/`.

## Boundaries
Motif is a design and inspection bench, not a validation service. The HTML runs
locally and cannot launch native executables. Exports are ordinary user-owned
files, not an encrypted or durable shared database. External alignment engines
run only when explicitly invoked through the bundled runner.
