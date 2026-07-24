import { useCallback, type Dispatch, type MutableRefObject, type SetStateAction } from "react";
import type { BottomPanelView } from "../domain/bottomPanel";
import type { GitBlameLine, GitGateway } from "../domain/git";
import { getFileName, type EditorDocument, type WorkspaceFileGateway } from "../domain/workspace";
import { workspaceRootKeysEqual } from "../domain/workspaceRootKey";
import type { OpenFileOptions } from "./useWorkbenchDocumentTabs";
import type { GitRepositoryTarget } from "./useGitStatusSurface";

export interface OpenWorkspaceFileRequest {
  canOpen(): boolean;
}

interface WorkbenchGitFileActionsDependencies {
  activeDocumentRef: MutableRefObject<EditorDocument | null>;
  currentWorkspaceRootRef: MutableRefObject<string | null>;
  gitGateway: Pick<GitGateway, "blame">;
  openFile: (
    entry: { kind: "file"; name: string; path: string },
    options?: OpenFileOptions,
  ) => Promise<boolean>;
  openFileHistory: (selectedSha?: string) => Promise<void>;
  resolveGitRepositoryTarget: (path: string) => GitRepositoryTarget | null;
  setGitBlameEnabledPaths: Dispatch<SetStateAction<Set<string>>>;
  showBottomPanelView: (view: BottomPanelView) => void;
  workspaceFiles: Pick<WorkspaceFileGateway, "readTextFile">;
}

export function useWorkbenchGitFileActions({
  activeDocumentRef,
  currentWorkspaceRootRef,
  gitGateway,
  openFile,
  openFileHistory,
  resolveGitRepositoryTarget,
  setGitBlameEnabledPaths,
  showBottomPanelView,
  workspaceFiles,
}: WorkbenchGitFileActionsDependencies) {
  const toggleGitBlame = useCallback(() => {
    const document = activeDocumentRef.current;
    if (!document) return;

    setGitBlameEnabledPaths((current) => {
      const next = new Set(current);
      if (next.has(document.path)) next.delete(document.path);
      else next.add(document.path);
      return next;
    });
  }, [activeDocumentRef, setGitBlameEnabledPaths]);

  const provideGitBlame = useCallback(
    async (path: string): Promise<GitBlameLine[]> => {
      const target = resolveGitRepositoryTarget(path);
      return target ? gitGateway.blame(target.repositoryRoot, target.relativePath) : [];
    },
    [gitGateway, resolveGitRepositoryTarget],
  );

  const readWorkspaceFile = useCallback(
    (path: string): Promise<string> => workspaceFiles.readTextFile(path),
    [workspaceFiles],
  );

  const openWorkspaceFile = useCallback(
    async (path: string, request: OpenWorkspaceFileRequest): Promise<boolean> => {
      const requestedRoot = currentWorkspaceRootRef.current;
      const normalizedPath = normalizeAbsoluteWorkspacePath(path);
      if (
        !requestedRoot ||
        !normalizedPath ||
        !absolutePathBelongsInsideRoot(normalizedPath, requestedRoot)
      ) {
        return false;
      }

      const isCurrentRequest = () =>
        request.canOpen() && workspaceRootKeysEqual(currentWorkspaceRootRef.current, requestedRoot);
      if (!isCurrentRequest()) return false;

      const opened = await openFile(
        { kind: "file", name: getFileName(normalizedPath), path: normalizedPath },
        { shouldCommit: isCurrentRequest },
      );
      return opened && isCurrentRequest() && activeDocumentRef.current?.path === normalizedPath;
    },
    [activeDocumentRef, currentWorkspaceRootRef, openFile],
  );

  const revealCommitInFileHistory = useCallback(
    async (path: string, sha: string) => {
      const requestedRoot = currentWorkspaceRootRef.current;
      if (!requestedRoot || activeDocumentRef.current?.path !== path || !sha) return;

      showBottomPanelView("history");
      await openFileHistory(sha);
      if (
        !workspaceRootKeysEqual(currentWorkspaceRootRef.current, requestedRoot) ||
        activeDocumentRef.current?.path !== path
      ) {
        return;
      }
    },
    [activeDocumentRef, currentWorkspaceRootRef, openFileHistory, showBottomPanelView],
  );

  return {
    openWorkspaceFile,
    provideGitBlame,
    readWorkspaceFile,
    revealCommitInFileHistory,
    toggleGitBlame,
  };
}

function absolutePathBelongsInsideRoot(path: string, root: string): boolean {
  const normalizedRoot = normalizeAbsoluteWorkspacePath(root);
  const normalizedPath = normalizeAbsoluteWorkspacePath(path);
  if (!normalizedRoot || !normalizedPath || normalizedPath === normalizedRoot) return false;
  return normalizedPath.startsWith(
    normalizedRoot.endsWith("/") ? normalizedRoot : `${normalizedRoot}/`,
  );
}

function normalizeAbsoluteWorkspacePath(path: string): string | null {
  const normalizedSeparators = path.trim().split("\\").join("/");
  const driveMatch = /^[A-Za-z]:\//.exec(normalizedSeparators);
  const prefix = driveMatch
    ? normalizedSeparators.slice(0, 2).toLowerCase()
    : normalizedSeparators.startsWith("/")
      ? ""
      : null;
  if (prefix === null) return null;

  const rest = driveMatch ? normalizedSeparators.slice(3) : normalizedSeparators.slice(1);
  const segments: string[] = [];
  for (const segment of rest.split("/")) {
    if (!segment || segment === ".") continue;
    if (segment === "..") {
      if (segments.length === 0) return null;
      segments.pop();
    } else {
      segments.push(segment);
    }
  }

  if (prefix) return segments.length > 0 ? `${prefix}/${segments.join("/")}` : `${prefix}/`;
  return `/${segments.join("/")}`;
}
