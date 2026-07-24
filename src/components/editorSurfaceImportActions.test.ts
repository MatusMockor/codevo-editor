import { describe, expect, it, vi } from "vitest";
import { fileUriFromPath } from "../domain/languageServerDocumentSync";
import type {
  LanguageServerCodeAction,
  LanguageServerFeaturesGateway,
} from "../domain/languageServerFeatures";
import {
  editorSurfaceImportActionKind,
  executeEditorSurfaceImportAction,
} from "./editorSurfaceImportActions";

const path = "/workspace/src/example.ts";
const rootPath = "/workspace";
const uri = fileUriFromPath(path);
const content = "import { b, a } from './values';\n";
const editAction: LanguageServerCodeAction = {
  command: null,
  data: null,
  isPreferred: false,
  title: "Sort imports",
  kind: "source.sortImports.ts",
  edit: {
    changes: {
      [uri]: [
        {
          range: {
            start: { line: 0, character: 9 },
            end: { line: 0, character: 13 },
          },
          newText: "a, b",
        },
      ],
    },
    documentVersions: { [uri]: 7 },
  },
};

describe("editor surface import actions", () => {
  it("maps organize, sort, and remove-unused commands onto exact LSP source actions", () => {
    expect(editorSurfaceImportActionKind("editor.action.organizeImports", "typescript")).toBe(
      "source.organizeImports",
    );
    expect(editorSurfaceImportActionKind("typescript.sortImports", "typescriptreact")).toBe(
      "source.sortImports.ts",
    );
    expect(editorSurfaceImportActionKind("javascript.removeUnusedImports", "javascript")).toBe(
      "source.removeUnusedImports.ts",
    );
  });

  it("rejects language-mismatched and unrelated commands", () => {
    expect(editorSurfaceImportActionKind("typescript.sortImports", "javascript")).toBeNull();
    expect(editorSurfaceImportActionKind("javascript.sortImports", "typescript")).toBeNull();
    expect(editorSurfaceImportActionKind("editor.action.organizeImports", "php")).toBeNull();
    expect(editorSurfaceImportActionKind("editor.rename", "typescript")).toBeNull();
  });

  it("requests the exact action and applies validated same-file edits", async () => {
    const codeActions = vi.fn(async () => [editAction]);
    const apply = vi.fn(() => true);
    await expect(
      executeEditorSurfaceImportAction(request({ gateway: gateway({ codeActions }), apply })),
    ).resolves.toBe(true);

    expect(codeActions).toHaveBeenCalledWith(
      rootPath,
      path,
      {
        start: { line: 0, character: 0 },
        end: { line: 1, character: 0 },
      },
      { diagnostics: [], only: ["source.sortImports.ts"] },
    );
    expect(apply).toHaveBeenCalledWith(editAction.edit?.changes[uri]);
  });

  it("fails closed for no action and code-action throws or rejection", async () => {
    await expect(
      executeEditorSurfaceImportAction(
        request({ gateway: gateway({ codeActions: async () => [] }) }),
      ),
    ).resolves.toBe(false);
    await expect(
      executeEditorSurfaceImportAction(
        request({
          gateway: gateway({
            codeActions: () => {
              throw new Error("disposed");
            },
          }),
        }),
      ),
    ).resolves.toBe(false);
    await expect(
      executeEditorSurfaceImportAction(
        request({
          gateway: gateway({ codeActions: async () => Promise.reject(new Error("failed")) }),
        }),
      ),
    ).resolves.toBe(false);
  });

  it("rechecks authority after code-action and resolve async boundaries", async () => {
    let current = true;
    const codeActions = vi.fn(async () => {
      current = false;
      return [editAction];
    });
    const apply = vi.fn(() => true);
    await expect(
      executeEditorSurfaceImportAction(
        request({ gateway: gateway({ codeActions }), apply, isCurrent: () => current }),
      ),
    ).resolves.toBe(false);
    expect(apply).not.toHaveBeenCalled();

    current = true;
    const unresolved: LanguageServerCodeAction = {
      command: null,
      data: { id: 1 },
      edit: null,
      isPreferred: false,
      kind: "source.sortImports.ts",
      title: "Sort imports",
    };
    const resolveCodeAction = vi.fn(async () => {
      current = false;
      return editAction;
    });
    await expect(
      executeEditorSurfaceImportAction(
        request({
          apply,
          gateway: gateway({ codeActions: async () => [unresolved], resolveCodeAction }),
          isCurrent: () => current,
        }),
      ),
    ).resolves.toBe(false);
    expect(apply).not.toHaveBeenCalled();
  });

  it("rechecks authority after flush and immediately before apply", async () => {
    let current = true;
    const codeActions = vi.fn(async () => [editAction]);
    const apply = vi.fn(() => true);
    await expect(
      executeEditorSurfaceImportAction(
        request({
          apply,
          flush: async () => {
            current = false;
          },
          gateway: gateway({ codeActions }),
          isCurrent: () => current,
        }),
      ),
    ).resolves.toBe(false);
    expect(codeActions).not.toHaveBeenCalled();
    expect(apply).not.toHaveBeenCalled();

    let authorityChecks = 0;
    await expect(
      executeEditorSurfaceImportAction(
        request({
          apply,
          gateway: gateway({ codeActions: async () => [editAction] }),
          isCurrent: () => {
            authorityChecks += 1;
            return authorityChecks < 3;
          },
        }),
      ),
    ).resolves.toBe(false);
    expect(apply).not.toHaveBeenCalled();
  });

  it("rejects stale versions, foreign files, commands, and resolve rejection", async () => {
    const apply = vi.fn(() => true);
    const invalidActions: LanguageServerCodeAction[] = [
      {
        ...editAction,
        edit: { ...editAction.edit!, documentVersions: { [uri]: 6 } },
      },
      {
        ...editAction,
        edit: {
          changes: {
            ...editAction.edit!.changes,
            "file:///workspace/src/other.ts": editAction.edit!.changes[uri]!,
          },
        },
      },
      {
        ...editAction,
        command: { arguments: [], command: "unsafe", title: "Unsafe" },
      },
    ];
    for (const action of invalidActions) {
      await expect(
        executeEditorSurfaceImportAction(
          request({ apply, gateway: gateway({ codeActions: async () => [action] }) }),
        ),
      ).resolves.toBe(false);
    }

    await expect(
      executeEditorSurfaceImportAction(
        request({
          apply,
          gateway: gateway({
            codeActions: async () => [
              {
                command: null,
                data: {},
                edit: null,
                isPreferred: false,
                kind: "source.sortImports.ts",
                title: "Sort imports",
              },
            ],
            resolveCodeAction: async () => Promise.reject(new Error("failed")),
          }),
        }),
      ),
    ).resolves.toBe(false);
    expect(apply).not.toHaveBeenCalled();
  });

  it("skips disabled, empty, and invalid actions and prefers preferred actions stably", async () => {
    const preferred = {
      ...editAction,
      isPreferred: true,
      edit: {
        ...editAction.edit!,
        changes: {
          [uri]: [{ ...editAction.edit!.changes[uri]![0]!, newText: "preferred" }],
        },
      },
    };
    const apply = vi.fn(() => true);
    await expect(
      executeEditorSurfaceImportAction(
        request({
          apply,
          gateway: gateway({
            codeActions: async () => [
              { ...editAction, disabled: { reason: "Not available" } },
              { ...editAction, edit: { changes: { [uri]: [] } } },
              {
                ...editAction,
                edit: {
                  changes: {
                    [uri]: [
                      {
                        newText: "invalid",
                        range: {
                          start: { line: 99, character: 0 },
                          end: { line: 99, character: 1 },
                        },
                      },
                    ],
                  },
                },
              },
              editAction,
              preferred,
            ],
          }),
        }),
      ),
    ).resolves.toBe(true);
    expect(apply).toHaveBeenCalledWith(preferred.edit.changes[uri]);

    apply.mockClear();
    await expect(
      executeEditorSurfaceImportAction(
        request({
          apply,
          gateway: gateway({
            codeActions: async () => [
              {
                ...editAction,
                edit: {
                  changes: {
                    [uri]: [
                      {
                        newText: "invalid",
                        range: {
                          start: { line: 99, character: 0 },
                          end: { line: 99, character: 1 },
                        },
                      },
                    ],
                  },
                },
              },
              editAction,
            ],
          }),
        }),
      ),
    ).resolves.toBe(true);
    expect(apply).toHaveBeenCalledWith(editAction.edit!.changes[uri]);
  });

  it("accepts canonical same-file URI aliases but rejects conflicting alias versions", async () => {
    const alias = "file:///workspace/src/%65xample.ts";
    const aliased = {
      ...editAction,
      edit: {
        changes: { [alias]: editAction.edit!.changes[uri]! },
        documentVersions: { [alias]: 7 },
      },
    };
    await expect(
      executeEditorSurfaceImportAction(
        request({ gateway: gateway({ codeActions: async () => [aliased] }) }),
      ),
    ).resolves.toBe(true);

    const windowsUri = "file:///c:/workspace/src/example.ts";
    await expect(
      executeEditorSurfaceImportAction(
        request({
          gateway: gateway({
            codeActions: async () => [
              {
                ...editAction,
                edit: {
                  changes: { [windowsUri]: editAction.edit!.changes[uri]! },
                  documentVersions: { [windowsUri]: 7 },
                },
              },
            ],
          }),
          path: "C:\\Workspace\\src\\example.ts",
          rootPath: "C:\\Workspace",
          workspacePathPolicy: {
            caseSensitive: false,
            foldCase: (value) => value.toLowerCase(),
            unicodeNormalization: "none",
          },
        }),
      ),
    ).resolves.toBe(true);

    const caseAliased = {
      ...editAction,
      edit: {
        changes: {
          "file://localhost/WORKSPACE/SRC/EXAMPLE.TS": editAction.edit!.changes[uri]!,
        },
        documentVersions: { "file:///workspace/src/example.ts": 7 },
      },
    };
    await expect(
      executeEditorSurfaceImportAction(
        request({
          gateway: gateway({ codeActions: async () => [caseAliased] }),
          workspacePathPolicy: {
            caseSensitive: false,
            foldCase: (value) => value.toLowerCase(),
            unicodeNormalization: "none",
          },
        }),
      ),
    ).resolves.toBe(true);

    const uncUri = "file://server/share/example.ts";
    await expect(
      executeEditorSurfaceImportAction(
        request({
          gateway: gateway({
            codeActions: async () => [
              {
                ...editAction,
                edit: {
                  changes: { [uncUri]: editAction.edit!.changes[uri]! },
                  documentVersions: { [uncUri]: 7 },
                },
              },
            ],
          }),
          path: "\\\\SERVER\\Share\\example.ts",
          rootPath: "\\\\SERVER\\Share",
          workspacePathPolicy: {
            caseSensitive: false,
            foldCase: (value) => value.toLowerCase(),
            unicodeNormalization: "none",
          },
        }),
      ),
    ).resolves.toBe(true);

    const apply = vi.fn(() => true);
    await expect(
      executeEditorSurfaceImportAction(
        request({
          apply,
          gateway: gateway({
            codeActions: async () => [
              {
                ...aliased,
                edit: {
                  ...aliased.edit,
                  documentVersions: { [uri]: 7, [alias]: 8 },
                },
              },
            ],
          }),
        }),
      ),
    ).resolves.toBe(false);
    expect(apply).not.toHaveBeenCalled();

    apply.mockClear();
    await expect(
      executeEditorSurfaceImportAction(
        request({
          apply,
          gateway: gateway({
            codeActions: async () => [
              {
                ...aliased,
                edit: {
                  changes: {
                    [uri]: editAction.edit!.changes[uri]!,
                    [alias]: editAction.edit!.changes[uri]!,
                  },
                  documentVersions: { [uri]: 7 },
                },
              },
            ],
          }),
        }),
      ),
    ).resolves.toBe(false);
    expect(apply).not.toHaveBeenCalled();
  });

  it("aborts without a request when no authoritative sync version exists", async () => {
    const codeActions = vi.fn(async () => [editAction]);
    await expect(
      executeEditorSurfaceImportAction(
        request({ gateway: gateway({ codeActions }), version: () => null }),
      ),
    ).resolves.toBe(false);
    expect(codeActions).not.toHaveBeenCalled();
  });

  it("requires one exact numeric document version for the target", async () => {
    const apply = vi.fn(() => true);
    for (const documentVersions of [undefined, { [uri]: null }]) {
      await expect(
        executeEditorSurfaceImportAction(
          request({
            apply,
            gateway: gateway({
              codeActions: async () => [
                {
                  ...editAction,
                  edit: {
                    changes: editAction.edit!.changes,
                    ...(documentVersions === undefined ? {} : { documentVersions }),
                  },
                },
              ],
            }),
          }),
        ),
      ).resolves.toBe(false);
    }
    expect(apply).not.toHaveBeenCalled();
  });

  it("reads the LSP sync version after flush and reports only current operational failures", async () => {
    let syncVersion = 6;
    const reportError = vi.fn();
    await expect(
      executeEditorSurfaceImportAction(
        request({
          apply: () => false,
          flush: async () => {
            syncVersion = 7;
          },
          reportError,
          version: () => syncVersion,
        }),
      ),
    ).resolves.toBe(false);
    expect(reportError).toHaveBeenCalledTimes(1);

    let current = true;
    reportError.mockClear();
    await expect(
      executeEditorSurfaceImportAction(
        request({
          gateway: gateway({
            codeActions: async () => {
              current = false;
              throw new Error("private server detail");
            },
          }),
          isCurrent: () => current,
          reportError,
        }),
      ),
    ).resolves.toBe(false);
    expect(reportError).not.toHaveBeenCalled();
  });

  it("rejects a sync version that changes after an asynchronous LSP boundary", async () => {
    let syncVersion = 7;
    const apply = vi.fn(() => true);
    await expect(
      executeEditorSurfaceImportAction(
        request({
          apply,
          gateway: gateway({
            codeActions: async () => {
              syncVersion = 8;
              return [editAction];
            },
          }),
          version: () => syncVersion,
        }),
      ),
    ).resolves.toBe(false);
    expect(apply).not.toHaveBeenCalled();

    syncVersion = 7;
    const unresolved: LanguageServerCodeAction = {
      command: null,
      data: { id: 1 },
      edit: null,
      isPreferred: false,
      kind: "source.sortImports.ts",
      title: "Sort imports",
    };
    await expect(
      executeEditorSurfaceImportAction(
        request({
          apply,
          gateway: gateway({
            codeActions: async () => [unresolved],
            resolveCodeAction: async () => {
              syncVersion = 8;
              return editAction;
            },
          }),
          version: () => syncVersion,
        }),
      ),
    ).resolves.toBe(false);
    expect(apply).not.toHaveBeenCalled();

    let versionReads = 0;
    await expect(
      executeEditorSurfaceImportAction(
        request({
          apply,
          version: () => (++versionReads < 3 ? 7 : 8),
        }),
      ),
    ).resolves.toBe(false);
    expect(apply).not.toHaveBeenCalled();
  });
});

function request(
  overrides: Partial<Parameters<typeof executeEditorSurfaceImportAction>[0]> = {},
): Parameters<typeof executeEditorSurfaceImportAction>[0] {
  return {
    content,
    gateway: gateway({ codeActions: async () => [editAction] }),
    kind: "source.sortImports.ts",
    path,
    rootPath,
    version: () => 7,
    apply: () => true,
    flush: async () => undefined,
    isCurrent: () => true,
    reportError: () => undefined,
    ...overrides,
  };
}

function gateway(
  overrides: Partial<Pick<LanguageServerFeaturesGateway, "codeActions" | "resolveCodeAction">>,
): LanguageServerFeaturesGateway {
  return {
    codeActions: async () => [],
    resolveCodeAction: async (_rootPath, action) => action,
    ...overrides,
  } as LanguageServerFeaturesGateway;
}
