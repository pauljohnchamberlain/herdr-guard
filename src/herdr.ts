import { spawnSync } from "node:child_process";
import { GuardError } from "./errors.js";

export interface CommandResult { readonly stdout: string; readonly stderr: string; readonly status: number; }

export interface HerdrAdapter {
  snapshot(): unknown;
  invoke(argv: readonly string[]): unknown;
  readAgent(targetId: string): string;
}

function parseJson(text: string): unknown {
  try { return JSON.parse(text); } catch { return text; }
}

export class CliHerdrAdapter implements HerdrAdapter {
  readonly binary: string;
  constructor(binary = process.env.HERDR_BIN_PATH || "herdr", private readonly env: NodeJS.ProcessEnv = process.env) { this.binary = binary; }

  private run(argv: readonly string[]): CommandResult {
    if (this.env.HERDR_ENV !== "1" || !this.env.HERDR_SOCKET_PATH) throw new GuardError("herdr_unavailable", "no Herdr plugin session context; refuse an implicit or focused session");
    const result = spawnSync(this.binary, [...argv], { encoding: "utf8", env: this.env, timeout: 30_000, windowsHide: true });
    if (result.error) throw new GuardError("herdr_unavailable", result.error.message);
    const status = result.status ?? 1;
    const stdout = result.stdout || "";
    const stderr = result.stderr || "";
    if (status !== 0) throw new GuardError("native_failed", `Herdr rejected ${argv[0] || "request"} (${status})`);
    return { stdout, stderr, status };
  }

  snapshot(): unknown { return parseJson(this.run(["api", "snapshot"]).stdout); }
  invoke(argv: readonly string[]): unknown { return parseJson(this.run(argv).stdout); }
  readAgent(targetId: string): string { return this.run(["agent", "read", targetId, "--source", "recent", "--format", "text"]).stdout; }
}
