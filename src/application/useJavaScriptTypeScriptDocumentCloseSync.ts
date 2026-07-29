import { useCallback, type MutableRefObject } from "react";
import { languageServerDocumentSyncKey } from "../domain/languageServerDocumentSync";
import type { LanguageServerTextDocument } from "../domain/languageServerDocumentSync";
import type { EditorDocument } from "../domain/workspace";
import type { LatestValueDrainMailbox } from "./latestValueDrainMailbox";
import type { DocumentSyncLargePolicyMemo } from "./documentSyncLargePolicyMemo";
import type { JavaScriptTypeScriptIncrementalSyncDocumentLifecyclePort } from "./javaScriptTypeScriptIncrementalSyncProduction";

export interface JavaScriptTypeScriptDocumentCloseSyncDependencies {
  readonly currentWorkspaceRootRef: MutableRefObject<string | null>;
  readonly incrementalSyncRef?: MutableRefObject<JavaScriptTypeScriptIncrementalSyncDocumentLifecyclePort | null>;
  readonly largePolicyMemoRef: MutableRefObject<DocumentSyncLargePolicyMemo>;
  readonly mailbox: LatestValueDrainMailbox<LanguageServerTextDocument>;
  retire(rootPath: string, path: string): Promise<void>;
}

export function useJavaScriptTypeScriptDocumentCloseSync({
  currentWorkspaceRootRef,
  incrementalSyncRef,
  largePolicyMemoRef,
  mailbox,
  retire,
}: JavaScriptTypeScriptDocumentCloseSyncDependencies) {
  return useCallback(
    async (document: EditorDocument) => {
      const rootPath = currentWorkspaceRootRef.current;
      if (!rootPath) return;
      const syncKey = languageServerDocumentSyncKey(rootPath, document.path);
      largePolicyMemoRef.current.delete(syncKey);
      mailbox.drop(syncKey);
      const incrementalSync = incrementalSyncRef?.current ?? null;
      const lease = incrementalSync?.requestLifecycleLease(document.path) ?? null;
      if (incrementalSync && lease && (await incrementalSync.closeDocument(lease))) return;
      await retire(rootPath, document.path);
    },
    [currentWorkspaceRootRef, incrementalSyncRef, largePolicyMemoRef, mailbox, retire],
  );
}
