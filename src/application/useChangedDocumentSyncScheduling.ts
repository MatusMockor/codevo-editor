import { useEffect, type MutableRefObject } from "react";
import type { EditorDocument } from "../domain/workspace";

interface ChangedDocumentSyncSchedulingDependencies {
  documentsRef: MutableRefObject<Record<string, EditorDocument>>;
  scheduleDocumentChange: (document: EditorDocument) => void;
  scheduleJavaScriptTypeScriptDocumentChange: (
    document: EditorDocument,
  ) => void;
  subscribeChangedDocuments: (
    listener: (paths: readonly string[]) => void,
  ) => () => void;
}

export function useChangedDocumentSyncScheduling({
  documentsRef,
  scheduleDocumentChange,
  scheduleJavaScriptTypeScriptDocumentChange,
  subscribeChangedDocuments,
}: ChangedDocumentSyncSchedulingDependencies): void {
  useEffect(
    () =>
      subscribeChangedDocuments((paths) => {
        paths.forEach((path) => {
          const document = documentsRef.current[path];
          if (!document) {
            return;
          }

          scheduleDocumentChange(document);
          scheduleJavaScriptTypeScriptDocumentChange(document);
        });
      }),
    [
      documentsRef,
      scheduleDocumentChange,
      scheduleJavaScriptTypeScriptDocumentChange,
      subscribeChangedDocuments,
    ],
  );
}
