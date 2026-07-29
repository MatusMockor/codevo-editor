import { DEFAULT_INCREMENTAL_DOCUMENT_SYNC_LIMITS } from "./incrementalDocumentSync";
import { isJavaScriptTypeScriptLanguageServerDocument } from "./languageServerDocumentSync";
import type { EditorDocument } from "./workspace";

/**
 * Save-time LSP participants are only truthful while the exact document can be
 * represented by the JS/TS language server's bounded full-snapshot protocol.
 */
export const MAX_JAVA_SCRIPT_TYPE_SCRIPT_SAVE_PARTICIPANT_UTF16_UNITS =
  DEFAULT_INCREMENTAL_DOCUMENT_SYNC_LIMITS.maxFullSnapshotUtf16Units;

export function canUseJavaScriptTypeScriptLanguageServerSaveParticipant(
  document: EditorDocument,
  content: string = document.content,
): boolean {
  return (
    isJavaScriptTypeScriptLanguageServerDocument(document) &&
    content.length <= MAX_JAVA_SCRIPT_TYPE_SCRIPT_SAVE_PARTICIPANT_UTF16_UNITS
  );
}
