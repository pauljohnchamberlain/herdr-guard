import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import test from "node:test";

test("CLI rejects unknown arguments instead of silently dropping them", () => {
  const result = spawnSync(process.execPath, [fileURLToPath(new URL("../../dist/cli.js", import.meta.url)), "operations", "--shell", "unsafe"], { encoding: "utf8" });
  assert.notEqual(result.status, 0);
  assert.match(result.stdout, /invalid_input/);
});
