import { useLayoutEffect, useRef } from "react";
import { isInsideAgentSurfaceRoot } from "../../application/useAgentSurfaceFileTree";
import type { AgentSurfaceProjectDiffState } from "./AgentSurfaceProjectDiff";
import type { AgentWorkbenchScreenWorkbench } from "./AgentWorkbenchScreen";

type ProjectDiffWorkbench = Pick<
  AgentWorkbenchScreenWorkbench,
  | "workspaceRoot"
  | "gitStatus"
  | "gitRepositoryStatuses"
  | "gitLoading"
  | "gitStatusLoaded"
  | "gitDiffPreview"
  | "gitDiffLoading"
  | "refreshGitStatus"
  | "previewGitChange"
  | "openGitChange"
  | "closeGitDiffPreview"
> & { readonly workspaceIdentityDescriptor: { readonly workspaceId: string } | null };

export function useAgentProjectDiffChrome(
  workbench: ProjectDiffWorkbench,
): AgentSurfaceProjectDiffState | null {
  const mounted = useRef(true);
  useLayoutEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const rootPath = workbench.workspaceRoot;
  const ownerId = workbench.workspaceIdentityDescriptor?.workspaceId ?? null;
  const authority = useRef({ rootPath, ownerId, epoch: 0, workbench });
  const previous = authority.current;
  authority.current = {
    rootPath,
    ownerId,
    epoch: previous.epoch + Number(previous.rootPath !== rootPath || previous.ownerId !== ownerId),
    workbench,
  };
  const epoch = authority.current.epoch;
  if (rootPath === null || workbench.gitStatus === undefined) return null;
  const isCurrent = () => mounted.current && authority.current.epoch === epoch;
  const ownsChange = (path: string, repositoryRoot: string) => {
    if (!isCurrent() || !isInsideAgentSurfaceRoot(rootPath, repositoryRoot)) return false;
    if (!isInsideAgentSurfaceRoot(repositoryRoot, path)) return false;
    const current = authority.current.workbench;
    const repositories = current.gitRepositoryStatuses ?? [];
    return (
      repositories.some((entry) => entry.status.rootPath === repositoryRoot) ||
      current.gitStatus?.rootPath === repositoryRoot
    );
  };
  return {
    rootPath,
    status: workbench.gitStatus,
    repositoryStatuses: workbench.gitRepositoryStatuses ?? [],
    loading: (workbench.gitLoading ?? false) || workbench.gitStatusLoaded === false,
    diff: workbench.gitDiffPreview ?? null,
    diffLoading: workbench.gitDiffLoading ?? false,
    onRefresh: () => {
      if (!isCurrent()) return;
      void authority.current.workbench.refreshGitStatus?.();
    },
    onPreviewChange: (change, repositoryRoot) => {
      if (!ownsChange(change.path, repositoryRoot)) return;
      void authority.current.workbench.previewGitChange?.(change, { repositoryRoot });
    },
    onOpenChange: (change, repositoryRoot) => {
      if (!ownsChange(change.path, repositoryRoot)) return;
      void authority.current.workbench.openGitChange?.(change, repositoryRoot);
    },
    onClosePreview: () => {
      if (!isCurrent()) return;
      authority.current.workbench.closeGitDiffPreview?.();
    },
  };
}
