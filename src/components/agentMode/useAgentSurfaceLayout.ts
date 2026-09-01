import { useCallback, useState } from "react";
import type { AgentSurfaceKind, AgentWorkbenchLayout } from "../../domain/agentWorkbenchLayout";
import type { AgentThreadView } from "../../application/agentThreadPorts";
import {
  agentSurfaceHostPlacement,
  type AgentSurfaceHostPlacement,
} from "../workbenchShellPlacement";
import { agentSurfaceBlockedReason } from "./agentSurfacePolicy";
import type { AgentWorkbenchChrome } from "./agentWorkbenchChrome";

export interface AgentSurfaceLayoutOptions {
  readonly chrome: Pick<AgentWorkbenchChrome, "layout" | "workspaceTrusted">;
  readonly selectedThread: AgentThreadView | null;
  readonly workspaceRoot: string | null;
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
  toggleMaximized(): void;
}

export function useAgentSurfaceLayout({
  chrome,
  selectedThread,
  workspaceRoot,
}: AgentSurfaceLayoutOptions): AgentSurfaceLayout {
  const layout = chrome.layout.layout;
  const dispatchLayout = chrome.layout.dispatch;
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
      agentSurfaceBlockedReason(surface, selectedThread, workspaceTrusted, workspaceRoot) !== null,
    [selectedThread, workspaceRoot, workspaceTrusted],
  );
  const toggleRightPanel = useCallback(() => {
    setChooserRequested(false);
    dispatchLayout({ kind: "toggleRightPanel" });
  }, [dispatchLayout]);
  const toggleRail = useCallback(() => dispatchLayout({ kind: "toggleRail" }), [dispatchLayout]);
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
    toggleMaximized,
  };
}
