#!/usr/bin/env node
import { GuardError } from "./errors.js";
import { CliHerdrAdapter } from "./herdr.js";
import { GuardEngine } from "./engine.js";
import type { OperationKey } from "./types.js";

function output(value: unknown): void { process.stdout.write(`${JSON.stringify(value, null, 2)}\n`); }
function option(args: readonly string[], name: string): string | undefined { const index = args.indexOf(name); return index >= 0 ? args[index + 1] : undefined; }
function required(args: readonly string[], name: string): string { const value = option(args, name); if (!value) throw new GuardError("invalid_input", `missing ${name}`); return value; }
function value(args: readonly string[]): unknown { const raw = option(args, "--value-json"); if (!raw) return undefined; try { return JSON.parse(raw); } catch { throw new GuardError("invalid_input", "--value-json must contain valid JSON"); } }
function help(): void { output({ name: "herdr-guard", commands: ["doctor", "operations", "snapshot", "read", "preview", "apply", "reconcile", "audit"], mutation: "Preview first, then execute only the exact returned applyArgs." }); }

function validateArguments(command: string, args: readonly string[]): void {
  const allowed: Record<string, readonly string[]> = {
    doctor: [], operations: [], snapshot: [], audit: [],
    read: ["--operation", "--target-id"],
    preview: ["--operation", "--target-id", "--value-json"],
    apply: ["--operation", "--target-id", "--target-digest", "--proposal-token", "--value-json"],
    reconcile: ["--proposal-token"],
  };
  const takesValue = new Set(allowed[command] || []);
  const seen = new Set<string>();
  for (let index = 0; index < args.length; index += 1) {
    const name = args[index];
    if (!name?.startsWith("--") || !takesValue.has(name) || seen.has(name)) throw new GuardError("invalid_input", `unknown, misplaced, or repeated argument: ${name || "(missing)"}`);
    seen.add(name);
    const next = args[index + 1];
    if (!next || next.startsWith("--")) throw new GuardError("invalid_input", `missing value for ${name}`);
    index += 1;
  }
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const command = args[0];
  if (!command || command === "--help" || command === "-h") { help(); return; }
  validateArguments(command, args.slice(1));
  const engine = new GuardEngine(new CliHerdrAdapter());
  if (command === "doctor") output(await engine.doctor());
  else if (command === "operations") output({ operations: engine.operations() });
  else if (command === "snapshot") output(engine.snapshot());
  else if (command === "read") output(await engine.read(required(args, "--operation") as OperationKey, option(args, "--target-id")));
  else if (command === "preview") output(await engine.preview(required(args, "--operation"), option(args, "--target-id"), value(args)));
  else if (command === "apply") output(await engine.apply(required(args, "--operation"), option(args, "--target-id"), value(args), option(args, "--target-digest"), option(args, "--proposal-token")));
  else if (command === "reconcile") output(await engine.reconcile(option(args, "--proposal-token")));
  else if (command === "audit") output({ receipts: engine.auditReceipts() });
  else throw new GuardError("invalid_input", `unknown command: ${command}`);
}

main().catch((error: unknown) => {
  const result = error instanceof GuardError ? { ok: false, error: { code: error.code, message: error.message } } : { ok: false, error: { code: "internal_error", message: error instanceof Error ? error.message : "unknown error" } };
  output(result);
  process.exitCode = 1;
});
