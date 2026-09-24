import { describe, expect, it } from "vitest";
import wireContract from "../../contracts/git-surface-wire.json";
import {
  parseGitBranchChanges,
  parseGitBranchFileSides,
  validateGitBaseRef,
} from "./gitBranchDiff";

describe("git branch diff wire", () => {
  it("parses changes and sides", () => {
    const changes = {
      mergeBase: "b".repeat(40),
      headCommit: "c".repeat(40),
      files: [
        { relativePath: "a.ts", oldRelativePath: null, status: "modified", added: 1, deleted: 2 },
      ],
      truncated: false,
      statsTruncated: false,
    };
    expect(parseGitBranchChanges(changes)).toEqual(changes);
    const sides = {
      original: { text: "a" },
      modified: { text: "b" },
      unavailableReason: null,
    };
    expect(parseGitBranchFileSides(sides)).toEqual(sides);
  });

  it("rejects unknown statuses and reasons", () => {
    expect(() =>
      parseGitBranchChanges({
        mergeBase: "b".repeat(40),
        headCommit: "c".repeat(40),
        files: [
          {
            relativePath: "a",
            oldRelativePath: null,
            status: "exploded",
            added: null,
            deleted: null,
          },
        ],
        truncated: false,
        statsTruncated: false,
      }),
    ).toThrow();
    expect(() =>
      parseGitBranchFileSides({
        original: { text: "" },
        modified: { text: "" },
        unavailableReason: "huge",
      }),
    ).toThrow();
  });

  it("validates base refs like the Rust side", () => {
    expect(validateGitBaseRef("origin/release/1.4")).toBe("origin/release/1.4");
    for (const bad of [
      "",
      "--help",
      "a..b",
      "main ",
      "x@{1}",
      "a:b",
      "/main",
      "main/",
      "x.lock",
      "x".repeat(257),
    ]) {
      expect(() => validateGitBaseRef(bad), bad).toThrow();
    }
  });
});

describe("git branch diff shared wire contract", () => {
  it("parses the Rust-serialized branch changes and sides fixtures exactly", () => {
    const changes = parseGitBranchChanges(wireContract.branchChanges);
    expect(changes).toEqual(wireContract.branchChanges);
    expect(Object.keys(changes).sort()).toEqual(
      ["files", "headCommit", "mergeBase", "statsTruncated", "truncated"].sort(),
    );
    expect(parseGitBranchFileSides(wireContract.branchFileSides)).toEqual(
      wireContract.branchFileSides,
    );
    expect(parseGitBranchFileSides(wireContract.branchFileSidesUnavailable)).toEqual(
      wireContract.branchFileSidesUnavailable,
    );
  });

  it("rejects unknown, missing and legacy fields", () => {
    const { headCommit: _headCommit, ...withoutHead } = wireContract.branchChanges;
    expect(() => parseGitBranchChanges(withoutHead)).toThrow();
    expect(() => parseGitBranchChanges({ ...wireContract.branchChanges, extra: 1 })).toThrow();
    expect(() =>
      parseGitBranchChanges({ ...wireContract.branchChanges, headCommit: "HEAD" }),
    ).toThrow();
    expect(() =>
      parseGitBranchFileSides({
        ...wireContract.branchFileSides,
        original: { text: "a", truncated: false },
      }),
    ).toThrow();
  });
});
