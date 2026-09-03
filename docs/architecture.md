# Architecture

```text
agent skill
    │ resolves HERDR_PLUGIN_ROOT from `herdr plugin list --json`
    ▼
typed CLI ── config validator ── operation registry
    │                                  │
    │ proposal/apply/reconcile         │ fixed argv templates only
    ▼                                  ▼
audit receipt                    Herdr CLI → local socket
    │                                  │
    └────────────── postcondition ◄────┘
```

The CLI owns the generic safety policy. The Herdr adapter owns only process
invocation and JSON/snapshot decoding. Configuration and audit state live in
Herdr-declared plugin directories, never in the managed checkout.

The public package intentionally has no portfolio manager, project registry,
model policy, provider billing policy, remote endpoint, or private filesystem
assumption. Provider adapters are feature flags and are not needed by the
generic control path.

Mutation safety is based on an exact target fingerprint. Unrelated workspaces
may change between preview and apply; any change to the selected workspace/tab
or its topology invalidates the proposal. Destructive operations add focus,
protected-label, last-tab, and agent/session guards.
