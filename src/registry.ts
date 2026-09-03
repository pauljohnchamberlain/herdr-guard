import type { OperationKey, OperationSpec } from "./types.js";
import { GuardError } from "./errors.js";

const specs: readonly OperationSpec[] = [
  {
    operation: "snapshot",
    effectClass: "read",
    postcondition: "native-result",
    targetPolicy: { focus: "allow-focused", liveAgent: "allow-agent-or-session" },
  },
  {
    operation: "workspace.list",
    effectClass: "read",
    resourceKind: "workspace",
    argvTemplate: ["workspace", "list"],
    postcondition: "native-result",
    targetPolicy: { focus: "allow-focused", liveAgent: "allow-agent-or-session" },
  },
  {
    operation: "workspace.rename",
    effectClass: "reversible",
    resourceKind: "workspace",
    argvTemplate: ["workspace", "rename", "{target_id}", "{label}"],
    postcondition: "same-workspace-new-label",
    targetPolicy: { focus: "target-not-focused", liveAgent: "allow-agent-or-session" },
  },
  {
    operation: "workspace.close",
    effectClass: "destructive",
    resourceKind: "workspace",
    argvTemplate: ["workspace", "close", "{target_id}"],
    postcondition: "workspace-absent",
    targetPolicy: { focus: "target-not-focused", liveAgent: "refuse-agent-or-session" },
  },
  {
    operation: "tab.list",
    effectClass: "read",
    resourceKind: "tab",
    postcondition: "native-result",
    targetPolicy: { focus: "allow-focused", liveAgent: "allow-agent-or-session" },
  },
  {
    operation: "tab.close",
    effectClass: "destructive",
    resourceKind: "tab",
    argvTemplate: ["tab", "close", "{target_id}"],
    postcondition: "tab-absent",
    targetPolicy: { focus: "target-not-focused", liveAgent: "refuse-agent-or-session" },
  },
  {
    operation: "agent.list",
    effectClass: "read",
    resourceKind: "agent",
    postcondition: "native-result",
    targetPolicy: { focus: "allow-focused", liveAgent: "allow-agent-or-session" },
  },
  {
    operation: "agent.get",
    effectClass: "read",
    resourceKind: "agent",
    postcondition: "native-result",
    targetPolicy: { focus: "allow-focused", liveAgent: "allow-agent-or-session" },
  },
  {
    operation: "agent.read",
    effectClass: "read",
    resourceKind: "agent",
    postcondition: "native-result",
    targetPolicy: { focus: "allow-focused", liveAgent: "allow-agent-or-session" },
  },
];

const byKey = new Map(specs.map((spec) => [spec.operation, spec]));

export function getOperation(operation: string): OperationSpec {
  const spec = byKey.get(operation as OperationKey);
  if (!spec) throw new GuardError("unknown_operation", operation);
  return spec;
}

export function operationMetadata(): readonly OperationSpec[] {
  return specs;
}
