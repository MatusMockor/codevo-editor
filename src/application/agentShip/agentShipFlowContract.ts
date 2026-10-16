import type { AgentProjectDescriptor } from "../../domain/agentProject";
import type {
  AgentShipIntegrationMode,
  AgentShipState,
  AgentShipStepResult,
} from "../../domain/agentShip";
import type { AgentThread, AgentThreadsAction } from "../../domain/agentThread";
import type { GitGateway } from "../../domain/git";
import type { AgentCommitSelection } from "../../domain/gitCommitSelection";
import type { GitIntegrationGateway } from "../../domain/gitIntegration";
import type { GitWorktreeGateway } from "../../domain/gitWorktree";
import type { AgentTasksNotice } from "../agentThreadPorts";
import type { WorkbenchPrompter } from "../workbenchPrompter";
import type { AgentWorktreeUseRegistry } from "../agentWorktreeUseRegistry";

export const AGENT_SHIP_STATUS_FRESHNESS_MS = 30_000;
export const DIRTY_WORKTREE_REMOVE_CONFIRMATION =
  "This worktree has uncommitted changes. Remove it and discard them?";

export interface ExternalUrlOpenerPort {
  openExternal(url: string): Promise<void>;
}

export interface AgentShipFlowDependencies {
  readonly gitGateway: Pick<GitGateway, "getStatus" | "stageFiles" | "commit" | "deleteBranch">;
  readonly gitIntegrationGateway: GitIntegrationGateway;
  readonly gitWorktreeGateway: Pick<GitWorktreeGateway, "removeWorktree">;
  readonly externalUrlOpener: ExternalUrlOpenerPort | null;
  readonly prompter: WorkbenchPrompter;
  readonly projects: ReadonlyArray<AgentProjectDescriptor>;
  readonly threads: ReadonlyMap<string, AgentThread>;
  readonly missingWorktreeThreadIds: ReadonlySet<string>;
  readonly dispatchThreadAction: (action: AgentThreadsAction) => void;
  readonly reportError: (source: string, error: unknown) => void;
  readonly setNotice: (notice: AgentTasksNotice | null) => void;
  readonly onWorktreeRemoved: (threadId: string) => void;
  readonly onShipStepCompleted?: (threadId: string) => void;
  readonly now?: () => number;
  readonly worktreeUses?: AgentWorktreeUseRegistry;
  readonly currentThreads?: () => ReadonlyMap<string, AgentThread>;
}

export interface AgentShipFlowSurface {
  readonly states: ReadonlyMap<string, AgentShipState>;
  refreshShipStatus(threadId: string): Promise<void>;
  commit(
    threadId: string,
    message: string,
    selection?: AgentCommitSelection,
  ): Promise<AgentShipStepResult>;
  push(threadId: string): Promise<AgentShipStepResult>;
  openCompareUrl(threadId: string): Promise<void>;
  integrate(threadId: string, mode: AgentShipIntegrationMode): Promise<void>;
  removeWorktree(threadId: string, options: { readonly deleteBranch: boolean }): Promise<void>;
  resetShip(threadId: string): void;
  clear(threadId: string): void;
}
