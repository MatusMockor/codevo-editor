import { useCallback, useState } from "react";
import {
  DEFAULT_AGENT_RAIL_WIDTH,
  agentWorkbenchLayoutReducer,
  type AgentWorkbenchLayoutAction,
  type AgentSurfaceKind,
  type AgentWorkbenchLayout,
} from "../../domain/agentWorkbenchLayout";
import type { AgentThreadView } from "../../application/agentThreadPorts";
import {
  agentSurfaceHostPlacement,
  type AgentSurfaceHostPlacement,
} from "../workbenchShellPlacement";
import { agentSurfaceBlockedReason } from "./agentSurfacePolicy";
import { remoteSurfaceSupports, type AgentRemoteSurface } from "./agentRemoteSurface";
import type { AgentWorkbenchChrome } from "./agentWorkbenchChrome";

export interface AgentSurfaceLayoutOptions {
  readonly chrome: Pick<AgentWorkbenchChrome, "layout" | "workspaceTrusted">;
  readonly selectedThread: AgentThreadView | null;
  readonly workspaceRoot: string | null;
  readonly remoteSurface?: AgentRemoteSurface | null;
  readonly remotePaneKey?: string | null;
}

export interface AgentSurfaceLayout {
  readonly layout: AgentWorkbenchLayout;
  readonly surfaceHost: AgentSurfaceHostPlacement;
  readonly chooserRequested: boolean;
  openSurface(surface: AgentSurfaceKind): void;
  activateSurface(surface: AgentSurfaceKind): void;
  closeSurfaceTab(surface: AgentSurfaceKind): void;
  surfaceBlocked(surface: AgentSurfaceKind): boolean;
  toggleRightPanel(): void;
  toggleRail(): void;
  resizeRail(width: number): void;
  resetRailWidth(): void;
  toggleMaximized(): void;
}

export function useAgentSurfaceLayout({
  chrome,
  selectedThread,
  workspaceRoot,
  remoteSurface = null,
  remotePaneKey = null,
}: AgentSurfaceLayoutOptions): AgentSurfaceLayout {
  const execution = selectedThread?.execution;
  const paneKey =
    remoteSurface?.paneKey ??
    remotePaneKey ??
    (execution === undefined
      ? null
      : JSON.stringify([
          execution.serverId,
          execution.runnerId,
          execution.projectId,
          execution.conversationId,
        ]));
  const [selections, setSelections] = useState<
    ReadonlyMap<string, Pick<AgentWorkbenchLayout, "openSurfaces" | "activeSurface">>
  >(() => new Map());
  const baseLayout = chrome.layout.layout;
  const selection =
    paneKey === null
      ? null
      : (selections.get(paneKey) ?? { openSurfaces: [], activeSurface: null });
  const layout = selection === null ? baseLayout : { ...baseLayout, ...selection };
  const originalDispatch = chrome.layout.dispatch;
  const dispatchLayout = useCallback(
    (action: AgentWorkbenchLayoutAction) => {
      if (
        paneKey !== null &&
        (action.kind === "openSurface" ||
          action.kind === "activateSurface" ||
          action.kind === "closeSurfaceTab")
      ) {
        setSelections((current) => {
          const saved = current.get(paneKey) ?? { openSurfaces: [], activeSurface: null };
          const updated = agentWorkbenchLayoutReducer({ ...baseLayout, ...saved }, action);
          const next = new Map(current);
          next.delete(paneKey);
          next.set(paneKey, {
            openSurfaces: updated.openSurfaces,
            activeSurface: updated.activeSurface,
          });
          if (next.size > 128) next.delete(next.keys().next().value!);
          return next;
        });
        if (action.kind !== "closeSurfaceTab" && baseLayout.rightPanel === "closed")
          originalDispatch({ kind: "toggleRightPanel" });
        return;
      }
      originalDispatch(action);
    },
    [paneKey, baseLayout, originalDispatch],
  );
  const [chooserRequested, setChooserRequested] = useState(false);
  const openSurface = useCallback(
    (surface: AgentSurfaceKind) => {
      setChooserRequested(false);
      dispatchLayout({ kind: "openSurface", surface });
    },
    [dispatchLayout],
  );
  const activateSurface = useCallback(
    (surface: AgentSurfaceKind) => {
      setChooserRequested(false);
      dispatchLayout({ kind: "activateSurface", surface });
    },
    [dispatchLayout],
  );
  const closeSurfaceTab = useCallback(
    (surface: AgentSurfaceKind) => {
      setChooserRequested(true);
      dispatchLayout({ kind: "closeSurfaceTab", surface });
    },
    [dispatchLayout],
  );
  const workspaceTrusted = chrome.workspaceTrusted;
  const surfaceBlocked = useCallback(
    (surface: AgentSurfaceKind) =>
      surface !== "diff" && remoteSurfaceSupports(remoteSurface, surface)
        ? false
        : agentSurfaceBlockedReason(surface, selectedThread, workspaceTrusted, workspaceRoot) !==
          null,
    [selectedThread, workspaceRoot, workspaceTrusted, remoteSurface],
  );
  const toggleRightPanel = useCallback(() => {
    setChooserRequested(false);
    dispatchLayout({ kind: "toggleRightPanel" });
  }, [dispatchLayout]);
  const toggleRail = useCallback(() => dispatchLayout({ kind: "toggleRail" }), [dispatchLayout]);
  const resizeRail = useCallback(
    (width: number) => dispatchLayout({ kind: "resizeRail", width }),
    [dispatchLayout],
  );
  const resetRailWidth = useCallback(
    () => dispatchLayout({ kind: "resizeRail", width: DEFAULT_AGENT_RAIL_WIDTH }),
    [dispatchLayout],
  );
  const toggleMaximized = useCallback(
    () => dispatchLayout({ kind: "toggleMaximized" }),
    [dispatchLayout],
  );

  const surfaceHost = agentSurfaceHostPlacement({
    ...layout,
    layout: chrome.layout.effectiveLayout,
  });

  return {
    layout,
    surfaceHost,
    chooserRequested,
    openSurface,
    activateSurface,
    closeSurfaceTab,
    surfaceBlocked,
    toggleRightPanel,
    toggleRail,
    resizeRail,
    resetRailWidth,
    toggleMaximized,
  };
}
