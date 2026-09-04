# Herdr Guard

Guarded external control for Herdr from Codex, Claude, and other coding
agents. Herdr Guard lets an agent inspect a Herdr session and make a
small set of explicit, reviewable changes without relying on the focused pane.

## What this is for

I built Herdr Guard so I can manage a remote Herdr session from Codex Desktop.
The Herdr session is separate from the agent process, so Codex can inspect it
and make a few guarded workspace changes through Herdr's own session context.
It is not a new relay or a second session manager.

Use it when you need to:

- inspect workspaces, tabs, agents, and recent agent output;
- rename one exact workspace after previewing the change; or
- close finished, inactive work after Herdr Guard checks the target, focus,
  protected labels, last-tab rule, and active agents.

Do not use it to start agents, type into panes, run arbitrary commands, stop
Herdr, or guess which workspace is focused. Those operations are outside the
plugin's contract.

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

The dynamic `herdr-guard` commands below are intended to run from a
Herdr-managed agent or plugin action. They require Herdr's injected
`HERDR_ENV=1` and `HERDR_SOCKET_PATH` session context and fail closed without
it; they never attach to an implicit focused or default session. From a normal
terminal, use the static actions first:

```sh
herdr plugin action invoke doctor --plugin com.kaizenbrands.herdr-guard
herdr plugin action invoke operations --plugin com.kaizenbrands.herdr-guard
```

Then install the bundled skill for your coding agent and run the dynamic
workflow inside a Herdr-managed session.

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

v0.1.2 supports Linux and macOS, local Herdr control only, and no Windows,
remote relay, MCP, telemetry, pane input, server control, arbitrary commands,
or automatic permission approval. Provider session metadata is optional and
does not affect generic Herdr operations.
