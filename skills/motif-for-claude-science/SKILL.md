---
name: motif-for-claude-science
description: Opens bounded sequence data in the connected Motif workbench or creates a self-contained Motif HTML artifact for visual review.
---

# Motif for Claude Science

Use the Motif connector for interactive molecular-biology review when its tools
are available.

## Open a connected workbench

Call `motif_open_workbench` with exactly one of:

- `payload`: a bounded Motif inventory/workspace object; or
- `content`: exact FASTA, GenBank, raw sequence, or Motif JSON text.

Include `filename` when it provides a useful format and provenance hint. For
ambiguous raw sequence, include `molecule` (`dna`, `rna`, or `protein`). Do not
send binary AB1/ABI content through this text tool.

Verify the returned `motif.mcp.workbench.v1` schema, source name, record count,
and residue count. A successful call is not proof that the host mounted the
App: confirm the visible Motif identity and intended sequence in the frame.
Current Claude Science local/custom connector builds may not register Motif as
an artifact viewer. Use the viewer chooser only when Motif is actually listed;
`Sequence viewer unavailable—showing as text` is a generic host fallback, not
a Motif parse error.

## Create the portable fallback

If the host does not mount MCP Apps, call
`motif_create_workbench_artifact` with the same input. It returns an embedded,
self-contained HTML resource and `motif.mcp.artifact-export.v1` metadata with a
safe filename, byte count, and SHA-256. It does not write a file; save or open
the exact resource through the host and verify it visually. The opened
workbench is interactive, but it is an immutable snapshot rather than a live
MCP App.

## Safety boundary

These tools validate and render data in an ephemeral workbench. They do not
write a durable library, run external analysis software, expose a shell, or
grant generic DOM/filesystem access. Database JSON and workspace ZIP created
inside Motif are ordinary unencrypted user-owned checkpoints.
