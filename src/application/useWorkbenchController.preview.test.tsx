// @vitest-environment jsdom

import { useEffect } from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { WorkbenchPrompter } from "./workbenchPrompter";
import {
  useWorkbenchController,
  type WorkbenchWorkspaceGateways,
} from "./useWorkbenchController";
import type { IndexProgressGateway } from "../domain/indexProgress";
import type { SmartModeGateway } from "../domain/intelligence";
import type { LanguageServerGateway } from "../domain/languageServer";
import type { LanguageServerDiagnosticsGateway } from "../domain/languageServerDiagnostics";
import type { LanguageServerDocumentSyncGateway } from "../domain/languageServerDocumentSync";
import type { LanguageServerFeaturesGateway } from "../domain/languageServerFeatures";
import {
  emptyLanguageServerCapabilities,
  type LanguageServerRuntimeGateway,
  type LanguageServerRuntimeStatus,
} from "../domain/languageServerRuntime";
import type { PhpFileOutlineGateway } from "../domain/phpFileOutline";
import type { PhpTreeGateway } from "../domain/phpTree";
import type { ProjectSymbolSearchResult } from "../domain/projectSymbols";
import {
  defaultAppSettings,
  defaultWorkspaceSettings,
  type SettingsGateway,
} from "../domain/settings";
import type { WorkspaceTrustGateway } from "../domain/trust";
import type {
  FileEntry,
  PhpProjectDescriptor,
  WorkspaceDescriptor,
} from "../domain/workspace";

type WorkbenchController = ReturnType<typeof useWorkbenchController>;

interface ControllerDependencies {
  documentSyncGateway: LanguageServerDocumentSyncGateway;
  indexProgressGateway: IndexProgressGateway;
  languageServerDiagnosticsGateway: LanguageServerDiagnosticsGateway;
  languageServerDocumentSyncGateway: LanguageServerDocumentSyncGateway;
  languageServerFeaturesGateway: LanguageServerFeaturesGateway;
  languageServerGateway: LanguageServerGateway;
  languageServerRuntimeGateway: LanguageServerRuntimeGateway;
  phpFileOutlineGateway: PhpFileOutlineGateway;
  phpTreeGateway: PhpTreeGateway;
  prompter: WorkbenchPrompter;
  settingsGateway: SettingsGateway;
  smartModeGateway: SmartModeGateway;
  workspaceGateways: WorkbenchWorkspaceGateways;
  workspaceTrustGateway: WorkspaceTrustGateway;
}

interface Deferred<T> {
  promise: Promise<T>;
  resolve(value: T): void;
  reject(error: unknown): void;
}

describe("useWorkbenchController preview tabs", () => {
  let host: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
  });

  it("keeps a double-click pin from being overwritten by a stale preview read", async () => {
    const reads: Array<{ deferred: Deferred<string>; path: string }> = [];
    const readTextFile = vi.fn((path: string) => {
      const deferred = createDeferred<string>();
      reads.push({ deferred, path });
      return deferred.promise;
    });
    const { getWorkbench } = renderController({ readTextFile });
    const file = fileEntry("/workspace/src/User.php", "User.php");

    let previewPromise: Promise<void> | null = null;
    let pinPromise: Promise<boolean> | null = null;

    act(() => {
      previewPromise = getWorkbench().previewFile(file);
      pinPromise = getWorkbench().openFile(file);
    });

    expect(reads.map((read) => read.path)).toEqual([file.path, file.path]);

    await act(async () => {
      reads[1].deferred.resolve("<?php\nfinal class User {}\n");
      await pinPromise;
    });

    expect(getWorkbench().activePath).toBe(file.path);
    expect(getWorkbench().previewPath).toBe(null);

    await act(async () => {
      reads[0].deferred.resolve("<?php\nfinal class StaleUser {}\n");
      await previewPromise;
    });

    expect(getWorkbench().activePath).toBe(file.path);
    expect(getWorkbench().previewPath).toBe(null);
    expect(getWorkbench().openDocuments).toHaveLength(1);
    expect(getWorkbench().openDocuments[0]?.content).toContain("User");
  });

  it("activates the remaining preview tab after closing the active pinned tab", async () => {
    const { getWorkbench } = renderController();
    const pinnedFile = fileEntry("/workspace/src/Pinned.php", "Pinned.php");
    const previewFile = fileEntry("/workspace/src/Preview.php", "Preview.php");

    await act(async () => {
      await getWorkbench().openFile(pinnedFile);
    });
    await act(async () => {
      await getWorkbench().previewFile(previewFile);
    });
    await act(async () => {
      getWorkbench().setActivePath(pinnedFile.path);
      await Promise.resolve();
    });
    act(() => {
      getWorkbench().closeDocument(pinnedFile.path);
    });

    expect(getWorkbench().activePath).toBe(previewFile.path);
    expect(getWorkbench().activeDocument?.path).toBe(previewFile.path);
  });

  it("syncs preview documents with the language server", async () => {
    const runningStatus: LanguageServerRuntimeStatus = {
      capabilities: emptyLanguageServerCapabilities(),
      kind: "running",
      sessionId: 1,
    };
    const { dependencies, getWorkbench } = renderController({
      runtimeStatus: runningStatus,
    });
    const previewFile = fileEntry("/workspace/src/Preview.php", "Preview.php");

    await act(async () => {
      await Promise.resolve();
    });
    await act(async () => {
      await getWorkbench().previewFile(previewFile);
    });
    await act(async () => {
      await Promise.resolve();
    });

    expect(
      dependencies.documentSyncGateway.didOpen,
    ).toHaveBeenCalledWith(
      expect.objectContaining({ path: previewFile.path }),
    );
  });

  it("keeps restored workspaces lightweight in editor mode", async () => {
    const { dependencies, getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace",
      },
    });
    await flushAsyncTurns();

    expect(getWorkbench().intelligenceMode).toBe("basic");
    expect(
      dependencies.indexProgressGateway.startInitialMetadataScan,
    ).not.toHaveBeenCalled();
    expect(dependencies.languageServerRuntimeGateway.start).not.toHaveBeenCalled();
  });

  it("starts indexing when a restored workspace is already in IDE mode", async () => {
    const { dependencies, getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace",
      },
      workspaceSettings: {
        ...defaultWorkspaceSettings(),
        intelligenceMode: "fullSmart",
      },
    });
    await flushAsyncTurns();

    expect(getWorkbench().intelligenceMode).toBe("fullSmart");
    expect(
      dependencies.indexProgressGateway.startInitialMetadataScan,
    ).toHaveBeenCalledWith("/workspace");
  });

  it("clears indexed intelligence and stops the language server when IDE mode is turned off", async () => {
    const { dependencies, getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace",
      },
    });
    await flushAsyncTurns();

    await act(async () => {
      await getWorkbench().toggleSmartMode();
    });
    await act(async () => {
      await getWorkbench().toggleSmartMode();
    });

    expect(
      dependencies.indexProgressGateway.startInitialMetadataScan,
    ).toHaveBeenCalledWith("/workspace");
    expect(dependencies.languageServerRuntimeGateway.stop).toHaveBeenCalled();
    expect(
      dependencies.indexProgressGateway.clearWorkspaceIndex,
    ).toHaveBeenCalledWith("/workspace");
    expect(getWorkbench().intelligenceMode).toBe("basic");
  });

  it("toggles file structure to inherited members on the second Cmd+R", async () => {
    const childPath = "/workspace/app/Child.php";
    const parentPath = "/workspace/app/ParentClass.php";
    const { dependencies, getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace",
      },
      readTextFile: vi.fn(async (path: string) => {
        if (path === childPath) {
          return "<?php\nnamespace App;\nclass Child extends ParentClass {}\n";
        }

        return "<?php\nnamespace App;\nclass ParentClass { public function inherited() {} }\n";
      }),
      workspaceDescriptor: phpWorkspaceDescriptor(),
    });
    await flushAsyncTurns();

    await act(async () => {
      await getWorkbench().openFile(fileEntry(childPath, "Child.php"));
    });
    act(() => {
      getWorkbench().openFileStructure();
    });
    await flushAsyncTurns();
    act(() => {
      getWorkbench().openFileStructure();
    });
    await flushAsyncTurns();

    expect(getWorkbench().fileStructureOpen).toBe(true);
    expect(getWorkbench().fileStructureScope).toBe("inherited");
    expect(
      dependencies.phpFileOutlineGateway.parsePhpFileOutline,
    ).toHaveBeenCalledWith(parentPath, expect.stringContaining("inherited"));
  });

  it("uses the project index for go to definition when the language server is unavailable", async () => {
    const controllerPath = "/workspace/src/CommentController.php";
    const agentPath = "/workspace/src/CommentsAgent.php";
    const projectSymbols: ProjectSymbolSearchResult[] = [
      {
        column: 13,
        containerName: null,
        fullyQualifiedName: "App\\CommentsAgent",
        kind: "class",
        lineNumber: 4,
        name: "CommentsAgent",
        path: agentPath,
        relativePath: "src/CommentsAgent.php",
      },
    ];
    const { dependencies, getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace",
      },
      projectSymbols,
      readTextFile: vi.fn(async (path: string) => {
        if (path === controllerPath) {
          return "<?php\n$agent = new CommentsAgent();\n";
        }

        return "<?php\nfinal class CommentsAgent {}\n";
      }),
    });
    await flushAsyncTurns();
    await act(async () => {
      await getWorkbench().setSmartMode("lightSmart");
    });

    await act(async () => {
      await getWorkbench().openFile(
        fileEntry(controllerPath, "CommentController.php"),
      );
    });
    act(() => {
      getWorkbench().updateActiveEditorPosition({
        column: 23,
        lineNumber: 2,
      });
    });

    const command = getWorkbench().commands.find(
      (candidate) => candidate.id === "editor.goToDefinition",
    );

    await act(async () => {
      await command?.run();
    });

    expect(
      dependencies.workspaceGateways.projectSymbols.searchProjectSymbols,
    ).toHaveBeenCalledWith("/workspace", "CommentsAgent", 25);
    expect(getWorkbench().activePath).toBe(agentPath);
    expect(getWorkbench().editorRevealTarget).toEqual({
      path: agentPath,
      position: {
        column: 13,
        lineNumber: 4,
      },
    });
  });

  it("navigates back into the same editor tab after definition replaces it", async () => {
    const controllerPath = "/workspace/src/CommentController.php";
    const agentPath = "/workspace/src/CommentsAgent.php";
    const projectSymbols: ProjectSymbolSearchResult[] = [
      {
        column: 13,
        containerName: null,
        fullyQualifiedName: "App\\CommentsAgent",
        kind: "class",
        lineNumber: 4,
        name: "CommentsAgent",
        path: agentPath,
        relativePath: "src/CommentsAgent.php",
      },
    ];
    const { getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace",
      },
      projectSymbols,
      readTextFile: vi.fn(async (path: string) => {
        if (path === controllerPath) {
          return "<?php\n$agent = new CommentsAgent();\n";
        }

        return "<?php\nfinal class CommentsAgent {}\n";
      }),
    });
    await flushAsyncTurns();
    await act(async () => {
      await getWorkbench().setSmartMode("lightSmart");
    });

    await act(async () => {
      await getWorkbench().openFile(
        fileEntry(controllerPath, "CommentController.php"),
      );
    });
    act(() => {
      getWorkbench().updateActiveEditorPosition({
        column: 23,
        lineNumber: 2,
      });
    });
    await act(async () => {
      await getWorkbench().commands
        .find((candidate) => candidate.id === "editor.goToDefinition")
        ?.run();
    });

    expect(getWorkbench().activePath).toBe(agentPath);
    expect(getWorkbench().openDocuments.map((document) => document.path)).toEqual([
      agentPath,
    ]);

    await act(async () => {
      await getWorkbench().navigateBackward();
    });

    expect(getWorkbench().activePath).toBe(controllerPath);
    expect(getWorkbench().openDocuments.map((document) => document.path)).toEqual([
      controllerPath,
    ]);
  });

  it("resolves Laravel request input through typed parameters instead of a random input method", async () => {
    const controllerPath = "/workspace/app/Http/Controllers/CommentController.php";
    const postRequestPath =
      "/workspace/app/Kontentino/src/Http/Requests/POSTRequest.php";
    const inputTraitPath =
      "/workspace/vendor/laravel/framework/src/Illuminate/Http/Concerns/InteractsWithInput.php";
    const projectSymbols: ProjectSymbolSearchResult[] = [
      {
        column: 5,
        containerName: "Kontentino\\Http\\Requests\\POSTRequest",
        fullyQualifiedName: "Kontentino\\Http\\Requests\\POSTRequest::input",
        kind: "method",
        lineNumber: 16,
        name: "input",
        path: postRequestPath,
        relativePath: "app/Kontentino/src/Http/Requests/POSTRequest.php",
      },
    ];
    const { getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace",
      },
      projectSymbols,
      readTextFile: vi.fn(async (path: string) => {
        if (path === controllerPath) {
          return `<?php
namespace App\\Http\\Controllers\\publicapi\\AiHub;

use App\\Http\\Request\\AiHub\\StoreCommentRequest;

class CommentController
{
    public function store(StoreCommentRequest $request): void
    {
        $request->input('originalComment', '');
    }
}
`;
        }

        if (path === inputTraitPath) {
          return "<?php\ntrait InteractsWithInput\n{\n    public function input($key = null, $default = null) {}\n}\n";
        }

        return "<?php\nclass POSTRequest { public function input() {} }\n";
      }),
      workspaceDescriptor: phpWorkspaceDescriptor(),
    });
    await flushAsyncTurns();
    await act(async () => {
      await getWorkbench().setSmartMode("lightSmart");
    });

    await act(async () => {
      await getWorkbench().openFile(
        fileEntry(controllerPath, "CommentController.php"),
      );
    });
    act(() => {
      getWorkbench().updateActiveEditorPosition({
        column: 21,
        lineNumber: 10,
      });
    });

    await act(async () => {
      await getWorkbench().commands
        .find((candidate) => candidate.id === "editor.goToDefinition")
        ?.run();
    });

    expect(getWorkbench().activePath).toBe(inputTraitPath);
    expect(getWorkbench().editorRevealTarget).toEqual({
      path: inputTraitPath,
      position: {
        column: 21,
        lineNumber: 4,
      },
    });
  });

  it("resolves imported FormRequest to vendor instead of a local substring class", async () => {
    const requestPath = "/workspace/app/Http/Request/AiHub/StoreCommentRequest.php";
    const baseRequestPath = "/workspace/app/Http/Request/BaseFormRequest.php";
    const formRequestPath =
      "/workspace/vendor/laravel/framework/src/Illuminate/Foundation/Http/FormRequest.php";
    const projectSymbols: ProjectSymbolSearchResult[] = [
      {
        column: 7,
        containerName: null,
        fullyQualifiedName: "App\\Http\\Request\\BaseFormRequest",
        kind: "class",
        lineNumber: 14,
        name: "BaseFormRequest",
        path: baseRequestPath,
        relativePath: "app/Http/Request/BaseFormRequest.php",
      },
    ];
    const { getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace",
      },
      projectSymbols,
      readTextFile: vi.fn(async (path: string) => {
        if (path === requestPath) {
          return `<?php
namespace App\\Http\\Request\\AiHub;

use Illuminate\\Foundation\\Http\\FormRequest;

class StoreCommentRequest extends FormRequest
{
}
`;
        }

        if (path === formRequestPath) {
          return "<?php\nnamespace Illuminate\\Foundation\\Http;\nclass FormRequest extends Request {}\n";
        }

        return "<?php\nclass BaseFormRequest {}\n";
      }),
      workspaceDescriptor: phpWorkspaceDescriptor(),
    });
    await flushAsyncTurns();

    await act(async () => {
      await getWorkbench().openFile(
        fileEntry(requestPath, "StoreCommentRequest.php"),
      );
    });
    act(() => {
      getWorkbench().updateActiveEditorPosition({
        column: 37,
        lineNumber: 6,
      });
    });

    await act(async () => {
      await getWorkbench().commands
        .find((candidate) => candidate.id === "editor.goToDefinition")
        ?.run();
    });

    expect(getWorkbench().activePath).toBe(formRequestPath);
    expect(getWorkbench().editorRevealTarget).toEqual({
      path: formRequestPath,
      position: {
        column: 7,
        lineNumber: 3,
      },
    });
  });

  function renderController({
    appSettings = defaultAppSettings(),
    projectSymbols = [],
    readTextFile = vi.fn(async (path: string) => `<?php\n// ${path}\n`),
    runtimeStatus = { kind: "stopped" as const },
    workspaceDescriptor,
    workspaceSettings = defaultWorkspaceSettings(),
  }: {
    appSettings?: ReturnType<typeof defaultAppSettings>;
    projectSymbols?: ProjectSymbolSearchResult[];
    readTextFile?: (path: string) => Promise<string>;
    runtimeStatus?: LanguageServerRuntimeStatus;
    workspaceDescriptor?: WorkspaceDescriptor;
    workspaceSettings?: ReturnType<typeof defaultWorkspaceSettings>;
  } = {}) {
    let workbench: WorkbenchController | null = null;
    const dependencies = createControllerDependencies({
      appSettings,
      projectSymbols,
      readTextFile,
      runtimeStatus,
      workspaceDescriptor,
      workspaceSettings,
    });
    const getWorkbench = () => {
      if (!workbench) {
        throw new Error("Workbench controller was not rendered.");
      }

      return workbench;
    };

    act(() => {
      root.render(
        <WorkbenchHarness
          dependencies={dependencies}
          onWorkbench={(nextWorkbench) => {
            workbench = nextWorkbench;
          }}
        />,
      );
    });

    return { dependencies, getWorkbench };
  }
});

function WorkbenchHarness({
  dependencies,
  onWorkbench,
}: {
  dependencies: ControllerDependencies;
  onWorkbench(workbench: WorkbenchController): void;
}) {
  const workbench = useWorkbenchController(
    dependencies.workspaceGateways,
    dependencies.smartModeGateway,
    dependencies.workspaceTrustGateway,
    dependencies.indexProgressGateway,
    dependencies.phpFileOutlineGateway,
    dependencies.phpTreeGateway,
    dependencies.languageServerGateway,
    dependencies.languageServerRuntimeGateway,
    dependencies.languageServerDocumentSyncGateway,
    dependencies.languageServerDiagnosticsGateway,
    dependencies.languageServerFeaturesGateway,
    dependencies.settingsGateway,
    dependencies.prompter,
  );

  useEffect(() => {
    onWorkbench(workbench);
  }, [onWorkbench, workbench]);

  return null;
}

function createControllerDependencies({
  appSettings,
  projectSymbols,
  readTextFile,
  runtimeStatus,
  workspaceDescriptor,
  workspaceSettings,
}: {
  appSettings: ReturnType<typeof defaultAppSettings>;
  projectSymbols: ProjectSymbolSearchResult[];
  readTextFile(path: string): Promise<string>;
  runtimeStatus: LanguageServerRuntimeStatus;
  workspaceDescriptor?: WorkspaceDescriptor;
  workspaceSettings: ReturnType<typeof defaultWorkspaceSettings>;
}): ControllerDependencies {
  const documentSyncGateway: LanguageServerDocumentSyncGateway = {
    didChange: vi.fn(async () => undefined),
    didClose: vi.fn(async () => undefined),
    didOpen: vi.fn(async () => undefined),
    didSave: vi.fn(async () => undefined),
  };
  const workspaceGateways: WorkbenchWorkspaceGateways = {
    detection: {
      detectWorkspace: vi.fn(async (path) => ({
        php: workspaceDescriptor?.php ?? null,
        rootPath: path,
      })),
    },
    fileSearch: {
      searchFiles: vi.fn(async () => []),
    },
    files: {
      createDirectory: vi.fn(async () => undefined),
      createTextFile: vi.fn(async () => undefined),
      deletePath: vi.fn(async () => undefined),
      readDirectory: vi.fn(async () => []),
      readTextFile,
      renamePath: vi.fn(async () => undefined),
      writeTextFile: vi.fn(async () => undefined),
    },
    phpTools: {
      detectPhpTools: vi.fn(async () => ({
        intelephense: null,
        phpactor: null,
      })),
    },
    projectSymbols: {
      searchProjectSymbols: vi.fn(async () => projectSymbols),
    },
    textSearch: {
      searchText: vi.fn(async () => []),
    },
  };

  return {
    documentSyncGateway,
    indexProgressGateway: {
      clearWorkspaceIndex: vi.fn(async (rootPath) => ({
        databasePath: "/tmp/index.sqlite",
        rootPath,
        status: "cleared" as const,
      })),
      startInitialMetadataScan: vi.fn(async (rootPath) => ({
        databasePath: "/tmp/index.sqlite",
        rootPath,
        status: "started" as const,
      })),
      startReindex: vi.fn(async (rootPath) => ({
        databasePath: "/tmp/index.sqlite",
        rootPath,
        status: "started" as const,
      })),
      subscribeMetadataScanCompletion: vi.fn(async () => () => undefined),
    },
    languageServerDiagnosticsGateway: {
      subscribeDiagnostics: vi.fn(async () => () => undefined),
    },
    languageServerDocumentSyncGateway: documentSyncGateway,
    languageServerFeaturesGateway: {
      completion: vi.fn(async () => ({
        isIncomplete: false,
        items: [],
      })),
      definition: vi.fn(async () => []),
      hover: vi.fn(async () => null),
      implementation: vi.fn(async () => []),
    },
    languageServerGateway: {
      planPhpLanguageServer: vi.fn(async () => ({
        command: null,
        initializeRequest: null,
        message: "Language server unavailable in test.",
        provider: "phpactor" as const,
        status: "unavailable" as const,
      })),
    },
    languageServerRuntimeGateway: {
      getStatus: vi.fn(async () => runtimeStatus),
      start: vi.fn(async () => runtimeStatus),
      stop: vi.fn(async () => ({ kind: "stopped" as const })),
      subscribeStatus: vi.fn(async () => () => undefined),
    },
    phpFileOutlineGateway: {
      getPhpFileOutline: vi.fn(async () => ({ nodes: [] })),
      parsePhpFileOutline: vi.fn(async () => ({ nodes: [] })),
    },
    phpTreeGateway: {
      getPhpTree: vi.fn(async () => ({ nodes: [] })),
    },
    prompter: {
      confirm: vi.fn(() => true),
      prompt: vi.fn(() => null),
    },
    settingsGateway: {
      loadAppSettings: vi.fn(async () => appSettings),
      loadWorkspaceSettings: vi.fn(async () => workspaceSettings),
      saveAppSettings: vi.fn(async () => undefined),
      saveWorkspaceSettings: vi.fn(async () => undefined),
    },
    smartModeGateway: {
      getState: vi.fn(async () => ({
        message: "Basic",
        mode: "basic" as const,
        status: "off" as const,
      })),
      setMode: vi.fn(async (mode) => ({
        message: "Updated",
        mode,
        status: "ready" as const,
      })),
    },
    workspaceGateways,
    workspaceTrustGateway: {
      getTrust: vi.fn(async (rootPath) => ({
        rootPath,
        trusted: true,
      })),
      setTrust: vi.fn(async (rootPath, trusted) => ({
        rootPath,
        trusted,
      })),
    },
  };
}

function createDeferred<T>(): Deferred<T> {
  let resolveValue: ((value: T) => void) | null = null;
  let rejectValue: ((error: unknown) => void) | null = null;
  const promise = new Promise<T>((resolve, reject) => {
    resolveValue = resolve;
    rejectValue = reject;
  });

  return {
    promise,
    reject(error: unknown) {
      rejectValue?.(error);
    },
    resolve(value: T) {
      resolveValue?.(value);
    },
  };
}

async function flushAsyncTurns(count = 12): Promise<void> {
  await act(async () => {
    for (let index = 0; index < count; index += 1) {
      await Promise.resolve();
    }
  });
}

function phpWorkspaceDescriptor(): WorkspaceDescriptor {
  return {
    php: phpProjectDescriptor(),
    rootPath: "/workspace",
  };
}

function phpProjectDescriptor(): PhpProjectDescriptor {
  return {
    classmapRoots: [],
    hasComposer: true,
    packageName: "laravel/laravel",
    packages: [
      {
        classmapRoots: [],
        dev: false,
        installPath: "../laravel/framework",
        name: "laravel/framework",
        packageType: "library",
        psr4Roots: [
          {
            dev: false,
            namespace: "Illuminate\\",
            paths: ["src/Illuminate/"],
          },
        ],
        version: "13.0.0",
      },
    ],
    psr4Roots: [
      {
        dev: false,
        namespace: "App\\",
        paths: ["app/"],
      },
    ],
  };
}

function fileEntry(path: string, name: string): FileEntry {
  return {
    kind: "file",
    name,
    path,
  };
}
