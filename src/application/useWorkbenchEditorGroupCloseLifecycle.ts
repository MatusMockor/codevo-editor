import {
  useCallback,
  type Dispatch,
  type MutableRefObject,
  type SetStateAction,
} from "react";
import {
  createDirtyCloseDocumentDescriptor,
  type DirtyCloseDecisionPort,
} from "./dirtyCloseDecisionPort";
import {
  DirtyCloseSaveTransaction,
  type CapturedDirtyCloseTarget,
  type DirtyCloseConditionalCommitResult,
} from "./dirtyCloseSaveTransaction";
import {
  documentSaveOwnershipKey,
  type DocumentSaveOwnership,
  type ResolveDocumentSaveOwnership,
} from "./documentSaveIdentity";
import type { DocumentSaveResult } from "./documentSaveService";
import type {
  DocumentSaveInvalidationScope,
  RunWithDocumentSaveExclusion,
} from "./documentSaveCoordinator";
import {
  clearEslintDiagnosticsForFile,
  type EslintDiagnosticsByRoot,
} from "../domain/eslintDiagnostics";
import type { MarkdownPreviewTab } from "../domain/markdownPreview";
import {
  clearPhpstanDiagnosticsForFile,
  type PhpstanDiagnosticsByRoot,
} from "../domain/phpstanDiagnostics";
import type { CloseCompletion } from "../domain/dirtyClose";
import type { EditorDocument, ImageTab } from "../domain/workspace";
import { isDirty } from "../domain/workspace";
import {
  activateEditorGroupPath,
  closeEditorGroup,
  closeEditorGroupPath,
  closeEditorGroupTab,
  editorGroupsUniquePaths,
  editorGroupVisiblePaths,
  type EditorGroupId,
  type EditorGroupsState,
} from "../domain/editorGroups";
import type { WorkspaceRuntimeOwner } from "../domain/workspaceRuntimeOwner";
import type { DocumentCloseOptions } from "./useDocumentLifecycle";
import type { WorkbenchPrompter } from "./workbenchPrompter";

interface EditorCloseIdentity {
  readonly document: EditorDocument;
  readonly documentIdentity: string;
  readonly ownership: DocumentSaveOwnership;
  readonly path: string;
}

type EditorCloseTarget = CapturedDirtyCloseTarget<EditorCloseIdentity>;

interface CapturedCloseScope {
  readonly documents: ReadonlyMap<string, EditorDocument>;
  readonly editorGroups: EditorGroupsState;
  readonly externalAliases: ReadonlyMap<string, EditorDocument>;
  readonly commit: () => void;
  readonly targets: readonly EditorCloseTarget[];
}

interface CapturedCloseTargets {
  readonly externalAliases: ReadonlyMap<string, EditorDocument>;
  readonly targets: readonly EditorCloseTarget[];
}

export interface WorkbenchEditorGroupCloseLifecycleDependencies {
  workspaceRoot: string | null;
  currentWorkspaceRootRef: MutableRefObject<string | null>;
  editorGroupsRef: MutableRefObject<EditorGroupsState>;
  openPathsRef: MutableRefObject<string[]>;
  previewPathRef: MutableRefObject<string | null>;
  activeDocumentRef: MutableRefObject<EditorDocument | null>;
  documentsRef: MutableRefObject<Record<string, EditorDocument>>;
  imageTabsRef: MutableRefObject<Record<string, ImageTab>>;
  markdownPreviewTabsRef: MutableRefObject<Record<string, MarkdownPreviewTab>>;
  setImageTabs: Dispatch<SetStateAction<Record<string, ImageTab>>>;
  setMarkdownPreviewTabs: Dispatch<
    SetStateAction<Record<string, MarkdownPreviewTab>>
  >;
  setEslintDiagnosticsByRoot: Dispatch<SetStateAction<EslintDiagnosticsByRoot>>;
  setPhpstanDiagnosticsByRoot: Dispatch<
    SetStateAction<PhpstanDiagnosticsByRoot>
  >;
  updateEditorGroups: (
    update: (current: EditorGroupsState) => EditorGroupsState,
  ) => void;
  closeTextDocument: (path: string, options?: DocumentCloseOptions) => void;
  closeTextSurface: (options?: DocumentCloseOptions) => void;
  saveDocument: (path: string) => Promise<DocumentSaveResult>;
  runWithIssuedWriteDrain: RunWithDocumentSaveExclusion;
  resolveDocumentSaveOwnership: ResolveDocumentSaveOwnership;
  resolveWorkspaceRuntimeOwner: (
    rootPath: string,
  ) => WorkspaceRuntimeOwner | null;
  dirtyCloseDecisionPort: DirtyCloseDecisionPort;
  hasExternalFileConflict: (rootPath: string | null, path: string) => boolean;
  onDidCloseEditorPaths?: (paths: readonly string[]) => void;
  prompter: WorkbenchPrompter;
}

export interface WorkbenchEditorGroupCloseLifecycle {
  closeDocument: (
    path: string,
    options?: DocumentCloseOptions,
  ) => Promise<CloseCompletion>;
  closeDocumentInEditorGroup: (
    groupId: EditorGroupId,
    path: string,
    options?: DocumentCloseOptions,
  ) => Promise<CloseCompletion>;
  closeActiveEditorGroup: () => Promise<CloseCompletion>;
  closeActiveSurface: () => Promise<CloseCompletion>;
  closeActiveEditorGroupSurface: () => Promise<CloseCompletion>;
}

export function useWorkbenchEditorGroupCloseLifecycle(
  dependencies: WorkbenchEditorGroupCloseLifecycleDependencies,
): WorkbenchEditorGroupCloseLifecycle {
  const {
    currentWorkspaceRootRef,
    editorGroupsRef,
    openPathsRef,
    previewPathRef,
    activeDocumentRef,
    documentsRef,
    imageTabsRef,
    markdownPreviewTabsRef,
    setImageTabs,
    setMarkdownPreviewTabs,
    setEslintDiagnosticsByRoot,
    setPhpstanDiagnosticsByRoot,
    updateEditorGroups,
    closeTextDocument,
    closeTextSurface,
    saveDocument,
    runWithIssuedWriteDrain,
    resolveDocumentSaveOwnership,
    resolveWorkspaceRuntimeOwner,
    dirtyCloseDecisionPort,
    hasExternalFileConflict,
    onDidCloseEditorPaths,
  } = dependencies;

  const clearCodeQualityDiagnostics = useCallback((path: string) => {
    const rootPath = currentWorkspaceRootRef.current;
    if (!rootPath) {
      return;
    }

    setEslintDiagnosticsByRoot((current) =>
      clearEslintDiagnosticsForFile(current, rootPath, path),
    );
    setPhpstanDiagnosticsByRoot((current) =>
      clearPhpstanDiagnosticsForFile(current, rootPath, path),
    );
  }, [
    currentWorkspaceRootRef,
    setEslintDiagnosticsByRoot,
    setPhpstanDiagnosticsByRoot,
  ]);

  const closeVisualDocumentImmediately = useCallback((
    path: string,
    clearDiagnostics = true,
  ) => {
    if (clearDiagnostics) {
      clearCodeQualityDiagnostics(path);
    }
    const nextMarkdownPreviews = { ...markdownPreviewTabsRef.current };
    const nextImages = { ...imageTabsRef.current };
    delete nextMarkdownPreviews[path];
    delete nextImages[path];

    const current = editorGroupsRef.current;
    const activeGroup = current.groups[current.activeGroupId];
    if (!activeGroup) {
      return;
    }
    const nextGroup = closeEditorGroupPath(activeGroup, path);
    imageTabsRef.current = nextImages;
    markdownPreviewTabsRef.current = nextMarkdownPreviews;
    openPathsRef.current = nextGroup.openPaths;
    previewPathRef.current = nextGroup.previewPath;
    activeDocumentRef.current = nextGroup.activePath
      ? documentsRef.current[nextGroup.activePath] ?? null
      : null;
    setImageTabs(nextImages);
    setMarkdownPreviewTabs(nextMarkdownPreviews);
    updateEditorGroups((latest) => ({
      ...latest,
      groups: {
        ...latest.groups,
        [latest.activeGroupId]: closeEditorGroupPath(
          latest.groups[latest.activeGroupId],
          path,
        ),
      },
    }));
  }, [
    activeDocumentRef,
    clearCodeQualityDiagnostics,
    documentsRef,
    editorGroupsRef,
    imageTabsRef,
    markdownPreviewTabsRef,
    openPathsRef,
    previewPathRef,
    setImageTabs,
    setMarkdownPreviewTabs,
    updateEditorGroups,
  ]);

  const closeFinalMembershipImmediately = useCallback((
    groupId: EditorGroupId,
    path: string,
    options: DocumentCloseOptions,
    clearDiagnostics = true,
  ) => {
    const current = editorGroupsRef.current;
    const target = current.groups[groupId];
    if (!target) {
      return;
    }

    const activated = {
      ...current,
      activeGroupId: groupId,
      groups: {
        ...current.groups,
        [groupId]: activateEditorGroupPath(target, path),
      },
    };
    editorGroupsRef.current = activated;
    openPathsRef.current = target.openPaths;
    previewPathRef.current = target.previewPath;
    activeDocumentRef.current = documentsRef.current[path] ?? null;
    updateEditorGroups(() => activated);

    if (imageTabsRef.current[path] || markdownPreviewTabsRef.current[path]) {
      closeVisualDocumentImmediately(path, clearDiagnostics);
      return;
    }

    closeTextDocument(path, { ...options, skipConfirmation: true });
    if (clearDiagnostics) {
      clearCodeQualityDiagnostics(path);
    }
  }, [
    activeDocumentRef,
    clearCodeQualityDiagnostics,
    closeTextDocument,
    closeVisualDocumentImmediately,
    documentsRef,
    editorGroupsRef,
    imageTabsRef,
    markdownPreviewTabsRef,
    openPathsRef,
    previewPathRef,
    updateEditorGroups,
  ]);

  const commitMembershipClose = useCallback((
    groupId: EditorGroupId,
    path: string,
    options: DocumentCloseOptions,
    clearDiagnostics = true,
  ) => {
    const result = closeEditorGroupTab(editorGroupsRef.current, groupId, path);
    if (!result.membershipRemoved) {
      return;
    }
    if (!result.finalMembershipRemoved) {
      updateEditorGroups(() => result.state);
      return;
    }

    closeFinalMembershipImmediately(
      groupId,
      path,
      options,
      clearDiagnostics,
    );
  }, [closeFinalMembershipImmediately, editorGroupsRef, updateEditorGroups]);

  const ownerIsCurrent = useCallback((owner: WorkspaceRuntimeOwner) => {
    const rootPath = currentWorkspaceRootRef.current;
    if (!rootPath) {
      return false;
    }
    const currentOwner = resolveWorkspaceRuntimeOwner(rootPath);
    return currentOwner?.ownerKey === owner.ownerKey &&
      currentOwner.executionRoot === owner.executionRoot;
  }, [currentWorkspaceRootRef, resolveWorkspaceRuntimeOwner]);

  const targetState = useCallback((
    target: EditorCloseTarget,
    expectedDocument: EditorDocument = target.identity.document,
  ) => {
    const live = documentsRef.current[target.identity.path];
    if (!live || !sameCapturedDocument(live, expectedDocument)) {
      return { status: "stale" } as const;
    }

    return { status: "current", clean: !isDirty(live) } as const;
  }, [documentsRef]);

  const externalAliasesAreCurrent = useCallback((
    scope: CapturedCloseScope,
  ): boolean => {
    for (const [path, capturedDocument] of scope.externalAliases) {
      const live = documentsRef.current[path];
      if (!live || !sameCapturedDocument(live, capturedDocument)) {
        return false;
      }
    }

    return true;
  }, [documentsRef]);

  const conditionalCommit = useCallback((
    scope: CapturedCloseScope,
    targets: readonly EditorCloseTarget[],
    requireClean: boolean,
    expectedDocuments: ReadonlyMap<string, EditorDocument> = new Map(),
    acknowledgedDocumentIdentities: ReadonlySet<string> = new Set(),
  ): DirtyCloseConditionalCommitResult<EditorCloseIdentity, void> => {
    if (!sameEditorCloseMembership(editorGroupsRef.current, scope.editorGroups)) {
      return staleCommit(targets, "target-replaced");
    }
    if (!externalAliasesAreCurrent(scope)) {
      return staleCommit(targets, "target-replaced");
    }

    for (const [path, capturedDocument] of scope.documents) {
      const live = documentsRef.current[path];
      const expectedDocument = expectedDocuments.get(path) ?? capturedDocument;
      if (!live || !sameCapturedDocument(live, expectedDocument)) {
        return staleCommit(targets, "target-replaced");
      }
      const target = scope.targets.find(
        (candidate) => candidate.identity.path === path,
      );
      if (
        requireClean &&
        isDirty(live) &&
        (!target || !acknowledgedDocumentIdentities.has(
          target.identity.documentIdentity,
        ))
      ) {
        return staleCommit(targets, "target-replaced");
      }
    }

    for (const target of targets) {
      if (!ownerIsCurrent(target.owner)) {
        return { status: "stale", target, reason: "owner-replaced" };
      }
      const state = targetState(
        target,
        expectedDocuments.get(target.identity.path) ?? target.identity.document,
      );
      if (state.status === "stale") {
        return { status: "stale", target, reason: "target-replaced" };
      }
      if (
        requireClean &&
        !state.clean &&
        !acknowledgedDocumentIdentities.has(target.identity.documentIdentity)
      ) {
        return { status: "stale", target, reason: "newer-edit" };
      }
    }

    scope.commit();
    return { status: "committed", result: undefined };
  }, [
    documentsRef,
    editorGroupsRef,
    externalAliasesAreCurrent,
    ownerIsCurrent,
    targetState,
  ]);

  const runWithTargetWriteDrains = useCallback(async <T,>(
    targets: readonly EditorCloseTarget[],
    operation: () => Promise<T>,
  ): Promise<T> => {
    const scopes = uniqueTargetInvalidationScopes(targets);
    const run = async (index: number): Promise<T> => {
      const scope = scopes[index];
      if (!scope) {
        return operation();
      }

      return runWithIssuedWriteDrain(scope, () => run(index + 1));
    };

    return run(0);
  }, [runWithIssuedWriteDrain]);

  const executeCapturedClose = useCallback(async (
    scope: CapturedCloseScope,
    decisionScope: "tab" | "group",
    options: DocumentCloseOptions = {},
  ): Promise<CloseCompletion> => {
    if (scope.targets.length === 0 || options.skipConfirmation === true) {
      try {
        const result = conditionalCommit(scope, scope.targets, false);
        return result.status === "committed" ? "closed" : "stale";
      } catch {
        return "blocked";
      }
    }

    let decision;
    try {
      decision = await dirtyCloseDecisionPort.decideDirtyClose({
        scope: decisionScope,
        documents: scope.targets.map((target) =>
          createDirtyCloseDocumentDescriptor(
            target.targetId,
            target.owner.executionRoot,
            editorCloseRelativePath(target.identity.ownership),
            target.identity.document.name,
          )
        ),
        documentNames: scope.targets.map(
          (target) => target.identity.document.name,
        ),
      });
    } catch {
      return "blocked";
    }
    if (decision === "cancel") {
      return "cancelled";
    }
    if (!externalAliasesAreCurrent(scope)) {
      return "stale";
    }
    if (decision === "discard") {
      try {
        return await runWithTargetWriteDrains(scope.targets, async () => {
          const result = conditionalCommit(scope, scope.targets, false);
          return result.status === "committed" ? "closed" : "stale";
        });
      } catch {
        return "blocked";
      }
    }

    const targetGroups = groupTargetsByDocumentIdentity(scope.targets);
    const transactionTargets = [...targetGroups.values()].map(
      ([target]) => target,
    ).filter((target): target is EditorCloseTarget => Boolean(target));
    const savedDocuments = new Map<string, EditorDocument>();
    const acknowledgedDocumentIdentities = new Set<string>();
    const transaction = new DirtyCloseSaveTransaction<EditorCloseIdentity>({
      saveTarget: async (target) => {
        if (!externalAliasesAreCurrent(scope)) {
          return { status: "stale" };
        }

        const saveResult = await saveDocument(target.identity.path);
        if (!externalAliasesAreCurrent(scope)) {
          return { status: "stale" };
        }
        if (saveResult.status === "saved") {
          if (saveResult.contentIsCurrent) {
            const liveAfterSave = documentsRef.current[target.identity.path];
            if (
              !liveAfterSave ||
              liveAfterSave.content !== saveResult.document.content ||
              liveAfterSave.savedContent !== saveResult.document.content
            ) {
              return { status: "stale" };
            }

            savedDocuments.set(target.identity.path, liveAfterSave);
            const aliases = targetGroups.get(target.identity.documentIdentity) ?? [];
            const aliasesAreCurrent = aliases.every((alias) => {
              if (alias === target) {
                return true;
              }

              return targetState(alias).status === "current";
            });
            if (!aliasesAreCurrent) {
              return { status: "stale" };
            }

            acknowledgedDocumentIdentities.add(
              target.identity.documentIdentity,
            );
          }
        }
        return saveResult;
      },
      isOwnerCurrent: ownerIsCurrent,
      revalidateTarget: (target) => targetState(
        target,
        savedDocuments.get(target.identity.path) ?? target.identity.document,
      ),
      commitCloseConditionally: (targets) =>
        conditionalCommit(
          scope,
          targets,
          true,
          savedDocuments,
          acknowledgedDocumentIdentities,
        ),
    });
    let result;
    try {
      result = await transaction.execute({ targets: transactionTargets });
    } catch {
      return "blocked";
    }
    if (result.status === "closed") {
      return "closed";
    }
    return result.status;
  }, [
    conditionalCommit,
    dirtyCloseDecisionPort,
    externalAliasesAreCurrent,
    ownerIsCurrent,
    runWithTargetWriteDrains,
    saveDocument,
    targetState,
  ]);

  const captureTargets = useCallback((
    paths: readonly string[],
  ): CapturedCloseTargets | null => {
    const rootPath = currentWorkspaceRootRef.current;
    const decisionPaths = paths.filter((path) => {
      const document = documentsRef.current[path];
      return Boolean(document) && (
        isDirty(document) || hasExternalFileConflict(rootPath, path)
      );
    });
    if (decisionPaths.length === 0) {
      return { externalAliases: new Map(), targets: [] };
    }
    if (!rootPath) {
      return null;
    }
    const owner = resolveWorkspaceRuntimeOwner(rootPath);
    if (!owner) {
      return null;
    }

    const targets: EditorCloseTarget[] = [];
    const externalAliases = new Map<string, EditorDocument>();
    const snapshotsByDocumentIdentity = new Map<string, EditorDocument>();
    for (const path of decisionPaths) {
      const document = documentsRef.current[path];
      if (!document) {
        continue;
      }
      const ownership = resolveDocumentSaveOwnership(rootPath, path);
      if (!ownership) {
        return null;
      }
      const documentIdentity = documentSaveOwnershipKey(ownership);
      if (!documentIdentity) {
        return null;
      }
      const existingSnapshot = snapshotsByDocumentIdentity.get(
        documentIdentity,
      );
      if (
        existingSnapshot &&
        !sameCanonicalSnapshot(existingSnapshot, document)
      ) {
        return null;
      }

      snapshotsByDocumentIdentity.set(documentIdentity, document);
      targets.push({
        owner,
        targetId: `${owner.ownerKey}\0${documentIdentity}\0${path}`,
        identity: { document, documentIdentity, ownership, path },
      });
    }

    const decisionPathSet = new Set(decisionPaths);
    for (const path of editorGroupsUniquePaths(editorGroupsRef.current)) {
      if (decisionPathSet.has(path)) {
        continue;
      }
      const document = documentsRef.current[path];
      if (!document) {
        continue;
      }
      const ownership = resolveDocumentSaveOwnership(rootPath, path);
      if (!ownership) {
        return null;
      }
      const documentIdentity = documentSaveOwnershipKey(ownership);
      if (!documentIdentity) {
        return null;
      }
      const decisionSnapshot = snapshotsByDocumentIdentity.get(
        documentIdentity,
      );
      if (
        decisionSnapshot &&
        !sameCanonicalSnapshot(decisionSnapshot, document)
      ) {
        return null;
      }
      if (decisionSnapshot) {
        externalAliases.set(path, document);
      }
    }
    return { externalAliases, targets };
  }, [
    currentWorkspaceRootRef,
    documentsRef,
    editorGroupsRef,
    hasExternalFileConflict,
    resolveDocumentSaveOwnership,
    resolveWorkspaceRuntimeOwner,
  ]);

  const closeDocumentInEditorGroup = useCallback(async (
    groupId: EditorGroupId,
    path: string,
    options: DocumentCloseOptions = {},
  ): Promise<CloseCompletion> => {
    const editorGroups = editorGroupsRef.current;
    const result = closeEditorGroupTab(editorGroups, groupId, path);
    if (!result.membershipRemoved) {
      return "stale";
    }
    if (!result.finalMembershipRemoved) {
      updateEditorGroups(() => result.state);
      return "closed";
    }

    const capture = captureTargets([path]);
    if (!capture) {
      return "stale";
    }
    const completion = await executeCapturedClose({
      documents: captureDocuments(documentsRef.current, [path]),
      editorGroups,
      externalAliases: capture.externalAliases,
      targets: capture.targets,
      commit: () => commitMembershipClose(groupId, path, options),
    }, "tab", options);
    if (completion === "closed") {
      onDidCloseEditorPaths?.([path]);
    }
    return completion;
  }, [
    captureTargets,
    commitMembershipClose,
    documentsRef,
    editorGroupsRef,
    executeCapturedClose,
    onDidCloseEditorPaths,
    updateEditorGroups,
  ]);

  const closeDocument = useCallback((
    path: string,
    options: DocumentCloseOptions = {},
  ) => closeDocumentInEditorGroup(
    editorGroupsRef.current.activeGroupId,
    path,
    options,
  ), [closeDocumentInEditorGroup, editorGroupsRef]);

  const commitGroupCloseAtomically = useCallback((
    capturedGroups: EditorGroupsState,
    groupId: EditorGroupId,
    paths: readonly string[],
    commit: () => void,
  ) => {
    const openPaths = openPathsRef.current;
    const previewPath = previewPathRef.current;
    const activeDocument = activeDocumentRef.current;
    const documents = documentsRef.current;
    const imageTabs = imageTabsRef.current;
    const markdownPreviewTabs = markdownPreviewTabsRef.current;

    const liveGroup = editorGroupsRef.current.groups[groupId];
    if (
      editorGroupsRef.current !== capturedGroups ||
      !liveGroup ||
      !samePaths(editorGroupVisiblePaths(liveGroup), paths)
    ) {
      throw new Error("Editor group changed before close commit");
    }

    try {
      commit();
    } catch (error) {
      editorGroupsRef.current = capturedGroups;
      openPathsRef.current = openPaths;
      previewPathRef.current = previewPath;
      activeDocumentRef.current = activeDocument;
      documentsRef.current = documents;
      imageTabsRef.current = imageTabs;
      markdownPreviewTabsRef.current = markdownPreviewTabs;
      setImageTabs(imageTabs);
      setMarkdownPreviewTabs(markdownPreviewTabs);
      updateEditorGroups(() => capturedGroups);
      throw error;
    }
  }, [
    activeDocumentRef,
    documentsRef,
    editorGroupsRef,
    imageTabsRef,
    markdownPreviewTabsRef,
    openPathsRef,
    previewPathRef,
    setImageTabs,
    setMarkdownPreviewTabs,
    updateEditorGroups,
  ]);

  const closeActiveEditorGroup = useCallback(async (): Promise<CloseCompletion> => {
    const editorGroups = editorGroupsRef.current;
    const groupId = editorGroups.activeGroupId;
    const group = editorGroups.groups[groupId];
    if (!group) {
      return "stale";
    }
    const closeResult = closeEditorGroup(editorGroups, groupId);
    const capture = captureTargets(closeResult.finalMembershipPaths);
    if (!capture) {
      return "stale";
    }

    const commit = () => commitGroupCloseAtomically(
      editorGroups,
      groupId,
      editorGroupVisiblePaths(group),
      () => {
        for (const path of editorGroupVisiblePaths(group)) {
          commitMembershipClose(
            groupId,
            path,
            { skipConfirmation: true },
            false,
          );
        }
        for (const path of closeResult.finalMembershipPaths) {
          clearCodeQualityDiagnostics(path);
        }
        updateEditorGroups(() => closeResult.state);
      },
    );
    const completion = await executeCapturedClose(
      {
        documents: captureDocuments(
          documentsRef.current,
          closeResult.finalMembershipPaths,
        ),
        editorGroups,
        externalAliases: capture.externalAliases,
        targets: capture.targets,
        commit,
      },
      "group",
    );
    if (completion === "closed") {
      onDidCloseEditorPaths?.(closeResult.finalMembershipPaths);
    }
    return completion;
  }, [
    captureTargets,
    clearCodeQualityDiagnostics,
    commitGroupCloseAtomically,
    commitMembershipClose,
    documentsRef,
    editorGroupsRef,
    executeCapturedClose,
    onDidCloseEditorPaths,
    updateEditorGroups,
  ]);

  const closeActiveSurface = useCallback(async (): Promise<CloseCompletion> => {
    const current = editorGroupsRef.current;
    const activePath = current.groups[current.activeGroupId]?.activePath ?? null;
    if (activePath) {
      return closeDocumentInEditorGroup(current.activeGroupId, activePath);
    }

    closeTextSurface({ skipConfirmation: true });
    return "closed";
  }, [closeDocumentInEditorGroup, closeTextSurface, editorGroupsRef]);

  const closeActiveEditorGroupSurface = useCallback(async () => {
    const current = editorGroupsRef.current;
    const group = current.groups[current.activeGroupId];
    if (group?.activePath) {
      return closeDocumentInEditorGroup(current.activeGroupId, group.activePath);
    }
    if (Object.keys(current.groups).length > 1) {
      return closeActiveEditorGroup();
    }
    return closeActiveSurface();
  }, [
    closeActiveEditorGroup,
    closeActiveSurface,
    closeDocumentInEditorGroup,
    editorGroupsRef,
  ]);

  return {
    closeDocument,
    closeDocumentInEditorGroup,
    closeActiveEditorGroup,
    closeActiveSurface,
    closeActiveEditorGroupSurface,
  };
}

function sameCapturedDocument(
  live: EditorDocument,
  captured: EditorDocument,
): boolean {
  return live.path === captured.path &&
    live.name === captured.name &&
    live.content === captured.content &&
    live.savedContent === captured.savedContent &&
    live.language === captured.language &&
    (live.readOnly ?? false) === (captured.readOnly ?? false) &&
    sameRevision(live.revision ?? null, captured.revision ?? null);
}

function sameEditorCloseMembership(
  live: EditorGroupsState,
  captured: EditorGroupsState,
): boolean {
  if (live.activeGroupId !== captured.activeGroupId) {
    return false;
  }
  const liveGroupIds = Object.keys(live.groups);
  const capturedGroupIds = Object.keys(captured.groups);
  if (!samePaths(liveGroupIds, capturedGroupIds)) {
    return false;
  }

  return capturedGroupIds.every((groupId) => {
    const liveGroup = live.groups[groupId];
    const capturedGroup = captured.groups[groupId];
    return Boolean(liveGroup) && Boolean(capturedGroup) &&
      liveGroup.activePath === capturedGroup.activePath &&
      samePaths(
        editorGroupVisiblePaths(liveGroup),
        editorGroupVisiblePaths(capturedGroup),
      );
  });
}

function sameCanonicalSnapshot(
  first: EditorDocument,
  second: EditorDocument,
): boolean {
  return first.content === second.content &&
    first.savedContent === second.savedContent &&
    first.language === second.language &&
    (first.readOnly ?? false) === (second.readOnly ?? false) &&
    sameRevision(first.revision ?? null, second.revision ?? null);
}

function captureDocuments(
  documents: Readonly<Record<string, EditorDocument>>,
  paths: readonly string[],
): ReadonlyMap<string, EditorDocument> {
  const captured = new Map<string, EditorDocument>();
  for (const path of paths) {
    const document = documents[path];
    if (document) {
      captured.set(path, document);
    }
  }
  return captured;
}

function groupTargetsByDocumentIdentity(
  targets: readonly EditorCloseTarget[],
): ReadonlyMap<string, readonly EditorCloseTarget[]> {
  const groups = new Map<string, EditorCloseTarget[]>();
  for (const target of targets) {
    const identity = target.identity.documentIdentity;
    const group = groups.get(identity);
    if (group) {
      group.push(target);
      continue;
    }

    groups.set(identity, [target]);
  }
  return groups;
}

function samePaths(first: readonly string[], second: readonly string[]): boolean {
  return first.length === second.length &&
    first.every((path, index) => path === second[index]);
}

function uniqueTargetInvalidationScopes(
  targets: readonly EditorCloseTarget[],
): DocumentSaveInvalidationScope[] {
  const scopes: DocumentSaveInvalidationScope[] = [];
  const identities = new Set<string>();
  for (const target of targets) {
    const identity = target.identity.documentIdentity;
    if (identities.has(identity)) {
      continue;
    }

    identities.add(identity);
    const ownership = target.identity.ownership;
    if ("canonicalRoot" in ownership) {
      scopes.push({ kind: "file", ...ownership });
      continue;
    }

    scopes.push({ kind: "file", ...ownership });
  }
  return scopes;
}

function editorCloseRelativePath(ownership: DocumentSaveOwnership): string {
  if ("workspaceRelativePath" in ownership) {
    return ownership.workspaceRelativePath;
  }

  const normalizedRoot = ownership.rootPath.replace(/[\\/]+$/, "");
  const prefix = `${normalizedRoot}/`;
  if (ownership.path.startsWith(prefix)) {
    return ownership.path.slice(prefix.length);
  }

  return ownership.path.split(/[\\/]/).pop() ?? ownership.path;
}

function sameRevision(
  live: EditorDocument["revision"],
  captured: EditorDocument["revision"],
): boolean {
  if (live === captured) {
    return true;
  }
  if (!live || !captured) {
    return false;
  }

  return live.device === captured.device &&
    live.inode === captured.inode &&
    live.size === captured.size &&
    live.modifiedSeconds === captured.modifiedSeconds &&
    live.modifiedNanoseconds === captured.modifiedNanoseconds &&
    live.contentHash === captured.contentHash;
}

function staleCommit(
  targets: readonly EditorCloseTarget[],
  reason: "target-replaced",
): DirtyCloseConditionalCommitResult<EditorCloseIdentity, void> {
  const target = targets[0];
  if (target) {
    return { status: "stale", target, reason };
  }

  throw new Error("A captured close scope changed without a close target");
}
