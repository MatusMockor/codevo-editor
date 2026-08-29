import { useCallback, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  agentCliExecutablePresentation,
  defaultAgentCliDiscoveryResult,
  type AgentCliDiscoveryGateway,
  type AgentCliDiscoveryResult,
  type AgentCliExecutablePresentation,
} from "../domain/agentSettings";
import type { AgentCliKind } from "../domain/agentTask";

export type AgentCliDiscoveryStatus =
  | { readonly kind: "inactive" }
  | { readonly kind: "discovering"; readonly generation: number }
  | { readonly kind: "ready"; readonly generation: number }
  | { readonly kind: "failed"; readonly generation: number };

export interface AgentCliDiscoveryPublication {
  readonly generation: number;
  readonly result: AgentCliDiscoveryResult;
}

export interface AgentCliDiscoverySurface {
  readonly result: AgentCliDiscoveryResult;
  readonly status: AgentCliDiscoveryStatus;
  presentation(provider: AgentCliKind, manualPath: string | null): AgentCliExecutablePresentation;
  currentGeneration(): number;
  read(): AgentCliDiscoveryPublication | null;
  refresh(): Promise<AgentCliDiscoveryPublication | null>;
}

export interface AgentCliDiscoveryDependencies {
  readonly active: boolean;
  readonly autoDiscover?: boolean;
  readonly gateway: AgentCliDiscoveryGateway;
  readonly reportError: (source: string, error: unknown) => void;
}

export function useAgentCliDiscovery(
  dependencies: AgentCliDiscoveryDependencies,
): AgentCliDiscoverySurface {
  const [status, setStatus] = useState<AgentCliDiscoveryStatus>({ kind: "inactive" });
  const [result, setResult] = useState(defaultAgentCliDiscoveryResult);
  const dependenciesRef = useRef(dependencies);
  const mountedRef = useRef(true);
  const lifecycleGenerationRef = useRef(0);
  const requestGenerationRef = useRef(0);
  const publicationRef = useRef<AgentCliDiscoveryPublication | null>(null);

  useLayoutEffect(() => {
    dependenciesRef.current = dependencies;
  });

  const discover = useCallback(
    async (refresh: boolean): Promise<AgentCliDiscoveryPublication | null> => {
      if (!dependenciesRef.current.active) return null;
      requestGenerationRef.current += 1;
      const generation = requestGenerationRef.current;
      const lifecycleGeneration = lifecycleGenerationRef.current;
      const gateway = dependenciesRef.current.gateway;
      publicationRef.current = null;
      setStatus({ kind: "discovering", generation });
      try {
        const discovered = await gateway.discoverAgentClis({ refresh });
        if (!mountedRef.current) return null;
        if (!dependenciesRef.current.active) return null;
        if (dependenciesRef.current.gateway !== gateway) return null;
        if (lifecycleGenerationRef.current !== lifecycleGeneration) return null;
        if (requestGenerationRef.current !== generation) return null;
        const publication = { generation, result: discovered } as const;
        publicationRef.current = publication;
        setResult(discovered);
        setStatus({ kind: "ready", generation });
        return publication;
      } catch (error) {
        if (!mountedRef.current) return null;
        if (!dependenciesRef.current.active) return null;
        if (dependenciesRef.current.gateway !== gateway) return null;
        if (lifecycleGenerationRef.current !== lifecycleGeneration) return null;
        if (requestGenerationRef.current !== generation) return null;
        publicationRef.current = null;
        setResult(defaultAgentCliDiscoveryResult());
        setStatus({ kind: "failed", generation });
        dependenciesRef.current.reportError("Agent CLI discovery", error);
        return null;
      }
    },
    [],
  );

  useLayoutEffect(() => {
    mountedRef.current = true;
    lifecycleGenerationRef.current += 1;
    publicationRef.current = null;
    setResult(defaultAgentCliDiscoveryResult());
    if (!dependencies.active || dependencies.autoDiscover === false) {
      setStatus({ kind: "inactive" });
      return () => {
        mountedRef.current = false;
      };
    }
    void discover(false);
    return () => {
      mountedRef.current = false;
      requestGenerationRef.current += 1;
    };
  }, [dependencies.active, dependencies.autoDiscover, dependencies.gateway, discover]);

  const presentation = useCallback(
    (provider: AgentCliKind, manualPath: string | null): AgentCliExecutablePresentation =>
      agentCliExecutablePresentation(provider, manualPath, result[provider]),
    [result],
  );
  const read = useCallback(() => publicationRef.current, []);
  const currentGeneration = useCallback(() => requestGenerationRef.current, []);
  const refresh = useCallback(() => discover(true), [discover]);

  return useMemo(
    () => ({ result, status, presentation, currentGeneration, read, refresh }),
    [currentGeneration, presentation, read, refresh, result, status],
  );
}
