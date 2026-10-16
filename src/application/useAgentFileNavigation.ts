import { useCallback, useLayoutEffect, useMemo, useRef } from "react";
import type { AgentProjectDescriptor } from "../domain/agentProject";
import type { AgentShipAvailability } from "../domain/agentShip";
import type { AgentThread } from "../domain/agentThread";
import type { AgentSurfaceKind } from "../domain/agentWorkbenchLayout";
import type { GitChangedFile } from "../domain/git";
import { projectByOwnerId } from "./agentProjectAuthority";

export const FILE_NAVIGATION_UNAVAILABLE_REASON = "Files can't be opened here.";
export const PROJECT_CLOSED_REASON = "This project is no longer open.";
export const SWITCH_TAB_REASON = "Switch to this project's tab to open files.";
export const DELETED_FILE_REASON = "Deleted files can only be opened as a diff.";

export interface AgentFileNavigationPort {
  revealFile(path: string): void;
  openSurface(surface: AgentSurfaceKind): void;
}

export const CHANGED_FILE_DIFF_SURFACE: AgentSurfaceKind = "diff";

export interface AgentFileNavigationDependencies {
  readonly projects: ReadonlyArray<AgentProjectDescriptor>;
  readonly threads: ReadonlyMap<string, AgentThread>;
  readonly navigation: AgentFileNavigationPort | null;
  readonly reportError: (source: string, error: unknown) => void;
}

export interface AgentFileNavigationSurface {
  canOpenFiles(threadId: string): AgentShipAvailability;
  openChangedFile(threadId: string, change: GitChangedFile): Promise<void>;
  openChangedFileDiff(threadId: string, change: GitChangedFile): Promise<void>;
}

const AVAILABLE: AgentShipAvailability = Object.freeze({ kind: "available" });

export function useAgentFileNavigation(
  dependencies: AgentFileNavigationDependencies,
): AgentFileNavigationSurface {
  const dependenciesRef = useRef(dependencies);

  useLayoutEffect(() => {
    dependenciesRef.current = dependencies;
  });

  const { projects, threads, navigation } = dependencies;

  const canOpenFiles = useCallback(
    (threadId: string): AgentShipAvailability =>
      availabilityFor(projects, threads, navigation, threadId),
    [navigation, projects, threads],
  );

  const servingPort = useCallback(
    (threadId: string, change: GitChangedFile): AgentFileNavigationPort | null => {
      const deps = dependenciesRef.current;
      const availability = availabilityFor(deps.projects, deps.threads, deps.navigation, threadId);
      if (availability.kind === "blocked") return null;
      const thread = deps.threads.get(threadId);
      if (thread === undefined) return null;
      const targetPath = thread.target.worktreePath ?? thread.owner.repositoryRoot;
      if (!isInside(targetPath, change.path)) return null;
      return deps.navigation;
    },
    [],
  );

  const openChangedFile = useCallback(
    async (threadId: string, change: GitChangedFile): Promise<void> => {
      if (change.status === "deleted") return;
      servingPort(threadId, change)?.revealFile(change.path);
    },
    [servingPort],
  );

  const openChangedFileDiff = useCallback(
    async (threadId: string, change: GitChangedFile): Promise<void> => {
      servingPort(threadId, change)?.openSurface(CHANGED_FILE_DIFF_SURFACE);
    },
    [servingPort],
  );

  return useMemo(
    () => ({ canOpenFiles, openChangedFile, openChangedFileDiff }),
    [canOpenFiles, openChangedFile, openChangedFileDiff],
  );
}

function availabilityFor(
  projects: ReadonlyArray<AgentProjectDescriptor>,
  threads: ReadonlyMap<string, AgentThread>,
  navigation: AgentFileNavigationPort | null,
  threadId: string,
): AgentShipAvailability {
  if (navigation === null) return { kind: "blocked", reason: FILE_NAVIGATION_UNAVAILABLE_REASON };
  const thread = threads.get(threadId);
  if (thread === undefined) return { kind: "blocked", reason: PROJECT_CLOSED_REASON };
  const project = projectByOwnerId(projects, thread.owner.ownerId);
  if (project === undefined) return { kind: "blocked", reason: PROJECT_CLOSED_REASON };
  if (project.origin !== "active-tab") return { kind: "blocked", reason: SWITCH_TAB_REASON };
  return AVAILABLE;
}

function isInside(root: string, path: string): boolean {
  return path.startsWith(`${root}/`) && !path.split("/").includes("..");
}
