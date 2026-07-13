# Changelog

## 0.2.1 — 2026-07-13

- Documented the exact read-only Claude Science sandbox grant and full relaunch
  required when macOS denies the local Motif launcher.
- Added a Motif-only troubleshooting and acceptance guide, including reconnect,
  live-App, immutable-artifact, and data-safety boundaries, and bundled the
  public support docs in the standalone plugin archive.
- Included bounded record names and IDs in connector summaries so agents can
  verify the intended records without guessing.
- Aligned setup and launcher checks on Node.js 22.12 or newer.

## 0.2.0 — 2026-07-13

- Added a Motif-owned MCP connector and full-workbench MCP App for Claude
  Science, with explicit FASTA/GenBank viewer bindings and a portable HTML
  fallback.
- Kept the Motif identity visible inside wide, embedded, and phone-sized
  frames, while preserving the restrained workbench styling.
- Added local connector setup, doctor, and packaging checks without replacing
  unrelated connectors or claiming durable database storage.

## 0.1.0 — 2026-07-13

- Introduced Motif for Claude Science as a clean standalone molecular-biology
  workbench and Claude plugin.
- Included portable sequence inventory, annotated sequence and map views,
  restriction analysis, cloning and primer-design workspaces, qualitative gel
  review, notes, typed analysis results, and explicit checkpoint exports.
- Included bounded MSA and Sanger-trace review, plus a dependency-free,
  no-shell helper for MAFFT, MUSCLE, or Clustal Omega with hashed provenance.
- Established Motif-owned schemas, browser APIs, environment variables, and
  deterministic package names across every packaged surface.
