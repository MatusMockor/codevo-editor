import type { ResolvedEditorConfig } from "../domain/editorConfig";
import { applyEditorConfigOnSave } from "../domain/editorConfig";
import type {
  EditorDocument,
  WorkspaceFileGateway,
  WorkspaceTextFileSnapshot,
} from "../domain/workspace";
import { readWorkspaceTextFileSnapshot } from "../domain/workspace";
import type {
  ActiveDocumentSaveStorePort,
  ActiveDocumentSaveWritePermit,
  DocumentSaveTarget,
} from "./activeDocumentSaveStore";

export type {
  DocumentSaveAcknowledgement,
  DocumentSaveTarget,
} from "./activeDocumentSaveStore";

export type DocumentSaveResult =
  | {
      status: "saved";
      document: EditorDocument;
      contentIsCurrent: boolean;
    }
  | {
      status: "blocked";
      reason: "readOnly" | "external";
      silent?: boolean;
    }
  | {
      status: "conflict";
      document: EditorDocument;
      snapshot: WorkspaceTextFileSnapshot | null;
    }
  | { status: "partial"; error: Error }
  | { status: "failed"; error: unknown }
  | { status: "stale" };

export interface DocumentSaveServiceDependencies {
  workspaceFiles: WorkspaceFileGateway;
  saveStore: ActiveDocumentSaveStorePort;
  invalidatePrefetch: (path: string) => void;
  captureLocalHistorySnapshot: (
    rootPath: string,
    path: string,
    content: string,
  ) => Promise<void>;
  formattedContentForSave: (
    document: EditorDocument,
    rootPath: string,
  ) => Promise<string>;
  optimizedImportsContentForSave: (
    document: EditorDocument,
    content: string,
  ) => string;
  organizedImportsContentForSave: (
    document: EditorDocument,
    content: string,
    rootPath: string,
  ) => Promise<string>;
  resolveEditorConfigForFile: (
    rootPath: string,
    path: string,
  ) => Promise<ResolvedEditorConfig>;
  syncSavedDocument: (
    rootPath: string,
    document: EditorDocument,
    shouldEmit?: () => boolean,
  ) => Promise<void>;
  syncSavedJavaScriptTypeScriptDocument: (
    rootPath: string,
    document: EditorDocument,
    shouldEmit?: () => boolean,
  ) => Promise<void>;
  hasExternalFileConflict: (rootPath: string, path: string) => boolean;
}

/** Owns one root-explicit save transaction without depending on React. */
export class DocumentSaveService {
  constructor(private readonly dependencies: DocumentSaveServiceDependencies) {}

  async saveDocument(target: DocumentSaveTarget): Promise<DocumentSaveResult> {
    const currentDocument = (): EditorDocument | null => {
      return this.dependencies.saveStore.current(target);
    };

    try {
      let documentToTransform = currentDocument();
      if (!documentToTransform) {
        return { status: "stale" };
      }
      if (documentToTransform.readOnly) {
        return {
          status: "blocked",
          reason: "readOnly",
        };
      }
      if (this.hasExternalConflict(target)) {
        return {
          status: "blocked",
          reason: "external",
        };
      }

      while (true) {
        if (documentToTransform.readOnly) {
          return {
            status: "blocked",
            reason: "readOnly",
          };
        }
        const prepared = await this.prepareDocument(
          target,
          documentToTransform,
          currentDocument,
        );
        if (prepared.status !== "prepared") {
          return prepared.result;
        }
        if (prepared.liveDocument !== documentToTransform) {
          documentToTransform = prepared.liveDocument;
          continue;
        }

        const acceptedDocument = this.preparationGuard(
          target,
          currentDocument,
        );
        if (acceptedDocument.status !== "continue") {
          return acceptedDocument.result;
        }
        if (acceptedDocument.document !== documentToTransform) {
          documentToTransform = acceptedDocument.document;
          continue;
        }

        return await this.writePreparedDocument(
          target,
          documentToTransform,
          prepared.document,
          currentDocument,
        );
      }
    } catch (error) {
      if (!currentDocument()) {
        return { status: "stale" };
      }

      return { status: "failed", error };
    }
  }

  private async prepareDocument(
    target: DocumentSaveTarget,
    document: EditorDocument,
    currentDocument: () => EditorDocument | null,
  ): Promise<
    | {
        status: "prepared";
        document: EditorDocument;
        liveDocument: EditorDocument;
      }
    | { status: "stopped"; result: DocumentSaveResult }
  > {
    const formattedContent = await this.dependencies.formattedContentForSave(
      document,
      target.rootPath,
    );
    const afterFormat = this.preparationGuard(target, currentDocument);
    if (afterFormat.status !== "continue") {
      return { status: "stopped", result: afterFormat.result };
    }
    if (afterFormat.document !== document) {
      return {
        status: "prepared",
        document,
        liveDocument: afterFormat.document,
      };
    }

    const optimizedContent =
      this.dependencies.optimizedImportsContentForSave(
        document,
        formattedContent,
      );
    const organizedContent =
      await this.dependencies.organizedImportsContentForSave(
        document,
        optimizedContent,
        target.rootPath,
      );
    const afterImports = this.preparationGuard(target, currentDocument);
    if (afterImports.status !== "continue") {
      return { status: "stopped", result: afterImports.result };
    }
    if (afterImports.document !== document) {
      return {
        status: "prepared",
        document,
        liveDocument: afterImports.document,
      };
    }

    const editorConfig =
      await this.dependencies.resolveEditorConfigForFile(
        target.rootPath,
        document.path,
      );
    const afterEditorConfig = this.preparationGuard(target, currentDocument);
    if (afterEditorConfig.status !== "continue") {
      return { status: "stopped", result: afterEditorConfig.result };
    }

    return {
      status: "prepared",
      document: {
        ...document,
        content: applyEditorConfigOnSave(organizedContent, editorConfig),
      },
      liveDocument: afterEditorConfig.document,
    };
  }

  private preparationGuard(
    target: DocumentSaveTarget,
    currentDocument: () => EditorDocument | null,
  ):
    | { status: "continue"; document: EditorDocument }
    | { status: "stop"; result: DocumentSaveResult } {
    const document = currentDocument();
    if (!document) {
      return { status: "stop", result: { status: "stale" } };
    }
    if (document.readOnly) {
      return {
        status: "stop",
        result: {
          status: "blocked",
          reason: "readOnly",
        },
      };
    }
    if (this.hasExternalConflict(target)) {
      return {
        status: "stop",
        result: {
          status: "blocked",
          reason: "external",
        },
      };
    }

    return { status: "continue", document };
  }

  private async writePreparedDocument(
    target: DocumentSaveTarget,
    expectedDocument: EditorDocument,
    savedDocument: EditorDocument,
    currentDocument: () => EditorDocument | null,
  ): Promise<DocumentSaveResult> {
    const liveDocumentBeforeWrite = currentDocument();
    if (!liveDocumentBeforeWrite) {
      return { status: "stale" };
    }
    if (liveDocumentBeforeWrite.readOnly) {
      return {
        status: "blocked",
        reason: "readOnly",
      };
    }
    if (liveDocumentBeforeWrite !== expectedDocument) {
      return { status: "stale" };
    }
    if (this.hasExternalConflict(target)) {
      return {
        status: "blocked",
        reason: "external",
      };
    }

    const writePermit = this.tryBeginWrite(target);
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

    try {
      return await this.writeIssuedDocument(
        target,
        expectedDocument,
        savedDocument,
        currentDocument,
        settleWritePermit,
      );
    } finally {
      settleWritePermit();
    }
  }

  private async writeIssuedDocument(
    target: DocumentSaveTarget,
    expectedDocument: EditorDocument,
    savedDocument: EditorDocument,
    currentDocument: () => EditorDocument | null,
    settleWritePermit: () => void,
  ): Promise<DocumentSaveResult> {
    const writeResult = expectedDocument.revision
      ? await this.dependencies.workspaceFiles.writeTextFile(
          savedDocument.path,
          savedDocument.content,
          expectedDocument.revision,
        )
      : await this.dependencies.workspaceFiles.writeTextFile(
          savedDocument.path,
          savedDocument.content,
        );

    if (writeResult?.status === "conflict") {
      settleWritePermit();
      return await this.readConflict(target, currentDocument);
    }
    if (writeResult?.status === "error") {
      settleWritePermit();
      return { status: "failed", error: new Error(writeResult.message) };
    }
    if (writeResult?.status === "partial") {
      this.dependencies.saveStore.updateRevisionForIssuedWrite(
        target,
        expectedDocument,
        writeResult.revision,
      );
      settleWritePermit();
      if (!currentDocument()) {
        return { status: "stale" };
      }
      return {
        status: "partial",
        error: new Error(
          `The file was saved, but durability could not be confirmed: ${writeResult.message}`,
        ),
      };
    }

    if (this.hasExternalConflict(target)) {
      settleWritePermit();
      return {
        status: "blocked",
        reason: "external",
        silent: true,
      };
    }

    this.dependencies.saveStore.acknowledgeIssuedWrite(target, {
      expectedDocument,
      revision:
        writeResult?.status === "success"
          ? writeResult.revision
          : expectedDocument.revision,
      savedDocument,
      startingContent: expectedDocument.content,
    });
    settleWritePermit();
    if (!currentDocument()) {
      return { status: "stale" };
    }
    this.dependencies.invalidatePrefetch(savedDocument.path);
    if (!currentDocument()) {
      return { status: "stale" };
    }
    await this.dependencies.captureLocalHistorySnapshot(
      target.rootPath,
      savedDocument.path,
      savedDocument.content,
    );

    const isWrittenDocumentCurrent = () =>
      currentDocument()?.content === savedDocument.content;
    if (!isWrittenDocumentCurrent()) {
      return {
        status: "saved",
        document: savedDocument,
        contentIsCurrent: false,
      };
    }
    await this.dependencies.syncSavedDocument(
      target.rootPath,
      savedDocument,
      isWrittenDocumentCurrent,
    );
    if (!isWrittenDocumentCurrent()) {
      return {
        status: "saved",
        document: savedDocument,
        contentIsCurrent: false,
      };
    }
    await this.dependencies.syncSavedJavaScriptTypeScriptDocument(
      target.rootPath,
      savedDocument,
      isWrittenDocumentCurrent,
    );
    if (!isWrittenDocumentCurrent()) {
      return {
        status: "saved",
        document: savedDocument,
        contentIsCurrent: false,
      };
    }

    return {
      status: "saved",
      document: savedDocument,
      contentIsCurrent: true,
    };
  }

  private tryBeginWrite(
    target: DocumentSaveTarget,
  ): ActiveDocumentSaveWritePermit | null {
    return target.lease.tryBeginWrite();
  }

  private async readConflict(
    target: DocumentSaveTarget,
    currentDocument: () => EditorDocument | null,
  ): Promise<DocumentSaveResult> {
    let snapshot: WorkspaceTextFileSnapshot | null = null;
    try {
      snapshot = await readWorkspaceTextFileSnapshot(
        this.dependencies.workspaceFiles,
        target.path,
      );
    } catch {
      // A null snapshot keeps the conflict retryable when the disk read fails.
    }

    const document = currentDocument();
    if (!document) {
      return { status: "stale" };
    }

    return { status: "conflict", document, snapshot };
  }

  private hasExternalConflict(target: DocumentSaveTarget): boolean {
    return this.dependencies.hasExternalFileConflict(
      target.rootPath,
      target.path,
    );
  }
}
