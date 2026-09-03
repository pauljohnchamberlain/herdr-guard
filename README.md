# Herdr Guard

Guarded external control for Herdr from Codex, Claude, and other coding
agents. Herdr Guard lets an agent inspect a local Herdr session and make a
small set of explicit, reviewable changes without relying on the focused pane.

Herdr plugins run as the current user and are not sandboxed. The marketplace is
an automatic, unreviewed index. Read the source before installing.

## Install

Requires Herdr 0.8.2 or newer and Node.js 20 or newer:

```sh
herdr plugin install pauljohnchamberlain/herdr-guard
herdr plugin list --plugin com.kaizenbrands.herdr-guard --json
```

The plugin does not add a global PATH shim. Herdr owns the managed checkout;
the bundled skill resolves its root with `herdr plugin list` each time it runs.

## Discover and inspect

```sh
herdr-guard doctor
herdr-guard operations
herdr-guard snapshot
herdr-guard read --operation workspace.list
herdr-guard read --operation agent.list
```

If `herdr-guard` is not on PATH, run the installed root directly:

```sh
node /path/from/herdr-plugin-list/dist/cli.js doctor
```

The bundled `skills/herdr-guard/SKILL.md` contains a portable root resolver for
agents that need this form.

## Preview and apply

Targets are exact Herdr IDs returned by `snapshot`; focus is never used to
select a target.

```sh
herdr-guard preview --operation workspace.rename --target-id WORKSPACE_ID \
  --value-json '{"label":"review"}'
```

The JSON result contains `applyArgs`. Execute those exact returned arguments by
prefixing them with `herdr-guard`; do not reconstruct or edit them:

```sh
herdr-guard apply --operation workspace.rename --target-id WORKSPACE_ID \
  --target-digest TARGET_DIGEST --proposal-token PROPOSAL_TOKEN \
  --value-json '{"label":"review"}'
```

The apply step re-reads the target, refuses a changed target, writes an audit
receipt before the native effect, verifies the postcondition, and never retries
an uncertain effect automatically.

Guarded close follows the same flow:

```sh
herdr-guard preview --operation workspace.close --target-id WORKSPACE_ID
# execute the exact applyArgs from the preview result
```

Close refuses focused targets, protected labels, the last tab, and targets
containing an active agent or native session. A target changed after preview
returns a stable `stale_target` error.

## Reconcile and audit

If the process loses the native effect response, reconcile the exact proposal:

```sh
herdr-guard reconcile --proposal-token PROPOSAL_TOKEN
herdr-guard audit
```

Audit state is kept under `HERDR_PLUGIN_STATE_DIR` when Herdr supplies it, or
the platform state directory documented by `herdr plugin config-dir`. Files are
mode 0600, rotated at a bounded size, and contain operation metadata only—not
pane output, prompts, credentials, or arbitrary command text.

## Configuration

Optional JSON configuration is read from `HERDR_PLUGIN_CONFIG_DIR/config.json`.
Safe defaults allow the registered operations, protect labels matching
`Herdr Manager` and `herdr-manager`, disable provider adapters, refuse focused
destructive targets, and cap audit storage. A malformed file is an error; it
does not widen authority.

```json
{
  "allowedOperations": ["workspace.list", "workspace.rename", "workspace.close", "tab.close"],
  "protectedLabelPatterns": ["^Herdr Manager$", "^herdr-manager$"],
  "namingPolicyEnabled": false,
  "auditMaxBytes": 1048576,
  "providerAdapters": {"codex": false}
}
```

## Update and uninstall

```sh
herdr plugin install pauljohnchamberlain/herdr-guard
herdr plugin disable com.kaizenbrands.herdr-guard
herdr plugin enable com.kaizenbrands.herdr-guard
herdr plugin uninstall com.kaizenbrands.herdr-guard
```

Uninstall removes the Herdr-managed checkout and registration. User audit and
configuration state is retained unless you remove it deliberately from the
paths reported by Herdr; this avoids deleting evidence unexpectedly.

## Limitations

v0.1.0 supports Linux and macOS, local Herdr control only, and no Windows,
remote relay, MCP, telemetry, pane input, server control, arbitrary commands,
or automatic permission approval. Provider session metadata is optional and
does not affect generic Herdr operations.
