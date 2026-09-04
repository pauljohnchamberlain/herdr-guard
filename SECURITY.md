# Security

Herdr Guard runs as the local user and is not sandboxed by Herdr. Review the
source and manifest before installing any plugin. Herdr marketplace discovery
is an index, not a security review.

The v0.1.0 boundary is intentionally narrow:

- no outbound network access;
- no shell strings, command templates, or arbitrary native argv;
- only registered read, reversible, and guarded destructive operations;
- exact target fingerprints and proposal tokens are required for mutations;
- focused targets and active agents/sessions are refused for destructive work;
- audit receipts are written before effects and contain no pane or prompt text;
- malformed configuration and audit failures fail closed.
- commands without Herdr-injected session context fail closed instead of
  selecting the focused or default session.

Report security issues privately to the repository maintainers before opening a
public issue. Do not include credentials, session output, or private paths in a
report.
