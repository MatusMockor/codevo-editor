import { describe, expect, it } from "vitest";
import {
  isAgentTurnChangePath,
  MAX_TURN_DIFF_BYTES,
  parseAgentTurnChangeSummary,
  parseAgentTurnFileDiff,
} from "./agentTurnChanges";

const file = {
  relativePath: "src/main.ts",
  oldRelativePath: null,
  status: "modified",
  addedLines: 3,
  deletedLines: 2,
};
const summary = { turnId: "turn-1", state: "ready", files: [file], truncated: false, reason: null };
const diff = {
  relativePath: file.relativePath,
  original: { text: "before", truncated: false },
  modified: { text: "after", truncated: false },
  unavailableReason: null,
};

describe("historical turn changes boundary", () => {
  it("retains exact counts, partial state and unknown line counts", () => {
    expect(parseAgentTurnChangeSummary(summary)).toEqual(summary);
    expect(parseAgentTurnChangeSummary({ ...summary, truncated: true }).truncated).toBe(true);
    expect(
      parseAgentTurnChangeSummary({
        ...summary,
        files: [{ ...file, addedLines: null, deletedLines: null }],
      }).files[0].addedLines,
    ).toBeNull();
  });

  it.each([
    "",
    "/abs",
    "../escape",
    "a/../b",
    "a//b",
    "a\\b",
    "a\u0000b",
    "a:b",
    ".git/config",
    "a/.GIT/config",
    "a/".repeat(65) + "b",
    "é".repeat(2049),
  ])("rejects unsafe or unbounded path %j", (path) => {
    expect(isAgentTurnChangePath(path)).toBe(false);
  });

  it("rejects duplicate files, forged fields, unavailable files and invalid counts", () => {
    for (const value of [
      { ...summary, files: [file, file] },
      {
        ...summary,
        files: [
          { ...file, addedLines: Number.MAX_SAFE_INTEGER },
          { ...file, relativePath: "other.ts" },
        ],
      },
      { ...summary, unknown: true },
      { ...summary, state: "unavailable" },
      {
        ...summary,
        files: Array.from({ length: 501 }, (_, i) => ({ ...file, relativePath: `file${i}` })),
      },
      ...[-1, 0.5, Infinity, NaN, Number.MAX_SAFE_INTEGER + 1, null].map((addedLines) => ({
        ...summary,
        files: [{ ...file, addedLines }],
      })),
      { ...summary, files: [{ ...file, extra: true }] },
      { ...summary, files: [{ ...file, oldRelativePath: "../foreign" }] },
      { ...summary, files: [{ ...file, status: "unknown" }] },
      { ...summary, turnId: "é".repeat(129) },
      { ...summary, reason: "é".repeat(513) },
    ])
      expect(() => parseAgentTurnChangeSummary(value)).toThrow();
  });

  it("accepts unavailable old turns without inventing files", () => {
    expect(
      parseAgentTurnChangeSummary({
        ...summary,
        state: "unavailable",
        files: [],
        reason: "No baseline.",
      }).files,
    ).toEqual([]);
  });

  it("accepts closed unsupported workspace reasons and rejects unknown variants", () => {
    for (const reason of ["notGitRepository", "notWorktreeRoot"])
      expect(
        parseAgentTurnChangeSummary({ ...summary, state: "unsupported", files: [], reason }),
      ).toEqual({ turnId: "turn-1", state: "unsupported", files: [], truncated: false, reason });
    for (const invalid of [
      { ...summary, state: "unsupported", files: [], reason: "notApplicable" },
      { ...summary, state: "unsupported", files: [], reason: null },
      { ...summary, state: "unsupported", files: [], reason: "Not a Git repository." },
      { ...summary, state: "unsupported", reason: "notGitRepository" },
      { ...summary, state: "unsupported", files: [], truncated: true, reason: "notGitRepository" },
      { ...summary, state: "skipped", files: [] },
    ])
      expect(() => parseAgentTurnChangeSummary(invalid)).toThrow();
  });

  it("bounds both diff sides by UTF-8 bytes and rejects unknown states", () => {
    expect(parseAgentTurnFileDiff(diff)).toEqual(diff);
    expect(parseAgentTurnFileDiff({ ...diff, unavailableReason: "binary" }).unavailableReason).toBe(
      "binary",
    );
    for (const value of [
      { ...diff, original: { text: "é".repeat(MAX_TURN_DIFF_BYTES / 2 + 1), truncated: false } },
      { ...diff, modified: { text: "x".repeat(MAX_TURN_DIFF_BYTES + 1), truncated: true } },
      { ...diff, modified: { ...diff.modified, extra: true } },
      { ...diff, unavailableReason: "missing" },
      { ...diff, relativePath: "../foreign" },
      { ...diff, extra: true },
    ])
      expect(() => parseAgentTurnFileDiff(value)).toThrow();
  });
});
