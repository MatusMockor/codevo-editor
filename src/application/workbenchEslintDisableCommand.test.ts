import { describe, expect, it, vi } from "vitest";
import { runEslintDisableAtCursor } from "./workbenchEslintDisableCommand";

const document = {
  path: "/workspace/src/index.ts",
  name: "index.ts",
  language: "typescript",
  content: "const value = 1;\n",
  savedContent: "const value = 1;\n",
};

describe("runEslintDisableAtCursor", () => {
  it("combines unique rules on the cursor line and reports their count", () => {
    const runner = vi.fn(() => 2);
    const setMessage = vi.fn();

    expect(runEslintDisableAtCursor({
      currentRoot: "/workspace",
      requestedRoot: "/workspace",
      document,
      lineNumber: 1,
      diagnostics: [
        { line: 1, identifier: "rule-a" },
        { line: 1, identifier: "rule-b" },
        { line: 1, identifier: "rule-a" },
      ],
      runner,
      setMessage,
      workspaceTrusted: true,
    })).toBe(2);
    expect(runner).toHaveBeenCalledWith(document.content, 1, ["rule-a", "rule-b"]);
    expect(setMessage).toHaveBeenCalledWith("ESLint: Disabled 2 rules (rule-a, rule-b)");
  });

  it.each([
    ["stale root", { currentRoot: "/other" }],
    ["untrusted workspace", { workspaceTrusted: false }],
    ["dirty document", { document: { ...document, content: "dirty" } }],
    ["no cursor diagnostic", { lineNumber: 2 }],
    ["vue document", { document: { ...document, language: "vue" } }],
    ["json document", { document: { ...document, language: "json" } }],
  ])("drops the action for a %s", (_label, overrides) => {
    const runner = vi.fn();

    runEslintDisableAtCursor({
      currentRoot: "/workspace",
      requestedRoot: "/workspace",
      document,
      lineNumber: 1,
      diagnostics: [{ line: 1, identifier: "rule-a" }],
      runner,
      setMessage: vi.fn(),
      workspaceTrusted: true,
      ...overrides,
    });

    expect(runner).not.toHaveBeenCalled();
  });
});
