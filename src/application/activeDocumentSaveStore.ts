import type {
  Dispatch,
  MutableRefObject,
  SetStateAction,
} from "react";
import type { EditorDocument } from "../domain/workspace";
import { workspaceRootKeysEqual } from "../domain/workspaceRootKey";

export interface ActiveDocumentSaveLease {
  isCurrent(): boolean;
  tryBeginWrite(): ActiveDocumentSaveWritePermit | null;
}

export interface ActiveDocumentSaveWritePermit {
  readonly granted: true;
  settle(): void;
}

export interface DocumentSaveTarget {
  readonly rootPath: string;
  readonly path: string;
  readonly workspaceRequestToken: number;
  readonly lease: ActiveDocumentSaveLease;
}

export interface DocumentSaveAcknowledgement {
  readonly expectedDocument: EditorDocument;
  readonly savedDocument: EditorDocument;
  readonly startingContent: string;
  readonly revision: EditorDocument["revision"];
}

export interface ActiveDocumentSaveStorePort {
  current(target: DocumentSaveTarget): EditorDocument | null;
  reconcileUnchangedPreparedContent?(
    target: DocumentSaveTarget,
    expectedDocument: EditorDocument,
    preparedContent: string,
  ): EditorDocument | null;
  acknowledgeIssuedWrite(
    target: DocumentSaveTarget,
    acknowledgement: DocumentSaveAcknowledgement,
  ): void;
  updateRevisionForIssuedWrite(
    target: DocumentSaveTarget,
    expectedDocument: EditorDocument,
    revision: EditorDocument["revision"],
  ): void;
  updateRevision(
    target: DocumentSaveTarget,
    revision: EditorDocument["revision"],
  ): void;
}

export interface ActiveDocumentSaveStoreDependencies {
  currentWorkspaceRootRef: MutableRefObject<string | null>;
  workspaceRequestTokenRef: MutableRefObject<number>;
  activeDocumentRef: MutableRefObject<EditorDocument | null>;
  documentsRef: MutableRefObject<Record<string, EditorDocument>>;
  setDocuments: Dispatch<SetStateAction<Record<string, EditorDocument>>>;
}

export class ActiveDocumentSaveStore implements ActiveDocumentSaveStorePort {
  constructor(
    private readonly dependencies: ActiveDocumentSaveStoreDependencies,
  ) {}

  current(target: DocumentSaveTarget): EditorDocument | null {
    if (!this.isCurrent(target)) {
      return null;
    }

    return this.dependencies.documentsRef.current[target.path] ?? null;
  }

  reconcileUnchangedPreparedContent(
    target: DocumentSaveTarget,
    expectedDocument: EditorDocument,
    preparedContent: string,
  ): EditorDocument | null {
    if (!this.isCurrent(target)) {
      return null;
    }
    const liveDocument = this.dependencies.documentsRef.current[target.path];
    if (liveDocument !== expectedDocument) {
      return null;
    }
    if (liveDocument.path !== target.path) {
      return null;
    }
    if (preparedContent !== liveDocument.savedContent) {
      return null;
    }
    if (liveDocument.content === preparedContent) {
      return liveDocument;
    }

    const reconciledDocument = {
      ...liveDocument,
      content: preparedContent,
    };
    this.dependencies.documentsRef.current = {
      ...this.dependencies.documentsRef.current,
      [target.path]: reconciledDocument,
    };
    if (this.dependencies.activeDocumentRef.current === liveDocument) {
      this.dependencies.activeDocumentRef.current = reconciledDocument;
    }
    this.dependencies.setDocuments((current) => {
      if (!this.isCurrent(target)) {
        return current;
      }
      if (current[target.path] !== liveDocument) {
        return current;
      }

      return {
        ...current,
        [target.path]: reconciledDocument,
      };
    });

    return reconciledDocument;
  }

  acknowledgeIssuedWrite(
    target: DocumentSaveTarget,
    acknowledgement: DocumentSaveAcknowledgement,
  ): void {
    const requestIsCurrent = this.isCurrent(target);
    const liveDocument = this.issuedWriteDocument(
      target,
      acknowledgement.expectedDocument,
    );
    if (!liveDocument) {
      return;
    }

    const acknowledgedDocument = this.acknowledgedDocument(
      liveDocument,
      acknowledgement,
    );
    if (acknowledgedDocument === liveDocument) {
      return;
    }

    this.dependencies.documentsRef.current = {
      ...this.dependencies.documentsRef.current,
      [target.path]: acknowledgedDocument,
    };
    if (this.dependencies.activeDocumentRef.current === liveDocument) {
      this.dependencies.activeDocumentRef.current = acknowledgedDocument;
    }
    if (!this.isSameRoot(target)) {
      return;
    }

    this.dependencies.setDocuments((current) => {
      if (requestIsCurrent && !this.isCurrent(target)) {
        return current;
      }
      const existing = current[target.path];
      if (!existing) {
        return current;
      }
      if (
        !requestIsCurrent &&
        existing !== acknowledgedDocument &&
        !this.isSameDocumentIncarnation(
          existing,
          acknowledgement.expectedDocument,
        )
      ) {
        return current;
      }

      return {
        ...current,
        [target.path]: this.acknowledgedDocument(existing, acknowledgement),
      };
    });
  }

  updateRevisionForIssuedWrite(
    target: DocumentSaveTarget,
    expectedDocument: EditorDocument,
    revision: EditorDocument["revision"],
  ): void {
    const requestIsCurrent = this.isCurrent(target);
    const liveDocument = this.issuedWriteDocument(target, expectedDocument);
    if (!liveDocument || liveDocument.revision === revision) {
      return;
    }

    const revisedDocument = { ...liveDocument, revision };
    this.dependencies.documentsRef.current = {
      ...this.dependencies.documentsRef.current,
      [target.path]: revisedDocument,
    };
    if (this.dependencies.activeDocumentRef.current === liveDocument) {
      this.dependencies.activeDocumentRef.current = revisedDocument;
    }
    if (!this.isSameRoot(target)) {
      return;
    }

    this.dependencies.setDocuments((current) => {
      if (requestIsCurrent && !this.isCurrent(target)) {
        return current;
      }
      const existing = current[target.path];
      if (!existing) {
        return current;
      }
      if (
        !requestIsCurrent &&
        existing !== revisedDocument &&
        existing !== liveDocument &&
        !this.isSameDocumentIncarnation(existing, expectedDocument)
      ) {
        return current;
      }
      if (existing.revision === revision) {
        return current;
      }

      return {
        ...current,
        [target.path]: { ...existing, revision },
      };
    });
  }

  updateRevision(
    target: DocumentSaveTarget,
    revision: EditorDocument["revision"],
  ): void {
    const existing = this.current(target);
    if (!existing) {
      return;
    }

    const recoveredDocument = { ...existing, revision };
    this.dependencies.documentsRef.current = {
      ...this.dependencies.documentsRef.current,
      [target.path]: recoveredDocument,
    };
    if (this.dependencies.activeDocumentRef.current?.path === target.path) {
      this.dependencies.activeDocumentRef.current = recoveredDocument;
    }
    this.dependencies.setDocuments((current) => {
      const currentDocument = current[target.path];
      if (!currentDocument || !this.isCurrent(target)) {
        return current;
      }

      return {
        ...current,
        [target.path]: { ...currentDocument, revision },
      };
    });
  }

  private isCurrent(target: DocumentSaveTarget): boolean {
    return (
      target.lease.isCurrent() &&
      this.dependencies.workspaceRequestTokenRef.current ===
        target.workspaceRequestToken &&
      workspaceRootKeysEqual(
        this.dependencies.currentWorkspaceRootRef.current,
        target.rootPath,
      )
    );
  }

  private issuedWriteDocument(
    target: DocumentSaveTarget,
    expectedDocument: EditorDocument,
  ): EditorDocument | null {
    const liveDocument =
      this.dependencies.documentsRef.current[target.path] ?? null;
    if (!liveDocument) {
      return null;
    }
    if (this.isCurrent(target)) {
      return liveDocument;
    }
    if (!target.lease.isCurrent()) {
      return null;
    }
    if (!this.isSameRoot(target)) {
      return null;
    }
    if (
      !this.isSameDocumentIncarnation(liveDocument, expectedDocument)
    ) {
      return null;
    }

    return liveDocument;
  }

  private isSameRoot(target: DocumentSaveTarget): boolean {
    return workspaceRootKeysEqual(
      this.dependencies.currentWorkspaceRootRef.current,
      target.rootPath,
    );
  }

  private isSameDocumentIncarnation(
    liveDocument: EditorDocument,
    expectedDocument: EditorDocument,
  ): boolean {
    if (liveDocument === expectedDocument) {
      return true;
    }

    return (
      liveDocument.savedContent === expectedDocument.savedContent &&
      liveDocument.revision === expectedDocument.revision
    );
  }

  private acknowledgedDocument(
    liveDocument: EditorDocument,
    acknowledgement: DocumentSaveAcknowledgement,
  ): EditorDocument {
    const content =
      liveDocument === acknowledgement.expectedDocument &&
      liveDocument.content === acknowledgement.startingContent
        ? acknowledgement.savedDocument.content
        : liveDocument.content;
    if (
      content === liveDocument.content &&
      acknowledgement.savedDocument.content === liveDocument.savedContent &&
      acknowledgement.revision === liveDocument.revision
    ) {
      return liveDocument;
    }

    return {
      ...liveDocument,
      content,
      savedContent: acknowledgement.savedDocument.content,
      revision: acknowledgement.revision,
    };
  }
}
