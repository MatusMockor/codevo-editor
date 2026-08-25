import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  agentWorkbenchLayoutReducer,
  agentWorkbenchLayoutSnapshotsEqual,
  agentWorkbenchLayoutsEqual,
  initialAgentWorkbenchLayout,
  parseAgentWorkbenchLayout,
  serializeAgentWorkbenchLayout,
  type AgentWorkbenchLayout,
  type AgentWorkbenchLayoutAction,
  type AgentWorkbenchLayoutMode,
  type AgentWorkbenchLayoutPersisted,
} from "../domain/agentWorkbenchLayout";

export interface AgentWorkbenchLayoutPersistencePort {
  write(ownerKey: string, layout: AgentWorkbenchLayoutPersisted): Promise<void>;
}

export interface AgentWorkbenchLayoutHydration {
  readonly ownerKey: string;
  readonly layout: unknown;
}

export interface UseAgentWorkbenchLayoutOptions {
  readonly workspaceOwnerKey: string | null;
  readonly hasWorkspace: boolean;
  readonly agentLayoutAvailable?: boolean;
  readonly hydration?: AgentWorkbenchLayoutHydration | null;
  readonly persistence?: AgentWorkbenchLayoutPersistencePort | null;
  readonly reportError?: (source: string, error: unknown) => void;
}

export interface AgentWorkbenchLayoutState {
  readonly layout: AgentWorkbenchLayout;
  readonly effectiveLayout: AgentWorkbenchLayoutMode;
  dispatch(action: AgentWorkbenchLayoutAction): void;
}

export interface AgentWorkbenchLayoutSurface {
  readonly agentModeActive: boolean;
  readonly agentWorkbench: AgentWorkbenchLayoutState;
}

type OwnedLayoutSource = "owner" | "hydration" | "dispatch";

interface OwnedAgentWorkbenchLayout {
  readonly ownerKey: string | null;
  readonly generation: number;
  readonly hydrated: boolean;
  readonly layout: AgentWorkbenchLayout;
  readonly source: OwnedLayoutSource;
}

export const AGENT_WORKBENCH_LAYOUT_PERSISTENCE_SOURCE = "Agent Layout";

export function useAgentWorkbenchLayout(
  options: UseAgentWorkbenchLayoutOptions,
): AgentWorkbenchLayoutSurface {
  const { agentLayoutAvailable = true, hasWorkspace, hydration = null } = options;
  const ownerKey = hasWorkspace ? options.workspaceOwnerKey : null;

  const ownerKeyRef = useRef(ownerKey);
  ownerKeyRef.current = ownerKey;
  const persistenceRef = useRef(options.persistence ?? null);
  persistenceRef.current = options.persistence ?? null;
  const reportErrorRef = useRef(options.reportError);
  reportErrorRef.current = options.reportError;
  const persistedRef = useRef<{
    readonly ownerKey: string;
    readonly snapshot: AgentWorkbenchLayoutPersisted;
  } | null>(null);

  const [owned, setOwned] = useState<OwnedAgentWorkbenchLayout>({
    ownerKey,
    generation: 0,
    hydrated: false,
    layout: initialAgentWorkbenchLayout,
    source: "owner",
  });

  if (owned.ownerKey !== ownerKey) {
    setOwned({
      ownerKey,
      generation: owned.generation + 1,
      hydrated: false,
      layout: initialAgentWorkbenchLayout,
      source: "owner",
    });
  }

  const ownedGeneration = owned.generation;

  const dispatch = useCallback(
    (action: AgentWorkbenchLayoutAction) => {
      if (ownerKey === null) {
        return;
      }

      setOwned((current) => {
        if (current.ownerKey !== ownerKey || current.generation !== ownedGeneration) {
          return current;
        }

        const layout = agentWorkbenchLayoutReducer(current.layout, action);
        if (current.hydrated && agentWorkbenchLayoutsEqual(current.layout, layout)) {
          return current;
        }

        return { ...current, hydrated: true, layout, source: "dispatch" };
      });
    },
    [ownedGeneration, ownerKey],
  );

  useEffect(() => {
    if (owned.hydrated || owned.ownerKey === null) {
      return;
    }

    if (hydration === null || hydration.ownerKey !== owned.ownerKey) {
      return;
    }

    const layout = parseAgentWorkbenchLayout(hydration.layout);
    setOwned((current) => {
      if (current.ownerKey !== owned.ownerKey || current.generation !== owned.generation) {
        return current;
      }

      if (current.hydrated) {
        return current;
      }

      return { ...current, hydrated: true, layout, source: "hydration" };
    });
  }, [hydration, owned]);

  useEffect(() => {
    const persistOwnerKey = owned.ownerKey;
    if (persistOwnerKey === null) {
      return;
    }

    const snapshot = serializeAgentWorkbenchLayout(owned.layout);
    const previous = persistedRef.current;

    if (owned.source !== "dispatch" || previous === null || previous.ownerKey !== persistOwnerKey) {
      persistedRef.current = { ownerKey: persistOwnerKey, snapshot };
      return;
    }

    if (agentWorkbenchLayoutSnapshotsEqual(previous.snapshot, snapshot)) {
      return;
    }

    persistedRef.current = { ownerKey: persistOwnerKey, snapshot };

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
  }, [owned]);

  const effectiveLayout: AgentWorkbenchLayoutMode =
    ownerKey === null || !agentLayoutAvailable ? "editor-expanded" : owned.layout.layout;

  const agentWorkbench = useMemo<AgentWorkbenchLayoutState>(
    () => ({ dispatch, effectiveLayout, layout: owned.layout }),
    [dispatch, effectiveLayout, owned.layout],
  );

  return { agentModeActive: effectiveLayout === "agent", agentWorkbench };
}
