export type OperationClass = "read" | "reversible" | "destructive";
export type ResourceKind = "workspace" | "tab" | "agent";

export type OperationKey =
  | "snapshot"
  | "workspace.list"
  | "workspace.rename"
  | "workspace.close"
  | "tab.list"
  | "tab.close"
  | "agent.list"
  | "agent.get"
  | "agent.read";

export interface OperationSpec {
  readonly operation: OperationKey;
  readonly effectClass: OperationClass;
  readonly resourceKind?: ResourceKind;
  readonly argvTemplate?: readonly string[];
  readonly postcondition: "native-result" | "same-workspace-new-label" | "workspace-absent" | "tab-absent";
  readonly targetPolicy: {
    readonly focus: "allow-focused" | "target-not-focused";
    readonly liveAgent: "allow-agent-or-session" | "refuse-agent-or-session";
  };
}

export interface Snapshot {
  readonly focusedWorkspaceId: string | null;
  readonly focusedTabId: string | null;
  readonly focusedPaneId: string | null;
  readonly workspaces: readonly Workspace[];
  readonly tabs: readonly Tab[];
  readonly panes: readonly Pane[];
  readonly agents: readonly Agent[];
}

export interface Workspace {
  readonly id: string;
  readonly label: string | null;
  readonly activeTabId: string | null;
  readonly focused: boolean;
  readonly cwd: string | null;
  readonly tabCount: number | null;
  readonly paneCount: number | null;
}

export interface Tab {
  readonly id: string;
  readonly workspaceId: string;
  readonly label: string | null;
  readonly focused: boolean;
  readonly paneCount: number | null;
}

export interface Pane {
  readonly id: string;
  readonly workspaceId: string;
  readonly tabId: string;
  readonly cwd: string | null;
  readonly focused: boolean;
  readonly agent: string | null;
  readonly agentStatus: string | null;
  readonly hasAgentSession: boolean;
}

export interface Agent {
  readonly paneId: string;
  readonly workspaceId: string;
  readonly tabId: string;
  readonly agent: string;
  readonly status: string | null;
  readonly sessionId: string | null;
}

export interface GuardConfig {
  readonly allowedOperations: readonly OperationKey[];
  readonly protectedLabelPatterns: readonly string[];
  readonly namingPolicyEnabled: boolean;
  readonly auditMaxBytes: number;
  readonly providerAdapters: { readonly codex: boolean };
}

export interface Proposal {
  readonly status: "preview" | "existing";
  readonly operation: OperationKey;
  readonly targetId?: string;
  readonly targetDigest?: string;
  readonly unrelatedDigest?: string;
  readonly proposalToken?: string;
  readonly value?: Readonly<Record<string, unknown>>;
  readonly currentLabel?: string | null;
  readonly target?: unknown;
  readonly applyArgs?: readonly string[] | null;
}

export interface AuditReceipt {
  readonly schemaVersion: 1;
  readonly receiptId: string;
  readonly operation: OperationKey;
  readonly targetId: string;
  readonly targetDigest: string;
  readonly proposalToken: string;
  readonly status: "pending" | "applied" | "reconciled" | "failed";
  readonly postcondition?: string;
  readonly value?: Readonly<Record<string, unknown>>;
  readonly failure?: string;
  readonly timestamp: string;
}
