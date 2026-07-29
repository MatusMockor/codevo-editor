import { describe, expect, it } from "vitest";
import type { LargeSmartDocumentPolicy } from "../domain/largeDocumentPolicy";
import { DocumentSyncLargePolicyMemo } from "./documentSyncLargePolicyMemo";

const POLICY: LargeSmartDocumentPolicy = {
  characterLimit: 256 * 1024,
  lineLimit: 5_000,
};

describe("DocumentSyncLargePolicyMemo", () => {
  it.each([1, 2, 4])(
    "requires zero unrelated content evaluations when %i groups revisit 100 synced documents",
    (groupCount) => {
      const memo = new DocumentSyncLargePolicyMemo();
      const syncKeys = Array.from(
        { length: 100 },
        (_, index) => `/workspace\0/workspace/src/file-${index}.ts`,
      );
      syncKeys.forEach((syncKey) => memo.record(syncKey, POLICY));
      let requiredContentEvaluations = 0;

      for (let group = 0; group < groupCount; group += 1) {
        for (const syncKey of syncKeys) {
          if (
            memo.requiresEvaluation({
              contentIsCurrent: true,
              isSynced: true,
              policy: POLICY,
              syncKey,
            })
          ) {
            requiredContentEvaluations += 1;
          }
        }
      }

      expect(requiredContentEvaluations).toBe(0);
    },
  );

  it("requires exactly the changed, new, and policy-invalidated document evaluations", () => {
    const memo = new DocumentSyncLargePolicyMemo();
    const unchangedKey = "/workspace\0/workspace/src/unchanged.ts";
    const changedKey = "/workspace\0/workspace/src/changed.ts";
    const newKey = "/workspace\0/workspace/src/new.ts";
    memo.record(unchangedKey, POLICY);
    memo.record(changedKey, POLICY);

    const decisions = [
      memo.requiresEvaluation({
        contentIsCurrent: true,
        isSynced: true,
        policy: POLICY,
        syncKey: unchangedKey,
      }),
      memo.requiresEvaluation({
        contentIsCurrent: false,
        isSynced: true,
        policy: POLICY,
        syncKey: changedKey,
      }),
      memo.requiresEvaluation({
        contentIsCurrent: false,
        isSynced: false,
        policy: POLICY,
        syncKey: newKey,
      }),
      memo.requiresEvaluation({
        contentIsCurrent: true,
        isSynced: true,
        policy: { ...POLICY, lineLimit: POLICY.lineLimit + 1 },
        syncKey: unchangedKey,
      }),
    ];

    expect(decisions).toEqual([false, true, true, true]);
    expect(decisions.filter(Boolean)).toHaveLength(3);
  });

  it("evicts deterministically without retaining document content", () => {
    const memo = new DocumentSyncLargePolicyMemo(2);
    memo.record("first", POLICY);
    memo.record("second", POLICY);
    memo.record("third", POLICY);

    expect(
      memo.requiresEvaluation({
        contentIsCurrent: true,
        isSynced: true,
        policy: POLICY,
        syncKey: "first",
      }),
    ).toBe(true);
    expect(
      memo.requiresEvaluation({
        contentIsCurrent: true,
        isSynced: true,
        policy: POLICY,
        syncKey: "second",
      }),
    ).toBe(false);
  });
});
