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

  it.each([
    ["fea", ["feat"]],
    ["feat", ["feat"]],
    ["feat(", ["feat"]],
    ["feat(api", ["feat"]],
    ["feat(api)", ["feat"]],
    ["feat(api)!", ["feat"]],
    ["feat!", ["feat"]],
    ["feat(api.v2/foo_bar-1)", ["feat"]],
    ["feat(api scope)", ["feat"]],
    ["feat(api scope", ["feat"]],
  ])("matches the type family for scoped input %j", (input, expected) => {
    expect(matchConventionalCommitTypes(input)).toEqual(expected);
  });

  it("suppresses a complete type followed by a colon", () => {
    expect(matchConventionalCommitTypes("feat: subject")).toEqual([]);
  });

  it("returns no matches for empty or non-matching input", () => {
    expect(matchConventionalCommitTypes("")).toEqual([]);
    expect(matchConventionalCommitTypes("unknown")).toEqual([]);
  });

  it.each(["fexxx"])(
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

  it.each([
    ["fe(api): message", "feat", "feat(api): message"],
    ["fe(api)!: message", "feat", "feat(api)!: message"],
    ["fe!: message", "feat", "feat!: message"],
    ["fe(api.v2/foo_bar-1): message", "feat", "feat(api.v2/foo_bar-1): message"],
    ["fe(api scope): message", "feat", "feat(api scope): message"],
    ["fe(api message", "feat", "feat: message"],
  ] as const)(
    "preserves conventional commit decorations when completing %j",
    (message, type, expected) => {
      expect(completeConventionalType(message, type)).toBe(expected);
    },
  );

  it("preserves a scoped first-line description and multiline body exactly", () => {
    expect(
      completeConventionalType(
        "fe(deep.path)!: repair startup\n\nKeep this body.\n",
        "feat",
      ),
    ).toBe("feat(deep.path)!: repair startup\n\nKeep this body.\n");
  });

  it("places preserved subject text immediately after the six-character completion", () => {
    const completed = completeConventionalType("fe subject", "feat");

    expect(completed.slice(0, "feat: ".length)).toBe("feat: ");
    expect(completed.slice("feat: ".length)).toBe("subject");
  });
});
