# Public synthetic examples

Every file in this directory is synthetic and public-safe. These examples are
for installation checks, documentation, and automated verification only. They
are not authoritative biological references and must not be used for
experimental design.

| File | Purpose | Expected identity |
| --- | --- | --- |
| `motif-demo.gb` | GenBank import and first connector-created workbench | `MOTIFDEMO`, linear DNA, 180 bp, two features |
| `synthetic-proteins.fasta` | Multi-record FASTA intake and browser MSA | Three synthetic protein records; lengths 60, 60, and 59 aa |
| `synthetic-proteins.aln` | Aligned CLUSTAL import and review | Three rows, 60 alignment columns, one gap |
| `synthetic-alignment-workspace.json` | Database JSON restore, notes, alignment, provenance, and inert report review | Three records, one alignment, one note, one report, one text asset |

## GenBank installation check

Expected identity:

| Field | Value |
| --- | --- |
| Filename | `motif-demo.gb` |
| Record | `MOTIFDEMO` |
| Molecule | DNA |
| Topology | linear |
| Length | 180 bp |
| Features | `source` 1–180; `demo_cds` 1–180 |

Use the exact prompt in
[First success in Claude Science](../README.md#first-success-in-claude-science)
and verify these values during the installation check.

## FASTA and aligned CLUSTAL checks

Run the standalone preview, open **Add Entry**, and import
`synthetic-proteins.fasta`. Confirm that all three records are proteins, then
open the Alignment workspace and run the bounded browser preview.

Import `synthetic-proteins.aln` through **Aligned file** to review the supplied
alignment without claiming that Motif ran an external aligner. Confirm three
rows, 60 columns, and one visible gap in `synthetic_protein_c`.

## Complete workspace check

Restore `synthetic-alignment-workspace.json` from **Settings → Data & recovery →
Restore Database JSON**. Confirm the three records, the saved alignment, the
workspace note, and the inert report in Results.

To create a preloaded standalone artifact from the same validated payload:

```bash
npm run build:motif -- \
  --payload ./examples/synthetic-alignment-workspace.json \
  --out ./preview/synthetic-alignment-workspace.html
```

For a restriction, primer, or PCR smoke test, use `motif-demo.gb` and inspect
the computed inputs and outputs before saving a result. No AB1 file is bundled:
chromatogram examples should use a public or synthetic trace with documented
redistribution rights.
