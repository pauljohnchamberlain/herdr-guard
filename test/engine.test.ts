import { chmodSync, mkdtempSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import assert from "node:assert/strict";
import test from "node:test";
import { GuardError } from "../src/errors.js";
import { GuardEngine } from "../src/engine.js";
import { FileAudit, type AuditWriter } from "../src/audit.js";
import type { HerdrAdapter } from "../src/herdr.js";
import type { Snapshot } from "../src/types.js";

function snapshot(overrides: Partial<Snapshot> = {}): Snapshot {
  return {
    focusedWorkspaceId: null, focusedTabId: null, focusedPaneId: null,
    workspaces: [{ id: "w1", label: "alpha", activeTabId: "t1", focused: false, cwd: "/tmp/alpha", tabCount: 2, paneCount: 1 }, { id: "w2", label: "other", activeTabId: "t2", focused: false, cwd: "/tmp/other", tabCount: 1, paneCount: 0 }],
    tabs: [{ id: "t1", workspaceId: "w1", label: "shell", focused: false, paneCount: 0 }, { id: "t1b", workspaceId: "w1", label: "second", focused: false, paneCount: 0 }, { id: "t2", workspaceId: "w2", label: "other", focused: false, paneCount: 0 }],
    panes: [], agents: [], ...overrides,
  };
}

class FakeHerdr implements HerdrAdapter {
  current: Snapshot; calls: string[][] = []; readText = "done";
  constructor(value = snapshot()) { this.current = value; }
  snapshot(): unknown { return this.current; }
  invoke(argv: readonly string[]): unknown {
    this.calls.push([...argv]);
    if (argv[0] === "workspace" && argv[1] === "rename") this.current = { ...this.current, workspaces: this.current.workspaces.map((row) => row.id === argv[2] ? { ...row, label: argv[3] || null } : row) };
    if (argv[0] === "workspace" && argv[1] === "close") this.current = { ...this.current, workspaces: this.current.workspaces.filter((row) => row.id !== argv[2]) };
    if (argv[0] === "tab" && argv[1] === "close") this.current = { ...this.current, tabs: this.current.tabs.filter((row) => row.id !== argv[2]) };
    return { ok: true };
  }
  readAgent(): string { return this.readText; }
}

class MemoryAudit implements AuditWriter { rows: ReturnType<AuditWriter["read"]> = []; write(row: ReturnType<AuditWriter["read"]>[number]): void { this.rows.push(row); } read() { return this.rows; } }

async function makeEngine(fake = new FakeHerdr(), audit = new MemoryAudit()): Promise<{ engine: GuardEngine; fake: FakeHerdr; audit: MemoryAudit }> {
  process.env.HERDR_PLUGIN_CONFIG_DIR = mkdtempSync(join(tmpdir(), "herdr-guard-config-"));
  process.env.HERDR_PLUGIN_STATE_DIR = mkdtempSync(join(tmpdir(), "herdr-guard-state-"));
  return { engine: new GuardEngine(fake, audit), fake, audit };
}

test("unknown operations and extra rename fields fail closed", async () => {
  const { engine } = await makeEngine();
  await assert.rejects(engine.preview("shell.exec", "w1", undefined), (error: unknown) => error instanceof GuardError && error.code === "unknown_operation");
  await assert.rejects(engine.preview("workspace.rename", "w1", { label: "x", extra: true }), (error: unknown) => error instanceof GuardError && error.code === "invalid_input");
});

test("rename preview and apply accept unrelated drift but reject target drift", async () => {
  const { engine, fake } = await makeEngine();
  const proposal = await engine.preview("workspace.rename", "w1", { label: "review" });
  fake.current = { ...fake.current, workspaces: fake.current.workspaces.map((row) => row.id === "w2" ? { ...row, label: "unrelated" } : row) };
  const result = await engine.apply("workspace.rename", "w1", { label: "review" }, proposal.targetDigest, proposal.proposalToken);
  assert.equal(result.status, "applied"); assert.equal(fake.current.workspaces.find((row) => row.id === "w1")?.label, "review");
  const stale = await engine.preview("workspace.rename", "w1", { label: "again" });
  fake.current = { ...fake.current, workspaces: fake.current.workspaces.map((row) => row.id === "w1" ? { ...row, cwd: "/tmp/replaced" } : row) };
  await assert.rejects(engine.apply("workspace.rename", "w1", { label: "again" }, stale.targetDigest, stale.proposalToken), (error: unknown) => error instanceof GuardError && error.code === "stale_target");
});

test("close refuses focus, protected labels, active agents, and last tabs", async () => {
  let value = snapshot({ focusedWorkspaceId: "w1" }); let result = await makeEngine(new FakeHerdr(value));
  await assert.rejects(result.engine.preview("workspace.close", "w1", undefined), (error: unknown) => error instanceof GuardError && error.code === "target_focused");
  value = snapshot({ workspaces: [{ ...snapshot().workspaces[0]!, label: "Herdr Manager" }, snapshot().workspaces[1]! ] }); result = await makeEngine(new FakeHerdr(value));
  await assert.rejects(result.engine.preview("workspace.close", "w1", undefined), (error: unknown) => error instanceof GuardError && error.code === "protected_target");
  value = snapshot({ panes: [{ id: "p1", workspaceId: "w1", tabId: "t1", cwd: "/tmp/alpha", focused: false, agent: "codex", agentStatus: "working", hasAgentSession: true }] }); result = await makeEngine(new FakeHerdr(value));
  await assert.rejects(result.engine.preview("workspace.close", "w1", undefined), (error: unknown) => error instanceof GuardError && error.code === "active_agent");
  value = snapshot({ tabs: [{ id: "only", workspaceId: "w2", label: "only", focused: false, paneCount: 0 }], workspaces: snapshot().workspaces }); result = await makeEngine(new FakeHerdr(value));
  await assert.rejects(result.engine.preview("tab.close", "only", undefined), (error: unknown) => error instanceof GuardError && error.code === "last_tab");
});

test("lost close response reconciles without repeating the native effect", async () => {
  const { engine, fake, audit } = await makeEngine();
  const proposal = await engine.preview("workspace.close", "w1", undefined);
  audit.rows.push({ schemaVersion: 1, receiptId: "r1", operation: "workspace.close", targetId: "w1", targetDigest: proposal.targetDigest || "", proposalToken: proposal.proposalToken || "", status: "pending", timestamp: new Date().toISOString() });
  fake.current = { ...fake.current, workspaces: fake.current.workspaces.filter((row) => row.id !== "w1") };
  const result = await engine.reconcile(proposal.proposalToken); assert.equal(result.status, "reconciled"); assert.equal(fake.calls.length, 0); assert.equal(audit.rows.at(-1)?.status, "reconciled");
});

test("file audit is private and rotates at a bounded size", () => {
  const path = join(mkdtempSync(join(tmpdir(), "herdr-guard-audit-")), "audit.jsonl");
  const audit = new FileAudit(path);
  const receipt = { schemaVersion: 1 as const, receiptId: "r1", operation: "workspace.rename" as const, targetId: "w1", targetDigest: "d", proposalToken: "t", status: "pending" as const, timestamp: new Date().toISOString() };
  audit.write(receipt, 4096); audit.write({ ...receipt, receiptId: "r2" }, 4096);
  assert.equal(statSync(path).mode & 0o777, 0o600);
  assert.equal(audit.read().length, 2);
});
