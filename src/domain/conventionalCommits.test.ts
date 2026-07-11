import { describe, expect, it } from "vitest";
import {
  completeConventionalType,
  matchConventionalCommitTypes,
} from "./conventionalCommits";

describe("matchConventionalCommitTypes", () => {
  it.each([
    ["f", ["feat", "fix"]],
    ["re", ["refactor", "revert"]],
    ["b", ["build"]],
    ["c", ["ci", "chore"]],
  ])(
    "matches %s against standard types in their declared order",
    (input, expected) => {
      expect(matchConventionalCommitTypes(input)).toEqual(expected);
    },
  );

  it("matches case-insensitively", () => {
    expect(matchConventionalCommitTypes("DoC")).toEqual(["docs"]);
  });

  it("suppresses a complete type followed by a colon", () => {
    expect(matchConventionalCommitTypes("feat: subject")).toEqual([]);
  });

  it("returns no matches for empty or non-matching input", () => {
    expect(matchConventionalCommitTypes("")).toEqual([]);
    expect(matchConventionalCommitTypes("unknown")).toEqual([]);
  });

  it.each(["fexxx", "fix(scope)"])(
    "returns no matches for the malformed whole token %j",
    (input) => {
      expect(matchConventionalCommitTypes(input)).toEqual([]);
    },
  );
});

describe("completeConventionalType", () => {
  it("replaces the leading word and preserves the rest of the first line", () => {
    expect(completeConventionalType("fe improve startup", "feat")).toBe(
      "feat: improve startup",
    );
  });

  it("normalizes an existing separator at the completion boundary", () => {
    expect(completeConventionalType("FE:   improve startup", "feat")).toBe(
      "feat: improve startup",
    );
  });

  it("preserves later lines exactly", () => {
    expect(
      completeConventionalType(
        "fi repair startup\n\nKeep this body.\n",
        "fix",
      ),
    ).toBe("fix: repair startup\n\nKeep this body.\n");
  });

  it("places preserved subject text immediately after the six-character completion", () => {
    const completed = completeConventionalType("fe subject", "feat");

    expect(completed.slice(0, "feat: ".length)).toBe("feat: ");
    expect(completed.slice("feat: ".length)).toBe("subject");
  });
});
