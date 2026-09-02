---
name: motif
description: Create and open a local Motif HTML workbench when the user supplies exact DNA, RNA, protein, FASTA, GenBank, or Motif JSON. Do not use for database retrieval, unspecified sequences, software or musical sequences, remote analysis, or experimental and medical conclusions.
---

# Motif

Create a self-contained Motif HTML workbench from exact biological records the
user supplied. This edition runs locally through the bundled helper and does
not need an account, connector, or hosted service.

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

## Preserve the input

- Keep sequences exact apart from accepted formatting whitespace. Do not
  invent missing residues, records, annotations, coordinates, or provenance.
- Treat feature coordinates as zero-based, end-exclusive Motif coordinates.
  Convert another coordinate convention only when its source convention is
  known, and record the conversion.
- Do not retrieve an absent accession or guess which attachment the user meant.
  Ask for the exact input instead.
- Do not describe Motif's bounded browser alignment preview as MAFFT, MUSCLE,
  or Clustal Omega. Include external results only when their real engine,
  version, parameters, and aligned output are already available.
- Never claim experimental, diagnostic, or medical validation from a sequence
  display.

## Privacy and persistence

The helper performs no network requests. The generated HTML contains the
supplied sequences and annotations, so share it only when the user intends to
share that data. It is a portable editable checkpoint, not encrypted storage
or a laboratory system of record. Browser edits remain local until the user
exports and verifies a checkpoint file.
