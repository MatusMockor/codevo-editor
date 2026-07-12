import { describe, expect, it } from "vitest";
import { applyEslintFixes, parseEslintDiagnostics } from "./eslintDiagnostics";

const ROOT = "/workspace";

describe("parseEslintDiagnostics", () => {
  it("maps warnings and errors to ranged navigable notices", () => {
    const notices = parseEslintDiagnostics(
      {
        status: "ok",
        diagnostics: [
          {
            filePath: "src/index.ts",
            line: 3,
            column: 5,
            endLine: null,
            endColumn: null,
            message: "Unexpected console statement.",
            identifier: "no-console",
            severity: 1,
          },
          {
            filePath: "src/index.ts",
            line: 8,
            column: 2,
            endLine: 8,
            endColumn: 7,
            message: "Missing semicolon.",
            identifier: "semi",
            severity: 2,
          },
        ],
        totals: { errorCount: 1, warningCount: 1, fileCount: 1 },
      },
      ROOT,
    );

    expect(notices[0]).toMatchObject({
      groupKey: `eslint:${ROOT}`,
      severity: "warning",
      source: "ESLint",
      navigationTarget: {
        path: "/workspace/src/index.ts",
        range: {
          start: { lineNumber: 3, column: 5 },
          end: { lineNumber: 3, column: 5 },
        },
      },
    });
    expect(notices[1]).toMatchObject({
      severity: "error",
      navigationTarget: {
        range: {
          start: { lineNumber: 8, column: 2 },
          end: { lineNumber: 8, column: 7 },
        },
      },
    });
  });

  it("maps unavailable and command errors", () => {
    expect(parseEslintDiagnostics({ status: "unavailable" }, ROOT)[0]).toMatchObject({
      severity: "info",
      message: expect.stringMatching(/eslintPath.*install ESLint/i),
    });
    expect(
      parseEslintDiagnostics(
        { status: "error", message: "Could not find config file." },
        ROOT,
      )[0],
    ).toMatchObject({
      severity: "error",
      message: "Could not find config file.",
      navigationTarget: undefined,
    });
  });
});

describe("applyEslintFixes", () => {
  it("applies a single fix", () => {
    expect(applyEslintFixes("const value = 1", [{ range: [15, 15], text: ";" }])).toEqual({
      content: "const value = 1;",
      appliedCount: 1,
    });
  });

  it("applies multiple non-overlapping fixes in offset order", () => {
    expect(applyEslintFixes("let a = 'x'", [
      { range: [8, 11], text: '"x"' },
      { range: [11, 11], text: ";" },
    ])).toEqual({ content: 'let a = "x";', appliedCount: 2 });
  });

  it("keeps the first sorted fix when ranges overlap", () => {
    expect(applyEslintFixes("abcdef", [
      { range: [1, 4], text: "X" },
      { range: [3, 5], text: "Y" },
    ])).toEqual({ content: "aXef", appliedCount: 1 });
  });

  it("skips out-of-bounds fixes", () => {
    expect(applyEslintFixes("abc", [{ range: [2, 4], text: "X" }])).toEqual({
      content: "abc",
      appliedCount: 0,
    });
  });

  it("leaves content unchanged for an empty fix list", () => {
    expect(applyEslintFixes("abc", [])).toEqual({ content: "abc", appliedCount: 0 });
  });
});
