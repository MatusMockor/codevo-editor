import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  agentCliVersionChangeMessage,
  compareAgentCliVersions,
  type AgentCliVersionGateway,
} from "../domain/agentCliVersion";
import type { AgentCliKind } from "../domain/agentTask";
import { attempt, info } from "./agentProjectAuthority";
import type { AgentTasksNotice } from "./agentThreadPorts";

export const AGENT_CLI_VERSION_SOURCE = "agent-cli-version";

const MAX_REPORTED_PROBE_PATHS = 32;
export const AGENT_CLI_VERSION_PROBE_WAIT_MS = 2_000;

export interface AgentCliVersionDependencies {
  readonly gateway: AgentCliVersionGateway | null;
  readonly agentCliPath: string | null;
  readonly agentCliKind: AgentCliKind;
  readonly enabled: boolean;
  readonly setNotice: (notice: AgentTasksNotice | null) => void;
  readonly reportError: (source: string, error: unknown) => void;
  readonly now?: () => number;
}

export interface AgentCliVersionSurface {
  readonly current: string | null;
  readonly previous: string | null;
  readonly changed: boolean;
  probe(agentCliPath?: string, agentCliKind?: AgentCliKind): Promise<string | null>;
}

interface AgentCliVersionState {
  readonly current: string | null;
  readonly previous: string | null;
  readonly changed: boolean;
}

interface InFlightProbe {
  readonly generation: number;
  readonly attemptId: number;
  readonly promise: Promise<string | null>;
}

const UNKNOWN_VERSION: AgentCliVersionState = Object.freeze({
  current: null,
  previous: null,
  changed: false,
});

export function useAgentCliVersion(
  dependencies: AgentCliVersionDependencies,
): AgentCliVersionSurface {
  const [state, setState] = useState<AgentCliVersionState>(UNKNOWN_VERSION);
  const dependenciesRef = useRef(dependencies);
  const mountedRef = useRef(true);
  const generationRef = useRef(0);
  const currentRef = useRef<string | null>(null);
  const inFlightRef = useRef<InFlightProbe | null>(null);
  const attemptIdRef = useRef(0);
  const reportedPathsRef = useRef<Set<string>>(new Set());

  useLayoutEffect(() => {
    dependenciesRef.current = dependencies;
  });

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      generationRef.current += 1;
      inFlightRef.current = null;
    };
  }, []);

  const reportProbeFailure = useCallback((agentCliPath: string, error: unknown): void => {
    const reported = reportedPathsRef.current;
    if (reported.has(agentCliPath)) return;
    if (reported.size >= MAX_REPORTED_PROBE_PATHS) reported.clear();
    reported.add(agentCliPath);
    dependenciesRef.current.reportError(AGENT_CLI_VERSION_SOURCE, error);
  }, []);

  const settleVersion = useCallback((agentCliKind: AgentCliKind, version: string): void => {
    const previous = currentRef.current;
    currentRef.current = version;
    if (previous === null || compareAgentCliVersions(previous, version) !== "changed") {
      setState((known) => (known.current === version ? known : { ...known, current: version }));
      return;
    }
    setState({ current: version, previous, changed: true });
    dependenciesRef.current.setNotice(
      info(agentCliVersionChangeMessage(agentCliKind, previous, version)),
    );
  }, []);

  const applyProbe = useCallback(
    async (
      gateway: AgentCliVersionGateway,
      agentCliPath: string,
      agentCliKind: AgentCliKind,
      generation: number,
      attemptId: number,
    ): Promise<string | null> => {
      const probed = await attempt(() =>
        gateway.probeAgentCliVersion({ agentCliPath, agentCliKind }),
      );
      if (inFlightRef.current?.attemptId === attemptId) inFlightRef.current = null;
      if (!mountedRef.current || generation !== generationRef.current) return null;
      if (!probed.ok) {
        reportProbeFailure(agentCliPath, probed.error);
        return null;
      }
      const version = probed.value.version;
      if (version === null) return null;
      settleVersion(agentCliKind, version);
      return version;
    },
    [reportProbeFailure, settleVersion],
  );

  const runProbe = useCallback(
    (
      gateway: AgentCliVersionGateway,
      agentCliPath: string,
      agentCliKind: AgentCliKind,
      generation: number,
    ): Promise<string | null> => {
      attemptIdRef.current += 1;
      const attemptId = attemptIdRef.current;
      const settled = applyProbe(gateway, agentCliPath, agentCliKind, generation, attemptId);
      let timer: ReturnType<typeof setTimeout> | null = null;
      const expired = new Promise<null>((resolve) => {
        timer = setTimeout(() => {
          if (inFlightRef.current?.attemptId === attemptId) inFlightRef.current = null;
          resolve(null);
        }, AGENT_CLI_VERSION_PROBE_WAIT_MS);
      });
      const clearTimer = (): void => {
        if (timer !== null) clearTimeout(timer);
      };
      void settled.then(clearTimer, clearTimer);
      const promise = Promise.race([settled, expired]);
      inFlightRef.current = { generation, attemptId, promise };
      return promise;
    },
    [applyProbe],
  );

  const probe = useCallback(
    (requestedPath?: string, requestedKind?: AgentCliKind): Promise<string | null> => {
      const deps = dependenciesRef.current;
      const gateway = deps.gateway;
      const agentCliPath = deps.agentCliPath;
      if (!deps.enabled || gateway === null || agentCliPath === null) return Promise.resolve(null);
      if (requestedPath !== undefined && requestedPath !== agentCliPath)
        return Promise.resolve(null);
      if (requestedKind !== undefined && requestedKind !== deps.agentCliKind) {
        return Promise.resolve(null);
      }
      const generation = generationRef.current;
      const inFlight = inFlightRef.current;
      if (inFlight !== null && inFlight.generation === generation) return inFlight.promise;
      return runProbe(gateway, agentCliPath, deps.agentCliKind, generation);
    },
    [runProbe],
  );

  const { agentCliKind, agentCliPath, enabled, gateway } = dependencies;

  useEffect(() => {
    generationRef.current += 1;
    inFlightRef.current = null;
    currentRef.current = null;
    setState((known) => (known === UNKNOWN_VERSION ? known : UNKNOWN_VERSION));
  }, [agentCliKind, agentCliPath]);

  useEffect(() => {
    if (!enabled || gateway === null || agentCliPath === null) return;
    void probe();
  }, [agentCliKind, agentCliPath, enabled, gateway, probe]);

  return useMemo(
    () => ({
      current: state.current,
      previous: state.previous,
      changed: state.changed,
      probe,
    }),
    [probe, state],
  );
}
