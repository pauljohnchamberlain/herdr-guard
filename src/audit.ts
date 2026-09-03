import { appendFileSync, chmodSync, mkdirSync, readFileSync, renameSync, statSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { stateDir } from "./config.js";
import type { AuditReceipt } from "./types.js";

export interface AuditWriter { write(receipt: AuditReceipt, maxBytes: number): void; read(): AuditReceipt[]; }

export class FileAudit implements AuditWriter {
  readonly path: string;
  constructor(path = join(stateDir(), "audit.jsonl")) { this.path = path; }

  write(receipt: AuditReceipt, maxBytes: number): void {
    try {
      mkdirSync(join(this.path, ".."), { recursive: true, mode: 0o700 });
      let size = 0;
      try { size = statSync(this.path).size; } catch { /* first write */ }
      const line = `${JSON.stringify(receipt)}\n`;
      if (size + Buffer.byteLength(line) > maxBytes) {
        try { renameSync(`${this.path}.1`, `${this.path}.2`); } catch { /* bounded rotation has no older file */ }
        try { renameSync(this.path, `${this.path}.1`); } catch { /* first write */ }
      }
      appendFileSync(this.path, line, { encoding: "utf8", mode: 0o600 });
      chmodSync(this.path, 0o600);
    } catch (error) {
      throw new Error(`audit write failed: ${error instanceof Error ? error.message : "unknown error"}`);
    }
  }

  read(): AuditReceipt[] {
    try {
      return readFileSync(this.path, "utf8").split("\n").filter(Boolean).flatMap((line) => {
        try { const value: unknown = JSON.parse(line); return value && typeof value === "object" ? [value as AuditReceipt] : []; } catch { return []; }
      });
    } catch { return []; }
  }
}

export function pendingReceipt(operation: AuditReceipt["operation"], targetId: string, targetDigest: string, proposalToken: string, value?: Readonly<Record<string, unknown>>): AuditReceipt {
  return { schemaVersion: 1, receiptId: randomUUID(), operation, targetId, targetDigest, proposalToken, ...(value ? { value } : {}), status: "pending", timestamp: new Date().toISOString() };
}
