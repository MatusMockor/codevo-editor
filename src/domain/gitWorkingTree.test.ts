import { describe, expect, it } from "vitest";
import wireContract from "../../contracts/git-working-tree-wire.json";
import {
  gitDiscardBlock,
  gitDiscardEffect,
  parseGitAmendCandidate,
  parseGitAmendReceipt,
  parseGitDiscardPreparation,
  parseGitDiscardReceipt,
} from "./gitWorkingTree";

describe("git working tree wire", () => {
  it("parses every amend candidate the Rust side emits", () => {
    const candidates = wireContract.amendCandidates;
    expect(parseGitAmendCandidate(candidates.ready)).toEqual(candidates.ready);
    expect(parseGitAmendCandidate(candidates.noCommit)).toEqual({ kind: "noCommit" });
    expect(parseGitAmendCandidate(candidates.operationInProgress)).toEqual({
      kind: "operationInProgress",
    });
    expect(parseGitAmendCandidate(candidates.pushed)).toEqual(candidates.pushed);
    expect(parseGitAmendCandidate(candidates.messageTooLarge)).toEqual(candidates.messageTooLarge);
  });

  it("rejects unknown kinds, extra keys, bad ids and oversized messages", () => {
    const ready = wireContract.amendCandidates.ready;
    expect(() => parseGitAmendCandidate({ kind: "detached" })).toThrow();
    expect(() => parseGitAmendCandidate({ ...ready, extra: true })).toThrow();
    expect(() => parseGitAmendCandidate({ ...ready, headSha: "HEAD" })).toThrow();
    expect(() => parseGitAmendCandidate({ ...ready, message: "x".repeat(4_097) })).toThrow();
    expect(() => parseGitAmendCandidate({ kind: "noCommit", headSha: ready.headSha })).toThrow();
  });

  it("parses receipts strictly", () => {
    expect(parseGitAmendReceipt(wireContract.amendReceipt)).toEqual(wireContract.amendReceipt);
    expect(parseGitDiscardReceipt(wireContract.discardReceipts.restored)).toEqual(
      wireContract.discardReceipts.restored,
    );
    expect(parseGitDiscardReceipt(wireContract.discardReceipts.deleted)).toEqual(
      wireContract.discardReceipts.deleted,
    );
    expect(() => parseGitDiscardReceipt({ relativePath: "a.ts", action: "shredded" })).toThrow();
    expect(() => parseGitDiscardReceipt({ relativePath: "../a.ts", action: "deleted" })).toThrow();
    expect(() =>
      parseGitAmendReceipt({ headSha: "a".repeat(40), indexSynced: true, extra: 1 }),
    ).toThrow();
    expect(() => parseGitAmendReceipt({ headSha: "a".repeat(40) })).toThrow();
    expect(parseGitDiscardPreparation(wireContract.discardPreparation)).toEqual(
      wireContract.discardPreparation,
    );
    expect(() => parseGitDiscardPreparation({ fingerprint: "xyz" })).toThrow();
  });

  it("describes what a discard does for each status", () => {
    expect(gitDiscardEffect("untracked")).toBe("delete");
    expect(gitDiscardEffect("added")).toBe("delete");
    expect(gitDiscardEffect("modified")).toBe("restore");
    expect(gitDiscardEffect("deleted")).toBe("restore");
    expect(gitDiscardEffect("renamed")).toBe("restoreRename");
    expect(gitDiscardEffect("conflicted")).toBe("blocked");
  });

  it("blocks discards that Git cannot express as one file", () => {
    expect(gitDiscardBlock("a.ts", "modified")).toBeNull();
    expect(gitDiscardBlock("merge.ts", "conflicted")).toBe("conflicted");
    expect(gitDiscardBlock("vendor/lib/", "untracked")).toBe("nestedRepository");
  });
});
