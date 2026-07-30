import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type MutableRefObject,
  type ReactNode,
} from "react";
import type * as Monaco from "monaco-editor";
import type { EditorDocument } from "../domain/workspace";
import type { DebugHoverEvaluationPort } from "../application/useDebugHoverEvaluation";
import type { EditorGroupFocusRunner } from "../application/editorGroupFocusPort";
import type { LiveDocumentRuntime } from "../application/liveDocumentRuntime";
import type {
  AttachEditorGroupLiveDocument,
  EditorGroupLiveDocumentAttachment,
  EditorGroupLiveDocumentSource,
} from "../application/editorSessionDocumentAuthority";
import {
  editorGroupDocumentSessionWorkspaceMatches,
  registeredDocumentSaveIdentityForEditorGroupAuthority,
} from "../application/editorSessionDocumentAuthority";
import type { EditorGroupDocumentSessionAuthority } from "../application/useEditorSessionState";
import {
  createEditorJavaScriptTypeScriptIncrementalSyncAttachmentOwner,
  currentEditorJavaScriptTypeScriptIncrementalSyncSemanticMode,
  disposeEditorJavaScriptTypeScriptIncrementalSyncAttachments,
  observeEditorJavaScriptTypeScriptIncrementalSyncAttachment,
  reconcileEditorJavaScriptTypeScriptIncrementalSyncAttachments,
  type EditorJavaScriptTypeScriptIncrementalSyncFacade,
} from "../application/editorJavaScriptTypeScriptIncrementalSyncFacade";
import {
  AUTHORITATIVE_EDITOR_LIVE_EDIT,
  LEGACY_REQUIRED_EDITOR_LIVE_EDIT,
  editorLiveEditIsAuthoritative,
  type EditorLiveEditArbitrationReceipt,
} from "../application/editorLiveEditArbitration";
import {
  createEditorActiveLiveDocumentBinding,
  retireEditorLiveDocumentBindingOwner,
  type EditorActiveLiveDocumentBinding,
} from "../application/editorActiveLiveDocumentBinding";
import {
  createEditorActiveLiveDocumentSaveBinding,
  type EditorActiveLiveDocumentSaveBinding,
} from "../application/editorActiveLiveDocumentSaveCoordinator";
import { workspaceRootKeysEqual } from "../domain/workspaceRootKey";
import {
  disposeWorkspaceModels,
  registerWorkspaceIdentityDescriptor,
} from "./phpMonacoDocumentContext";
import {
  createEditorRuntimeMarkerReconciler,
  disposeUnretainedEditorRuntimeModels,
  type EditorRuntimeMarkerReconciler,
} from "./editorRuntimeModels";
import { monacoModelRegistry, type MonacoRuntimeRetentionPublisher } from "./monacoModelRegistry";
import {
  releaseEditorRuntimeWorkspace,
  retainEditorRuntimeWorkspace,
} from "./editorRuntimeWorkspaceLease";
import {
  useEditorSurfaceLanguageProviderRegistration,
  type EditorSurfaceLanguageProviderRegistrationRefs,
} from "./useEditorSurfaceLanguageProviderRegistration";
import {
  registerJavaScriptTypeScriptLanguageServerMonacoProviders,
  type JavaScriptTypeScriptLanguageServerProviderContext,
} from "./javascriptTypescriptLanguageServerMonacoProviders";
import { configureTypescriptJavascriptDefaultsOnce } from "./typescriptJavascriptDefaults";
import { registerDebugHoverMonacoProviders } from "./debugHoverMonacoProvider";
import {
  EditorModelContentSyncCoordinator,
  type EditorModelLiveRevision,
} from "./editorModelContentSyncCoordinator";
import { EditorLiveDocumentBindingCoordinator } from "./editorLiveDocumentBindingCoordinator";
import {
  ownsGuardedLegacyProjection,
  publishGuardedLegacyProjection,
  type GuardedLegacyProjection,
} from "./editorGuardedLegacyProjection";
import {
  LocalPhpValidationCoordinator,
  type CoordinatedLocalPhpValidation,
  type LocalPhpValidationComputation,
  type LocalPhpValidationRequest,
} from "./localPhpValidationCoordinator";
import { LocalPhpMarkerWriter } from "./localPhpMarkerWriter";
import {
  PhpDocumentSymbolCoordinator,
  type PhpDocumentSymbolRequest,
} from "../application/phpDocumentSymbolCoordinator";
import type { LanguageServerDocumentSymbol } from "../domain/languageServerFeatures";
import {
  EditorRuntimeContext,
  type EditorRuntimeContextValue,
  type EditorRuntimeSurfaceRegistration,
  type EditorRuntimeSurfaceRouting,
  type LocalPhpValidationSnapshot,
} from "./editorRuntimeContext";

export function EditorRuntimeHost({
  activeGroupId = null,
  attachEditorGroupLiveDocument,
  children,
  debugHover,
  documentSessionAuthorityRevision,
  isEditorGroupDocumentSessionAuthorityCurrent,
  javaScriptTypeScriptIncrementalSync,
  liveDocumentRuntime,
  onActiveLiveDocumentBindingChange,
  onActiveLiveDocumentSaveBindingChange,
  onGroupFocusRunnerChange,
  resolveEditorGroupDocumentSessionAuthority,
}: {
  activeGroupId?: string | null;
  attachEditorGroupLiveDocument?: AttachEditorGroupLiveDocument | null;
  children: ReactNode;
  debugHover?: DebugHoverEvaluationPort | null;
  documentSessionAuthorityRevision?: unknown;
  isEditorGroupDocumentSessionAuthorityCurrent?: (
    authority: EditorGroupDocumentSessionAuthority,
  ) => boolean;
  javaScriptTypeScriptIncrementalSync?: EditorJavaScriptTypeScriptIncrementalSyncFacade | null;
  liveDocumentRuntime?: LiveDocumentRuntime | null;
  onActiveLiveDocumentBindingChange?: (binding: EditorActiveLiveDocumentBinding | null) => void;
  onActiveLiveDocumentSaveBindingChange?: (
    binding: EditorActiveLiveDocumentSaveBinding | null,
  ) => void;
  onGroupFocusRunnerChange?: (runner: EditorGroupFocusRunner | null) => void;
  resolveEditorGroupDocumentSessionAuthority?: (
    groupId: string,
  ) => EditorGroupDocumentSessionAuthority | null;
}) {
  const registrationsRef = useRef(new Map<string, EditorRuntimeSurfaceRegistration>());
  const acceptedLiveProjectionRef = useRef(
    new Map<
      string,
      { readonly document: object; readonly handleAuthority: object; readonly model: object }
    >(),
  );
  const guardedLegacyProjectionRef = useRef(new Map<string, GuardedLegacyProjection>());
  const [revision, setRevision] = useState(0);
  const admittedWorkspaceRootRef = useRef<string | null>(null);
  const focusedGroupRef = useRef<string | null>(null);
  const activeRegistrationRef = useRef<EditorRuntimeSurfaceRegistration | null>(null);
  const activeJavaScriptTypeScriptOwnerEpochRef = useRef(0);
  const activeJavaScriptTypeScriptOwnerIdentityRef = useRef<object | null>(null);
  const javaScriptTypeScriptOwnerIdentityByRegistrationRef = useRef(new Map<string, object>());
  const activeJavaScriptTypeScriptOwnerSnapshotRef =
    useRef<JavaScriptTypeScriptActiveOwnerSnapshot | null>(null);
  const runtimeRetentionPublisherRef = useRef<{
    monacoApi: typeof Monaco;
    publisher: MonacoRuntimeRetentionPublisher;
  } | null>(null);
  const runtimeWorkspaceRef = useRef<{
    monacoApi: typeof Monaco;
    root: string;
  } | null>(null);
  const markerReconcilerRef = useRef<EditorRuntimeMarkerReconciler | null>(null);
  const disposedModelsRef = useRef<WeakSet<Monaco.editor.ITextModel>>(new WeakSet());
  const lifecycleGenerationRef = useRef(0);
  const focusRequestGenerationRef = useRef(0);
  const pendingFocusFrameRef = useRef<number | null>(null);
  const workspaceLeaseOwnerRef = useRef(Symbol("editor-runtime-host"));
  const bindingModelListenersRef = useRef(
    new Map<Monaco.editor.IStandaloneCodeEditor, Monaco.IDisposable>(),
  );
  const liveDocumentAttachmentsRef = useRef<EditorGroupLiveDocumentAttachmentCoordinator | null>(
    null,
  );
  if (!liveDocumentAttachmentsRef.current) {
    liveDocumentAttachmentsRef.current = new EditorGroupLiveDocumentAttachmentCoordinator();
  }
  const liveDocumentAttachments = liveDocumentAttachmentsRef.current;
  const incrementalSyncAttachmentsRef = useRef(
    createEditorJavaScriptTypeScriptIncrementalSyncAttachmentOwner(),
  );
  const incrementalSyncAttachments = incrementalSyncAttachmentsRef.current;
  const contentSyncCoordinatorRef = useRef<EditorModelContentSyncCoordinator | null>(null);
  if (!contentSyncCoordinatorRef.current) {
    contentSyncCoordinatorRef.current = new EditorModelContentSyncCoordinator();
  }
  const liveBindingCoordinator = useMemo(
    () =>
      liveDocumentRuntime ? new EditorLiveDocumentBindingCoordinator(liveDocumentRuntime) : null,
    [liveDocumentRuntime],
  );
  const activeGroupIdRef = useRef(activeGroupId);
  const onActiveLiveDocumentBindingChangeRef = useRef(onActiveLiveDocumentBindingChange);
  const onActiveLiveDocumentSaveBindingChangeRef = useRef(onActiveLiveDocumentSaveBindingChange);
  const publishedActiveBindingRef = useRef<EditorActiveLiveDocumentBinding | null>(null);
  const publishedActiveSaveBindingRef = useRef<EditorActiveLiveDocumentSaveBinding | null>(null);
  const publishedActiveSaveAttachmentRef = useRef<EditorGroupLiveDocumentAttachment | null>(null);
  const publishedActiveSaveIdentityRef = useRef<object | null>(null);
  const publishedActiveHandleRef = useRef<object | null>(null);
  const publishedBindingCoordinatorRef = useRef<EditorLiveDocumentBindingCoordinator | null>(null);
  useLayoutEffect(() => {
    activeGroupIdRef.current = activeGroupId;
    onActiveLiveDocumentBindingChangeRef.current = onActiveLiveDocumentBindingChange;
    onActiveLiveDocumentSaveBindingChangeRef.current = onActiveLiveDocumentSaveBindingChange;
  }, [activeGroupId, onActiveLiveDocumentBindingChange, onActiveLiveDocumentSaveBindingChange]);
  const localPhpValidationCoordinatorRef = useRef(
    new LocalPhpValidationCoordinator<unknown, unknown>(),
  );
  const localPhpMarkerWriterRef = useRef(new LocalPhpMarkerWriter());
  const phpDocumentSymbolCoordinatorRef = useRef(new PhpDocumentSymbolCoordinator());

  const refreshActiveJavaScriptTypeScriptOwnerEpoch = useCallback(() => {
    const activeEntry = activeRuntimeRegistrationEntry(
      registrationsRef.current,
      focusedGroupRef.current,
      admittedWorkspaceRootRef.current,
    );
    const nextSnapshot = javaScriptTypeScriptActiveOwnerSnapshot(activeEntry);
    activeJavaScriptTypeScriptOwnerIdentityRef.current = activeEntry
      ? (javaScriptTypeScriptOwnerIdentityByRegistrationRef.current.get(activeEntry[0]) ?? null)
      : null;

    if (
      !javaScriptTypeScriptActiveOwnerSnapshotsEqual(
        activeJavaScriptTypeScriptOwnerSnapshotRef.current,
        nextSnapshot,
      )
    ) {
      activeJavaScriptTypeScriptOwnerSnapshotRef.current = nextSnapshot;
      activeJavaScriptTypeScriptOwnerEpochRef.current += 1;
    }

    activeRegistrationRef.current = activeEntry?.[1] ?? null;
  }, []);

  const getActiveJavaScriptTypeScriptOwnerEpoch = useCallback(
    () => activeJavaScriptTypeScriptOwnerEpochRef.current,
    [],
  );
  const getActiveJavaScriptTypeScriptOwnerIdentity = useCallback(
    () => activeJavaScriptTypeScriptOwnerIdentityRef.current,
    [],
  );

  const resolveExactLiveModelContent = useCallback(
    (groupId: string, path: string, model: Monaco.editor.ITextModel) => {
      try {
        const entry = [...registrationsRef.current].find(
          ([, registration]) => registration.groupId === groupId,
        );
        if (!entry) return null;
        const [id, registration] = entry;
        const document = registration.routing.activeDocumentRef.current;
        const authority = resolveEditorGroupDocumentSessionAuthority?.(groupId) ?? null;
        const handle = liveBindingCoordinator?.currentHandle(id) ?? null;
        const revision = handle?.currentRevision() ?? null;
        const registry = registration.monacoApi
          ? monacoModelRegistry(registration.monacoApi)
          : null;
        return document &&
          document.path === path &&
          registration.activePath === path &&
          registration.editor?.getModel() === model &&
          registration.workspaceRoot !== null &&
          authority !== null &&
          authority.groupId === groupId &&
          authority.path === path &&
          isEditorGroupDocumentSessionAuthorityCurrent?.(authority) === true &&
          handle !== null &&
          revision !== null &&
          registry?.modelForPath(registration.workspaceRoot, path) === model &&
          registry.modelAuthority(model) === handle.modelAuthority &&
          model.getVersionId() === revision.modelVersionId &&
          model.getAlternativeVersionId() === revision.alternativeVersionId &&
          model.getValueLength() === revision.utf16Length &&
          liveDocumentAttachments.current(id) !== null
          ? { document, handleAuthority: handle.handleAuthority, id, model }
          : null;
      } catch {
        return null;
      }
    },
    [
      isEditorGroupDocumentSessionAuthorityCurrent,
      liveBindingCoordinator,
      liveDocumentAttachments,
      resolveEditorGroupDocumentSessionAuthority,
    ],
  );
  const ownsExactLiveModelContent = useCallback(
    (groupId: string, path: string, model: Monaco.editor.ITextModel): boolean => {
      const exact = resolveExactLiveModelContent(groupId, path, model);
      if (exact) {
        const accepted = acceptedLiveProjectionRef.current.get(exact.id);
        return Boolean(
          accepted &&
          accepted.document === exact.document &&
          accepted.handleAuthority === exact.handleAuthority &&
          accepted.model === exact.model,
        );
      }
      return ownsGuardedLegacyProjection(
        guardedLegacyProjectionRef.current,
        registrationsRef.current,
        liveBindingCoordinator,
        resolveEditorGroupDocumentSessionAuthority,
        isEditorGroupDocumentSessionAuthorityCurrent,
        groupId,
        path,
        model,
      );
    },
    [
      isEditorGroupDocumentSessionAuthorityCurrent,
      liveBindingCoordinator,
      resolveEditorGroupDocumentSessionAuthority,
      resolveExactLiveModelContent,
    ],
  );
  const acknowledgeExactLiveModelContent = useCallback(
    (groupId: string, path: string, model: Monaco.editor.ITextModel): boolean => {
      const exact = resolveExactLiveModelContent(groupId, path, model);
      if (!exact) return false;
      acceptedLiveProjectionRef.current.set(exact.id, exact);
      return true;
    },
    [resolveExactLiveModelContent],
  );

  const coordinatePhpDocumentSymbols = useCallback(
    (request: PhpDocumentSymbolRequest, load: () => Promise<LanguageServerDocumentSymbol[]>) =>
      phpDocumentSymbolCoordinatorRef.current.coordinate(request, load),
    [],
  );

  const coordinateLocalPhpValidation = useCallback(
    <TSyntax, TInspection>(
      request: LocalPhpValidationRequest,
      compute: () => LocalPhpValidationComputation<
        LocalPhpValidationSnapshot<TSyntax, TInspection>,
        LocalPhpValidationSnapshot<TSyntax, TInspection>
      >,
    ) =>
      localPhpValidationCoordinatorRef.current.coordinate(
        request,
        compute as () => LocalPhpValidationComputation<unknown, unknown>,
      ) as CoordinatedLocalPhpValidation<
        LocalPhpValidationSnapshot<TSyntax, TInspection>,
        LocalPhpValidationSnapshot<TSyntax, TInspection>
      >,
    [],
  );

  const writeLocalPhpMarkers = useCallback(
    (
      consumerId: string,
      monacoApi: typeof Monaco,
      model: Monaco.editor.ITextModel,
      markers: readonly Monaco.editor.IMarkerData[],
    ) => {
      const registration = registrationsRef.current.get(consumerId);
      if (!registration || registration.monacoApi !== monacoApi) {
        return;
      }

      localPhpMarkerWriterRef.current.write(monacoApi, model, markers);
    },
    [],
  );

  const updateSurface = useCallback(
    (id: string, registration: EditorRuntimeSurfaceRegistration) => {
      const current = registrationsRef.current.get(id);
      if (
        !current ||
        !canAdmitRegistration(
          id,
          registration,
          registrationsRef.current,
          admittedWorkspaceRootRef.current,
        )
      ) {
        return;
      }

      // Routing callbacks and refs are mutable by design. Replace them without
      // waking the host unless a model/provider/marker ownership input changed.
      registrationsRef.current.set(id, registration);
      admittedWorkspaceRootRef.current = admittedWorkspaceRoot(registrationsRef.current);
      refreshActiveJavaScriptTypeScriptOwnerEpoch();
      if (registrationsStructurallyEqual(current, registration)) {
        return;
      }

      setRevision((current) => current + 1);
    },
    [refreshActiveJavaScriptTypeScriptOwnerEpoch],
  );

  const registerSurface = useCallback(
    (id: string, registration: EditorRuntimeSurfaceRegistration) => {
      // The first concrete root owns this host while any accepted surface is
      // mounted. A foreign split is ignored, so it can never become active and
      // dispose or mark models belonging to either workspace.
      if (
        !canAdmitRegistration(
          id,
          registration,
          registrationsRef.current,
          admittedWorkspaceRootRef.current,
        )
      ) {
        return () => undefined;
      }

      registrationsRef.current.set(id, registration);
      javaScriptTypeScriptOwnerIdentityByRegistrationRef.current.set(id, Object.freeze({}));
      admittedWorkspaceRootRef.current = admittedWorkspaceRoot(registrationsRef.current);
      refreshActiveJavaScriptTypeScriptOwnerEpoch();
      setRevision((current) => current + 1);

      return () => {
        const removedRegistration = registrationsRef.current.get(id);
        const removedOwnedRuntime = Boolean(
          removedRegistration &&
          registrationOwnsRuntime(removedRegistration, admittedWorkspaceRootRef.current),
        );
        const removed = registrationsRef.current.delete(id);
        if (!removed) {
          return;
        }
        javaScriptTypeScriptOwnerIdentityByRegistrationRef.current.delete(id);
        acceptedLiveProjectionRef.current.delete(id);
        guardedLegacyProjectionRef.current.delete(id);
        localPhpValidationCoordinatorRef.current.releaseConsumer(id);

        admittedWorkspaceRootRef.current = admittedWorkspaceRoot(registrationsRef.current);
        refreshActiveJavaScriptTypeScriptOwnerEpoch();
        if (removedOwnedRuntime || removedRegistration?.monacoApi) {
          setRevision((current) => current + 1);
        }
      };
    },
    [refreshActiveJavaScriptTypeScriptOwnerEpoch],
  );

  const focusGroup = useCallback(
    (groupId: string) => {
      const groupIsRegistered = [...registrationsRef.current.values()].some(
        (registration) =>
          registration.groupId === groupId &&
          registrationOwnsRuntime(registration, admittedWorkspaceRootRef.current),
      );
      if (!groupIsRegistered || focusedGroupRef.current === groupId) {
        return;
      }

      focusedGroupRef.current = groupId;
      refreshActiveJavaScriptTypeScriptOwnerEpoch();
      setRevision((current) => current + 1);
    },
    [refreshActiveJavaScriptTypeScriptOwnerEpoch],
  );

  const focusRegisteredEditorGroup = useCallback<EditorGroupFocusRunner>(
    (groupId) => {
      const target = registeredEditorGroup(
        registrationsRef.current,
        groupId,
        admittedWorkspaceRootRef.current,
      );
      if (!target) {
        return false;
      }

      focusGroup(groupId);
      if (pendingFocusFrameRef.current !== null) {
        cancelAnimationFrame(pendingFocusFrameRef.current);
      }
      const generation = ++focusRequestGenerationRef.current;
      const requestedMonacoApi = target.monacoApi;
      const requestedWorkspaceRoot = target.workspaceRoot;
      pendingFocusFrameRef.current = requestAnimationFrame(() => {
        if (focusRequestGenerationRef.current !== generation) {
          return;
        }
        pendingFocusFrameRef.current = null;
        const current = registeredEditorGroup(
          registrationsRef.current,
          groupId,
          admittedWorkspaceRootRef.current,
        );
        if (
          !current ||
          current.monacoApi !== requestedMonacoApi ||
          !workspaceRootKeysEqual(current.workspaceRoot, requestedWorkspaceRoot)
        ) {
          return;
        }
        current.editor?.focus();
      });
      return true;
    },
    [focusGroup],
  );

  useEffect(
    () => () => {
      focusRequestGenerationRef.current += 1;
      if (pendingFocusFrameRef.current === null) {
        return;
      }
      cancelAnimationFrame(pendingFocusFrameRef.current);
      pendingFocusFrameRef.current = null;
    },
    [],
  );

  useEffect(() => {
    onGroupFocusRunnerChange?.(focusRegisteredEditorGroup);
    return () => onGroupFocusRunnerChange?.(null);
  }, [focusRegisteredEditorGroup, onGroupFocusRunnerChange]);

  const registrations = [...registrationsRef.current.values()];
  const activeRegistration =
    activeRuntimeRegistrationEntry(
      registrationsRef.current,
      focusedGroupRef.current,
      admittedWorkspaceRootRef.current,
    )?.[1] ?? null;
  const configurationRegistration =
    activeRegistration ?? registrations.find(({ monacoApi }) => monacoApi) ?? null;
  activeRegistrationRef.current = activeRegistration;
  useEffect(() => {
    const registrationEntries = [...registrationsRef.current.entries()];
    const owningRegistrationEntries = registrationEntries.filter(([, registration]) =>
      registrationOwnsRuntime(registration, admittedWorkspaceRootRef.current),
    );
    const contentSyncRegistrationEntries = admittedWorkspaceRootRef.current
      ? owningRegistrationEntries
      : registrationEntries;
    const bindingAuthorities = new Map<string, EditorGroupDocumentSessionAuthority>();
    const bindingRegistrations = contentSyncRegistrationEntries.flatMap(
      ([registrationId, registration]) => {
        const sessionAuthority =
          resolveEditorGroupDocumentSessionAuthority?.(registration.groupId) ?? null;
        if (
          !liveBindingCoordinator ||
          !sessionAuthority ||
          registration.activePath !== sessionAuthority.path ||
          !registration.editor ||
          !registration.monacoApi ||
          !isEditorGroupDocumentSessionAuthorityCurrent
        ) {
          return [];
        }
        bindingAuthorities.set(registrationId, sessionAuthority);
        return [
          {
            editor: registration.editor,
            id: registrationId,
            isSessionAuthorityCurrent: isEditorGroupDocumentSessionAuthorityCurrent,
            monacoApi: registration.monacoApi,
            sessionAuthority,
            workspaceRoot: registration.workspaceRoot,
          },
        ];
      },
    );
    const retainedBindingEditors = new Set(bindingRegistrations.map(({ editor }) => editor));
    for (const [editor, listener] of bindingModelListenersRef.current) {
      if (retainedBindingEditors.has(editor)) continue;
      listener.dispose();
      bindingModelListenersRef.current.delete(editor);
    }
    for (const editor of retainedBindingEditors) {
      if (bindingModelListenersRef.current.has(editor)) continue;
      bindingModelListenersRef.current.set(
        editor,
        editor.onDidChangeModel(() => setRevision((current) => current + 1)),
      );
    }
    liveBindingCoordinator?.reconcile(bindingRegistrations);
    const liveDocumentAttachmentRegistrations = bindingRegistrations.flatMap(
      ({ id, isSessionAuthorityCurrent, sessionAuthority }) => {
        const registration = registrationsRef.current.get(id) ?? null;
        const registrationAuthority =
          javaScriptTypeScriptOwnerIdentityByRegistrationRef.current.get(id) ?? null;
        const handle = liveBindingCoordinator?.currentHandle(id) ?? null;
        const registry =
          registration?.monacoApi && registration.activePath
            ? monacoModelRegistry(registration.monacoApi)
            : null;
        const model =
          registry && registration?.activePath
            ? registry.modelForPath(registration.workspaceRoot, registration.activePath)
            : null;
        if (!registration || !registrationAuthority || !handle || !registry || !model) return [];
        try {
          const baseRevision = handle.currentRevision();
          const modelAuthority = registry.modelAuthority(model);
          if (!baseRevision || modelAuthority !== handle.modelAuthority) return [];
          const isCurrent = () => {
            const current = registrationsRef.current.get(id);
            return (
              current?.activePath === sessionAuthority.path &&
              current.editor === registration.editor &&
              javaScriptTypeScriptOwnerIdentityByRegistrationRef.current.get(id) ===
                registrationAuthority &&
              current.editor?.getModel() === model &&
              registry.modelForPath(registration.workspaceRoot, sessionAuthority.path) === model &&
              registry.modelAuthority(model) === modelAuthority &&
              isSessionAuthorityCurrent(sessionAuthority) &&
              liveBindingCoordinator?.currentHandle(id) === handle &&
              handle.currentRevision() !== null
            );
          };
          return [
            {
              baseRevision,
              id,
              incrementalSource: Object.freeze({
                alternativeVersionId: safePositiveModelValue(() => model.getAlternativeVersionId()),
                captureCurrentContent: () => {
                  if (!isCurrent()) return null;
                  const before = handle.currentRevision();
                  if (!before) return null;
                  const content = model.getValue();
                  const after = handle.currentRevision();
                  return after && isCurrent() && sameLiveModelRevision(before, after)
                    ? content
                    : null;
                },
                currentUtf16Length: () => {
                  if (!isCurrent()) return null;
                  const before = handle.currentRevision();
                  if (!before) return null;
                  const length = model.getValueLength();
                  const after = handle.currentRevision();
                  return after && isCurrent() && sameLiveModelRevision(before, after)
                    ? length
                    : null;
                },
                languageId: safeModelText(() => model.getLanguageId()),
                model,
                modelId:
                  safeModelText(() => model.uri.toString()) ||
                  registration.activePath ||
                  sessionAuthority.path,
                publishLegacyFallback: (content: string) => {
                  const current = registrationsRef.current.get(id);
                  const currentDocument = current?.routing.activeDocumentRef.current ?? null;
                  if (!current || !currentDocument) return false;
                  return publishGuardedLegacyProjection(
                    guardedLegacyProjectionRef.current,
                    id,
                    handle,
                    model,
                    isCurrent,
                    currentDocument,
                    content,
                    () =>
                      current.onModelContentChange(content, registration.activePath ?? undefined),
                  );
                },
                utf16Length: safeNonNegativeModelValue(() => model.getValueLength()),
                versionId: safePositiveModelValue(() => model.getVersionId()),
              }),
              isCurrent,
              sessionAuthority,
              source: Object.freeze({
                captureCurrentContent: () => {
                  if (
                    !isCurrent() ||
                    !sameLiveModelRevision(handle.currentRevision(), baseRevision)
                  ) {
                    return null;
                  }
                  const content = model.getValue();
                  return isCurrent() &&
                    sameLiveModelRevision(handle.currentRevision(), baseRevision)
                    ? content
                    : null;
                },
                holderIncarnation: handle.handleAuthority,
                modelIncarnation: modelAuthority,
              }),
            },
          ];
        } catch {
          return [];
        }
      },
    );
    liveDocumentAttachments.reconcile(
      attachEditorGroupLiveDocument ?? null,
      liveDocumentAttachmentRegistrations,
    );
    reconcileEditorJavaScriptTypeScriptIncrementalSyncAttachments(
      incrementalSyncAttachments,
      javaScriptTypeScriptIncrementalSync ?? null,
      liveDocumentAttachmentRegistrations.map(
        ({ id, incrementalSource, isCurrent, sessionAuthority }) => ({
          id,
          isCurrent,
          sessionAuthority,
          source: incrementalSource,
        }),
      ),
    );
    for (const { id, incrementalSource } of liveDocumentAttachmentRegistrations) {
      if (acceptedLiveProjectionRef.current.has(id)) continue;
      const document = registrationsRef.current.get(id)?.routing.activeDocumentRef.current;
      const handle = liveBindingCoordinator?.currentHandle(id);
      if (!document || !handle) continue;
      acceptedLiveProjectionRef.current.set(id, {
        document,
        handleAuthority: handle.handleAuthority,
        model: incrementalSource.model,
      });
    }

    contentSyncCoordinatorRef.current?.update(
      contentSyncRegistrationEntries.map(([registrationId, registration]) => {
        const registrationAuthority =
          javaScriptTypeScriptOwnerIdentityByRegistrationRef.current.get(registrationId) ?? null;
        const modelRegistry =
          registration.monacoApi && registration.activePath
            ? monacoModelRegistry(registration.monacoApi)
            : null;
        const boundModel =
          modelRegistry && registration.activePath
            ? modelRegistry.modelForPath(registration.workspaceRoot, registration.activePath)
            : null;
        const liveIngress = liveBindingCoordinator?.currentHandle(registrationId) ?? null;
        const sessionAuthority = bindingAuthorities.get(registrationId) ?? null;
        return {
          activePath: registration.activePath,
          boundModel,
          editor: registration.editor,
          getModel: () => {
            const model = registration.editor?.getModel() ?? null;
            if (!model || !registration.activePath) {
              return null;
            }
            if (!registration.workspaceRoot) {
              return model;
            }
            return registration.routing.resolveDocumentForModel(model)?.path ===
              registration.activePath
              ? model
              : null;
          },
          groupId: registration.groupId,
          liveIngress,
          modelBindingAuthority: boundModel
            ? (modelRegistry?.modelAuthority(boundModel) ?? null)
            : null,
          onLiveRevision: (checkpoint) => {
            const incrementalReceipt = observeEditorJavaScriptTypeScriptIncrementalSyncAttachment(
              incrementalSyncAttachments,
              registrationId,
              checkpoint.contentEvent,
            );
            const incrementalMode = currentEditorJavaScriptTypeScriptIncrementalSyncSemanticMode(
              incrementalSyncAttachments,
              registrationId,
            );
            const incrementalRetired =
              incrementalMode === "incremental" &&
              !editorLiveEditIsAuthoritative(incrementalReceipt);
            const documentReceipt = liveDocumentAttachments.observe(registrationId, checkpoint);
            const documentAccepted = editorLiveEditIsAuthoritative(documentReceipt);
            const current = registrationsRef.current.get(registrationId);
            const currentAuthority =
              javaScriptTypeScriptOwnerIdentityByRegistrationRef.current.get(registrationId) ??
              null;
            const currentHandle = liveBindingCoordinator?.currentHandle(registrationId) ?? null;
            const currentRevision = currentHandle?.currentRevision() ?? null;
            return documentAccepted &&
              !incrementalRetired &&
              current === registration &&
              currentAuthority === registrationAuthority &&
              current?.activePath === checkpoint.path &&
              current?.editor === registration.editor &&
              current?.editor?.getModel() === boundModel &&
              currentHandle === liveIngress &&
              currentHandle?.handleAuthority === checkpoint.sourceHandleAuthority &&
              currentRevision !== null &&
              sameLiveModelRevision(currentRevision, checkpoint.revision) &&
              sessionAuthority !== null &&
              isEditorGroupDocumentSessionAuthorityCurrent?.(sessionAuthority) === true
              ? AUTHORITATIVE_EDITOR_LIVE_EDIT
              : LEGACY_REQUIRED_EDITOR_LIVE_EDIT;
          },
          onChange: (content: string) => {
            const current = registrationsRef.current.get(registrationId);
            const currentAuthority =
              javaScriptTypeScriptOwnerIdentityByRegistrationRef.current.get(registrationId) ??
              null;
            if (
              !current ||
              !registrationAuthority ||
              currentAuthority !== registrationAuthority ||
              current.activePath !== registration.activePath ||
              current.editor !== registration.editor ||
              (sessionAuthority !== null &&
                (isEditorGroupDocumentSessionAuthorityCurrent?.(sessionAuthority) !== true ||
                  current.editor?.getModel() !== boundModel ||
                  (liveIngress !== null &&
                    liveBindingCoordinator?.currentHandle(registrationId) !== liveIngress)))
            ) {
              return;
            }
            if (!liveIngress || !boundModel) {
              return current.onModelContentChange(content, registration.activePath ?? undefined);
            }
            const currentDocument = current.routing.activeDocumentRef.current;
            if (!currentDocument) return false;
            return publishGuardedLegacyProjection(
              guardedLegacyProjectionRef.current,
              registrationId,
              liveIngress,
              boundModel,
              () => {
                const exact = registrationsRef.current.get(registrationId);
                return (
                  exact === registration &&
                  javaScriptTypeScriptOwnerIdentityByRegistrationRef.current.get(registrationId) ===
                    registrationAuthority &&
                  exact.editor?.getModel() === boundModel &&
                  liveBindingCoordinator?.currentHandle(registrationId) === liveIngress &&
                  sessionAuthority !== null &&
                  isEditorGroupDocumentSessionAuthorityCurrent?.(sessionAuthority) === true
                );
              },
              currentDocument,
              content,
              () => current.onModelContentChange(content, registration.activePath ?? undefined),
            );
          },
        };
      }),
      focusedGroupRef.current,
    );

    const activeEntry = contentSyncRegistrationEntries.find(
      ([, registration]) => registration.groupId === activeGroupId,
    );
    const exactActiveAuthority = activeEntry
      ? (bindingAuthorities.get(activeEntry[0]) ?? null)
      : null;
    const activeHandle =
      activeEntry && exactActiveAuthority
        ? (liveBindingCoordinator?.currentHandle(activeEntry[0]) ?? null)
        : null;
    const activeRegistrationId = activeEntry?.[0] ?? null;
    const currentPublished = publishedActiveBindingRef.current;
    const unchanged =
      currentPublished &&
      activeHandle &&
      currentPublished.groupId === activeGroupId &&
      currentPublished.path === exactActiveAuthority?.path &&
      publishedActiveHandleRef.current === activeHandle &&
      currentPublished.isCurrent();
    const nextBinding =
      unchanged ||
      !exactActiveAuthority ||
      !activeHandle ||
      !activeRegistrationId ||
      !liveBindingCoordinator
        ? unchanged
          ? currentPublished
          : null
        : createEditorActiveLiveDocumentBinding({
            handle: activeHandle,
            isCurrent: () =>
              activeGroupIdRef.current === exactActiveAuthority.groupId &&
              isEditorGroupDocumentSessionAuthorityCurrent?.(exactActiveAuthority) === true &&
              liveBindingCoordinator.currentHandle(activeRegistrationId) === activeHandle,
            liveContent: liveBindingCoordinator,
            sessionAuthority: exactActiveAuthority,
            snapshots: liveBindingCoordinator,
          });
    if (publishedActiveBindingRef.current !== nextBinding) {
      publishedActiveBindingRef.current = nextBinding;
      publishedActiveHandleRef.current = nextBinding ? activeHandle : null;
      publishedBindingCoordinatorRef.current = nextBinding ? liveBindingCoordinator : null;
      onActiveLiveDocumentBindingChangeRef.current?.(nextBinding);
    }
    const activeSaveAttachment = activeRegistrationId
      ? liveDocumentAttachments.current(activeRegistrationId)
      : null;
    const activeRegisteredSaveIdentity = exactActiveAuthority
      ? registeredDocumentSaveIdentityForEditorGroupAuthority(exactActiveAuthority)
      : null;
    if (
      Boolean(publishedActiveSaveBindingRef.current) !==
        Boolean(nextBinding && activeSaveAttachment && activeRegisteredSaveIdentity) ||
      publishedActiveSaveBindingRef.current?.path !== nextBinding?.path ||
      publishedActiveSaveBindingRef.current?.groupId !== nextBinding?.groupId ||
      publishedActiveSaveAttachmentRef.current !== activeSaveAttachment ||
      publishedActiveSaveIdentityRef.current !== activeRegisteredSaveIdentity
    ) {
      const nextSaveBinding =
        nextBinding && activeSaveAttachment && activeRegisteredSaveIdentity
          ? createEditorActiveLiveDocumentSaveBinding({
              applyContent: (content) => {
                const current = registrationsRef.current.get(activeRegistrationId!);
                const editor = current?.editor ?? null;
                const model = editor?.getModel() ?? null;
                if (
                  current !== activeEntry?.[1] ||
                  !editor ||
                  !model ||
                  liveBindingCoordinator?.currentHandle(activeRegistrationId!) !== activeHandle ||
                  !nextBinding.isCurrent()
                ) {
                  return null;
                }
                const applied = editor.executeEdits("codevo.formatOnSave", [
                  {
                    forceMoveMarkers: true,
                    range: model.getFullModelRange(),
                    text: content,
                  },
                ]);
                const revision = activeHandle!.currentRevision();
                return applied &&
                  current === registrationsRef.current.get(activeRegistrationId!) &&
                  editor.getModel() === model &&
                  model.getValue() === content &&
                  liveBindingCoordinator?.currentHandle(activeRegistrationId!) === activeHandle &&
                  nextBinding.isCurrent()
                  ? revision
                  : null;
              },
              attachment: activeSaveAttachment,
              binding: nextBinding,
              registeredIdentity: activeRegisteredSaveIdentity,
              retirementScopeKey: activeEntry![1].workspaceRoot ?? "",
              workspaceMatches: (rootPath) =>
                editorGroupDocumentSessionWorkspaceMatches(exactActiveAuthority!, rootPath),
            })
          : null;
      publishedActiveSaveBindingRef.current = nextSaveBinding;
      publishedActiveSaveAttachmentRef.current = activeSaveAttachment;
      publishedActiveSaveIdentityRef.current = activeRegisteredSaveIdentity;
      onActiveLiveDocumentSaveBindingChangeRef.current?.(nextSaveBinding);
    }
  }, [
    activeGroupId,
    attachEditorGroupLiveDocument,
    documentSessionAuthorityRevision,
    isEditorGroupDocumentSessionAuthorityCurrent,
    javaScriptTypeScriptIncrementalSync,
    incrementalSyncAttachments,
    liveBindingCoordinator,
    liveDocumentAttachments,
    resolveEditorGroupDocumentSessionAuthority,
    revision,
  ]);

  useEffect(
    () => () => {
      liveDocumentAttachments.dispose();
      disposeEditorJavaScriptTypeScriptIncrementalSyncAttachments(incrementalSyncAttachments);
    },
    [incrementalSyncAttachments, liveDocumentAttachments],
  );

  useEffect(
    () => () => {
      if (publishedBindingCoordinatorRef.current === liveBindingCoordinator) {
        publishedActiveBindingRef.current = null;
        publishedActiveHandleRef.current = null;
        publishedBindingCoordinatorRef.current = null;
        publishedActiveSaveBindingRef.current = null;
        publishedActiveSaveAttachmentRef.current = null;
        publishedActiveSaveIdentityRef.current = null;
        onActiveLiveDocumentBindingChangeRef.current?.(null);
        onActiveLiveDocumentSaveBindingChangeRef.current?.(null);
      }
      if (liveBindingCoordinator) {
        retireEditorLiveDocumentBindingOwner(liveBindingCoordinator);
      }
    },
    [liveBindingCoordinator],
  );

  const routedProviderRefs = useMemo(
    () => routedRefs(activeRegistrationRef, registrationsRef, focusedGroupRef),
    [],
  );
  useEditorSurfaceLanguageProviderRegistration({
    dependencies: activeRegistration?.providerDependencies ?? null,
    refs: routedProviderRefs,
  });
  const routedJavaScriptTypeScriptContext = useMemo(
    () =>
      new Proxy({} as JavaScriptTypeScriptLanguageServerProviderContext, {
        get(_target, property) {
          return Reflect.get(
            activeRegistrationRef.current?.routing.javaScriptTypeScriptProviderContext ?? {},
            property,
          );
        },
      }),
    [],
  );
  const javaScriptTypeScriptProviderContext =
    activeRegistration?.routing.javaScriptTypeScriptProviderContext;
  const hasJavaScriptTypeScriptProviderContext = javaScriptTypeScriptProviderContext !== undefined;
  const javaScriptTypeScriptCompleteFunctionCalls =
    javaScriptTypeScriptProviderContext?.completeFunctionCalls;
  const javaScriptTypeScriptFeaturesGateway = javaScriptTypeScriptProviderContext?.featuresGateway;
  const javaScriptTypeScriptRefreshGateway = javaScriptTypeScriptProviderContext?.refreshGateway;
  const javaScriptTypeScriptWorkspaceEditGateway =
    javaScriptTypeScriptProviderContext?.workspaceEditGateway;

  useEffect(() => {
    const monacoApi = activeRegistration?.monacoApi;
    if (!monacoApi || !hasJavaScriptTypeScriptProviderContext) {
      return;
    }

    const disposable = registerJavaScriptTypeScriptLanguageServerMonacoProviders(
      monacoApi,
      routedJavaScriptTypeScriptContext,
    );
    return () => disposable.dispose();
  }, [
    activeRegistration?.monacoApi,
    activeRegistration?.workspaceRoot,
    hasJavaScriptTypeScriptProviderContext,
    javaScriptTypeScriptCompleteFunctionCalls,
    javaScriptTypeScriptFeaturesGateway,
    javaScriptTypeScriptRefreshGateway,
    javaScriptTypeScriptWorkspaceEditGateway,
    routedJavaScriptTypeScriptContext,
  ]);

  useEffect(() => {
    const monacoApi = activeRegistration?.monacoApi;
    if (!monacoApi || !debugHover) return;
    return registerDebugHoverMonacoProviders(monacoApi, {
      debugHover,
      getAdmittedWorkspaceRoot: () => admittedWorkspaceRootRef.current,
      resolveDocumentForModel: (model) =>
        resolveRuntimeDocumentForModel(
          [...registrationsRef.current.values()].filter((registration) =>
            registrationOwnsRuntime(registration, admittedWorkspaceRootRef.current),
          ),
          model,
          focusedGroupRef.current,
        ),
    }).dispose;
  }, [activeRegistration?.monacoApi, activeRegistration?.workspaceRoot, debugHover]);

  const hasTypescriptJavascriptDefaults =
    configurationRegistration?.typescriptJavascriptDefaults !== undefined;
  const managedLanguageServerActive =
    configurationRegistration?.typescriptJavascriptDefaults.managedLanguageServerActive ?? false;
  const typescriptJavascriptValidationEnabled =
    configurationRegistration?.typescriptJavascriptDefaults.validationEnabled ?? false;
  useEffect(() => {
    const monacoApi = configurationRegistration?.monacoApi;
    if (!monacoApi || !hasTypescriptJavascriptDefaults) {
      return;
    }

    configureTypescriptJavascriptDefaultsOnce(monacoApi, {
      managedLanguageServerActive,
      validationEnabled: typescriptJavascriptValidationEnabled,
    });
  }, [
    configurationRegistration?.monacoApi,
    hasTypescriptJavascriptDefaults,
    managedLanguageServerActive,
    typescriptJavascriptValidationEnabled,
  ]);

  useEffect(() => {
    const monacoApi = activeRegistration?.monacoApi;
    if (!monacoApi) {
      runtimeRetentionPublisherRef.current = null;
      return;
    }

    const publisher = monacoModelRegistry(monacoApi).createRuntimeRetentionPublisher();
    runtimeRetentionPublisherRef.current = { monacoApi, publisher };
    return () => {
      publisher.release();
      if (runtimeRetentionPublisherRef.current?.publisher === publisher) {
        runtimeRetentionPublisherRef.current = null;
      }
    };
  }, [activeRegistration?.monacoApi]);

  useEffect(() => {
    if (!activeRegistration?.monacoApi) {
      markerReconcilerRef.current?.dispose();
      markerReconcilerRef.current = null;
      return;
    }

    const monacoApi = activeRegistration.monacoApi;
    const workspaceRoot = activeRegistration.workspaceRoot;
    if (workspaceRoot) {
      const previousWorkspace = runtimeWorkspaceRef.current;
      if (
        previousWorkspace &&
        (previousWorkspace.monacoApi !== monacoApi ||
          !workspaceRootKeysEqual(previousWorkspace.root, workspaceRoot))
      ) {
        if (
          releaseEditorRuntimeWorkspace(
            previousWorkspace.monacoApi,
            previousWorkspace.root,
            workspaceLeaseOwnerRef.current,
          )
        ) {
          const preserveWorkspaceMappings =
            previousWorkspace.monacoApi !== monacoApi &&
            workspaceRootKeysEqual(previousWorkspace.root, workspaceRoot);
          disposeWorkspaceModels(previousWorkspace.monacoApi, previousWorkspace.root, {
            preserveWorkspaceMappings,
          });
        }
        disposedModelsRef.current = new WeakSet();
      }
      retainEditorRuntimeWorkspace(monacoApi, workspaceRoot, workspaceLeaseOwnerRef.current);
      runtimeWorkspaceRef.current = { monacoApi, root: workspaceRoot };
    }

    const diagnosticsByPath = activeRegistration.diagnosticsByPath;
    const markerReconciler = markerReconcilerRef.current;
    const markerRootMatches =
      markerReconciler !== null &&
      (markerReconciler.workspaceRoot === workspaceRoot ||
        (markerReconciler.workspaceRoot !== null &&
          workspaceRoot !== null &&
          workspaceRootKeysEqual(markerReconciler.workspaceRoot, workspaceRoot)));
    if (markerReconciler?.monacoApi !== monacoApi || !markerRootMatches) {
      markerReconciler?.dispose();
      markerReconcilerRef.current = createEditorRuntimeMarkerReconciler(
        monacoApi,
        workspaceRoot,
        diagnosticsByPath,
        activeRegistration.toMarker,
      );
    } else {
      markerReconciler.reconcile(diagnosticsByPath, activeRegistration.toMarker);
    }

    const currentOwningRegistrations = [...registrationsRef.current.values()].filter(
      (registration) => registrationOwnsRuntime(registration, admittedWorkspaceRootRef.current),
    );
    disposeUnretainedEditorRuntimeModels(
      monacoApi,
      workspaceRoot,
      currentOwningRegistrations.map((registration) => ({
        activePath: registration.activePath,
        retainPaths: registration.retainPaths,
      })),
      disposedModelsRef.current,
      runtimeRetentionPublisherRef.current?.monacoApi === monacoApi
        ? runtimeRetentionPublisherRef.current.publisher
        : undefined,
    );
  }, [revision, activeRegistration]);

  useEffect(() => {
    const monacoApi = configurationRegistration?.monacoApi;
    if (!monacoApi || typeof monacoApi.editor.onDidChangeMarkers !== "function") {
      return;
    }

    const disposable = monacoApi.editor.onDidChangeMarkers((uris) => {
      for (const registration of registrationsRef.current.values()) {
        if (
          admittedWorkspaceRootRef.current &&
          !registrationOwnsRuntime(registration, admittedWorkspaceRootRef.current)
        ) {
          continue;
        }

        registration.onMarkerUrisChanged?.(uris);
      }
    });

    return () => disposable.dispose();
  }, [configurationRegistration?.monacoApi]);

  useEffect(() => {
    const descriptor = activeRegistration?.workspaceIdentityDescriptor;
    const root = activeRegistration?.workspaceRoot;
    if (!descriptor || !root || !descriptor.policy) {
      return;
    }

    return registerWorkspaceIdentityDescriptor(descriptor, root);
  }, [activeRegistration?.workspaceIdentityDescriptor, activeRegistration?.workspaceRoot]);

  useEffect(() => {
    const generationRef = lifecycleGenerationRef;
    const leaseOwner = workspaceLeaseOwnerRef.current;
    const generation = ++generationRef.current;
    return () => {
      const workspace = runtimeWorkspaceRef.current;
      queueMicrotask(() => {
        if (generationRef.current !== generation || !workspace) {
          return;
        }
        if (releaseEditorRuntimeWorkspace(workspace.monacoApi, workspace.root, leaseOwner)) {
          disposeWorkspaceModels(workspace.monacoApi, workspace.root);
        }
      });
    };
  }, []);

  useEffect(
    () => () => {
      contentSyncCoordinatorRef.current?.dispose();
      markerReconcilerRef.current?.dispose();
      markerReconcilerRef.current = null;
      for (const listener of bindingModelListenersRef.current.values()) listener.dispose();
      bindingModelListenersRef.current.clear();
      localPhpValidationCoordinatorRef.current.dispose();
      phpDocumentSymbolCoordinatorRef.current.clear();
    },
    [],
  );

  const value = useMemo<EditorRuntimeContextValue>(
    () => ({
      acknowledgeExactLiveModelContent,
      coordinateLocalPhpValidation,
      coordinatePhpDocumentSymbols,
      focusGroup,
      getActiveJavaScriptTypeScriptOwnerEpoch,
      getActiveJavaScriptTypeScriptOwnerIdentity,
      ownsExactLiveModelContent,
      registerSurface,
      updateSurface,
      writeLocalPhpMarkers,
    }),
    [
      acknowledgeExactLiveModelContent,
      coordinateLocalPhpValidation,
      coordinatePhpDocumentSymbols,
      focusGroup,
      getActiveJavaScriptTypeScriptOwnerEpoch,
      getActiveJavaScriptTypeScriptOwnerIdentity,
      ownsExactLiveModelContent,
      registerSurface,
      updateSurface,
      writeLocalPhpMarkers,
    ],
  );

  return <EditorRuntimeContext.Provider value={value}>{children}</EditorRuntimeContext.Provider>;
}

function resolveRuntimeDocumentForModel(
  registrations: readonly EditorRuntimeSurfaceRegistration[],
  model: Monaco.editor.ITextModel,
  focusedGroupId: string | null,
): EditorDocument | null {
  const ordered = [
    ...registrations.filter(({ groupId }) => groupId === focusedGroupId),
    ...registrations.filter(({ groupId }) => groupId !== focusedGroupId),
  ];

  for (const registration of ordered) {
    const resolved = registration.routing.resolveDocumentForModel(model);
    if (resolved) {
      return resolved;
    }
  }

  return null;
}

interface JavaScriptTypeScriptActiveOwnerSnapshot {
  activeDocument: EditorDocument | null;
  activeModel: Monaco.editor.ITextModel | null;
  activePath: string | null;
  documentSyncVersion: number | null;
  registrationId: string;
  runtimeStatus: ReturnType<JavaScriptTypeScriptLanguageServerProviderContext["getRuntimeStatus"]>;
  workspaceIdentityDescriptor: ReturnType<
    NonNullable<JavaScriptTypeScriptLanguageServerProviderContext["getWorkspaceIdentityDescriptor"]>
  >;
  workspaceRoot: string | null;
  workspaceTrusted: boolean | undefined;
}

function activeRuntimeRegistrationEntry(
  registrations: ReadonlyMap<string, EditorRuntimeSurfaceRegistration>,
  focusedGroupId: string | null,
  admittedRoot: string | null,
): readonly [string, EditorRuntimeSurfaceRegistration] | null {
  const owningEntries = [...registrations.entries()].filter(([, registration]) =>
    registrationOwnsRuntime(registration, admittedRoot),
  );

  return (
    owningEntries.find(([, registration]) => registration.groupId === focusedGroupId) ??
    owningEntries[0] ??
    null
  );
}

function javaScriptTypeScriptActiveOwnerSnapshot(
  activeEntry: readonly [string, EditorRuntimeSurfaceRegistration] | null,
): JavaScriptTypeScriptActiveOwnerSnapshot | null {
  if (!activeEntry) {
    return null;
  }

  const [registrationId, registration] = activeEntry;
  const context = registration.routing.javaScriptTypeScriptProviderContext;
  const activeDocument = context.getActiveDocument();
  const workspaceRoot = context.getWorkspaceRoot?.() ?? registration.workspaceRoot;
  const activePath = activeDocument?.path ?? registration.activePath;

  return {
    activeDocument,
    activeModel: context.getActiveModel?.() ?? registration.editor?.getModel() ?? null,
    activePath,
    documentSyncVersion:
      workspaceRoot && activePath
        ? (context.getDocumentSyncVersion?.(workspaceRoot, activePath) ?? null)
        : null,
    registrationId,
    runtimeStatus: context.getRuntimeStatus(),
    workspaceIdentityDescriptor: context.getWorkspaceIdentityDescriptor?.() ?? null,
    workspaceRoot,
    workspaceTrusted: registration.providerDependencies.workspaceTrusted,
  };
}

function javaScriptTypeScriptActiveOwnerSnapshotsEqual(
  left: JavaScriptTypeScriptActiveOwnerSnapshot | null,
  right: JavaScriptTypeScriptActiveOwnerSnapshot | null,
): boolean {
  if (!left || !right) {
    return left === right;
  }

  return (
    left.registrationId === right.registrationId &&
    left.activeDocument === right.activeDocument &&
    left.activeModel === right.activeModel &&
    left.activePath === right.activePath &&
    left.documentSyncVersion === right.documentSyncVersion &&
    left.runtimeStatus === right.runtimeStatus &&
    left.workspaceIdentityDescriptor === right.workspaceIdentityDescriptor &&
    workspaceRootKeysEqual(left.workspaceRoot, right.workspaceRoot) &&
    left.workspaceTrusted === right.workspaceTrusted
  );
}

function routedRefs(
  activeRegistrationRef: MutableRefObject<EditorRuntimeSurfaceRegistration | null>,
  registrationsRef: MutableRefObject<Map<string, EditorRuntimeSurfaceRegistration>>,
  focusedGroupRef: MutableRefObject<string | null>,
): EditorSurfaceLanguageProviderRegistrationRefs {
  const cache = new Map<PropertyKey, object>();

  return new Proxy({} as EditorSurfaceLanguageProviderRegistrationRefs, {
    get(_target, property) {
      let routedRef = cache.get(property);
      if (!routedRef) {
        if (property === "resolveDocumentForModelRef") {
          routedRef = {
            get current() {
              return (model: Monaco.editor.ITextModel) =>
                resolveRuntimeDocumentForModel(
                  [...registrationsRef.current.values()].filter((registration) =>
                    registrationOwnsRuntime(
                      registration,
                      activeRegistrationRef.current?.workspaceRoot ?? null,
                    ),
                  ),
                  model,
                  focusedGroupRef.current,
                );
            },
          };
          cache.set(property, routedRef);
          return routedRef;
        }

        if (property === "phpCodeActionsRef") {
          routedRef = {
            get current() {
              return (
                source: string,
                range: Parameters<
                  EditorSurfaceLanguageProviderRegistrationRefs["phpCodeActionsRef"]["current"]
                >[1],
              ) => {
                const registration =
                  registrationForPhpProviderSource(
                    [...registrationsRef.current.values()].filter((candidate) =>
                      registrationOwnsRuntime(
                        candidate,
                        activeRegistrationRef.current?.workspaceRoot ?? null,
                      ),
                    ),
                    source,
                    focusedGroupRef.current,
                  ) ?? activeRegistrationRef.current;

                return (
                  registration?.routing.providerRefs.phpCodeActionsRef.current(source, range) ??
                  Promise.resolve([])
                );
              };
            },
          };
          cache.set(property, routedRef);
          return routedRef;
        }

        routedRef = {
          get current() {
            return Reflect.get(activeRegistrationRef.current?.routing.providerRefs ?? {}, property)
              ?.current;
          },
        };
        cache.set(property, routedRef);
      }

      return routedRef;
    },
  });
}

function registrationForPhpProviderSource(
  registrations: readonly EditorRuntimeSurfaceRegistration[],
  source: string,
  focusedGroupId: string | null,
): EditorRuntimeSurfaceRegistration | null {
  const matches = registrations.filter((registration) => {
    const document = registration.routing.activeDocumentRef.current;

    return document?.language === "php" && document.content === source;
  });

  if (matches.length === 0) {
    return null;
  }

  return (
    matches.find((registration) => registration.groupId === focusedGroupId) ?? matches[0] ?? null
  );
}

function canAdmitRegistration(
  id: string,
  candidate: EditorRuntimeSurfaceRegistration,
  registrations: ReadonlyMap<string, EditorRuntimeSurfaceRegistration>,
  admittedRoot: string | null,
): boolean {
  if (!candidate.workspaceRoot) {
    return !admittedRoot && (registrations.size === 0 || registrations.has(id));
  }

  if (admittedRoot) {
    if (workspaceRootKeysEqual(candidate.workspaceRoot, admittedRoot)) {
      return true;
    }

    return registrations.size === 1 && registrations.has(id);
  }

  if (registrations.size === 0 || registrations.has(id)) {
    return true;
  }

  return false;
}

function registrationOwnsRuntime(
  registration: EditorRuntimeSurfaceRegistration,
  admittedRoot: string | null,
): boolean {
  if (!admittedRoot) {
    return false;
  }

  return workspaceRootKeysEqual(registration.workspaceRoot, admittedRoot);
}

function registeredEditorGroup(
  registrations: ReadonlyMap<string, EditorRuntimeSurfaceRegistration>,
  groupId: string,
  admittedRoot: string | null,
): EditorRuntimeSurfaceRegistration | null {
  for (const registration of registrations.values()) {
    if (
      registration.groupId === groupId &&
      registration.editor &&
      registrationOwnsRuntime(registration, admittedRoot)
    ) {
      return registration;
    }
  }

  return null;
}

function admittedWorkspaceRoot(
  registrations: ReadonlyMap<string, EditorRuntimeSurfaceRegistration>,
): string | null {
  for (const registration of registrations.values()) {
    if (registration.workspaceRoot) {
      return registration.workspaceRoot;
    }
  }

  return null;
}

function registrationsStructurallyEqual(
  left: EditorRuntimeSurfaceRegistration,
  right: EditorRuntimeSurfaceRegistration,
): boolean {
  const leftJavaScript = left.routing.javaScriptTypeScriptProviderContext;
  const rightJavaScript = right.routing.javaScriptTypeScriptProviderContext;

  return (
    left.activePath === right.activePath &&
    left.diagnosticsByPath === right.diagnosticsByPath &&
    left.editor === right.editor &&
    left.groupId === right.groupId &&
    left.monacoApi === right.monacoApi &&
    left.providerDependencies.featuresGateway === right.providerDependencies.featuresGateway &&
    left.providerDependencies.refreshGateway === right.providerDependencies.refreshGateway &&
    left.providerDependencies.workspaceEditGateway ===
      right.providerDependencies.workspaceEditGateway &&
    leftJavaScript.completeFunctionCalls === rightJavaScript.completeFunctionCalls &&
    leftJavaScript.featuresGateway === rightJavaScript.featuresGateway &&
    leftJavaScript.refreshGateway === rightJavaScript.refreshGateway &&
    leftJavaScript.workspaceEditGateway === rightJavaScript.workspaceEditGateway &&
    pathsEqual(left.retainPaths, right.retainPaths) &&
    left.typescriptJavascriptDefaults.managedLanguageServerActive ===
      right.typescriptJavascriptDefaults.managedLanguageServerActive &&
    left.typescriptJavascriptDefaults.validationEnabled ===
      right.typescriptJavascriptDefaults.validationEnabled &&
    left.workspaceIdentityDescriptor === right.workspaceIdentityDescriptor &&
    workspaceRootKeysEqual(left.workspaceRoot, right.workspaceRoot)
  );
}

function pathsEqual(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((path, index) => path === right[index]);
}

interface EditorGroupLiveDocumentAttachmentRegistration {
  readonly baseRevision: EditorModelLiveRevision["revision"];
  readonly id: string;
  readonly isCurrent: () => boolean;
  readonly sessionAuthority: EditorGroupDocumentSessionAuthority;
  readonly source: EditorGroupLiveDocumentSource;
}

interface OwnedEditorGroupLiveDocumentAttachment {
  readonly attach: AttachEditorGroupLiveDocument;
  readonly attachment: EditorGroupLiveDocumentAttachment;
  readonly isCurrent: () => boolean;
  readonly sessionAuthority: EditorGroupDocumentSessionAuthority;
  readonly source: EditorGroupLiveDocumentSource;
}

class DetachedLiveDocumentAttachmentCleanupOwner {
  private readonly attachments = new Set<EditorGroupLiveDocumentAttachment>();
  private retryDelayMs = 0;
  private retryScheduled = false;

  retain(attachment: EditorGroupLiveDocumentAttachment): boolean {
    if (
      this.attachments.size >= MAX_DETACHED_LIVE_DOCUMENT_ATTACHMENTS &&
      !this.attachments.has(attachment)
    ) {
      return false;
    }
    this.attachments.add(attachment);
    this.scheduleRetry();
    return true;
  }

  private scheduleRetry(): void {
    if (this.retryScheduled || this.attachments.size === 0) return;
    this.retryScheduled = true;
    const run = () => {
      this.retryScheduled = false;
      for (const attachment of [...this.attachments]) {
        if (safelyRelease(attachment)) this.attachments.delete(attachment);
      }
      if (this.attachments.size === 0) {
        this.retryDelayMs = 0;
        return;
      }
      this.retryDelayMs =
        this.retryDelayMs === 0
          ? MIN_DETACHED_LIVE_DOCUMENT_ATTACHMENT_RETRY_MS
          : Math.min(MAX_DETACHED_LIVE_DOCUMENT_ATTACHMENT_RETRY_MS, this.retryDelayMs * 2);
      this.scheduleRetry();
    };
    if (this.retryDelayMs === 0) {
      queueMicrotask(run);
    } else {
      setTimeout(run, this.retryDelayMs);
    }
  }
}

/**
 * Framework-private lifecycle for compact document checkpoints.
 *
 * Attachments never enter React state. An entry is removed before its external
 * release callback runs, so release failures and reentrant publications cannot
 * revive or observe the retired registration.
 */
class EditorGroupLiveDocumentAttachmentCoordinator {
  private readonly detachedCleanupOwner = new DetachedLiveDocumentAttachmentCleanupOwner();
  private readonly entries = new Map<string, OwnedEditorGroupLiveDocumentAttachment>();
  private readonly pendingReleases = new Set<EditorGroupLiveDocumentAttachment>();

  reconcile(
    attach: AttachEditorGroupLiveDocument | null,
    registrations: readonly EditorGroupLiveDocumentAttachmentRegistration[],
  ): void {
    this.retryPendingReleases();
    const desired = new Map<string, EditorGroupLiveDocumentAttachmentRegistration>();
    if (attach) {
      for (const registration of registrations) {
        if (!desired.has(registration.id)) desired.set(registration.id, registration);
      }
    }

    for (const [id, entry] of [...this.entries]) {
      const registration = desired.get(id);
      if (
        registration &&
        entry.attach === attach &&
        entry.sessionAuthority === registration.sessionAuthority &&
        entry.source.holderIncarnation === registration.source.holderIncarnation &&
        entry.source.modelIncarnation === registration.source.modelIncarnation &&
        safelyCurrent(registration.isCurrent)
      ) {
        this.entries.set(id, {
          ...entry,
          isCurrent: registration.isCurrent,
        });
        desired.delete(id);
        continue;
      }
      this.entries.delete(id);
      this.releaseOrRetain(entry.attachment);
    }

    if (!attach) return;
    for (const [id, registration] of desired) {
      if (!safelyCurrent(registration.isCurrent)) continue;
      let attachment: EditorGroupLiveDocumentAttachment | null = null;
      try {
        attachment = attach(
          registration.sessionAuthority,
          registration.source,
          registration.baseRevision,
        );
      } catch {
        // Compact checkpointing is a shadow path until the store owns edits.
      }
      if (!validAttachment(attachment)) continue;
      if (!safelyCurrent(registration.isCurrent)) {
        this.releaseOrRetain(attachment);
        continue;
      }
      this.entries.set(id, {
        attach,
        attachment,
        isCurrent: registration.isCurrent,
        sessionAuthority: registration.sessionAuthority,
        source: registration.source,
      });
    }
  }

  observe(id: string, checkpoint: EditorModelLiveRevision): EditorLiveEditArbitrationReceipt {
    const entry = this.entries.get(id);
    if (
      !entry ||
      checkpoint.groupId !== entry.sessionAuthority.groupId ||
      checkpoint.path !== entry.sessionAuthority.path ||
      checkpoint.sourceHandleAuthority !== entry.source.holderIncarnation ||
      !safelyCurrent(entry.isCurrent)
    ) {
      return LEGACY_REQUIRED_EDITOR_LIVE_EDIT;
    }
    try {
      const observed = entry.attachment.observe(checkpoint.revision);
      return observed === true && this.entries.get(id) === entry && safelyCurrent(entry.isCurrent)
        ? AUTHORITATIVE_EDITOR_LIVE_EDIT
        : LEGACY_REQUIRED_EDITOR_LIVE_EDIT;
    } catch {
      // Store observers must never suppress the existing legacy edit path.
      return LEGACY_REQUIRED_EDITOR_LIVE_EDIT;
    }
  }

  current(id: string): EditorGroupLiveDocumentAttachment | null {
    const entry = this.entries.get(id);
    return entry && safelyCurrent(entry.isCurrent) ? entry.attachment : null;
  }

  dispose(): void {
    for (const [id, entry] of [...this.entries]) {
      this.entries.delete(id);
      this.releaseOrRetain(entry.attachment);
    }
    this.retryPendingReleases();
    for (const attachment of [...this.pendingReleases]) {
      if (this.detachedCleanupOwner.retain(attachment)) {
        this.pendingReleases.delete(attachment);
      }
    }
  }

  private releaseOrRetain(attachment: EditorGroupLiveDocumentAttachment): void {
    if (!safelyRelease(attachment)) this.pendingReleases.add(attachment);
  }

  private retryPendingReleases(): void {
    for (const attachment of [...this.pendingReleases]) {
      if (safelyRelease(attachment)) this.pendingReleases.delete(attachment);
    }
  }
}

function validAttachment(
  attachment: EditorGroupLiveDocumentAttachment | null,
): attachment is EditorGroupLiveDocumentAttachment {
  try {
    return (
      attachment !== null &&
      typeof attachment === "object" &&
      typeof attachment.observe === "function" &&
      typeof attachment.release === "function"
    );
  } catch {
    return false;
  }
}

function safelyCurrent(isCurrent: () => boolean): boolean {
  try {
    return isCurrent();
  } catch {
    return false;
  }
}

function safeModelText(read: () => string): string {
  try {
    const value = read();
    return typeof value === "string" ? value : "";
  } catch {
    return "";
  }
}

function safePositiveModelValue(read: () => number): number {
  try {
    const value = read();
    return Number.isSafeInteger(value) && value > 0 ? value : 1;
  } catch {
    return 1;
  }
}

function safeNonNegativeModelValue(read: () => number): number {
  try {
    const value = read();
    return Number.isSafeInteger(value) && value >= 0 ? value : 0;
  } catch {
    return 0;
  }
}

function sameLiveModelRevision(
  left: EditorModelLiveRevision["revision"] | null,
  right: EditorModelLiveRevision["revision"],
): boolean {
  return (
    left !== null &&
    left.alternativeVersionId === right.alternativeVersionId &&
    left.contentVersion === right.contentVersion &&
    left.mode === right.mode &&
    left.modelVersionId === right.modelVersionId &&
    left.utf16Length === right.utf16Length
  );
}

function safelyRelease(attachment: EditorGroupLiveDocumentAttachment): boolean {
  try {
    return attachment.release();
  } catch {
    // A malformed facade must not block peer registration cleanup.
    return false;
  }
}

const MAX_DETACHED_LIVE_DOCUMENT_ATTACHMENTS = 64;
const MIN_DETACHED_LIVE_DOCUMENT_ATTACHMENT_RETRY_MS = 1;
const MAX_DETACHED_LIVE_DOCUMENT_ATTACHMENT_RETRY_MS = 1_000;

export type {
  EditorRuntimeSurfaceRegistration,
  EditorRuntimeSurfaceRouting,
  LocalPhpValidationSnapshot,
};
