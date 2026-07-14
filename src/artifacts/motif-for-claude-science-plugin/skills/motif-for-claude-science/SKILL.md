---
name: motif-for-claude-science
description: Creates a self-contained Motif for Claude Science workbench, optionally preloaded with records, alignments, traces, and typed results.
---

# Motif for Claude Science

Open the connected Motif workbench when its MCP tools are available, or create
a user-owned self-contained HTML workbench from the bundled resource.

## Connected Claude Science path

When `motif_open_workbench` is available, prefer it for interactive review of
one bounded Motif payload or exact FASTA, GenBank, raw-sequence, or Motif JSON
content. Pass either `payload` or `content`, never both. Include `filename`
when it carries a useful format/provenance hint and include an explicit
`molecule` for ambiguous raw sequence text.

Verify the returned `motif.mcp.workbench.v1` schema, mode, source name, record
count, and residue count against the intended input. A successful tool call
does not prove a frame mounted: confirm the visible Motif identity and exact
records in the rendered UI. Current Claude Science local/custom connector
builds may not register Motif as an artifact viewer. Use the viewer chooser
only when Motif is actually listed. The host message
`Sequence viewer unavailable—showing as text` is a generic fallback, not a
Motif parse error.

If the host does not mount MCP Apps, call
`motif_create_workbench_artifact` with the same bounded input. It returns a
self-contained HTML resource plus filename, byte count, and SHA-256 metadata;
it does not write a file. Preserve the exact returned HTML, save it, and click
or open it in Claude Science's right pane. Verify the visible workbench. It is
interactive, but it is an immutable snapshot rather than a live MCP App.

These connector tools are ephemeral viewer/export operations. They do not
write a sequence database, run external executables, or make AB1 binary data a
text artifact.

## Runtime boundary

The artifact's `window.motif*` functions exist only inside the loaded page's
JavaScript context. Do not claim to have called them from Cowork or Claude Code
unless the current session has a verified browser bridge. The bundled MCP App
uses a narrow workspace adapter; it does not expose those globals as general
model tools.

Without the connector or another verified bridge, the proven path is:

1. Generate an HTML file with the bundled helper.
2. Ask the user to open it in a browser.
3. Let the user interact through the visible Inventory, Sequence, Map, and
   Tools controls.

The HTML cannot launch native executables. It includes a bounded in-browser
star-alignment preview, but MAFFT, MUSCLE, and Clustal Omega run outside the
artifact through the bundled `run-msa.mjs` helper or another verified local
runner. Preserve the real engine/version/parameters and preload or visibly
import their aligned output; never imply that the HTML executed those tools.

## Run an external alignment

If the user has already selected records in the visible workbench, direct them
to **Alignment → Edit inputs → Download FASTA** for a unique-header unaligned
input file. The bundled runner accepts explicit `dna` or `protein` inputs; do
not relabel RNA as DNA. RNA may be aligned directly with the requested engine
and then visibly imported with its actual provenance.

When the session is authorized to execute local commands and a requested
engine is installed, prefer the bundled runner over an ad hoc shell command.
It uses argument-array process spawning without a shell, never substitutes a
different engine, and rejects missing, timed-out, reordered-without-identities,
non-rectangular, mutated, or over-limit output.

```bash
node "${CLAUDE_SKILL_DIR}/scripts/run-msa.mjs" \
  --engine mafft \
  --molecule dna \
  --in ./unaligned.fasta \
  --out ./alignment-payload.json

node "${CLAUDE_SKILL_DIR}/scripts/create-artifact.mjs" \
  --payload ./alignment-payload.json \
  --out ./motif-artifact.html
```

Or pipe the validated payload directly into artifact generation:

```bash
node "${CLAUDE_SKILL_DIR}/scripts/run-msa.mjs" \
  --engine clustal-omega --molecule protein --in ./proteins.fasta --out - \
| node "${CLAUDE_SKILL_DIR}/scripts/create-artifact.mjs" \
  --payload - --out ./motif-artifact.html
```

Supported engine IDs are `mafft`, `muscle`, and `clustal-omega`. Discovery is
explicit and ordered: `--executable`; `MOTIF_MSA_MAFFT_PATH` /
`MOTIF_MSA_MUSCLE_PATH` / `MOTIF_MSA_CLUSTAL_OMEGA_PATH` or the generic
`MOTIF_MSA_EXECUTABLE`; `MOTIF_MSA_TOOLS_DIR`; the standard
`~/.claude-science/conda/envs/msa-tools/bin` environment; then `PATH`. An
invalid explicitly configured executable is an error, not permission to try a
different engine or the browser preview.

On Windows, configure a native executable (`.exe`/`.com`). The runner does not
launch `.bat` or `.cmd` wrappers because doing so requires a command shell and
would weaken the no-shell execution boundary.

Input must be unaligned FASTA with 2–100 case-insensitively unique headers and
an explicit `dna` or `protein` molecule type. Each input sequence is limited to
50,000 symbols (the artifact column ceiling), all input to 2,000,000 symbols,
and output to 2,000,000
row-columns. The default process timeout is 120 seconds. The payload restores
original headers after tool-safe ID mapping and records the executable basename
and hash, discovery-source label, version, portable argv, per-row input hashes,
tool-input/raw-output/stderr hashes, and `usedFallback: false`. It does not
store the local executable/temp paths or raw stdout/stderr text.

## Generate an artifact

Choose an explicit output path in a folder the user has authorized. The helper
refuses to overwrite an existing file unless `--force` is supplied.

Create the sample workbench without changing its bundled inventory:

```bash
node "${CLAUDE_SKILL_DIR}/scripts/create-artifact.mjs" \
  --out ./motif-artifact.html
```

To preload records and/or alignments, first write a JSON payload, then pass it
to the helper:

```bash
node "${CLAUDE_SKILL_DIR}/scripts/create-artifact.mjs" \
  --payload ./motif-inventory.json \
  --out ./motif-artifact.html
```

Use `--force` only when the user explicitly wants to replace the output file.
After generation, verify that the helper reported the output path and SHA-256.

## Payload shape

Preserve user-supplied sequences exactly except for removing formatting
whitespace when required. Do not invent sequence data or silently reinterpret
coordinates.

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
          "direction": "forward"
        }
      ]
    }
  ],
  "alignments": [
    {
      "id": "example-homologs",
      "name": "Example homologs",
      "molecule": "dna",
      "engine": {
        "id": "mafft",
        "label": "MAFFT",
        "version": "7.526",
        "mode": "local-command",
        "parameters": ["--auto"]
      },
      "rows": [
        {
          "id": "reference",
          "name": "Reference",
          "aligned": "ATGGCCGCCGCC"
        },
        {
          "id": "variant",
          "name": "Variant",
          "aligned": "ATGGCCG-CGCC"
        }
      ]
    }
  ]
}
```

Accepted record aliases include `seq` for `sequence`, `molecule` for `type`,
and `annotations` for `features`. Group aliases include `project`, `folder`,
and `collection`. Feature coordinates are zero-indexed: `start` is inclusive
and `end` is exclusive.

Alignment payloads accept either one top-level `alignment` object or an
`alignments` array. Each alignment accepts `rows` (alias: `sequences`) with
`aligned` (alias: `sequence`), or an `alignedFasta` string. Rows must already
be gapped, have equal non-zero lengths, and use one explicitly declared
`molecule`/`type` alphabet; symbols alone cannot reliably distinguish every
nucleotide sequence from protein. `.` gap
characters are accepted and normalized to `-` by the artifact. Engine `mode`
is `browser`, `local-command`, or `imported`; use `local-command` only for an
alignment actually produced by an external executable.

## Typed analysis results

Use top-level `analysisResults` and `analysisAssets` when Claude has computed
evidence that should remain visible beside the sequences. Supported result
kinds are `primer_design`, `pcr`, `assembly_plan`, `blast_search`,
`structure_model`, `report`, and `table`. Results require stable ids, ISO
timestamps, explicit provenance, input record ids, dependency ids, asset ids,
parameters, and kind-specific `data`. Any referenced record id must match an
explicit record id in the same workspace.

Assets are UTF-8 data, never executable content. Accepted media types are
`application/json`, `text/plain`, `text/markdown`, `text/csv`,
`text/tab-separated-values`, `text/x-fasta`, `chemical/x-pdb`,
`chemical/x-cif`, and `chemical/x-mmcif`. Do not use active HTML/SVG media
types, data URLs, or binary/base64 blobs. Literal markup inside an allowed text
asset or report is stored, exported, and displayed as inert text; it is not
executed. The workbench verifies all cross-references before mutating the
session. When a kind-specific field references an asset, also list that id in
the result's top-level `assetIds` so the Results panel exposes it as an
attachment.

A minimal report result looks like this:

```json
{
  "records": [
    {
      "id": "construct-1",
      "name": "Construct 1",
      "type": "dna",
      "topology": "linear",
      "sequence": "ATGGCCGCCGCC"
    }
  ],
  "analysisResults": [
    {
      "id": "report-1",
      "kind": "report",
      "name": "Construct review",
      "status": "complete",
      "summary": "No unsupported junctions were found.",
      "inputRecordIds": ["construct-1"],
      "dependsOnResultIds": [],
      "assetIds": [],
      "parameters": {},
      "data": { "format": "markdown", "body": "## Review\n\nReady for inspection." },
      "createdAt": "2026-07-12T20:00:00.000Z",
      "provenance": {
        "source": "claude-science",
        "operation": "construct_review",
        "actor": "Claude"
      }
    }
  ]
}
```

With a real browser bridge, append assets first with
`window.motifAddAnalysisAssets(assetOrAssets)`, then append results with
`window.motifAddAnalysisResults(resultOrResults)`. Confirm with
`window.motifGetAnalysisWorkspace()` and use
`window.motifRemoveAnalysisResults(resultIdOrIds)` for explicit removal. These
calls are synchronous, transactional, and open the visible Results tool after
successful result insertion. Without a browser bridge, preload the same fields
through `create-artifact.mjs`; never claim a page global was called.

The artifact is a portable workspace rather than a secure growing database.
Database JSON and ZIP preserve analysis results and assets across reloads, but
they are ordinary user-owned files and are not encrypted vaults. For a shared
or long-lived sequence library, use an independently reviewed durable storage
system with transactional writes, access controls, and tested backups instead
of treating the standalone HTML as the system of record. This plugin does not
include a native connector or durable database.

## Review Sanger sequencing results

The generated workbench accepts Applied Biosystems `.ab1` and `.abi` files in
**Add Entry → Choose files** and by file drop. AB1 is binary, so never read it
as UTF-8 or paste its bytes into the sequence field. Let the workbench's
bounded ABIF parser read the base calls, Phred quality, called-peak positions,
four dye channels, and safe source metadata.

Files can also go straight into **Tools → Alignment → Workspace records**:
drop or choose multiple FASTA, GenBank, AB1/ABI, or raw-text sequence files and
the imported records are selected for alignment. **Aligned file** has a
separate one-file drop target/picker for pre-aligned FASTA or CLUSTAL.

To compare a read with a reference:

1. Import the reference record and one or more AB1 reads into the same group.
2. Open **Tools → Alignment**, select the template and reads, and run the
   bounded local preview. Choose the intended template and leave **Auto-orient
   AB1 reads** on unless strand is already normalized. Or run a verified
   external aligner and preload its payload when that is scientifically
   preferable; native aligners do not infer strand, so reverse-complement known
   reverse-primer reads before supplying their FASTA.
3. Choose the correct **Template** row, then open **Traces**. Inspect mismatch
   navigation, quality, forward/reverse orientation, and the chromatogram.
4. Export Database JSON or ZIP before closing to preserve channels and quality.

The viewer reads calls already stored by the instrument; it is not a basecaller
and does not infer missing channels. Missing optional quality/peak/channel
streams and ignorable optional metadata defects are reported as import
warnings. Malformed or out-of-bounds declared base-call, quality, peak, or
channel payloads fail closed. Template-relative identity, mismatch counts,
overview, and difference navigation exclude uncovered leading/trailing padding
while still counting gaps and substitutions within the overlap. Editing a
called sequence detaches its original trace, because the electropherogram no
longer represents the edited calls; Undo restores the link. FASTA, basic
GenBank/GFF3, CSV, and plain reports do not preserve chromatogram signal.

The helper accepts at most 50 alignments, 100 rows and 50,000 columns per
alignment, 2,000,000 row-columns per alignment, and 4,000,000 row-columns in
the payload. Validation is transactional: an invalid payload is rejected
before an output artifact is written.

## Alignment runtime APIs

With a real browser bridge, call
`window.motifAddAlignments(alignmentOrAlignments)` to validate and append one or
more precomputed alignments, then confirm with `window.motifGetAlignments()`.
These calls are synchronous and round-trippable. Without a browser bridge,
put the same shape in the generation payload instead; do not claim the page
globals were called.

## After generation

- Tell the user where the HTML was written.
- State that the file is self-contained and opens locally in a modern browser.
- Do not report browser-side mutations or successful UI interaction unless the
  session actually opened the file and verified those rendered results.
- For external MSA output, report which executable/version actually ran and
  whether its result was preloaded at generation time or imported by the user.
  Do not report success unless `run-msa.mjs` completed and its payload passed
  artifact validation.
- If the user later changes the inventory in the UI, tell them that records are
  session-only until exported. Database JSON and ZIP retain the complete
  artifact record; FASTA, basic GenBank/GFF3, CSV, and reports are also
  available for interchange.
- For Sanger review, report that AB1 calls were imported and visually checked;
  do not claim the artifact re-base-called the raw electropherogram. State
  whether the read was aligned forward or reverse to the selected template.
