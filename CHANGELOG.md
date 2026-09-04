# Changelog

## [0.1.2] - 2026-09-04

- Keep uncertain native effects pending so exact reconcile can prove the
  postcondition without retrying a mutation.
- Reject unknown CLI arguments and bound target IDs before contacting Herdr.
- Add language-independent synthetic contract fixtures and deterministic fuzz
  and failure-injection coverage.

## 0.1.1 — 2026-09-04

- Correct Apache-2.0 licensing metadata and full license text.
- Clarify that dynamic commands require Herdr-injected session context and do
  not install a global PATH executable.
- Update canonical repository references after the owner transfer.

## 0.1.0 — 2026-09-03

- Initial public release of guarded external Herdr control.
- Adds exact-target snapshot inspection, typed rename and close proposals,
  stale-target refusal, reconciliation, redacted local audit receipts, and a
  bundled agent skill.
