import { useMemo } from "react";
import {
  agentDiffRevisionKey,
  type WorkingTreeRepository,
} from "../../../application/rightPanel/agentDiffSources";
import type { GitRepositoryStatus } from "../../../domain/gitRepositoryMapping";
import type { TextClipboardGateway } from "../../../domain/textClipboard";
import type { AgentRightPanelGateways } from "./agentRightPanelGateways";

export interface AgentRightPanelChrome {
  readonly gateways: AgentRightPanelGateways;
  readonly projectRepositories: ReadonlyArray<WorkingTreeRepository>;
  readonly unreadableRepositories: boolean;
  readonly statusRevision: number;
  copyText(text: string): Promise<void>;
}

export interface AgentRightPanelChromeInput {
  readonly gateways: AgentRightPanelGateways;
  readonly workspaceRoot: string | null;
  readonly repositoryStatuses: ReadonlyArray<GitRepositoryStatus> | null | undefined;
  readonly clipboard: TextClipboardGateway;
}

export function useAgentRightPanelChrome({
  clipboard,
  gateways,
  repositoryStatuses,
  workspaceRoot,
}: AgentRightPanelChromeInput): AgentRightPanelChrome | null {
  return useMemo(() => {
    if (workspaceRoot === null) return null;
    const statuses = repositoryStatuses ?? [];
    return {
      gateways,
      projectRepositories: projectRepositories(workspaceRoot, statuses),
      unreadableRepositories: statuses.some((status) => status.failed),
      statusRevision: agentDiffRevisionKey(repositoryStatuses ?? undefined),
      copyText: (text: string) => clipboard.writeText(text),
    };
  }, [clipboard, gateways, repositoryStatuses, workspaceRoot]);
}

function projectRepositories(
  workspaceRoot: string,
  statuses: ReadonlyArray<GitRepositoryStatus>,
): ReadonlyArray<WorkingTreeRepository> {
  const roots = statuses.filter((status) => !status.failed).map((status) => status.root);
  const unique = roots.length === 0 ? [workspaceRoot] : [...new Set(roots)];
  return unique.map((root) => ({
    root,
    prefix:
      root === workspaceRoot || !root.startsWith(`${workspaceRoot}/`)
        ? ""
        : `${root.slice(workspaceRoot.length + 1)}/`,
  }));
}
