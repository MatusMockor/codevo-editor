import { useEffect, type MutableRefObject } from "react";
import type { EditorDocument } from "../domain/workspace";
import type { JavaScriptTypeScriptIncrementalLegacyClaim } from "./javaScriptTypeScriptIncrementalSyncProduction";

interface JavaScriptTypeScriptIncrementalClaimSource {
  claimLegacyChange(path: string): JavaScriptTypeScriptIncrementalLegacyClaim | null;
}

interface ChangedDocumentSyncSchedulingDependencies {
  documentsRef: MutableRefObject<Record<string, EditorDocument>>;
  incrementalSyncRef?: MutableRefObject<JavaScriptTypeScriptIncrementalClaimSource | null>;
  scheduleDocumentChange: (document: EditorDocument) => void;
  scheduleJavaScriptTypeScriptDocumentChange: (document: EditorDocument) => void;
  subscribeChangedDocuments: (listener: (paths: readonly string[]) => void) => () => void;
}

export function useChangedDocumentSyncScheduling({
  documentsRef,
  incrementalSyncRef,
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
          const claim = incrementalSyncRef?.current?.claimLegacyChange(path) ?? null;
          if (!claim) {
            scheduleJavaScriptTypeScriptDocumentChange(document);
            return;
          }
          void claim.suppressLegacy().then((suppress) => {
            if (suppress) return;
            const latest = documentsRef.current[path];
            if (latest) scheduleJavaScriptTypeScriptDocumentChange(latest);
          });
        });
      }),
    [
      documentsRef,
      incrementalSyncRef,
      scheduleDocumentChange,
      scheduleJavaScriptTypeScriptDocumentChange,
      subscribeChangedDocuments,
    ],
  );
}
