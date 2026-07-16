import type { ResolvedEditorConfig } from "../domain/editorConfig";
import type { WorkspaceSettings } from "../domain/settings";
import type { EditorDocument, WorkspaceFileGateway } from "../domain/workspace";
import type { WorkspaceRuntimeOwner } from "../domain/workspaceRuntimeOwner";
import type { ActiveDocumentSaveLease } from "./activeDocumentSaveStore";
import {
  DocumentSaveService,
  type DocumentSaveResult,
} from "./documentSaveService";
import {
  type CapturedOwnerDocumentSaveTarget,
  OwnerDocumentSaveRepository,
} from "./ownerDocumentSaveRepository";
import type { DocumentSelfWriteLease } from "./documentSelfWriteCoordinator";

export interface OwnerDocumentSavePipeline {
  readonly workspaceFiles: WorkspaceFileGateway;
  readonly settings: WorkspaceSettings;
  invalidatePrefetch(owner: WorkspaceRuntimeOwner, path: string): void;
  captureLocalHistorySnapshot(
    owner: WorkspaceRuntimeOwner,
    rootPath: string,
    path: string,
    content: string,
  ): Promise<void>;
  formattedContentForSave(
    owner: WorkspaceRuntimeOwner,
    rootPath: string,
    settings: WorkspaceSettings,
    document: EditorDocument,
  ): Promise<string>;
  optimizedImportsContentForSave(
    owner: WorkspaceRuntimeOwner,
    rootPath: string,
    settings: WorkspaceSettings,
    document: EditorDocument,
    content: string,
  ): string;
  organizedImportsContentForSave(
    owner: WorkspaceRuntimeOwner,
    rootPath: string,
    settings: WorkspaceSettings,
    document: EditorDocument,
    content: string,
  ): Promise<string>;
  resolveEditorConfigForFile(
    owner: WorkspaceRuntimeOwner,
    rootPath: string,
    path: string,
  ): Promise<ResolvedEditorConfig>;
  syncSavedDocument(
    owner: WorkspaceRuntimeOwner,
    rootPath: string,
    document: EditorDocument,
    shouldEmit: () => boolean,
  ): Promise<void>;
  syncSavedJavaScriptTypeScriptDocument(
    owner: WorkspaceRuntimeOwner,
    rootPath: string,
    document: EditorDocument,
    shouldEmit: () => boolean,
  ): Promise<void>;
  hasExternalFileConflict(
    owner: WorkspaceRuntimeOwner,
    rootPath: string,
    path: string,
  ): boolean;
  beginDocumentSelfWrite(
    owner: WorkspaceRuntimeOwner,
    rootPath: string,
    path: string,
    content: string,
  ): DocumentSelfWriteLease | null;
}

export type ResolveOwnerDocumentSavePipeline = (
  owner: WorkspaceRuntimeOwner,
  rootPath: string,
) => OwnerDocumentSavePipeline | null;

export interface OwnerResolvingDocumentSaveServiceDependencies {
  repository: OwnerDocumentSaveRepository;
  resolvePipeline: ResolveOwnerDocumentSavePipeline;
}

export interface OwnerDocumentSaveRequest {
  readonly target: CapturedOwnerDocumentSaveTarget;
  readonly lease: ActiveDocumentSaveLease;
}

/** Runs the existing save semantics against an owner-resolved repository. */
export class OwnerResolvingDocumentSaveService {
  constructor(
    private readonly dependencies: OwnerResolvingDocumentSaveServiceDependencies,
  ) {}

  async saveDocument(
    request: OwnerDocumentSaveRequest,
  ): Promise<DocumentSaveResult> {
    const repository = this.dependencies.repository.resolve(request.target);
    if (!repository) {
      return { status: "stale" };
    }
    const pipeline = this.dependencies.resolvePipeline(
      repository.owner,
      repository.rootPath,
    );
    if (!pipeline || !repository.isCurrent()) {
      return { status: "stale" };
    }

    const { owner, rootPath } = repository;
    const { settings } = pipeline;
    const lease = {
      isCurrent: () => request.lease.isCurrent() && repository.isCurrent(),
      tryBeginWrite: () => {
        if (!repository.isCurrent()) {
          return null;
        }

        return request.lease.tryBeginWrite();
      },
    };
    const service = new DocumentSaveService({
      workspaceFiles: pipeline.workspaceFiles,
      saveStore: repository.saveStore,
      invalidatePrefetch: (path) => pipeline.invalidatePrefetch(owner, path),
      captureLocalHistorySnapshot: (requestedRoot, path, content) =>
        pipeline.captureLocalHistorySnapshot(
          owner,
          requestedRoot,
          path,
          content,
        ),
      formattedContentForSave: (document, requestedRoot) =>
        pipeline.formattedContentForSave(
          owner,
          requestedRoot,
          settings,
          document,
        ),
      optimizedImportsContentForSave: (document, content) =>
        pipeline.optimizedImportsContentForSave(
          owner,
          rootPath,
          settings,
          document,
          content,
        ),
      organizedImportsContentForSave: (document, content, requestedRoot) =>
        pipeline.organizedImportsContentForSave(
          owner,
          requestedRoot,
          settings,
          document,
          content,
        ),
      resolveEditorConfigForFile: (requestedRoot, path) =>
        pipeline.resolveEditorConfigForFile(
          owner,
          requestedRoot,
          path,
        ),
      syncSavedDocument: (requestedRoot, document, shouldEmit) =>
        pipeline.syncSavedDocument(
          owner,
          requestedRoot,
          document,
          shouldEmit ?? repository.isCurrent,
        ),
      syncSavedJavaScriptTypeScriptDocument: (
        requestedRoot,
        document,
        shouldEmit,
      ) =>
        pipeline.syncSavedJavaScriptTypeScriptDocument(
          owner,
          requestedRoot,
          document,
          shouldEmit ?? repository.isCurrent,
        ),
      hasExternalFileConflict: (requestedRoot, path) =>
        pipeline.hasExternalFileConflict(owner, requestedRoot, path),
      beginDocumentSelfWrite: (requestedRoot, path, content) =>
        pipeline.beginDocumentSelfWrite(
          owner,
          requestedRoot,
          path,
          content,
        ),
    });

    return service.saveDocument({
      rootPath,
      path: repository.path,
      workspaceRequestToken: 0,
      lease,
    });
  }
}
