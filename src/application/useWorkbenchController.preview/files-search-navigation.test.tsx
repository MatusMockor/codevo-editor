// @vitest-environment jsdom

import { act } from "react";
import { describe, expect, it, vi } from "vitest";
import type {
  LanguageServerDiagnosticEvent,
  LanguageServerDiagnosticsGateway,
} from "../../domain/languageServerDiagnostics";
import { fileUriFromPath } from "../../domain/languageServerDocumentSync";
import {
  emptyLanguageServerCapabilities,
  type LanguageServerRuntimeStatus,
} from "../../domain/languageServerRuntime";
import { defaultAppSettings, defaultWorkspaceSettings } from "../../domain/settings";
import { defaultTextSearchOptions, type TextSearchResult } from "../../domain/workspace";
import type { WorkspaceFileChangeEvent } from "../../domain/workspaceFileChange";
import { flushTextSearchDebounce, waitForReact } from "../../test/reactTestLifecycle";
import {
  featuresGateway,
  flushAsyncTurns,
  javaScriptTypeScriptWorkspaceDescriptor,
  setupWorkbenchControllerTestHarness,
} from "../../test/workbenchControllerTestHarness";
import { type WorkbenchWorkspaceGateways } from "../useWorkbenchController";
import {
  createDeferred,
  directoryEntry,
  fileEntry,
  flushWorkspaceDirectoryRefresh,
  lineNumberOf,
  phpWorkspaceDescriptor,
  positionAfter,
  range,
  runCommand,
} from "./testSupport";

describe("useWorkbenchController file events, tests, search, and recent navigation", () => {
  const { renderController } = setupWorkbenchControllerTestHarness();

  it("aggregates TODO comments across workspace source files and skips dependency directories", async () => {
    const readDirectory = vi.fn(async (path: string) => {
      if (path === "/workspace") {
        return [
          directoryEntry("/workspace/app", "app"),
          directoryEntry("/workspace/vendor", "vendor"),
          directoryEntry("/workspace/node_modules", "node_modules"),
          fileEntry("/workspace/composer.lock", "composer.lock"),
        ];
      }

      if (path === "/workspace/app") {
        return [
          fileEntry("/workspace/app/UserController.php", "UserController.php"),
          fileEntry("/workspace/app/helper.ts", "helper.ts"),
        ];
      }

      throw new Error(`unexpected directory read: ${path}`);
    });
    const readTextFile = vi.fn(async (path: string) => {
      if (path === "/workspace/app/UserController.php") {
        return "<?php\n// TODO: wire the controller\nclass UserController {}\n";
      }

      if (path === "/workspace/app/helper.ts") {
        return "// FIXME drop legacy path\nexport const value = 1;\n";
      }

      return `// ${path}\n`;
    });
    const { getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace",
      },
      readDirectory,
      readTextFile,
    });
    await flushAsyncTurns();

    expect(getWorkbench().workspaceRoot).toBe("/workspace");

    await act(async () => {
      await getWorkbench().refreshWorkspaceTodos();
    });

    const todos = getWorkbench().workspaceTodos;

    expect(todos).toHaveLength(2);
    expect(todos).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          filePath: "/workspace/app/UserController.php",
          relativePath: "app/UserController.php",
          tag: "TODO",
          text: "wire the controller",
          line: 2,
        }),
        expect.objectContaining({
          filePath: "/workspace/app/helper.ts",
          relativePath: "app/helper.ts",
          tag: "FIXME",
          text: "drop legacy path",
          line: 1,
        }),
      ]),
    );
    expect(getWorkbench().workspaceTodosLoading).toBe(false);
    expect(readDirectory).not.toHaveBeenCalledWith("/workspace/vendor");
    expect(readDirectory).not.toHaveBeenCalledWith("/workspace/node_modules");
    expect(readTextFile).not.toHaveBeenCalledWith("/workspace/composer.lock");
  });
  it("drops TODO scan results when the workspace tab switches mid-scan", async () => {
    const workspaceARead = createDeferred<string>();
    const readDirectory = vi.fn(async (path: string) => {
      if (path === "/workspace-a") {
        return [fileEntry("/workspace-a/Todo.php", "Todo.php")];
      }

      if (path === "/workspace-b") {
        return [fileEntry("/workspace-b/Other.php", "Other.php")];
      }

      throw new Error(`unexpected directory read: ${path}`);
    });
    const readTextFile = vi.fn(async (path: string) => {
      if (path === "/workspace-a/Todo.php") {
        return workspaceARead.promise;
      }

      return `<?php\n// ${path}\n`;
    });
    const { getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace-a",
        workspaceTabs: ["/workspace-a", "/workspace-b"],
      },
      readDirectory,
      readTextFile,
    });
    await flushAsyncTurns();

    expect(getWorkbench().workspaceRoot).toBe("/workspace-a");

    let scanPromise: Promise<void> | null = null;
    act(() => {
      scanPromise = getWorkbench().refreshWorkspaceTodos();
    });

    await act(async () => {
      await getWorkbench().activateWorkspaceTab("/workspace-b");
    });
    await flushAsyncTurns();

    expect(getWorkbench().workspaceRoot).toBe("/workspace-b");

    await act(async () => {
      workspaceARead.resolve("<?php\n// TODO: stale workspace-a comment\nclass Todo {}\n");
      await scanPromise;
      await Promise.resolve();
    });

    // The stale /workspace-a comment must never appear inside /workspace-b.
    expect(
      getWorkbench().workspaceTodos.some((todo) => todo.filePath.startsWith("/workspace-a")),
    ).toBe(false);
    expect(getWorkbench().workspaceTodos).toEqual([]);
  });
  it("closes the tab, clears diagnostics and refreshes the tree on an external delete", async () => {
    let publishFileChange: ((event: WorkspaceFileChangeEvent) => void) | null = null;
    const readDirectory = vi.fn(async () => []);
    const workspaceFileChangeGateway: WorkbenchWorkspaceGateways["fileChanges"] = {
      startWatching: vi.fn(async () => undefined),
      subscribeFileChanges: vi.fn(async (listener) => {
        publishFileChange = listener;
        return () => undefined;
      }),
    };
    const { getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace",
      },
      readDirectory,
      workspaceFileChangeGateway,
    });
    await flushAsyncTurns();

    expect(getWorkbench().workspaceRoot).toBe("/workspace");

    const file = fileEntry("/workspace/src/User.php", "User.php");
    await act(async () => {
      await getWorkbench().openPinnedFile(file);
    });
    expect(getWorkbench().openDocuments).toHaveLength(1);

    readDirectory.mockClear();
    expect(publishFileChange).not.toBeNull();

    await act(async () => {
      publishFileChange?.({
        kind: "deleted",
        path: "/workspace/src/User.php",
        relativePath: "src/User.php",
        rootPath: "/workspace",
      });
      await flushAsyncTurns();
    });

    await flushWorkspaceDirectoryRefresh();

    expect(getWorkbench().openDocuments).toHaveLength(0);
    expect(readDirectory).toHaveBeenCalledWith("/workspace/src");
  });
  it("clears stale diagnostics when a dirty externally deleted PHP tab is closed later", async () => {
    let publishFileChange: ((event: WorkspaceFileChangeEvent) => void) | null = null;
    let publishDiagnostics: ((event: LanguageServerDiagnosticEvent) => void) | null = null;
    const filePath = "/workspace/src/CodevoQaController.php";
    const readDirectory = vi.fn(async () => []);
    const workspaceFileChangeGateway: WorkbenchWorkspaceGateways["fileChanges"] = {
      startWatching: vi.fn(async () => undefined),
      subscribeFileChanges: vi.fn(async (listener) => {
        publishFileChange = listener;
        return () => undefined;
      }),
    };
    const languageServerDiagnosticsGateway: LanguageServerDiagnosticsGateway = {
      subscribeDiagnostics: vi.fn(async (listener) => {
        publishDiagnostics = listener;
        return () => undefined;
      }),
    };
    const runningStatus: LanguageServerRuntimeStatus = {
      capabilities: emptyLanguageServerCapabilities(),
      kind: "running",
      rootPath: "/workspace",
      sessionId: 71,
    };
    const { dependencies, getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace",
      },
      languageServerDiagnosticsGateway,
      readDirectory,
      runtimeStatus: runningStatus,
      workspaceDescriptor: phpWorkspaceDescriptor(),
      workspaceFileChangeGateway,
    });
    await flushAsyncTurns(24);

    await act(async () => {
      await getWorkbench().openPinnedFile(fileEntry(filePath, "CodevoQaController.php"));
    });

    act(() => {
      getWorkbench().updateActiveDocument("<?php\nfinal class CodevoQaController {\n");
    });
    act(() => {
      publishDiagnostics?.({
        diagnostics: [
          {
            character: 0,
            line: 1,
            message: "PHPactor warning",
            severity: "warning",
            source: "phpactor",
          },
        ],
        rootPath: "/workspace",
        sessionId: 71,
        uri: fileUriFromPath(filePath),
        version: null,
      });
      getWorkbench().updateLocalPhpDiagnostics(filePath, [
        {
          character: 12,
          line: 1,
          message: "syntax error, unexpected end of file",
          severity: "error",
          source: "PHP Syntax",
        },
      ]);
    });
    await flushAsyncTurns();

    expect(getWorkbench().diagnosticsSummary).toEqual({
      errors: 1,
      warnings: 1,
    });

    await act(async () => {
      publishFileChange?.({
        kind: "deleted",
        path: filePath,
        relativePath: "src/CodevoQaController.php",
        rootPath: "/workspace",
      });
      await flushAsyncTurns();
    });

    expect(getWorkbench().openDocuments).toHaveLength(1);
    expect(getWorkbench().externalFileConflictState.conflict?.kind).toBe("deleted");

    await act(async () => {
      publishFileChange?.({
        kind: "modified",
        path: filePath,
        relativePath: "src/CodevoQaController.php",
        rootPath: "/workspace",
      });
      await flushAsyncTurns();
    });

    act(() => {
      publishDiagnostics?.({
        diagnostics: [
          {
            character: 0,
            line: 1,
            message: "late PHPactor warning",
            severity: "warning",
            source: "phpactor",
          },
        ],
        rootPath: "/workspace",
        sessionId: 71,
        uri: fileUriFromPath(filePath),
        version: null,
      });
      getWorkbench().updateLocalPhpDiagnostics(filePath, [
        {
          character: 12,
          line: 1,
          message: "late syntax error",
          severity: "error",
          source: "PHP Syntax",
        },
      ]);
    });
    await flushAsyncTurns();

    vi.mocked(dependencies.prompter.confirm).mockReturnValueOnce(true);
    act(() => {
      getWorkbench().closeDocument(filePath);
    });
    await flushAsyncTurns();

    expect(getWorkbench().openDocuments).toHaveLength(0);
    expect(getWorkbench().diagnosticsSummary).toEqual({
      errors: 0,
      warnings: 0,
    });
    expect(getWorkbench().languageServerDiagnosticsByPath[filePath]).toBe(undefined);
    expect(getWorkbench().notices.some((notice) => notice.groupKey?.includes(filePath))).toBe(
      false,
    );

    act(() => {
      publishDiagnostics?.({
        diagnostics: [
          {
            character: 0,
            line: 1,
            message: "post-close PHPactor warning",
            severity: "warning",
            source: "phpactor",
          },
        ],
        rootPath: "/workspace",
        sessionId: 71,
        uri: fileUriFromPath(filePath),
        version: null,
      });
      getWorkbench().updateLocalPhpDiagnostics(filePath, [
        {
          character: 12,
          line: 1,
          message: "post-close syntax error",
          severity: "error",
          source: "PHP Syntax",
        },
      ]);
    });
    await flushAsyncTurns();

    expect(getWorkbench().diagnosticsSummary).toEqual({
      errors: 0,
      warnings: 0,
    });
    expect(getWorkbench().notices.some((notice) => notice.groupKey?.includes(filePath))).toBe(
      false,
    );
  });
  it("clears diagnostics and suppresses a stale UnknownDocument reply after an external rename", async () => {
    // A file can be renamed on disk (outside the editor) while its tab is
    // still open in the SAME workspace. The old path's diagnostics must be
    // cleared immediately, and a late phpactor reply that still targets the
    // renamed-away path (a benign close race) must not resurrect an
    // UnknownDocument toast.
    let publishFileChange: ((event: WorkspaceFileChangeEvent) => void) | null = null;
    let publishDiagnostics: ((event: LanguageServerDiagnosticEvent) => void) | null = null;
    const oldPath = "/workspace/src/Invoice.php";
    const newPath = "/workspace/src/Receipt.php";
    const readDirectory = vi.fn(async () => []);
    const workspaceFileChangeGateway: WorkbenchWorkspaceGateways["fileChanges"] = {
      startWatching: vi.fn(async () => undefined),
      subscribeFileChanges: vi.fn(async (listener) => {
        publishFileChange = listener;
        return () => undefined;
      }),
    };
    const languageServerDiagnosticsGateway: LanguageServerDiagnosticsGateway = {
      subscribeDiagnostics: vi.fn(async (listener) => {
        publishDiagnostics = listener;
        return () => undefined;
      }),
    };
    const runningStatus: LanguageServerRuntimeStatus = {
      capabilities: emptyLanguageServerCapabilities(),
      kind: "running",
      rootPath: "/workspace",
      sessionId: 91,
    };
    const { getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace",
      },
      languageServerDiagnosticsGateway,
      readDirectory,
      runtimeStatus: runningStatus,
      workspaceDescriptor: phpWorkspaceDescriptor(),
      workspaceFileChangeGateway,
    });
    await flushAsyncTurns(24);

    await act(async () => {
      await getWorkbench().openPinnedFile(fileEntry(oldPath, "Invoice.php"));
    });
    expect(getWorkbench().openDocuments).toHaveLength(1);

    act(() => {
      publishDiagnostics?.({
        diagnostics: [
          {
            character: 0,
            line: 1,
            message: "PHPactor warning",
            severity: "warning",
            source: "phpactor",
          },
        ],
        rootPath: "/workspace",
        sessionId: 91,
        uri: fileUriFromPath(oldPath),
        version: null,
      });
    });
    await flushAsyncTurns();

    expect(getWorkbench().languageServerDiagnosticsByPath[oldPath]).toHaveLength(1);
    expect(getWorkbench().diagnosticsSummary).toEqual({
      errors: 0,
      warnings: 1,
    });

    readDirectory.mockClear();
    await act(async () => {
      publishFileChange?.({
        kind: "renamed",
        path: newPath,
        previousPath: oldPath,
        previousRelativePath: "src/Invoice.php",
        relativePath: "src/Receipt.php",
        rootPath: "/workspace",
      });
      await flushAsyncTurns();
    });
    await flushWorkspaceDirectoryRefresh();

    expect(getWorkbench().openDocuments).toHaveLength(0);
    expect(getWorkbench().languageServerDiagnosticsByPath[oldPath]).toBe(undefined);
    expect(getWorkbench().diagnosticsSummary).toEqual({
      errors: 0,
      warnings: 0,
    });

    const staleError = `UnknownDocument: Unknown text document "${fileUriFromPath(oldPath)}"`;
    act(() => {
      getWorkbench().reportLanguageServerError(staleError);
    });

    expect(
      getWorkbench().notices.some((notice) => notice.message.includes("UnknownDocument")),
    ).toBe(false);
    expect(getWorkbench().message).toBeNull();
  });
  it("clears local PHP diagnostics when a PHP tab is closed", async () => {
    const filePath = "/workspace/src/TransientSyntax.php";
    const { getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace",
      },
      readTextFile: vi.fn(async () => "<?php\nfinal class TransientSyntax {\n"),
      workspaceDescriptor: phpWorkspaceDescriptor(),
    });
    await flushAsyncTurns(24);

    await act(async () => {
      await getWorkbench().openPinnedFile(fileEntry(filePath, "TransientSyntax.php"));
    });

    act(() => {
      getWorkbench().updateLocalPhpDiagnostics(filePath, [
        {
          character: 12,
          line: 1,
          message: "syntax error, unexpected end of file",
          severity: "error",
          source: "PHP Syntax",
        },
      ]);
    });
    await flushAsyncTurns();

    expect(getWorkbench().diagnosticsSummary).toEqual({
      errors: 1,
      warnings: 0,
    });

    act(() => {
      getWorkbench().closeDocument(filePath);
    });
    await flushAsyncTurns();

    expect(getWorkbench().openDocuments).toHaveLength(0);
    expect(getWorkbench().diagnosticsSummary).toEqual({
      errors: 0,
      warnings: 0,
    });
    expect(getWorkbench().notices.some((notice) => notice.groupKey?.includes(filePath))).toBe(
      false,
    );
  });
  it("does not report a workspace error when refreshing a directory deleted with a file", async () => {
    let publishFileChange: ((event: WorkspaceFileChangeEvent) => void) | null = null;
    const readDirectory = vi.fn(async (path: string) => {
      if (path === "/workspace/src/Deleted") {
        throw new Error("Path is not a directory");
      }

      return [];
    });
    const workspaceFileChangeGateway: WorkbenchWorkspaceGateways["fileChanges"] = {
      startWatching: vi.fn(async () => undefined),
      subscribeFileChanges: vi.fn(async (listener) => {
        publishFileChange = listener;
        return () => undefined;
      }),
    };
    const { getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace",
      },
      readDirectory,
      workspaceFileChangeGateway,
    });
    await flushAsyncTurns();

    await act(async () => {
      publishFileChange?.({
        kind: "deleted",
        path: "/workspace/src/Deleted/User.php",
        relativePath: "src/Deleted/User.php",
        rootPath: "/workspace",
      });
      await flushAsyncTurns();
    });

    await flushWorkspaceDirectoryRefresh();

    expect(
      getWorkbench().notices.some(
        (notice) =>
          notice.source === "Workspace" && notice.message.includes("Path is not a directory"),
      ),
    ).toBe(false);
  });
  it("ignores stale-root file changes after a workspace switch", async () => {
    let publishFileChange: ((event: WorkspaceFileChangeEvent) => void) | null = null;
    const { getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace-a",
        workspaceTabs: ["/workspace-a", "/workspace-b"],
      },
      workspaceFileChangeGateway: {
        startWatching: vi.fn(async () => undefined),
        subscribeFileChanges: vi.fn(async (listener) => {
          publishFileChange = listener;
          return () => undefined;
        }),
      },
    });
    await flushAsyncTurns();

    await act(async () => {
      await getWorkbench().activateWorkspaceTab("/workspace-b");
    });

    act(() => {
      publishFileChange?.({
        kind: "modified",
        path: "/workspace-a/package.json",
        relativePath: "package.json",
        rootPath: "/workspace-a",
      });
    });

    expect(getWorkbench().jsTestContinuousRunVersion).toBe(0);

    act(() => {
      publishFileChange?.({
        kind: "modified",
        path: "/workspace-b/package.json",
        relativePath: "package.json",
        rootPath: "/workspace-b/",
      });
    });

    expect(getWorkbench().jsTestContinuousRunVersion).toBe(1);
  });
  it("refreshes a clean open PHP document when it is modified externally", async () => {
    let publishFileChange: ((event: WorkspaceFileChangeEvent) => void) | null = null;
    const filePath = "/workspace/src/User.php";
    const files = new Map<string, string>([[filePath, "<?php\nfinal class User {}\n"]]);
    const readTextFile = vi.fn(async (path: string) => {
      const content = files.get(path);

      if (content === undefined) {
        throw new Error(`missing: ${path}`);
      }

      return content;
    });
    const workspaceFileChangeGateway: WorkbenchWorkspaceGateways["fileChanges"] = {
      startWatching: vi.fn(async () => undefined),
      subscribeFileChanges: vi.fn(async (listener) => {
        publishFileChange = listener;
        return () => undefined;
      }),
    };
    const { getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace",
      },
      readTextFile,
      workspaceFileChangeGateway,
    });
    await flushAsyncTurns();

    await act(async () => {
      await getWorkbench().openPinnedFile(fileEntry(filePath, "User.php"));
    });
    expect(getWorkbench().activeDocument?.content).toContain("final class User");

    files.set(filePath, "<?php\nfinal class User\n{\n    public int $id;\n}\n");
    readTextFile.mockClear();

    await act(async () => {
      publishFileChange?.({
        kind: "modified",
        path: filePath,
        relativePath: "src/User.php",
        rootPath: "/workspace",
      });
      await flushAsyncTurns();
    });

    expect(readTextFile).toHaveBeenCalledWith(filePath);
    expect(getWorkbench().activeDocument?.content).toContain("public int $id");
    expect(getWorkbench().activeDocument?.savedContent).toBe(
      getWorkbench().activeDocument?.content,
    );
    expect(getWorkbench().dirtyCount).toBe(0);
  });
  it("does not overwrite an open PHP document edited while an external refresh is reading", async () => {
    let publishFileChange: ((event: WorkspaceFileChangeEvent) => void) | null = null;
    const filePath = "/workspace/src/User.php";
    const externalRead = createDeferred<string>();
    let externalReadPending = false;
    const readTextFile = vi.fn(async (path: string) => {
      if (path === filePath) {
        if (externalReadPending) {
          externalReadPending = false;
          return externalRead.promise;
        }

        return "<?php\nfinal class User {}\n";
      }

      return "";
    });
    const workspaceFileChangeGateway: WorkbenchWorkspaceGateways["fileChanges"] = {
      startWatching: vi.fn(async () => undefined),
      subscribeFileChanges: vi.fn(async (listener) => {
        publishFileChange = listener;
        return () => undefined;
      }),
    };
    const { getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace",
      },
      readTextFile,
      workspaceFileChangeGateway,
    });
    await flushAsyncTurns();

    await act(async () => {
      await getWorkbench().openPinnedFile(fileEntry(filePath, "User.php"));
    });

    await act(async () => {
      externalReadPending = true;
      publishFileChange?.({
        kind: "modified",
        path: filePath,
        relativePath: "src/User.php",
        rootPath: "/workspace",
      });
      await Promise.resolve();
    });

    act(() => {
      getWorkbench().updateActiveDocument("<?php\n// unsaved editor change\n");
    });

    await act(async () => {
      externalRead.resolve("<?php\n// external disk change\n");
      await flushAsyncTurns();
    });

    expect(getWorkbench().activeDocument?.content).toBe("<?php\n// unsaved editor change\n");
    expect(getWorkbench().activeDocument?.savedContent).toBe("<?php\nfinal class User {}\n");
    expect(getWorkbench().dirtyCount).toBe(1);
  });
  it("closes the tab for the previous path on an external rename", async () => {
    let publishFileChange: ((event: WorkspaceFileChangeEvent) => void) | null = null;
    const readDirectory = vi.fn(async () => []);
    const workspaceFileChangeGateway: WorkbenchWorkspaceGateways["fileChanges"] = {
      startWatching: vi.fn(async () => undefined),
      subscribeFileChanges: vi.fn(async (listener) => {
        publishFileChange = listener;
        return () => undefined;
      }),
    };
    const { getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace",
      },
      readDirectory,
      workspaceFileChangeGateway,
    });
    await flushAsyncTurns();

    const file = fileEntry("/workspace/src/User.php", "User.php");
    await act(async () => {
      await getWorkbench().openPinnedFile(file);
    });
    expect(getWorkbench().openDocuments).toHaveLength(1);

    readDirectory.mockClear();

    await act(async () => {
      publishFileChange?.({
        kind: "renamed",
        path: "/workspace/src/Account.php",
        previousPath: "/workspace/src/User.php",
        previousRelativePath: "src/User.php",
        relativePath: "src/Account.php",
        rootPath: "/workspace",
      });
      await flushAsyncTurns();
    });

    await flushWorkspaceDirectoryRefresh();

    expect(getWorkbench().openDocuments).toHaveLength(0);
    expect(readDirectory).toHaveBeenCalledWith("/workspace/src");
  });
  it("generates a PHPUnit test skeleton for the active PHP class and opens it", async () => {
    const sourcePath = "/workspace/app/Services/InvoiceService.php";
    const testPath = "/workspace/tests/Unit/Services/InvoiceServiceTest.php";
    const sourceContent = [
      "<?php",
      "",
      "namespace App\\Services;",
      "",
      "class InvoiceService",
      "{",
      "    public function calculate(): int { return 0; }",
      "    public function refund(): bool { return true; }",
      "}",
      "",
    ].join("\n");
    const files = new Map<string, string>([[sourcePath, sourceContent]]);
    const readTextFile = vi.fn(async (path: string) => {
      const content = files.get(path);

      if (content === undefined) {
        throw new Error(`missing: ${path}`);
      }

      return content;
    });
    const writeTextFile = vi.fn(async (path: string, content: string) => {
      files.set(path, content);
    });
    const { dependencies, getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace",
      },
      readTextFile,
      workspaceFiles: { writeTextFile },
      workspaceDescriptor: phpWorkspaceDescriptor({
        psr4Roots: [
          { dev: false, namespace: "App\\", paths: ["app/"] },
          { dev: true, namespace: "Tests\\", paths: ["tests/"] },
        ],
      }),
    });
    await flushAsyncTurns();

    await act(async () => {
      await getWorkbench().openPinnedFile(fileEntry(sourcePath, "InvoiceService.php"));
    });

    await act(async () => {
      await runCommand(getWorkbench(), "php.generateTest");
      await flushAsyncTurns();
    });

    void dependencies;
    expect(writeTextFile).toHaveBeenCalledTimes(1);
    const [writtenPath, writtenContent] = writeTextFile.mock.calls[0] as [string, string];
    expect(writtenPath).toBe(testPath);
    expect(writtenContent).toContain("namespace Tests\\Unit\\Services;");
    expect(writtenContent).toContain("use Tests\\TestCase;");
    expect(writtenContent).toContain("class InvoiceServiceTest extends TestCase");
    expect(writtenContent).toContain("public function testCalculate(): void");
    expect(writtenContent).toContain("public function testRefund(): void");
    expect(writtenContent).toContain("$this->markTestIncomplete();");
    expect(getWorkbench().activePath).toBe(testPath);
  });
  it("opens an existing test file instead of overwriting it", async () => {
    const sourcePath = "/workspace/app/Services/InvoiceService.php";
    const testPath = "/workspace/tests/Unit/Services/InvoiceServiceTest.php";
    const existingTest = "<?php\n// existing test that must be preserved\n";
    const sourceContent = [
      "<?php",
      "",
      "namespace App\\Services;",
      "",
      "class InvoiceService",
      "{",
      "    public function calculate(): int { return 0; }",
      "}",
      "",
    ].join("\n");
    const readTextFile = vi.fn(async (path: string) => {
      if (path === sourcePath) {
        return sourceContent;
      }

      if (path === testPath) {
        return existingTest;
      }

      throw new Error(`missing: ${path}`);
    });
    const { dependencies, getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace",
      },
      readTextFile,
      workspaceDescriptor: phpWorkspaceDescriptor({
        psr4Roots: [
          { dev: false, namespace: "App\\", paths: ["app/"] },
          { dev: true, namespace: "Tests\\", paths: ["tests/"] },
        ],
      }),
    });
    await flushAsyncTurns();

    await act(async () => {
      await getWorkbench().openPinnedFile(fileEntry(sourcePath, "InvoiceService.php"));
    });

    await act(async () => {
      await runCommand(getWorkbench(), "php.generateTest");
      await flushAsyncTurns();
    });

    expect(dependencies.workspaceGateways.files.writeTextFile).not.toHaveBeenCalled();
    expect(getWorkbench().activePath).toBe(testPath);
    expect(getWorkbench().activeDocument?.content).toBe(existingTest);
  });
  it("does not generate a test when the active document is not a class", async () => {
    const sourcePath = "/workspace/app/Contracts/InvoiceContract.php";
    const sourceContent = [
      "<?php",
      "",
      "namespace App\\Contracts;",
      "",
      "interface InvoiceContract",
      "{",
      "    public function calculate(): int;",
      "}",
      "",
    ].join("\n");
    const { dependencies, getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace",
      },
      readTextFile: vi.fn(async () => sourceContent),
      workspaceDescriptor: phpWorkspaceDescriptor({
        psr4Roots: [{ dev: false, namespace: "App\\", paths: ["app/"] }],
      }),
    });
    await flushAsyncTurns();

    await act(async () => {
      await getWorkbench().openPinnedFile(fileEntry(sourcePath, "InvoiceContract.php"));
    });

    await act(async () => {
      await runCommand(getWorkbench(), "php.generateTest");
      await flushAsyncTurns();
    });

    expect(dependencies.workspaceGateways.files.writeTextFile).not.toHaveBeenCalled();
    expect(getWorkbench().activePath).toBe(sourcePath);
  });
  it("drops a stale test generation when the workspace switches mid-flight", async () => {
    const sourcePath = "/workspace-a/app/Services/InvoiceService.php";
    const sourceContent = [
      "<?php",
      "",
      "namespace App\\Services;",
      "",
      "class InvoiceService",
      "{",
      "    public function calculate(): int { return 0; }",
      "}",
      "",
    ].join("\n");
    let releaseExistenceCheck: (() => void) | null = null;
    const readTextFile = vi.fn(async (path: string) => {
      if (path === sourcePath) {
        return sourceContent;
      }

      await new Promise<void>((resolve) => {
        releaseExistenceCheck = resolve;
      });

      throw new Error(`missing: ${path}`);
    });
    const { dependencies, getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace-a",
        workspaceTabs: ["/workspace-a", "/workspace-b"],
      },
      readTextFile,
      workspaceDescriptor: phpWorkspaceDescriptor({
        psr4Roots: [{ dev: false, namespace: "App\\", paths: ["app/"] }],
      }),
    });
    await flushAsyncTurns();

    await act(async () => {
      await getWorkbench().openPinnedFile(fileEntry(sourcePath, "InvoiceService.php"));
    });

    let generation: Promise<unknown> | null = null;
    act(() => {
      generation = runCommand(getWorkbench(), "php.generateTest");
    });
    await flushAsyncTurns();

    await act(async () => {
      await getWorkbench().activateWorkspaceTab("/workspace-b");
      await flushAsyncTurns();
    });

    await act(async () => {
      releaseExistenceCheck?.();
      await generation;
      await flushAsyncTurns();
    });

    expect(dependencies.workspaceGateways.files.writeTextFile).not.toHaveBeenCalled();
  });
  it("jumps from a source class to its existing Unit test", async () => {
    const sourcePath = "/workspace/app/Services/InvoiceService.php";
    const testPath = "/workspace/tests/Unit/Services/InvoiceServiceTest.php";
    const sourceContent = [
      "<?php",
      "",
      "namespace App\\Services;",
      "",
      "class InvoiceService",
      "{",
      "    public function calculate(): int { return 0; }",
      "}",
      "",
    ].join("\n");
    const testContent = "<?php\n// the existing unit test\n";
    const readTextFile = vi.fn(async (path: string) => {
      if (path === sourcePath) {
        return sourceContent;
      }

      if (path === testPath) {
        return testContent;
      }

      throw new Error(`missing: ${path}`);
    });
    const { dependencies, getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace",
      },
      readTextFile,
      workspaceDescriptor: phpWorkspaceDescriptor({
        psr4Roots: [
          { dev: false, namespace: "App\\", paths: ["app/"] },
          { dev: true, namespace: "Tests\\", paths: ["tests/"] },
        ],
      }),
    });
    await flushAsyncTurns();

    await act(async () => {
      await getWorkbench().openPinnedFile(fileEntry(sourcePath, "InvoiceService.php"));
    });

    await act(async () => {
      await runCommand(getWorkbench(), "php.goToTest");
      await flushAsyncTurns();
    });

    expect(dependencies.workspaceGateways.files.writeTextFile).not.toHaveBeenCalled();
    expect(getWorkbench().activePath).toBe(testPath);
    expect(getWorkbench().activeDocument?.content).toBe(testContent);
  });
  it("falls back to a Feature test when no Unit test exists", async () => {
    const sourcePath = "/workspace/app/Http/Controllers/UserController.php";
    const unitPath = "/workspace/tests/Unit/Http/Controllers/UserControllerTest.php";
    const featurePath = "/workspace/tests/Feature/Http/Controllers/UserControllerTest.php";
    const sourceContent = [
      "<?php",
      "",
      "namespace App\\Http\\Controllers;",
      "",
      "class UserController",
      "{",
      "    public function index(): int { return 0; }",
      "}",
      "",
    ].join("\n");
    const featureContent = "<?php\n// the existing feature test\n";
    const readTextFile = vi.fn(async (path: string) => {
      if (path === sourcePath) {
        return sourceContent;
      }

      if (path === featurePath) {
        return featureContent;
      }

      throw new Error(`missing: ${path}`);
    });
    const { getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace",
      },
      readTextFile,
      workspaceDescriptor: phpWorkspaceDescriptor({
        psr4Roots: [
          { dev: false, namespace: "App\\", paths: ["app/"] },
          { dev: true, namespace: "Tests\\", paths: ["tests/"] },
        ],
      }),
    });
    await flushAsyncTurns();

    await act(async () => {
      await getWorkbench().openPinnedFile(fileEntry(sourcePath, "UserController.php"));
    });

    await act(async () => {
      await runCommand(getWorkbench(), "php.goToTest");
      await flushAsyncTurns();
    });

    expect(readTextFile).toHaveBeenCalledWith(unitPath);
    expect(getWorkbench().activePath).toBe(featurePath);
    expect(getWorkbench().activeDocument?.content).toBe(featureContent);
  });
  it("jumps from a Feature test back to its production subject", async () => {
    const subjectPath = "/workspace/app/Http/Controllers/UserController.php";
    const testPath = "/workspace/tests/Feature/Http/Controllers/UserControllerTest.php";
    const testContent = [
      "<?php",
      "",
      "namespace Tests\\Feature\\Http\\Controllers;",
      "",
      "use Tests\\TestCase;",
      "",
      "class UserControllerTest extends TestCase",
      "{",
      "    public function testIndex(): void {}",
      "}",
      "",
    ].join("\n");
    const subjectContent = "<?php\n// the production controller\n";
    const readTextFile = vi.fn(async (path: string) => {
      if (path === testPath) {
        return testContent;
      }

      if (path === subjectPath) {
        return subjectContent;
      }

      throw new Error(`missing: ${path}`);
    });
    const { getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace",
      },
      readTextFile,
      workspaceDescriptor: phpWorkspaceDescriptor({
        psr4Roots: [
          { dev: false, namespace: "App\\", paths: ["app/"] },
          { dev: true, namespace: "Tests\\", paths: ["tests/"] },
        ],
      }),
    });
    await flushAsyncTurns();

    await act(async () => {
      await getWorkbench().openPinnedFile(fileEntry(testPath, "UserControllerTest.php"));
    });

    await act(async () => {
      await runCommand(getWorkbench(), "php.goToTest");
      await flushAsyncTurns();
    });

    expect(getWorkbench().activePath).toBe(subjectPath);
    expect(getWorkbench().activeDocument?.content).toBe(subjectContent);
  });
  it("reports a notice when no partner test exists on disk", async () => {
    const sourcePath = "/workspace/app/Services/InvoiceService.php";
    const sourceContent = [
      "<?php",
      "",
      "namespace App\\Services;",
      "",
      "class InvoiceService",
      "{",
      "    public function calculate(): int { return 0; }",
      "}",
      "",
    ].join("\n");
    const readTextFile = vi.fn(async (path: string) => {
      if (path === sourcePath) {
        return sourceContent;
      }

      throw new Error(`missing: ${path}`);
    });
    const { dependencies, getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace",
      },
      readTextFile,
      workspaceDescriptor: phpWorkspaceDescriptor({
        psr4Roots: [
          { dev: false, namespace: "App\\", paths: ["app/"] },
          { dev: true, namespace: "Tests\\", paths: ["tests/"] },
        ],
      }),
    });
    await flushAsyncTurns();

    await act(async () => {
      await getWorkbench().openPinnedFile(fileEntry(sourcePath, "InvoiceService.php"));
    });

    await act(async () => {
      await runCommand(getWorkbench(), "php.goToTest");
      await flushAsyncTurns();
    });

    expect(dependencies.workspaceGateways.files.writeTextFile).not.toHaveBeenCalled();
    expect(getWorkbench().activePath).toBe(sourcePath);
    expect(getWorkbench().message).toContain("No test found");
  });
  it("drops a stale go-to-test navigation when the workspace switches mid-flight", async () => {
    const sourcePath = "/workspace-a/app/Services/InvoiceService.php";
    const testPath = "/workspace-a/tests/Unit/Services/InvoiceServiceTest.php";
    const sourceContent = [
      "<?php",
      "",
      "namespace App\\Services;",
      "",
      "class InvoiceService",
      "{",
      "    public function calculate(): int { return 0; }",
      "}",
      "",
    ].join("\n");
    let releaseExistenceCheck: (() => void) | null = null;
    const readTextFile = vi.fn(async (path: string) => {
      if (path === sourcePath) {
        return sourceContent;
      }

      if (path === testPath) {
        await new Promise<void>((resolve) => {
          releaseExistenceCheck = resolve;
        });

        return "<?php\n// the unit test\n";
      }

      throw new Error(`missing: ${path}`);
    });
    const { getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace-a",
        workspaceTabs: ["/workspace-a", "/workspace-b"],
      },
      readTextFile,
      workspaceDescriptor: phpWorkspaceDescriptor({
        psr4Roots: [
          { dev: false, namespace: "App\\", paths: ["app/"] },
          { dev: true, namespace: "Tests\\", paths: ["tests/"] },
        ],
      }),
    });
    await flushAsyncTurns();

    await act(async () => {
      await getWorkbench().openPinnedFile(fileEntry(sourcePath, "InvoiceService.php"));
    });

    let navigation: Promise<unknown> | null = null;
    act(() => {
      navigation = runCommand(getWorkbench(), "php.goToTest");
    });
    await flushAsyncTurns();

    await act(async () => {
      await getWorkbench().activateWorkspaceTab("/workspace-b");
      await flushAsyncTurns();
    });

    await act(async () => {
      releaseExistenceCheck?.();
      await navigation;
      await flushAsyncTurns();
    });

    expect(getWorkbench().activePath).not.toBe(testPath);
  });
  it("keeps Composer scripts in the legacy manifest loader without shell-running Node scripts", async () => {
    const manifests = new Map([
      ["/workspace/composer.json", '{"scripts":{"test":"touch should-not-run"}}'],
      ["/workspace/package.json", '{"scripts":{"dev":"touch should-not-run"}}'],
    ]);
    const readTextFile = vi.fn(async (path: string) => {
      const manifest = manifests.get(path);

      if (manifest) {
        return manifest;
      }

      throw new Error(`missing: ${path}`);
    });
    const { dependencies, getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace",
      },
      readDirectory: vi.fn(async () => [
        fileEntry("/workspace/composer.json", "composer.json"),
        fileEntry("/workspace/package.json", "package.json"),
      ]),
      readTextFile,
    });

    await waitForReact(() => {
      expect(
        getWorkbench()
          .commands.filter((command) => command.id.startsWith("script."))
          .map(({ id, title }) => ({ id, title })),
      ).toEqual([
        { id: "script.composer.test", title: "composer: test" },
        { id: "script.node.stopCurrent", title: "Stop Current Package Script" },
      ]);
    });

    act(() => {
      getWorkbench().registerActiveTerminalSession(31);
    });
    await act(async () => {
      await runCommand(getWorkbench(), "script.composer.test");
    });

    expect(dependencies.terminalGateway.writeInput).toHaveBeenNthCalledWith(
      1,
      31,
      "composer run-script test\r",
    );
    expect(dependencies.terminalGateway.writeInput).toHaveBeenCalledTimes(1);

    manifests.set("/workspace/package.json", '{"scripts":{"changed":"vite build"}}');
    await flushAsyncTurns(24);

    expect(getWorkbench().commands.some((command) => command.id === "script.npm.changed")).toBe(
      false,
    );
  });
  it("does not create root-only Node commands from package.json contents", async () => {
    const readTextFile = vi.fn(async (path: string) => {
      if (path === "/workspace/package.json") {
        return '{"scripts":{"dev":"vite"}}';
      }

      throw new Error(`missing: ${path}`);
    });
    const { dependencies, getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace",
      },
      readDirectory: vi.fn(async () => [
        fileEntry("/workspace/package.json", "package.json"),
        fileEntry("/workspace/pnpm-lock.yaml", "pnpm-lock.yaml"),
      ]),
      readTextFile,
    });

    await flushAsyncTurns(24);
    expect(getWorkbench().commands.some((command) => command.id === "script.npm.dev")).toBe(false);

    act(() => {
      getWorkbench().registerActiveTerminalSession(41);
    });
    expect(dependencies.terminalGateway.writeInput).not.toHaveBeenCalled();
  });
  it("keeps package script palette commands isolated across workspaces", async () => {
    const readTextFile = vi.fn(async (path: string) => {
      if (path === "/workspace-a/composer.json") {
        return '{"scripts":{"test-a":"phpunit"}}';
      }

      if (path === "/workspace-b/package.json") {
        return '{"scripts":{"dev-b":"vite"}}';
      }

      throw new Error(`missing: ${path}`);
    });
    const { getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace-a",
        workspaceTabs: ["/workspace-a", "/workspace-b"],
      },
      readDirectory: vi.fn(async (path) =>
        path === "/workspace-a"
          ? [fileEntry(`${path}/composer.json`, "composer.json")]
          : [fileEntry(`${path}/package.json`, "package.json")],
      ),
      readTextFile,
    });

    await waitForReact(() => {
      expect(
        getWorkbench().commands.some((command) => command.id === "script.composer.test-a"),
      ).toBe(true);
    });

    await act(async () => {
      await getWorkbench().activateWorkspaceTab("/workspace-b");
    });
    await waitForReact(() => {
      expect(getWorkbench().commands.some((command) => command.id === "script.npm.dev-b")).toBe(
        false,
      );
    });

    expect(getWorkbench().commands.some((command) => command.id === "script.composer.test-a")).toBe(
      false,
    );
  });
  it("keeps Artisan palette commands isolated across workspaces", async () => {
    const { getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace-a",
        workspaceTabs: ["/workspace-a", "/workspace-b"],
      },
      readDirectory: vi.fn(async (path) =>
        path === "/workspace-a"
          ? [fileEntry(`${path}/artisan`, "artisan")]
          : [fileEntry(`${path}/Artisan`, "Artisan")],
      ),
    });

    await waitForReact(() => {
      expect(
        getWorkbench()
          .commands.filter((command) => command.id.startsWith("artisan."))
          .map((command) => command.title),
      ).toEqual([
        "artisan: about",
        "artisan: cache:clear",
        "artisan: config:show",
        "artisan: db:show",
        "artisan: make…",
        "artisan: migrate:status",
        "artisan: optimize:clear",
        "artisan: queue:failed",
        "artisan: route:list",
        "artisan: route:list in Terminal",
        "artisan: tinker",
      ]);
    });

    act(() => {
      getWorkbench()
        .commands.find(({ id }) => id === "artisan.make")
        ?.run();
    });
    expect(getWorkbench().artisanMakePaletteOpen).toBe(true);

    await act(async () => {
      await getWorkbench().activateWorkspaceTab("/workspace-b");
    });
    await waitForReact(() => {
      expect(getWorkbench().commands.some((command) => command.id.startsWith("artisan."))).toBe(
        false,
      );
    });
    expect(getWorkbench().artisanMakePaletteOpen).toBe(false);
  });
  it("runs a gutter test by writing an artisan --filter command into the active terminal", async () => {
    const testPath = "/workspace/tests/Unit/InvoiceServiceTest.php";
    const testSource = `<?php

namespace Tests\\Unit;

use Tests\\TestCase;

class InvoiceServiceTest extends TestCase
{
    public function testCalculate(): void
    {
    }
}
`;
    const readTextFile = vi.fn(async (path: string) => {
      if (path === testPath) {
        return testSource;
      }

      if (path === "/workspace/artisan") {
        return "#!/usr/bin/env php\n";
      }

      throw new Error(`missing: ${path}`);
    });
    const { dependencies, getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace",
      },
      readTextFile,
      workspaceDescriptor: phpWorkspaceDescriptor({
        psr4Roots: [
          { dev: false, namespace: "App\\", paths: ["app/"] },
          { dev: true, namespace: "Tests\\", paths: ["tests/"] },
        ],
      }),
    });
    await flushAsyncTurns();

    await act(async () => {
      await getWorkbench().openPinnedFile(fileEntry(testPath, "InvoiceServiceTest.php"));
    });

    // The terminal panel reports its session id once it mounts and starts.
    act(() => {
      getWorkbench().registerActiveTerminalSession(7);
    });

    await act(async () => {
      await getWorkbench().runTestAt({
        filter: "testCalculate",
        kind: "method",
        label: "Run testCalculate",
        match: "identifier",
        position: { column: 21, lineNumber: 9 },
      });
      await flushAsyncTurns();
    });

    expect(getWorkbench().bottomPanelView).toBe("terminal");
    expect(dependencies.terminalGateway.writeInput).toHaveBeenCalledWith(
      7,
      "php artisan test --filter testCalculate\r",
    );
  });
  it("falls back to vendor/bin/phpunit when there is no artisan binary", async () => {
    const testPath = "/workspace/tests/Unit/SampleTest.php";
    const testSource = `<?php

class SampleTest extends TestCase
{
    public function testItWorks(): void
    {
    }
}
`;
    const readTextFile = vi.fn(async (path: string) => {
      if (path === testPath) {
        return testSource;
      }

      throw new Error(`missing: ${path}`);
    });
    const { dependencies, getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace",
      },
      readTextFile,
      workspaceDescriptor: phpWorkspaceDescriptor({
        psr4Roots: [
          { dev: false, namespace: "App\\", paths: ["app/"] },
          { dev: true, namespace: "Tests\\", paths: ["tests/"] },
        ],
      }),
    });
    await flushAsyncTurns();

    await act(async () => {
      await getWorkbench().openPinnedFile(fileEntry(testPath, "SampleTest.php"));
    });

    act(() => {
      getWorkbench().registerActiveTerminalSession(3);
    });

    await act(async () => {
      await getWorkbench().runTestAt({
        filter: "SampleTest",
        kind: "class",
        label: "Run SampleTest",
        match: "identifier",
        position: { column: 7, lineNumber: 3 },
      });
      await flushAsyncTurns();
    });

    expect(dependencies.terminalGateway.writeInput).toHaveBeenCalledWith(
      3,
      "vendor/bin/phpunit --filter SampleTest\r",
    );
  });
  it("runs a JS gutter test by writing a vitest command into the active terminal", async () => {
    const testPath = "/workspace/src/sum.test.ts";
    const testSource = `describe("sum", () => {
  it("adds numbers", () => {});
});
`;
    const readTextFile = vi.fn(async (path: string) => {
      if (path === testPath) {
        return testSource;
      }

      if (path === "/workspace/vitest.config.ts") {
        return "export default {};";
      }

      throw new Error(`missing: ${path}`);
    });
    const { dependencies, getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace",
      },
      readTextFile,
      workspaceDescriptor: javaScriptTypeScriptWorkspaceDescriptor(),
    });
    await flushAsyncTurns();

    await act(async () => {
      await getWorkbench().openPinnedFile(fileEntry(testPath, "sum.test.ts"));
    });

    act(() => {
      getWorkbench().registerActiveTerminalSession(15);
    });

    await act(async () => {
      await getWorkbench().runTestAt({
        filter: "adds numbers",
        kind: "method",
        label: "Run adds numbers",
        match: "description",
        position: { column: 3, lineNumber: 2 },
      });
      await flushAsyncTurns();
    });

    expect(getWorkbench().bottomPanelView).toBe("terminal");
    expect(dependencies.terminalGateway.writeInput).toHaveBeenCalledWith(
      15,
      "node_modules/.bin/vitest run 'src/sum.test.ts' -t 'adds numbers'\r",
    );
  });
  it("runs the whole JS test file via the js.runTestFile command", async () => {
    const testPath = "/workspace/src/sum.test.ts";
    const testSource = `it("adds numbers", () => {});
`;
    const readTextFile = vi.fn(async (path: string) => {
      if (path === testPath) {
        return testSource;
      }

      if (path === "/workspace/vitest.config.ts") {
        return "export default {};";
      }

      throw new Error(`missing: ${path}`);
    });
    const { dependencies, getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace",
      },
      readTextFile,
      workspaceDescriptor: javaScriptTypeScriptWorkspaceDescriptor(),
    });
    await flushAsyncTurns();

    await act(async () => {
      await getWorkbench().openPinnedFile(fileEntry(testPath, "sum.test.ts"));
    });

    expect(getWorkbench().isActiveDocumentJsTest).toBe(true);

    act(() => {
      getWorkbench().registerActiveTerminalSession(16);
    });

    await act(async () => {
      await runCommand(getWorkbench(), "js.runTestFile");
      await flushAsyncTurns();
    });

    expect(dependencies.terminalGateway.writeInput).toHaveBeenCalledWith(
      16,
      "node_modules/.bin/vitest run 'src/sum.test.ts'\r",
    );
  });
  it("opens the shared test results panel and bumps only the JS run request version", async () => {
    const { getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace",
      },
      workspaceDescriptor: javaScriptTypeScriptWorkspaceDescriptor(),
    });
    await flushAsyncTurns();

    const phpVersionBefore = getWorkbench().phpTestRunRequestVersion;
    const jsVersionBefore = getWorkbench().jsTestRunRequestVersion;

    await act(async () => {
      await runCommand(getWorkbench(), "js.runTestsWithResultsPanel");
    });

    expect(String(getWorkbench().bottomPanelView)).toBe("testResults");
    expect(getWorkbench().bottomPanelVisible).toBe(true);
    expect(getWorkbench().jsTestRunRequestVersion).toBe(jsVersionBefore + 1);
    expect(getWorkbench().phpTestRunRequestVersion).toBe(phpVersionBefore);
  });
  it("does not flag a JS-test path carrying a non-JS language id as a JS test", async () => {
    const { getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace",
      },
      workspaceDescriptor: javaScriptTypeScriptWorkspaceDescriptor(),
    });
    await flushAsyncTurns();

    act(() => {
      getWorkbench().openReadOnlyDocument(
        {
          content: "plain text body",
          language: "plaintext",
          name: "sum.test.ts",
          path: "/workspace/src/sum.test.ts",
          readOnly: true,
          savedContent: "plain text body",
        },
        { pin: true },
      );
    });
    await flushAsyncTurns();

    expect(getWorkbench().activePath).toBe("/workspace/src/sum.test.ts");
    expect(getWorkbench().isActiveDocumentJsTest).toBe(false);
  });
  it("does not flag a PHP test document as a JS test", async () => {
    const testPath = "/workspace/tests/Unit/SampleTest.php";
    const readTextFile = vi.fn(async (path: string) => {
      if (path === testPath) {
        return "<?php\n\nclass SampleTest extends TestCase\n{\n}\n";
      }

      throw new Error(`missing: ${path}`);
    });
    const { getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace",
      },
      readTextFile,
      workspaceDescriptor: phpWorkspaceDescriptor({
        psr4Roots: [
          { dev: false, namespace: "App\\", paths: ["app/"] },
          { dev: true, namespace: "Tests\\", paths: ["tests/"] },
        ],
      }),
    });
    await flushAsyncTurns();

    await act(async () => {
      await getWorkbench().openPinnedFile(fileEntry(testPath, "SampleTest.php"));
    });

    expect(getWorkbench().isActiveDocumentPhpTest).toBe(true);
    expect(getWorkbench().isActiveDocumentJsTest).toBe(false);
  });
  it("runs a Pest test by description with a safely single-quoted --filter", async () => {
    const testPath = "/workspace/tests/Feature/CalculatorTest.php";
    const testSource = `<?php

it('adds two numbers', function () {
});
`;
    const readTextFile = vi.fn(async (path: string) => {
      if (path === testPath) {
        return testSource;
      }

      if (path === "/workspace/artisan") {
        return "#!/usr/bin/env php\n";
      }

      throw new Error(`missing: ${path}`);
    });
    const { dependencies, getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace",
      },
      readTextFile,
      workspaceDescriptor: phpWorkspaceDescriptor({
        psr4Roots: [
          { dev: false, namespace: "App\\", paths: ["app/"] },
          { dev: true, namespace: "Tests\\", paths: ["tests/"] },
        ],
      }),
    });
    await flushAsyncTurns();

    await act(async () => {
      await getWorkbench().openPinnedFile(fileEntry(testPath, "CalculatorTest.php"));
    });

    act(() => {
      getWorkbench().registerActiveTerminalSession(11);
    });

    await act(async () => {
      await getWorkbench().runTestAt({
        filter: "adds two numbers",
        kind: "method",
        label: "Run adds two numbers",
        match: "description",
        position: { column: 1, lineNumber: 3 },
      });
      await flushAsyncTurns();
    });

    expect(dependencies.terminalGateway.writeInput).toHaveBeenCalledWith(
      11,
      "php artisan test --filter 'adds two numbers'\r",
    );
  });
  it("safely quotes a malicious Pest description without injecting shell input", async () => {
    const testPath = "/workspace/tests/Feature/EvilTest.php";
    const { dependencies, getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace",
      },
      readTextFile: vi.fn(async (path: string) => {
        if (path === "/workspace/artisan") {
          return "#!/usr/bin/env php\n";
        }

        return "<?php\n";
      }),
      workspaceDescriptor: phpWorkspaceDescriptor(),
    });
    await flushAsyncTurns();

    await act(async () => {
      await getWorkbench().openPinnedFile(fileEntry(testPath, "EvilTest.php"));
    });

    act(() => {
      getWorkbench().registerActiveTerminalSession(13);
    });

    await act(async () => {
      await getWorkbench().runTestAt({
        filter: "boom'; rm -rf / #",
        kind: "method",
        label: "Run boom",
        match: "description",
        position: { column: 1, lineNumber: 3 },
      });
      await flushAsyncTurns();
    });

    expect(dependencies.terminalGateway.writeInput).toHaveBeenCalledWith(
      13,
      "php artisan test --filter 'boom'\\''; rm -rf / #'\r",
    );
  });
  it("never writes a command for a Pest description with a line break", async () => {
    const testPath = "/workspace/tests/Feature/NewlineTest.php";
    const { dependencies, getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace",
      },
      readTextFile: vi.fn(async () => "<?php\n"),
      workspaceDescriptor: phpWorkspaceDescriptor(),
    });
    await flushAsyncTurns();

    await act(async () => {
      await getWorkbench().openPinnedFile(fileEntry(testPath, "NewlineTest.php"));
    });

    act(() => {
      getWorkbench().registerActiveTerminalSession(15);
    });

    await act(async () => {
      await getWorkbench().runTestAt({
        filter: "evil\nrm -rf /",
        kind: "method",
        label: "Run evil",
        match: "description",
        position: { column: 1, lineNumber: 3 },
      });
      await flushAsyncTurns();
    });

    expect(dependencies.terminalGateway.writeInput).not.toHaveBeenCalled();
  });
  it("never writes a command for a maliciously named filter", async () => {
    const testPath = "/workspace/tests/Unit/SampleTest.php";
    const { dependencies, getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace",
      },
      readTextFile: vi.fn(async () => "<?php\n"),
      workspaceDescriptor: phpWorkspaceDescriptor(),
    });
    await flushAsyncTurns();

    await act(async () => {
      await getWorkbench().openPinnedFile(fileEntry(testPath, "SampleTest.php"));
    });

    act(() => {
      getWorkbench().registerActiveTerminalSession(5);
    });

    await act(async () => {
      await getWorkbench().runTestAt({
        filter: "foo; rm -rf /",
        kind: "method",
        label: "Run foo",
        match: "identifier",
        position: { column: 1, lineNumber: 1 },
      });
      await flushAsyncTurns();
    });

    expect(dependencies.terminalGateway.writeInput).not.toHaveBeenCalled();
  });
  it("drops a gutter test run after a workspace switch before the write", async () => {
    const testPath = "/workspace/tests/Unit/SampleTest.php";
    const testSource = `<?php

class SampleTest extends TestCase
{
    public function testItWorks(): void
    {
    }
}
`;
    let releaseArtisanProbe: (() => void) | null = null;
    const readTextFile = vi.fn(async (path: string) => {
      if (path === testPath) {
        return testSource;
      }

      if (path === "/workspace/artisan") {
        await new Promise<void>((resolve) => {
          releaseArtisanProbe = resolve;
        });
        return "#!/usr/bin/env php\n";
      }

      throw new Error(`missing: ${path}`);
    });
    const { dependencies, getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace",
      },
      readTextFile,
      workspaceDescriptor: phpWorkspaceDescriptor({
        psr4Roots: [
          { dev: false, namespace: "App\\", paths: ["app/"] },
          { dev: true, namespace: "Tests\\", paths: ["tests/"] },
        ],
      }),
    });
    await flushAsyncTurns();

    await act(async () => {
      await getWorkbench().openPinnedFile(fileEntry(testPath, "SampleTest.php"));
    });

    act(() => {
      getWorkbench().registerActiveTerminalSession(9);
    });

    let run: Promise<unknown> | null = null;
    act(() => {
      run = getWorkbench().runTestAt({
        filter: "testItWorks",
        kind: "method",
        label: "Run testItWorks",
        match: "identifier",
        position: { column: 21, lineNumber: 5 },
      });
    });
    await flushAsyncTurns();

    await act(async () => {
      await getWorkbench().activateWorkspaceTab("/workspace-b");
      await flushAsyncTurns();
    });

    await act(async () => {
      releaseArtisanProbe?.();
      await run;
      await flushAsyncTurns();
    });

    expect(dependencies.terminalGateway.writeInput).not.toHaveBeenCalled();
  });
  it("runs every test in a PHPUnit file by writing a whole-class --filter command", async () => {
    const testPath = "/workspace/tests/Unit/InvoiceServiceTest.php";
    const testSource = `<?php

namespace Tests\\Unit;

use Tests\\TestCase;

class InvoiceServiceTest extends TestCase
{
    public function testCalculate(): void
    {
    }

    public function testRefund(): void
    {
    }
}
`;
    const readTextFile = vi.fn(async (path: string) => {
      if (path === testPath) {
        return testSource;
      }

      if (path === "/workspace/artisan") {
        return "#!/usr/bin/env php\n";
      }

      throw new Error(`missing: ${path}`);
    });
    const { dependencies, getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace",
      },
      readTextFile,
      workspaceDescriptor: phpWorkspaceDescriptor({
        psr4Roots: [
          { dev: false, namespace: "App\\", paths: ["app/"] },
          { dev: true, namespace: "Tests\\", paths: ["tests/"] },
        ],
      }),
    });
    await flushAsyncTurns();

    await act(async () => {
      await getWorkbench().openPinnedFile(fileEntry(testPath, "InvoiceServiceTest.php"));
    });

    act(() => {
      getWorkbench().registerActiveTerminalSession(21);
    });

    await act(async () => {
      await runCommand(getWorkbench(), "php.runTestFile");
      await flushAsyncTurns();
    });

    expect(getWorkbench().bottomPanelView).toBe("terminal");
    expect(dependencies.terminalGateway.writeInput).toHaveBeenCalledWith(
      21,
      "php artisan test --filter InvoiceServiceTest\r",
    );
  });
  it("runs the whole suite for a Pest file with no test class", async () => {
    const testPath = "/workspace/tests/Feature/CalculatorTest.php";
    const testSource = `<?php

it('adds two numbers', function () {
});

it('subtracts two numbers', function () {
});
`;
    const readTextFile = vi.fn(async (path: string) => {
      if (path === testPath) {
        return testSource;
      }

      if (path === "/workspace/artisan") {
        return "#!/usr/bin/env php\n";
      }

      throw new Error(`missing: ${path}`);
    });
    const { dependencies, getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace",
      },
      readTextFile,
      workspaceDescriptor: phpWorkspaceDescriptor({
        psr4Roots: [
          { dev: false, namespace: "App\\", paths: ["app/"] },
          { dev: true, namespace: "Tests\\", paths: ["tests/"] },
        ],
      }),
    });
    await flushAsyncTurns();

    await act(async () => {
      await getWorkbench().openPinnedFile(fileEntry(testPath, "CalculatorTest.php"));
    });

    act(() => {
      getWorkbench().registerActiveTerminalSession(23);
    });

    await act(async () => {
      await runCommand(getWorkbench(), "php.runTestFile");
      await flushAsyncTurns();
    });

    expect(dependencies.terminalGateway.writeInput).toHaveBeenCalledWith(23, "php artisan test\r");
  });
  it("enables Run All Tests in File only on a PHP test document", async () => {
    const testPath = "/workspace/tests/Unit/SampleTest.php";
    const productionPath = "/workspace/app/Services/SampleService.php";
    const readTextFile = vi.fn(async (path: string) => {
      if (path === testPath) {
        return "<?php\n\nclass SampleTest extends TestCase\n{\n}\n";
      }

      if (path === productionPath) {
        return "<?php\n\nnamespace App\\Services;\n\nclass SampleService\n{\n}\n";
      }

      throw new Error(`missing: ${path}`);
    });
    const { getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace",
      },
      readTextFile,
      workspaceDescriptor: phpWorkspaceDescriptor({
        psr4Roots: [
          { dev: false, namespace: "App\\", paths: ["app/"] },
          { dev: true, namespace: "Tests\\", paths: ["tests/"] },
        ],
      }),
    });
    await flushAsyncTurns();

    const command = () => getWorkbench().commands.find((entry) => entry.id === "php.runTestFile");

    expect(command()?.title).toBe("Run All Tests in File");

    await act(async () => {
      await getWorkbench().openPinnedFile(fileEntry(testPath, "SampleTest.php"));
    });

    expect(command()?.isEnabled(getWorkbench().commandContext)).toBe(true);

    await act(async () => {
      await getWorkbench().openPinnedFile(fileEntry(productionPath, "SampleService.php"));
    });

    expect(command()?.isEnabled(getWorkbench().commandContext)).toBe(false);
  });
  it("drops a Run All Tests in File run after a workspace switch before the write", async () => {
    const testPath = "/workspace/tests/Unit/SampleTest.php";
    const testSource = `<?php

class SampleTest extends TestCase
{
    public function testItWorks(): void
    {
    }
}
`;
    let releaseArtisanProbe: (() => void) | null = null;
    const readTextFile = vi.fn(async (path: string) => {
      if (path === testPath) {
        return testSource;
      }

      if (path === "/workspace/artisan") {
        await new Promise<void>((resolve) => {
          releaseArtisanProbe = resolve;
        });
        return "#!/usr/bin/env php\n";
      }

      throw new Error(`missing: ${path}`);
    });
    const { dependencies, getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace",
      },
      readTextFile,
      workspaceDescriptor: phpWorkspaceDescriptor({
        psr4Roots: [
          { dev: false, namespace: "App\\", paths: ["app/"] },
          { dev: true, namespace: "Tests\\", paths: ["tests/"] },
        ],
      }),
    });
    await flushAsyncTurns();

    await act(async () => {
      await getWorkbench().openPinnedFile(fileEntry(testPath, "SampleTest.php"));
    });

    act(() => {
      getWorkbench().registerActiveTerminalSession(25);
    });

    let run: Promise<unknown> | null = null;
    act(() => {
      run = runCommand(getWorkbench(), "php.runTestFile");
    });
    await flushAsyncTurns();

    await act(async () => {
      await getWorkbench().activateWorkspaceTab("/workspace-b");
      await flushAsyncTurns();
    });

    await act(async () => {
      releaseArtisanProbe?.();
      await run;
      await flushAsyncTurns();
    });

    expect(dependencies.terminalGateway.writeInput).not.toHaveBeenCalled();
  });
  it("keeps light Cmd+B PHP navigation on the bounded PSR-4 path without PHPactor", async () => {
    const sourcePath = "/workspace/app/Http/Controllers/UserController.php";
    const userPath = "/workspace/app/Models/User.php";
    const source = `<?php

namespace App\\Http\\Controllers;

use App\\Models\\User;

class UserController
{
    public function show(User $user): void
    {
    }
}
`;
    const userSource = `<?php

namespace App\\Models;

class User
{
}
`;
    const files = new Map<string, string>([
      [sourcePath, source],
      [userPath, userSource],
    ]);

    for (let index = 0; index < 1_000; index += 1) {
      files.set(
        `/workspace/app/Noise/Noise${index}.php`,
        `<?php\n\nnamespace App\\Noise;\n\nclass Noise${index}\n{\n}\n`,
      );
    }

    const readTextFile = vi.fn(async (requestedPath: string) => {
      const content = files.get(requestedPath);

      if (content === undefined) {
        throw new Error(`missing: ${requestedPath}`);
      }

      return content;
    });
    const searchFiles = vi.fn(async () => {
      throw new Error("light PHP navigation must not use broad file search");
    });
    const searchText = vi.fn(async () => {
      throw new Error("light PHP navigation must not use text search");
    });
    const phpToolGateway: WorkbenchWorkspaceGateways["phpTools"] = {
      detectPhpTools: vi.fn(async () => ({
        intelephense: null,
        phpactor: null,
      })),
      installManagedPhpactor: vi.fn(async () => undefined),
      subscribeManagedPhpactorInstall: vi.fn(async () => () => undefined),
    };
    const { dependencies, getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace",
      },
      phpToolGateway,
      readTextFile,
      searchFiles,
      searchText,
      workspaceDescriptor: phpWorkspaceDescriptor({
        psr4Roots: [{ dev: false, namespace: "App\\", paths: ["app/"] }],
      }),
      workspaceSettings: {
        ...defaultWorkspaceSettings(),
        intelligenceMode: "basic",
      },
    });
    await flushAsyncTurns(24);

    await act(async () => {
      await getWorkbench().openPinnedFile(fileEntry(sourcePath, "UserController.php"));
    });
    await flushAsyncTurns(24);

    act(() => {
      getWorkbench().updateActiveEditorPosition(positionAfter(source, "show(U"));
    });

    await act(async () => {
      await getWorkbench().goToDefinition();
    });
    await flushAsyncTurns(24);

    const contentReadPaths = readTextFile.mock.calls
      .map(([path]) => path)
      .filter(
        (path): path is string => typeof path === "string" && !path.endsWith("/.editorconfig"),
      );

    expect(getWorkbench().intelligenceMode).toBe("basic");
    expect(getWorkbench().activePath).toBe(userPath);
    expect(getWorkbench().editorRevealTarget).toEqual({
      path: userPath,
      position: {
        column: 7,
        lineNumber: lineNumberOf(userSource, "class User"),
      },
    });
    expect(contentReadPaths).toEqual([sourcePath, userPath, userPath]);
    expect(searchFiles).not.toHaveBeenCalled();
    expect(searchText).not.toHaveBeenCalled();
    expect(
      dependencies.workspaceGateways.projectSymbols.searchProjectSymbols,
    ).not.toHaveBeenCalled();
    expect(phpToolGateway.detectPhpTools).not.toHaveBeenCalled();
    expect(dependencies.languageServerFeaturesGateway.definition).not.toHaveBeenCalled();
    expect(dependencies.languageServerFeaturesGateway.declaration).not.toHaveBeenCalled();
    expect(dependencies.languageServerFeaturesGateway.implementation).not.toHaveBeenCalled();
    expect(dependencies.languageServerFeaturesGateway.typeDefinition).not.toHaveBeenCalled();
  });
  it("switches IDE PHPactor navigation off without leaking stale LSP results into light PSR-4 navigation", async () => {
    const sourcePath = "/workspace/app/Http/Controllers/UserController.php";
    const staleIdePath = "/workspace/vendor/acme/IdeOnly.php";
    const userPath = "/workspace/app/Models/User.php";
    const ideSource = `<?php

namespace App\\Http\\Controllers;

use App\\Services\\IdeOnly;

class UserController
{
    public function show(IdeOnly $service): void
    {
    }
}
`;
    const lightSource = `<?php

namespace App\\Http\\Controllers;

use App\\Models\\User;

class UserController
{
    public function show(User $user): void
    {
    }
}
`;
    const staleIdeSource = `<?php

namespace Vendor\\Acme;

class IdeOnly
{
}
`;
    const userSource = `<?php

namespace App\\Models;

class User
{
}
`;
    const files = new Map<string, string>([
      [sourcePath, ideSource],
      [staleIdePath, staleIdeSource],
      [userPath, userSource],
    ]);
    const readTextFile = vi.fn(async (requestedPath: string) => {
      const content = files.get(requestedPath);

      if (content === undefined) {
        throw new Error(`missing: ${requestedPath}`);
      }

      return content;
    });
    const languageServerFeaturesGateway = featuresGateway();
    vi.mocked(languageServerFeaturesGateway.definition).mockResolvedValue([
      {
        range: range(4, 6, 4, 13),
        uri: fileUriFromPath(staleIdePath),
      },
    ]);
    const runningStatus: LanguageServerRuntimeStatus = {
      capabilities: {
        ...emptyLanguageServerCapabilities(),
        definition: true,
      },
      kind: "running",
      rootPath: "/workspace",
      sessionId: 91,
    };
    const searchFiles = vi.fn(async () => {
      throw new Error("light PHP navigation must not use broad file search");
    });
    const searchText = vi.fn(async () => {
      throw new Error("light PHP navigation must not use text search");
    });
    const { dependencies, getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace",
      },
      languageServerFeaturesGateway,
      readTextFile,
      runtimeStatus: runningStatus,
      searchFiles,
      searchText,
      workspaceDescriptor: phpWorkspaceDescriptor({
        psr4Roots: [{ dev: false, namespace: "App\\", paths: ["app/"] }],
      }),
      workspaceSettings: {
        ...defaultWorkspaceSettings(),
        intelligenceMode: "fullSmart",
      },
    });
    await flushAsyncTurns(24);

    await act(async () => {
      await getWorkbench().openPinnedFile(fileEntry(sourcePath, "UserController.php"));
    });
    await flushAsyncTurns(24);

    act(() => {
      getWorkbench().updateActiveEditorPosition(positionAfter(ideSource, "show(I"));
    });

    await act(async () => {
      await getWorkbench().goToDefinition();
    });
    await flushAsyncTurns(24);

    expect(getWorkbench().activePath).toBe(staleIdePath);
    expect(languageServerFeaturesGateway.definition).toHaveBeenCalledTimes(1);

    await act(async () => {
      await getWorkbench().openPinnedFile(fileEntry(sourcePath, "UserController.php"));
    });
    await flushAsyncTurns(24);

    act(() => {
      getWorkbench().updateActiveDocument(lightSource);
      getWorkbench().updateActiveEditorPosition(positionAfter(lightSource, "show(U"));
    });

    await act(async () => {
      await getWorkbench().setSmartMode("basic");
    });
    await flushAsyncTurns(24);

    vi.mocked(dependencies.workspaceGateways.projectSymbols.searchProjectSymbols).mockClear();
    searchFiles.mockClear();
    searchText.mockClear();
    readTextFile.mockClear();

    await act(async () => {
      await getWorkbench().goToDefinition();
    });
    await flushAsyncTurns(24);

    expect(getWorkbench().intelligenceMode).toBe("basic");
    expect(getWorkbench().activePath).toBe(userPath);
    expect(getWorkbench().editorRevealTarget).toEqual({
      path: userPath,
      position: {
        column: 7,
        lineNumber: lineNumberOf(userSource, "class User"),
      },
    });
    expect(languageServerFeaturesGateway.definition).toHaveBeenCalledTimes(1);
    expect(searchFiles).not.toHaveBeenCalled();
    expect(searchText).not.toHaveBeenCalled();
    expect(
      dependencies.workspaceGateways.projectSymbols.searchProjectSymbols,
    ).not.toHaveBeenCalled();
    expect(
      readTextFile.mock.calls
        .map(([path]) => path)
        .filter(
          (path): path is string => typeof path === "string" && !path.endsWith("/.editorconfig"),
        ),
    ).toEqual([userPath, userPath]);
  });
  it("navigates a typed member property to its declared type class", async () => {
    const servicePath = "/workspace/app/Services/PostService.php";
    const repositoryPath = "/workspace/app/Repositories/PostRepository.php";
    const serviceSource = `<?php

namespace App\\Services;

use App\\Repositories\\PostRepository;

class PostService
{
    private PostRepository $postRepository;

    public function index(): void
    {
        $this->postRepository->getFilteredPosts();
    }
}
`;
    const repositorySource = `<?php

namespace App\\Repositories;

class PostRepository
{
    public function getFilteredPosts(): array
    {
        return [];
    }
}
`;
    const readTextFile = vi.fn(async (requestedPath: string) => {
      if (requestedPath === servicePath) {
        return serviceSource;
      }

      if (requestedPath === repositoryPath) {
        return repositorySource;
      }

      return "";
    });
    const { getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace",
      },
      readTextFile,
      workspaceDescriptor: phpWorkspaceDescriptor(),
      workspaceSettings: {
        ...defaultWorkspaceSettings(),
        intelligenceMode: "fullSmart",
      },
    });
    await flushAsyncTurns(24);

    await act(async () => {
      await getWorkbench().openFile(fileEntry(servicePath, "PostService.php"));
    });
    await flushAsyncTurns(24);

    const chainPropertyEnd = positionAfter(
      serviceSource,
      "$this->postRepository->getFilteredPosts",
    );

    act(() => {
      // Cursor on the `postRepository` member property in
      // `$this->postRepository->getFilteredPosts()`.
      getWorkbench().updateActiveEditorPosition({
        column: chainPropertyEnd.column - "->getFilteredPosts".length,
        lineNumber: chainPropertyEnd.lineNumber,
      });
    });

    await act(async () => {
      await getWorkbench().goToDefinition();
    });
    await flushAsyncTurns(24);

    // Navigates to the PostRepository CLASS declaration (its type), not the
    // property declaration line in PostService.
    expect(getWorkbench().activePath).toBe(repositoryPath);
    expect(getWorkbench().editorRevealTarget).toEqual({
      path: repositoryPath,
      position: {
        column: 7,
        lineNumber: lineNumberOf(repositorySource, "class PostRepository"),
      },
    });
  });
  it("still navigates a member chain method call to the resolved method", async () => {
    const servicePath = "/workspace/app/Services/PostService.php";
    const repositoryPath = "/workspace/app/Repositories/PostRepository.php";
    const serviceSource = `<?php

namespace App\\Services;

use App\\Repositories\\PostRepository;

class PostService
{
    private PostRepository $postRepository;

    public function index(): void
    {
        $this->postRepository->getFilteredPosts();
    }
}
`;
    const repositorySource = `<?php

namespace App\\Repositories;

class PostRepository
{
    public function getFilteredPosts(): array
    {
        return [];
    }
}
`;
    const readTextFile = vi.fn(async (requestedPath: string) => {
      if (requestedPath === servicePath) {
        return serviceSource;
      }

      if (requestedPath === repositoryPath) {
        return repositorySource;
      }

      return "";
    });
    const { getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace",
      },
      readTextFile,
      workspaceDescriptor: phpWorkspaceDescriptor(),
      workspaceSettings: {
        ...defaultWorkspaceSettings(),
        intelligenceMode: "fullSmart",
      },
    });
    await flushAsyncTurns(24);

    await act(async () => {
      await getWorkbench().openFile(fileEntry(servicePath, "PostService.php"));
    });
    await flushAsyncTurns(24);

    act(() => {
      getWorkbench().updateActiveEditorPosition(positionAfter(serviceSource, "getFilteredPosts"));
    });

    await act(async () => {
      await getWorkbench().goToDefinition();
    });
    await flushAsyncTurns(24);

    // The chained method call resolves to the method declaration (its name
    // position), NOT the PostRepository class declaration - member-property
    // type-class navigation must not hijack method-call navigation.
    const methodNameEnd = positionAfter(repositorySource, "function getFilteredPosts");

    expect(getWorkbench().editorRevealTarget).toEqual({
      path: repositoryPath,
      position: {
        column: methodNameEnd.column - "getFilteredPosts".length,
        lineNumber: methodNameEnd.lineNumber,
      },
    });
  });
  it("records opened files in the recent files buffer, newest first", async () => {
    const { getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace",
      },
    });
    await flushAsyncTurns();

    await act(async () => {
      await getWorkbench().openPinnedFile(fileEntry("/workspace/a.ts", "a.ts"));
    });
    await act(async () => {
      await getWorkbench().openPinnedFile(fileEntry("/workspace/b.ts", "b.ts"));
    });

    expect(getWorkbench().recentFiles.map((entry) => entry.path)).toEqual([
      "/workspace/b.ts",
      "/workspace/a.ts",
    ]);
  });
  it("moves a re-opened file to the head of the recent files buffer", async () => {
    const { getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace",
      },
    });
    await flushAsyncTurns();

    await act(async () => {
      await getWorkbench().openPinnedFile(fileEntry("/workspace/a.ts", "a.ts"));
    });
    await act(async () => {
      await getWorkbench().openPinnedFile(fileEntry("/workspace/b.ts", "b.ts"));
    });
    await act(async () => {
      getWorkbench().setActivePath("/workspace/a.ts");
      await Promise.resolve();
    });

    expect(getWorkbench().recentFiles.map((entry) => entry.path)).toEqual([
      "/workspace/a.ts",
      "/workspace/b.ts",
    ]);
  });
  it("drops the active file from the switcher entries so the previous file leads", async () => {
    const { getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace",
      },
    });
    await flushAsyncTurns();

    await act(async () => {
      await getWorkbench().openPinnedFile(fileEntry("/workspace/a.ts", "a.ts"));
    });
    await act(async () => {
      await getWorkbench().openPinnedFile(fileEntry("/workspace/b.ts", "b.ts"));
    });

    expect(getWorkbench().activePath).toBe("/workspace/b.ts");
    expect(getWorkbench().recentFilesSwitcherEntries.map((entry) => entry.path)).toEqual([
      "/workspace/a.ts",
    ]);
  });
  it("opens the recent files switcher and opens the chosen file, closing the switcher", async () => {
    const { getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace",
      },
    });
    await flushAsyncTurns();

    await act(async () => {
      await getWorkbench().openPinnedFile(fileEntry("/workspace/a.ts", "a.ts"));
    });
    await act(async () => {
      await getWorkbench().openPinnedFile(fileEntry("/workspace/b.ts", "b.ts"));
    });

    act(() => {
      getWorkbench().openRecentFilesSwitcher();
    });

    expect(getWorkbench().recentFilesSwitcherOpen).toBe(true);

    const previous = getWorkbench().recentFilesSwitcherEntries[0];

    await act(async () => {
      await getWorkbench().openRecentFile(previous);
    });

    expect(getWorkbench().activePath).toBe("/workspace/a.ts");
    expect(getWorkbench().recentFilesSwitcherOpen).toBe(false);
  });
  it("prunes a dead recent file when opening it from quick open fails", async () => {
    let failReads = false;
    const readTextFile = vi.fn(async (path: string) => {
      if (failReads && path.endsWith("a.ts")) {
        throw new Error("file vanished");
      }
      return "";
    });
    const { getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace",
      },
      readTextFile,
    });
    await flushAsyncTurns();

    await act(async () => {
      await getWorkbench().openPinnedFile(fileEntry("/workspace/a.ts", "a.ts"));
    });
    await act(async () => {
      await getWorkbench().openPinnedFile(fileEntry("/workspace/b.ts", "b.ts"));
    });

    expect(getWorkbench().recentFiles.map((entry) => entry.path)).toContain("/workspace/a.ts");

    act(() => {
      getWorkbench().closeDocument("/workspace/a.ts");
    });

    failReads = true;
    await act(async () => {
      await getWorkbench().openSearchResult({
        name: "a.ts",
        path: "/workspace/a.ts",
        relativePath: "a.ts",
      });
    });

    expect(getWorkbench().recentFiles.map((entry) => entry.path)).not.toContain("/workspace/a.ts");
  });
  it("closes the recent files switcher when another overlay opens", async () => {
    const { getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace",
      },
    });
    await flushAsyncTurns();

    act(() => {
      getWorkbench().openRecentFilesSwitcher();
    });

    expect(getWorkbench().recentFilesSwitcherOpen).toBe(true);

    act(() => {
      getWorkbench().setQuickOpenOpen(true);
      getWorkbench().setRecentFilesSwitcherOpen(false);
    });

    expect(getWorkbench().recentFilesSwitcherOpen).toBe(false);
    expect(getWorkbench().quickOpenOpen).toBe(true);
  });
  it("does not open the switcher when no workspace is active", async () => {
    const { getWorkbench } = renderController();
    await flushAsyncTurns();

    act(() => {
      getWorkbench().openRecentFilesSwitcher();
    });

    expect(getWorkbench().recentFilesSwitcherOpen).toBe(false);
  });
  it("isolates the recent files buffer per workspace tab without leaking", async () => {
    const { getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace-a",
        workspaceTabs: ["/workspace-a", "/workspace-b"],
      },
    });
    await flushAsyncTurns();

    expect(getWorkbench().workspaceRoot).toBe("/workspace-a");

    await act(async () => {
      await getWorkbench().openPinnedFile(fileEntry("/workspace-a/a.ts", "a.ts"));
    });

    expect(getWorkbench().recentFiles.map((entry) => entry.path)).toEqual(["/workspace-a/a.ts"]);

    await act(async () => {
      await getWorkbench().activateWorkspaceTab("/workspace-b");
    });
    await flushAsyncTurns();

    expect(getWorkbench().workspaceRoot).toBe("/workspace-b");
    expect(getWorkbench().recentFiles).toEqual([]);

    await act(async () => {
      await getWorkbench().openPinnedFile(fileEntry("/workspace-b/b.ts", "b.ts"));
    });

    expect(getWorkbench().recentFiles.map((entry) => entry.path)).toEqual(["/workspace-b/b.ts"]);

    await act(async () => {
      await getWorkbench().activateWorkspaceTab("/workspace-a");
    });
    await flushAsyncTurns();

    expect(getWorkbench().workspaceRoot).toBe("/workspace-a");
    expect(getWorkbench().recentFiles.map((entry) => entry.path)).toEqual(["/workspace-a/a.ts"]);
  });
  describe("recent locations", () => {
    it("records the position the user navigated away from, newest first", async () => {
      const { getWorkbench } = renderController({
        appSettings: {
          ...defaultAppSettings(),
          recentWorkspacePath: "/workspace",
        },
        readTextFile: vi.fn(async (path: string) => `<?php\n// ${path}\nclass Demo {}\n`),
      });
      await flushAsyncTurns();

      // Opening A with no prior active document records nothing; opening B then
      // C snapshots the position we left A, then B, at - newest first.
      await act(async () => {
        await getWorkbench().openPinnedFile(fileEntry("/workspace/A.php", "A.php"));
      });
      await act(async () => {
        await getWorkbench().openPinnedFile(fileEntry("/workspace/B.php", "B.php"));
      });
      await act(async () => {
        await getWorkbench().openPinnedFile(fileEntry("/workspace/C.php", "C.php"));
      });

      const locations = getWorkbench().recentLocations;
      expect(locations.map((entry) => entry.path)).toEqual([
        "/workspace/B.php",
        "/workspace/A.php",
      ]);
      expect(locations[0]).toMatchObject({
        line: 1,
        name: "B.php",
        relativePath: "B.php",
        snippet: "<?php",
      });
    });

    it("opens the recent locations panel and jumps to the chosen position, closing the panel", async () => {
      const { getWorkbench } = renderController({
        appSettings: {
          ...defaultAppSettings(),
          recentWorkspacePath: "/workspace",
        },
      });
      await flushAsyncTurns();

      await act(async () => {
        await getWorkbench().openPinnedFile(fileEntry("/workspace/A.php", "A.php"));
      });
      await act(async () => {
        await getWorkbench().openPinnedFile(fileEntry("/workspace/B.php", "B.php"));
      });

      act(() => {
        getWorkbench().openRecentLocationsPanel();
      });

      expect(getWorkbench().recentLocationsPanelOpen).toBe(true);

      const target = getWorkbench().recentLocations[0];
      expect(target?.path).toBe("/workspace/A.php");

      await act(async () => {
        await getWorkbench().openRecentLocation(target);
      });

      expect(getWorkbench().activePath).toBe("/workspace/A.php");
      expect(getWorkbench().recentLocationsPanelOpen).toBe(false);
    });

    it("does not open the panel when no workspace is active", async () => {
      const { getWorkbench } = renderController();
      await flushAsyncTurns();

      act(() => {
        getWorkbench().openRecentLocationsPanel();
      });

      expect(getWorkbench().recentLocationsPanelOpen).toBe(false);
    });

    it("isolates recent locations per workspace tab without leaking", async () => {
      const { getWorkbench } = renderController({
        appSettings: {
          ...defaultAppSettings(),
          recentWorkspacePath: "/workspace-a",
          workspaceTabs: ["/workspace-a", "/workspace-b"],
        },
      });
      await flushAsyncTurns();

      expect(getWorkbench().workspaceRoot).toBe("/workspace-a");

      await act(async () => {
        await getWorkbench().openPinnedFile(fileEntry("/workspace-a/a1.php", "a1.php"));
      });
      await act(async () => {
        await getWorkbench().openPinnedFile(fileEntry("/workspace-a/a2.php", "a2.php"));
      });

      expect(getWorkbench().recentLocations.map((entry) => entry.path)).toEqual([
        "/workspace-a/a1.php",
      ]);

      await act(async () => {
        await getWorkbench().activateWorkspaceTab("/workspace-b");
      });
      await flushAsyncTurns();

      expect(getWorkbench().workspaceRoot).toBe("/workspace-b");
      expect(getWorkbench().recentLocations).toEqual([]);
      expect(getWorkbench().recentLocationsPanelOpen).toBe(false);

      await act(async () => {
        await getWorkbench().openPinnedFile(fileEntry("/workspace-b/b1.php", "b1.php"));
      });
      await act(async () => {
        await getWorkbench().openPinnedFile(fileEntry("/workspace-b/b2.php", "b2.php"));
      });

      expect(getWorkbench().recentLocations.map((entry) => entry.path)).toEqual([
        "/workspace-b/b1.php",
      ]);

      await act(async () => {
        await getWorkbench().activateWorkspaceTab("/workspace-a");
      });
      await flushAsyncTurns();

      expect(getWorkbench().workspaceRoot).toBe("/workspace-a");
      expect(getWorkbench().recentLocations.map((entry) => entry.path)).toEqual([
        "/workspace-a/a1.php",
      ]);
    });
  });
  describe("find in path", () => {
    it("does not replace when the destructive confirmation is declined", async () => {
      const replaceInPath = vi.fn(async () => ({
        files: [],
        totalReplacements: 0,
      }));
      const confirm = vi.fn(() => false);
      const { getWorkbench } = renderController({
        appSettings: {
          ...defaultAppSettings(),
          recentWorkspacePath: "/workspace",
          workspaceTabs: ["/workspace"],
        },
        prompter: { confirm, prompt: vi.fn(() => null) },
        searchText: vi.fn(async () => [
          {
            column: 1,
            lineNumber: 1,
            lineText: "needle here",
            matchEnd: 6,
            matchStart: 0,
            path: "/workspace/a.php",
            relativePath: "a.php",
          },
        ]),
        replaceInPath,
      });
      await flushAsyncTurns();
      await waitForReact(() => {
        expect(getWorkbench().workspaceRoot).toBe("/workspace");
      });

      act(() => {
        getWorkbench().setTextSearchOpen(true);
        getWorkbench().setTextSearchQuery("needle");
        getWorkbench().setTextReplacement("thread");
      });
      await flushTextSearchDebounce();
      expect(getWorkbench().textSearchResults.length).toBe(1);

      await act(async () => {
        await getWorkbench().replaceAllInPath();
      });
      await flushAsyncTurns();

      expect(confirm).toHaveBeenCalled();
      expect(replaceInPath).not.toHaveBeenCalled();
    });

    it("replaces across files after the confirmation is accepted", async () => {
      const replaceInPath = vi.fn(async () => ({
        files: [
          { path: "/workspace/a.php", relativePath: "a.php", replacements: 2 },
          { path: "/workspace/b.php", relativePath: "b.php", replacements: 1 },
        ],
        totalReplacements: 3,
      }));
      const confirm = vi.fn(() => true);
      const { getWorkbench } = renderController({
        appSettings: {
          ...defaultAppSettings(),
          recentWorkspacePath: "/workspace",
          workspaceTabs: ["/workspace"],
        },
        prompter: { confirm, prompt: vi.fn(() => null) },
        searchText: vi.fn(async () => [
          {
            column: 1,
            lineNumber: 1,
            lineText: "needle here",
            matchEnd: 6,
            matchStart: 0,
            path: "/workspace/a.php",
            relativePath: "a.php",
          },
          {
            column: 1,
            lineNumber: 2,
            lineText: "and needle again",
            matchEnd: 10,
            matchStart: 4,
            path: "/workspace/b.php",
            relativePath: "b.php",
          },
        ]),
        replaceInPath,
      });
      await flushAsyncTurns();
      await waitForReact(() => {
        expect(getWorkbench().workspaceRoot).toBe("/workspace");
      });

      act(() => {
        getWorkbench().setTextSearchOpen(true);
        getWorkbench().setTextSearchOptions({
          caseSensitive: true,
          wholeWord: true,
          isRegex: false,
          preserveCase: true,
          fileMask: "*.php",
        });
        getWorkbench().setTextSearchQuery("  needle  ");
        getWorkbench().setTextReplacement("thread");
      });
      await flushTextSearchDebounce();
      expect(getWorkbench().textSearchResults.length).toBe(2);

      await act(async () => {
        await getWorkbench().replaceAllInPath();
      });
      await flushAsyncTurns();

      expect(replaceInPath).toHaveBeenCalledWith(
        "/workspace",
        "needle",
        "thread",
        {
          caseSensitive: true,
          wholeWord: true,
          isRegex: false,
          preserveCase: true,
          fileMask: "*.php",
        },
        undefined,
      );
      expect(getWorkbench().message).toBe("Replaced 3 occurrences in 2 files");
    });

    it("scopes a single-file replace to matching preview results and exact path", async () => {
      const replaceInPath = vi.fn(async () => ({
        files: [{ path: "/workspace/a.php", relativePath: "a.php", replacements: 1 }],
        totalReplacements: 1,
      }));
      const confirm = vi.fn(() => true);
      const { getWorkbench } = renderController({
        appSettings: {
          ...defaultAppSettings(),
          recentWorkspacePath: "/workspace",
          workspaceTabs: ["/workspace"],
        },
        prompter: { confirm, prompt: vi.fn(() => null) },
        searchText: vi.fn(async () => [
          {
            column: 1,
            lineNumber: 1,
            lineText: "needle here",
            matchEnd: 6,
            matchStart: 0,
            path: "/workspace/a.php",
            relativePath: "a.php",
          },
          {
            column: 1,
            lineNumber: 1,
            lineText: "needle there",
            matchEnd: 6,
            matchStart: 0,
            path: "/workspace/b.php",
            relativePath: "b.php",
          },
        ]),
        replaceInPath,
      });
      await flushAsyncTurns();
      await waitForReact(() => {
        expect(getWorkbench().workspaceRoot).toBe("/workspace");
      });

      act(() => {
        getWorkbench().setTextSearchOpen(true);
        getWorkbench().setTextSearchOptions({
          caseSensitive: false,
          wholeWord: false,
          isRegex: false,
          preserveCase: false,
          fileMask: "*.php",
        });
        getWorkbench().setTextSearchQuery("needle");
        getWorkbench().setTextReplacement("thread");
      });
      await flushTextSearchDebounce();
      expect(getWorkbench().textSearchResults.length).toBe(2);

      await act(async () => {
        await getWorkbench().replaceInFile("/workspace/a.php");
      });
      await flushAsyncTurns();

      expect(confirm).toHaveBeenCalledWith(
        "Replace 1 occurrence in a.php? This rewrites files on disk and is restorable from Local History.",
      );
      // The single-file scope is passed as an exact path (5th arg), never as a
      // widened file mask, so an active mask cannot escape the chosen file.
      expect(replaceInPath).toHaveBeenCalledWith(
        "/workspace",
        "needle",
        "thread",
        {
          caseSensitive: false,
          wholeWord: false,
          isRegex: false,
          preserveCase: false,
          fileMask: "*.php",
        },
        "/workspace/a.php",
      );
    });

    it("reveals the match position when a result is opened", async () => {
      const result: TextSearchResult = {
        column: 13,
        lineNumber: 7,
        lineText: "final class UserService",
        matchEnd: 23,
        matchStart: 12,
        path: "/workspace/app/Services/UserService.php",
        relativePath: "app/Services/UserService.php",
      };
      const { getWorkbench } = renderController({
        appSettings: {
          ...defaultAppSettings(),
          recentWorkspacePath: "/workspace",
          workspaceTabs: ["/workspace"],
        },
        searchText: vi.fn(async () => [result]),
      });
      await flushAsyncTurns();
      await waitForReact(() => {
        expect(getWorkbench().workspaceRoot).toBe("/workspace");
      });

      act(() => {
        getWorkbench().setTextSearchOpen(true);
        getWorkbench().setTextSearchQuery("UserService");
      });
      await flushTextSearchDebounce();
      expect(getWorkbench().textSearchResults).toEqual([result]);

      await act(async () => {
        await getWorkbench().openTextSearchResult(getWorkbench().textSearchResults[0]!);
      });

      expect(getWorkbench().editorRevealTarget).toEqual({
        path: "/workspace/app/Services/UserService.php",
        position: { column: 13, lineNumber: 7 },
      });
      expect(getWorkbench().textSearchOpen).toBe(true);
    });

    it("resets filters to the default baseline between workspace tabs", async () => {
      const { getWorkbench } = renderController({
        appSettings: {
          ...defaultAppSettings(),
          recentWorkspacePath: "/workspace-a",
          workspaceTabs: ["/workspace-a", "/workspace-b"],
        },
      });
      await flushAsyncTurns();
      await waitForReact(() => {
        expect(getWorkbench().workspaceRoot).toBe("/workspace-a");
      });

      act(() => {
        getWorkbench().setTextSearchOptions({
          ...defaultTextSearchOptions(),
          isRegex: true,
          fileMask: "*.php",
        });
      });

      expect(getWorkbench().textSearchOptions.isRegex).toBe(true);

      await act(async () => {
        await getWorkbench().activateWorkspaceTab("/workspace-b");
      });
      await flushAsyncTurns();

      expect(getWorkbench().textSearchOptions).toEqual(defaultTextSearchOptions());
    });
  });
  describe("EditorConfig (.editorconfig)", () => {
    // Builds a readTextFile that serves `.editorconfig` content for any
    // directory listed in `editorConfigs`, the document body for the file
    // itself, and rejects (file absent) for every other `.editorconfig` lookup.
    function editorConfigReadTextFile(
      documents: Record<string, string>,
      editorConfigs: Record<string, string>,
    ) {
      return vi.fn(async (path: string) => {
        if (path.endsWith("/.editorconfig")) {
          const directory = path.slice(0, -"/.editorconfig".length);

          if (directory in editorConfigs) {
            return editorConfigs[directory];
          }

          throw new Error(`No .editorconfig at ${path}`);
        }

        if (path in documents) {
          return documents[path];
        }

        return `<?php\n// ${path}\n`;
      });
    }

    it("resolves .editorconfig for the active document and exposes it", async () => {
      const readTextFile = editorConfigReadTextFile(
        { "/workspace/app/User.php": "<?php\nclass User {}\n" },
        {
          "/workspace": [
            "root = true",
            "[*]",
            "indent_style = space",
            "indent_size = 4",
            "end_of_line = lf",
          ].join("\n"),
        },
      );
      const { getWorkbench } = renderController({
        appSettings: {
          ...defaultAppSettings(),
          recentWorkspacePath: "/workspace",
        },
        readTextFile,
        workspaceSettings: {
          ...defaultWorkspaceSettings(),
          autoSave: false,
          formatOnSave: false,
        },
      });
      await flushAsyncTurns();

      await act(async () => {
        await getWorkbench().openPinnedFile(fileEntry("/workspace/app/User.php", "User.php"));
      });
      await flushAsyncTurns();

      expect(getWorkbench().activeEditorConfig).toEqual({
        indentStyle: "space",
        indentSize: 4,
        tabWidth: 4,
        endOfLine: "lf",
      });
    });

    it("exposes empty settings when no .editorconfig matches", async () => {
      const readTextFile = editorConfigReadTextFile(
        { "/workspace/app/User.php": "<?php\nclass User {}\n" },
        {},
      );
      const { getWorkbench } = renderController({
        appSettings: {
          ...defaultAppSettings(),
          recentWorkspacePath: "/workspace",
        },
        readTextFile,
        workspaceSettings: {
          ...defaultWorkspaceSettings(),
          autoSave: false,
          formatOnSave: false,
        },
      });
      await flushAsyncTurns();

      await act(async () => {
        await getWorkbench().openPinnedFile(fileEntry("/workspace/app/User.php", "User.php"));
      });
      await flushAsyncTurns();

      expect(getWorkbench().activeEditorConfig).toEqual({});
    });

    it("trims trailing whitespace and inserts a final newline on save", async () => {
      const readTextFile = editorConfigReadTextFile(
        { "/workspace/app/User.php": "<?php\nclass User {}\n" },
        {
          "/workspace": [
            "root = true",
            "[*]",
            "trim_trailing_whitespace = true",
            "insert_final_newline = true",
          ].join("\n"),
        },
      );
      const { dependencies, getWorkbench } = renderController({
        appSettings: {
          ...defaultAppSettings(),
          recentWorkspacePath: "/workspace",
        },
        readTextFile,
        workspaceSettings: {
          ...defaultWorkspaceSettings(),
          autoSave: false,
          formatOnSave: false,
          optimizeImportsOnSave: false,
        },
      });
      await flushAsyncTurns();

      await act(async () => {
        await getWorkbench().openPinnedFile(fileEntry("/workspace/app/User.php", "User.php"));
      });
      act(() => {
        getWorkbench().updateActiveDocument("<?php   \nclass User {}   ");
      });

      await act(async () => {
        await getWorkbench().saveActiveDocument();
      });
      await flushAsyncTurns();

      expect(dependencies.workspaceGateways.files.writeTextFile).not.toHaveBeenCalled();
      expect(getWorkbench().activeDocument?.content).toBe("<?php\nclass User {}\n");
    });

    it("normalizes EOL to crlf on save when configured", async () => {
      const readTextFile = editorConfigReadTextFile(
        { "/workspace/app/User.php": "<?php\nclass User {}\n" },
        { "/workspace": ["root = true", "[*]", "end_of_line = crlf"].join("\n") },
      );
      const { dependencies, getWorkbench } = renderController({
        appSettings: {
          ...defaultAppSettings(),
          recentWorkspacePath: "/workspace",
        },
        readTextFile,
        workspaceSettings: {
          ...defaultWorkspaceSettings(),
          autoSave: false,
          formatOnSave: false,
          optimizeImportsOnSave: false,
        },
      });
      await flushAsyncTurns();

      await act(async () => {
        await getWorkbench().openPinnedFile(fileEntry("/workspace/app/User.php", "User.php"));
      });
      act(() => {
        getWorkbench().updateActiveDocument("<?php\nclass User {}\n");
      });

      await act(async () => {
        await getWorkbench().saveActiveDocument();
      });
      await flushAsyncTurns();

      expect(dependencies.workspaceGateways.files.writeTextFile).toHaveBeenLastCalledWith(
        "/workspace/app/User.php",
        "<?php\r\nclass User {}\r\n",
      );
    });

    it("does not transform content on save when no .editorconfig matches", async () => {
      const readTextFile = editorConfigReadTextFile(
        { "/workspace/app/User.php": "<?php\nclass User {}\n" },
        {},
      );
      const { dependencies, getWorkbench } = renderController({
        appSettings: {
          ...defaultAppSettings(),
          recentWorkspacePath: "/workspace",
        },
        readTextFile,
        workspaceSettings: {
          ...defaultWorkspaceSettings(),
          autoSave: false,
          formatOnSave: false,
          optimizeImportsOnSave: false,
        },
      });
      await flushAsyncTurns();

      await act(async () => {
        await getWorkbench().openPinnedFile(fileEntry("/workspace/app/User.php", "User.php"));
      });
      act(() => {
        getWorkbench().updateActiveDocument("<?php   \nclass User {}   ");
      });

      await act(async () => {
        await getWorkbench().saveActiveDocument();
      });
      await flushAsyncTurns();

      // Trailing whitespace preserved, no final newline added: editor defaults.
      expect(dependencies.workspaceGateways.files.writeTextFile).toHaveBeenLastCalledWith(
        "/workspace/app/User.php",
        "<?php   \nclass User {}   ",
      );
    });

    it("isolates .editorconfig per workspace and never leaks across tabs", async () => {
      const readTextFile = vi.fn(async (path: string) => {
        if (path === "/workspace-a/.editorconfig") {
          return ["root = true", "[*]", "indent_style = tab"].join("\n");
        }

        if (path === "/workspace-b/.editorconfig") {
          return ["root = true", "[*]", "indent_style = space", "indent_size = 2"].join("\n");
        }

        if (path.endsWith("/.editorconfig")) {
          throw new Error(`No .editorconfig at ${path}`);
        }

        return `<?php\n// ${path}\n`;
      });
      const { getWorkbench } = renderController({
        appSettings: {
          ...defaultAppSettings(),
          recentWorkspacePath: "/workspace-a",
          workspaceTabs: ["/workspace-a", "/workspace-b"],
        },
        readTextFile,
      });
      await flushAsyncTurns();

      await act(async () => {
        await getWorkbench().openPinnedFile(fileEntry("/workspace-a/app/User.php", "User.php"));
      });
      await flushAsyncTurns();

      expect(getWorkbench().activeEditorConfig).toEqual({
        indentStyle: "tab",
      });

      await act(async () => {
        await getWorkbench().activateWorkspaceTab("/workspace-b");
      });
      await flushAsyncTurns();

      await act(async () => {
        await getWorkbench().openPinnedFile(fileEntry("/workspace-b/app/Order.php", "Order.php"));
      });
      await flushAsyncTurns();

      // Workspace B's file resolves B's config; A's tab indent must not bleed in.
      expect(getWorkbench().workspaceRoot).toBe("/workspace-b");
      expect(getWorkbench().activeEditorConfig).toEqual({
        indentStyle: "space",
        indentSize: 2,
        tabWidth: 2,
      });
    });
  });
  describe("QA bridge workspace opens", () => {
    it("opens only current-workspace absolute file paths through the document tab flow", async () => {
      const readTextFile = vi.fn(async (path: string) => `content:${path}`);
      const { getWorkbench } = renderController({
        appSettings: {
          ...defaultAppSettings(),
          recentWorkspacePath: "/workspace",
          workspaceTabs: ["/workspace"],
        },
        readTextFile,
      });
      await flushAsyncTurns();

      const request = { canOpen: vi.fn(() => true) };

      let opened = false;
      await act(async () => {
        opened = await getWorkbench().openWorkspaceFile("/workspace/src/Target.php", request);
      });
      await flushAsyncTurns();

      expect(opened).toBe(true);
      expect(getWorkbench().activePath).toBe("/workspace/src/Target.php");
      expect(getWorkbench().activeDocument?.content).toBe("content:/workspace/src/Target.php");
      expect(readTextFile).toHaveBeenCalledWith("/workspace/src/Target.php");

      readTextFile.mockClear();

      await act(async () => {
        opened = await getWorkbench().openWorkspaceFile("/workspace-other/src/Escape.php", request);
      });

      expect(opened).toBe(false);
      expect(getWorkbench().activePath).toBe("/workspace/src/Target.php");
      expect(readTextFile).not.toHaveBeenCalled();
    });

    it("drops a QA bridge workspace open when the request goes stale during the read", async () => {
      const slowRead = createDeferred<string>();
      const readTextFile = vi.fn((path: string) => {
        if (path === "/workspace-a/src/Slow.php") {
          return slowRead.promise;
        }

        return Promise.resolve(`content:${path}`);
      });
      const { getWorkbench } = renderController({
        appSettings: {
          ...defaultAppSettings(),
          recentWorkspacePath: "/workspace-a",
          workspaceTabs: ["/workspace-a", "/workspace-b"],
        },
        readTextFile,
      });
      await waitForReact(() => {
        expect(getWorkbench().workspaceRoot).toBe("/workspace-a");
      });

      const request = {
        canOpen: vi.fn(() => getWorkbench().workspaceRoot === "/workspace-a"),
      };
      let openedPromise: Promise<boolean> = Promise.resolve(false);

      act(() => {
        openedPromise = getWorkbench().openWorkspaceFile("/workspace-a/src/Slow.php", request);
      });

      await waitForReact(() => {
        expect(readTextFile).toHaveBeenCalledWith("/workspace-a/src/Slow.php");
      });

      await act(async () => {
        await getWorkbench().activateWorkspaceTab("/workspace-b");
      });
      await flushAsyncTurns();

      let opened = true;
      await act(async () => {
        slowRead.resolve("stale");
        opened = await openedPromise;
      });
      await flushAsyncTurns();

      expect(opened).toBe(false);
      expect(getWorkbench().workspaceRoot).toBe("/workspace-b");
      expect(getWorkbench().activePath).not.toBe("/workspace-a/src/Slow.php");
    });

    it("does not commit a same-workspace QA bridge open after the active document changes", async () => {
      const slowRead = createDeferred<string>();
      const readTextFile = vi.fn((path: string) => {
        if (path === "/workspace/src/Slow.php") {
          return slowRead.promise;
        }

        return Promise.resolve(`content:${path}`);
      });
      const { getWorkbench } = renderController({
        appSettings: {
          ...defaultAppSettings(),
          recentWorkspacePath: "/workspace",
          workspaceTabs: ["/workspace"],
        },
        readTextFile,
      });
      await flushAsyncTurns();

      const request = {
        canOpen: vi.fn(() => getWorkbench().activePath !== "/workspace/src/Other.php"),
      };

      await act(async () => {
        await getWorkbench().openPinnedFile(fileEntry("/workspace/src/Initial.php", "Initial.php"));
      });
      await flushAsyncTurns();

      let openedPromise: Promise<boolean> = Promise.resolve(false);
      act(() => {
        openedPromise = getWorkbench().openWorkspaceFile("/workspace/src/Slow.php", request);
      });

      await waitForReact(() => {
        expect(readTextFile).toHaveBeenCalledWith("/workspace/src/Slow.php");
      });

      await act(async () => {
        await getWorkbench().openPinnedFile(fileEntry("/workspace/src/Other.php", "Other.php"));
      });
      await flushAsyncTurns();

      let opened = true;
      await act(async () => {
        slowRead.resolve("stale");
        opened = await openedPromise;
      });
      await flushAsyncTurns();

      expect(opened).toBe(false);
      expect(getWorkbench().activePath).toBe("/workspace/src/Other.php");
    });
  });
});
