import type { PointerEvent } from "react";
import type { AgentThreadView } from "../../application/agentThreadPorts";
import type { AgentSurfaceFileTreeDependencies } from "../../application/useAgentSurfaceFileTree";
import type { AgentThreadScriptRunner } from "../../application/useAgentThreadScripts";
import type { AgentWorkbenchLayoutState } from "../../application/useAgentWorkbenchLayout";
import type { AgentProjectDescriptor } from "../../domain/agentProject";
import type { AgentWorkbenchLayout } from "../../domain/agentWorkbenchLayout";
import type { BottomPanelView } from "../../domain/bottomPanel";
import type { GitChangeStatus } from "../../domain/git";
import type { MonacoAppTheme, TerminalTheme } from "../../domain/settings";
import type { TerminalGateway } from "../../domain/terminal";
import type { FileEntry } from "../../domain/workspace";
import type { AgentPanelLayoutShortcuts } from "./agentThreadHeaderPresentation";
import type { AgentThreadHeaderProject } from "./AgentThreadHeader";
import type { AgentProjectGroup } from "./agentModePresentation";

export interface AgentWorkbenchFileTreeChrome {
  readonly files: AgentSurfaceFileTreeDependencies["files"];
  readonly fileChanges: AgentSurfaceFileTreeDependencies["fileChanges"];
  readonly activePath: string | null;
  readonly revealActivePathSignal: number;
  readonly fileStatusesByPath?: Record<string, GitChangeStatus>;
  onOpenFile(entry: FileEntry): void;
  onPreviewFile(entry: FileEntry): void;
}

export interface AgentWorkbenchDiffChrome {
  readonly monacoTheme: MonacoAppTheme;
  readonly editorFontFamily?: string;
  readonly editorFontLigatures?: boolean;
  readonly editorFontSize?: number;
}

export interface AgentWorkbenchTerminalChrome {
  readonly terminalGateway: TerminalGateway;
  readonly terminalTheme: TerminalTheme;
  readonly shellIntegrationEnabled: boolean;
  onOpenLink?(path: string, line?: number, column?: number): void;
}

export interface AgentWorkbenchChrome {
  readonly layout: AgentWorkbenchLayoutState;
  readonly bottomPanelVisible: boolean;
  readonly shortcuts: AgentPanelLayoutShortcuts | null;
  readonly scripts: AgentThreadScriptRunner;
  readonly workspaceId: string | null;
  readonly workspaceTrusted: boolean;
  readonly fileTree: AgentWorkbenchFileTreeChrome | null;
  readonly diff: AgentWorkbenchDiffChrome;
  readonly terminal: AgentWorkbenchTerminalChrome | null;
  onToggleBottomPanel(): void;
  onShowTerminalPanel(): void;
  onOpenScriptsView: (() => void) | null;
  revealPath(path: string): Promise<void>;
  onTrustWorkspace?(): void;
  onResizeRightPanelStart?(event: PointerEvent<HTMLDivElement>): void;
}

export interface AgentBottomPanelSyncState {
  readonly owner: string | null;
  readonly visible: boolean;
  readonly view: BottomPanelView;
  readonly applied: boolean;
}

export interface AgentBottomPanelSyncInput {
  readonly owner: string | null;
  readonly active: boolean;
  readonly visible: boolean;
  readonly view: BottomPanelView;
  readonly persisted: boolean;
}

export interface AgentBottomPanelSyncResult {
  readonly state: AgentBottomPanelSyncState;
  readonly mirror: "show" | "hide" | null;
  readonly showTerminal: boolean;
}

export const initialAgentBottomPanelSyncState: AgentBottomPanelSyncState = Object.freeze({
  owner: null,
  visible: false,
  view: "problems",
  applied: false,
});

export function agentBottomPanelSync(
  state: AgentBottomPanelSyncState,
  next: AgentBottomPanelSyncInput,
): AgentBottomPanelSyncResult {
  if (state.owner !== next.owner) {
    return {
      state: { owner: next.owner, visible: next.visible, view: next.view, applied: false },
      mirror: null,
      showTerminal: false,
    };
  }

  const tracked = { ...state, visible: next.visible, view: next.view };
  if (!next.active) {
    return { state: tracked, mirror: null, showTerminal: false };
  }

  if (state.visible !== next.visible) {
    return {
      state: { ...tracked, applied: true },
      mirror: next.visible ? "show" : "hide",
      showTerminal: next.visible && state.view === next.view,
    };
  }

  if (!state.applied && next.persisted) {
    return {
      state: { ...tracked, applied: true },
      mirror: null,
      showTerminal: !next.visible,
    };
  }

  if (state.applied && next.persisted !== next.visible) {
    return {
      state: tracked,
      mirror: next.visible ? "show" : "hide",
      showTerminal: false,
    };
  }

  return { state: tracked, mirror: null, showTerminal: false };
}

export const UNAVAILABLE_AGENT_SCRIPT_RUNNER: AgentThreadScriptRunner = Object.freeze({
  scripts: [],
  truncated: false,
  available: false,
  unavailableReason: "Scripts are not available here",
  active: null,
  run: () => false,
  stop: () => undefined,
});

export function agentWorkbenchLayoutProjection(
  chrome: Pick<AgentWorkbenchChrome, "layout" | "bottomPanelVisible">,
): AgentWorkbenchLayout {
  const layout = chrome.layout.layout;
  if (layout.bottomPanel === chrome.bottomPanelVisible) return layout;
  return { ...layout, bottomPanel: chrome.bottomPanelVisible };
}

export function agentThreadHeaderProject(
  thread: AgentThreadView | null,
  groups: ReadonlyArray<AgentProjectGroup>,
  projects: ReadonlyArray<AgentProjectDescriptor>,
  fallback: { readonly projectRootKey: string; readonly repositoryRoot: string } | null,
): AgentThreadHeaderProject | null {
  if (thread !== null) {
    const owner = thread.thread.owner;
    const project = projects.find((candidate) => candidate.rootKey === owner.rootKey) ?? null;
    return {
      projectRootKey: owner.rootKey,
      repositoryRoot: owner.repositoryRoot,
      label: project?.label ?? thread.repositoryLabel,
    };
  }
  if (fallback === null) return null;
  const group = groups.find((candidate) => candidate.projectRootKey === fallback.projectRootKey);
  if (group === undefined) return null;
  return { ...fallback, label: group.label };
}
