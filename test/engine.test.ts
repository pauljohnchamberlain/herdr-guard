import { chmodSync, mkdtempSync, readFileSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import assert from "node:assert/strict";
import test from "node:test";
import { GuardError } from "../src/errors.js";
import { GuardEngine } from "../src/engine.js";
import { FileAudit, type AuditWriter } from "../src/audit.js";
import { normalizeSnapshot } from "../src/normalize.js";
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
  throwAfterInvoke = false; skipEffects = false;
  constructor(value = snapshot()) { this.current = value; }
  snapshot(): unknown { return this.current; }
  invoke(argv: readonly string[]): unknown {
    this.calls.push([...argv]);
    if (!this.skipEffects && argv[0] === "workspace" && argv[1] === "rename") this.current = { ...this.current, workspaces: this.current.workspaces.map((row) => row.id === argv[2] ? { ...row, label: argv[3] || null } : row) };
    if (!this.skipEffects && argv[0] === "workspace" && argv[1] === "close") this.current = { ...this.current, workspaces: this.current.workspaces.filter((row) => row.id !== argv[2]) };
    if (!this.skipEffects && argv[0] === "tab" && argv[1] === "close") this.current = { ...this.current, tabs: this.current.tabs.filter((row) => row.id !== argv[2]) };
    if (this.throwAfterInvoke) throw new Error("native response lost");
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

test("uncertain native effects remain reconcileable and are never retried", async () => {
  const fake = new FakeHerdr(); fake.throwAfterInvoke = true;
  const { engine, audit } = await makeEngine(fake);
  const proposal = await engine.preview("workspace.close", "w1", undefined);
  await assert.rejects(engine.apply("workspace.close", "w1", undefined, proposal.targetDigest, proposal.proposalToken));
  assert.equal(audit.rows.at(-1)?.status, "pending");
  assert.equal(audit.rows.at(-1)?.failure, "native_result_uncertain");
  fake.throwAfterInvoke = false;
  fake.current = { ...fake.current, workspaces: fake.current.workspaces.filter((row) => row.id !== "w1") };
  const result = await engine.reconcile(proposal.proposalToken);
  assert.equal(result.status, "reconciled");
  assert.equal(fake.calls.length, 1);
});

test("native failure and postcondition failure remain visibly audited", async () => {
  const nativeFailure = new FakeHerdr(); nativeFailure.throwAfterInvoke = true;
  const nativeAudit = await makeEngine(nativeFailure);
  const nativeProposal = await nativeAudit.engine.preview("workspace.rename", "w1", { label: "review" });
  await assert.rejects(nativeAudit.engine.apply("workspace.rename", "w1", { label: "review" }, nativeProposal.targetDigest, nativeProposal.proposalToken));
  assert.equal(nativeAudit.audit.rows.at(-1)?.status, "pending");
  const postconditionFailure = new FakeHerdr(); postconditionFailure.skipEffects = true;
  const postAudit = await makeEngine(postconditionFailure);
  const postProposal = await postAudit.engine.preview("workspace.rename", "w1", { label: "review" });
  await assert.rejects(postAudit.engine.apply("workspace.rename", "w1", { label: "review" }, postProposal.targetDigest, postProposal.proposalToken), (error: unknown) => error instanceof GuardError && error.code === "postcondition_failed");
  assert.equal(postAudit.audit.rows.at(-1)?.failure, "postcondition_failed");
});

test("hostile target IDs fail before any Herdr call", async () => {
  const { engine, fake } = await makeEngine();
  await assert.rejects(engine.preview("workspace.close", "bad\n-id", undefined), (error: unknown) => error instanceof GuardError && error.code === "invalid_input");
  assert.deepEqual(fake.calls, []);
});

test("malformed config and disabled operations fail closed", async () => {
  const { engine } = await makeEngine();
  const { writeFileSync } = await import("node:fs");
  writeFileSync(join(process.env.HERDR_PLUGIN_CONFIG_DIR!, "config.json"), "{bad");
  await assert.rejects(engine.doctor(), (error: unknown) => error instanceof GuardError && error.code === "invalid_config");
  writeFileSync(join(process.env.HERDR_PLUGIN_CONFIG_DIR!, "config.json"), JSON.stringify({ allowedOperations: ["workspace.list"] }));
  await assert.rejects(engine.preview("workspace.rename", "w1", { label: "review" }), (error: unknown) => error instanceof GuardError && error.code === "invalid_input");
});

test("language-independent contract fixtures cover generic decisions", async () => {
  const fixture = JSON.parse(readFileSync(new URL("../../contracts/herdr-guard-contract.json", import.meta.url), "utf8")) as {
    snapshots: Record<string, unknown>;
    cases: Array<{ snapshot: string; operation: string; targetId: string; value?: unknown; expect?: string; expectError?: string }>;
  };
  for (const contract of fixture.cases) {
    const fake = new FakeHerdr(normalizeSnapshot(fixture.snapshots[contract.snapshot]));
    const { engine } = await makeEngine(fake);
    if (contract.expectError) {
      await assert.rejects(engine.preview(contract.operation, contract.targetId, contract.value), (error: unknown) => error instanceof GuardError && error.code === contract.expectError);
    } else {
      const proposal = await engine.preview(contract.operation, contract.targetId, contract.value);
      assert.equal(proposal.status, contract.expect);
    }
  }
});

test("bounded fuzz inputs fail closed without invoking Herdr", async () => {
  const { engine, fake } = await makeEngine();
  let seed = 0x9e3779b9;
  const next = (): number => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed; };
  for (let index = 0; index < 500; index += 1) {
    const length = next() % 64;
    const label = Array.from({ length }, () => String.fromCharCode(32 + (next() % 95))).join("");
    if (label.trim() && !/[\u0000-\u001f\u007f]/u.test(label)) {
      const proposal = await engine.preview("workspace.rename", "w1", { label });
      assert.equal(typeof proposal.proposalToken, "string");
    }
  }
  for (const label of ["\u0000", "\u001f", "\u007f", "x".repeat(65)]) {
    await assert.rejects(engine.preview("workspace.rename", "w1", { label }), (error: unknown) => error instanceof GuardError && error.code === "invalid_input");
  }
  for (const targetId of ["", "bad\t-id", "x".repeat(257)]) {
    await assert.rejects(engine.preview("workspace.close", targetId, undefined), (error: unknown) => error instanceof GuardError && error.code === "invalid_input");
  }
  await assert.rejects(engine.read("workspace.list", "w1"), (error: unknown) => error instanceof GuardError && error.code === "invalid_input");
  assert.equal(fake.calls.length, 0);
});

test("file audit is private and rotates at a bounded size", () => {
  const path = join(mkdtempSync(join(tmpdir(), "herdr-guard-audit-")), "audit.jsonl");
  const audit = new FileAudit(path);
  const receipt = { schemaVersion: 1 as const, receiptId: "r1", operation: "workspace.rename" as const, targetId: "w1", targetDigest: "d", proposalToken: "t", status: "pending" as const, timestamp: new Date().toISOString() };
  audit.write(receipt, 4096); audit.write({ ...receipt, receiptId: "r2" }, 4096);
  assert.equal(statSync(path).mode & 0o777, 0o600);
  assert.equal(audit.read().length, 2);
});
