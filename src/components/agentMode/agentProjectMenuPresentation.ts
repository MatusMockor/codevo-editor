import type { AgentRailScopeEntry } from "./agentSidebarPresentation";

export type AgentProjectMenuCommand =
  "trust" | "close" | "release" | "rename" | "reveal" | "copyPath" | "terminalSessions";

export interface AgentProjectMenuTarget {
  readonly projectRootKey: string;
  readonly repositoryRoot: string;
  readonly rootPath: string | null;
}

export interface AgentProjectMenuEntry {
  readonly id: string;
  readonly label: string;
  readonly command: AgentProjectMenuCommand;
  readonly disabled: boolean;
}

export interface AgentRailScopeState {
  readonly label: string;
  readonly action: "release" | null;
}

export function agentRailScopeState(entry: AgentRailScopeEntry | null): AgentRailScopeState | null {
  if (entry === null) return null;
  if (entry.trust === "unknown") return { label: "Opening project…", action: null };
  if (entry.trust === "untrusted") return { label: "Not trusted", action: null };
  if (entry.origin === "background-tab") return { label: "Background", action: null };
  if (entry.origin === "closed-tab-live-tasks") return { label: "Tab closed", action: "release" };
  return null;
}

export function agentRailProjectState(entry: AgentRailScopeEntry): string | null {
  const state = agentRailScopeState(entry);
  if (state === null) return null;
  if (entry.trust !== "trusted") return state.label;
  if (entry.origin === "closed-tab-live-tasks") return state.label;
  return null;
}

export function agentProjectMenuTarget(entry: AgentRailScopeEntry): AgentProjectMenuTarget {
  return {
    projectRootKey: entry.projectRootKey,
    repositoryRoot: entry.repositoryRoot,
    rootPath: entry.rootPath,
  };
}

export function agentProjectClosable(entry: AgentRailScopeEntry): boolean {
  if (entry.projectRootKey.startsWith("remote:")) return false;
  return entry.origin !== "closed-tab-live-tasks" && entry.rootPath !== null;
}

export function agentProjectCloseLabel(entry: AgentRailScopeEntry): string {
  return `Close project ${entry.label}`;
}

export function agentProjectMenuEntries(
  entry: AgentRailScopeEntry,
): ReadonlyArray<AgentProjectMenuEntry> {
  const entries: AgentProjectMenuEntry[] = [];
  if (entry.trust === "untrusted" && entry.rootPath !== null) {
    entries.push(projectMenuEntry("trust", "Trust project…", "trust", false));
  }
  if (entry.origin === "closed-tab-live-tasks" && entry.rootPath !== null) {
    entries.push(projectMenuEntry("release", "Release project", "release", false));
  }
  if (agentProjectClosable(entry)) {
    entries.push(projectMenuEntry("close", "Close project", "close", false));
  }
  entries.push(projectMenuEntry("rename", "Rename project…", "rename", false));
  entries.push(
    projectMenuEntry(
      "terminal-sessions",
      "Terminal sessions…",
      "terminalSessions",
      !agentProjectUsable(entry),
    ),
  );
  if (entry.rootPath === null) return entries;
  entries.push(projectMenuEntry("reveal", "Reveal in Finder", "reveal", false));
  entries.push(projectMenuEntry("copy-path", "Copy path", "copyPath", false));
  return entries;
}

export function agentProjectRepositoryCountLabel(entry: AgentRailScopeEntry): string | null {
  if (entry.repositoryCount <= 1) return null;
  return `${entry.repositoryCount} repos`;
}

function projectMenuEntry(
  id: string,
  label: string,
  command: AgentProjectMenuCommand,
  disabled: boolean,
): AgentProjectMenuEntry {
  return { id, label, command, disabled };
}

export function agentProjectUsable(entry: AgentRailScopeEntry | null): boolean {
  if (entry === null) return false;
  return entry.trust === "trusted" && entry.origin !== "closed-tab-live-tasks";
}
