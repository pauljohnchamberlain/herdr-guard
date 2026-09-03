import { digest } from "./hash.js";
import type { Agent, Pane, Snapshot, Tab, Workspace } from "./types.js";

function rootOf(value: unknown): Record<string, unknown> {
  let current = value;
  if (current && typeof current === "object" && "result" in current) current = (current as { result: unknown }).result;
  if (current && typeof current === "object" && "snapshot" in current) current = (current as { snapshot: unknown }).snapshot;
  if (!current || typeof current !== "object" || Array.isArray(current)) throw new Error("Herdr snapshot must be an object");
  return current as Record<string, unknown>;
}

function rows(root: Record<string, unknown>, key: string): Record<string, unknown>[] {
  const value = root[key];
  return Array.isArray(value) ? value.filter((row): row is Record<string, unknown> => Boolean(row && typeof row === "object" && !Array.isArray(row))) : [];
}

function string(value: unknown): string | null { return typeof value === "string" && value.length > 0 ? value : null; }
function bool(value: unknown): boolean { return value === true; }
function number(value: unknown): number | null { return typeof value === "number" && Number.isFinite(value) ? value : null; }

export function normalizeSnapshot(value: unknown): Snapshot {
  const root = rootOf(value);
  if ("focusedWorkspaceId" in root && Array.isArray(root.workspaces) && (root.workspaces.length === 0 || (root.workspaces[0] && typeof root.workspaces[0] === "object" && "id" in root.workspaces[0]))) return root as unknown as Snapshot;
  const rawPanes = rows(root, "panes");
  const rawWorkspaces = rows(root, "workspaces");
  const rawTabs = rows(root, "tabs");
  const paneCwds = new Map<string, string>();
  for (const pane of rawPanes) {
    const workspaceId = string(pane.workspace_id);
    const cwd = string(pane.cwd) ?? string(pane.foreground_cwd);
    if (workspaceId && cwd && !paneCwds.has(workspaceId)) paneCwds.set(workspaceId, cwd);
  }
  const panes: Pane[] = rawPanes.flatMap((pane) => {
    const id = string(pane.pane_id); const workspaceId = string(pane.workspace_id); const tabId = string(pane.tab_id);
    if (!id || !workspaceId || !tabId) return [];
    const session = pane.agent_session;
    return [{ id, workspaceId, tabId, cwd: string(pane.cwd) ?? string(pane.foreground_cwd), focused: bool(pane.focused), agent: string(pane.agent), agentStatus: string(pane.agent_status), hasAgentSession: Boolean(session && typeof session === "object") }];
  });
  const workspaces: Workspace[] = rawWorkspaces.flatMap((row) => {
    const id = string(row.workspace_id); if (!id) return [];
    return [{ id, label: string(row.label), activeTabId: string(row.active_tab_id), focused: bool(row.focused), cwd: string(row.cwd) ?? paneCwds.get(id) ?? null, tabCount: number(row.tab_count), paneCount: number(row.pane_count) }];
  });
  const tabs: Tab[] = rawTabs.flatMap((row) => {
    const id = string(row.tab_id); const workspaceId = string(row.workspace_id); if (!id || !workspaceId) return [];
    return [{ id, workspaceId, label: string(row.label), focused: bool(row.focused), paneCount: number(row.pane_count) }];
  });
  const agents: Agent[] = rawPanes.flatMap((row) => {
    const paneId = string(row.pane_id); const workspaceId = string(row.workspace_id); const tabId = string(row.tab_id); const agent = string(row.agent);
    if (!paneId || !workspaceId || !tabId || !agent) return [];
    const session = row.agent_session;
    const sessionId = session && typeof session === "object" ? string((session as Record<string, unknown>).value) : null;
    return [{ paneId, workspaceId, tabId, agent, status: string(row.agent_status), sessionId }];
  });
  return { focusedWorkspaceId: string(root.focused_workspace_id), focusedTabId: string(root.focused_tab_id), focusedPaneId: string(root.focused_pane_id), workspaces, tabs, panes, agents };
}

export function targetFingerprint(snapshot: Snapshot, kind: "workspace" | "tab", id: string): Record<string, unknown> {
  if (kind === "workspace") {
    const workspace = snapshot.workspaces.find((row) => row.id === id);
    if (!workspace) throw new Error("workspace missing");
    return { kind, id, label: workspace.label, cwd: workspace.cwd, tabs: snapshot.tabs.filter((row) => row.workspaceId === id).sort(byId).map((tab) => ({ id: tab.id, label: tab.label, paneCount: tab.paneCount, panes: snapshot.panes.filter((pane) => pane.tabId === tab.id).sort(byId).map(paneFingerprint) })) };
  }
  const tab = snapshot.tabs.find((row) => row.id === id);
  if (!tab) throw new Error("tab missing");
  return { kind, id, workspaceId: tab.workspaceId, label: tab.label, paneCount: tab.paneCount, panes: snapshot.panes.filter((pane) => pane.tabId === id).sort(byId).map(paneFingerprint) };
}

function byId(a: { id: string }, b: { id: string }): number { return a.id.localeCompare(b.id); }
function paneFingerprint(pane: Pane): Record<string, unknown> { return { id: pane.id, cwd: pane.cwd, agent: pane.agent, agentStatus: pane.agentStatus, hasAgentSession: pane.hasAgentSession }; }

export function targetDigest(snapshot: Snapshot, kind: "workspace" | "tab", id: string): string { return digest(targetFingerprint(snapshot, kind, id)); }

export function unrelatedDigest(snapshot: Snapshot, kind: "workspace" | "tab", id: string): string {
  const workspaces = kind === "workspace" ? snapshot.workspaces.filter((row) => row.id !== id) : snapshot.workspaces.filter((row) => row.id !== snapshot.tabs.find((tab) => tab.id === id)?.workspaceId);
  const tabs = kind === "workspace" ? snapshot.tabs.filter((row) => row.workspaceId !== id) : snapshot.tabs.filter((row) => row.id !== id && row.workspaceId !== snapshot.tabs.find((tab) => tab.id === id)?.workspaceId);
  const panes = kind === "workspace" ? snapshot.panes.filter((row) => row.workspaceId !== id) : snapshot.panes.filter((row) => row.tabId !== id && row.workspaceId !== snapshot.tabs.find((tab) => tab.id === id)?.workspaceId);
  return digest({ workspaces, tabs, panes });
}

export function isFocused(snapshot: Snapshot, kind: "workspace" | "tab", id: string): boolean {
  if (kind === "workspace") return snapshot.focusedWorkspaceId === id || snapshot.workspaces.find((row) => row.id === id)?.focused === true;
  const tab = snapshot.tabs.find((row) => row.id === id);
  return snapshot.focusedTabId === id || tab?.focused === true || snapshot.workspaces.some((workspace) => workspace.id === tab?.workspaceId && workspace.activeTabId === id);
}
