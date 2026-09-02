---
name: motif
description: Use Motif to create and open interactive molecular-biology workbenches for DNA, RNA, and protein records, annotations, alignments, traces, results, and construct designs.
---

# Motif

Create a self-contained Motif workbench from records available to the task.
Codex can find, prepare, analyze, and transform data with its available tools
before adding it to the workbench.

## Create the workbench

Resolve the directory containing this `SKILL.md`, then run its helper by
absolute path. Write output only to a location the user requested or clearly
authorized.

For FASTA, GenBank, raw sequence text, or Motif JSON stored in a file:

```bash
node "<skill-directory>/scripts/create-workbench.mjs" \
  --content ./records.fasta \
  --out ./motif-workbench.html
```

For a structured Motif payload that already contains records, annotations,
alignments, notes, or results:

```bash
node "<skill-directory>/scripts/create-workbench.mjs" \
  --payload ./motif-workspace.json \
  --out ./motif-workbench.html
```

Use `--molecule dna`, `--molecule rna`, or `--molecule protein` for raw text
whose alphabet is ambiguous. Optional `--title` and `--topology` values affect
the prepared workspace. Use `--force` only when the user explicitly wants to
replace an existing file.

The helper reports the resolved output path, record and residue counts, byte
count, runtime build identity, and SHA-256 digest. Check those values against
the intended input. If an in-app browser is available, open the resulting
local HTML and verify that Motif and the expected record names are visible.
Creating the file does not by itself prove that a browser displayed it.

## Prepare the records

- Preserve sequences apart from accepted formatting whitespace unless the user
  asks for a sequence change. Record the source of derived or edited records.
- Treat feature coordinates as zero-based, end-exclusive Motif coordinates.
  Convert another coordinate convention only when its source convention is
  known, and record the conversion.
- Use the analysis tools available in the session when the task calls for an
  alignment. Add the aligned sequences, engine name, version, parameters, and
  source records to the Motif workbench.
- Preserve record IDs, annotations, provenance, and result dependencies. Check
  the reported record and residue counts against the prepared data.

## Privacy and persistence

The helper performs no network requests. The generated HTML contains its
records and annotations as an editable portable file. Browser edits remain in
the workbench until the user exports a new checkpoint.
