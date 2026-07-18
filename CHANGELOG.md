# Changelog

## Unreleased

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
