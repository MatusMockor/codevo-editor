import { useCallback, useEffect, useLayoutEffect, useMemo, useRef } from "react";
import type { AgentProjectDescriptor } from "../domain/agentProject";
import type { AgentShipAvailability } from "../domain/agentShip";
import type { AgentThread } from "../domain/agentThread";
import type { AgentSurfaceKind } from "../domain/agentWorkbenchLayout";
import type { GitChangedFile } from "../domain/git";
import type { FileEntry } from "../domain/workspace";
import {
  AGENT_TASKS_SOURCE,
  attempt,
  isCurrentProjectOwner,
  projectAuthority,
  projectByOwnerId,
} from "./agentProjectAuthority";

export const EDITOR_UNAVAILABLE_REASON = "The editor is not available here.";
export const PROJECT_CLOSED_REASON = "This project is no longer open.";
export const SWITCH_TAB_REASON = "Switch to this project's tab to open files.";
export const OUTSIDE_TARGET_REASON = "This file is outside the thread's checkout.";
export const DELETED_FILE_REASON = "Deleted files can only be opened as a diff.";

export interface AgentEditorBridgePort {
  openFile(
    entry: FileEntry,
    options: { readonly pin: true; readonly recordNavigation: true },
  ): Promise<boolean>;
  openGitChange(change: GitChangedFile, repositoryRoot: string): Promise<void>;
  openSurface(surface: AgentSurfaceKind): void;
}

export const EDITOR_BRIDGE_SURFACE: AgentSurfaceKind = "files";

export interface AgentEditorBridgeDependencies {
  readonly projects: ReadonlyArray<AgentProjectDescriptor>;
  readonly threads: ReadonlyMap<string, AgentThread>;
  readonly editor: AgentEditorBridgePort | null;
  readonly reportError: (source: string, error: unknown) => void;
}

export interface AgentEditorBridgeSurface {
  canOpenInEditor(threadId: string): AgentShipAvailability;
  openChangedFile(threadId: string, change: GitChangedFile): Promise<void>;
  openChangedFileDiff(threadId: string, change: GitChangedFile): Promise<void>;
}

interface EditorTarget {
  readonly project: AgentProjectDescriptor;
  readonly ownerId: string;
  readonly repositoryRoot: string;
  readonly targetPath: string;
}

const AVAILABLE: AgentShipAvailability = Object.freeze({ kind: "available" });

export function useAgentEditorBridge(
  dependencies: AgentEditorBridgeDependencies,
): AgentEditorBridgeSurface {
  const dependenciesRef = useRef(dependencies);
  const mountedRef = useRef(true);

  useLayoutEffect(() => {
    dependenciesRef.current = dependencies;
  });

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const { projects, threads, editor } = dependencies;

  const canOpenInEditor = useCallback(
    (threadId: string): AgentShipAvailability =>
      availabilityFor(projects, threads, editor, threadId),
    [editor, projects, threads],
  );

  const resolveTarget = useCallback(
    (threadId: string, change: GitChangedFile): EditorTarget | null => {
      const deps = dependenciesRef.current;
      const availability = availabilityFor(deps.projects, deps.threads, deps.editor, threadId);
      if (availability.kind === "blocked") return null;
      const thread = deps.threads.get(threadId);
      if (thread === undefined) return null;
      const project = projectByOwnerId(deps.projects, thread.owner.ownerId);
      if (project === undefined) return null;
      const targetPath = thread.target.worktreePath ?? thread.owner.repositoryRoot;
      if (!isInside(targetPath, change.path)) return null;
      return {
        project,
        ownerId: thread.owner.ownerId,
        repositoryRoot: thread.owner.repositoryRoot,
        targetPath,
      };
    },
    [],
  );

  const openChangedFile = useCallback(
    async (threadId: string, change: GitChangedFile): Promise<void> => {
      const target = resolveTarget(threadId, change);
      if (target === null || change.status === "deleted") return;
      const editorPort = dependenciesRef.current.editor;
      if (editorPort === null) return;
      const authority = projectAuthority(target.project, target.ownerId);
      const opened = await attempt(() =>
        editorPort.openFile(
          { name: fileName(change.path), path: change.path, kind: "file" },
          { pin: true, recordNavigation: true },
        ),
      );
      if (!isCurrentProjectOwner(dependenciesRef, mountedRef, authority, target.repositoryRoot)) {
        return;
      }
      if (!opened.ok) {
        dependenciesRef.current.reportError(AGENT_TASKS_SOURCE, opened.error);
        return;
      }
      if (!opened.value) return;
      editorPort.openSurface(EDITOR_BRIDGE_SURFACE);
    },
    [resolveTarget],
  );

  const openChangedFileDiff = useCallback(
    async (threadId: string, change: GitChangedFile): Promise<void> => {
      const target = resolveTarget(threadId, change);
      if (target === null) return;
      const editorPort = dependenciesRef.current.editor;
      if (editorPort === null) return;
      const authority = projectAuthority(target.project, target.ownerId);
      const opened = await attempt(() => editorPort.openGitChange(change, target.targetPath));
      if (!isCurrentProjectOwner(dependenciesRef, mountedRef, authority, target.repositoryRoot)) {
        return;
      }
      if (!opened.ok) {
        dependenciesRef.current.reportError(AGENT_TASKS_SOURCE, opened.error);
        return;
      }
      editorPort.openSurface(EDITOR_BRIDGE_SURFACE);
    },
    [resolveTarget],
  );

  return useMemo(
    () => ({ canOpenInEditor, openChangedFile, openChangedFileDiff }),
    [canOpenInEditor, openChangedFile, openChangedFileDiff],
  );
}

function availabilityFor(
  projects: ReadonlyArray<AgentProjectDescriptor>,
  threads: ReadonlyMap<string, AgentThread>,
  editor: AgentEditorBridgePort | null,
  threadId: string,
): AgentShipAvailability {
  if (editor === null) return { kind: "blocked", reason: EDITOR_UNAVAILABLE_REASON };
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

function fileName(path: string): string {
  const segments = path.split("/").filter((segment) => segment !== "");
  return segments[segments.length - 1] ?? path;
}
