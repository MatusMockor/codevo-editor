import { describe, expect, it } from "vitest";
import {
  MAX_GIT_COMMIT_MESSAGE_LENGTH,
  normalizeGitCommitMessageHistory,
  pushGitCommitMessageHistory,
} from "./gitCommitMessageHistory";

describe("pushGitCommitMessageHistory", () => {
  it.each(["", "   ", "\n\t"])('skips blank message %j', (message) => {
    expect(pushGitCommitMessageHistory(["existing"], message)).toEqual([
      "existing",
    ]);
  });

  it("pushes trimmed messages most-recent-first and moves duplicates to the front", () => {
    expect(
      pushGitCommitMessageHistory(["second", "first"], "  first  "),
    ).toEqual(["first", "second"]);
  });

  it("caps history at 20 entries", () => {
    const history = Array.from({ length: 20 }, (_, index) => `message ${index}`);

    expect(pushGitCommitMessageHistory(history, "new message")).toEqual([
      "new message",
      ...history.slice(0, 19),
    ]);
  });

  it("caps a recorded message at the per-entry length limit", () => {
    const oversized = `  ${"x".repeat(MAX_GIT_COMMIT_MESSAGE_LENGTH + 50)}  `;

    expect(pushGitCommitMessageHistory([], oversized)).toEqual([
      "x".repeat(MAX_GIT_COMMIT_MESSAGE_LENGTH),
    ]);
  });
});

describe("normalizeGitCommitMessageHistory", () => {
  it.each([undefined, null, {}, "message", 12])(
    "normalizes malformed or absent value %j to empty history",
    (value) => {
      expect(normalizeGitCommitMessageHistory(value)).toEqual([]);
    },
  );

  it("drops malformed and blank entries, deduplicates, and caps persisted history", () => {
    const value = [
      " first ",
      12,
      "",
      "second",
      "first",
      ...Array.from({ length: 25 }, (_, index) => `message ${index}`),
    ];

    expect(normalizeGitCommitMessageHistory(value)).toEqual([
      "first",
      "second",
      ...Array.from({ length: 18 }, (_, index) => `message ${index}`),
    ]);
  });

  it("caps legacy persisted entries at the per-entry length limit", () => {
    expect(
      normalizeGitCommitMessageHistory([
        "x".repeat(MAX_GIT_COMMIT_MESSAGE_LENGTH + 50),
      ]),
    ).toEqual(["x".repeat(MAX_GIT_COMMIT_MESSAGE_LENGTH)]);
  });
});
