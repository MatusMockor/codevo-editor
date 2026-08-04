import { classifyJavaScriptTypeScriptLargeDocumentCapability } from "../domain/javaScriptTypeScriptLargeDocumentCapability";
import type { LargeSmartDocumentPolicy } from "../domain/largeDocumentPolicy";
import type { EditorDocument } from "../domain/workspace";

export const MAX_DOCUMENT_SYNC_LARGE_POLICY_MEMO_ENTRIES = 1_024;

/**
 * Remembers only that one synchronized document was evaluated under an exact
 * large-file policy. Document content remains owned by document-sync state, so
 * this memo never retains another copy of a buffer.
 */
export class DocumentSyncLargePolicyMemo {
  private readonly entries = new Map<string, string>();

  constructor(private readonly maxEntries: number = MAX_DOCUMENT_SYNC_LARGE_POLICY_MEMO_ENTRIES) {}

  delete(syncKey: string): void {
    this.entries.delete(syncKey);
  }

  matches(syncKey: string, policy: LargeSmartDocumentPolicy): boolean {
    return this.entries.get(syncKey) === policySignature(policy);
  }

  requiresEvaluation({
    contentIsCurrent,
    isSynced,
    policy,
    syncKey,
  }: {
    readonly contentIsCurrent: boolean;
    readonly isSynced: boolean;
    readonly policy: LargeSmartDocumentPolicy;
    readonly syncKey: string;
  }): boolean {
    return !isSynced || !contentIsCurrent || !this.matches(syncKey, policy);
  }

  record(syncKey: string, policy: LargeSmartDocumentPolicy): void {
    if (this.maxEntries <= 0) {
      return;
    }

    this.entries.delete(syncKey);
    this.entries.set(syncKey, policySignature(policy));

    while (this.entries.size > this.maxEntries) {
      const oldest = this.entries.keys().next().value;
      if (oldest === undefined) {
        return;
      }
      this.entries.delete(oldest);
    }
  }
}

export type DocumentSyncOpenAdmission =
  | { readonly kind: "eligible"; readonly wasAlreadySynced: boolean }
  | { readonly kind: "large"; readonly wasAlreadySynced: boolean }
  | { readonly kind: "unchanged" };

export function evaluateDocumentSyncOpenAdmission({
  document,
  memo,
  policy,
  syncKey,
  syncedContent,
  syncedPaths,
}: {
  readonly document: EditorDocument;
  readonly memo: DocumentSyncLargePolicyMemo;
  readonly policy: LargeSmartDocumentPolicy;
  readonly syncKey: string;
  readonly syncedContent: Readonly<Record<string, string>>;
  readonly syncedPaths: ReadonlySet<string>;
}): DocumentSyncOpenAdmission {
  const wasAlreadySynced = syncedPaths.has(syncKey);
  if (
    !memo.requiresEvaluation({
      contentIsCurrent: syncedContent[syncKey] === document.content,
      isSynced: wasAlreadySynced,
      policy,
      syncKey,
    })
  ) {
    return { kind: "unchanged" };
  }

  const large =
    classifyJavaScriptTypeScriptLargeDocumentCapability(document.content, policy).kind ===
    "editing-only";
  memo.record(syncKey, policy);
  return {
    kind: large ? "large" : "eligible",
    wasAlreadySynced,
  };
}

function policySignature(policy: LargeSmartDocumentPolicy): string {
  return `${policy.characterLimit}:${policy.lineLimit}`;
}
