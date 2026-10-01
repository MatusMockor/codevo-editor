import { useMemo, useRef } from "react";
import type { AgentThreadView } from "../../application/agentThreadPorts";
import {
  agentThreadBranchOf,
  type AgentThreadBranchMemory,
} from "../../domain/agentThreadBranchMemory";
import type { AgentTaskIsolation } from "../../domain/agentTask";
import type { AgentComposerPreviousWorktree } from "./agentComposerPreviousWorktree";
import type { AgentComposerServerName } from "./agentComposerThreadLocation";
import type { AgentLiveCheckoutBranches } from "./agentLiveCheckoutBranch";
import {
  agentWorkspaceCard,
  agentWorkspaceCardEqual,
  type AgentWorkspaceCard,
  type AgentWorkspaceCardProject,
} from "./agentWorkspaceCardModel";

export interface AgentWorkspaceCardSource {
  readonly project: AgentWorkspaceCardProject | null;
  readonly thread: AgentThreadView | null;
  readonly draftIsolation: AgentTaskIsolation;
  readonly draftPreviousWorktree: AgentComposerPreviousWorktree | null;
  readonly draftServerId: string | null;
  readonly servers: ReadonlyArray<AgentComposerServerName>;
  readonly liveBranches: AgentLiveCheckoutBranches | null | undefined;
  readonly branchMemory: AgentThreadBranchMemory;
}

const UNKNOWN_SERVER_NAME = "Server";

export function useAgentWorkspaceCard(source: AgentWorkspaceCardSource): AgentWorkspaceCard | null {
  const {
    branchMemory,
    draftIsolation,
    draftPreviousWorktree,
    draftServerId,
    liveBranches,
    project,
    servers,
    thread,
  } = source;
  const next = useMemo(() => {
    if (project === null) return null;
    if (thread !== null) {
      const owner = thread.thread.owner;
      return agentWorkspaceCard({
        kind: "thread",
        project,
        view: thread,
        servers,
        liveBranches,
        rememberedBranch: agentThreadBranchOf(branchMemory, {
          threadId: thread.thread.threadId,
          rootKey: owner.rootKey,
          ownerId: owner.ownerId,
        }),
      });
    }
    return agentWorkspaceCard({
      kind: "draft",
      project,
      isolation: draftIsolation,
      serverName: draftServerName(draftServerId, servers),
      previousWorktree: draftPreviousWorktree,
      liveBranches,
    });
  }, [
    branchMemory,
    draftIsolation,
    draftPreviousWorktree,
    draftServerId,
    liveBranches,
    project,
    servers,
    thread,
  ]);
  const stableRef = useRef<AgentWorkspaceCard | null>(next);
  if (!agentWorkspaceCardEqual(stableRef.current, next)) stableRef.current = next;
  return stableRef.current;
}

function draftServerName(
  serverId: string | null,
  servers: ReadonlyArray<AgentComposerServerName>,
): string | null {
  if (serverId === null) return null;
  return servers.find((server) => server.id === serverId)?.name ?? UNKNOWN_SERVER_NAME;
}
