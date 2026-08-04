import { MAX_JAVA_SCRIPT_TYPE_SCRIPT_FULL_SYNC_UTF16_UNITS } from "../domain/javaScriptTypeScriptLargeDocumentCapability";
import { isWellFormedUnicode } from "../domain/unicodeText";
import type { EditorDocument } from "../domain/workspace";

export function isJavaScriptTypeScriptDocumentSyncBlockedBySize(
  document: Pick<EditorDocument, "content">,
): boolean {
  return document.content.length > MAX_JAVA_SCRIPT_TYPE_SCRIPT_FULL_SYNC_UTF16_UNITS;
}

export function isMalformedJavaScriptTypeScriptDocumentSyncContent(content: string): boolean {
  return !isWellFormedUnicode(content);
}
