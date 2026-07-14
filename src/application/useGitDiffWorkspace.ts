import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type Dispatch,
  type MutableRefObject,
  type SetStateAction,
} from "react";
import {
  buildGitDiffDocumentPath,
  isGitDiffDocumentPath,
} from "../domain/editorDocumentSchemes";
import type { GitChangedFile, GitFileDiff, GitGateway } from "../domain/git";
import type { EditorGroupsState } from "../domain/editorGroups";
import { getFileName, type EditorDocument } from "../domain/workspace";
import { workspaceRootKeysEqual } from "../domain/workspaceRootKey";

export { isGitDiffDocumentPath };

export interface OpenGitChangeOptions {
  pin?: boolean;
}

export interface GitDiffWorkspaceDependencies {
  workspaceRoot: string | null;
  gitGateway: GitGateway;
  currentWorkspaceRootRef: MutableRefObject<string | null>;
  activeDocumentRef: MutableRefObject<EditorDocument | null>;
  documentsRef: MutableRefObject<Record<string, EditorDocument>>;
  editorGroupsRef: MutableRefObject<EditorGroupsState>;
  openPathsRef: MutableRefObject<string[]>;
  previewPathRef: MutableRefObject<string | null>;
  setDocuments: Dispatch<SetStateAction<Record<string, EditorDocument>>>;
  setOpenPaths: Dispatch<SetStateAction<string[]>>;
  setPreviewPath: Dispatch<SetStateAction<string | null>>;
  setActivePath: Dispatch<SetStateAction<string | null>>;
  setMessage: Dispatch<SetStateAction<string | null>>;
  recordCurrentNavigationLocation: () => void;
  reportError: (source: string, error: unknown) => void;
}

export interface GitDiffWorkspace {
  gitDiffLoading: boolean;
  selectedGitChange: GitChangedFile | null;
  gitDiffPreview: GitFileDiff | null;
  gitDiffRequestTokenRef: MutableRefObject<number>;
  selectedGitChangeRef: MutableRefObject<GitChangedFile | null>;
  setGitDiffLoading: Dispatch<SetStateAction<boolean>>;
  setSelectedGitChange: Dispatch<SetStateAction<GitChangedFile | null>>;
  setGitDiffPreview: Dispatch<SetStateAction<GitFileDiff | null>>;
  resetGitDiffWorkspaceState: () => void;
  clearGitDiffPreviewState: () => void;
  loadGitDiffDocument: (path: string, gitChange: GitChangedFile) => void;
  previewGitChange: (
    change: GitChangedFile,
    options?: OpenGitChangeOptions,
  ) => Promise<void>;
  openGitChange: (change: GitChangedFile) => Promise<void>;
}

export function useGitDiffWorkspace(
  dependencies: GitDiffWorkspaceDependencies,
): GitDiffWorkspace {
  const {
    workspaceRoot,
    gitGateway,
    currentWorkspaceRootRef,
    activeDocumentRef,
    documentsRef,
    editorGroupsRef,
    openPathsRef,
    previewPathRef,
    setDocuments,
    setOpenPaths,
    setPreviewPath,
    setActivePath,
    setMessage,
    recordCurrentNavigationLocation,
    reportError,
  } = dependencies;

  const [gitDiffLoading, setGitDiffLoading] = useState(false);
  const [selectedGitChange, setSelectedGitChange] =
    useState<GitChangedFile | null>(null);
  const [gitDiffPreview, setGitDiffPreview] = useState<GitFileDiff | null>(
    null,
  );
  const gitDiffRequestTokenRef = useRef(0);
  const selectedGitChangeRef = useRef<GitChangedFile | null>(null);

  useEffect(() => {
    selectedGitChangeRef.current = selectedGitChange;
  }, [selectedGitChange]);

  const resetGitDiffWorkspaceState = useCallback(() => {
    setGitDiffLoading(false);
    selectedGitChangeRef.current = null;
    setSelectedGitChange(null);
    setGitDiffPreview(null);
  }, []);

  const clearGitDiffPreviewState = useCallback(() => {
    gitDiffRequestTokenRef.current += 1;
    resetGitDiffWorkspaceState();
    setMessage(null);
  }, [resetGitDiffWorkspaceState, setMessage]);

  const loadGitDiffDocument = useCallback(
    (path: string, gitChange: GitChangedFile) => {
      if (!workspaceRoot) {
        return;
      }

      const requestedRoot = workspaceRoot;
      const requestToken = gitDiffRequestTokenRef.current + 1;
      gitDiffRequestTokenRef.current = requestToken;
      recordCurrentNavigationLocation();
      selectedGitChangeRef.current = gitChange;
      setSelectedGitChange(gitChange);
      setGitDiffPreview(null);
      setGitDiffLoading(true);
      setActivePath(path);

      void gitGateway
        .getDiff(requestedRoot, gitChange)
        .then((diff) => {
          if (
            !workspaceRootKeysEqual(
              currentWorkspaceRootRef.current,
              requestedRoot,
            ) ||
            gitDiffRequestTokenRef.current !== requestToken
          ) {
            return;
          }

          setGitDiffPreview(diff);
          setMessage(`Diff ${gitChange.relativePath}`);
        })
        .catch((error) => {
          if (
            !workspaceRootKeysEqual(
              currentWorkspaceRootRef.current,
              requestedRoot,
            ) ||
            gitDiffRequestTokenRef.current !== requestToken
          ) {
            return;
          }

          setGitDiffPreview(null);
          reportError("Git Diff", error);
        })
        .finally(() => {
          if (
            !workspaceRootKeysEqual(
              currentWorkspaceRootRef.current,
              requestedRoot,
            ) ||
            gitDiffRequestTokenRef.current !== requestToken
          ) {
            return;
          }

          setGitDiffLoading(false);
        });
    },
    [
      currentWorkspaceRootRef,
      gitGateway,
      recordCurrentNavigationLocation,
      reportError,
      setActivePath,
      setMessage,
      workspaceRoot,
    ],
  );

  const previewGitChange = useCallback(
    async (change: GitChangedFile, options: OpenGitChangeOptions = {}) => {
      if (!workspaceRoot) {
        return;
      }

      if (
        !workspaceRootKeysEqual(currentWorkspaceRootRef.current, workspaceRoot)
      ) {
        return;
      }

      const requestedRoot = workspaceRoot;
      const requestToken = gitDiffRequestTokenRef.current + 1;
      const documentPath = gitDiffDocumentPath(change);
      const document = gitDiffDocument(change);
      const replacedPreviewPath = replaceableGitDiffPreviewPath(
        previewPathRef.current,
        documentPath,
        editorGroupsRef.current,
      );
      gitDiffRequestTokenRef.current = requestToken;
      recordCurrentNavigationLocation();
      const nextDocuments = {
        ...documentsRef.current,
        [documentPath]: documentsRef.current[documentPath] ?? document,
      };

      if (replacedPreviewPath) {
        delete nextDocuments[replacedPreviewPath];
      }

      documentsRef.current = nextDocuments;
      activeDocumentRef.current = documentsRef.current[documentPath] ?? document;
      setDocuments((current) => {
        const next = {
          ...current,
          [documentPath]: current[documentPath] ?? document,
        };

        if (replacedPreviewPath) {
          delete next[replacedPreviewPath];
        }

        return next;
      });
      if (options.pin === true) {
        openPathsRef.current = openPathsRef.current.includes(documentPath)
          ? openPathsRef.current
          : [...openPathsRef.current, documentPath];
        previewPathRef.current =
          previewPathRef.current === documentPath ||
            previewPathRef.current === replacedPreviewPath
            ? null
            : previewPathRef.current;
        setOpenPaths((current) =>
          current.includes(documentPath) ? current : [...current, documentPath],
        );
        setPreviewPath((current) =>
          current === documentPath || current === replacedPreviewPath
            ? null
            : current,
        );
      }
      if (options.pin !== true) {
        previewPathRef.current = documentPath;
        setPreviewPath(documentPath);
      }
      selectedGitChangeRef.current = change;
      setSelectedGitChange(change);
      setGitDiffPreview(null);
      setGitDiffLoading(true);
      setActivePath(documentPath);

      try {
        const diff = await gitGateway.getDiff(requestedRoot, change);

        if (
          !workspaceRootKeysEqual(
            currentWorkspaceRootRef.current,
            requestedRoot,
          ) ||
          gitDiffRequestTokenRef.current !== requestToken
        ) {
          return;
        }

        setGitDiffPreview(diff);
        setMessage(`Diff ${change.relativePath}`);
      } catch (error) {
        if (
          !workspaceRootKeysEqual(
            currentWorkspaceRootRef.current,
            requestedRoot,
          ) ||
          gitDiffRequestTokenRef.current !== requestToken
        ) {
          return;
        }

        setGitDiffPreview(null);
        reportError("Git Diff", error);
      } finally {
        if (
          !workspaceRootKeysEqual(
            currentWorkspaceRootRef.current,
            requestedRoot,
          ) ||
          gitDiffRequestTokenRef.current !== requestToken
        ) {
          return;
        }

        setGitDiffLoading(false);
      }
    },
    [
      activeDocumentRef,
      currentWorkspaceRootRef,
      documentsRef,
      editorGroupsRef,
      gitGateway,
      openPathsRef,
      previewPathRef,
      recordCurrentNavigationLocation,
      reportError,
      setActivePath,
      setDocuments,
      setMessage,
      setOpenPaths,
      setPreviewPath,
      workspaceRoot,
    ],
  );

  const openGitChange = useCallback(
    async (change: GitChangedFile) => {
      await previewGitChange(change, { pin: true });
    },
    [previewGitChange],
  );

  return {
    gitDiffLoading,
    selectedGitChange,
    gitDiffPreview,
    gitDiffRequestTokenRef,
    selectedGitChangeRef,
    setGitDiffLoading,
    setSelectedGitChange,
    setGitDiffPreview,
    resetGitDiffWorkspaceState,
    clearGitDiffPreviewState,
    loadGitDiffDocument,
    previewGitChange,
    openGitChange,
  };
}

export function gitDiffDocumentPath(change: GitChangedFile): string {
  const side = change.isStaged ? "staged" : "worktree";
  return buildGitDiffDocumentPath(side, change.path);
}

export function gitChangesReferToSameDiff(
  change: GitChangedFile,
  selectedChange: GitChangedFile,
): boolean {
  return (
    gitDiffDocumentPath(change) === gitDiffDocumentPath(selectedChange) &&
    (change.path === selectedChange.path ||
      change.oldPath === selectedChange.path)
  );
}

export function gitDiffDocument(change: GitChangedFile): EditorDocument {
  return {
    content: "",
    language: "plaintext",
    name: `Diff: ${getFileName(change.relativePath)}`,
    path: gitDiffDocumentPath(change),
    readOnly: true,
    savedContent: "",
  };
}

function replaceableGitDiffPreviewPath(
  previewPath: string | null,
  nextPath: string,
  editorGroups: EditorGroupsState,
): string | null {
  if (!previewPath || previewPath === nextPath) {
    return null;
  }

  if (!isGitDiffDocumentPath(previewPath)) {
    return null;
  }

  const activeGroup = editorGroups.groups[editorGroups.activeGroupId];
  if (activeGroup?.openPaths.includes(previewPath)) {
    return null;
  }

  const isReferencedByAnotherGroup = Object.entries(editorGroups.groups).some(
    ([groupId, group]) => {
      if (groupId === editorGroups.activeGroupId) {
        return false;
      }

      return (
        group.activePath === previewPath ||
        group.previewPath === previewPath ||
        group.openPaths.includes(previewPath)
      );
    },
  );
  if (isReferencedByAnotherGroup) {
    return null;
  }

  return previewPath;
}

export function gitChangeForDiffDocumentPath(
  path: string,
  changes: GitChangedFile[],
): GitChangedFile | null {
  return changes.find((change) => gitDiffDocumentPath(change) === path) ?? null;
}
