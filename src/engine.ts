import { GuardError, fail } from "./errors.js";
import { digest } from "./hash.js";
import { getOperation, operationMetadata } from "./registry.js";
import { normalizeSnapshot, targetDigest, targetFingerprint, unrelatedDigest, isFocused } from "./normalize.js";
import { ensureConfigDirs, loadConfig } from "./config.js";
import { FileAudit, pendingReceipt, type AuditWriter } from "./audit.js";
import type { HerdrAdapter } from "./herdr.js";
import type { GuardConfig, OperationKey, Proposal, Snapshot } from "./types.js";

const protectedDefaults = ["Herdr Manager", "herdr-manager"];

export class GuardEngine {
  constructor(private readonly herdr: HerdrAdapter, private readonly audit: AuditWriter = new FileAudit()) {}

  async config(): Promise<GuardConfig> { return loadConfig(); }

  snapshot(): Snapshot { return normalizeSnapshot(this.herdr.snapshot()); }

  operations(): readonly unknown[] { return operationMetadata(); }

  auditReceipts(): readonly unknown[] { return this.audit.read(); }

  async read(operation: OperationKey, targetId?: string): Promise<unknown> {
    const spec = getOperation(operation);
    this.assertAllowed(await this.config(), spec.operation);
    if (spec.effectClass !== "read") fail("invalid_input", `${operation} is not a read operation`);
    const snapshot = this.snapshot();
    switch (operation) {
      case "snapshot": return snapshot;
      case "workspace.list": return { operation, workspaces: snapshot.workspaces };
      case "tab.list": return { operation, tabs: snapshot.tabs };
      case "agent.list": return { operation, agents: snapshot.agents };
      case "agent.get": {
        const agent = snapshot.agents.find((row) => row.paneId === targetId);
        if (!agent) fail("target_not_found", `agent pane ${targetId || "(missing)"}`);
        return { operation, agent };
      }
      case "agent.read": {
        const agent = snapshot.agents.find((row) => row.paneId === targetId);
        if (!agent) fail("target_not_found", `agent pane ${targetId || "(missing)"}`);
        return { operation, targetId, agent, text: this.herdr.readAgent(agent.paneId) };
      }
      default: return this.herdr.invoke(spec.argvTemplate || []);
    }
  }

  async preview(operation: string, targetId: string | undefined, rawValue: unknown): Promise<Proposal> {
    const spec = getOperation(operation);
    const config = await this.config();
    this.assertAllowed(config, spec.operation);
    if (spec.effectClass === "read") return { status: "preview", operation: spec.operation, applyArgs: ["read", "--operation", spec.operation, ...(targetId ? ["--target-id", targetId] : [])] };
    if (!targetId) fail("invalid_input", `${operation} requires --target-id`);
    const snapshot = this.snapshot();
    const value = this.validateValue(spec.operation, rawValue);
    const kind = spec.resourceKind === "workspace" ? "workspace" : "tab";
    const target = kind === "workspace" ? snapshot.workspaces.find((row) => row.id === targetId) : snapshot.tabs.find((row) => row.id === targetId);
    if (!target) fail("target_not_found", `${kind} ${targetId}`);
    const fingerprint = targetFingerprint(snapshot, kind, targetId);
    const currentDigest = digest(fingerprint);
    if (spec.effectClass === "destructive") this.guardDestructive(snapshot, spec.operation, targetId, config);
    if (spec.operation === "workspace.rename") {
      const label = value.label as string;
      if (snapshot.workspaces.some((row) => row.id !== targetId && row.label === label)) fail("invalid_input", `workspace label is already in use: ${label}`);
      if (target.label === label) return { status: "existing", operation: spec.operation, targetId, targetDigest: currentDigest, currentLabel: target.label, value, applyArgs: null };
    }
    const unrelated = unrelatedDigest(snapshot, kind, targetId);
    const proposalBody = { operation: spec.operation, targetId, targetDigest: currentDigest, target: fingerprint, value };
    const token = digest(proposalBody);
    const args = ["apply", "--operation", spec.operation, "--target-id", targetId, "--target-digest", currentDigest, "--proposal-token", token, "--value-json", JSON.stringify(value)];
    return { status: "preview", operation: spec.operation, targetId, targetDigest: currentDigest, unrelatedDigest: unrelated, proposalToken: token, target: fingerprint, value, currentLabel: target.label, applyArgs: args };
  }

  async apply(operation: string, targetId: string | undefined, rawValue: unknown, expectedDigest: string | undefined, expectedToken: string | undefined): Promise<Record<string, unknown>> {
    if (!targetId || !expectedDigest || !expectedToken) fail("invalid_input", "apply requires exact target ID, target digest, and proposal token");
    const proposal = await this.preview(operation, targetId, rawValue);
    if (proposal.status !== "preview" || proposal.targetDigest !== expectedDigest || proposal.proposalToken !== expectedToken) fail("stale_target", "target or proposal changed since preview");
    const spec = getOperation(operation);
    const config = await this.config();
    const receipt = pendingReceipt(spec.operation, targetId, expectedDigest, expectedToken, proposal.value);
    try { this.audit.write(receipt, config.auditMaxBytes); } catch (error) { throw new GuardError("audit_failed", error instanceof Error ? error.message : "cannot write audit receipt"); }
    const value = proposal.value || {};
    const argv = (spec.argvTemplate || []).map((part) => part === "{target_id}" ? targetId : part === "{label}" ? String(value.label) : part);
    let nativeResult: unknown;
    try { nativeResult = this.herdr.invoke(argv); } catch (error) {
      try { this.audit.write({ ...receipt, status: "failed", failure: "native_operation_failed", timestamp: new Date().toISOString() }, config.auditMaxBytes); } catch { /* preserve original native failure */ }
      throw error;
    }
    const after = this.snapshot();
    const verified = spec.postcondition === "same-workspace-new-label"
      ? after.workspaces.some((row) => row.id === targetId && row.label === value.label)
      : spec.postcondition === "workspace-absent"
        ? !after.workspaces.some((row) => row.id === targetId)
        : !after.tabs.some((row) => row.id === targetId);
    if (!verified) {
      try { this.audit.write({ ...receipt, status: "failed", failure: "postcondition_failed", timestamp: new Date().toISOString() }, config.auditMaxBytes); } catch { /* preserve postcondition failure */ }
      fail("postcondition_failed", `Herdr did not prove ${spec.postcondition}`);
    }
    this.audit.write({ ...receipt, status: "applied", postcondition: spec.postcondition, timestamp: new Date().toISOString() }, config.auditMaxBytes);
    return { status: "applied", operation: spec.operation, targetId, postcondition: spec.postcondition, nativeResult };
  }

  async reconcile(token: string | undefined): Promise<Record<string, unknown>> {
    if (!token) fail("invalid_input", "reconcile requires --proposal-token");
    const receipts = this.audit.read().filter((row) => row.proposalToken === token && row.status === "pending");
    if (receipts.length === 0) fail("not_found", "no unresolved proposal receipt found");
    const receipt = receipts[receipts.length - 1];
    if (!receipt) fail("not_found", "no unresolved proposal receipt found");
    const snapshot = this.snapshot();
    const absent = receipt.operation === "workspace.close" ? !snapshot.workspaces.some((row) => row.id === receipt.targetId) : !snapshot.tabs.some((row) => row.id === receipt.targetId);
    const rename = receipt.operation === "workspace.rename" && snapshot.workspaces.some((row) => row.id === receipt.targetId && row.label === receipt.value?.label);
    if (!absent && !rename) return { status: "unresolved", operation: receipt.operation, targetId: receipt.targetId, proposalToken: token };
    const config = await this.config();
    this.audit.write({ ...receipt, status: "reconciled", postcondition: absent ? "absent" : "target-present", timestamp: new Date().toISOString() }, config.auditMaxBytes);
    return { status: "reconciled", operation: receipt.operation, targetId: receipt.targetId, proposalToken: token, postcondition: absent ? "absent" : "target-present" };
  }

  async doctor(): Promise<Record<string, unknown>> {
    await ensureConfigDirs();
    const config = await this.config();
    const snapshot = this.snapshot();
    return { ok: true, herdr: { binary: (this.herdr as { binary?: string }).binary || "configured", snapshot: true }, config: { allowedOperations: config.allowedOperations.length, providerAdapters: config.providerAdapters }, targets: { workspaces: snapshot.workspaces.length, tabs: snapshot.tabs.length, agents: snapshot.agents.length } };
  }

  private assertAllowed(config: GuardConfig, operation: OperationKey): void { if (!config.allowedOperations.includes(operation)) fail("invalid_input", `operation is disabled: ${operation}`); }

  private validateValue(operation: OperationKey, raw: unknown): Record<string, unknown> {
    if (operation === "workspace.rename") {
      if (!raw || typeof raw !== "object" || Array.isArray(raw) || Object.keys(raw).length !== 1 || typeof (raw as Record<string, unknown>).label !== "string") fail("invalid_input", "workspace.rename accepts only {label: string}");
      const label = ((raw as Record<string, unknown>).label as string).trim();
      if (!label || label.length > 64 || /[\u0000-\u001f\u007f]/u.test(label)) fail("invalid_input", "label must be nonempty, control-free, and at most 64 characters");
      return { label };
    }
    if (raw !== undefined && raw !== null && !(typeof raw === "object" && Object.keys(raw).length === 0)) fail("invalid_input", `${operation} does not accept a value`);
    return {};
  }

  private guardDestructive(snapshot: Snapshot, operation: OperationKey, targetId: string, config: GuardConfig): void {
    const kind = operation === "workspace.close" ? "workspace" : "tab";
    if (isFocused(snapshot, kind, targetId)) fail("target_focused", `${operation} refuses a focused target`);
    const target = kind === "workspace" ? snapshot.workspaces.find((row) => row.id === targetId) : snapshot.tabs.find((row) => row.id === targetId);
    if (!target) fail("target_not_found", `${kind} ${targetId}`);
    const label = target.label || "";
    const patterns = [...protectedDefaults, ...config.protectedLabelPatterns].map((value) => new RegExp(value === "Herdr Manager" || value === "herdr-manager" ? `^${value}$` : value));
    if (patterns.some((pattern) => pattern.test(label))) fail("protected_target", `${operation} refuses a protected label`);
    if (kind === "workspace") {
      if (snapshot.panes.some((pane) => pane.workspaceId === targetId && (pane.agent !== null || pane.hasAgentSession))) fail("active_agent", `${operation} refuses a workspace with an agent or session`);
    } else {
      const tab = snapshot.tabs.find((row) => row.id === targetId);
      if (tab && snapshot.tabs.filter((row) => row.workspaceId === tab.workspaceId).length <= 1) fail("last_tab", "tab.close refuses the last tab");
      if (snapshot.panes.some((pane) => pane.tabId === targetId && (pane.agent !== null || pane.hasAgentSession))) fail("active_agent", `${operation} refuses a tab with an agent or session`);
    }
  }
}
