import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const root = mkdtempSync(join(tmpdir(), "herdr-guard-install-"));
try {
  const result = spawnSync(process.execPath, ["dist/cli.js", "operations"], { cwd: new URL("..", import.meta.url), env: { ...process.env, HOME: root, HERDR_PLUGIN_CONFIG_DIR: join(root, "config"), HERDR_PLUGIN_STATE_DIR: join(root, "state"), HERDR_BIN_PATH: process.execPath }, encoding: "utf8" });
  if (result.status !== 0 || !result.stdout.includes("workspace.rename")) throw new Error(result.stderr || result.stdout || "clean install command failed");
  writeFileSync(join(root, "receipt.json"), JSON.stringify({ status: "passed", package: "herdr-guard" }));
  console.log("clean install check ok");
} finally { rmSync(root, { recursive: true, force: true }); }
