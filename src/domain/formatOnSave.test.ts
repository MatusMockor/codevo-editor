import { describe, expect, it } from "vitest";
import {
  defaultFormatOnSaveOptions,
  planFormatOnSave,
  type FormatOnSavePlanInput,
} from "./formatOnSave";
import {
  emptyLanguageServerCapabilities,
  type LanguageServerRuntimeStatus,
} from "./languageServerRuntime";
import type { EditorDocument } from "./workspace";

function document(overrides: Partial<EditorDocument> = {}): EditorDocument {
  return {
    content: "const value = 1;\n",
    language: "typescript",
    name: "App.ts",
    path: "/workspace/src/App.ts",
    savedContent: "const value = 1;\n",
    ...overrides,
  };
}

function runningStatus(
  overrides: Partial<
    Extract<LanguageServerRuntimeStatus, { kind: "running" }>
  > = {},
): LanguageServerRuntimeStatus {
  return {
    capabilities: { ...emptyLanguageServerCapabilities(), formatting: true },
    kind: "running",
    rootPath: "/workspace",
    sessionId: 1,
    ...overrides,
  };
}

function planInput(
  overrides: Partial<FormatOnSavePlanInput> = {},
): FormatOnSavePlanInput {
  return {
    document: document(),
    hasPhpWorkspace: false,
    javaScriptTypeScript: { status: runningStatus(), statusRoot: "/workspace" },
    php: { status: null, statusRoot: null },
    workspaceRoot: "/workspace",
    ...overrides,
  };
}

describe("planFormatOnSave", () => {
  it("uses the JavaScript/TypeScript provider for typescript documents", () => {
    expect(planFormatOnSave(planInput())).toEqual({
      provider: "javaScriptTypeScript",
      sessionId: 1,
    });
  });

  it("uses the PHP provider for php documents in a php workspace", () => {
    expect(
      planFormatOnSave(
        planInput({
          document: document({
            language: "php",
            name: "User.php",
            path: "/workspace/src/User.php",
          }),
          hasPhpWorkspace: true,
          javaScriptTypeScript: { status: null, statusRoot: null },
          php: { status: runningStatus({ sessionId: 7 }), statusRoot: "/workspace" },
        }),
      ),
    ).toEqual({ provider: "php", sessionId: 7 });
  });

  it("returns null when the language has no language server document type", () => {
    expect(
      planFormatOnSave(
        planInput({
          document: document({ language: "markdown", path: "/workspace/x.md" }),
        }),
      ),
    ).toBeNull();
  });

  it("returns null for php documents without a php workspace", () => {
    expect(
      planFormatOnSave(
        planInput({
          document: document({ language: "php", path: "/workspace/x.php" }),
          hasPhpWorkspace: false,
          php: { status: runningStatus(), statusRoot: "/workspace" },
        }),
      ),
    ).toBeNull();
  });

  it("returns null when the runtime is not running", () => {
    expect(
      planFormatOnSave(
        planInput({
          javaScriptTypeScript: {
            status: { kind: "stopped", rootPath: "/workspace" },
            statusRoot: "/workspace",
          },
        }),
      ),
    ).toBeNull();
  });

  it("returns null when the runtime lacks the formatting capability", () => {
    expect(
      planFormatOnSave(
        planInput({
          javaScriptTypeScript: {
            status: runningStatus({
              capabilities: emptyLanguageServerCapabilities(),
            }),
            statusRoot: "/workspace",
          },
        }),
      ),
    ).toBeNull();
  });

  it("returns null when the runtime root differs from the requested workspace root", () => {
    expect(
      planFormatOnSave(
        planInput({
          javaScriptTypeScript: {
            status: runningStatus({ rootPath: "/other" }),
            statusRoot: "/other",
          },
        }),
      ),
    ).toBeNull();
  });

  it("matches workspace roots ignoring a trailing separator", () => {
    expect(
      planFormatOnSave(
        planInput({
          javaScriptTypeScript: {
            status: runningStatus({ rootPath: "/workspace/" }),
            statusRoot: "/workspace/",
          },
          workspaceRoot: "/workspace",
        }),
      ),
    ).toEqual({ provider: "javaScriptTypeScript", sessionId: 1 });
  });
});

describe("defaultFormatOnSaveOptions", () => {
  it("formats with two-space indentation", () => {
    expect(defaultFormatOnSaveOptions()).toEqual({
      insertSpaces: true,
      tabSize: 2,
    });
  });
});
