import { useCallback, type MutableRefObject } from "react";
import { runningTurn } from "../../domain/agentThread";
import type { GitGateway } from "../../domain/git";
import type { FileSearchGateway } from "../../domain/workspace";
import { agentBranchCheckoutGuardReason } from "../agentBranchCheckoutGuard";
import type { WorkbenchAgentsSurface } from "../useWorkbenchAgents";
import {
  useAgentPaletteBranchSource,
  type AgentPaletteBranchOwner,
} from "./useAgentPaletteBranchSource";
import { useAgentPaletteFiles } from "./useAgentPaletteFiles";

export interface AgentPaletteSourcesOptions {
  readonly agents: Pick<WorkbenchAgentsSurface, "agentProjects" | "dispatching" | "threads">;
  readonly currentWorkspaceRootRef: MutableRefObject<string | null>;
  readonly fileSearch: FileSearchGateway;
  readonly gitGateway: GitGateway;
  readonly owner: AgentPaletteBranchOwner | null;
  readonly paletteOpen: boolean;
  readonly refreshGitStatus: () => Promise<void>;
  readonly workspaceRoot: string | null;
  readonly workspaceTrusted: boolean;
}

export function useAgentPaletteSources({
  agents,
  currentWorkspaceRootRef,
  fileSearch,
  gitGateway,
  owner,
  paletteOpen,
  refreshGitStatus,
  workspaceRoot,
  workspaceTrusted,
}: AgentPaletteSourcesOptions) {
  const { agentProjects, dispatching, threads } = agents;
  const checkoutGuard = useCallback(
    (rootPath: string) =>
      agentBranchCheckoutGuardReason(rootPath, {
        dispatching,
        projects: agentProjects.projects,
        threads: threads.map(({ thread }) => ({
          projectRootKey: thread.owner.rootKey,
          rootPath: thread.target.worktreePath ?? thread.owner.repositoryRoot,
          running: runningTurn(thread) !== null,
        })),
        workspaceRoot,
        workspaceTrusted,
      }),
    [agentProjects.projects, dispatching, threads, workspaceRoot, workspaceTrusted],
  );
  const branchSource = useAgentPaletteBranchSource({
    checkoutGuard,
    currentWorkspaceRootRef,
    gitGateway,
    owner,
    refreshGitStatus,
  });
  const files = useAgentPaletteFiles({ active: paletteOpen, fileSearch, workspaceRoot });
  return { branchSource, files };
}
