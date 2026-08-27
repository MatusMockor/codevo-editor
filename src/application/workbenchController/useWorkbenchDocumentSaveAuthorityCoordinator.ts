import { useCallback, useMemo, useRef, type MutableRefObject } from "react";
import type { LocalHistoryGateway } from "../../domain/localHistory";
import type { ResolvedEditorConfig } from "../../domain/editorConfig";
import type { LanguageServerRuntimeStatusByOwner } from "../../domain/languageServerRuntimeStatusCache";
import type { WorkspaceSettings } from "../../domain/settings";
import {
  isDirty,
  workspaceRelativePath,
  type EditorDocument,
  type WorkspaceFileGateway,
} from "../../domain/workspace";
import { workspaceRootKeysEqual } from "../../domain/workspaceRootKey";
import type { WorkspaceRuntimeOwner } from "../../domain/workspaceRuntimeOwner";
import { documentNeedsAttention } from "../../domain/externalFileConflict";
import type { DocumentSelfWriteCoordinator } from "../documentSelfWriteCoordinator";
import { useDocumentSavePipeline } from "../useDocumentSavePipeline";
import { useExternalFileConflictLifecycle } from "../useExternalFileConflictLifecycle";
import { OwnerResolvingDocumentSaveService } from "../ownerResolvingDocumentSaveService";
import {
  WorkbenchOwnerDocumentSaveAdapters,
  type WorkbenchOwnerDocumentSaveAdaptersDependencies,
} from "../workbenchOwnerDocumentSaveAdapters";
import type { WorkbenchCloseLifecycleDependencies } from "../useWorkbenchCloseLifecycle";
import type { WorkspaceSettingsByRootSnapshot } from "../workspaceSettingsForRoot";
import { ownerDocumentSavePipelineContextFor } from "./documentSaveOwnerContext";

type DocumentSavePipelineDependencies = Parameters<typeof useDocumentSavePipeline>[0];
type DocumentSavePipeline = ReturnType<typeof useDocumentSavePipeline>;
type ExternalFileConflictDependencies = Parameters<typeof useExternalFileConflictLifecycle>[0];
type ExternalFileConflicts = ReturnType<typeof useExternalFileConflictLifecycle>;

interface FacetCacheEntry<Value extends object> {
  readonly value: Value;
}

function retainStableFacet<Value extends object>(
  cache: WeakMap<object, FacetCacheEntry<Value>>,
  key: object,
  next: Value,
): Value {
  const current = cache.get(key)?.value;
  if (current) {
    const keys = Object.keys(next) as (keyof Value)[];
    if (
      keys.length === Object.keys(current).length &&
      keys.every((property) => current[property] === next[property])
    ) {
      return current;
    }
  }
  cache.set(key, { value: next });
  return next;
}

interface OwnerPipelineContextDependencies {
  readonly currentWorkspaceRootRef: MutableRefObject<string | null>;
  readonly hasPhpWorkspaceByOwnerRef: MutableRefObject<Record<string, boolean>>;
  readonly javaScriptTypeScriptRuntimeStatusByRootRef: MutableRefObject<LanguageServerRuntimeStatusByOwner>;
  readonly languageServerRuntimeStatusByRootRef: MutableRefObject<LanguageServerRuntimeStatusByOwner>;
  readonly resolveWorkspaceRuntimeOwner: (rootPath: string) => WorkspaceRuntimeOwner | null;
}

interface OwnerSaveServiceDependencies {
  readonly canonicalDocumentSaveRoot: (rootPath: string) => string;
  readonly currentWorkspaceRootRef: MutableRefObject<string | null>;
  readonly documentSelfWrites: DocumentSelfWriteCoordinator;
  readonly filePrefetchCacheRef: {
    readonly current: { invalidate(path: string): void };
  };
  readonly localHistoryGateway: LocalHistoryGateway;
  readonly resolveDocumentSaveOwnership: WorkbenchOwnerDocumentSaveAdaptersDependencies["resolveDocumentSaveOwnership"];
  readonly resolveEditorConfigForFile: (
    rootPath: string,
    path: string,
    owner: WorkspaceRuntimeOwner,
  ) => Promise<ResolvedEditorConfig>;
  readonly resolveWorkspaceRuntimeOwner: (rootPath: string) => WorkspaceRuntimeOwner | null;
  readonly syncSavedDocumentForRoot: (
    rootPath: string,
    document: EditorDocument,
    shouldEmit: () => boolean,
  ) => Promise<void>;
  readonly syncSavedJavaScriptTypeScriptDocumentForRoot: (
    rootPath: string,
    document: EditorDocument,
    shouldEmit: () => boolean,
  ) => Promise<void>;
  readonly workspaceFiles: WorkspaceFileGateway;
  readonly workspaceSettingsByRoot: WorkspaceSettingsByRootSnapshot;
  readonly workspaceSettingsRef: MutableRefObject<WorkspaceSettings>;
}

const ownerContextFacetCache = new WeakMap<
  object,
  FacetCacheEntry<OwnerPipelineContextDependencies>
>();
const ownerAdaptersFacetCache = new WeakMap<
  object,
  FacetCacheEntry<Omit<WorkbenchOwnerDocumentSaveAdaptersDependencies, "hasExternalFileConflict">>
>();
const ownerSaveServiceFacetCache = new WeakMap<
  object,
  FacetCacheEntry<OwnerSaveServiceDependencies>
>();

export interface WorkbenchDocumentSaveAuthorityCoordinatorDependencies {
  readonly clearExternalFileConflictsForRootRef: MutableRefObject<
    ExternalFileConflicts["clearRoot"]
  >;
  readonly externalFileConflicts: ExternalFileConflictDependencies;
  readonly openDocuments: readonly EditorDocument[];
  readonly ownerAdapters: Omit<
    WorkbenchOwnerDocumentSaveAdaptersDependencies,
    "hasExternalFileConflict"
  >;
  readonly ownerContext: OwnerPipelineContextDependencies;
  readonly pipeline: DocumentSavePipelineDependencies;
  readonly service: OwnerSaveServiceDependencies;
  readonly workspaceHasExternalFileConflictsRef: MutableRefObject<
    ExternalFileConflicts["hasConflictsForRoot"]
  >;
  readonly workspaceRoot: string | null;
}

export interface WorkbenchDocumentSaveAuthorityCoordinator {
  readonly captureDirtyCloseTargets: (
    rootPath: string | null,
  ) => ReturnType<WorkbenchOwnerDocumentSaveAdapters["capture"]>;
  readonly dirtyCount: number;
  readonly externalFileConflicts: ExternalFileConflicts;
  readonly formattedContentForSave: DocumentSavePipeline["formattedContentForSave"];
  readonly handleExternalFileChange: ExternalFileConflicts["handleFileChange"];
  readonly hasExternalFileConflict: ExternalFileConflicts["hasConflict"];
  readonly isWorkspaceRuntimeOwnerCurrent: (owner: WorkspaceRuntimeOwner) => boolean;
  readonly optimizedImportsContentForSave: DocumentSavePipeline["optimizedImportsContentForSave"];
  readonly organizedImportsContentForSave: DocumentSavePipeline["organizedImportsContentForSave"];
  readonly ownerDocumentSaveAdapters: WorkbenchOwnerDocumentSaveAdapters;
  readonly ownerResolvingDocumentSaveService: OwnerResolvingDocumentSaveService;
  readonly requestOwnerDocumentSave: WorkbenchCloseLifecycleDependencies["requestOwnerDocumentSave"];
  readonly requestOwnerDocumentSaveRef: MutableRefObject<
    WorkbenchCloseLifecycleDependencies["requestOwnerDocumentSave"]
  >;
}

export function useWorkbenchDocumentSaveAuthorityCoordinator({
  clearExternalFileConflictsForRootRef,
  externalFileConflicts: externalFileConflictDependencies,
  openDocuments,
  ownerAdapters,
  ownerContext,
  pipeline,
  service,
  workspaceHasExternalFileConflictsRef,
  workspaceRoot,
}: WorkbenchDocumentSaveAuthorityCoordinatorDependencies): WorkbenchDocumentSaveAuthorityCoordinator {
  ownerContext = retainStableFacet(
    ownerContextFacetCache,
    ownerContext.currentWorkspaceRootRef,
    ownerContext,
  );
  ownerAdapters = retainStableFacet(
    ownerAdaptersFacetCache,
    ownerAdapters.currentWorkspaceRootRef,
    ownerAdapters,
  );
  service = retainStableFacet(ownerSaveServiceFacetCache, service.currentWorkspaceRootRef, service);
  const {
    formattedContentForSave,
    formattedContentForOwnerSave,
    optimizedImportsContentForSave,
    optimizedImportsContentForOwnerSave,
    organizedImportsContentForSave,
    organizedImportsContentForOwnerSave,
  } = useDocumentSavePipeline(pipeline);
  const ownerDocumentSavePipelineContext = useCallback(
    (owner: WorkspaceRuntimeOwner, settings: WorkspaceSettings) => {
      const activeRoot = ownerContext.currentWorkspaceRootRef.current;
      const synchronizedOwner = activeRoot
        ? ownerContext.resolveWorkspaceRuntimeOwner(activeRoot)
        : null;
      return ownerDocumentSavePipelineContextFor(
        owner,
        settings,
        ownerContext.hasPhpWorkspaceByOwnerRef.current,
        ownerContext.languageServerRuntimeStatusByRootRef.current,
        ownerContext.javaScriptTypeScriptRuntimeStatusByRootRef.current,
        synchronizedOwner,
      );
    },
    [ownerContext],
  );

  const externalFileConflicts = useExternalFileConflictLifecycle(externalFileConflictDependencies);
  const hasExternalFileConflict = externalFileConflicts.hasConflict;
  clearExternalFileConflictsForRootRef.current = externalFileConflicts.clearRoot;
  workspaceHasExternalFileConflictsRef.current = externalFileConflicts.hasConflictsForRoot;
  const dirtyCount = openDocuments.filter(
    (document) =>
      !document.readOnly &&
      documentNeedsAttention(
        isDirty(document),
        hasExternalFileConflict(workspaceRoot, document.path),
      ),
  ).length;

  const ownerDocumentSaveAdapters = useMemo(
    () =>
      new WorkbenchOwnerDocumentSaveAdapters({
        ...ownerAdapters,
        hasExternalFileConflict,
      }),
    [hasExternalFileConflict, ownerAdapters],
  );
  const captureDirtyCloseTargets = useCallback(
    (rootPath: string | null) => ownerDocumentSaveAdapters.capture(rootPath),
    [ownerDocumentSaveAdapters],
  );
  const isWorkspaceRuntimeOwnerCurrent = useCallback(
    (owner: WorkspaceRuntimeOwner) => ownerDocumentSaveAdapters.isOwnerCurrent(owner),
    [ownerDocumentSaveAdapters],
  );
  const ownerResolvingDocumentSaveService = useMemo(
    () =>
      new OwnerResolvingDocumentSaveService({
        repository: ownerDocumentSaveAdapters.repository,
        resolvePipeline: (owner, rootPath) => {
          const canonicalRoot = service.canonicalDocumentSaveRoot(rootPath);
          const settings =
            service.workspaceSettingsByRoot.resolve(canonicalRoot) ??
            (workspaceRootKeysEqual(service.currentWorkspaceRootRef.current, rootPath)
              ? service.workspaceSettingsRef.current
              : null);
          if (!settings || !ownerDocumentSaveAdapters.isOwnerCurrent(owner)) {
            return null;
          }
          return {
            workspaceFiles: service.workspaceFiles,
            settings,
            invalidatePrefetch: (requestedOwner, path) => {
              if (!ownerDocumentSaveAdapters.isOwnerCurrent(requestedOwner)) {
                return;
              }
              service.filePrefetchCacheRef.current.invalidate(path);
            },
            captureLocalHistorySnapshot: async (requestedOwner, requestedRoot, path, content) => {
              if (!ownerDocumentSaveAdapters.isOwnerCurrent(requestedOwner)) {
                return;
              }
              const relativePath = workspaceRelativePath(requestedRoot, path);
              if (!relativePath) {
                return;
              }
              try {
                await service.localHistoryGateway.recordSnapshot(
                  requestedRoot,
                  relativePath,
                  content,
                );
              } catch (error) {
                console.error("Local History snapshot failed", error);
              }
            },
            formattedContentForSave: (requestedOwner, requestedRoot, settings, document) =>
              formattedContentForOwnerSave(
                ownerDocumentSavePipelineContext(requestedOwner, settings),
                document,
                requestedRoot,
              ),
            optimizedImportsContentForSave: (
              requestedOwner,
              _requestedRoot,
              settings,
              document,
              content,
            ) =>
              optimizedImportsContentForOwnerSave(
                ownerDocumentSavePipelineContext(requestedOwner, settings),
                document,
                content,
              ),
            organizedImportsContentForSave: (
              requestedOwner,
              requestedRoot,
              settings,
              document,
              content,
            ) =>
              organizedImportsContentForOwnerSave(
                ownerDocumentSavePipelineContext(requestedOwner, settings),
                document,
                content,
                requestedRoot,
              ),
            resolveEditorConfigForFile: (requestedOwner, requestedRoot, path) =>
              service.resolveEditorConfigForFile(requestedRoot, path, requestedOwner),
            syncSavedDocument: async (requestedOwner, requestedRoot, document, shouldEmit) => {
              if (
                service.resolveWorkspaceRuntimeOwner(requestedRoot)?.ownerKey !==
                requestedOwner.ownerKey
              ) {
                return;
              }
              if (!workspaceRootKeysEqual(service.currentWorkspaceRootRef.current, requestedRoot)) {
                return;
              }
              await service.syncSavedDocumentForRoot(requestedRoot, document, shouldEmit);
            },
            syncSavedJavaScriptTypeScriptDocument: async (
              requestedOwner,
              requestedRoot,
              document,
              shouldEmit,
            ) => {
              if (
                service.resolveWorkspaceRuntimeOwner(requestedRoot)?.ownerKey !==
                requestedOwner.ownerKey
              ) {
                return;
              }
              if (!workspaceRootKeysEqual(service.currentWorkspaceRootRef.current, requestedRoot)) {
                return;
              }
              await service.syncSavedJavaScriptTypeScriptDocumentForRoot(
                requestedRoot,
                document,
                shouldEmit,
              );
            },
            hasExternalFileConflict: (requestedOwner, requestedRoot, path) =>
              service.resolveWorkspaceRuntimeOwner(requestedRoot)?.ownerKey ===
                requestedOwner.ownerKey && hasExternalFileConflict(requestedRoot, path),
            beginDocumentSelfWrite: (requestedOwner, requestedRoot, path, content) => {
              if (
                service.resolveWorkspaceRuntimeOwner(requestedRoot)?.ownerKey !==
                requestedOwner.ownerKey
              ) {
                return null;
              }
              const ownership = service.resolveDocumentSaveOwnership(requestedRoot, path);
              return ownership ? service.documentSelfWrites.begin(ownership, content) : null;
            },
          };
        },
      }),
    [
      formattedContentForOwnerSave,
      hasExternalFileConflict,
      optimizedImportsContentForOwnerSave,
      organizedImportsContentForOwnerSave,
      ownerDocumentSaveAdapters,
      ownerDocumentSavePipelineContext,
      service,
    ],
  );
  const requestOwnerDocumentSaveRef = useRef<
    WorkbenchCloseLifecycleDependencies["requestOwnerDocumentSave"]
  >(async () => ({ status: "stale" }));
  const requestOwnerDocumentSave = useCallback<
    WorkbenchCloseLifecycleDependencies["requestOwnerDocumentSave"]
  >((ownership, operation) => requestOwnerDocumentSaveRef.current(ownership, operation), []);

  return {
    captureDirtyCloseTargets,
    dirtyCount,
    externalFileConflicts,
    formattedContentForSave,
    handleExternalFileChange: externalFileConflicts.handleFileChange,
    hasExternalFileConflict,
    isWorkspaceRuntimeOwnerCurrent,
    optimizedImportsContentForSave,
    organizedImportsContentForSave,
    ownerDocumentSaveAdapters,
    ownerResolvingDocumentSaveService,
    requestOwnerDocumentSave,
    requestOwnerDocumentSaveRef,
  };
}
