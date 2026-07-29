import type { MutableRefObject } from "react";
import {
  createLanguageServerTextDocument,
  type LanguageServerDocumentSyncGateway,
  type LanguageServerTextDocument,
} from "../domain/languageServerDocumentSync";
import type { EditorDocument } from "../domain/workspace";

export interface LegacyFullTextDocumentSave {
  readonly document: EditorDocument;
  enqueue(operation: () => Promise<void>, retainedPayloads: readonly string[]): Promise<void>;
  flush(): Promise<void>;
  readonly gateway: LanguageServerDocumentSyncGateway;
  isCurrent(): boolean;
  issueVersion(): number;
  readonly pendingChangesRef: MutableRefObject<Record<string, LanguageServerTextDocument>>;
  report(error: unknown): void;
  readonly rootPath: string;
  readonly sessionId: number;
  readonly syncKey: string;
  readonly syncedContentRef: MutableRefObject<Record<string, string>>;
  readonly versionsRef: MutableRefObject<Record<string, number>>;
}

/** Converges and saves a legacy full-text document with exact payload admission. */
export async function syncLegacyFullTextDocumentSave({
  document,
  enqueue,
  flush,
  gateway,
  isCurrent,
  issueVersion,
  pendingChangesRef,
  report,
  rootPath,
  sessionId,
  syncKey,
  syncedContentRef,
  versionsRef,
}: LegacyFullTextDocumentSave): Promise<void> {
  const isSavedContentCurrent = () =>
    isCurrent() && syncedContentRef.current[syncKey] === document.content;
  try {
    await flush();
    if (!isCurrent()) return;
    await enqueue(async () => {
      if (!isCurrent()) return;
      if (syncedContentRef.current[syncKey] !== document.content) {
        const previousSyncedContent = syncedContentRef.current[syncKey];
        const version = issueVersion();
        const syncedDocument = createLanguageServerTextDocument(document, version);
        try {
          await gateway.didChange(rootPath, syncedDocument, sessionId);
        } catch (error) {
          if (
            isCurrent() &&
            versionsRef.current[syncKey] === version &&
            pendingChangesRef.current[syncKey] === undefined
          ) {
            pendingChangesRef.current[syncKey] = {
              ...syncedDocument,
              version: issueVersion(),
            };
          }
          throw error;
        }
        if (
          !isCurrent() ||
          versionsRef.current[syncKey] !== version ||
          syncedContentRef.current[syncKey] !== previousSyncedContent
        ) {
          return;
        }
        syncedContentRef.current[syncKey] = document.content;
      }
      if (!isSavedContentCurrent()) return;
      await gateway.didSave(
        rootPath,
        createLanguageServerTextDocument(document, versionsRef.current[syncKey] || 0),
        sessionId,
      );
    }, [document.content, document.savedContent]);
  } catch (error) {
    if (isCurrent()) report(error);
  }
}
