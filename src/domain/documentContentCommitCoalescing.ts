import {
  defaultLargeSmartDocumentPolicy,
  largeSmartDocumentStatusFromMetrics,
  type LargeSmartDocumentMetrics,
  type LargeSmartDocumentPolicy,
} from "./largeDocumentPolicy";
import { isDirty, type EditorDocument } from "./workspace";

export type DocumentContentCommitCoalescingPolicy = LargeSmartDocumentPolicy;

export const DEFAULT_DOCUMENT_CONTENT_COMMIT_COALESCING_POLICY: DocumentContentCommitCoalescingPolicy =
  defaultLargeSmartDocumentPolicy;

export function isCoalescableLargeContentCommit(
  before: EditorDocument,
  after: EditorDocument,
  policyLarge: boolean,
): boolean {
  return (
    before.content !== after.content &&
    policyLarge &&
    isDirty(before) === isDirty(after) &&
    before.path === after.path &&
    before.name === after.name &&
    before.language === after.language &&
    before.savedContent === after.savedContent &&
    before.readOnly === after.readOnly &&
    Object.is(before.revision, after.revision)
  );
}

export function isDocumentContentCommitPolicyLarge(
  metrics: LargeSmartDocumentMetrics,
  policy: DocumentContentCommitCoalescingPolicy = DEFAULT_DOCUMENT_CONTENT_COMMIT_COALESCING_POLICY,
): boolean {
  return largeSmartDocumentStatusFromMetrics(metrics, policy).kind === "large";
}
