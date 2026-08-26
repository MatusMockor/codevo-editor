import { useEffect, useMemo, useRef, useState } from "react";
import type { AgentCliVersionGateway } from "../domain/agentCliVersion";
import { agentCliPathValidation, type AgentCliPaths } from "../domain/agentSettings";
import type { AgentCliKind } from "../domain/agentTask";

export type AgentSettingsCliProbeState =
  | { readonly kind: "notConfigured" }
  | { readonly kind: "invalidPath" }
  | { readonly kind: "probing" }
  | { readonly kind: "ready"; readonly version: string }
  | { readonly kind: "unknownVersion" }
  | { readonly kind: "failed" };

export interface AgentSettingsCliVersions {
  readonly claudeCode: AgentSettingsCliProbeState;
  readonly codex: AgentSettingsCliProbeState;
}

export function useAgentSettingsCliVersions(
  gateway: AgentCliVersionGateway | null,
  paths: AgentCliPaths,
): AgentSettingsCliVersions {
  const claudeCode = useAgentSettingsCliVersion(gateway, paths.claudeCode, "claudeCode");
  const codex = useAgentSettingsCliVersion(gateway, paths.codex, "codex");
  return useMemo(() => ({ claudeCode, codex }), [claudeCode, codex]);
}

function useAgentSettingsCliVersion(
  gateway: AgentCliVersionGateway | null,
  path: string | null,
  kind: AgentCliKind,
): AgentSettingsCliProbeState {
  const [state, setState] = useState<AgentSettingsCliProbeState>(() => initialState(path));
  const generationRef = useRef(0);
  const authorityRef = useRef({ gateway, path, kind });
  authorityRef.current = { gateway, path, kind };

  useEffect(() => {
    generationRef.current += 1;
    const generation = generationRef.current;
    const validation = agentCliPathValidation(path);
    if (validation === "notConfigured") {
      setState({ kind: "notConfigured" });
      return;
    }
    if (validation === "invalid") {
      setState({ kind: "invalidPath" });
      return;
    }
    if (path === null) return;
    if (gateway === null) {
      setState({ kind: "failed" });
      return;
    }
    const authority = { gateway, path, kind } as const;
    setState({ kind: "probing" });
    void probe(authority)
      .then((next) => {
        if (generationRef.current !== generation) return;
        if (!sameAuthority(authorityRef.current, authority)) return;
        setState(next);
      })
      .catch(() => {
        if (generationRef.current !== generation) return;
        if (!sameAuthority(authorityRef.current, authority)) return;
        setState({ kind: "failed" });
      });
    return () => {
      generationRef.current += 1;
    };
  }, [gateway, kind, path]);

  return state;
}

async function probe(authority: {
  readonly gateway: AgentCliVersionGateway;
  readonly path: string;
  readonly kind: AgentCliKind;
}): Promise<AgentSettingsCliProbeState> {
  const result = await authority.gateway.probeAgentCliVersion({
    agentCliPath: authority.path,
    agentCliKind: authority.kind,
  });
  if (result.version === null) return { kind: "unknownVersion" };
  return { kind: "ready", version: result.version };
}

function initialState(path: string | null): AgentSettingsCliProbeState {
  const validation = agentCliPathValidation(path);
  if (validation === "notConfigured") return { kind: "notConfigured" };
  if (validation === "invalid") return { kind: "invalidPath" };
  return { kind: "probing" };
}

function sameAuthority(
  current: {
    readonly gateway: AgentCliVersionGateway | null;
    readonly path: string | null;
    readonly kind: AgentCliKind;
  },
  captured: {
    readonly gateway: AgentCliVersionGateway;
    readonly path: string;
    readonly kind: AgentCliKind;
  },
): boolean {
  return (
    current.gateway === captured.gateway &&
    current.path === captured.path &&
    current.kind === captured.kind
  );
}
