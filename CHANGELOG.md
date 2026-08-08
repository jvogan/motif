# Changelog

## Unreleased

## 0.3.1 — 2026-08-08

- Corrected restriction-digest geometry at linear boundaries, represented
  strand-specific nicking separately from double-strand cleavage, and added
  explicit methylation assumptions and physically coherent fragment checks.
- Strengthened Golden Gate, GoldenBraid, and Gibson planning with
  enzyme-derived Type IIS flanks, preparation-error reporting,
  feature-aware domestication, empirical overhang-fidelity provenance, and
  origin-spanning annotation remapping.
- Improved translation and ORF correctness for IUPAC nucleotide input,
  deterministic ambiguous codons, alternative start codons, strict genetic
  code resolution, and supported `transl_except` annotations.
- Preserved source meaning across FASTA, GenBank, MCP, PCR, primer, MSA, and
  mutation workflows by rejecting lossy normalization, retaining repeated
  qualifiers, quarantining unsupported locations, and reporting incomplete
  or conditional results explicitly.
- Refined responsive primer actions, assembly tabs, scientific-status
  explanations, long provenance display, translation tracks, and Notes pane
  state across mouse, keyboard, narrow, and floating layouts.
- Cleared current dependency advisories and added fail-closed dependency
  policy, reviewed lifecycle execution, release reproducibility and size
  checks, SBOM generation, and a checksum-verified no-npm end-user installer.

## 0.3.0 — 2026-07-29

- Updated runtime and build dependencies to clear current npm advisories,
  kept both Playwright packages aligned, and retained Node 22 as the supported
  type-definition baseline.
- Preserved range-note and pinned-translation anchors across sequence edits,
  separated session hydration from durable checkpoints, and made browser
  download receipts honest about unverified saves.
- Added full inert report/table readers, sortable BLAST evidence, bounded
  result and asset pagination, and safe copy/download actions in the Results
  Workbench.
- Expanded MSA correctness, accessibility, search, navigation, statistics,
  image export, and real-browser coverage.
- Added state-preserving floating workspace panes and hardened pane placement,
  resizing, focus, and restriction-label geometry.
- Added record-level and feature-level NCBI genetic-code selection across
  translation, ORF discovery, pinned amino-acid tracks, GenBank interchange,
  and derived-protein provenance. Unsupported explicit feature codes now fail
  closed, reviewed pinned tracks cannot materialize stale proteins, and complete
  CDS translations honor alternative initiators.
- Reconciled the built-in genetic-code registry with current NCBI definitions,
  including Standard-code initiators and representable tables 15 and 32.
- Made discontinuous feature locations authoritative across inspection,
  translation, exports, maps, mutation, PCR, digestion, Gibson assembly, and
  Golden Gate assembly instead of silently using their coordinate envelopes.
- Preserved joined, ordered, reverse, origin-spanning, mixed-strand, and fuzzy
  INSDC locations in Basic GenBank and emitted one GFF3 row per feature piece.
- Quarantined unmarked reverse multipart checkpoints from sequence-derived
  actions when their legacy text order cannot be distinguished safely from
  biological order; conservative interchange marks them non-materializable,
  while new and imported locations carry an explicit order marker.
- Added public-safe FASTA, CLUSTAL, and workspace JSON examples, clarified ZIP
  recovery, and aligned public installation and validation guidance.

## 0.2.1 — 2026-07-13

- Added the Motif-owned Claude Science local connector, setup doctor, and
  connector-created interactive HTML workbench.
- Documented the exact folder grant, full relaunch, reconnect, and reliable
  click-to-open workflow for current Claude Science builds.
- Added bounded record identity summaries, deterministic plugin packaging,
  complete bundled dependency license notices, and public support guidance.
- Preserved the full Motif workbench across embedded, wide, narrow, light, and
  dark layouts.

## 0.2.0 — 2026-07-13

- Added the full-workbench MCP App declaration, FASTA/GenBank input contracts,
  and portable HTML fallback.
- Kept the Motif identity visible across embedded frame sizes.

## 0.1.0 — 2026-07-13

- Introduced the standalone Motif molecular-biology workbench and Claude
  plugin, including sequence/map review, MSA, Sanger traces, cloning design,
  notes, typed results, and explicit checkpoint exports.
