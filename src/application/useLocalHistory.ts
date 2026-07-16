import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type MutableRefObject,
} from "react";
import type { LocalHistoryDiff, LocalHistoryGateway, LocalHistoryVersion } from "../domain/localHistory";
import type { EditorDocument, WorkspaceWriteResult } from "../domain/workspace";
import {
  joinWorkspacePath,
  workspaceRelativePath,
} from "../domain/workspace";
import { workspaceRootKeysEqual } from "../domain/workspaceRootKey";
import type { WorkspaceRuntimeOwner } from "../domain/workspaceRuntimeOwner";
import type { DocumentSelfWriteLease } from "./documentSelfWriteCoordinator";
import type { DocumentSaveLease } from "./documentSaveCoordinator";
import {
  documentSaveOwnershipKey,
  type DocumentSaveOwnership,
  type ResolveDocumentSaveOwnership,
} from "./documentSaveIdentity";
import type {
  OwnerDocumentSaveRepository,
  ResolvedOwnerDocumentSaveRepository,
} from "./ownerDocumentSaveRepository";
import type { DocumentSaveResult } from "./documentSaveService";

/**
 * Collaborators the Local History (PhpStorm-style, git-independent) panel
 * needs from the workbench shell. `captureLocalHistorySnapshot` is shared with
 * the save flow (every save also records a snapshot), `syncSavedDocument` /
 * `syncSavedJavaScriptTypeScriptDocument` are shared with every other flow that
 * writes a document's content back. Owner-bound write, self-write, repository,
 * and prefetch collaborators keep the revert on the same canonical save path.
 * Every piece of panel-local state (including session/request tokens) remains
 * owned by this hook.
 */
export interface LocalHistoryDependencies {
  localHistoryGateway: LocalHistoryGateway;
  currentWorkspaceRootRef: MutableRefObject<string | null>;
  resolveCurrentWorkspaceRuntimeOwner: () => WorkspaceRuntimeOwner | null;
  workspaceRoot: string | null;
  activeDocumentRef: MutableRefObject<EditorDocument | null>;
  ownerDocumentSaveRepository: OwnerDocumentSaveRepository;
  resolveDocumentSaveOwnership: ResolveDocumentSaveOwnership;
  requestOwnerDocumentSave: (
    ownership: DocumentSaveOwnership,
    operation: (lease: DocumentSaveLease) => Promise<DocumentSaveResult>,
  ) => Promise<DocumentSaveResult>;
  writeOwnerDocument: (
    owner: WorkspaceRuntimeOwner,
    rootPath: string,
    document: EditorDocument,
    content: string,
  ) => Promise<WorkspaceWriteResult | void>;
  beginOwnerDocumentSelfWrite: (
    owner: WorkspaceRuntimeOwner,
    rootPath: string,
    path: string,
    content: string,
  ) => DocumentSelfWriteLease | null;
  invalidateOwnerDocumentPrefetch: (
    owner: WorkspaceRuntimeOwner,
    path: string,
  ) => void;
  captureLocalHistorySnapshot: (
    owner: WorkspaceRuntimeOwner,
    requestedRoot: string,
    absolutePath: string,
    content: string,
  ) => Promise<void>;
  syncSavedDocument: (
    owner: WorkspaceRuntimeOwner,
    rootPath: string,
    document: EditorDocument,
    shouldEmit: () => boolean,
  ) => Promise<void>;
  syncSavedJavaScriptTypeScriptDocument: (
    owner: WorkspaceRuntimeOwner,
    rootPath: string,
    document: EditorDocument,
    shouldEmit: () => boolean,
  ) => Promise<void>;
  setMessage: (message: string) => void;
  reportError: (source: string, error: unknown) => void;
  reportErrorForActiveWorkspaceRoot: (
    rootPath: string | null | undefined,
    source: string,
    error: unknown,
  ) => void;
}

export interface LocalHistoryPanel {
  localHistoryPanelOpen: boolean;
  localHistoryRelativePath: string | null;
  localHistoryVersions: LocalHistoryVersion[];
  localHistoryLoading: boolean;
  localHistorySelectedId: string | null;
  localHistoryDiff: LocalHistoryDiff | null;
  localHistoryDiffLoading: boolean;
  openLocalHistory: () => Promise<void>;
  selectLocalHistoryVersion: (versionId: string) => Promise<void>;
  revertLocalHistoryVersion: (versionId: string) => Promise<void>;
  closeLocalHistory: () => void;
}

interface LocalHistoryPanelContext {
  owner: WorkspaceRuntimeOwner;
  root: string;
  relativePath: string;
  absolutePath: string;
  documentIdentity: string;
  ownership: DocumentSaveOwnership;
  sessionToken: number;
}

function localHistoryPathIsRetained(
  root: string,
  relativePath: string,
  absolutePath: string,
): boolean {
  const pathParts = relativePath.split(/[\\/]/);

  if (
    !relativePath ||
    pathParts.some((part) => !part || part === "." || part === "..")
  ) {
    return false;
  }

  const normalizedAbsolutePath = absolutePath.trim().split("\\").join("/");
  return (
    workspaceRelativePath(root, absolutePath) === relativePath &&
    joinWorkspacePath(root, relativePath) === normalizedAbsolutePath
  );
}

/**
 * Local History (PhpStorm parity): per-workspace snapshots of a file captured
 * on save, browsed/diffed/reverted WITHOUT git. Per-tab isolated like the git
 * file history panel: a switched-away tab's late list/diff resolve can never
 * repopulate another tab's panel.
 */
export function useLocalHistory(
  dependencies: LocalHistoryDependencies,
): LocalHistoryPanel {
  const {
    localHistoryGateway,
    currentWorkspaceRootRef,
    resolveCurrentWorkspaceRuntimeOwner,
    activeDocumentRef,
    ownerDocumentSaveRepository,
    resolveDocumentSaveOwnership,
    requestOwnerDocumentSave,
    writeOwnerDocument,
    beginOwnerDocumentSelfWrite,
    invalidateOwnerDocumentPrefetch,
    captureLocalHistorySnapshot,
    syncSavedDocument,
    syncSavedJavaScriptTypeScriptDocument,
    setMessage,
    reportError,
    reportErrorForActiveWorkspaceRoot,
  } = dependencies;

  const [localHistoryPanelOpen, setLocalHistoryPanelOpen] = useState(false);
  const [localHistoryRelativePath, setLocalHistoryRelativePath] = useState<
    string | null
  >(null);
  const [localHistoryVersions, setLocalHistoryVersions] = useState<
    LocalHistoryVersion[]
  >([]);
  const [localHistoryLoading, setLocalHistoryLoading] = useState(false);
  const [localHistorySelectedId, setLocalHistorySelectedId] = useState<
    string | null
  >(null);
  const [localHistoryDiff, setLocalHistoryDiff] =
    useState<LocalHistoryDiff | null>(null);
  const [localHistoryDiffLoading, setLocalHistoryDiffLoading] = useState(false);
  const localHistoryRequestTokenRef = useRef(0);
  const localHistoryDiffRequestTokenRef = useRef(0);
  const localHistoryRevertRequestTokenRef = useRef(0);
  const localHistorySessionTokenRef = useRef(0);
  // Mirrors the file currently shown in the local-history panel, for the same
  // reason as fileHistoryRelativePathRef: a version click always targets the
  // panel's live file, keeping the diff/revert request per-file isolated.
  const localHistoryRelativePathRef = useRef<string | null>(null);
  // The absolute path of the local-history panel's file, used to read the live
  // document content for the diff and to write the reverted content back.
  const localHistoryAbsolutePathRef = useRef<string | null>(null);
  const localHistoryOwnerRef = useRef<WorkspaceRuntimeOwner | null>(null);
  const localHistoryContextRef = useRef<LocalHistoryPanelContext | null>(null);
  // The Monaco language of the local-history panel's file, captured at open so
  // the version diff highlights correctly.
  const localHistoryLanguageRef = useRef<string>("plaintext");

  const closeLocalHistory = useCallback(() => {
    localHistoryRequestTokenRef.current += 1;
    localHistoryDiffRequestTokenRef.current += 1;
    localHistoryRevertRequestTokenRef.current += 1;
    localHistorySessionTokenRef.current += 1;
    localHistoryRelativePathRef.current = null;
    localHistoryAbsolutePathRef.current = null;
    localHistoryOwnerRef.current = null;
    localHistoryContextRef.current = null;
    setLocalHistoryPanelOpen(false);
    setLocalHistoryVersions([]);
    setLocalHistoryLoading(false);
    setLocalHistorySelectedId(null);
    setLocalHistoryDiff(null);
    setLocalHistoryDiffLoading(false);
    setLocalHistoryRelativePath(null);
  }, []);

  const localHistoryOwnerIsCurrent = useCallback(
    (owner: WorkspaceRuntimeOwner, root: string): boolean => {
      const currentOwner = resolveCurrentWorkspaceRuntimeOwner();

      if (currentOwner?.ownerKey !== owner.ownerKey) {
        return false;
      }

      if (!workspaceRootKeysEqual(currentOwner.executionRoot, root)) {
        return false;
      }

      return workspaceRootKeysEqual(currentWorkspaceRootRef.current, root);
    },
    [resolveCurrentWorkspaceRuntimeOwner],
  );

  const currentLocalHistoryContext = useCallback(
    (): LocalHistoryPanelContext | null => {
      const context = localHistoryContextRef.current;
      if (!context) {
        return null;
      }

      if (activeDocumentRef.current?.path !== context.absolutePath) {
        return null;
      }

      if (!localHistoryOwnerIsCurrent(context.owner, context.root)) {
        return null;
      }

      if (!localHistoryPathIsRetained(
        context.root,
        context.relativePath,
        context.absolutePath,
      )) {
        return null;
      }

      return context;
    },
    [localHistoryOwnerIsCurrent],
  );

  const localHistoryContextIsRetained = useCallback(
    (context: LocalHistoryPanelContext): boolean => {
      const retainedOwner = localHistoryOwnerRef.current;

      if (retainedOwner?.ownerKey !== context.owner.ownerKey) {
        return false;
      }

      if (retainedOwner.executionRoot !== context.root) {
        return false;
      }

      if (localHistoryRelativePathRef.current !== context.relativePath) {
        return false;
      }

      if (localHistoryAbsolutePathRef.current !== context.absolutePath) {
        return false;
      }

      if (localHistoryContextRef.current !== context) {
        return false;
      }

      if (localHistorySessionTokenRef.current !== context.sessionToken) {
        return false;
      }

      if (activeDocumentRef.current?.path !== context.absolutePath) {
        return false;
      }

      return localHistoryOwnerIsCurrent(context.owner, context.root);
    },
    [localHistoryOwnerIsCurrent],
  );

  const resolveCurrentLocalHistoryRepository = useCallback(
    (
      context: LocalHistoryPanelContext,
    ): ResolvedOwnerDocumentSaveRepository | null => {
      if (!localHistoryContextIsRetained(context)) {
        return null;
      }
      const document = activeDocumentRef.current;
      if (!document || document.path !== context.absolutePath) {
        return null;
      }

      return ownerDocumentSaveRepository.resolve({
        owner: context.owner,
        documentIdentity: context.documentIdentity,
        document,
      });
    },
    [localHistoryContextIsRetained, ownerDocumentSaveRepository],
  );

  // Current live content of the local-history panel's file: the open editor
  // buffer when the document is loaded, otherwise null. Used as the "modified"
  // (right) side of the version diff and as the pre-revert snapshot source.
  const currentLocalHistoryContent = useCallback(
    (context: LocalHistoryPanelContext): string | null => {
      if (!localHistoryContextIsRetained(context)) {
        return null;
      }

      return resolveCurrentLocalHistoryRepository(context)?.currentDocument()
        ?.content ?? null;
    },
    [
      localHistoryContextIsRetained,
      resolveCurrentLocalHistoryRepository,
    ],
  );

  useEffect(() => {
    const context = localHistoryContextRef.current;
    if (!context) {
      return;
    }
    if (localHistoryContextIsRetained(context)) {
      return;
    }

    closeLocalHistory();
  });

  // Loads the diff for a single local-history version (selected version vs the
  // file's current content). The requested root, relative path, and request
  // token are captured up front; after the await we re-check the active root and
  // the token so a stale result from a switched-away tab or superseded click is
  // dropped (per-tab isolation).
  const selectLocalHistoryVersion = useCallback(
    async (versionId: string) => {
      const context = currentLocalHistoryContext();

      if (!context) {
        return;
      }

      const requestToken = localHistoryDiffRequestTokenRef.current + 1;
      localHistoryDiffRequestTokenRef.current = requestToken;
      setLocalHistorySelectedId(versionId);
      setLocalHistoryDiffLoading(true);

      const isCurrentRequest = () =>
        localHistoryContextIsRetained(context) &&
        localHistoryDiffRequestTokenRef.current === requestToken;

      try {
        const originalContent = await localHistoryGateway.readVersion(
          context.root,
          context.relativePath,
          versionId,
        );

        if (!isCurrentRequest()) {
          return;
        }

        setLocalHistoryDiff({
          language: localHistoryLanguageRef.current,
          modifiedContent: currentLocalHistoryContent(context) ?? "",
          originalContent,
        });
      } catch (error) {
        if (!isCurrentRequest()) {
          return;
        }

        setLocalHistoryDiff(null);
        reportError("Local History", error);
      } finally {
        if (isCurrentRequest()) {
          setLocalHistoryDiffLoading(false);
        }
      }
    },
    [
      currentLocalHistoryContent,
      currentLocalHistoryContext,
      localHistoryContextIsRetained,
      localHistoryGateway,
      reportError,
    ],
  );

  // Opens the Local History panel for the active document. The requested root
  // and the active document's relative/absolute paths + language are captured up
  // front; after the await we re-check the active root, document, and request
  // token so a stale version list from a switched-away tab is dropped.
  const openLocalHistory = useCallback(async () => {
    const requestedOwner = resolveCurrentWorkspaceRuntimeOwner();
    const document = activeDocumentRef.current;

    if (!requestedOwner || !document) {
      return;
    }

    const requestedRoot = requestedOwner.executionRoot;
    if (!localHistoryOwnerIsCurrent(requestedOwner, requestedRoot)) {
      return;
    }

    const requestedDocumentPath = document.path;
    const relativePath = workspaceRelativePath(
      requestedRoot,
      requestedDocumentPath,
    );

    if (
      !relativePath ||
      !localHistoryPathIsRetained(
        requestedRoot,
        relativePath,
        requestedDocumentPath,
      )
    ) {
      return;
    }

    const requestToken = localHistoryRequestTokenRef.current + 1;
    const sessionToken = localHistorySessionTokenRef.current + 1;
    localHistoryRequestTokenRef.current = requestToken;
    localHistorySessionTokenRef.current = sessionToken;
    localHistoryDiffRequestTokenRef.current += 1;
    localHistoryRevertRequestTokenRef.current += 1;
    const ownership = resolveDocumentSaveOwnership(
      requestedRoot,
      requestedDocumentPath,
    );
    const documentIdentity = ownership
      ? documentSaveOwnershipKey(ownership)
      : null;
    const repository = documentIdentity
      ? ownerDocumentSaveRepository.resolve({
          owner: requestedOwner,
          documentIdentity,
          document,
        })
      : null;
    if (!ownership || !documentIdentity || !repository) {
      return;
    }
    if (!workspaceRootKeysEqual(repository.rootPath, requestedRoot)) {
      return;
    }

    const context: LocalHistoryPanelContext = {
      absolutePath: requestedDocumentPath,
      documentIdentity,
      owner: requestedOwner,
      ownership,
      relativePath,
      root: requestedRoot,
      sessionToken,
    };
    localHistoryRelativePathRef.current = relativePath;
    localHistoryAbsolutePathRef.current = requestedDocumentPath;
    localHistoryOwnerRef.current = requestedOwner;
    localHistoryContextRef.current = context;
    localHistoryLanguageRef.current = document.language;
    setLocalHistoryRelativePath(relativePath);
    setLocalHistorySelectedId(null);
    setLocalHistoryDiff(null);
    setLocalHistoryDiffLoading(false);
    setLocalHistoryVersions([]);
    setLocalHistoryPanelOpen(true);
    setLocalHistoryLoading(true);

    const isCurrentRequest = () =>
      localHistoryOwnerIsCurrent(requestedOwner, requestedRoot) &&
      localHistoryOwnerRef.current?.ownerKey === requestedOwner.ownerKey &&
      activeDocumentRef.current?.path === requestedDocumentPath &&
      localHistoryContextRef.current === context &&
      localHistoryRequestTokenRef.current === requestToken;

    try {
      const versions = await localHistoryGateway.listVersions(
        requestedRoot,
        relativePath,
      );

      if (!isCurrentRequest()) {
        return;
      }

      setLocalHistoryVersions(versions);
    } catch (error) {
      if (!isCurrentRequest()) {
        return;
      }

      setLocalHistoryVersions([]);
      reportError("Local History", error);
    } finally {
      if (isCurrentRequest()) {
        setLocalHistoryLoading(false);
      }
    }
  }, [
    localHistoryGateway,
    localHistoryOwnerIsCurrent,
    reportError,
    ownerDocumentSaveRepository,
    resolveCurrentWorkspaceRuntimeOwner,
    resolveDocumentSaveOwnership,
  ]);

  // Reverts the panel's file to a stored version. Before overwriting, the
  // current content is snapshotted into Local History so the revert itself is
  // undoable. The version content is read first, then written to disk and synced
  // into the open document. All work is scoped to the root captured up front and
  // re-checked after each await so a tab switch drops the revert.
  const revertLocalHistoryVersion = useCallback(
    async (versionId: string) => {
      const context = currentLocalHistoryContext();

      if (!context) {
        return;
      }

      const requestToken = localHistoryRevertRequestTokenRef.current + 1;
      localHistoryRevertRequestTokenRef.current = requestToken;
      const isCurrentRequest = () =>
        localHistoryContextIsRetained(context) &&
        localHistoryRevertRequestTokenRef.current === requestToken;

      try {
        const versionContent = await localHistoryGateway.readVersion(
          context.root,
          context.relativePath,
          versionId,
        );

        if (!isCurrentRequest()) {
          return;
        }

        const result = await requestOwnerDocumentSave(
          context.ownership,
          async (coordinatorLease) => {
            const panelTransactionIsCurrent = () =>
              coordinatorLease.isCurrent() && isCurrentRequest();
            if (!panelTransactionIsCurrent()) {
              return { status: "stale" };
            }
            const repository = resolveCurrentLocalHistoryRepository(context);
            const existingDocument = repository?.currentDocument();
            if (!existingDocument || existingDocument.readOnly) {
              return { status: "stale" };
            }
            const preRevertContent = existingDocument.content;
            const writePermit = coordinatorLease.tryBeginWrite();
            if (!writePermit) {
              return { status: "stale" };
            }
            let writePermitSettled = false;
            const settleWritePermit = () => {
              if (writePermitSettled) {
                return;
              }

              writePermitSettled = true;
              writePermit.settle();
            };
            const selfWrite = beginOwnerDocumentSelfWrite(
              context.owner,
              context.root,
              context.absolutePath,
              versionContent,
            );
            try {
              let writeResult: WorkspaceWriteResult | void;
              try {
                writeResult = await writeOwnerDocument(
                  context.owner,
                  context.root,
                  existingDocument,
                  versionContent,
                );
              } catch (error) {
                selfWrite?.abort();
                throw error;
              }

              if (writeResult?.status === "conflict") {
                selfWrite?.abort();
                throw new Error(writeResult.message);
              }
              if (writeResult?.status === "error") {
                selfWrite?.abort();
                throw new Error(writeResult.message);
              }
              if (writeResult?.status === "partial") {
                selfWrite?.complete(writeResult.revision ?? null);
                const ownerRepository = ownerDocumentSaveRepository.resolveCurrent(
                  context.owner,
                  context.documentIdentity,
                );
                const issuedWriteIsCurrent = () =>
                  coordinatorLease.isCurrent() &&
                  ownerRepository?.isCurrent() === true;
                const target = {
                  lease: {
                    isCurrent: issuedWriteIsCurrent,
                    tryBeginWrite: () => coordinatorLease.tryBeginWrite(),
                  },
                  path: context.absolutePath,
                  rootPath: context.root,
                  workspaceRequestToken: context.sessionToken,
                };
                ownerRepository?.saveStore.updateRevisionForIssuedWrite(
                  target,
                  existingDocument,
                  writeResult.revision,
                );
                settleWritePermit();
                if (issuedWriteIsCurrent()) {
                  invalidateOwnerDocumentPrefetch(
                    context.owner,
                    context.absolutePath,
                  );
                }
                return {
                  status: "partial",
                  error: new Error(
                    `The file was restored, but durability could not be confirmed: ${writeResult.message}`,
                  ),
                };
              }

              const revision = writeResult?.status === "success"
                ? writeResult.revision
                : existingDocument.revision;
              selfWrite?.complete(revision ?? null);

              const ownerRepository = ownerDocumentSaveRepository.resolveCurrent(
                context.owner,
                context.documentIdentity,
              );
              const issuedWriteIsCurrent = () =>
                coordinatorLease.isCurrent() &&
                ownerRepository?.isCurrent() === true;
              if (!issuedWriteIsCurrent() || !ownerRepository) {
                return { status: "stale" };
              }
              const savedDocument = {
                ...existingDocument,
                content: versionContent,
                savedContent: versionContent,
                revision,
              };
              const target = {
                lease: {
                  isCurrent: issuedWriteIsCurrent,
                  tryBeginWrite: () => coordinatorLease.tryBeginWrite(),
                },
                path: context.absolutePath,
                rootPath: context.root,
                workspaceRequestToken: context.sessionToken,
              };
              ownerRepository.saveStore.acknowledgeIssuedWrite(target, {
                expectedDocument: existingDocument,
                revision,
                savedDocument,
                startingContent: preRevertContent,
              });
              settleWritePermit();
              invalidateOwnerDocumentPrefetch(
                context.owner,
                context.absolutePath,
              );

              if (!isCurrentRequest()) {
                return {
                  status: "saved",
                  document: savedDocument,
                  contentIsCurrent: false,
                };
              }

              if (preRevertContent !== versionContent) {
                await captureLocalHistorySnapshot(
                  context.owner,
                  context.root,
                  context.absolutePath,
                  preRevertContent,
                );
                if (!panelTransactionIsCurrent()) {
                  return { status: "stale" };
                }
              }
              await captureLocalHistorySnapshot(
                context.owner,
                context.root,
                context.absolutePath,
                versionContent,
              );
              if (!panelTransactionIsCurrent()) {
                return { status: "stale" };
              }

              const reverted = resolveCurrentLocalHistoryRepository(context)
                ?.currentDocument();
              if (!reverted) {
                return { status: "stale" };
              }
              const writtenContentIsCurrent = () =>
                panelTransactionIsCurrent() &&
                ownerRepository.currentDocument()?.content === versionContent;
              if (!writtenContentIsCurrent()) {
                return {
                  status: "saved",
                  document: savedDocument,
                  contentIsCurrent: false,
                };
              }
              await syncSavedDocument(
                context.owner,
                context.root,
                reverted,
                writtenContentIsCurrent,
              );
              if (!writtenContentIsCurrent()) {
                return {
                  status: "saved",
                  document: savedDocument,
                  contentIsCurrent: false,
                };
              }
              await syncSavedJavaScriptTypeScriptDocument(
                context.owner,
                context.root,
                reverted,
                writtenContentIsCurrent,
              );
              return {
                status: "saved",
                document: savedDocument,
                contentIsCurrent: writtenContentIsCurrent(),
              };
            } finally {
              settleWritePermit();
            }
          },
        );

        if (result.status === "partial" || result.status === "failed") {
          if (!isCurrentRequest()) {
            return;
          }
          reportErrorForActiveWorkspaceRoot(
            context.root,
            "Local History",
            result.error,
          );
          return;
        }
        if (result.status !== "saved") {
          return;
        }
        if (!isCurrentRequest()) {
          return;
        }

        setMessage("Reverted to selected local history version");
        // Refresh the panel so the new version list + diff reflect the revert.
        void openLocalHistory();
      } catch (error) {
        if (!isCurrentRequest()) {
          return;
        }
        reportErrorForActiveWorkspaceRoot(context.root, "Local History", error);
      }
    },
    [
      captureLocalHistorySnapshot,
      beginOwnerDocumentSelfWrite,
      currentLocalHistoryContext,
      localHistoryContextIsRetained,
      invalidateOwnerDocumentPrefetch,
      localHistoryGateway,
      openLocalHistory,
      ownerDocumentSaveRepository,
      reportErrorForActiveWorkspaceRoot,
      requestOwnerDocumentSave,
      resolveCurrentLocalHistoryRepository,
      syncSavedDocument,
      syncSavedJavaScriptTypeScriptDocument,
      writeOwnerDocument,
    ],
  );

  return {
    localHistoryPanelOpen,
    localHistoryRelativePath,
    localHistoryVersions,
    localHistoryLoading,
    localHistorySelectedId,
    localHistoryDiff,
    localHistoryDiffLoading,
    openLocalHistory,
    selectLocalHistoryVersion,
    revertLocalHistoryVersion,
    closeLocalHistory,
  };
}
