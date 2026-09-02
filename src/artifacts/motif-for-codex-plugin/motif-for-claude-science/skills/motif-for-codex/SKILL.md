---
name: motif-for-codex
description: Use Motif for molecular-biology work with DNA, RNA, and protein records, including sequence exploration, editing, annotation, alignment, construct comparison, trace analysis, cloning design, results, and portable workbench creation.
---

# Motif workbench

The connected Motif MCP server provides two workbench tools:

- `motif_open_workbench` accepts Motif payloads or supported sequence content
  and opens the interactive MCP App workbench.
- `motif_create_workbench_artifact` returns a self-contained HTML resource for
  the same inputs. Use it when the user asks for a portable artifact or when a
  host needs an HTML resource.

Prefer `motif_open_workbench` for interactive sequence work. Confirm that the
workbench is visible after the tool succeeds. If the host cannot display it,
call `motif_create_workbench_artifact` with the same input and offer the
portable HTML resource.

Codex can find, prepare, analyze, and transform records with its available
tools, then open the records and results in Motif. When a task refers to a
record that is not available, find the requested record with the tools
available in the session or ask which source to use.

Minimal requests users can copy are:

```text
Open this sequence in Motif: >example
ATGAAATTTGGGCCCTAA
```

```text
Create a portable Motif HTML workbench artifact for: >example
ATGAAATTTGGGCCCTAA
```

After opening Motif, confirm the record names, sequence lengths, annotations,
alignments, and active view. Report any import error with the field or record
that needs correction.

Use Motif tools for workbench creation and display. Use Codex's other tools for
retrieval, file operations, analysis programs, and browser interaction.
