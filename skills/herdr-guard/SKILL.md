---
name: herdr-guard
description: Safely inspect and control Herdr from an external coding-agent session.
---

# Herdr Guard

Herdr Guard is an external, exact-target safety bridge. It is not the official
inside-pane Herdr skill. Use it only for the registered operations returned by
`operations`.

## Resolve the installed root

Do not guess Herdr's plugin storage path. Resolve the current managed root:

```sh
PLUGIN_ROOT="$(herdr plugin list --plugin com.kaizenbrands.herdr-guard --json | node -e '
let s=""; process.stdin.on("data", d => s += d).on("end", () => {
  const p = JSON.parse(s).result?.plugins?.[0]?.plugin_root;
  if (!p) process.exit(1);
  process.stdout.write(p);
});')"
GUARD=(node "$PLUGIN_ROOT/dist/cli.js")
```

The plugin must be enabled and compatible. If resolution fails, stop and show
the Herdr setup error; never fall back to a focused or guessed session.

## Safe workflow

1. Run `"${GUARD[@]}" doctor`.
2. Run `"${GUARD[@]}" snapshot` and choose an exact returned ID.
3. Run `"${GUARD[@]}" preview ...`.
4. Execute only the exact `applyArgs` array returned by that preview.
5. Verify the returned postcondition; use `reconcile` if the effect response is
   lost.

Never send pane input, invoke arbitrary commands, use focus to choose a target,
or retry an uncertain mutation. Close operations are guarded and refuse active
agents/sessions, focused targets, protected labels, and the last tab.
