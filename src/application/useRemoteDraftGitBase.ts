import { useCallback, useEffect, useMemo, useState } from "react";
import type { AgentWorktreeBase } from "../domain/agentWorktreeBase";
import { remoteDefaultBase } from "../domain/remoteDraftGitBase";
import type {
  RemoteGitBranchList,
  RemoteGitProjectKey,
  RemoteGitSyncPort,
} from "../domain/remoteGitSync";
import type { AgentThreadView, RemoteAgentGitAccess } from "./agentThreadPorts";
import { remoteAgentProjectKey } from "./remoteAgentProjection";

export interface RemoteComposerGit {
  readonly key: string;
  readonly revision: string;
  readonly port: RemoteGitSyncPort;
  readonly project: RemoteGitProjectKey;
}

/** A remote thread addresses its own project; a draft addresses the composer's project. */
export function remoteComposerProjectRootKey(
  projectRootKey: string | null,
  thread: AgentThreadView | null,
): string | null {
  const execution = thread?.execution;
  if (execution?.kind === "remote")
    return remoteAgentProjectKey(execution.serverId, execution.runnerId, execution.projectId);
  if (thread === null) return projectRootKey;
  return null;
}

export function useRemoteComposerGit(
  access: RemoteAgentGitAccess | undefined,
  projectRootKey: string | null,
  thread: AgentThreadView | null,
): RemoteComposerGit | null {
  const execution = thread?.execution;
  const rootKey = remoteComposerProjectRootKey(projectRootKey, thread);
  const project = rootKey === null ? null : (access?.project(rootKey) ?? null);
  const key =
    project === null
      ? null
      : JSON.stringify([project.serverId, project.runnerId, project.projectId]);
  const port = access?.port ?? null;
  const revision = JSON.stringify([
    execution?.kind === "remote" ? execution.latestTaskId : null,
    thread?.lifecycle ?? null,
  ]);
  return useMemo(() => {
    if (key === null || port === null) return null;
    const [serverId, runnerId, projectId] = JSON.parse(key) as [string, string, string];
    return { key, revision, port, project: { serverId, runnerId, projectId } };
  }, [key, port, revision]);
}

export interface RemoteDraftGitBaseOptions {
  readonly enabled: boolean;
  readonly branches: RemoteGitBranchList | null;
  readonly base: AgentWorktreeBase;
  onBaseChange(base: AgentWorktreeBase): void;
}

export interface RemoteDraftGitBase {
  readonly explicit: boolean;
  choose(base: AgentWorktreeBase): void;
}

export function useRemoteDraftGitBase({
  base,
  branches,
  enabled,
  onBaseChange,
}: RemoteDraftGitBaseOptions): RemoteDraftGitBase {
  const [explicit, setExplicit] = useState(false);
  const preferred = branches === null ? null : remoteDefaultBase(branches);
  const preferredRef = preferred?.kind === "ref" ? preferred.ref : null;
  useEffect(() => {
    if (!enabled || explicit || base.kind !== "head" || preferredRef === null) return;
    onBaseChange({ kind: "ref", ref: preferredRef });
  }, [base.kind, enabled, explicit, onBaseChange, preferredRef]);
  const choose = useCallback(
    (next: AgentWorktreeBase) => {
      setExplicit(true);
      onBaseChange(next);
    },
    [onBaseChange],
  );
  return { explicit, choose };
}
