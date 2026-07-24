import { describe, expect, it } from "vitest";
import {
  languageServerCodeActionKindMatchesOnly,
  languageServerCodeActionsMatchingOnly,
} from "./languageServerCodeActionKind";

describe("languageServerCodeActionKindMatchesOnly", () => {
  it.each([
    ["refactor", "refactor", true],
    ["refactor.extract", "refactor", true],
    ["refactor.move.file", "refactor", true],
    ["quickfix", "refactor", false],
    ["refactoring", "refactor", false],
    [null, "refactor", false],
    ["quickfix", undefined, true],
    [null, undefined, true],
  ] as const)("matches %s against %s as %s", (kind, only, expected) => {
    expect(languageServerCodeActionKindMatchesOnly(kind, only)).toBe(expected);
  });

  it("retains only the requested hierarchy without mutating the source", () => {
    const actions = [{ kind: "quickfix" }, { kind: "refactor" }, { kind: "refactor.extract" }];

    expect(languageServerCodeActionsMatchingOnly(actions, "refactor")).toEqual(actions.slice(1));
    expect(actions).toHaveLength(3);
  });
});
