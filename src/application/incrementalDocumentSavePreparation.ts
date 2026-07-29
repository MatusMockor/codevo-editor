import {
  createLanguageServerTextDocument,
  type LanguageServerDocumentSyncGateway,
} from "../domain/languageServerDocumentSync";
import type { EditorDocument } from "../domain/workspace";
import type {
  JavaScriptTypeScriptIncrementalSyncDocumentLifecyclePort,
  JavaScriptTypeScriptIncrementalSyncLifecycleLease,
} from "./javaScriptTypeScriptIncrementalSyncProduction";

export interface IncrementalDocumentSavePreparation {
  readonly document: EditorDocument;
  readonly gateway: LanguageServerDocumentSyncGateway;
  readonly incrementalSync: JavaScriptTypeScriptIncrementalSyncDocumentLifecyclePort;
  readonly isCurrent: () => boolean;
  readonly lease: JavaScriptTypeScriptIncrementalSyncLifecycleLease;
  readonly rootPath: string;
  readonly sessionId: number;
  readonly version: number;
}

export type IncrementalDocumentSaveOutcome = "committed" | "stale-noop";

/**
 * Prepares and confirms one exact live-editor save without consulting the
 * potentially stale React document projection.
 */
export async function syncPreparedIncrementalDocumentSave({
  document,
  gateway,
  incrementalSync,
  isCurrent,
  lease,
  rootPath,
  sessionId,
  version,
}: IncrementalDocumentSavePreparation): Promise<IncrementalDocumentSaveOutcome> {
  const prepared = await incrementalSync.prepareSave(lease);
  if (
    !prepared ||
    prepared.content !== document.content ||
    !isCurrent() ||
    !incrementalSync.isLeaseCurrent(lease) ||
    !incrementalSync.confirmSave(prepared.permit)
  ) {
    return "stale-noop";
  }
  await gateway.didSave(
    rootPath,
    createLanguageServerTextDocument({ ...document, content: prepared.content }, version),
    sessionId,
  );
  return "committed";
}
