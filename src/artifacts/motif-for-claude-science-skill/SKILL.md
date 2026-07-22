---
name: motif-for-claude-science-skill
description: Prepares, shares, inspects, or explains the standalone Motif for Claude Science artifact, including sequence inventories, alignments, traces, and browser review.
---

# Motif for Claude Science

Use this compatibility skill with the self-contained
`motif-artifact.html` file. New Claude/Cowork handoffs should prefer the
validated `motif-for-claude-science.zip` plugin bundle, which includes
an explicit file-generation helper.

## Interaction boundary

The supported standalone workflow is:

1. Build or receive the self-contained HTML file.
2. Open it in a modern browser.
3. Interact through its visible Inventory, Sequence, Map, and Tools controls.

The HTML defines `window.motif*` functions inside its own page. A skill does not
turn those browser globals into Cowork or Claude Code tools. Do not claim to
have called them unless the current session has a real browser bridge that can
evaluate JavaScript in the loaded page and the rendered result was verified.

When such a bridge is actually available, call `window.motifHelp()` in the page
context first. Treat that runtime manifest—not this file—as the source of truth
for current API names, schemas, restriction-source ids, examples, and return
values.

## Prepare a preloaded artifact from source

From the Motif checkout:

```bash
npm run build:claude-science -- \
  --payload ./motif-inventory.json \
  --out ./motif-artifact.html
```

The default build is repo-local and writes the standalone HTML, standalone
skill, unpacked Claude plugin, deterministic plugin ZIP, and checksum manifest
under `dist-motif/`. Use `--handoff <html-path>` only when the user explicitly
wants a copy outside the checkout.

Minimal payload:

```json
{
  "schema": "motif.claude-science.inventory.v1",
  "inventory": {
    "title": "Example inventory",
    "description": "Records prepared for review."
  },
  "records": [
    {
      "name": "Example insert",
      "type": "dna",
      "topology": "linear",
      "group": "Design queue",
      "sequence": "ATGGCCGCCGCC",
      "features": [
        {
          "name": "coding insert",
          "type": "cds",
          "start": 0,
          "end": 12,
          "direction": "forward",
          "color": "#2EAD67"
        }
      ]
    }
  ]
}
```

Accepted record aliases include `seq` for `sequence`, `molecule` for `type`,
and `annotations` for `features`. Group aliases include `project`, `folder`,
and `collection`. Nucleotide records may set `translationTableId` to a supported
NCBI genetic-code id (table 1 is the default). A CDS/ORF feature may override it
with `metadata.transl_table`; an unsupported explicit qualifier is preserved but
translation is blocked until a supported code is chosen. Feature coordinates are zero-indexed: `start` is inclusive
and `end` is exclusive. For a multipart feature, supply non-empty `subRanges` as
`[{ start, end, strand? }, ...]` in biological 5′→3′ order; those pieces are
authoritative, while the feature's `start`/`end` remain their coordinate
envelope. A piece without `strand` inherits the feature direction. Set
`metadata.motifLocationOperator` to `order` only when an INSDC multi-piece
`order(...)` location must stay non-materializable; multipart locations
otherwise behave as joins. For a manually authored reverse multipart payload,
also set `metadata.motifSubRangeOrder` to `biological`. Motif preserves an
unmarked reverse multipart checkpoint, but keeps sequence-derived actions
unavailable because older text-order and current biological-order arrays cannot
be distinguished safely without that marker.

Use `feature.color` for an explicit display color. When color is part of the
request, prefer a Motif payload over interchange text so the requested colors
reach the workbench directly. Use `misc_feature` for a named sequence motif or
chromophore codons and `restriction_site` for a cloning or restriction site.
Do not rely on editor-specific GenBank color qualifiers as the only color
source.

Opening, showing, or retrying an existing construct does not authorize a
sequence or annotation change. Reuse the exact latest payload unless the user
explicitly requests a biological edit. Preserve source accessions and
coordinate transformations, label estimated feature bounds as estimated, and
verify the final record length, topology, feature coordinates, and requested
ORFs before generating the workbench.

## Add a precomputed alignment

Add `alignment` or `alignments` beside `records`. Supply an explicit
`molecule`/`type`, equal-length gapped rows, and the engine that actually
produced them; symbols alone cannot reliably distinguish every nucleotide
sequence from protein:

```json
{
  "alignment": {
    "name": "Construct variants",
    "molecule": "dna",
    "engine": {
      "id": "mafft",
      "label": "MAFFT",
      "version": "7.526",
      "mode": "local-command"
    },
    "rows": [
      { "id": "variant-a", "name": "Variant A", "aligned": "ATGC--A" },
      { "id": "variant-b", "name": "Variant B", "aligned": "ATGCTTA" }
    ],
    "referenceRowId": "variant-a"
  }
}
```

The standalone HTML cannot spawn MAFFT, MUSCLE, or Clustal Omega. Run an
external engine only through a real local/native or agent tool, then inject its
aligned FASTA or rows with exact engine/version provenance. The visible
**Tools → Alignment** workspace can also compute an explicitly labeled,
bounded Motif local preview; do not present that preview as an external
engine result or a silent fallback.

With a verified page bridge, use `window.motifAddAlignments(...)` to append
validated alignments and `window.motifGetAlignments()` to read them. Database JSON
and ZIP preserve saved alignments; ZIP also includes aligned FASTA and CLUSTAL
files. Call `window.motifHelp()` first for current limits and the complete schema.

Preserve user-supplied sequence data exactly except for formatting whitespace.
Do not hand-edit bundled JavaScript or claim an in-page change succeeded without
observing it in the rendered artifact.

Records edited in the browser are session-only until an exported file is
verified on disk. Database JSON and ZIP preserve the complete artifact record;
GenBank and GFF3 are intentionally basic interchange exports. A browser
download request is not itself proof that a checkpoint was saved.
