import { useCallback, useMemo } from "react";
import type { AgentTaskGateway } from "../domain/agentTask";
import type { GitGateway } from "../domain/git";
import {
  repositoryRootForMapping,
  resolveGitRepositoryForPath,
  type GitRepositoryMapping,
  type GitRepositoryStatus,
  type ResolvedGitRepository,
} from "../domain/gitRepositoryMapping";
import type { GitWorktreeGateway } from "../domain/gitWorktree";
import type { AppSettings, SettingsSection, WorkspaceSettings } from "../domain/settings";
import { isDirty, type EditorDocument } from "../domain/workspace";
import {
  useAgentTasks,
  type AgentRepositoryStatusSnapshot,
  type AgentTasksSurface,
} from "./useAgentTasks";
import type { WorkbenchPrompter } from "./workbenchPrompter";
import { defaultAgentTaskGateway, defaultGitWorktreeGateway } from "./workbenchDefaultGateways";

export interface WorkbenchAgentsOptions {
  readonly agentTaskGateway?: AgentTaskGateway;
  readonly gitWorktreeGateway?: GitWorktreeGateway;
  readonly appSettingsRef: { readonly current: AppSettings };
  readonly workspaceSettingsRef: { readonly current: WorkspaceSettings };
  readonly gitGateway: Pick<GitGateway, "getStatus" | "getDiff">;
  readonly gitRepositoryMappings: ReadonlyArray<GitRepositoryMapping>;
  readonly gitRepositoryStatuses: ReadonlyArray<GitRepositoryStatus>;
  readonly openDocuments: ReadonlyArray<EditorDocument>;
  readonly prompter: WorkbenchPrompter;
  readonly reportError: (source: string, error: unknown) => void;
  readonly setSettingsInitialSection: (section: SettingsSection) => void;
  readonly setSettingsOpen: (open: boolean) => void;
  readonly workspaceId: string | null;
  readonly workspaceRoot: string | null;
}

export function useWorkbenchAgents(options: WorkbenchAgentsOptions): AgentTasksSurface {
  const {
    gitRepositoryMappings,
    gitRepositoryStatuses,
    openDocuments,
    setSettingsInitialSection,
    setSettingsOpen,
    workspaceId,
    workspaceRoot,
  } = options;

  const resolvedRepositories = useMemo<ReadonlyArray<ResolvedGitRepository>>(() => {
    if (!workspaceRoot) {
      return [];
    }

    return gitRepositoryMappings.map((mapping) => ({
      mapping,
      repositoryRoot: repositoryRootForMapping(mapping, workspaceRoot),
      repositoryRelativePath: "",
    }));
  }, [gitRepositoryMappings, workspaceRoot]);

  const getRepositoryStatus = useCallback(
    (repositoryRoot: string): AgentRepositoryStatusSnapshot => {
      const entry = gitRepositoryStatuses.find((candidate) => candidate.root === repositoryRoot);

      if (!entry || entry.failed) {
        return { known: false, dirty: false };
      }

      return { known: true, dirty: entry.status.changes.length > 0 };
    },
    [gitRepositoryStatuses],
  );

  const getDirtyEditorDocumentCount = useCallback(
    (repositoryRoot: string): number => {
      if (!workspaceRoot) {
        return 0;
      }

      return openDocuments.filter((document) => {
        if (!isDirty(document)) {
          return false;
        }

        const resolved = resolveGitRepositoryForPath(
          [...gitRepositoryMappings],
          workspaceRoot,
          document.path,
        );

        return resolved?.repositoryRoot === repositoryRoot;
      }).length;
    },
    [gitRepositoryMappings, openDocuments, workspaceRoot],
  );

  const openAgentSettings = useCallback(() => {
    setSettingsInitialSection("agents");
    setSettingsOpen(true);
  }, [setSettingsInitialSection, setSettingsOpen]);

  return useAgentTasks({
    agentTaskGateway: options.agentTaskGateway ?? defaultAgentTaskGateway,
    gitWorktreeGateway: options.gitWorktreeGateway ?? defaultGitWorktreeGateway,
    gitGateway: options.gitGateway,
    prompter: options.prompter,
    resolvedRepositories,
    getWorkspaceId: () => workspaceId,
    getWorkspaceRoot: () => workspaceRoot,
    getAgentCliPath: () => options.appSettingsRef.current.agentCliPath,
    getAgentCliKind: () => options.appSettingsRef.current.agentCliKind,
    getMaxConcurrentAgentTasks: () => options.appSettingsRef.current.maxConcurrentAgentTasks,
    getAgentIsolationPolicy: () => options.workspaceSettingsRef.current.agentIsolationPolicy,
    getRepositoryStatus,
    getDirtyEditorDocumentCount,
    reportError: options.reportError,
    openAgentSettings,
  });
}
