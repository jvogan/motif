# Support

Start with the [Claude Science quickstart](docs/CLAUDE_SCIENCE_QUICKSTART.md)
and [troubleshooting guide](docs/CLAUDE_SCIENCE_TROUBLESHOOTING.md).

Before opening an issue, run:

```bash
npm run claude-science:check-local
npm run claude-science:doctor
```

For a reproducible public issue, include:

- Motif version or commit;
- macOS, Node.js, and Claude Science versions;
- whether both `motif-local` tools appear;
- the failing step and exact public-safe error text; and
- whether the connector-created HTML workbench opens in the right pane.

Do not attach sequence payloads, workspace exports, connector configuration,
credentials, private paths, or unredacted logs. Reproduce with a small public
or synthetic record. A successful tool result without an automatically mounted
live frame may be a Claude Science host limitation; the connector-created HTML
workbench is the supported visual fallback.

Security reports belong in GitHub's private vulnerability reporting flow, not
in a public support issue. See [SECURITY.md](SECURITY.md).
