import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type MutableRefObject,
  type SetStateAction,
} from "react";
import {
  activateEditorGroupPath,
  createEditorGroup,
  createInitialEditorGroupsState,
  editorGroupVisiblePaths,
  updateEditorGroupOpenPaths,
  updateEditorGroupPreviewPath,
  type EditorLayout,
  type EditorGroupsState,
} from "../domain/editorGroups";
import {
  DEFAULT_DOCUMENT_CONTENT_COMMIT_COALESCING_POLICY,
  isCoalescableLargeContentCommit,
  isDocumentContentCommitPolicyLarge,
  type DocumentContentCommitCoalescingPolicy,
} from "../domain/documentContentCommitCoalescing";
import { isPersistableEditorDocumentPath } from "../domain/editorDocumentSchemes";
import type { LargeSmartDocumentMetrics } from "../domain/largeDocumentPolicy";
import { classifyJavaScriptTypeScriptLargeDocumentCapabilityFromMetrics } from "../domain/javaScriptTypeScriptLargeDocumentCapability";
import { isJavaScriptTypeScriptLanguageServerDocument } from "../domain/languageServerDocumentSync";
import type { MarkdownPreviewTab } from "../domain/markdownPreview";
import {
  buildEditorSurfaceSnapshot,
  restoredActivePath,
  selectEditorSurfaceRestore,
  type EditorSurfaceSnapshot,
} from "../domain/workspaceSessionSnapshot";
import type { EditorDocument, ImageTab } from "../domain/workspace";
import { isSessionPathInWorkspace } from "./documentSessionState";
import { DocumentSessionStore } from "./documentSessionStore";
import type { DocumentSessionOwnerInput } from "./documentSessionStorePort";
import { CoalescedCommitScheduler } from "./coalescedCommitScheduler";
import type { ResolveDocumentSaveOwnership } from "./documentSaveIdentity";
import {
  EditorSessionDocumentAuthoritySidecar,
  type AttachEditorGroupLiveDocument,
  type EditorGroupDocumentSessionAuthority,
  type EditorSessionDocumentLifecycleAuthority,
} from "./editorSessionDocumentAuthority";
import {
  activateDocumentTabSessionPath,
  commitImageTabOpen,
  commitTextDocumentOpen,
  openReadOnlyDocumentInSession,
  openExistingDocumentInSession,
  pinDocumentTabSessionPath,
  refreshCleanDocumentInSession,
  removeDocumentFromSession,
  synchronizeSnapshotView,
  type DocumentTabSessionPort,
  type DocumentTabSessionSnapshot,
} from "./documentTabSessionPort";
import type {
  EditorDocumentDirtyProjection,
  EditorOwnerDirtyCountProjection,
} from "./editorSessionDirtyProjection";

type Documents = Record<string, EditorDocument>;
type ImageTabs = Record<string, ImageTab>;
type MarkdownPreviewTabs = Record<string, MarkdownPreviewTab>;

export interface EditorSessionState {
  activateDocumentSessionAuthority(
    input: DocumentSessionOwnerInput,
    resolveOwnership: ResolveDocumentSaveOwnership,
    documents: Readonly<Documents>,
  ): boolean;
  attachEditorGroupLiveDocument: AttachEditorGroupLiveDocument;
  deactivateDocumentSessionAuthority(): void;
  activeDocument: EditorDocument | null;
  activeDocumentRef: MutableRefObject<EditorDocument | null>;
  activeGroupId: string;
  activeImage: ImageTab | null;
  activeMarkdownPreview: MarkdownPreviewTab | null;
  activePath: string | null;
  documents: Documents;
  documentsRef: MutableRefObject<Documents>;
  documentSessionAuthorityRevision: DocumentSessionAuthorityRevision;
  documentTabSession: DocumentTabSessionPort;
  editorGroups: EditorGroupsState;
  editorGroupsRef: MutableRefObject<EditorGroupsState>;
  imageTabs: ImageTabs;
  imageTabsRef: MutableRefObject<ImageTabs>;
  markdownPreviewTabs: MarkdownPreviewTabs;
  markdownPreviewTabsRef: MutableRefObject<MarkdownPreviewTabs>;
  nextEditorGroupIdRef: MutableRefObject<number>;
  openPaths: string[];
  openPathsRef: MutableRefObject<string[]>;
  previewPath: string | null;
  previewPathRef: MutableRefObject<string | null>;
  reconcileDocumentSessionTopology(update: SetStateAction<Documents>): boolean;
  reportChangedDocuments: (paths: readonly string[]) => void;
  isDocumentSessionLifecycleAuthorityCurrent(
    authority: EditorSessionDocumentLifecycleAuthority,
  ): boolean;
  isEditorGroupDocumentSessionAuthorityCurrent(
    authority: EditorGroupDocumentSessionAuthority,
  ): boolean;
  resolveActiveDocumentSessionAuthority(): EditorGroupDocumentSessionAuthority | null;
  resolveDocumentSessionLifecycleAuthority(
    path: string,
  ): EditorSessionDocumentLifecycleAuthority | null;
  resolveDocumentSessionDirtyProjection(path: string): EditorDocumentDirtyProjection | null;
  resolveEditorGroupDocumentSessionAuthority(
    groupId: string,
  ): EditorGroupDocumentSessionAuthority | null;
  resetEditorSurfaceState: () => void;
  restoreEditorSurface: (rootPath: string, snapshot: EditorSurfaceSnapshot) => void;
  setActivePath: Dispatch<SetStateAction<string | null>>;
  setDocuments: Dispatch<SetStateAction<Documents>>;
  setImageTabs: Dispatch<SetStateAction<ImageTabs>>;
  setMarkdownPreviewTabs: Dispatch<SetStateAction<MarkdownPreviewTabs>>;
  setOpenPaths: Dispatch<SetStateAction<string[]>>;
  setPreviewPath: Dispatch<SetStateAction<string | null>>;
  snapshotEditorSurface: (rootPath: string) => EditorSurfaceSnapshot;
  subscribeChangedDocuments: (listener: (paths: readonly string[]) => void) => () => void;
  updateDocumentContent(path: string, content: string, metrics: LargeSmartDocumentMetrics): boolean;
  updateEditorGroups: (update: (current: EditorGroupsState) => EditorGroupsState) => void;
}

export type { EditorGroupDocumentSessionAuthority } from "./editorSessionDocumentAuthority";

export interface DocumentSessionAuthorityRevision {
  readonly incarnation: object;
  readonly ownerDirtyCountProjection: EditorOwnerDirtyCountProjection | null;
  readonly sequence: number;
}

const MAX_DOCUMENT_SESSION_AUTHORITY_REVISION_SEQUENCE = Number.MAX_SAFE_INTEGER;

export function useEditorSessionState(
  documentContentCommitCoalescingPolicy?: DocumentContentCommitCoalescingPolicy,
): EditorSessionState {
  const effectiveDocumentContentCommitCoalescingPolicy =
    documentContentCommitCoalescingPolicy ?? DEFAULT_DOCUMENT_CONTENT_COMMIT_COALESCING_POLICY;
  const [documents, setDocumentsState] = useState<Documents>({});
  const [imageTabs, setImageTabsState] = useState<ImageTabs>({});
  const [markdownPreviewTabs, setMarkdownPreviewTabsState] = useState<MarkdownPreviewTabs>({});
  const [editorGroups, setEditorGroupsState] = useState<EditorGroupsState>(() =>
    createInitialEditorGroupsState("editor-main"),
  );
  const documentAuthorityRef = useRef<EditorSessionDocumentAuthoritySidecar | null>(null);
  if (!documentAuthorityRef.current) {
    documentAuthorityRef.current = new EditorSessionDocumentAuthoritySidecar(
      new DocumentSessionStore(),
    );
  }
  const [documentSessionAuthorityRevision, setDocumentSessionAuthorityRevision] =
    useState<DocumentSessionAuthorityRevision>(() =>
      createDocumentSessionAuthorityRevision(0, null),
    );
  const documentSessionAuthorityRevisionRef = useRef(documentSessionAuthorityRevision);
  const documentSessionAuthorityActiveRef = useRef(false);
  const documentsRef = useRef<Documents>({});
  const groupSelectionLeasesRef = useRef(
    new Map<
      string,
      {
        readonly authority: EditorGroupDocumentSessionAuthority;
        readonly lifecycleIdentity: object;
        readonly path: string;
      }
    >(),
  );
  const imageTabsRef = useRef<ImageTabs>({});
  const markdownPreviewTabsRef = useRef<MarkdownPreviewTabs>({});
  const editorGroupsRef = useRef(editorGroups);
  const nextEditorGroupIdRef = useRef(1);
  const activeDocumentRef = useRef<EditorDocument | null>(null);
  const openPathsRef = useRef<string[]>([]);
  const previewPathRef = useRef<string | null>(null);
  const changedDocumentListenersRef = useRef(new Set<(paths: readonly string[]) => void>());
  const largeDocumentClassificationByPathRef = useRef(
    new Map<
      string,
      {
        readonly characterLimit: number;
        readonly large: boolean;
        readonly lineCount: number;
        readonly lineLimit: number;
        readonly utf16Length: number;
      }
    >(),
  );

  const advanceDocumentSessionAuthorityRevision = useCallback(() => {
    const current = documentSessionAuthorityRevisionRef.current;
    const sequence =
      current.sequence >= MAX_DOCUMENT_SESSION_AUTHORITY_REVISION_SEQUENCE
        ? 0
        : current.sequence + 1;
    const next = createDocumentSessionAuthorityRevision(
      sequence,
      documentAuthorityRef.current!.resolveOwnerDirtyCountProjection(),
    );
    documentSessionAuthorityRevisionRef.current = next;
    setDocumentSessionAuthorityRevision(next);
  }, []);

  const reportChangedDocuments = useCallback((paths: readonly string[]) => {
    if (paths.length === 0) {
      return;
    }

    const changedPaths = Array.from(new Set(paths));
    changedDocumentListenersRef.current.forEach((listener) => {
      listener(changedPaths);
    });
  }, []);

  const subscribeChangedDocuments = useCallback((listener: (paths: readonly string[]) => void) => {
    changedDocumentListenersRef.current.add(listener);
    return () => {
      changedDocumentListenersRef.current.delete(listener);
    };
  }, []);

  const synchronizeActiveGroupRefs = useCallback((next: EditorGroupsState) => {
    const group = next.groups[next.activeGroupId] ?? createEditorGroup();
    openPathsRef.current = group.openPaths;
    previewPathRef.current = group.previewPath;
    activeDocumentRef.current = group.activePath
      ? (documentsRef.current[group.activePath] ?? null)
      : null;
  }, []);
  const invalidateChangedGroupSelections = useCallback((next: EditorGroupsState) => {
    for (const [groupId, selection] of groupSelectionLeasesRef.current) {
      if (next.groups[groupId]?.activePath !== selection.path) {
        groupSelectionLeasesRef.current.delete(groupId);
      }
    }
  }, []);
  const invalidateReplacedDocumentSelections = useCallback(() => {
    for (const [groupId, selection] of groupSelectionLeasesRef.current) {
      const lifecycle = documentAuthorityRef.current!.resolveLifecycle(selection.path);
      if (lifecycle?.identity !== selection.lifecycleIdentity) {
        groupSelectionLeasesRef.current.delete(groupId);
      }
    }
  }, []);

  const pendingCoalescedDocumentsRef = useRef<Documents | null>(null);
  const documentsCommitSchedulerRef = useRef<CoalescedCommitScheduler | null>(null);
  if (!documentsCommitSchedulerRef.current) {
    documentsCommitSchedulerRef.current = new CoalescedCommitScheduler(() => {
      pendingCoalescedDocumentsRef.current = null;
      setDocumentsState(documentsRef.current);
    });
  }
  const documentsCommitScheduler = documentsCommitSchedulerRef.current;
  useEffect(() => {
    documentsCommitScheduler.arm();

    return () => {
      documentsCommitScheduler.dispose();
    };
  }, [documentsCommitScheduler]);
  useEffect(() => {
    if (pendingCoalescedDocumentsRef.current === null) {
      return;
    }
    pendingCoalescedDocumentsRef.current = null;
    documentsCommitScheduler.commitNow();
  }, [
    documentsCommitScheduler,
    effectiveDocumentContentCommitCoalescingPolicy.characterLimit,
    effectiveDocumentContentCommitCoalescingPolicy.lineLimit,
  ]);

  const setDocuments = useCallback<Dispatch<SetStateAction<Documents>>>(
    (update) => {
      const next = resolveStateUpdate(documentsRef.current, update);
      documentsRef.current = next;
      pendingCoalescedDocumentsRef.current = null;
      largeDocumentClassificationByPathRef.current.clear();
      synchronizeActiveGroupRefs(editorGroupsRef.current);
      documentsCommitScheduler.commitNow();
    },
    [documentsCommitScheduler, synchronizeActiveGroupRefs],
  );
  const updateDocumentContent = useCallback(
    (path: string, content: string, metrics: LargeSmartDocumentMetrics): boolean => {
      const current = documentsRef.current;
      const before = current[path];
      if (!before || before.readOnly || before.content === content) {
        return false;
      }

      const after = { ...before, content };
      const cachedClassification = largeDocumentClassificationByPathRef.current.get(path);
      const policyLarge =
        cachedClassification?.characterLimit ===
          effectiveDocumentContentCommitCoalescingPolicy.characterLimit &&
        cachedClassification.lineLimit ===
          effectiveDocumentContentCommitCoalescingPolicy.lineLimit &&
        cachedClassification.lineCount === metrics.lineCount &&
        cachedClassification.utf16Length === metrics.utf16Length
          ? cachedClassification.large
          : isJavaScriptTypeScriptLanguageServerDocument(before)
            ? classifyJavaScriptTypeScriptLargeDocumentCapabilityFromMetrics(
                metrics,
                effectiveDocumentContentCommitCoalescingPolicy,
              ).kind !== "full"
            : isDocumentContentCommitPolicyLarge(
                metrics,
                effectiveDocumentContentCommitCoalescingPolicy,
              );
      const coalescable = isCoalescableLargeContentCommit(before, after, policyLarge);
      largeDocumentClassificationByPathRef.current.set(path, {
        characterLimit: effectiveDocumentContentCommitCoalescingPolicy.characterLimit,
        large: policyLarge,
        lineCount: metrics.lineCount,
        lineLimit: effectiveDocumentContentCommitCoalescingPolicy.lineLimit,
        utf16Length: metrics.utf16Length,
      });

      let next: Documents;
      if (coalescable && pendingCoalescedDocumentsRef.current === current) {
        current[path] = after;
        next = current;
      } else {
        next = { ...current, [path]: after };
      }
      documentsRef.current = next;
      synchronizeActiveGroupRefs(editorGroupsRef.current);

      if (coalescable) {
        pendingCoalescedDocumentsRef.current = next;
        documentsCommitScheduler.commitCoalesced();
      } else {
        pendingCoalescedDocumentsRef.current = null;
        documentsCommitScheduler.commitNow();
      }
      return true;
    },
    [
      documentsCommitScheduler,
      effectiveDocumentContentCommitCoalescingPolicy,
      synchronizeActiveGroupRefs,
    ],
  );
  const reconcileDocumentSessionTopology = useCallback(
    (update: SetStateAction<Documents>): boolean => {
      const currentDocuments = documentsRef.current;
      const nextDocuments = resolveStateUpdate(currentDocuments, update);
      if (documentPathTopologyEqual(currentDocuments, nextDocuments)) {
        setDocuments(nextDocuments);
        return true;
      }
      if (!documentSessionAuthorityActiveRef.current) {
        setDocuments(nextDocuments);
        return true;
      }

      const previousAuthorityTopology = captureDocumentAuthorityTopology(
        documentAuthorityRef.current!,
        currentDocuments,
      );
      const reconciled = documentAuthorityRef.current!.reconcile(nextDocuments);
      const applied = reconciled.status === "applied";
      let authorityChanged = false;
      if (applied) {
        authorityChanged =
          documentSessionAuthorityActiveRef.current &&
          !documentAuthorityTopologiesEqual(
            previousAuthorityTopology,
            captureDocumentAuthorityTopology(documentAuthorityRef.current!, nextDocuments),
          );
      } else if (documentSessionAuthorityActiveRef.current) {
        documentSessionAuthorityActiveRef.current = false;
        authorityChanged = true;
      }
      invalidateReplacedDocumentSelections();
      setDocuments(nextDocuments);
      if (authorityChanged) {
        advanceDocumentSessionAuthorityRevision();
      }
      return applied;
    },
    [advanceDocumentSessionAuthorityRevision, invalidateReplacedDocumentSelections, setDocuments],
  );

  const activateDocumentSessionAuthority = useCallback(
    (
      input: DocumentSessionOwnerInput,
      resolveOwnership: ResolveDocumentSaveOwnership,
      intendedDocuments: Readonly<Documents>,
    ): boolean => {
      const activated = documentAuthorityRef.current!.activateOwner(
        input,
        resolveOwnership,
        intendedDocuments,
      );
      const authorityChanged = documentSessionAuthorityActiveRef.current || activated;
      documentSessionAuthorityActiveRef.current = activated;
      if (authorityChanged) {
        advanceDocumentSessionAuthorityRevision();
      }
      if (!activated) return false;
      setDocuments({ ...intendedDocuments });
      return true;
    },
    [advanceDocumentSessionAuthorityRevision, setDocuments],
  );
  const deactivateDocumentSessionAuthority = useCallback(() => {
    documentAuthorityRef.current!.deactivate();
    groupSelectionLeasesRef.current.clear();
    if (!documentSessionAuthorityActiveRef.current) {
      return;
    }
    documentSessionAuthorityActiveRef.current = false;
    advanceDocumentSessionAuthorityRevision();
  }, [advanceDocumentSessionAuthorityRevision]);
  const resolveDocumentSessionLifecycleAuthority = useCallback(
    (path: string) => documentAuthorityRef.current!.resolveLifecycle(path),
    [],
  );
  const resolveDocumentSessionDirtyProjection = useCallback((path: string) => {
    const lifecycle = documentAuthorityRef.current!.resolveLifecycle(path);
    return lifecycle
      ? documentAuthorityRef.current!.resolveDocumentDirtyProjection(lifecycle)
      : null;
  }, []);
  const isDocumentSessionLifecycleAuthorityCurrent = useCallback(
    (authority: EditorSessionDocumentLifecycleAuthority) =>
      documentAuthorityRef.current!.isLifecycleCurrent(authority),
    [],
  );
  const resolveEditorGroupDocumentSessionAuthority = useCallback((groupId: string) => {
    const groups = editorGroupsRef.current;
    const path = groups.groups[groupId]?.activePath;
    if (!path) {
      return null;
    }
    const lifecycle = documentAuthorityRef.current!.resolveLifecycle(path);
    if (!lifecycle) return null;
    const current = groupSelectionLeasesRef.current.get(groupId);
    const selection =
      current?.path === path && current.lifecycleIdentity === lifecycle.identity
        ? current
        : (() => {
            const authority = documentAuthorityRef.current!.createGroupAuthority(
              lifecycle,
              groupId,
              path,
              Object.freeze({}),
            );
            return authority
              ? {
                  authority,
                  lifecycleIdentity: lifecycle.identity,
                  path,
                }
              : null;
          })();
    if (!selection) return null;
    groupSelectionLeasesRef.current.set(groupId, selection);
    return selection.authority;
  }, []);
  const resolveActiveDocumentSessionAuthority = useCallback(
    () => resolveEditorGroupDocumentSessionAuthority(editorGroupsRef.current.activeGroupId),
    [resolveEditorGroupDocumentSessionAuthority],
  );
  const isEditorGroupSelectionAuthorityCurrent = useCallback(
    (authority: EditorGroupDocumentSessionAuthority) => {
      const current = groupSelectionLeasesRef.current.get(authority.groupId);
      return (
        current?.authority === authority &&
        current.path === authority.path &&
        editorGroupsRef.current.groups[authority.groupId]?.activePath === authority.path
      );
    },
    [],
  );
  const isEditorGroupDocumentSessionAuthorityCurrent = useCallback(
    (authority: EditorGroupDocumentSessionAuthority) =>
      isEditorGroupSelectionAuthorityCurrent(authority) &&
      documentAuthorityRef.current!.isGroupLifecycleCurrent(authority),
    [isEditorGroupSelectionAuthorityCurrent],
  );
  const attachEditorGroupLiveDocument = useCallback<AttachEditorGroupLiveDocument>(
    (authority, source, baseRevision) => {
      if (!isEditorGroupDocumentSessionAuthorityCurrent(authority)) {
        return null;
      }
      return documentAuthorityRef.current!.attachEditorGroupLiveDocument(
        authority,
        source,
        baseRevision,
        () => isEditorGroupSelectionAuthorityCurrent(authority),
      );
    },
    [isEditorGroupDocumentSessionAuthorityCurrent, isEditorGroupSelectionAuthorityCurrent],
  );

  const setImageTabs = useCallback<Dispatch<SetStateAction<ImageTabs>>>((update) => {
    const next = resolveStateUpdate(imageTabsRef.current, update);
    imageTabsRef.current = next;
    setImageTabsState(next);
  }, []);

  const setMarkdownPreviewTabs = useCallback<Dispatch<SetStateAction<MarkdownPreviewTabs>>>(
    (update) => {
      const next = resolveStateUpdate(markdownPreviewTabsRef.current, update);
      markdownPreviewTabsRef.current = next;
      setMarkdownPreviewTabsState(next);
    },
    [],
  );

  const updateEditorGroups = useCallback(
    (update: (current: EditorGroupsState) => EditorGroupsState) => {
      const current = editorGroupsRef.current;
      const next = update(current);
      const authorityTopologyChanged =
        documentSessionAuthorityActiveRef.current &&
        !editorGroupAuthorityTopologiesEqual(current, next);
      invalidateChangedGroupSelections(next);
      editorGroupsRef.current = next;
      synchronizeActiveGroupRefs(next);
      setEditorGroupsState(next);
      if (authorityTopologyChanged) {
        advanceDocumentSessionAuthorityRevision();
      }
    },
    [
      advanceDocumentSessionAuthorityRevision,
      invalidateChangedGroupSelections,
      synchronizeActiveGroupRefs,
    ],
  );

  const activeGroupId = editorGroups.activeGroupId;
  const activeGroup = editorGroups.groups[activeGroupId] ?? createEditorGroup();
  const { activePath, openPaths, previewPath } = activeGroup;
  const activeDocument = activePath ? (documents[activePath] ?? null) : null;
  const activeImage = activePath ? (imageTabs[activePath] ?? null) : null;
  const activeMarkdownPreview = activePath ? (markdownPreviewTabs[activePath] ?? null) : null;

  const setActivePath = useCallback<Dispatch<SetStateAction<string | null>>>(
    (update) => {
      updateEditorGroups((current) => {
        const group = current.groups[current.activeGroupId];
        if (!group) {
          return current;
        }

        return {
          ...current,
          groups: {
            ...current.groups,
            [current.activeGroupId]: activateEditorGroupPath(
              group,
              resolveStateUpdate(group.activePath, update),
            ),
          },
        };
      });
    },
    [updateEditorGroups],
  );

  const setOpenPaths = useCallback<Dispatch<SetStateAction<string[]>>>(
    (update) => {
      updateEditorGroups((current) => {
        const group = current.groups[current.activeGroupId];
        if (!group) {
          return current;
        }

        return {
          ...current,
          groups: {
            ...current.groups,
            [current.activeGroupId]: updateEditorGroupOpenPaths(group, update),
          },
        };
      });
    },
    [updateEditorGroups],
  );

  const setPreviewPath = useCallback<Dispatch<SetStateAction<string | null>>>(
    (update) => {
      updateEditorGroups((current) => {
        const group = current.groups[current.activeGroupId];
        if (!group) {
          return current;
        }

        return {
          ...current,
          groups: {
            ...current.groups,
            [current.activeGroupId]: updateEditorGroupPreviewPath(group, update),
          },
        };
      });
    },
    [updateEditorGroups],
  );

  const resetEditorSurfaceState = useCallback(() => {
    const nextEditorGroups = createInitialEditorGroupsState("editor-main");
    const previousAuthorityTopology = captureDocumentAuthorityTopology(
      documentAuthorityRef.current!,
      documentsRef.current,
    );
    const hadGroupSelectionAuthority = groupSelectionLeasesRef.current.size > 0;
    documentsRef.current = {};
    imageTabsRef.current = {};
    markdownPreviewTabsRef.current = {};
    editorGroupsRef.current = nextEditorGroups;
    nextEditorGroupIdRef.current = 1;
    const reconciled = documentAuthorityRef.current!.reconcile({});
    groupSelectionLeasesRef.current.clear();
    if (
      documentSessionAuthorityActiveRef.current &&
      (reconciled.status === "rejected" ||
        previousAuthorityTopology.size > 0 ||
        hadGroupSelectionAuthority)
    ) {
      if (reconciled.status === "rejected") {
        documentSessionAuthorityActiveRef.current = false;
      }
      advanceDocumentSessionAuthorityRevision();
    }
    synchronizeActiveGroupRefs(nextEditorGroups);
    pendingCoalescedDocumentsRef.current = null;
    largeDocumentClassificationByPathRef.current.clear();
    documentsCommitScheduler.commitNow();
    setImageTabsState({});
    setMarkdownPreviewTabsState({});
    setEditorGroupsState(nextEditorGroups);
  }, [
    advanceDocumentSessionAuthorityRevision,
    documentsCommitScheduler,
    synchronizeActiveGroupRefs,
  ]);

  const liveDocumentTabSnapshot = useCallback(
    (): DocumentTabSessionSnapshot =>
      synchronizeSnapshotView({
        documents: documentsRef.current,
        editorGroups: editorGroupsRef.current,
        imageTabs: imageTabsRef.current,
      }),
    [],
  );

  const snapshotDocumentTabs = useCallback(
    (): DocumentTabSessionSnapshot => detachDocumentTabSnapshot(liveDocumentTabSnapshot()),
    [liveDocumentTabSnapshot],
  );

  const commitDocumentTabs = useCallback(
    (snapshot: DocumentTabSessionSnapshot) => {
      if (documentTabSnapshotsEqual(liveDocumentTabSnapshot(), snapshot)) {
        return;
      }

      const currentDocuments = documentsRef.current;
      const documentTopologyChanged = !documentPathTopologyEqual(
        currentDocuments,
        snapshot.documents,
      );
      const groupAuthorityTopologyChanged = !editorGroupAuthorityTopologiesEqual(
        editorGroupsRef.current,
        snapshot.editorGroups,
      );
      let authorityChanged = false;
      if (documentTopologyChanged) {
        const previousAuthorityTopology = captureDocumentAuthorityTopology(
          documentAuthorityRef.current!,
          currentDocuments,
        );
        const reconciled = documentAuthorityRef.current!.reconcile(snapshot.documents);
        if (reconciled.status === "applied") {
          authorityChanged =
            documentSessionAuthorityActiveRef.current &&
            !documentAuthorityTopologiesEqual(
              previousAuthorityTopology,
              captureDocumentAuthorityTopology(documentAuthorityRef.current!, snapshot.documents),
            );
        } else if (documentSessionAuthorityActiveRef.current) {
          documentSessionAuthorityActiveRef.current = false;
          authorityChanged = true;
        }
        invalidateReplacedDocumentSelections();
      }
      invalidateChangedGroupSelections(snapshot.editorGroups);
      documentsRef.current = snapshot.documents;
      pendingCoalescedDocumentsRef.current = null;
      largeDocumentClassificationByPathRef.current.clear();
      imageTabsRef.current = snapshot.imageTabs;
      editorGroupsRef.current = snapshot.editorGroups;
      synchronizeActiveGroupRefs(snapshot.editorGroups);
      documentsCommitScheduler.commitNow();
      setImageTabsState(snapshot.imageTabs);
      setEditorGroupsState(snapshot.editorGroups);
      if (
        authorityChanged ||
        (documentSessionAuthorityActiveRef.current && groupAuthorityTopologyChanged)
      ) {
        advanceDocumentSessionAuthorityRevision();
      }
    },
    [
      advanceDocumentSessionAuthorityRevision,
      documentsCommitScheduler,
      invalidateChangedGroupSelections,
      invalidateReplacedDocumentSelections,
      liveDocumentTabSnapshot,
      synchronizeActiveGroupRefs,
    ],
  );

  const documentTabSession = useMemo<DocumentTabSessionPort>(
    () => ({
      activate: (path) => {
        commitDocumentTabs(activateDocumentTabSessionPath(liveDocumentTabSnapshot(), path));
      },
      commitImageOpen: (image) => {
        const transition = commitImageTabOpen(liveDocumentTabSnapshot(), image);
        commitDocumentTabs(transition.snapshot);
        return transition.result;
      },
      commitTextOpen: (input) => {
        const transition = commitTextDocumentOpen(liveDocumentTabSnapshot(), input);
        commitDocumentTabs(transition.snapshot);
        return transition.result;
      },
      getActivePath: () => {
        const groups = editorGroupsRef.current;
        return groups.groups[groups.activeGroupId]?.activePath ?? null;
      },
      getDocument: (path) => documentsRef.current[path] ?? null,
      getTabDisplayName: (path) =>
        documentsRef.current[path]?.name ?? imageTabsRef.current[path]?.name ?? null,
      openReadOnlyDocument: (document, pin) => {
        const nextDocument = {
          ...document,
          readOnly: true,
          savedContent: document.savedContent ?? document.content,
        };
        const transition = openReadOnlyDocumentInSession(
          liveDocumentTabSnapshot(),
          nextDocument,
          pin,
        );
        commitDocumentTabs(transition.snapshot);
        return transition.result;
      },
      openExistingDocument: (input) => {
        const transition = openExistingDocumentInSession(liveDocumentTabSnapshot(), input);

        if (!transition.result) {
          return null;
        }

        commitDocumentTabs(transition.snapshot);
        return transition.result;
      },
      pin: (path) => {
        commitDocumentTabs(pinDocumentTabSessionPath(liveDocumentTabSnapshot(), path));
      },
      refreshCleanDocument: (path, content) => {
        const transition = refreshCleanDocumentInSession(liveDocumentTabSnapshot(), path, content);

        if (!transition.document) {
          return null;
        }

        commitDocumentTabs(transition.snapshot);
        return transition.document;
      },
      removeDocument: (path) => {
        const transition = removeDocumentFromSession(liveDocumentTabSnapshot(), path);
        commitDocumentTabs(transition.snapshot);
        return transition.result;
      },
      snapshot: snapshotDocumentTabs,
    }),
    [commitDocumentTabs, liveDocumentTabSnapshot, snapshotDocumentTabs],
  );

  const snapshotEditorSurface = useCallback((rootPath: string) => {
    const current = editorGroupsRef.current;
    const group = current.groups[current.activeGroupId] ?? createEditorGroup();

    return scopeEditorSurfaceSnapshot(
      rootPath,
      buildEditorSurfaceSnapshot({
        activePath: group.activePath,
        documents: documentsRef.current,
        editorGroups: current,
        imageTabs: imageTabsRef.current,
        markdownPreviewTabs: markdownPreviewTabsRef.current,
        openPaths: group.openPaths,
        previewPath: group.previewPath,
      }),
    );
  }, []);

  const restoreEditorSurface = useCallback(
    (rootPath: string, snapshot: EditorSurfaceSnapshot) => {
      const restored = selectEditorSurfaceRestore(scopeEditorSurfaceSnapshot(rootPath, snapshot));
      const previousAuthorityTopology = captureDocumentAuthorityTopology(
        documentAuthorityRef.current!,
        documentsRef.current,
      );
      setDocuments(restored.documents);
      setImageTabs(restored.imageTabs);
      setMarkdownPreviewTabs(restored.markdownPreviewTabs);
      updateEditorGroups(() => restored.editorGroups);
      const reconciled = documentAuthorityRef.current!.reconcile(restored.documents);
      if (reconciled.status === "applied") {
        if (
          documentSessionAuthorityActiveRef.current &&
          !documentAuthorityTopologiesEqual(
            previousAuthorityTopology,
            captureDocumentAuthorityTopology(documentAuthorityRef.current!, restored.documents),
          )
        ) {
          advanceDocumentSessionAuthorityRevision();
        }
      } else if (documentSessionAuthorityActiveRef.current) {
        documentSessionAuthorityActiveRef.current = false;
        advanceDocumentSessionAuthorityRevision();
      }
      invalidateReplacedDocumentSelections();
    },
    [
      invalidateReplacedDocumentSelections,
      advanceDocumentSessionAuthorityRevision,
      setDocuments,
      setImageTabs,
      setMarkdownPreviewTabs,
      updateEditorGroups,
    ],
  );

  return {
    activateDocumentSessionAuthority,
    attachEditorGroupLiveDocument,
    deactivateDocumentSessionAuthority,
    activeDocument,
    activeDocumentRef,
    activeGroupId,
    activeImage,
    activeMarkdownPreview,
    activePath,
    documents,
    documentsRef,
    documentSessionAuthorityRevision,
    documentTabSession,
    editorGroups,
    editorGroupsRef,
    imageTabs,
    imageTabsRef,
    markdownPreviewTabs,
    markdownPreviewTabsRef,
    nextEditorGroupIdRef,
    openPaths,
    openPathsRef,
    previewPath,
    previewPathRef,
    reconcileDocumentSessionTopology,
    reportChangedDocuments,
    isDocumentSessionLifecycleAuthorityCurrent,
    isEditorGroupDocumentSessionAuthorityCurrent,
    resolveActiveDocumentSessionAuthority,
    resolveDocumentSessionLifecycleAuthority,
    resolveDocumentSessionDirtyProjection,
    resolveEditorGroupDocumentSessionAuthority,
    resetEditorSurfaceState,
    restoreEditorSurface,
    setActivePath,
    setDocuments,
    setImageTabs,
    setMarkdownPreviewTabs,
    setOpenPaths,
    setPreviewPath,
    snapshotEditorSurface,
    subscribeChangedDocuments,
    updateDocumentContent,
    updateEditorGroups,
  };
}

function scopeEditorSurfaceSnapshot(
  rootPath: string,
  snapshot: EditorSurfaceSnapshot,
): EditorSurfaceSnapshot {
  const documents = filterPathRecord(snapshot.documents, (path) =>
    isPersistableWorkspacePath(rootPath, path),
  );
  const imageTabs = filterPathRecord(snapshot.imageTabs, (path) =>
    isPersistableWorkspacePath(rootPath, path),
  );
  const markdownPreviewTabs = filterPathRecord(
    snapshot.markdownPreviewTabs ?? {},
    (_path, preview) => isPersistableWorkspacePath(rootPath, preview.sourcePath),
  );
  const availablePaths = new Set([
    ...Object.keys(documents),
    ...Object.keys(imageTabs),
    ...Object.keys(markdownPreviewTabs),
  ]);
  const snapshotEditorGroups =
    snapshot.editorGroups ??
    createInitialEditorGroupsState("editor-main", {
      activePath: snapshot.activePath,
      openPaths: snapshot.openPaths,
      previewPath: snapshot.previewPath,
    });
  const editorGroups = scopeEditorGroupsToAvailablePaths(snapshotEditorGroups, availablePaths);
  const activeGroup = editorGroups.groups[editorGroups.activeGroupId] ?? createEditorGroup();

  return {
    activePath: activeGroup.activePath,
    documents,
    editorGroups,
    imageTabs,
    markdownPreviewTabs,
    openPaths: activeGroup.openPaths,
    previewPath: activeGroup.previewPath,
  };
}

function scopeEditorGroupsToAvailablePaths(
  editorGroups: EditorGroupsState,
  availablePaths: ReadonlySet<string>,
): EditorGroupsState {
  const groups = Object.fromEntries(
    Object.entries(editorGroups.groups).map(([groupId, group]) => {
      const visiblePaths = editorGroupVisiblePaths(group).filter((path) =>
        availablePaths.has(path),
      );
      const previewPath =
        group.previewPath && availablePaths.has(group.previewPath) ? group.previewPath : null;

      return [
        groupId,
        {
          activePath: restoredActivePath(group.activePath, visiblePaths),
          openPaths: visiblePaths.filter((path) => path !== previewPath),
          previewPath,
        },
      ];
    }),
  );

  return { ...editorGroups, groups };
}

function filterPathRecord<Value>(
  record: Record<string, Value>,
  include: (path: string, value: Value) => boolean,
): Record<string, Value> {
  return Object.fromEntries(Object.entries(record).filter(([path, value]) => include(path, value)));
}

function isPersistableWorkspacePath(rootPath: string, path: string): boolean {
  return isPersistableEditorDocumentPath(path) && isSessionPathInWorkspace(rootPath, path);
}

function resolveStateUpdate<Value>(current: Value, update: SetStateAction<Value>): Value {
  if (typeof update === "function") {
    return (update as (value: Value) => Value)(current);
  }

  return update;
}

function createDocumentSessionAuthorityRevision(
  sequence: number,
  ownerDirtyCountProjection: EditorOwnerDirtyCountProjection | null,
): DocumentSessionAuthorityRevision {
  return Object.freeze({
    incarnation: Object.freeze({}),
    ownerDirtyCountProjection,
    sequence,
  });
}

function captureDocumentAuthorityTopology(
  authority: EditorSessionDocumentAuthoritySidecar,
  documents: Readonly<Documents>,
): ReadonlyMap<string, object> {
  const topology = new Map<string, object>();
  for (const path of Object.keys(documents)) {
    const lifecycle = authority.resolveLifecycle(path);
    if (lifecycle) {
      topology.set(path, lifecycle.identity);
    }
  }
  return topology;
}

function documentAuthorityTopologiesEqual(
  current: ReadonlyMap<string, object>,
  next: ReadonlyMap<string, object>,
): boolean {
  if (current.size !== next.size) {
    return false;
  }
  for (const [path, lease] of current) {
    if (next.get(path) !== lease) {
      return false;
    }
  }
  return true;
}

function editorGroupAuthorityTopologiesEqual(
  current: EditorGroupsState,
  next: EditorGroupsState,
): boolean {
  if (current === next || current.groups === next.groups) {
    return true;
  }
  let currentSelectionCount = 0;
  for (const [groupId, group] of Object.entries(current.groups)) {
    if (!group.activePath) {
      continue;
    }
    currentSelectionCount += 1;
    if (next.groups[groupId]?.activePath !== group.activePath) {
      return false;
    }
  }
  let nextSelectionCount = 0;
  for (const group of Object.values(next.groups)) {
    if (group.activePath) {
      nextSelectionCount += 1;
    }
  }
  return currentSelectionCount === nextSelectionCount;
}

function detachDocumentTabSnapshot(
  snapshot: DocumentTabSessionSnapshot,
): DocumentTabSessionSnapshot {
  const documents = Object.fromEntries(
    Object.entries(snapshot.documents).map(([path, document]) => [
      path,
      {
        ...document,
        revision: document.revision ? { ...document.revision } : document.revision,
      },
    ]),
  );
  const imageTabs = Object.fromEntries(
    Object.entries(snapshot.imageTabs).map(([path, image]) => [path, { ...image }]),
  );
  const editorGroups = detachEditorGroups(snapshot.editorGroups);

  return synchronizeSnapshotView({ documents, editorGroups, imageTabs });
}

function detachEditorGroups(editorGroups: EditorGroupsState): EditorGroupsState {
  return {
    activeGroupId: editorGroups.activeGroupId,
    groups: Object.fromEntries(
      Object.entries(editorGroups.groups).map(([groupId, group]) => [
        groupId,
        { ...group, openPaths: [...group.openPaths] },
      ]),
    ),
    layout: detachEditorLayout(editorGroups.layout),
  };
}

function detachEditorLayout(layout: EditorLayout): EditorLayout {
  if (layout.kind === "group") {
    return { ...layout };
  }

  return {
    ...layout,
    children: [detachEditorLayout(layout.children[0]), detachEditorLayout(layout.children[1])],
    sizes: [...layout.sizes],
  };
}

function documentTabSnapshotsEqual(
  current: DocumentTabSessionSnapshot,
  next: DocumentTabSessionSnapshot,
): boolean {
  return (
    shallowRecordEqual(current.documents, next.documents) &&
    shallowRecordEqual(current.imageTabs, next.imageTabs) &&
    editorGroupsEqual(current.editorGroups, next.editorGroups)
  );
}

function shallowRecordEqual<Value>(
  current: Readonly<Record<string, Value>>,
  next: Readonly<Record<string, Value>>,
): boolean {
  if (current === next) {
    return true;
  }

  const currentKeys = Object.keys(current);
  const nextKeys = Object.keys(next);

  return (
    currentKeys.length === nextKeys.length && currentKeys.every((key) => current[key] === next[key])
  );
}

function documentPathTopologyEqual(
  current: Readonly<Documents>,
  next: Readonly<Documents>,
): boolean {
  const currentPaths = Object.keys(current);
  const nextPaths = Object.keys(next);
  return (
    currentPaths.length === nextPaths.length &&
    currentPaths.every((path) => Object.prototype.hasOwnProperty.call(next, path))
  );
}

function editorGroupsEqual(current: EditorGroupsState, next: EditorGroupsState): boolean {
  if (current === next) {
    return true;
  }

  if (current.activeGroupId !== next.activeGroupId || current.layout !== next.layout) {
    return false;
  }

  const currentGroupIds = Object.keys(current.groups);
  const nextGroupIds = Object.keys(next.groups);

  return (
    currentGroupIds.length === nextGroupIds.length &&
    currentGroupIds.every((groupId) =>
      editorGroupEqual(current.groups[groupId], next.groups[groupId]),
    )
  );
}

function editorGroupEqual(
  current: EditorGroupsState["groups"][string] | undefined,
  next: EditorGroupsState["groups"][string] | undefined,
): boolean {
  if (current === next) {
    return true;
  }

  if (
    !current ||
    !next ||
    current.activePath !== next.activePath ||
    current.previewPath !== next.previewPath ||
    current.openPaths.length !== next.openPaths.length
  ) {
    return false;
  }

  return current.openPaths.every((path, index) => path === next.openPaths[index]);
}
