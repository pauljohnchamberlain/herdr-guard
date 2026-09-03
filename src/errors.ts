export type GuardErrorCode =
  | "invalid_input"
  | "invalid_config"
  | "unknown_operation"
  | "target_not_found"
  | "target_ambiguous"
  | "target_focused"
  | "protected_target"
  | "active_agent"
  | "last_tab"
  | "stale_target"
  | "audit_failed"
  | "herdr_unavailable"
  | "native_failed"
  | "postcondition_failed"
  | "not_found";

export class GuardError extends Error {
  constructor(readonly code: GuardErrorCode, message: string) {
    super(`${code}: ${message}`);
    this.name = "GuardError";
  }
}

export function fail(code: GuardErrorCode, message: string): never {
  throw new GuardError(code, message);
}
