import { useEffect, useMemo, useRef } from "react";
import type { AgentThreadView } from "../../application/agentThreadPorts";
import { remoteAgentProjectKey } from "../../application/remoteAgentProjection";
import type { AgentComposerProjectOption } from "./agentComposerTarget";

export interface AgentComposerRecovery {
  readonly draftKey: string;
  activate(): boolean;
}

interface Options {
  readonly selectedThread: AgentThreadView | null;
  readonly projects: readonly AgentComposerProjectOption[];
  startNewThread(projectRootKey: string, repositoryRoot: string): void;
  selectEnvironment?(projectRootKey: string): void;
}

/** An explicit fresh draft, never a fallback that claims to resume provider context. */
export function useAgentComposerRecovery({
  selectedThread,
  projects,
  startNewThread,
  selectEnvironment,
}: Options): AgentComposerRecovery | null {
  const project = projects.find(
    (candidate) => candidate.projectRootKey === selectedThread?.thread.owner.rootKey,
  );
  const lease = useMemo(
    () => ({ selectedThread, project, startNewThread, selectEnvironment }),
    [selectedThread, project, startNewThread, selectEnvironment],
  );
  const current = useRef<object | null>(lease);
  current.current = lease;
  useEffect(() => {
    current.current = lease;
    return () => {
      current.current = null;
    };
  }, [lease]);
  return useMemo(() => {
    const { selectedThread, project, startNewThread, selectEnvironment } = lease;
    const execution = selectedThread?.execution;
    const thread = selectedThread?.thread;
    const latest = thread?.turns[thread.turns.length - 1];
    if (
      execution?.resume?.available !== false ||
      execution.resume.reason !== "session_unavailable" ||
      selectedThread?.lifecycle !== "settled" ||
      thread?.archived ||
      latest?.status.kind !== "stopped" ||
      latest.turnId !== execution.latestTaskId ||
      project === undefined ||
      thread === undefined
    )
      return null;
    const rootKey = remoteAgentProjectKey(
      execution.serverId,
      execution.runnerId,
      execution.projectId,
    );
    if (
      project.projectRootKey !== rootKey ||
      project.ownerId !== thread.owner.ownerId ||
      thread.owner.repositoryRoot !== rootKey
    )
      return null;
    let used = false;
    return {
      draftKey: `new:${rootKey}`,
      activate: () => {
        if (used || current.current !== lease) return false;
        used = true;
        selectEnvironment?.(rootKey);
        startNewThread(rootKey, rootKey);
        return true;
      },
    };
  }, [lease]);
}
