import type {
  Dispatch,
  MutableRefObject,
  SetStateAction,
} from "react";
import type { EditorDocument } from "../domain/workspace";
import { workspaceRootKeysEqual } from "../domain/workspaceRootKey";

export interface ActiveDocumentSaveLease {
  isCurrent(): boolean;
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
  acknowledge(
    target: DocumentSaveTarget,
    acknowledgement: DocumentSaveAcknowledgement,
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

  acknowledge(
    target: DocumentSaveTarget,
    acknowledgement: DocumentSaveAcknowledgement,
  ): void {
    const liveDocument = this.current(target);
    if (!liveDocument) {
      return;
    }

    const acknowledgedDocument = this.acknowledgedDocument(
      liveDocument,
      acknowledgement,
    );
    this.dependencies.documentsRef.current = {
      ...this.dependencies.documentsRef.current,
      [target.path]: acknowledgedDocument,
    };
    if (!this.isCurrent(target)) {
      return;
    }
    if (this.dependencies.activeDocumentRef.current?.path === target.path) {
      this.dependencies.activeDocumentRef.current = acknowledgedDocument;
    }
    if (!this.isCurrent(target)) {
      return;
    }

    this.dependencies.setDocuments((current) => {
      if (!this.isCurrent(target)) {
        return current;
      }
      const existing = current[target.path];
      if (!existing) {
        return current;
      }

      return {
        ...current,
        [target.path]: this.acknowledgedDocument(existing, acknowledgement),
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

  private acknowledgedDocument(
    liveDocument: EditorDocument,
    acknowledgement: DocumentSaveAcknowledgement,
  ): EditorDocument {
    return {
      ...liveDocument,
      content:
        liveDocument === acknowledgement.expectedDocument &&
        liveDocument.content === acknowledgement.startingContent
          ? acknowledgement.savedDocument.content
          : liveDocument.content,
      savedContent: acknowledgement.savedDocument.content,
      revision: acknowledgement.revision,
    };
  }
}
