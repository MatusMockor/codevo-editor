import { useCallback, useEffect, useMemo, useSyncExternalStore } from "react";
import type { AgentCommandCatalog } from "../domain/agentCommandCatalog";
import {
  agentCommandCatalogTargetKey,
  agentCommandCatalogTargetOfKey,
  localAgentCommandCatalogTarget,
  serverAgentCommandCatalogTarget,
  type AgentCommandCatalogServerProject,
  type AgentCommandCatalogTarget,
} from "../domain/agentCommandCatalogTarget";
import type { AgentCliKind } from "../domain/agentTask";
import type { AgentCommandCatalogStore } from "./agentCommandCatalogStore";

/** Each change of attention asks the store to revalidate; the store owns freshness. */
export type AgentCommandCatalogAttention = "mounted" | "focused" | "menu";

/**
 * Where the composer's provider CLI runs. A server scope names the exact project a
 * capable, connected runner serves; without one the composer offers built-ins only.
 */
export type AgentCommandCatalogScope =
  | {
      readonly kind: "local";
      readonly repositoryRoot: string | null;
      readonly provider: AgentCliKind;
    }
  | {
      readonly kind: "server";
      readonly serverId: string;
      readonly project: AgentCommandCatalogServerProject | null;
      readonly provider: AgentCliKind;
    };

export function agentCommandCatalogScopeTarget(
  scope: AgentCommandCatalogScope,
): AgentCommandCatalogTarget | null {
  switch (scope.kind) {
    case "local":
      return localAgentCommandCatalogTarget(scope.repositoryRoot, scope.provider);
    case "server": {
      if (scope.project?.serverId !== scope.serverId) return null;
      return serverAgentCommandCatalogTarget(scope.project, scope.provider);
    }
    default: {
      const unreachable: never = scope;
      return unreachable;
    }
  }
}

export function useAgentCommandCatalog(
  store: AgentCommandCatalogStore | null,
  scope: AgentCommandCatalogScope,
  attention: AgentCommandCatalogAttention,
): AgentCommandCatalog | null {
  const resolved = agentCommandCatalogScopeTarget(scope);
  const key = resolved === null ? null : agentCommandCatalogTargetKey(resolved);
  const target = useMemo(() => (key === null ? null : agentCommandCatalogTargetOfKey(key)), [key]);
  const subscribe = useCallback(
    (listener: () => void) =>
      store === null || target === null ? ignoreSubscription : store.subscribe(target, listener),
    [store, target],
  );
  const snapshot = useCallback(
    () => (store === null || target === null ? null : store.snapshot(target)),
    [store, target],
  );
  useEffect(() => {
    if (store === null || target === null) return;
    store.refresh(target);
  }, [store, target, attention]);
  return useSyncExternalStore(subscribe, snapshot);
}

function ignoreSubscription(): void {}
