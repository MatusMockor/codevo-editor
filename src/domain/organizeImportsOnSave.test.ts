import { describe, expect, it } from "vitest";
import {
  fullDocumentRange,
  javaScriptTypeScriptOnSaveSourceActionKinds,
  organizeImportsCodeActionToResolve,
  organizeImportsCodeActionContext,
  organizeImportsCodeActionKind,
  organizeImportsTextEditsForPath,
  planOrganizeImportsOnSave,
  removeUnusedCodeActionKind,
  type OrganizeImportsOnSavePlanInput,
} from "./organizeImportsOnSave";
import { fileUriFromPath } from "./languageServerDocumentSync";
import type { LanguageServerCodeAction } from "./languageServerFeatures";
import {
  emptyLanguageServerCapabilities,
  type LanguageServerRuntimeStatus,
} from "./languageServerRuntime";
import type { EditorDocument } from "./workspace";

function document(overrides: Partial<EditorDocument> = {}): EditorDocument {
  return {
    content: "import { b } from './b';\nimport { a } from './a';\n",
    language: "typescript",
    name: "App.ts",
    path: "/workspace/src/App.ts",
    savedContent: "",
    ...overrides,
  };
}

function runningStatus(
  overrides: Partial<
    Extract<LanguageServerRuntimeStatus, { kind: "running" }>
  > = {},
): LanguageServerRuntimeStatus {
  return {
    capabilities: { ...emptyLanguageServerCapabilities(), codeAction: true },
    kind: "running",
    rootPath: "/workspace",
    sessionId: 5,
    ...overrides,
  };
}

function planInput(
  overrides: Partial<OrganizeImportsOnSavePlanInput> = {},
): OrganizeImportsOnSavePlanInput {
  return {
    document: document(),
    javaScriptTypeScript: { status: runningStatus(), statusRoot: "/workspace" },
    sourceActionKinds: [organizeImportsCodeActionKind],
    workspaceRoot: "/workspace",
    ...overrides,
  };
}

describe("planOrganizeImportsOnSave", () => {
  it("plans an organize pass for a JS/TS document with a running code-action-capable server", () => {
    expect(planOrganizeImportsOnSave(planInput())).toEqual({
      sessionId: 5,
      sourceActionKinds: [organizeImportsCodeActionKind],
    });
  });

  it("returns null when no JS/TS source actions are enabled", () => {
    expect(
      planOrganizeImportsOnSave(planInput({ sourceActionKinds: [] })),
    ).toBeNull();
  });

  it("returns null for PHP documents (the synchronous PHP path handles those)", () => {
    expect(
      planOrganizeImportsOnSave(
        planInput({
          document: document({
            language: "php",
            name: "User.php",
            path: "/workspace/src/User.php",
          }),
        }),
      ),
    ).toBeNull();
  });

  it("returns null when the server does not advertise code action support", () => {
    expect(
      planOrganizeImportsOnSave(
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

  it("returns null when no server is running for the requested root", () => {
    expect(
      planOrganizeImportsOnSave(
        planInput({
          javaScriptTypeScript: { status: null, statusRoot: null },
        }),
      ),
    ).toBeNull();
  });

  it("returns null when the running server targets a different workspace root", () => {
    expect(
      planOrganizeImportsOnSave(
        planInput({
          javaScriptTypeScript: {
            status: runningStatus({ rootPath: "/other" }),
            statusRoot: "/other",
          },
        }),
      ),
    ).toBeNull();
  });

  it("falls back to the status root when the running status omits its rootPath", () => {
    expect(
      planOrganizeImportsOnSave(
        planInput({
          javaScriptTypeScript: {
            status: runningStatus({ rootPath: undefined }),
            statusRoot: "/workspace",
          },
        }),
      ),
    ).toEqual({
      sessionId: 5,
      sourceActionKinds: [organizeImportsCodeActionKind],
    });
  });
});

describe("javaScriptTypeScriptOnSaveSourceActionKinds", () => {
  it("builds ordered source actions from the JS/TS save settings", () => {
    expect(
      javaScriptTypeScriptOnSaveSourceActionKinds({
        javaScriptTypeScriptOrganizeImportsOnSave: false,
        javaScriptTypeScriptRemoveUnusedOnSave: false,
      }),
    ).toEqual([]);
    expect(
      javaScriptTypeScriptOnSaveSourceActionKinds({
        javaScriptTypeScriptOrganizeImportsOnSave: true,
        javaScriptTypeScriptRemoveUnusedOnSave: true,
      }),
    ).toEqual([organizeImportsCodeActionKind, removeUnusedCodeActionKind]);
  });
});

describe("organizeImportsCodeActionContext", () => {
  it("requests the organize-imports source action only", () => {
    expect(organizeImportsCodeActionContext()).toEqual({
      diagnostics: [],
      only: [organizeImportsCodeActionKind],
    });
  });

  it("requests one requested source action kind", () => {
    expect(organizeImportsCodeActionContext(removeUnusedCodeActionKind)).toEqual(
      {
        diagnostics: [],
        only: [removeUnusedCodeActionKind],
      },
    );
  });
});

describe("fullDocumentRange", () => {
  it("spans from the document start to the end of the last line", () => {
    expect(fullDocumentRange("ab\ncde\n")).toEqual({
      start: { line: 0, character: 0 },
      end: { line: 2, character: 0 },
    });
  });
});

describe("organizeImportsTextEditsForPath", () => {
  const path = "/workspace/src/App.ts";

  const action = (
    overrides: Partial<LanguageServerCodeAction> = {},
  ): LanguageServerCodeAction => ({
    command: null,
    data: null,
    edit: {
      changes: {
        [fileUriFromPath(path)]: [
          {
            newText: "organized",
            range: {
              start: { line: 0, character: 0 },
              end: { line: 0, character: 5 },
            },
          },
        ],
      },
    },
    isPreferred: false,
    kind: organizeImportsCodeActionKind,
    title: "Organize Imports",
    ...overrides,
  });

  it("returns the edits for the saved file's URI", () => {
    expect(organizeImportsTextEditsForPath([action()], path)).toEqual([
      {
        newText: "organized",
        range: {
          start: { line: 0, character: 0 },
          end: { line: 0, character: 5 },
        },
      },
    ]);
  });

  it("matches organize-imports sub-kinds such as source.organizeImports.ts", () => {
    expect(
      organizeImportsTextEditsForPath(
        [action({ kind: "source.organizeImports.ts" })],
        path,
      ),
    ).not.toBeNull();
  });

  it("matches remove-unused source actions when that kind was requested", () => {
    expect(
      organizeImportsTextEditsForPath(
        [action({ kind: removeUnusedCodeActionKind })],
        path,
        removeUnusedCodeActionKind,
      ),
    ).not.toBeNull();
  });

  it("ignores actions whose kind is not an organize-imports kind", () => {
    expect(
      organizeImportsTextEditsForPath(
        [action({ kind: "source.fixAll" })],
        path,
      ),
    ).toBeNull();
  });

  it("ignores command-only actions that carry no inline edit", () => {
    expect(
      organizeImportsTextEditsForPath([action({ edit: null })], path),
    ).toBeNull();
  });

  it("ignores edits that target a different document", () => {
    const otherPath = "/workspace/src/Other.ts";

    expect(
      organizeImportsTextEditsForPath(
        [
          action({
            edit: {
              changes: {
                [fileUriFromPath(otherPath)]: [
                  {
                    newText: "x",
                    range: {
                      start: { line: 0, character: 0 },
                      end: { line: 0, character: 0 },
                    },
                  },
                ],
              },
            },
          }),
        ],
        path,
      ),
    ).toBeNull();
  });

  it("returns null when no actions are provided", () => {
    expect(organizeImportsTextEditsForPath([], path)).toBeNull();
  });
});

describe("organizeImportsCodeActionToResolve", () => {
  const action = (
    overrides: Partial<LanguageServerCodeAction> = {},
  ): LanguageServerCodeAction => ({
    command: null,
    data: { uri: fileUriFromPath("/workspace/src/App.ts") },
    edit: null,
    isPreferred: false,
    kind: organizeImportsCodeActionKind,
    title: "Organize Imports",
    ...overrides,
  });

  it("returns the first data-only organize-imports action", () => {
    const organizeAction = action();

    expect(
      organizeImportsCodeActionToResolve([
        action({ kind: "source.fixAll" }),
        organizeAction,
      ]),
    ).toBe(organizeAction);
  });

  it("returns the first data-only remove-unused action for that requested kind", () => {
    const removeUnusedAction = action({ kind: removeUnusedCodeActionKind });

    expect(
      organizeImportsCodeActionToResolve(
        [action(), removeUnusedAction],
        removeUnusedCodeActionKind,
      ),
    ).toBe(removeUnusedAction);
  });

  it("ignores command-only actions", () => {
    expect(
      organizeImportsCodeActionToResolve([
        action({
          command: {
            arguments: [],
            command: "_typescript.organizeImports",
            title: "Organize Imports",
          },
          data: null,
        }),
      ]),
    ).toBeNull();
  });

  it("ignores actions that already carry inline edits", () => {
    expect(
      organizeImportsCodeActionToResolve([
        action({
          edit: {
            changes: {
              [fileUriFromPath("/workspace/src/App.ts")]: [
                {
                  newText: "",
                  range: {
                    start: { line: 0, character: 0 },
                    end: { line: 0, character: 0 },
                  },
                },
              ],
            },
          },
        }),
      ]),
    ).toBeNull();
  });
});
