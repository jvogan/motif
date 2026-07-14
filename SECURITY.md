# Security policy

## Reporting a vulnerability

Please use the repository's
[GitHub private vulnerability reporting form](https://github.com/jvogan/motif/security/advisories/new).
Do not open a public issue for a suspected security problem or include sensitive
details in any public discussion.

Never include unpublished or sensitive sequence data, credentials, local MCP
configuration, full filesystem paths, or Claude Science workspace exports in a
report. Use a minimal synthetic sequence when a reproduction needs biological
input.

## Supported versions

Security fixes target the latest tagged Motif release. Older artifacts are
immutable snapshots and should be regenerated after updating Motif.

## Data boundary

Motif has no hosted backend and the local connector does not intentionally
upload sequence data. Content supplied to Claude Science remains subject to
the user's Claude and organization data policies. Database JSON, workspace ZIP,
and generated HTML files are ordinary unencrypted files; protect them according
to the sensitivity of their contents.
