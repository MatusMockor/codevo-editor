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
import { getFileName, type EditorDocument } from "../domain/workspace";
import { workspaceRootKeysEqual } from "../domain/workspaceRootKey";
import type { DocumentTabSessionPort } from "./documentTabSessionPort";

export { isGitDiffDocumentPath };

export interface OpenGitChangeOptions {
  pin?: boolean;
}

export interface GitDiffWorkspaceDependencies {
  workspaceRoot: string | null;
  gitGateway: GitGateway;
  currentWorkspaceRootRef: MutableRefObject<string | null>;
  documentTabSession: DocumentTabSessionPort;
  setMessage: Dispatch<SetStateAction<string | null>>;
  recordCurrentNavigationLocation: () => void;
  reportError: (source: string, error: unknown) => void;
  onDocumentReplaced: (document: EditorDocument) => void;
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
    documentTabSession,
    setMessage,
    recordCurrentNavigationLocation,
    reportError,
    onDocumentReplaced,
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
      documentTabSession.activate(path);

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
      documentTabSession,
      gitGateway,
      recordCurrentNavigationLocation,
      reportError,
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
      const document = gitDiffDocument(change);
      gitDiffRequestTokenRef.current = requestToken;
      recordCurrentNavigationLocation();
      const commit = documentTabSession.openReadOnlyDocument(
        document,
        options.pin === true,
      );
      if (commit.replacedDocument) {
        onDocumentReplaced(commit.replacedDocument);
      }
      selectedGitChangeRef.current = change;
      setSelectedGitChange(change);
      setGitDiffPreview(null);
      setGitDiffLoading(true);

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
      currentWorkspaceRootRef,
      documentTabSession,
      gitGateway,
      onDocumentReplaced,
      recordCurrentNavigationLocation,
      reportError,
      setMessage,
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

export function gitChangeForDiffDocumentPath(
  path: string,
  changes: GitChangedFile[],
): GitChangedFile | null {
  return changes.find((change) => gitDiffDocumentPath(change) === path) ?? null;
}
