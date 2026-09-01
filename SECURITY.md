# Security policy

## Reporting a vulnerability

Please use the repository's
[GitHub private vulnerability reporting form](https://github.com/jvogan/motif/security/advisories/new).
Do not open a public issue for a suspected security problem or include sensitive
details in any public discussion.

Never include unpublished or sensitive sequence data, credentials, local MCP
configuration, full filesystem paths, or Motif workspace exports in a report.
Use a minimal synthetic sequence when a reproduction needs biological input.

## Supported versions

Security fixes target the latest tagged Motif release. Older artifacts are
immutable snapshots and should be regenerated after updating Motif.

## Data boundary

Motif currently has no hosted backend. Its local MCP server does not
intentionally upload sequence data, and networking is off by default. Content
supplied to Codex, Claude Science, or another host remains subject to that
host's terms, privacy policy, organization settings, and data controls.
Database JSON, workspace ZIP, generated HTML, and interchange exports are
ordinary unencrypted files; protect them according to the sensitivity of their
contents. See [PRIVACY.md](PRIVACY.md) for the complete current data boundary.
