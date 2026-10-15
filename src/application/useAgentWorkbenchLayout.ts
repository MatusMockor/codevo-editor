import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  initialAgentWorkbenchLayout,
  parseAgentWorkbenchLayout,
  parsePersistedAgentBottomPanel,
  type AgentRailState,
  type AgentWorkbenchLayout,
  type AgentWorkbenchLayoutMode,
} from "../domain/agentWorkbenchLayout";
import type { AgentFileViewerReveal } from "../domain/agentWorkbenchLayoutFileReveal";
import {
  NO_AGENT_THREAD_LAYOUTS,
  agentWorkbenchSessionSnapshotsEqual,
  findAgentThreadSurfaceLayout,
  isAgentThreadLayoutKey,
  parseAgentThreadSurfaceLayouts,
  serializeAgentWorkbenchSession,
  withAgentThreadSurfaceLayout,
  type AgentWorkbenchSessionPersisted,
} from "../domain/agentWorkbenchLayoutThreads";
import {
  applyAgentWorkbenchCommand,
  type AgentWorkbenchCommand,
  type OwnedAgentWorkbenchLayout,
} from "./useAgentWorkbenchLayoutCommands";

export type { AgentWorkbenchCommand } from "./useAgentWorkbenchLayoutCommands";

export interface AgentWorkbenchLayoutPersistencePort {
  write(ownerKey: string, layout: AgentWorkbenchSessionPersisted): Promise<void>;
}

export interface AgentSidebarRailPreferencePort {
  read(): AgentRailState | null;
  write(rail: AgentRailState): void;
}

export interface AgentWorkbenchLayoutHydration {
  readonly ownerKey: string;
  readonly layout: unknown;
}

export interface UseAgentWorkbenchLayoutOptions {
  readonly workspaceOwnerKey: string | null;
  readonly hasWorkspace: boolean;
  readonly agentLayoutAvailable?: boolean;
  readonly bottomPanelVisible?: boolean;
  readonly hydration?: AgentWorkbenchLayoutHydration | null;
  readonly persistence?: AgentWorkbenchLayoutPersistencePort | null;
  readonly sidebarPreference?: AgentSidebarRailPreferencePort | null;
  readonly reportError?: (source: string, error: unknown) => void;
}

export interface AgentWorkbenchLayoutState {
  readonly layout: AgentWorkbenchLayout;
  readonly effectiveLayout: AgentWorkbenchLayoutMode;
  readonly persistedBottomPanel: boolean;
  readonly fileReveal?: AgentFileViewerReveal | null;
  dispatch(action: AgentWorkbenchCommand): void;
  bindThread?(threadId: string | null): void;
}

export interface AgentWorkbenchLayoutSurface {
  readonly agentModeActive: boolean;
  readonly agentWorkbench: AgentWorkbenchLayoutState;
}

export const AGENT_WORKBENCH_LAYOUT_PERSISTENCE_SOURCE = "Agent Layout";
export const AGENT_SIDEBAR_PREFERENCE_SOURCE = "Agent Sidebar";

export function useAgentWorkbenchLayout(
  options: UseAgentWorkbenchLayoutOptions,
): AgentWorkbenchLayoutSurface {
  const {
    agentLayoutAvailable = true,
    bottomPanelVisible = false,
    hasWorkspace,
    hydration = null,
  } = options;
  const ownerKey = hasWorkspace ? options.workspaceOwnerKey : null;

  const ownerKeyRef = useRef(ownerKey);
  ownerKeyRef.current = ownerKey;
  const persistenceRef = useRef(options.persistence ?? null);
  persistenceRef.current = options.persistence ?? null;
  const reportErrorRef = useRef(options.reportError);
  reportErrorRef.current = options.reportError;
  const persistedRef = useRef<{
    readonly ownerKey: string;
    readonly snapshot: AgentWorkbenchSessionPersisted;
  } | null>(null);
  const [threadId, setThreadId] = useState<string | null>(null);
  const threadIdRef = useRef(threadId);
  const revealSequenceRef = useRef(0);

  const [owned, setOwned] = useState<OwnedAgentWorkbenchLayout>(() => initialOwned(ownerKey, 0));

  if (owned.ownerKey !== ownerKey) {
    setOwned(initialOwned(ownerKey, owned.generation + 1));
  }

  const ownedGeneration = owned.generation;
  const bindThread = useCallback((candidate: string | null) => {
    const next = isAgentThreadLayoutKey(candidate) ? candidate : null;
    threadIdRef.current = next;
    setThreadId(next);
  }, []);
  const sidebarRail = useGlobalSidebarRail(options.sidebarPreference ?? null, reportErrorRef);
  const toggleSidebarRail = sidebarRail.toggle;

  const dispatch = useCallback(
    (command: AgentWorkbenchCommand) => {
      if (command.kind === "toggleRail") {
        toggleSidebarRail();
        return;
      }
      const boundThreadId = threadIdRef.current;
      const sequence = command.kind === "revealFile" ? ++revealSequenceRef.current : 0;
      setOwned((current) => {
        if (current.ownerKey !== ownerKey || current.generation !== ownedGeneration) {
          return current;
        }
        return applyAgentWorkbenchCommand(current, command, boundThreadId, sequence);
      });
    },
    [ownedGeneration, ownerKey, toggleSidebarRail],
  );

  useEffect(() => {
    if (owned.hydrated || owned.ownerKey === null) {
      return;
    }

    if (hydration === null || hydration.ownerKey !== owned.ownerKey) {
      return;
    }

    const layout: AgentWorkbenchLayout = parseAgentWorkbenchLayout(hydration.layout);
    const persistedBottomPanel = parsePersistedAgentBottomPanel(hydration.layout);
    const threadLayouts = parseAgentThreadSurfaceLayouts(hydration.layout);
    setOwned((current) => {
      if (current.ownerKey !== owned.ownerKey || current.generation !== owned.generation) {
        return current;
      }

      if (current.hydrated) {
        return current;
      }

      return {
        ...current,
        hydrated: true,
        layout,
        threadLayouts,
        persistedBottomPanel,
        source: "hydration",
      };
    });
  }, [hydration, owned]);

  const effectiveLayout: AgentWorkbenchLayoutMode = agentLayoutAvailable ? "agent" : "editor-only";
  const agentLayoutActive = effectiveLayout === "agent";

  useEffect(() => {
    const persistOwnerKey = owned.ownerKey;
    if (persistOwnerKey === null) {
      return;
    }

    const snapshot = serializeAgentWorkbenchSession(
      owned.layout,
      bottomPanelVisible,
      owned.threadLayouts,
    );
    const previous = persistedRef.current;

    if (previous === null || previous.ownerKey !== persistOwnerKey) {
      persistedRef.current = { ownerKey: persistOwnerKey, snapshot };
      return;
    }

    if (agentWorkbenchSessionSnapshotsEqual(previous.snapshot, snapshot)) {
      return;
    }

    const bottomPanelChanged =
      agentLayoutActive && previous.snapshot.bottomPanel !== snapshot.bottomPanel;
    persistedRef.current = { ownerKey: persistOwnerKey, snapshot };

    if (owned.source !== "dispatch" && !bottomPanelChanged) {
      return;
    }

    let cancelled = false;
    const persist = async () => {
      await Promise.resolve();
      const port = persistenceRef.current;
      if (cancelled || port === null || ownerKeyRef.current !== persistOwnerKey) {
        return;
      }

      try {
        await port.write(persistOwnerKey, snapshot);
      } catch (error) {
        reportErrorRef.current?.(AGENT_WORKBENCH_LAYOUT_PERSISTENCE_SOURCE, error);
      }
    };

    void persist();

    return () => {
      cancelled = true;
    };
  }, [agentLayoutActive, bottomPanelVisible, owned]);

  const { persistedBottomPanel } = owned;
  const ownedLayout = owned.layout;
  const threadLayout = findAgentThreadSurfaceLayout(owned.threadLayouts, threadId);
  const fileReveal = threadId === null ? owned.draftFileReveal : (threadLayout?.fileReveal ?? null);
  const rail = sidebarRail.rail;
  const layout = useMemo<AgentWorkbenchLayout>(() => {
    const shown = withAgentThreadSurfaceLayout(ownedLayout, threadLayout);
    return shown.rail === rail ? shown : { ...shown, rail };
  }, [ownedLayout, rail, threadLayout]);
  const agentWorkbench = useMemo<AgentWorkbenchLayoutState>(
    () => ({ bindThread, dispatch, effectiveLayout, fileReveal, layout, persistedBottomPanel }),
    [bindThread, dispatch, effectiveLayout, fileReveal, layout, persistedBottomPanel],
  );

  return { agentModeActive: effectiveLayout === "agent", agentWorkbench };
}

function initialOwned(ownerKey: string | null, generation: number): OwnedAgentWorkbenchLayout {
  return {
    ownerKey,
    generation,
    hydrated: false,
    layout: initialAgentWorkbenchLayout,
    threadLayouts: NO_AGENT_THREAD_LAYOUTS,
    draftFileReveal: null,
    persistedBottomPanel: false,
    source: "owner",
  };
}

function useGlobalSidebarRail(
  preference: AgentSidebarRailPreferencePort | null,
  reportErrorRef: { readonly current: ((source: string, error: unknown) => void) | undefined },
): { readonly rail: AgentRailState; toggle(): void } {
  const preferenceRef = useRef(preference);
  preferenceRef.current = preference;
  const [rail, setRail] = useState<AgentRailState>(() =>
    readSidebarRail(preference, reportErrorRef.current),
  );
  const railRef = useRef(rail);

  const toggle = useCallback(() => {
    const next: AgentRailState = railRef.current === "expanded" ? "collapsed" : "expanded";
    railRef.current = next;
    setRail(next);
    try {
      preferenceRef.current?.write(next);
    } catch (error) {
      reportErrorRef.current?.(AGENT_SIDEBAR_PREFERENCE_SOURCE, error);
    }
  }, [reportErrorRef]);

  return { rail, toggle };
}

function readSidebarRail(
  preference: AgentSidebarRailPreferencePort | null,
  reportError: ((source: string, error: unknown) => void) | undefined,
): AgentRailState {
  try {
    return preference?.read() ?? initialAgentWorkbenchLayout.rail;
  } catch (error) {
    reportError?.(AGENT_SIDEBAR_PREFERENCE_SOURCE, error);
    return initialAgentWorkbenchLayout.rail;
  }
}
