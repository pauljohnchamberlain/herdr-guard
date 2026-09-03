import { mkdir, readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import type { GuardConfig, OperationKey } from "./types.js";
import { GuardError } from "./errors.js";
import { operationMetadata } from "./registry.js";

const defaultConfig: GuardConfig = {
  allowedOperations: operationMetadata().map((spec) => spec.operation),
  protectedLabelPatterns: ["^Herdr Manager$", "^herdr-manager$"],
  namingPolicyEnabled: false,
  auditMaxBytes: 1_048_576,
  providerAdapters: { codex: false },
};

export function configDir(): string {
  return process.env.HERDR_PLUGIN_CONFIG_DIR || join(homedir(), ".config", "herdr", "plugins", "herdr-guard");
}

export function stateDir(): string {
  return process.env.HERDR_PLUGIN_STATE_DIR || join(homedir(), ".local", "state", "herdr", "plugins", "herdr-guard");
}

function invalid(message: string): never {
  throw new GuardError("invalid_config", message);
}

function boundedStringArray(value: unknown, field: string, maxItems: number, maxLength: number): string[] {
  if (!Array.isArray(value) || value.length > maxItems) invalid(`${field} must be an array of at most ${maxItems} strings`);
  const result: string[] = [];
  for (const item of value) {
    if (typeof item !== "string" || item.length === 0 || item.length > maxLength || /[\u0000-\u001f\u007f]/u.test(item)) {
      invalid(`${field} contains an invalid string`);
    }
    result.push(item);
  }
  return result;
}

export async function loadConfig(): Promise<GuardConfig> {
  const path = join(configDir(), "config.json");
  let parsed: unknown;
  try {
    parsed = JSON.parse(await readFile(path, "utf8"));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return defaultConfig;
    if (error instanceof SyntaxError) invalid("config.json is not valid JSON");
    throw new GuardError("invalid_config", `cannot read ${path}`);
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) invalid("configuration must be an object");
  const input = parsed as Record<string, unknown>;
  const allowed = boundedStringArray(input.allowedOperations ?? defaultConfig.allowedOperations, "allowedOperations", 32, 64);
  const known = new Set(operationMetadata().map((spec) => spec.operation));
  if (allowed.some((operation) => !known.has(operation as OperationKey))) invalid("allowedOperations contains an unknown operation");
  const patterns = boundedStringArray(input.protectedLabelPatterns ?? defaultConfig.protectedLabelPatterns, "protectedLabelPatterns", 32, 128);
  for (const pattern of patterns) {
    try { new RegExp(pattern); } catch { invalid(`protectedLabelPatterns contains invalid regex: ${pattern}`); }
  }
  const naming = input.namingPolicyEnabled ?? defaultConfig.namingPolicyEnabled;
  if (typeof naming !== "boolean") invalid("namingPolicyEnabled must be boolean");
  const auditMax = input.auditMaxBytes ?? defaultConfig.auditMaxBytes;
  if (typeof auditMax !== "number" || !Number.isInteger(auditMax) || auditMax < 4096 || auditMax > 10_485_760) invalid("auditMaxBytes must be an integer from 4096 to 10485760");
  const providers = input.providerAdapters ?? defaultConfig.providerAdapters;
  if (!providers || typeof providers !== "object" || Array.isArray(providers)) invalid("providerAdapters must be an object");
  const codex = (providers as Record<string, unknown>).codex ?? false;
  if (typeof codex !== "boolean") invalid("providerAdapters.codex must be boolean");
  return { allowedOperations: allowed as OperationKey[], protectedLabelPatterns: patterns, namingPolicyEnabled: naming, auditMaxBytes: auditMax, providerAdapters: { codex } };
}

export async function ensureConfigDirs(): Promise<void> {
  await mkdir(configDir(), { recursive: true, mode: 0o700 });
  await mkdir(stateDir(), { recursive: true, mode: 0o700 });
}
