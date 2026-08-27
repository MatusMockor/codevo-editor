import { useEffect, type MutableRefObject } from "react";
import type { EditorDocument } from "../domain/workspace";
import type { JavaScriptTypeScriptIncrementalLegacyClaim } from "./javaScriptTypeScriptIncrementalSyncProduction";

interface JavaScriptTypeScriptIncrementalClaimSource {
  claimLegacyChange(path: string): JavaScriptTypeScriptIncrementalLegacyClaim | null;
}

export interface ChangedDocumentSyncSchedulingAuthority {
  isCurrent(document: EditorDocument): boolean;
}

export interface ChangedDocumentSyncSchedulingDependencies {
  captureAuthority(document: EditorDocument): ChangedDocumentSyncSchedulingAuthority | null;
  documentsRef: MutableRefObject<Record<string, EditorDocument>>;
  incrementalSyncRef?: MutableRefObject<JavaScriptTypeScriptIncrementalClaimSource | null>;
  scheduleDocumentChange: (document: EditorDocument) => void;
  scheduleJavaScriptTypeScriptDocumentChange: (document: EditorDocument) => void;
  subscribeChangedDocuments: (listener: (paths: readonly string[]) => void) => () => void;
}

export function useChangedDocumentSyncScheduling({
  captureAuthority,
  documentsRef,
  incrementalSyncRef,
  scheduleDocumentChange,
  scheduleJavaScriptTypeScriptDocumentChange,
  subscribeChangedDocuments,
}: ChangedDocumentSyncSchedulingDependencies): void {
  useEffect(() => {
    let active = true;
    const epochByPath = new Map<string, number>();
    const unsubscribe = subscribeChangedDocuments((paths) => {
      paths.forEach((path) => {
        const epoch = (epochByPath.get(path) ?? 0) + 1;
        epochByPath.set(path, epoch);
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
        const authority = captureAuthority(document);
        if (!authority) {
          return;
        }
        void claim.suppressLegacy().then((suppress) => {
          if (suppress) return;
          if (!active || epochByPath.get(path) !== epoch) return;
          const latest = documentsRef.current[path];
          if (!latest || !authority.isCurrent(latest)) return;
          scheduleJavaScriptTypeScriptDocumentChange(latest);
        });
      });
    });
    return () => {
      active = false;
      epochByPath.clear();
      unsubscribe();
    };
  }, [
    captureAuthority,
    documentsRef,
    incrementalSyncRef,
    scheduleDocumentChange,
    scheduleJavaScriptTypeScriptDocumentChange,
    subscribeChangedDocuments,
  ]);
}
