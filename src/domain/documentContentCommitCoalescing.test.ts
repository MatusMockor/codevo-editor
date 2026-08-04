import { describe, expect, it } from "vitest";
import {
  LARGE_SMART_DOCUMENT_LINE_LIMIT,
  MIN_LARGE_SMART_DOCUMENT_CHARACTER_LIMIT,
  type LargeSmartDocumentMetrics,
} from "./largeDocumentPolicy";
import type { EditorDocument } from "./workspace";
import {
  DEFAULT_DOCUMENT_CONTENT_COMMIT_COALESCING_POLICY,
  isCoalescableLargeContentCommit,
  isDocumentContentCommitPolicyLarge,
} from "./documentContentCommitCoalescing";

const LARGE = "x".repeat(DEFAULT_DOCUMENT_CONTENT_COMMIT_COALESCING_POLICY.characterLimit + 1);
const SMALL = "x".repeat(16);

function document(fields: Partial<EditorDocument> = {}): EditorDocument {
  return {
    content: LARGE,
    language: "markdown",
    name: "notes.md",
    path: "/workspace/notes.md",
    savedContent: LARGE,
    ...fields,
  };
}

function metrics(content: string, lineCount = 1): LargeSmartDocumentMetrics {
  return { lineCount, utf16Length: content.length };
}

describe("isCoalescableLargeContentCommit", () => {
  it("coalesces a content-only change on an oversized already-dirty document", () => {
    const before = document({ content: `${LARGE}a` });
    const after = document({ content: `${LARGE}ab` });

    expect(isCoalescableLargeContentCommit(before, after, true)).toBe(true);
  });

  it("never coalesces the clean-to-dirty transition", () => {
    const before = document();
    const after = document({ content: `${LARGE}a` });

    expect(isCoalescableLargeContentCommit(before, after, true)).toBe(false);
  });

  it("never coalesces the dirty-to-clean transition", () => {
    const before = document({ content: `${LARGE}a` });
    const after = document();

    expect(isCoalescableLargeContentCommit(before, after, true)).toBe(false);
  });

  it("never coalesces a content change below the policy size", () => {
    const before = document({ content: SMALL, savedContent: SMALL });
    const after = document({ content: `${SMALL}a`, savedContent: SMALL });

    expect(isCoalescableLargeContentCommit(before, after, false)).toBe(false);
  });

  it("coalesces a short-line document beyond the configured line limit", () => {
    const savedContent = "x\n".repeat(LARGE_SMART_DOCUMENT_LINE_LIMIT);
    const before = document({ content: `${savedContent}a`, savedContent });
    const after = document({ content: `${savedContent}ab`, savedContent });

    expect(
      isDocumentContentCommitPolicyLarge(
        metrics(after.content, LARGE_SMART_DOCUMENT_LINE_LIMIT + 1),
      ),
    ).toBe(true);
    expect(isCoalescableLargeContentCommit(before, after, true)).toBe(true);
  });

  it("coalesces against a lowered configured character threshold", () => {
    const policy = {
      characterLimit: MIN_LARGE_SMART_DOCUMENT_CHARACTER_LIMIT,
      lineLimit: LARGE_SMART_DOCUMENT_LINE_LIMIT,
    };
    const savedContent = "x".repeat(policy.characterLimit + 1);
    const before = document({ content: `${savedContent}a`, savedContent });
    const after = document({ content: `${savedContent}ab`, savedContent });

    expect(isDocumentContentCommitPolicyLarge(metrics(after.content), policy)).toBe(true);
    expect(isCoalescableLargeContentCommit(before, after, true)).toBe(true);
  });

  it("never coalesces a saved-content change", () => {
    const before = document({ content: `${LARGE}a` });
    const after = document({ content: `${LARGE}a`, savedContent: `${LARGE}a` });

    expect(isCoalescableLargeContentCommit(before, after, true)).toBe(false);
  });

  it("never coalesces a revision change", () => {
    const before = document({ revision: null });
    const after = document({
      content: `${LARGE}a`,
      revision: {
        contentHash: "hash",
        device: "device",
        inode: "inode",
        modifiedNanoseconds: 0,
        modifiedSeconds: 1,
        size: 2,
      },
    });

    expect(isCoalescableLargeContentCommit(before, after, true)).toBe(false);
  });

  it("never coalesces a read-only or language change", () => {
    const before = document();
    const after = document({ content: `${LARGE}a`, language: "plaintext" });

    expect(isCoalescableLargeContentCommit(before, after, true)).toBe(false);
  });

  it("never coalesces a path change", () => {
    const before = document();
    const other = document({ name: "other.md", path: "/workspace/other.md" });

    expect(isCoalescableLargeContentCommit(before, other, true)).toBe(false);
  });

  it("fails closed for missing or inconsistent precomputed metrics", () => {
    const after = document({ content: `${LARGE}ab` });

    expect(
      isDocumentContentCommitPolicyLarge({
        lineCount: 0,
        utf16Length: after.content.length,
      }),
    ).toBe(false);
    expect(
      isDocumentContentCommitPolicyLarge({
        lineCount: after.content.length + 2,
        utf16Length: after.content.length,
      }),
    ).toBe(false);
  });
});
