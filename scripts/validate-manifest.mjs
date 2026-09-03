import { readFileSync } from "node:fs";

const manifest = readFileSync(new URL("../herdr-plugin.toml", import.meta.url), "utf8");
for (const key of ["id", "name", "version", "min_herdr_version", "description", "platforms"]) {
  if (!new RegExp(`^${key}\\s*=`, "m").test(manifest)) throw new Error(`manifest missing ${key}`);
}
if (!manifest.includes('platforms = ["linux", "macos"]')) throw new Error("manifest platform declaration is wrong");
if (!manifest.includes('command = ["node", "dist/cli.js", "doctor"]')) throw new Error("doctor action missing");
if (!manifest.includes('command = ["node", "dist/cli.js", "operations"]')) throw new Error("operations action missing");
console.log("manifest ok");
