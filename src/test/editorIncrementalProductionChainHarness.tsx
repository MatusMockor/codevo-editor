/* eslint-disable react-refresh/only-export-components */
import { useEffect, useMemo, useRef, useState } from "react";
import { URI } from "monaco-editor/esm/vs/base/common/uri.js";
import type * as Monaco from "monaco-editor";
import { vi, type Mock } from "vitest";
import { DocumentSessionStore } from "../application/documentSessionStore";
import {
  createRegisteredDocumentSaveIdentity,
  type RegisteredDocumentSaveIdentity,
} from "../application/documentSaveIdentity";
import {
  EditorSessionDocumentAuthoritySidecar,
  type EditorGroupDocumentSessionAuthority,
} from "../application/editorSessionDocumentAuthority";
import { editorJavaScriptTypeScriptIncrementalSyncFacade } from "../application/editorJavaScriptTypeScriptIncrementalSyncFacade";
import { IncrementalDocumentSyncCoordinator } from "../application/incrementalDocumentSyncCoordinator";
import {
  JavaScriptTypeScriptIncrementalSyncProductionCoordinator,
  type JavaScriptTypeScriptIncrementalRuntimeAuthority,
} from "../application/javaScriptTypeScriptIncrementalSyncProduction";
import { JavaScriptTypeScriptIncrementalSyncService } from "../application/javaScriptTypeScriptIncrementalSyncService";
import { LiveDocumentRuntime } from "../application/liveDocumentRuntime";
import type {
  BoundedLanguageServerDidChangeRequest,
  BoundedLanguageServerDidCloseRequest,
  BoundedLanguageServerDidOpenRequest,
  BoundedLanguageServerDidOpenReceipt,
  BoundedLanguageServerDocumentSyncReceipt,
  IncrementalLanguageServerDocumentSyncGateway,
} from "../domain/incrementalLanguageServerDocumentSync";
import { createEditorSessionOwnerKey } from "../domain/editorSessionOwnerKey";
import type {
  EditorDocument,
  WorkspaceFileGateway,
  WorkspaceFileRevision,
  WorkspaceOwnerRelativeFileGateway,
} from "../domain/workspace";
import {
  EditorRuntimeHost,
  type EditorRuntimeSurfaceRegistration,
  type EditorRuntimeSurfaceRouting,
} from "../components/EditorRuntimeHost";
import {
  useEditorRuntimeContext,
  type EditorRuntimeContextValue,
} from "../components/editorRuntimeContext";
import type { EditorSurfaceLanguageProviderRegistrationRefs } from "../components/editorSurfaceLanguageProviderOptions";
import { workspaceModelUri } from "../components/phpMonacoDocumentContext";
import {
  getEditorDocumentDirtySnapshot,
  subscribeEditorDocumentDirtyProjection,
} from "../application/editorSessionDirtyProjection";
import {
  EditorActiveLiveDocumentSaveCoordinator,
  type EditorActiveLiveDocumentSaveBinding,
} from "../application/editorActiveLiveDocumentSaveCoordinator";
import type {
  ActiveDocumentSaveStorePort,
  DocumentSaveTarget,
} from "../application/activeDocumentSaveStore";
import { DocumentSaveService, type DocumentSaveResult } from "../application/documentSaveService";
import { syncPreparedIncrementalDocumentSave } from "../application/incrementalDocumentSavePreparation";
import { DEFAULT_LIVE_DOCUMENT_CONTENT_LIMITS } from "../domain/liveDocumentContentAuthority";
import type { LanguageServerDocumentSyncGateway } from "../domain/languageServerDocumentSync";
import { defaultKeymapSettings } from "../domain/keymap";
import { EditorSurface } from "../components/EditorSurface";

const ROOT = "/workspace";
const PATH = "/workspace/src/large.ts";
const WORKSPACE_ID = "workspace";
const CAPABILITY = Object.freeze({
  changeKind: "incremental" as const,
  openClose: true,
  save: Object.freeze({ includeText: true, kind: "supported" as const }),
});

export class RecordingIncrementalGateway implements IncrementalLanguageServerDocumentSyncGateway {
  readonly changeRequests: BoundedLanguageServerDidChangeRequest[] = [];
  readonly closeRequests: BoundedLanguageServerDidCloseRequest[] = [];
  readonly openRequests: BoundedLanguageServerDidOpenRequest[] = [];

  constructor(
    private readonly changeReceipt: BoundedLanguageServerDocumentSyncReceipt = {
      kind: "admitted",
    },
  ) {}

  async didChange(
    request: BoundedLanguageServerDidChangeRequest,
  ): Promise<BoundedLanguageServerDocumentSyncReceipt> {
    this.changeRequests.push(request);
    return this.changeReceipt;
  }

  async didClose(
    request: BoundedLanguageServerDidCloseRequest,
  ): Promise<BoundedLanguageServerDocumentSyncReceipt> {
    this.closeRequests.push(request);
    return { kind: "admitted" };
  }

  async didOpen(
    request: BoundedLanguageServerDidOpenRequest,
  ): Promise<BoundedLanguageServerDidOpenReceipt> {
    this.openRequests.push(request);
    return { kind: "admitted", lifecycleToken: "production-chain-lifecycle" };
  }

  logicalCounters(): Pick<
    EditorIncrementalProductionChainLogicalCounters,
    | "incrementalChangeCount"
    | "incrementalInsertedUtf16Units"
    | "maxChangesPerRequest"
    | "openTextUtf16Units"
    | "fullChangeCount"
    | "fullChangeTextUtf16Units"
  > {
    return {
      fullChangeCount: this.changeRequests.filter(({ change }) => change.kind === "full").length,
      fullChangeTextUtf16Units: this.changeRequests.reduce(
        (total, { change }) => total + (change.kind === "full" ? change.text.length : 0),
        0,
      ),
      incrementalChangeCount: this.changeRequests.reduce(
        (total, { change }) => total + (change.kind === "incremental" ? change.changes.length : 0),
        0,
      ),
      incrementalInsertedUtf16Units: this.changeRequests.reduce(
        (total, { change }) =>
          total +
          (change.kind === "incremental"
            ? change.changes.reduce((units, item) => units + item.text.length, 0)
            : 0),
        0,
      ),
      maxChangesPerRequest: this.changeRequests.reduce(
        (maximum, { change }) =>
          Math.max(maximum, change.kind === "incremental" ? change.changes.length : 1),
        0,
      ),
      openTextUtf16Units: this.openRequests.reduce(
        (total, request) => total + request.text.length,
        0,
      ),
    };
  }
}

export interface EditorIncrementalProductionChainLogicalCounters {
  readonly diskWriteCount: number;
  readonly diskWriteUtf16Units: number;
  readonly fullTextReadCount: number;
  readonly fullTextReadUtf16Units: number;
  readonly fullChangeCount: number;
  readonly fullChangeTextUtf16Units: number;
  readonly incrementalChangeCount: number;
  readonly incrementalInsertedUtf16Units: number;
  readonly legacyPublicationCount: number;
  readonly legacyPublicationUtf16Units: number;
  readonly maxChangesPerRequest: number;
  readonly openTextUtf16Units: number;
}

export type EditorIncrementalProductionChainSaveAttempt =
  | { readonly status: "admitted"; readonly writtenContent: string }
  | { readonly status: "fallback"; readonly writtenContent: string }
  | { readonly status: "rejected" };

export type EditorIncrementalProductionChainPreparedSave =
  | {
      complete(): Promise<EditorIncrementalProductionChainSaveAttempt>;
      readonly status: "prepared";
      readonly writeIssued: Promise<string>;
      readonly writtenContent: string;
    }
  | { readonly status: "rejected" };

export type EditorIncrementalProductionChainSaveLifecycleEvent =
  | {
      readonly content: string;
      readonly kind: "history" | "sync-saved-document" | "sync-saved-javascript-typescript";
    }
  | {
      readonly expectedContent: string;
      readonly kind: "acknowledge";
      readonly liveContentBeforeAcknowledgement: string;
      readonly revision: EditorDocument["revision"];
      readonly savedContent: string;
      readonly startingContent: string;
    }
  | { readonly content: string; readonly kind: "did-save" | "write" };

export interface EditorIncrementalProductionChainHarness {
  readonly authorities: ReadonlyMap<string, EditorGroupDocumentSessionAuthority>;
  readonly dirtyNotifications: ReturnType<typeof vi.fn>;
  readonly diskWrite: ReturnType<typeof vi.fn<(content: string) => void>>;
  readonly editors: readonly ProductionChainEditor[];
  readonly expectsExactOwnership: boolean;
  readonly gateway: RecordingIncrementalGateway;
  readonly initialContent: string;
  readonly initialRevision: WorkspaceFileRevision;
  readonly javaScriptTypeScriptDidSave: ReturnType<typeof vi.fn>;
  readonly legacyDidChange: ReturnType<typeof vi.fn>;
  readonly legacyFullPublication: ReturnType<typeof vi.fn>;
  readonly model: ProductionChainModel;
  readonly monaco: typeof Monaco;
  readonly ownerRelativeWorkspaceWrite: ReturnType<typeof vi.fn>;
  readonly path: string;
  readonly production: JavaScriptTypeScriptIncrementalSyncProductionCoordinator;
  readonly rawWorkspaceWrite: ReturnType<typeof vi.fn>;
  readonly registeredIdentity: RegisteredDocumentSaveIdentity;
  acknowledgeCurrentModel(): boolean;
  activeSaveBinding(): EditorActiveLiveDocumentSaveBinding | null;
  attemptSave(): Promise<EditorIncrementalProductionChainSaveAttempt>;
  beginDeferredSave(): EditorIncrementalProductionChainPreparedSave;
  currentModel(): ProductionChainModel;
  isDirty(): boolean;
  logicalCounters(): EditorIncrementalProductionChainLogicalCounters;
  replaceModel(content: string): ProductionChainModel;
  queueLegacyPublicationResults(...results: boolean[]): void;
  saveLifecycleEvents(): readonly EditorIncrementalProductionChainSaveLifecycleEvent[];
  renderWithDocumentContent(
    content: string,
    projection?: "new-document" | "same-document",
  ): React.ReactElement;
  readonly runtime: LiveDocumentRuntime;
  readonly runtimeContext: { current: EditorRuntimeContextValue | null };
  readonly savedRevision: WorkspaceFileRevision;
  readonly sidecar: EditorSessionDocumentAuthoritySidecar;
  readonly unsubscribeDirty: () => void;
  readonly view: React.ReactElement;
}

export interface ProductionChainEditor extends Monaco.editor.IStandaloneCodeEditor {
  emitInsertion(text: string): void;
  emitReplacement(text: string, rangeLength?: number): void;
  replaceModel(
    model: ProductionChainModel,
    applyInsertion: (text: string) => Monaco.editor.IModelContentChangedEvent,
    applyReplacement: (
      text: string,
      rangeLength?: number,
    ) => Monaco.editor.IModelContentChangedEvent,
    setContentChangeSink: (
      sink: ((event: Monaco.editor.IModelContentChangedEvent) => void) | null,
    ) => void,
  ): void;
}

export type ProductionChainModel = Monaco.editor.ITextModel & {
  readonly currentContent: () => string;
  readonly getValue: Mock<Monaco.editor.ITextModel["getValue"]>;
  readonly getValueLength: Mock<Monaco.editor.ITextModel["getValueLength"]>;
  readonly setValue: Mock<(value: string) => void>;
};

export function createEditorIncrementalProductionChainHarness(
  paneCount: 1 | 2 | 4,
  options: {
    readonly admitIncremental?: boolean;
    readonly changeReceipt?: BoundedLanguageServerDocumentSyncReceipt;
    readonly initialContent?: string;
    readonly initialUtf16Length?: number;
    readonly surfaceMode?: "editor-surface" | "registration";
  } = {},
): EditorIncrementalProductionChainHarness {
  if (options.initialContent !== undefined && options.initialUtf16Length !== undefined) {
    throw new TypeError("Specify initialContent or initialUtf16Length, not both");
  }
  const initialContent =
    options.initialContent ??
    "a".repeat(validInitialUtf16Length(options.initialUtf16Length ?? 1024 * 1024));
  const logicalWork = {
    diskWriteUtf16Units: 0,
    fullTextReadCount: 0,
    fullTextReadUtf16Units: 0,
    legacyPublicationUtf16Units: 0,
  };
  let modelFixture = createProductionChainModel(initialContent, (length) => {
    logicalWork.fullTextReadCount += 1;
    logicalWork.fullTextReadUtf16Units += length;
  });
  const model = modelFixture.model;
  let currentModel = model;
  const editors = Array.from({ length: paneCount }, (_, index) =>
    createProductionChainEditor(
      model,
      modelFixture.applyInsertion,
      modelFixture.applyReplacement,
      modelFixture.setContentChangeSink,
      index,
    ),
  );
  const monaco = createProductionChainMonaco(() => currentModel);
  const store = new DocumentSessionStore();
  const sidecar = new EditorSessionDocumentAuthoritySidecar(store);
  const initialRevision = workspaceRevision("initial", initialContent.length);
  const savedRevision = workspaceRevision("saved", initialContent.length);
  const registeredIdentity = createRegisteredDocumentSaveIdentity(
    WORKSPACE_ID,
    ROOT,
    "src/large.ts",
  );
  if (!registeredIdentity) {
    throw new Error("Expected production-chain registered document identity");
  }
  const document: EditorDocument = {
    content: initialContent,
    language: "typescript",
    name: "large.ts",
    path: PATH,
    revision: initialRevision,
    savedContent: initialContent,
  };
  const activated = sidecar.activateOwner(
    {
      canonicalRoot: ROOT,
      ownerKey: createEditorSessionOwnerKey(WORKSPACE_ID, ROOT),
      rootPath: ROOT,
      workspaceId: WORKSPACE_ID,
    },
    (_rootPath, candidatePath) => (candidatePath === PATH ? registeredIdentity : null),
    { [PATH]: document },
  );
  if (!activated) throw new Error("Expected production-chain document owner");
  const lifecycle = sidecar.resolveLifecycle(PATH);
  if (!lifecycle) throw new Error("Expected production-chain document lifecycle");
  const authorities = new Map(
    editors.map((_, index) => {
      const groupId = groupName(index);
      const authority = sidecar.createGroupAuthority(lifecycle, groupId, PATH, Object.freeze({}));
      if (!authority) throw new Error("Expected production-chain group authority");
      return [groupId, authority] as const;
    }),
  );
  const dirtyNotifications = vi.fn();
  const dirtyProjection = sidecar.resolveDocumentDirtyProjection(lifecycle);
  if (!dirtyProjection || getEditorDocumentDirtySnapshot(dirtyProjection).status !== "available") {
    throw new Error("Expected production-chain dirty projection");
  }
  const unsubscribeDirty = subscribeEditorDocumentDirtyProjection(
    dirtyProjection,
    dirtyNotifications,
  );
  const gateway = new RecordingIncrementalGateway(options.changeReceipt);
  const runtimeAuthority: JavaScriptTypeScriptIncrementalRuntimeAuthority = Object.freeze({
    capability: CAPABILITY,
    rootPath: ROOT,
    sessionId: 7,
    syncGeneration: 3,
  });
  const runtimePort = {
    current: () => runtimeAuthority,
    isCurrent: (candidate: JavaScriptTypeScriptIncrementalRuntimeAuthority) =>
      candidate === runtimeAuthority,
  };
  const legacyDidChange = vi.fn();
  let legacyDocument = document;
  const saveLifecycleEvents: EditorIncrementalProductionChainSaveLifecycleEvent[] = [];
  const queuedLegacyPublicationResults: boolean[] = [];
  const legacyFullPublication = vi.fn((content: string) => {
    logicalWork.legacyPublicationUtf16Units += content.length;
    const accepted = queuedLegacyPublicationResults.shift() ?? true;
    if (accepted) legacyDocument = { ...legacyDocument, content };
    legacyDidChange();
    return accepted;
  });
  const diskWrite = vi.fn<(content: string) => void>((content) => {
    logicalWork.diskWriteUtf16Units += content.length;
  });
  let deferredOwnerRelativeWrite:
    WorkspaceOwnerRelativeFileGateway["writeTextFileForWorkspaceRelativePath"] | null = null;
  const rawWorkspaceWrite = vi.fn<WorkspaceFileGateway["writeTextFile"]>(async () => {
    throw new Error("Registered saves must not use raw path-based workspace writes");
  });
  const ownerRelativeWorkspaceWrite = vi.fn<
    WorkspaceOwnerRelativeFileGateway["writeTextFileForWorkspaceRelativePath"]
  >((workspaceId, relativePath, content, expectedRevision) => {
    if (!deferredOwnerRelativeWrite) {
      throw new Error("No deferred owner-relative workspace write is active");
    }
    return deferredOwnerRelativeWrite(workspaceId, relativePath, content, expectedRevision);
  });
  const production = new JavaScriptTypeScriptIncrementalSyncProductionCoordinator(
    new JavaScriptTypeScriptIncrementalSyncService(
      new IncrementalDocumentSyncCoordinator(),
      gateway,
    ),
    runtimePort,
    {
      close: vi.fn(async () => undefined),
      open: vi.fn(async () => undefined),
    },
  );
  const incrementalPort =
    options.admitIncremental === false ? rejectedIncrementalPort() : production;
  const incrementalFacade = editorJavaScriptTypeScriptIncrementalSyncFacade(incrementalPort);
  const runtime = new LiveDocumentRuntime();
  const runtimeContext: { current: EditorRuntimeContextValue | null } = { current: null };
  let activeSaveBinding: EditorActiveLiveDocumentSaveBinding | null = null;
  const saveCoordinator = new EditorActiveLiveDocumentSaveCoordinator();
  const javaScriptTypeScriptDidSave = vi.fn(
    async (_rootPath: string, savedDocument: { readonly text: string }, _sessionId: number) => {
      saveLifecycleEvents.push({ content: savedDocument.text, kind: "did-save" });
    },
  );
  const attachLiveDocument = (
    authority: EditorGroupDocumentSessionAuthority,
    source: Parameters<EditorSessionDocumentAuthoritySidecar["attachEditorGroupLiveDocument"]>[1],
    revision: Parameters<EditorSessionDocumentAuthoritySidecar["attachEditorGroupLiveDocument"]>[2],
  ) =>
    sidecar.attachEditorGroupLiveDocument(
      authority,
      source,
      revision,
      () => authorities.get(authority.groupId) === authority,
    );
  const isAuthorityCurrent = (authority: EditorGroupDocumentSessionAuthority) =>
    sidecar.isGroupLifecycleCurrent(authority) && authorities.get(authority.groupId) === authority;
  const resolveAuthority = (groupId: string) => authorities.get(groupId) ?? null;
  const renderWithDocumentContent = (
    content: string,
    projection: "new-document" | "same-document" = "new-document",
  ) => {
    const renderedDocument =
      projection === "same-document" && content === document.content
        ? document
        : { ...document, content };
    return (
      <EditorRuntimeHost
        activeGroupId={groupName(0)}
        attachEditorGroupLiveDocument={attachLiveDocument}
        isEditorGroupDocumentSessionAuthorityCurrent={isAuthorityCurrent}
        javaScriptTypeScriptIncrementalSync={incrementalFacade}
        liveDocumentRuntime={runtime}
        onActiveLiveDocumentSaveBindingChange={(binding) => {
          activeSaveBinding = binding;
          saveCoordinator.publish(binding);
        }}
        resolveEditorGroupDocumentSessionAuthority={resolveAuthority}
      >
        {editors.map((editor, index) =>
          options.surfaceMode === "editor-surface" ? (
            <ProductionChainActualEditorSurface
              document={renderedDocument}
              groupId={groupName(index)}
              key={groupName(index)}
              onModelContentChange={legacyFullPublication}
              runtimeContext={runtimeContext}
            />
          ) : (
            <ProductionChainSurface
              document={renderedDocument}
              editor={editor}
              groupId={groupName(index)}
              key={groupName(index)}
              model={currentModel}
              monaco={monaco}
              onModelContentChange={legacyFullPublication}
              runtimeContext={runtimeContext}
            />
          ),
        )}
      </EditorRuntimeHost>
    );
  };
  const view = renderWithDocumentContent(document.content, "same-document");

  const legacySaveStore: ActiveDocumentSaveStorePort = {
    acknowledgeIssuedWrite: (_target, acknowledgement) => {
      saveLifecycleEvents.push({
        expectedContent: acknowledgement.expectedDocument.content,
        kind: "acknowledge",
        liveContentBeforeAcknowledgement: legacyDocument.content,
        revision: acknowledgement.revision,
        savedContent: acknowledgement.savedDocument.content,
        startingContent: acknowledgement.startingContent,
      });
      legacyDocument = {
        ...legacyDocument,
        revision: acknowledgement.revision,
        savedContent: acknowledgement.savedDocument.content,
      };
    },
    current: () => legacyDocument,
    updateRevision: (_target, revision) => {
      legacyDocument = { ...legacyDocument, revision };
    },
    updateRevisionForIssuedWrite: (_target, _expectedDocument, revision) => {
      legacyDocument = { ...legacyDocument, revision };
    },
  };
  const outerLease = {
    epoch: 1,
    isCurrent: () => true,
    path: PATH,
    rootPath: ROOT,
    tryBeginWrite: () => ({
      granted: true as const,
      settle: () => undefined,
    }),
  };
  const target: DocumentSaveTarget = {
    lease: outerLease,
    path: PATH,
    registeredIdentity,
    rootPath: ROOT,
    workspaceRequestToken: 1,
  };
  const resultFor = (
    admissionStatus: "admitted" | "fallback",
    savedContent: string,
    result: DocumentSaveResult,
  ): EditorIncrementalProductionChainSaveAttempt =>
    result.status === "saved"
      ? { status: admissionStatus, writtenContent: savedContent }
      : { status: "rejected" };
  const beginDeferredSave = (): EditorIncrementalProductionChainPreparedSave => {
    const admission = saveCoordinator.admit({
      document: legacyDocument,
      lease: outerLease,
      legacySaveStore,
      requireExactLiveSave: true,
      target,
    });
    if (admission.status === "rejected") return { status: "rejected" };
    const saveStore = admission.status === "admitted" ? admission.saveStore : legacySaveStore;
    const saveTarget = admission.status === "admitted" ? admission.target : target;
    const exact = saveStore.current(saveTarget);
    if (!exact) {
      if (admission.status === "admitted") admission.settle();
      return { status: "rejected" };
    }
    const writeGate = deferred<void>();
    const writeIssued = deferred<string>();
    deferredOwnerRelativeWrite = async (_workspaceId, _relativePath, content) => {
      try {
        saveLifecycleEvents.push({ content, kind: "write" });
        diskWrite(content);
        writeIssued.resolve(content);
        await writeGate.promise;
        return {
          revision: { ...savedRevision, size: content.length },
          status: "success",
        };
      } finally {
        deferredOwnerRelativeWrite = null;
      }
    };
    const workspaceFiles = {
      writeTextFile: rawWorkspaceWrite,
    } as unknown as WorkspaceFileGateway;
    const service = new DocumentSaveService({
      beginDocumentSelfWrite: () => null,
      beginRegisteredDocumentSelfWrite: () => null,
      captureLocalHistorySnapshot: async (_rootPath, _path, content) => {
        saveLifecycleEvents.push({ content, kind: "history" });
      },
      formattedContentForSave: async (candidate) => candidate.content,
      hasExternalFileConflict: () => false,
      invalidatePrefetch: () => undefined,
      optimizedImportsContentForSave: (_candidate, content) => content,
      organizedImportsContentForSave: async (_candidate, content) => content,
      resolveEditorConfigForFile: async () => ({}),
      saveStore,
      syncSavedDocument: async (_rootPath, savedDocument) => {
        saveLifecycleEvents.push({
          content: savedDocument.content,
          kind: "sync-saved-document",
        });
      },
      syncSavedJavaScriptTypeScriptDocument: async (rootPath, savedDocument, shouldEmit) => {
        saveLifecycleEvents.push({
          content: savedDocument.content,
          kind: "sync-saved-javascript-typescript",
        });
        const lease = production.requestLifecycleLease(savedDocument.path);
        if (!lease) return;
        await syncPreparedIncrementalDocumentSave({
          document: savedDocument,
          gateway: {
            didSave: javaScriptTypeScriptDidSave,
          } as unknown as LanguageServerDocumentSyncGateway,
          incrementalSync: production,
          isCurrent: () => shouldEmit?.() !== false,
          lease,
          rootPath,
          sessionId: runtimeAuthority.sessionId,
          version: 1,
        });
      },
      workspaceFiles,
      workspaceOwnerRelativeFiles: {
        writeTextFileForWorkspaceRelativePath: ownerRelativeWorkspaceWrite,
      },
    });
    const saveResult = service.saveDocument(saveTarget).finally(() => {
      if (admission.status === "admitted") admission.settle();
    });
    let completed = false;
    return {
      complete: async () => {
        if (completed) return { status: "rejected" };
        completed = true;
        writeGate.resolve();
        return resultFor(admission.status, exact.content, await saveResult);
      },
      status: "prepared",
      writeIssued: writeIssued.promise,
      writtenContent: exact.content,
    };
  };
  const attemptSave = async (): Promise<EditorIncrementalProductionChainSaveAttempt> => {
    const prepared = beginDeferredSave();
    if (prepared.status !== "prepared") return prepared;
    await prepared.writeIssued;
    return await prepared.complete();
  };
  const replaceModel = (content: string): ProductionChainModel => {
    const previous = currentModel;
    modelFixture = createProductionChainModel(content, (length) => {
      logicalWork.fullTextReadCount += 1;
      logicalWork.fullTextReadUtf16Units += length;
    });
    currentModel = modelFixture.model;
    for (const editor of editors) {
      editor.replaceModel(
        currentModel,
        modelFixture.applyInsertion,
        modelFixture.applyReplacement,
        modelFixture.setContentChangeSink,
      );
    }
    previous.dispose();
    return currentModel;
  };

  return {
    acknowledgeCurrentModel: () =>
      runtimeContext.current?.acknowledgeExactLiveModelContent?.(
        groupName(0),
        PATH,
        currentModel,
      ) === true,
    activeSaveBinding: () => activeSaveBinding,
    attemptSave,
    authorities,
    beginDeferredSave,
    currentModel: () => currentModel,
    dirtyNotifications,
    diskWrite,
    editors,
    expectsExactOwnership:
      options.admitIncremental !== false &&
      initialContent.length <= DEFAULT_LIVE_DOCUMENT_CONTENT_LIMITS.maxDocumentUtf16Units,
    gateway,
    initialContent,
    initialRevision,
    isDirty: () => {
      const authority = authorities.get(groupName(0));
      return authority ? sidecar.documentDirty(authority) === true : false;
    },
    javaScriptTypeScriptDidSave,
    legacyDidChange,
    legacyFullPublication,
    model,
    monaco,
    ownerRelativeWorkspaceWrite,
    path: PATH,
    production,
    rawWorkspaceWrite,
    registeredIdentity,
    queueLegacyPublicationResults: (...results: boolean[]) => {
      queuedLegacyPublicationResults.push(...results);
    },
    saveLifecycleEvents: () => saveLifecycleEvents,
    logicalCounters: () => ({
      diskWriteCount: diskWrite.mock.calls.length,
      diskWriteUtf16Units: logicalWork.diskWriteUtf16Units,
      fullTextReadCount: logicalWork.fullTextReadCount,
      fullTextReadUtf16Units: logicalWork.fullTextReadUtf16Units,
      legacyPublicationCount: legacyFullPublication.mock.calls.length,
      legacyPublicationUtf16Units: logicalWork.legacyPublicationUtf16Units,
      ...gateway.logicalCounters(),
    }),
    replaceModel,
    renderWithDocumentContent,
    runtime,
    runtimeContext,
    savedRevision,
    sidecar,
    unsubscribeDirty,
    view,
  };
}

function ProductionChainSurface({
  document,
  editor,
  groupId,
  model,
  monaco,
  onModelContentChange,
  runtimeContext,
}: {
  readonly document: EditorDocument;
  readonly editor: Monaco.editor.IStandaloneCodeEditor;
  readonly groupId: string;
  readonly model: Monaco.editor.ITextModel;
  readonly monaco: typeof Monaco;
  readonly onModelContentChange: (content: string) => boolean;
  readonly runtimeContext: { current: EditorRuntimeContextValue | null };
}) {
  const runtime = useEditorRuntimeContext();
  runtimeContext.current = runtime;
  const documentRef = useRef(document);
  documentRef.current = document;
  const documentPath = document.path;
  const providerRefs = useMemo(() => providerRefsFor(documentRef), []);

  useEffect(() => {
    const registration: EditorRuntimeSurfaceRegistration = {
      activePath: documentPath,
      diagnosticsByPath: {},
      editor,
      groupId,
      monacoApi: monaco,
      onModelContentChange,
      providerDependencies: {
        featuresGateway: {} as never,
        monacoApi: monaco,
        workspaceRoot: ROOT,
      },
      retainPaths: [documentPath],
      routing: {
        activeDocumentRef: documentRef,
        javaScriptTypeScriptProviderContext: {
          featuresGateway: {} as never,
          flushPendingDocumentChange: async () => undefined,
          getActiveDocument: () => documentRef.current,
          getActiveJavaScriptTypeScriptOwnerEpoch: () =>
            runtime?.getActiveJavaScriptTypeScriptOwnerEpoch() ?? 0,
          getActiveJavaScriptTypeScriptOwnerIdentity: () =>
            runtime?.getActiveJavaScriptTypeScriptOwnerIdentity() ?? null,
          getDocumentSyncVersion: () => null,
          getLargeSmartDocumentPolicy: () => null as never,
          getRuntimeStatus: () => null,
          getWorkspaceRoot: () => ROOT,
          reportError: () => undefined,
        },
        providerRefs,
        resolveDocumentForModel: (candidate) => (candidate === model ? documentRef.current : null),
      },
      toMarker: () => ({
        endColumn: 1,
        endLineNumber: 1,
        message: "",
        severity: 4,
        startColumn: 1,
        startLineNumber: 1,
      }),
      typescriptJavascriptDefaults: {
        managedLanguageServerActive: false,
        validationEnabled: true,
      },
      workspaceIdentityDescriptor: null,
      workspaceRoot: ROOT,
    };
    return runtime?.registerSurface(groupId, registration);
  }, [documentPath, editor, groupId, model, monaco, onModelContentChange, providerRefs, runtime]);

  return null;
}

function ProductionChainActualEditorSurface({
  document,
  groupId,
  onModelContentChange,
  runtimeContext,
}: {
  readonly document: EditorDocument;
  readonly groupId: string;
  readonly onModelContentChange: (content: string) => boolean;
  readonly runtimeContext: { current: EditorRuntimeContextValue | null };
}) {
  const runtime = useEditorRuntimeContext();
  runtimeContext.current = runtime;
  const sourceDocumentRef = useRef(document);
  const [activeDocument, setActiveDocument] = useState(document);
  if (sourceDocumentRef.current !== document) {
    sourceDocumentRef.current = document;
    setActiveDocument(document);
  }
  const publish = (content: string): boolean => {
    const accepted = onModelContentChange(content);
    if (accepted) {
      setActiveDocument((current) => ({ ...current, content }));
    }
    return accepted;
  };

  return (
    <EditorSurface
      activeDocument={activeDocument}
      changeHunks={[]}
      editorRevealTarget={null}
      flushPendingLanguageServerDocument={async () => undefined}
      keymap={defaultKeymapSettings()}
      languageServerDiagnosticsByPath={{}}
      languageServerFeaturesGateway={{} as never}
      languageServerRuntimeStatus={null}
      largeSmartDocumentPolicy={{
        characterLimit: 10 * 1024 * 1024,
        lineLimit: 200_000,
      }}
      monacoTheme="calm-dark"
      onChange={publish}
      onCloseActiveTab={() => undefined}
      onCursorPositionChange={() => undefined}
      onEditorFocused={() => undefined}
      onGoBack={() => undefined}
      onGoForward={() => undefined}
      onGoToDefinition={() => undefined}
      onGoToImplementationAt={() => undefined}
      onGoToSuperMethod={() => undefined}
      onLanguageServerError={() => undefined}
      onOpenClass={() => undefined}
      onOpenFile={() => undefined}
      onOpenFileStructure={() => undefined}
      onRevealTargetHandled={() => undefined}
      onRevertChangeHunk={() => undefined}
      phpSyntaxDiagnosticsGateway={{ validate: async () => [] }}
      providePhpMethodCompletions={async () => []}
      providePhpMethodSignature={async () => null}
      runtimeMembership={{ groupId, retainPaths: [activeDocument.path] }}
      workspaceRoot={ROOT}
    />
  );
}

function createProductionChainModel(
  initialContent: string,
  onFullTextRead: (utf16Length: number) => void,
): {
  applyInsertion(text: string): Monaco.editor.IModelContentChangedEvent;
  applyReplacement(text: string, rangeLength?: number): Monaco.editor.IModelContentChangedEvent;
  readonly model: ProductionChainModel;
  setContentChangeSink(
    sink: ((event: Monaco.editor.IModelContentChangedEvent) => void) | null,
  ): void;
} {
  let alternativeVersionId = 1;
  let content = initialContent;
  let contentChangeSink: ((event: Monaco.editor.IModelContentChangedEvent) => void) | null = null;
  let disposed = false;
  let versionId = 1;
  const willDispose = new Set<() => void>();
  const model = {
    currentContent: () => content,
    deltaDecorations: vi.fn((_old: string[], decorations: unknown[]) =>
      decorations.map((_, index) => `model-decoration-${index}`),
    ),
    dispose: vi.fn(() => {
      disposed = true;
      for (const listener of [...willDispose]) listener();
    }),
    getAlternativeVersionId: vi.fn(() => alternativeVersionId),
    getEOL: vi.fn(() => "\n"),
    getLanguageId: vi.fn(() => "typescript"),
    getLineContent: vi.fn(() => content),
    getLineCount: vi.fn(() => 1),
    getLineLength: vi.fn(() => content.length),
    getLineMaxColumn: vi.fn(() => content.length + 1),
    getOptions: vi.fn(() => ({ indentSize: 2, insertSpaces: true, tabSize: 2 })),
    getValue: vi.fn(() => {
      onFullTextRead(content.length);
      return content;
    }),
    getValueLength: vi.fn(() => content.length),
    getVersionId: vi.fn(() => versionId),
    isDisposed: vi.fn(() => disposed),
    onWillDispose: vi.fn((listener: () => void) => {
      willDispose.add(listener);
      return { dispose: () => willDispose.delete(listener) };
    }),
    setValue: vi.fn((value: string) => {
      const previousLength = content.length;
      content = value;
      versionId += 1;
      alternativeVersionId += 1;
      contentChangeSink?.(replacementContentChangeEvent(versionId, previousLength, value));
    }),
    uri: URI.parse(workspaceModelUri(ROOT, PATH)!),
  } as unknown as ProductionChainModel;
  return {
    applyInsertion(text: string) {
      const rangeOffset = content.length;
      content += text;
      versionId += 1;
      alternativeVersionId += 1;
      return contentChangeEvent(versionId, rangeOffset, text);
    },
    applyReplacement(text: string, rangeLength = 1) {
      const boundedRangeLength = Math.min(Math.max(0, rangeLength), content.length);
      const rangeOffset = content.length - boundedRangeLength;
      content = `${content.slice(0, rangeOffset)}${text}${content.slice(
        rangeOffset + boundedRangeLength,
      )}`;
      versionId += 1;
      alternativeVersionId += 1;
      return replacementRangeContentChangeEvent(versionId, rangeOffset, boundedRangeLength, text);
    },
    model,
    setContentChangeSink(sink) {
      contentChangeSink = sink;
    },
  };
}

function createProductionChainEditor(
  model: ProductionChainModel,
  applyInsertion: (text: string) => Monaco.editor.IModelContentChangedEvent,
  applyReplacement: (text: string, rangeLength?: number) => Monaco.editor.IModelContentChangedEvent,
  setContentChangeSink: (
    sink: ((event: Monaco.editor.IModelContentChangedEvent) => void) | null,
  ) => void,
  index: number,
): ProductionChainEditor {
  let activeModel = model;
  let activeApplyInsertion = applyInsertion;
  let activeApplyReplacement = applyReplacement;
  let activeSetContentChangeSink = setContentChangeSink;
  const contentListeners = new Set<(event: Monaco.editor.IModelContentChangedEvent) => void>();
  const publishContentChange = (event: Monaco.editor.IModelContentChangedEvent) => {
    for (const contentListener of [...contentListeners]) contentListener(event);
  };
  const modelListeners = new Set<() => void>();
  const domNode = document.createElement("div");
  return {
    addAction: vi.fn(() => ({ dispose: () => undefined })),
    deltaDecorations: vi.fn((_old: string[], decorations: unknown[]) =>
      decorations.map((_, decorationIndex) => `editor-decoration-${decorationIndex}`),
    ),
    emitInsertion(text: string) {
      publishContentChange(activeApplyInsertion(text));
    },
    emitReplacement(text: string, rangeLength = 1) {
      publishContentChange(activeApplyReplacement(text, rangeLength));
    },
    executeEdits: vi.fn(),
    focus: vi.fn(),
    getContribution: vi.fn(() => ({ insert: vi.fn() })),
    getDomNode: vi.fn(() => domNode),
    getLayoutInfo: vi.fn(() => ({ contentLeft: 80, height: 480, width: 900 })),
    getModel: vi.fn(() => activeModel),
    getPosition: vi.fn(() => ({ column: 1, lineNumber: 1 })),
    getScrollTop: vi.fn(() => 0),
    getSelection: vi.fn(() => null),
    getTopForLineNumber: vi.fn((lineNumber: number) => lineNumber * 20),
    onDidChangeModel: vi.fn((next: () => void) => {
      modelListeners.add(next);
      return { dispose: () => modelListeners.delete(next) };
    }),
    onDidChangeModelContent: vi.fn(
      (next: (event: Monaco.editor.IModelContentChangedEvent) => void) => {
        contentListeners.add(next);
        activeSetContentChangeSink(publishContentChange);
        return {
          dispose: () => {
            contentListeners.delete(next);
            if (contentListeners.size === 0) activeSetContentChangeSink(null);
          },
        };
      },
    ),
    onDidChangeCursorPosition: vi.fn(() => ({ dispose: () => undefined })),
    onDidFocusEditorWidget: vi.fn(() => ({ dispose: () => undefined })),
    onDidScrollChange: vi.fn(() => ({ dispose: () => undefined })),
    onKeyDown: vi.fn(() => ({ dispose: () => undefined })),
    onMouseDown: vi.fn(() => ({ dispose: () => undefined })),
    onMouseMove: vi.fn(() => ({ dispose: () => undefined })),
    replaceModel(
      nextModel: ProductionChainModel,
      nextApplyInsertion: (text: string) => Monaco.editor.IModelContentChangedEvent,
      nextApplyReplacement: (
        text: string,
        rangeLength?: number,
      ) => Monaco.editor.IModelContentChangedEvent,
      nextSetContentChangeSink: (
        sink: ((event: Monaco.editor.IModelContentChangedEvent) => void) | null,
      ) => void,
    ) {
      activeSetContentChangeSink(null);
      activeModel = nextModel;
      activeApplyInsertion = nextApplyInsertion;
      activeApplyReplacement = nextApplyReplacement;
      activeSetContentChangeSink = nextSetContentChangeSink;
      if (contentListeners.size > 0) activeSetContentChangeSink(publishContentChange);
      for (const modelListener of [...modelListeners]) modelListener();
    },
    revealLineInCenter: vi.fn(),
    revealPositionInCenter: vi.fn(),
    setPosition: vi.fn(),
    setScrollTop: vi.fn(),
    setSelection: vi.fn(),
    trigger: vi.fn(),
    updateOptions: vi.fn(),
    __paneIndex: index,
  } as unknown as ProductionChainEditor;
}

function createProductionChainMonaco(currentModel: () => Monaco.editor.ITextModel): typeof Monaco {
  const disposable = () => ({ dispose: () => undefined });
  return {
    editor: {
      addCommand: vi.fn(disposable),
      defineTheme: vi.fn(),
      getModels: vi.fn(() => [currentModel()]),
      getModelMarkers: vi.fn(() => []),
      GlyphMarginLane: { Center: 2, Left: 1, Right: 3 },
      MouseTargetType: {
        CONTENT_TEXT: 6,
        GUTTER_GLYPH_MARGIN: 4,
        GUTTER_LINE_DECORATIONS: 3,
        GUTTER_LINE_NUMBERS: 2,
      },
      onDidChangeMarkers: vi.fn(() => ({ dispose: () => undefined })),
      OverviewRulerLane: { Left: 1, Right: 4 },
      setModelMarkers: vi.fn(),
      TrackedRangeStickiness: { NeverGrowsWhenTypingAtEdges: 1 },
    },
    KeyCode: {
      DownArrow: 11,
      Enter: 8,
      Escape: 9,
      F2: 60,
      F5: 63,
      F12: 69,
      UpArrow: 10,
    },
    KeyMod: { Alt: 512, CtrlCmd: 2048, Shift: 1024, WinCtrl: 4096 },
    languages: {
      CompletionItemInsertTextRule: { InsertAsSnippet: 4 },
      CompletionItemKind: { Method: 2, Text: 1, Variable: 6 },
      registerCodeActionProvider: vi.fn(disposable),
      registerCompletionItemProvider: vi.fn(disposable),
      registerHoverProvider: vi.fn(disposable),
      registerSelectionRangeProvider: vi.fn(disposable),
      registerSignatureHelpProvider: vi.fn(disposable),
      SignatureHelpTriggerKind: { Invoke: 1 },
    },
    MarkerSeverity: { Error: 8, Hint: 1, Info: 2, Warning: 4 },
    MarkerTag: { Deprecated: 2, Unnecessary: 1 },
    Range: class {
      constructor(
        readonly startLineNumber: number,
        readonly startColumn: number,
        readonly endLineNumber: number,
        readonly endColumn: number,
      ) {}
    },
  } as unknown as typeof Monaco;
}

function rejectedIncrementalPort() {
  return {
    attach: () => null,
    observe: () => ({ status: "legacy-required" as const }),
    reconciliationIdentity: () => Object.freeze({}),
    release: async () => undefined,
  };
}

function providerRefsFor(activeDocumentRef: {
  current: EditorDocument;
}): EditorRuntimeSurfaceRouting["providerRefs"] {
  return new Proxy({} as Record<string, { current: unknown }>, {
    get: (_target, property) =>
      property === "activeDocumentRef" ? activeDocumentRef : { current: vi.fn() },
  }) as unknown as EditorSurfaceLanguageProviderRegistrationRefs;
}

function contentChangeEvent(
  versionId: number,
  rangeOffset: number,
  text: string,
): Monaco.editor.IModelContentChangedEvent {
  return {
    changes: [
      {
        forceMoveMarkers: false,
        range: {
          endColumn: rangeOffset + 1,
          endLineNumber: 1,
          startColumn: rangeOffset + 1,
          startLineNumber: 1,
        },
        rangeLength: 0,
        rangeOffset,
        text,
      },
    ],
    eol: "\n",
    isEolChange: false,
    isFlush: false,
    isRedoing: false,
    isUndoing: false,
    versionId,
  } as unknown as Monaco.editor.IModelContentChangedEvent;
}

function replacementContentChangeEvent(
  versionId: number,
  previousLength: number,
  text: string,
): Monaco.editor.IModelContentChangedEvent {
  return {
    ...contentChangeEvent(versionId, 0, text),
    changes: [
      {
        forceMoveMarkers: false,
        range: {
          endColumn: previousLength + 1,
          endLineNumber: 1,
          startColumn: 1,
          startLineNumber: 1,
        },
        rangeLength: previousLength,
        rangeOffset: 0,
        text,
      },
    ],
    isFlush: true,
  } as unknown as Monaco.editor.IModelContentChangedEvent;
}

function replacementRangeContentChangeEvent(
  versionId: number,
  rangeOffset: number,
  rangeLength: number,
  text: string,
): Monaco.editor.IModelContentChangedEvent {
  return {
    ...contentChangeEvent(versionId, rangeOffset, text),
    changes: [
      {
        forceMoveMarkers: false,
        range: {
          endColumn: rangeOffset + rangeLength + 1,
          endLineNumber: 1,
          startColumn: rangeOffset + 1,
          startLineNumber: 1,
        },
        rangeLength,
        rangeOffset,
        text,
      },
    ],
  } as unknown as Monaco.editor.IModelContentChangedEvent;
}

function groupName(index: number): string {
  return `pane-${index + 1}`;
}

function validInitialUtf16Length(value: number): number {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new TypeError("initialUtf16Length must be a non-negative safe integer");
  }
  return value;
}

function workspaceRevision(contentHash: string, size: number): WorkspaceFileRevision {
  return {
    contentHash,
    device: "1",
    inode: "2",
    modifiedNanoseconds: 3,
    modifiedSeconds: 4,
    size,
  };
}

function deferred<T>(): {
  readonly promise: Promise<T>;
  resolve(value: T): void;
} {
  let resolvePromise!: (value: T) => void;
  const promise = new Promise<T>((resolve) => {
    resolvePromise = resolve;
  });
  return { promise, resolve: resolvePromise };
}
