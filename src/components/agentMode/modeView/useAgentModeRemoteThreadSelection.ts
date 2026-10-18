import { useEffect, useMemo, useState } from "react";
import { parseRemoteAgentThreadIdentity } from "../../../domain/remoteAgentIdentity";
import {
  isRemoteThreadSelectionId,
  remoteThreadSelection,
  type RemoteThreadSelection,
} from "../../../domain/remoteThreadSelection";
import { useRemoteRunnerContext } from "../../remoteRunner/remoteRunnerContext";
import { projectRunsOn } from "../agentEnvironmentProjects";
import { NO_REMOTE_SERVERS } from "./agentModeViewProps";

export const REMOTE_THREAD_WAIT_MS = 15_000;
export const REMOTE_THREAD_MISSING_CONFIRM_MS = 1_000;

export interface AgentModeRemoteInventory {
  readonly selectedThreadId: string | null;
  readonly loading: boolean;
  readonly authoritativeProjectKeys: ReadonlySet<string>;
}

export const NO_REMOTE_INVENTORY: AgentModeRemoteInventory = {
  selectedThreadId: null,
  loading: false,
  authoritativeProjectKeys: new Set(),
};

export function useAgentModeRemoteThreadSelection(
  selectedThreadId: string | null,
  threadResolved: boolean,
  inventory: AgentModeRemoteInventory,
): RemoteThreadSelection {
  const remote = useRemoteRunnerContext();
  const servers = remote?.servers ?? NO_REMOTE_SERVERS;
  const serverList = remote?.serverList ?? "unavailable";
  const pendingThreadId =
    isRemoteThreadSelectionId(selectedThreadId) && !threadResolved ? selectedThreadId : null;
  const serverId = parseRemoteAgentThreadIdentity(pendingThreadId)?.serverId ?? null;
  const server = serverId === null ? undefined : servers.find((entry) => entry.id === serverId);
  const listCandidate =
    pendingThreadId !== null &&
    serverId !== null &&
    server?.connected === true &&
    inventory.selectedThreadId === pendingThreadId &&
    !inventory.loading &&
    [...inventory.authoritativeProjectKeys].some((key) => projectRunsOn(key, serverId));
  const threadListSettled = useKeyedDeadline(
    listCandidate ? pendingThreadId : null,
    REMOTE_THREAD_MISSING_CONFIRM_MS,
  );
  const waitExpired = useKeyedDeadline(
    pendingThreadId === null
      ? null
      : JSON.stringify([pendingThreadId, server?.connected ?? null, serverList]),
    REMOTE_THREAD_WAIT_MS,
  );
  return useMemo(
    () =>
      remoteThreadSelection({
        selectedThreadId,
        threadResolved,
        serverList,
        servers,
        threadListSettled,
        waitExpired,
      }),
    [selectedThreadId, serverList, servers, threadListSettled, threadResolved, waitExpired],
  );
}

function useKeyedDeadline(key: string | null, milliseconds: number): boolean {
  const [elapsedKey, setElapsedKey] = useState<string | null>(null);
  useEffect(() => {
    if (key === null) return;
    const timer = setTimeout(() => setElapsedKey(key), milliseconds);
    return () => {
      clearTimeout(timer);
      setElapsedKey(null);
    };
  }, [key, milliseconds]);
  return key !== null && elapsedKey === key;
}
