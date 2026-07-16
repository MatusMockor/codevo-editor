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
  repositoryRoot?: string;
}

export interface GitDiffDocumentState {
  change: GitChangedFile;
  diff: GitFileDiff | null;
  documentPath: string;
  isLoading: boolean;
  repositoryRoot: string;
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
  gitDiffDocuments: Record<string, GitDiffDocumentState>;
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
  cancelGitDiffDocument: (path: string) => void;
  getGitDiffDocument: (path: string) => GitDiffDocumentState | null;
  getSelectedGitDiffDocument: () => GitDiffDocumentState | null;
  loadGitDiffDocument: (path: string, gitChange?: GitChangedFile) => void;
  reloadGitDiffDocument: (path: string) => void;
  reconcileGitDiffDocument: (
    path: string,
    gitChange: GitChangedFile,
  ) => void;
  previewGitChange: (
    change: GitChangedFile,
    options?: OpenGitChangeOptions,
  ) => Promise<void>;
  openGitChange: (
    change: GitChangedFile,
    repositoryRoot?: string,
  ) => Promise<void>;
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
  const [gitDiffDocuments, setGitDiffDocuments] = useState<
    Record<string, GitDiffDocumentState>
  >({});
  const gitDiffDocumentsRef = useRef<Record<string, GitDiffDocumentState>>({});
  const gitDiffRequestTokenRef = useRef(0);
  const requestTokenByDocumentPathRef = useRef<Record<string, number>>({});
  const selectedGitChangeRef = useRef<GitChangedFile | null>(null);
  const selectedGitDiffDocumentPathRef = useRef<string | null>(null);

  useEffect(() => {
    selectedGitChangeRef.current = selectedGitChange;
  }, [selectedGitChange]);

  const resetGitDiffWorkspaceState = useCallback(() => {
    gitDiffRequestTokenRef.current += 1;
    setGitDiffLoading(false);
    selectedGitChangeRef.current = null;
    selectedGitDiffDocumentPathRef.current = null;
    setSelectedGitChange(null);
    setGitDiffPreview(null);
    gitDiffDocumentsRef.current = {};
    setGitDiffDocuments({});
  }, []);

  const clearGitDiffPreviewState = useCallback(() => {
    setGitDiffLoading(false);
    selectedGitChangeRef.current = null;
    selectedGitDiffDocumentPathRef.current = null;
    setSelectedGitChange(null);
    setGitDiffPreview(null);
    setMessage(null);
  }, [setMessage]);

  const updateGitDiffDocuments = useCallback(
    (
      update: (
        current: Record<string, GitDiffDocumentState>,
      ) => Record<string, GitDiffDocumentState>,
    ) => {
      const next = update(gitDiffDocumentsRef.current);
      gitDiffDocumentsRef.current = next;
      setGitDiffDocuments(next);
    },
    [],
  );

  const getGitDiffDocument = useCallback(
    (path: string) => gitDiffDocumentsRef.current[path] ?? null,
    [],
  );

  const getSelectedGitDiffDocument = useCallback(() => {
    const path = selectedGitDiffDocumentPathRef.current;

    if (!path) {
      return null;
    }

    return gitDiffDocumentsRef.current[path] ?? null;
  }, []);

  const cancelGitDiffDocument = useCallback(
    (path: string) => {
      requestTokenByDocumentPathRef.current[path] =
        (requestTokenByDocumentPathRef.current[path] ?? 0) + 1;
      updateGitDiffDocuments((current) => {
        if (!current[path]) {
          return current;
        }

        const next = { ...current };
        delete next[path];
        return next;
      });

      if (selectedGitDiffDocumentPathRef.current !== path) {
        return;
      }

      clearGitDiffPreviewState();
    },
    [clearGitDiffPreviewState, updateGitDiffDocuments],
  );

  const reconcileGitDiffDocument = useCallback(
    (path: string, gitChange: GitChangedFile) => {
      updateGitDiffDocuments((current) => {
        const existing = current[path];

        if (!existing) {
          return current;
        }

        return {
          ...current,
          [path]: { ...existing, change: gitChange },
        };
      });

      if (selectedGitDiffDocumentPathRef.current !== path) {
        return;
      }

      selectedGitChangeRef.current = gitChange;
      setSelectedGitChange(gitChange);
    },
    [updateGitDiffDocuments],
  );

  const loadGitDiffDocumentState = useCallback(
    (path: string, gitChange: GitChangedFile | undefined, activate: boolean) => {
      if (!workspaceRoot) {
        return;
      }

      const retained = gitDiffDocumentsRef.current[path];
      const existing = retained ?? (gitChange
        ? {
            change: gitChange,
            diff: null,
            documentPath: path,
            isLoading: false,
            repositoryRoot: workspaceRoot,
          }
        : null);
      const retainedChange = existing?.change;

      if (!existing || !retainedChange) {
        return;
      }

      const owningWorkspaceRoot = workspaceRoot;
      const requestedRoot = existing.repositoryRoot;
      const workspaceRequestToken = gitDiffRequestTokenRef.current;
      const requestToken = (requestTokenByDocumentPathRef.current[path] ?? 0) + 1;
      requestTokenByDocumentPathRef.current[path] = requestToken;
      if (activate) {
        recordCurrentNavigationLocation();
      }

      selectedGitDiffDocumentPathRef.current = path;
      selectedGitChangeRef.current = retainedChange;
      setSelectedGitChange(retainedChange);
      setGitDiffPreview(existing.diff);
      setGitDiffLoading(true);

      if (activate) {
        documentTabSession.activate(path);
      }
      updateGitDiffDocuments((current) => ({
        ...current,
        [path]: {
          change: retainedChange,
          diff: current[path]?.diff ?? null,
          documentPath: path,
          isLoading: true,
          repositoryRoot: requestedRoot,
        },
      }));
      void gitGateway
        .getDiff(requestedRoot, retainedChange)
        .then((diff) => {
          if (
            !workspaceRootKeysEqual(
              currentWorkspaceRootRef.current,
              owningWorkspaceRoot,
            ) ||
            gitDiffRequestTokenRef.current !== workspaceRequestToken ||
            requestTokenByDocumentPathRef.current[path] !== requestToken
          ) {
            return;
          }

          updateGitDiffDocuments((current) => ({
            ...current,
            [path]: {
              change: current[path]?.change ?? retainedChange,
              diff,
              documentPath: path,
              isLoading: false,
              repositoryRoot: requestedRoot,
            },
          }));
          if (selectedGitDiffDocumentPathRef.current === path) {
            setGitDiffPreview(diff);
            setMessage(`Diff ${retainedChange.relativePath}`);
          }
        })
        .catch((error) => {
          if (
            !workspaceRootKeysEqual(
              currentWorkspaceRootRef.current,
              owningWorkspaceRoot,
            ) ||
            gitDiffRequestTokenRef.current !== workspaceRequestToken ||
            requestTokenByDocumentPathRef.current[path] !== requestToken
          ) {
            return;
          }

          updateGitDiffDocuments((current) => ({
            ...current,
            [path]: {
              change: current[path]?.change ?? retainedChange,
              diff: current[path]?.diff ?? null,
              documentPath: path,
              isLoading: false,
              repositoryRoot: requestedRoot,
            },
          }));
          if (selectedGitDiffDocumentPathRef.current === path) {
            setGitDiffPreview(null);
            reportError("Git Diff", error);
          }
        })
        .finally(() => {
          if (
            !workspaceRootKeysEqual(
              currentWorkspaceRootRef.current,
              owningWorkspaceRoot,
            ) ||
            gitDiffRequestTokenRef.current !== workspaceRequestToken ||
            requestTokenByDocumentPathRef.current[path] !== requestToken
          ) {
            return;
          }

          if (selectedGitDiffDocumentPathRef.current === path) {
            setGitDiffLoading(false);
          }
        });
    },
    [
      currentWorkspaceRootRef,
      documentTabSession,
      gitGateway,
      recordCurrentNavigationLocation,
      reportError,
      setMessage,
      updateGitDiffDocuments,
      workspaceRoot,
    ],
  );

  const loadGitDiffDocument = useCallback(
    (path: string, gitChange?: GitChangedFile) => {
      loadGitDiffDocumentState(path, gitChange, true);
    },
    [loadGitDiffDocumentState],
  );

  const reloadGitDiffDocument = useCallback(
    (path: string) => {
      loadGitDiffDocumentState(path, undefined, false);
    },
    [loadGitDiffDocumentState],
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

      const requestedRoot = options.repositoryRoot ?? workspaceRoot;
      const owningWorkspaceRoot = workspaceRoot;
      const document = gitDiffDocument(change);
      const workspaceRequestToken = gitDiffRequestTokenRef.current;
      const requestToken =
        (requestTokenByDocumentPathRef.current[document.path] ?? 0) + 1;
      requestTokenByDocumentPathRef.current[document.path] = requestToken;
      recordCurrentNavigationLocation();
      const commit = documentTabSession.openReadOnlyDocument(
        document,
        options.pin === true,
      );
      if (commit.replacedDocument) {
        if (isGitDiffDocumentPath(commit.replacedDocument.path)) {
          cancelGitDiffDocument(commit.replacedDocument.path);
        }
        onDocumentReplaced(commit.replacedDocument);
      }
      selectedGitDiffDocumentPathRef.current = document.path;
      selectedGitChangeRef.current = change;
      setSelectedGitChange(change);
      setGitDiffPreview(null);
      setGitDiffLoading(true);
      updateGitDiffDocuments((current) => ({
        ...current,
        [document.path]: {
          change,
          diff: current[document.path]?.diff ?? null,
          documentPath: document.path,
          isLoading: true,
          repositoryRoot: requestedRoot,
        },
      }));

      try {
        const diff = await gitGateway.getDiff(requestedRoot, change);

        if (
          !workspaceRootKeysEqual(
            currentWorkspaceRootRef.current,
            owningWorkspaceRoot,
          ) ||
          gitDiffRequestTokenRef.current !== workspaceRequestToken ||
          requestTokenByDocumentPathRef.current[document.path] !== requestToken
        ) {
          return;
        }

        updateGitDiffDocuments((current) => ({
          ...current,
          [document.path]: {
            change: current[document.path]?.change ?? change,
            diff,
            documentPath: document.path,
            isLoading: false,
            repositoryRoot: requestedRoot,
          },
        }));
        if (selectedGitDiffDocumentPathRef.current === document.path) {
          setGitDiffPreview(diff);
          setMessage(`Diff ${change.relativePath}`);
        }
      } catch (error) {
        if (
          !workspaceRootKeysEqual(
            currentWorkspaceRootRef.current,
            owningWorkspaceRoot,
          ) ||
          gitDiffRequestTokenRef.current !== workspaceRequestToken ||
          requestTokenByDocumentPathRef.current[document.path] !== requestToken
        ) {
          return;
        }

        updateGitDiffDocuments((current) => ({
          ...current,
          [document.path]: {
            change: current[document.path]?.change ?? change,
            diff: current[document.path]?.diff ?? null,
            documentPath: document.path,
            isLoading: false,
            repositoryRoot: requestedRoot,
          },
        }));
        if (selectedGitDiffDocumentPathRef.current === document.path) {
          setGitDiffPreview(null);
        }
        reportError("Git Diff", error);
      } finally {
        if (
          !workspaceRootKeysEqual(
            currentWorkspaceRootRef.current,
            owningWorkspaceRoot,
          ) ||
          gitDiffRequestTokenRef.current !== workspaceRequestToken ||
          requestTokenByDocumentPathRef.current[document.path] !== requestToken
        ) {
          return;
        }

        if (selectedGitDiffDocumentPathRef.current === document.path) {
          setGitDiffLoading(false);
        }
      }
    },
    [
      cancelGitDiffDocument,
      currentWorkspaceRootRef,
      documentTabSession,
      gitGateway,
      onDocumentReplaced,
      recordCurrentNavigationLocation,
      reportError,
      setMessage,
      updateGitDiffDocuments,
      workspaceRoot,
    ],
  );

  const openGitChange = useCallback(
    async (change: GitChangedFile, repositoryRoot?: string) => {
      await previewGitChange(change, { pin: true, repositoryRoot });
    },
    [previewGitChange],
  );

  return {
    gitDiffDocuments,
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
    cancelGitDiffDocument,
    getGitDiffDocument,
    getSelectedGitDiffDocument,
    loadGitDiffDocument,
    reloadGitDiffDocument,
    reconcileGitDiffDocument,
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
