# Support

Start with the repository README and the guide for the host you are using:

- [Codex quickstart](docs/CODEX_QUICKSTART.md)
- [Claude Science quickstart](docs/CLAUDE_SCIENCE_QUICKSTART.md)
- [Claude Science troubleshooting](docs/CLAUDE_SCIENCE_TROUBLESHOOTING.md)

The Codex distribution also includes a self-contained README and doctor.

Before opening an issue, run the relevant checks from a clean checkout or
installed plugin:

```bash
npm run codex:doctor:installed
npm run claude-science:check-local
npm run claude-science:doctor
```

You do not need every host installed. Report which checks you ran and which
ones were not applicable.

For a reproducible public issue, include:

- Motif version or commit;
- operating system, Node.js, host, and Motif versions;
- whether the expected Motif tools appear;
- the failing step and exact public-safe error text; and
- whether a live workbench appeared or the portable HTML fallback was used.

Do not attach sequence payloads, workspace exports, connector configuration,
credentials, private paths, or unredacted logs. Reproduce with a small public
or synthetic record. A successful tool result confirms server delivery, not
that a particular host mounted a visible frame. The portable HTML workbench is
the supported visual fallback.

Security reports belong in GitHub's private vulnerability reporting flow, not
in a public support issue. See [SECURITY.md](SECURITY.md).
