import { useEffect, useRef, useState } from "react";
import type { AgentThreadView } from "../../application/agentThreadPorts";
import type { RemoteRunnerContextValue } from "../remoteRunner/remoteRunnerContext";
import type { RemoteSurfaceScope } from "../../domain/remoteRunnerSurfaces";
import type { AgentRemoteSurface } from "./agentRemoteSurface";

const UNAVAILABLE_CAPABILITIES = { files: false, history: false, terminal: false } as const;

export function remoteSurfaceScope(
  thread: AgentThreadView | null,
  selectedThreadId: string | null,
  draftProjectRootKey: string | null,
): RemoteSurfaceScope | null {
  if (thread !== null) {
    const execution = thread.execution;
    if (execution?.kind !== "remote") return null;
    return {
      serverId: execution.serverId,
      runnerId: execution.runnerId,
      projectId: execution.projectId,
      taskId: execution.latestTaskId,
    };
  }
  // A pending conversation must never borrow the currently selected draft's checkout.
  if (selectedThreadId !== null || draftProjectRootKey === null) return null;
  const parts = draftProjectRootKey.split(":");
  if (parts.length !== 4 || parts[0] !== "remote") return null;
  try {
    const decoded = parts.slice(1).map(decodeURIComponent);
    if (decoded.some((part, index) => !part || encodeURIComponent(part) !== parts[index + 1]))
      return null;
    return { serverId: decoded[0]!, runnerId: decoded[1]!, projectId: decoded[2]! };
  } catch {
    return null;
  }
}

/** A connection/scope change revokes pending capability results, including A → B → A. */
export function useRemoteSurfaceContext({
  remote,
  thread,
  selectedThreadId,
  draftProjectRootKey,
}: {
  readonly remote: Pick<RemoteRunnerContextValue, "servers" | "surfacesGateway"> | null;
  readonly thread: AgentThreadView | null;
  readonly selectedThreadId: string | null;
  readonly draftProjectRootKey: string | null;
}): AgentRemoteSurface | null {
  const execution = thread?.execution;
  const candidate = remoteSurfaceScope(thread, selectedThreadId, draftProjectRootKey);
  const scopeRef = useRef(candidate);
  if (JSON.stringify(scopeRef.current) !== JSON.stringify(candidate)) scopeRef.current = candidate;
  const scope = scopeRef.current;
  const gateway = remote?.surfacesGateway ?? null;
  const server = remote?.servers.find((entry) => entry.id === scope?.serverId);
  const configuration = server === undefined ? null : JSON.stringify(server);
  const ownerRef = useRef({ scope, gateway, configuration });
  if (
    ownerRef.current.scope !== scope ||
    ownerRef.current.gateway !== gateway ||
    ownerRef.current.configuration !== configuration
  )
    ownerRef.current = { scope, gateway, configuration };
  const owner = ownerRef.current;
  const [state, setState] = useState<{ owner: object; value: AgentRemoteSurface } | null>(null);
  const paneKey =
    scope === null
      ? null
      : thread === null
        ? `remote-project:${JSON.stringify([scope.serverId, scope.runnerId, scope.projectId])}`
        : `remote-thread:${JSON.stringify([scope.serverId, scope.runnerId, execution!.conversationId])}`;
  const connected = server?.connected === true;
  useEffect(() => {
    if (scope === null || paneKey === null || gateway === null || !connected) return;
    let disposed = false;
    void gateway.capabilities(scope).then(
      (capabilities) => {
        if (disposed || ownerRef.current !== owner) return;
        setState({ owner, value: { paneKey, scope, gateway, capabilities, message: null } });
      },
      () => {
        if (disposed || ownerRef.current !== owner) return;
        setState({
          owner,
          value: {
            paneKey,
            scope,
            gateway: null,
            capabilities: UNAVAILABLE_CAPABILITIES,
            message: "Server panels are unavailable. Update the runner and reconnect.",
          },
        });
      },
    );
    return () => {
      disposed = true;
    };
  }, [scope, paneKey, gateway, connected, owner]);
  if (scope === null || paneKey === null) return null;
  if (state?.owner === owner) return state.value;
  return {
    paneKey,
    scope,
    gateway: null,
    capabilities: UNAVAILABLE_CAPABILITIES,
    message: !connected
      ? "Reconnect the server to use its panels."
      : gateway === null
        ? "Server panels are unavailable in this version."
        : "Loading server panels…",
  };
}
