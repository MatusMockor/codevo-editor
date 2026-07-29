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
import type {
  ProjectSymbolSearchGateway,
  ProjectSymbolSearchResult,
} from "../../domain/projectSymbols";
import { defaultAppSettings, defaultWorkspaceSettings } from "../../domain/settings";
import { type FileSearchResult, type TextSearchResult } from "../../domain/workspace";
import type { WorkspaceFileChangeEvent } from "../../domain/workspaceFileChange";
import { resolveInReactAct, waitForReact } from "../../test/reactTestLifecycle";
import {
  featuresGateway,
  flushAsyncTurns,
  setupWorkbenchControllerTestHarness,
  type WorkbenchController,
} from "../../test/workbenchControllerTestHarness";
import { type WorkbenchWorkspaceGateways } from "../useWorkbenchController";
import {
  createDeferred,
  fileEntry,
  lineNumberOf,
  phpWorkspaceDescriptor,
  phpactorLanguageServerPlan,
  positionAfter,
} from "./testSupport";

describe("useWorkbenchController PHP language intelligence", () => {
  const { renderController } = setupWorkbenchControllerTestHarness();

  it("resolves a basic-mode method call instantly without a project-wide file search", async () => {
    // Performance / Fleet-parity guard for the slow path. Method-call
    // navigation resolves the receiver's class through
    // resolvePhpClassSourcePaths. In basic (light) mode that class lives at its
    // deterministic PSR-4 path, so resolution must come straight from that
    // verified candidate. It must NOT fall back to the project-wide fuzzy
    // fileSearch.searchFiles (the cold 5-10s tree walk on large repos like
    // kontentino) on every Cmd+B. If this regresses, basic-mode method
    // navigation goes slow again.
    const controllerPath = "/workspace/app/Http/Controllers/CommentController.php";
    const servicePath = "/workspace/app/Services/CommentsService.php";
    const controllerSource = `<?php
namespace App\\Http\\Controllers;

use App\\Services\\CommentsService;

class CommentController
{
    public function __construct(
        private readonly CommentsService $commentsService,
    ) {}

    public function store(): void
    {
        $this->commentsService->create();
    }
}
`;
    const serviceSource = `<?php
namespace App\\Services;

class CommentsService
{
    public function create(): void
    {
    }
}
`;
    const readTextFile = vi.fn(async (path: string) => {
      if (path === controllerPath) {
        return controllerSource;
      }

      if (path === servicePath) {
        return serviceSource;
      }

      throw new Error(`Unexpected read ${path}`);
    });
    const searchFiles = vi.fn(async () => []);
    const { getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace",
      },
      readTextFile,
      searchFiles,
      workspaceSettings: {
        ...defaultWorkspaceSettings(),
        intelligenceMode: "basic",
      },
      workspaceDescriptor: phpWorkspaceDescriptor(),
    });
    await flushAsyncTurns(24);

    expect(getWorkbench().intelligenceMode).toBe("basic");

    await act(async () => {
      await getWorkbench().openFile(fileEntry(controllerPath, "CommentController.php"));
    });
    act(() => {
      getWorkbench().updateActiveEditorPosition(
        positionAfter(controllerSource, "$this->commentsService->create"),
      );
    });

    const command = getWorkbench().commands.find(
      (candidate) => candidate.id === "editor.goToDefinition",
    );

    await act(async () => {
      await command?.run();
    });

    expect(getWorkbench().activePath).toBe(servicePath);
    expect(getWorkbench().editorRevealTarget).toEqual({
      path: servicePath,
      position: {
        column: 21,
        lineNumber: lineNumberOf(serviceSource, "public function create"),
      },
    });
    expect(searchFiles).not.toHaveBeenCalled();
  });
  it("navigates an interface type-hint to its definition without Smart Index", async () => {
    const servicePath = "/workspace/app/Services/PageService.php";
    const interfacePath = "/workspace/app/Contracts/PageRepositoryInterface.php";
    const serviceSource = `<?php

namespace App\\Services;

use App\\Contracts\\PageRepositoryInterface;

class PageService
{
    public function __construct(
        private PageRepositoryInterface $pageRepository,
    ) {
    }
}
`;
    const interfaceSource = `<?php

namespace App\\Contracts;

interface PageRepositoryInterface
{
}
`;
    const readTextFile = vi.fn(async (path: string) => {
      if (path === servicePath) {
        return serviceSource;
      }

      if (path === interfacePath) {
        return interfaceSource;
      }

      throw new Error(`Unexpected read ${path}`);
    });
    const { getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace",
      },
      readTextFile,
      workspaceSettings: {
        ...defaultWorkspaceSettings(),
        intelligenceMode: "basic",
      },
      workspaceDescriptor: phpWorkspaceDescriptor(),
    });
    await flushAsyncTurns(24);

    expect(getWorkbench().intelligenceMode).toBe("basic");

    await act(async () => {
      await getWorkbench().openFile(fileEntry(servicePath, "PageService.php"));
    });
    act(() => {
      getWorkbench().updateActiveEditorPosition(
        positionAfter(serviceSource, "private PageRepositoryInterf"),
      );
    });

    const command = getWorkbench().commands.find(
      (candidate) => candidate.id === "editor.goToDefinition",
    );

    await act(async () => {
      await command?.run();
    });

    expect(getWorkbench().activePath).toBe(interfacePath);
    expect(getWorkbench().editorRevealTarget).toEqual({
      path: interfacePath,
      position: {
        column: 11,
        lineNumber: lineNumberOf(interfaceSource, "interface PageRepositoryInterface"),
      },
    });
  });
  it("does not navigate a type-hint with no resolvable class without Smart Index", async () => {
    const servicePath = "/workspace/app/Services/PageService.php";
    const serviceSource = `<?php

namespace App\\Services;

class PageService
{
    public function __construct(private UnknownDependency $unknown)
    {
    }
}
`;
    const readTextFile = vi.fn(async (path: string) => {
      if (path === servicePath) {
        return serviceSource;
      }

      throw new Error(`Unexpected read ${path}`);
    });
    const { getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace",
      },
      readTextFile,
      workspaceSettings: {
        ...defaultWorkspaceSettings(),
        intelligenceMode: "basic",
      },
      workspaceDescriptor: phpWorkspaceDescriptor(),
    });
    await flushAsyncTurns(24);

    await act(async () => {
      await getWorkbench().openFile(fileEntry(servicePath, "PageService.php"));
    });
    act(() => {
      getWorkbench().updateActiveEditorPosition(
        positionAfter(serviceSource, "private UnknownDepend"),
      );
    });

    const command = getWorkbench().commands.find(
      (candidate) => candidate.id === "editor.goToDefinition",
    );

    await act(async () => {
      await command?.run();
    });

    expect(getWorkbench().activePath).toBe(servicePath);
    expect(getWorkbench().editorRevealTarget).toBeNull();
  });
  it("drops stale contextual PHP type-hint class targets after switching project tabs", async () => {
    const servicePath = "/workspace-a/app/Services/PageService.php";
    const repositoryPath = "/workspace-a/app/Repositories/PageRepository.php";
    const serviceSource = `<?php

namespace App\\Services;

use App\\Repositories\\PageRepository;

class PageService
{
    public function __construct(private PageRepository $pageRepository)
    {
    }
}
`;
    const staleRepositoryRead = createDeferred<string>();
    let repositoryReadCount = 0;
    const readTextFile = vi.fn(async (path: string) => {
      if (path === servicePath) {
        return serviceSource;
      }

      if (path === repositoryPath) {
        repositoryReadCount += 1;
        return staleRepositoryRead.promise;
      }

      throw new Error(`Unexpected read ${path}`);
    });
    const { getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace-a",
        workspaceTabs: ["/workspace-a", "/workspace-b"],
      },
      readTextFile,
      workspaceSettings: {
        ...defaultWorkspaceSettings(),
        intelligenceMode: "basic",
      },
      workspaceDescriptor: {
        ...phpWorkspaceDescriptor(),
        rootPath: "/workspace-a",
      },
    });
    await flushAsyncTurns(24);

    await act(async () => {
      await getWorkbench().openFile(fileEntry(servicePath, "PageService.php"));
    });
    act(() => {
      getWorkbench().updateActiveEditorPosition(
        positionAfter(serviceSource, "private PageReposit"),
      );
    });

    const command = getWorkbench().commands.find(
      (candidate) => candidate.id === "editor.goToDefinition",
    );
    let commandPromise: Promise<void> = Promise.resolve();
    await act(async () => {
      commandPromise = Promise.resolve(command?.run());
      await Promise.resolve();
    });
    await waitForReact(() => {
      expect(repositoryReadCount).toBe(1);
    });

    await act(async () => {
      await getWorkbench().activateWorkspaceTab("/workspace-b");
    });
    await flushAsyncTurns();

    staleRepositoryRead.resolve(`<?php

namespace App\\Repositories;

class PageRepository
{
}
`);
    await act(async () => {
      await commandPromise;
    });
    await flushAsyncTurns(24);

    expect(getWorkbench().workspaceRoot).toBe("/workspace-b");
    expect(getWorkbench().activePath).not.toBe(repositoryPath);
    expect(getWorkbench().editorRevealTarget).toBeNull();
  });
  it("drops stale contextual PHP method targets after switching project tabs", async () => {
    const controllerPath = "/workspace-a/app/Http/Controllers/CommentController.php";
    const targetPath = "/external/shared/CommentsService.php";
    const controllerSource = `<?php
namespace App\\Http\\Controllers;

use App\\Services\\CommentsService;

class CommentController
{
    public function __construct(
        private readonly CommentsService $commentsService,
    ) {}

    public function store(): void
    {
        $this->commentsService->create();
    }
}
`;
    const symbolSearch =
      createDeferred<Awaited<ReturnType<ProjectSymbolSearchGateway["searchProjectSymbols"]>>>();
    const readTextFile = vi.fn(async (path: string) => {
      if (path === controllerPath) {
        return controllerSource;
      }

      if (path === targetPath) {
        return "<?php\nfinal class CommentsService { public function create() {} }\n";
      }

      return `<?php\n// ${path}\n`;
    });
    const { dependencies, getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace-a",
        workspaceTabs: ["/workspace-a", "/workspace-b"],
      },
      readTextFile,
      workspaceDescriptor: phpWorkspaceDescriptor(),
    });
    await flushAsyncTurns();
    await act(async () => {
      await getWorkbench().setSmartMode("lightSmart");
    });
    vi.mocked(
      dependencies.workspaceGateways.projectSymbols.searchProjectSymbols,
    ).mockImplementationOnce(async () => symbolSearch.promise);

    await act(async () => {
      await getWorkbench().openFile(fileEntry(controllerPath, "CommentController.php"));
    });
    act(() => {
      getWorkbench().updateActiveEditorPosition(positionAfter(controllerSource, "create"));
    });

    const command = getWorkbench().commands.find(
      (candidate) => candidate.id === "editor.goToDefinition",
    );
    let commandPromise: Promise<void> = Promise.resolve();
    await act(async () => {
      commandPromise = Promise.resolve(command?.run());
      await Promise.resolve();
    });
    await waitForReact(() => {
      expect(
        dependencies.workspaceGateways.projectSymbols.searchProjectSymbols,
      ).toHaveBeenCalledWith("/workspace-a", "create", 50);
    });

    await act(async () => {
      await getWorkbench().activateWorkspaceTab("/workspace-b");
    });
    await flushAsyncTurns();

    symbolSearch.resolve([
      {
        column: 53,
        containerName: "App\\Services\\CommentsService",
        fullyQualifiedName: "App\\Services\\CommentsService::create",
        kind: "method",
        lineNumber: 1,
        name: "create",
        path: targetPath,
        relativePath: "../shared/CommentsService.php",
      },
    ]);
    await act(async () => {
      await commandPromise;
    });
    await flushAsyncTurns(24);

    expect(getWorkbench().workspaceRoot).toBe("/workspace-b");
    expect(getWorkbench().activePath).not.toBe(targetPath);
    expect(readTextFile).not.toHaveBeenCalledWith(targetPath);
    expect(getWorkbench().editorRevealTarget).toBeNull();
    expect(getWorkbench().message ?? "").not.toContain("No typed target found");
  });
  it("drops stale contextual PHP property targets after switching project tabs", async () => {
    const controllerPath = "/workspace-a/app/Http/Controllers/CommentController.php";
    const commentPath = "/workspace-a/app/Models/Comment.php";
    const controllerSource = `<?php
namespace App\\Http\\Controllers;

use App\\Models\\Comment;

class CommentController
{
    public function show(Comment $comment): void
    {
        $comment->externalId;
    }
}
`;
    const commentSource = `<?php
namespace App\\Models;

class Comment
{
    public string $externalId;
}
`;
    const secondCommentRead = createDeferred<string>();
    let commentReadCount = 0;
    const readTextFile = vi.fn(async (path: string) => {
      if (path === controllerPath) {
        return controllerSource;
      }

      if (path === commentPath) {
        commentReadCount += 1;
        return commentReadCount === 2 ? secondCommentRead.promise : commentSource;
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
      workspaceDescriptor: phpWorkspaceDescriptor({
        packageName: "app/app",
        packages: [],
      }),
    });
    await flushAsyncTurns();

    await act(async () => {
      await getWorkbench().openFile(fileEntry(controllerPath, "CommentController.php"));
    });
    act(() => {
      getWorkbench().updateActiveEditorPosition(positionAfter(controllerSource, "externalId"));
    });

    const command = getWorkbench().commands.find(
      (candidate) => candidate.id === "editor.goToDefinition",
    );
    let commandPromise: Promise<void> = Promise.resolve();
    await act(async () => {
      commandPromise = Promise.resolve(command?.run());
      await Promise.resolve();
    });
    await waitForReact(() => {
      expect(commentReadCount).toBe(2);
    });

    await act(async () => {
      await getWorkbench().activateWorkspaceTab("/workspace-b");
    });
    await flushAsyncTurns();

    secondCommentRead.resolve(commentSource);
    await act(async () => {
      await commandPromise;
    });
    await flushAsyncTurns(24);

    expect(getWorkbench().workspaceRoot).toBe("/workspace-b");
    expect(readTextFile.mock.calls.filter(([path]) => path === commentPath)).toHaveLength(2);
    expect(getWorkbench().activePath).not.toBe(commentPath);
    expect(getWorkbench().editorRevealTarget).toBeNull();
    expect(getWorkbench().message ?? "").not.toContain("No relation method found");
  });
  it("stops stale Laravel model attribute target candidates after switching project tabs", async () => {
    const controllerPath = "/workspace-a/app/Http/Controllers/CommentController.php";
    const commentPath = "/workspace-a/app/Models/Comment.php";
    const packageCommentPath = "/workspace-a/vendor/shared/package/src/Models/Comment.php";
    const controllerSource = `<?php
namespace App\\Http\\Controllers;

use App\\Models\\Comment;

class CommentController
{
    public function show(Comment $comment): void
    {
        $comment->content;
    }
}
`;
    const commentSource = `<?php
namespace App\\Models;

class Comment
{
    public string $content;

    protected $appends = [
        'content',
    ];
}
`;
    const staleAttributeRead = createDeferred<string>();
    let commentReadCount = 0;
    let packageCommentReadCount = 0;
    const readTextFile = vi.fn(async (path: string) => {
      if (path === controllerPath) {
        return controllerSource;
      }

      if (path === commentPath) {
        commentReadCount += 1;
        return commentReadCount === 3 ? staleAttributeRead.promise : commentSource;
      }

      if (path === packageCommentPath) {
        packageCommentReadCount += 1;
        return commentSource;
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
      workspaceDescriptor: phpWorkspaceDescriptor({
        packageName: "app/app",
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
          {
            classmapRoots: [],
            dev: false,
            installPath: "../shared/package",
            name: "shared/package",
            packageType: "library",
            psr4Roots: [
              {
                dev: false,
                namespace: "App\\",
                paths: ["src/"],
              },
            ],
            version: "1.0.0",
          },
        ],
      }),
    });
    await flushAsyncTurns();

    await act(async () => {
      await getWorkbench().openFile(fileEntry(controllerPath, "CommentController.php"));
    });
    act(() => {
      getWorkbench().updateActiveEditorPosition(positionAfter(controllerSource, "content"));
    });

    const command = getWorkbench().commands.find(
      (candidate) => candidate.id === "editor.goToDefinition",
    );
    let commandPromise: Promise<void> = Promise.resolve();
    await act(async () => {
      commandPromise = Promise.resolve(command?.run());
      await Promise.resolve();
    });
    await waitForReact(() => {
      expect(commentReadCount).toBe(3);
    });
    const packageReadsBeforeSwitch = packageCommentReadCount;

    await act(async () => {
      await getWorkbench().activateWorkspaceTab("/workspace-b");
    });
    await flushAsyncTurns();

    staleAttributeRead.reject(new Error("stale attribute source"));
    await act(async () => {
      await commandPromise;
    });
    await flushAsyncTurns(24);

    expect(getWorkbench().workspaceRoot).toBe("/workspace-b");
    expect(packageCommentReadCount).toBe(packageReadsBeforeSwitch);
    expect(getWorkbench().activePath).not.toBe(packageCommentPath);
    expect(getWorkbench().editorRevealTarget).toBeNull();
  });
  it("stops stale Laravel dynamic where target candidates after switching project tabs", async () => {
    const controllerPath = "/workspace-a/app/Http/Controllers/CommentController.php";
    const commentPath = "/workspace-a/app/Models/Comment.php";
    const packageCommentPath = "/workspace-a/vendor/shared/package/src/Models/Comment.php";
    const controllerSource = `<?php
namespace App\\Http\\Controllers;

use App\\Models\\Comment;

class CommentController
{
    public function index(): void
    {
        Comment::whereContent('hello')->first();
    }
}
`;
    const commentSource = `<?php
namespace App\\Models;

class Comment
{
    protected $fillable = [
        'content',
    ];
}
`;
    const staleDynamicWhereRead = createDeferred<string>();
    let commentReadCount = 0;
    let packageCommentReadCount = 0;
    const readTextFile = vi.fn(async (path: string) => {
      if (path === controllerPath) {
        return controllerSource;
      }

      if (path === commentPath) {
        commentReadCount += 1;
        return commentReadCount === 2 ? staleDynamicWhereRead.promise : commentSource;
      }

      if (path === packageCommentPath) {
        packageCommentReadCount += 1;
        return commentSource;
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
      workspaceDescriptor: phpWorkspaceDescriptor({
        packageName: "app/app",
        packages: [
          {
            classmapRoots: [],
            dev: false,
            installPath: "../shared/package",
            name: "shared/package",
            packageType: "library",
            psr4Roots: [
              {
                dev: false,
                namespace: "App\\",
                paths: ["src/"],
              },
            ],
            version: "1.0.0",
          },
        ],
      }),
    });
    await flushAsyncTurns();

    await act(async () => {
      await getWorkbench().openFile(fileEntry(controllerPath, "CommentController.php"));
    });
    act(() => {
      getWorkbench().updateActiveEditorPosition(positionAfter(controllerSource, "whereContent"));
    });

    const command = getWorkbench().commands.find(
      (candidate) => candidate.id === "editor.goToDefinition",
    );
    let commandPromise: Promise<void> = Promise.resolve();
    await act(async () => {
      commandPromise = Promise.resolve(command?.run());
      await Promise.resolve();
    });
    await waitForReact(() => {
      expect(commentReadCount).toBe(2);
    });
    const packageReadsBeforeSwitch = packageCommentReadCount;

    await act(async () => {
      await getWorkbench().activateWorkspaceTab("/workspace-b");
    });
    await flushAsyncTurns();

    staleDynamicWhereRead.reject(new Error("stale dynamic where source"));
    await act(async () => {
      await commandPromise;
    });
    await flushAsyncTurns(24);

    expect(getWorkbench().workspaceRoot).toBe("/workspace-b");
    expect(packageCommentReadCount).toBe(packageReadsBeforeSwitch);
    expect(getWorkbench().activePath).not.toBe(packageCommentPath);
    expect(getWorkbench().editorRevealTarget).toBeNull();
    expect(getWorkbench().message ?? "").not.toContain("No typed target found");
  });
  it("drops stale Laravel request method hint targets after switching project tabs", async () => {
    const controllerPath = "/workspace-a/app/Http/Controllers/CommentController.php";
    const inputTraitPath =
      "/workspace-a/vendor/laravel/framework/src/Illuminate/Http/Concerns/InteractsWithInput.php";
    const controllerSource = `<?php
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
    const staleInputRead = createDeferred<string>();
    let inputTraitReadCount = 0;
    const readTextFile = vi.fn(async (path: string) => {
      if (path === controllerPath) {
        return controllerSource;
      }

      if (path === inputTraitPath) {
        inputTraitReadCount += 1;
        return staleInputRead.promise;
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
      workspaceDescriptor: phpWorkspaceDescriptor(),
    });
    await flushAsyncTurns();
    await act(async () => {
      await getWorkbench().setSmartMode("lightSmart");
    });

    await act(async () => {
      await getWorkbench().openFile(fileEntry(controllerPath, "CommentController.php"));
    });
    act(() => {
      getWorkbench().updateActiveEditorPosition(positionAfter(controllerSource, "input"));
    });

    const command = getWorkbench().commands.find(
      (candidate) => candidate.id === "editor.goToDefinition",
    );
    let commandPromise: Promise<void> = Promise.resolve();
    await act(async () => {
      commandPromise = Promise.resolve(command?.run());
      await Promise.resolve();
    });
    await waitForReact(() => {
      expect(inputTraitReadCount).toBe(1);
    });

    await act(async () => {
      await getWorkbench().activateWorkspaceTab("/workspace-b");
    });
    await flushAsyncTurns();

    staleInputRead.resolve(
      "<?php\ntrait InteractsWithInput\n{\n    public function input($key = null, $default = null) {}\n}\n",
    );
    await act(async () => {
      await commandPromise;
    });
    await flushAsyncTurns(24);

    expect(getWorkbench().workspaceRoot).toBe("/workspace-b");
    expect(getWorkbench().activePath).not.toBe(inputTraitPath);
    expect(getWorkbench().editorRevealTarget).toBeNull();
  });
  it("drops stale indexed go to definition errors after switching project tabs", async () => {
    const controllerPath = "/workspace-a/src/CommentController.php";
    const symbolSearch =
      createDeferred<Awaited<ReturnType<ProjectSymbolSearchGateway["searchProjectSymbols"]>>>();
    const { dependencies, getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace-a",
        workspaceTabs: ["/workspace-a", "/workspace-b"],
      },
      readTextFile: vi.fn(async (path: string) => {
        if (path === controllerPath) {
          return "<?php\n$agent = new CommentsAgent();\n";
        }

        return `<?php\n// ${path}\n`;
      }),
    });
    await flushAsyncTurns();
    await act(async () => {
      await getWorkbench().setSmartMode("lightSmart");
    });
    vi.mocked(
      dependencies.workspaceGateways.projectSymbols.searchProjectSymbols,
    ).mockImplementationOnce(async () => symbolSearch.promise);

    await act(async () => {
      await getWorkbench().openFile(fileEntry(controllerPath, "CommentController.php"));
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
    let commandPromise: Promise<void> = Promise.resolve();
    await act(async () => {
      commandPromise = Promise.resolve(command?.run());
      await Promise.resolve();
    });
    await waitForReact(() => {
      expect(
        dependencies.workspaceGateways.projectSymbols.searchProjectSymbols,
      ).toHaveBeenCalledWith("/workspace-a", "CommentsAgent", 25);
    });

    await act(async () => {
      await getWorkbench().activateWorkspaceTab("/workspace-b");
    });
    await flushAsyncTurns();

    await act(async () => {
      symbolSearch.reject(new Error("stale indexed definition"));
      await commandPromise;
    });
    await flushAsyncTurns();

    expect(getWorkbench().workspaceRoot).toBe("/workspace-b");
    expect(getWorkbench().message).not.toBe("Error: stale indexed definition");
    expect(
      getWorkbench().notices.some(
        (notice) =>
          notice.source === "Go to Definition" &&
          notice.message.includes("stale indexed definition"),
      ),
    ).toBe(false);
  });
  it("drops stale indexed go to definition results after switching project tabs", async () => {
    const controllerPath = "/workspace-a/src/CommentController.php";
    const agentPath = "/workspace-a/src/CommentsAgent.php";
    const symbolSearch =
      createDeferred<Awaited<ReturnType<ProjectSymbolSearchGateway["searchProjectSymbols"]>>>();
    const { dependencies, getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace-a",
        workspaceTabs: ["/workspace-a", "/workspace-b"],
      },
      readTextFile: vi.fn(async (path: string) => {
        if (path === controllerPath) {
          return "<?php\n$agent = new CommentsAgent();\n";
        }

        if (path === agentPath) {
          return "<?php\nfinal class CommentsAgent {}\n";
        }

        return `<?php\n// ${path}\n`;
      }),
    });
    await flushAsyncTurns();
    await act(async () => {
      await getWorkbench().setSmartMode("lightSmart");
    });
    vi.mocked(
      dependencies.workspaceGateways.projectSymbols.searchProjectSymbols,
    ).mockImplementationOnce(async () => symbolSearch.promise);

    await act(async () => {
      await getWorkbench().openFile(fileEntry(controllerPath, "CommentController.php"));
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
    let commandPromise: Promise<void> = Promise.resolve();
    await act(async () => {
      commandPromise = Promise.resolve(command?.run());
      await Promise.resolve();
    });
    await waitForReact(() => {
      expect(
        dependencies.workspaceGateways.projectSymbols.searchProjectSymbols,
      ).toHaveBeenCalledWith("/workspace-a", "CommentsAgent", 25);
    });

    await act(async () => {
      await getWorkbench().activateWorkspaceTab("/workspace-b");
    });
    await flushAsyncTurns();

    await act(async () => {
      symbolSearch.resolve([
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
      ]);
      await commandPromise;
    });
    await flushAsyncTurns();

    expect(getWorkbench().workspaceRoot).toBe("/workspace-b");
    expect(getWorkbench().activePath).not.toBe(agentPath);
    expect(getWorkbench().editorRevealTarget).toBeNull();
    expect(getWorkbench().message).not.toBe("Opened definition CommentsAgent.php:4:13");
  });
  it("drops stale indexed go to definition misses after switching project tabs", async () => {
    const controllerPath = "/workspace-a/src/CommentController.php";
    const symbolSearch =
      createDeferred<Awaited<ReturnType<ProjectSymbolSearchGateway["searchProjectSymbols"]>>>();
    const { dependencies, getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace-a",
        workspaceTabs: ["/workspace-a", "/workspace-b"],
      },
      readTextFile: vi.fn(async (path: string) => {
        if (path === controllerPath) {
          return "<?php\n$agent = new CommentsAgent();\n";
        }

        return `<?php\n// ${path}\n`;
      }),
    });
    await flushAsyncTurns();
    await act(async () => {
      await getWorkbench().setSmartMode("lightSmart");
    });
    vi.mocked(
      dependencies.workspaceGateways.projectSymbols.searchProjectSymbols,
    ).mockImplementationOnce(async () => symbolSearch.promise);

    await act(async () => {
      await getWorkbench().openFile(fileEntry(controllerPath, "CommentController.php"));
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
    let commandPromise: Promise<void> = Promise.resolve();
    await act(async () => {
      commandPromise = Promise.resolve(command?.run());
      await Promise.resolve();
    });
    await waitForReact(() => {
      expect(
        dependencies.workspaceGateways.projectSymbols.searchProjectSymbols,
      ).toHaveBeenCalledWith("/workspace-a", "CommentsAgent", 25);
    });

    await act(async () => {
      await getWorkbench().activateWorkspaceTab("/workspace-b");
    });
    await flushAsyncTurns();

    await act(async () => {
      symbolSearch.resolve([]);
      await commandPromise;
    });
    await flushAsyncTurns();

    expect(getWorkbench().workspaceRoot).toBe("/workspace-b");
    expect(getWorkbench().message).not.toBe("No indexed symbol found for CommentsAgent.");
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
      await getWorkbench().openFile(fileEntry(controllerPath, "CommentController.php"));
    });
    act(() => {
      getWorkbench().updateActiveEditorPosition({
        column: 23,
        lineNumber: 2,
      });
    });
    await act(async () => {
      await getWorkbench()
        .commands.find((candidate) => candidate.id === "editor.goToDefinition")
        ?.run();
    });

    expect(getWorkbench().activePath).toBe(agentPath);
    expect(getWorkbench().openDocuments.map((document) => document.path)).toEqual([agentPath]);

    await act(async () => {
      await getWorkbench().navigateBackward();
    });

    expect(getWorkbench().activePath).toBe(controllerPath);
    expect(getWorkbench().openDocuments.map((document) => document.path)).toEqual([controllerPath]);

    await act(async () => {
      await getWorkbench()
        .commands.find((candidate) => candidate.id === "navigation.forward")
        ?.run();
    });

    expect(getWorkbench().activePath).toBe(agentPath);
    expect(getWorkbench().openDocuments.map((document) => document.path)).toEqual([agentPath]);
  });
  it("resolves Laravel request input through typed parameters instead of a random input method", async () => {
    const controllerPath = "/workspace/app/Http/Controllers/CommentController.php";
    const postRequestPath = "/workspace/app/Kontentino/src/Http/Requests/POSTRequest.php";
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
      await getWorkbench().openFile(fileEntry(controllerPath, "CommentController.php"));
    });
    act(() => {
      getWorkbench().updateActiveEditorPosition({
        column: 21,
        lineNumber: 10,
      });
    });

    await act(async () => {
      await getWorkbench()
        .commands.find((candidate) => candidate.id === "editor.goToDefinition")
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
  it("provides inherited Laravel request method completions in IDE mode", async () => {
    const controllerPath = "/workspace/app/Http/Controllers/CommentController.php";
    const requestPath = "/workspace/app/Http/Request/AiHub/StoreCommentRequest.php";
    const baseRequestPath = "/workspace/app/Http/Request/BaseFormRequest.php";
    const formRequestPath =
      "/workspace/vendor/laravel/framework/src/Illuminate/Foundation/Http/FormRequest.php";
    const laravelRequestPath =
      "/workspace/vendor/laravel/framework/src/Illuminate/Http/Request.php";
    const inputTraitPath =
      "/workspace/vendor/laravel/framework/src/Illuminate/Http/Concerns/InteractsWithInput.php";
    const symfonyRequestPath = "/workspace/vendor/symfony/http-foundation/Request.php";
    const controllerSource = `<?php
namespace App\\Http\\Controllers\\publicapi\\AiHub;

use App\\Http\\Request\\AiHub\\StoreCommentRequest;

class CommentController
{
    public function store(StoreCommentRequest $request): void
    {
        $request->get
    }
}
`;
    const completionPosition = positionAfter(controllerSource, "$request->get");
    const { getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace",
      },
      readTextFile: vi.fn(async (path: string) => {
        if (path === controllerPath) {
          return controllerSource;
        }

        if (path === requestPath) {
          return `<?php
namespace App\\Http\\Request\\AiHub;

use App\\Http\\Request\\BaseFormRequest;

class StoreCommentRequest extends BaseFormRequest
{
    public function getCommentData(): array {}
}
`;
        }

        if (path === baseRequestPath) {
          return `<?php
namespace App\\Http\\Request;

use Illuminate\\Foundation\\Http\\FormRequest;

class BaseFormRequest extends FormRequest
{
    public function getUserData(): array {}
}
`;
        }

        if (path === formRequestPath) {
          return `<?php
namespace Illuminate\\Foundation\\Http;

use Illuminate\\Http\\Request;

class FormRequest extends Request
{
}
`;
        }

        if (path === laravelRequestPath) {
          return `<?php
namespace Illuminate\\Http;

use Symfony\\Component\\HttpFoundation\\Request as SymfonyRequest;

class Request extends SymfonyRequest
{
    use Concerns\\InteractsWithInput;
}
`;
        }

        if (path === inputTraitPath) {
          return `<?php
namespace Illuminate\\Http\\Concerns;

trait InteractsWithInput
{
    /**
     * Retrieve an input item from the request.
     *
     * @param  string|null  $key
     * @param  mixed  $default
     * @return mixed
     */
    public function input($key = null, $default = null) {}
}
`;
        }

        if (path === symfonyRequestPath) {
          return `<?php
namespace Symfony\\Component\\HttpFoundation;

class Request
{
    public function get(string $key, mixed $default = null): mixed {}
}
`;
        }

        return `<?php\n// ${path}\n`;
      }),
      workspaceDescriptor: phpWorkspaceDescriptor(),
    });
    await flushAsyncTurns();
    await act(async () => {
      await getWorkbench().setSmartMode("fullSmart");
    });

    await act(async () => {
      await getWorkbench().openFile(fileEntry(controllerPath, "CommentController.php"));
    });

    await expect(
      getWorkbench().providePhpMethodCompletions(controllerSource, completionPosition),
    ).resolves.toEqual([
      {
        declaringClassName: "Symfony\\Component\\HttpFoundation\\Request",
        name: "get",
        parameters: "string $key, mixed $default = null",
        returnType: "mixed",
      },
      {
        declaringClassName: "App\\Http\\Request\\AiHub\\StoreCommentRequest",
        name: "getCommentData",
        parameters: "",
        returnType: "array",
      },
      {
        declaringClassName: "App\\Http\\Request\\BaseFormRequest",
        name: "getUserData",
        parameters: "",
        returnType: "array",
      },
    ]);

    const inputCompletionSource = controllerSource.replace("$request->get", "$request->inp");

    await expect(
      getWorkbench().providePhpMethodCompletions(
        inputCompletionSource,
        positionAfter(inputCompletionSource, "$request->inp"),
      ),
    ).resolves.toEqual([
      {
        declaringClassName: "Illuminate\\Http\\Concerns\\InteractsWithInput",
        name: "input",
        parameters: "string|null $key = null, mixed $default = null",
        returnType: "mixed",
      },
    ]);

    const signatureSource = controllerSource.replace("$request->get", "$request->get(");

    await expect(
      getWorkbench().providePhpMethodSignature(
        signatureSource,
        positionAfter(signatureSource, "$request->get("),
      ),
    ).resolves.toEqual({
      argumentIndex: 0,
      method: {
        declaringClassName: "Symfony\\Component\\HttpFoundation\\Request",
        name: "get",
        parameters: "string $key, mixed $default = null",
        returnType: "mixed",
      },
      parameters: [
        {
          defaultValue: null,
          name: "$key",
          optional: false,
          raw: "string $key",
          type: "string",
        },
        {
          defaultValue: "null",
          name: "$default",
          optional: true,
          raw: "mixed $default = null",
          type: "mixed",
        },
      ],
    });

    const namedDefaultSignatureSource = controllerSource.replace(
      "$request->get",
      "$request->get(default: null",
    );

    await expect(
      getWorkbench().providePhpMethodSignature(
        namedDefaultSignatureSource,
        positionAfter(namedDefaultSignatureSource, "default: null"),
      ),
    ).resolves.toMatchObject({
      argumentIndex: 1,
      method: {
        declaringClassName: "Symfony\\Component\\HttpFoundation\\Request",
        name: "get",
      },
      parameters: [{ name: "$key" }, { name: "$default" }],
    });

    const namedKeySignatureSource = controllerSource.replace(
      "$request->get",
      "$request->get(default: null, key: 'id'",
    );

    await expect(
      getWorkbench().providePhpMethodSignature(
        namedKeySignatureSource,
        positionAfter(namedKeySignatureSource, "key: 'id'"),
      ),
    ).resolves.toMatchObject({
      argumentIndex: 0,
      method: {
        declaringClassName: "Symfony\\Component\\HttpFoundation\\Request",
        name: "get",
      },
      parameters: [{ name: "$key" }, { name: "$default" }],
    });

    const inlaySource = controllerSource.replace("$request->get", "$request->get($id, 5)");
    const inlayCallLine = inlaySource
      .split("\n")
      .findIndex((line) => line.includes("$request->get("));

    await expect(
      getWorkbench().providePhpParameterInlayHints(inlaySource, {
        endLine: inlayCallLine,
        startLine: inlayCallLine,
      }),
    ).resolves.toEqual([
      expect.objectContaining({ name: "key" }),
      expect.objectContaining({ name: "default" }),
    ]);
  });
  it("uses semantic types from properties, assignments and static calls", async () => {
    const controllerPath = "/workspace/app/Http/Controllers/CommentController.php";
    const servicePath = "/workspace/app/Services/CommentsService.php";
    const commentPath = "/workspace/app/Models/Comment.php";
    const factoryPath = "/workspace/app/Factories/CommentFactory.php";
    const controllerSource = `<?php
namespace App\\Http\\Controllers;

use App\\Factories\\CommentFactory;
use App\\Services\\CommentsService;

class CommentController
{
    public function __construct(
        private readonly CommentsService $commentsService,
    ) {}

    public function store(): void
    {
        $comment = $this->commentsService->create();
        $this->commentsService->cre
        $comment->get
        CommentFactory::ma
    }
}
`;
    const { getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace",
      },
      readTextFile: vi.fn(async (path: string) => {
        if (path === controllerPath) {
          return controllerSource;
        }

        if (path === servicePath) {
          return `<?php
namespace App\\Services;

use App\\Models\\Comment;

class CommentsService
{
    public function create(): Comment {}
}
`;
        }

        if (path === commentPath) {
          return `<?php
namespace App\\Models;

class Comment
{
    public function getBody(): string {}
}
`;
        }

        if (path === factoryPath) {
          return `<?php
namespace App\\Factories;

use App\\Models\\Comment;

class CommentFactory
{
    public static function make(): Comment {}
    public function makeInstance(): Comment {}
}
`;
        }

        return `<?php\n// ${path}\n`;
      }),
      workspaceDescriptor: phpWorkspaceDescriptor(),
    });
    await flushAsyncTurns();
    await act(async () => {
      await getWorkbench().setSmartMode("fullSmart");
    });

    await act(async () => {
      await getWorkbench().openFile(fileEntry(controllerPath, "CommentController.php"));
    });

    await expect(
      getWorkbench().providePhpMethodCompletions(
        controllerSource,
        positionAfter(controllerSource, "$this->commentsService->cre"),
      ),
    ).resolves.toEqual([
      {
        declaringClassName: "App\\Services\\CommentsService",
        name: "create",
        parameters: "",
        returnType: "Comment",
      },
    ]);
    await expect(
      getWorkbench().providePhpMethodCompletions(
        controllerSource,
        positionAfter(controllerSource, "$comment->get"),
      ),
    ).resolves.toEqual([
      {
        declaringClassName: "App\\Models\\Comment",
        name: "getBody",
        parameters: "",
        returnType: "string",
      },
    ]);
    await expect(
      getWorkbench().providePhpMethodCompletions(
        controllerSource,
        positionAfter(controllerSource, "CommentFactory::ma"),
      ),
    ).resolves.toEqual([
      {
        declaringClassName: "App\\Factories\\CommentFactory",
        isStatic: true,
        name: "make",
        parameters: "",
        returnType: "Comment",
      },
    ]);
  });
  it("drops stale PHP method completions after switching project tabs", async () => {
    const controllerPath = "/workspace-a/app/Http/Controllers/CommentController.php";
    const servicePath = "/workspace-a/app/Services/CommentsService.php";
    const controllerSource = `<?php
namespace App\\Http\\Controllers;

use App\\Services\\CommentsService;

class CommentController
{
    public function __construct(
        private readonly CommentsService $commentsService,
    ) {}

    public function store(): void
    {
        $this->commentsService->cre
    }
}
`;
    const serviceRead = createDeferred<string>();
    const readTextFile = vi.fn(async (path: string) => {
      if (path === controllerPath) {
        return controllerSource;
      }

      if (path === servicePath) {
        return serviceRead.promise;
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
      workspaceDescriptor: phpWorkspaceDescriptor(),
    });
    await flushAsyncTurns();
    await act(async () => {
      await getWorkbench().openFile(fileEntry(controllerPath, "CommentController.php"));
    });

    let completionsPromise: ReturnType<WorkbenchController["providePhpMethodCompletions"]> | null =
      null;
    await act(async () => {
      completionsPromise = getWorkbench().providePhpMethodCompletions(
        controllerSource,
        positionAfter(controllerSource, "$this->commentsService->cre"),
      );
      await Promise.resolve();
    });
    await waitForReact(() => {
      expect(readTextFile).toHaveBeenCalledWith(servicePath);
    });

    await act(async () => {
      await getWorkbench().activateWorkspaceTab("/workspace-b");
    });
    await flushAsyncTurns();

    serviceRead.resolve(`<?php
namespace App\\Services;

class CommentsService
{
    public function create(): string {}
}
`);

    expect(completionsPromise).not.toBeNull();
    await expect(completionsPromise).resolves.toEqual([]);
  });
  describe("Laravel migration-backed model attribute completions", () => {
    const migrationsDirFor = (root: string) => `${root}/database/migrations`;
    const migrationFileName = "2026_05_04_150000_create_ai_usages_table.php";
    const migrationPathFor = (root: string) => `${migrationsDirFor(root)}/${migrationFileName}`;
    const modelPathFor = (root: string) => `${root}/app/Models/AiUsage.php`;
    const controllerPathFor = (root: string) => `${root}/app/Http/Controllers/UsageController.php`;

    const aiUsageModel = `<?php
namespace App\\Models;

use Illuminate\\Database\\Eloquent\\Model;

class AiUsage extends Model
{
    protected $table = 'ai_usages';

    protected $fillable = [
        'user_id',
        'account_id',
        'usage_date',
        'usage_count',
    ];

    protected $casts = [
        'user_id' => 'integer',
        'account_id' => 'integer',
        'usage_count' => 'integer',
        'usage_date' => 'date',
    ];
}
`;

    const aiUsagesMigration = (extraColumn = "") => `<?php

declare(strict_types=1);

use Illuminate\\Database\\Migrations\\Migration;
use Illuminate\\Database\\Schema\\Blueprint;
use Illuminate\\Support\\Facades\\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('ai_usages', function (Blueprint $table) {
            $table->id();
            $table->integer('user_id');
            $table->integer('account_id');
            $table->date('usage_date');
            $table->integer('usage_count')->default(0);${extraColumn}
            $table->timestamps();
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('ai_usages');
    }
};
`;

    const controllerSource = `<?php
namespace App\\Http\\Controllers;

use App\\Models\\AiUsage;

class UsageController
{
    public function show(AiUsage $usage): void
    {
        $usage->
    }
}
`;
    const completionPosition = positionAfter(controllerSource, "$usage->");

    async function completionNames(getWorkbench: () => WorkbenchController): Promise<string[]> {
      const completions = await getWorkbench().providePhpMethodCompletions(
        controllerSource,
        completionPosition,
      );

      return completions.map((completion) => completion.name);
    }

    it("surfaces migration-only DB columns in model member completions once the per-root cache warms", async () => {
      const root = "/workspace";
      const readDirectory = vi.fn(async (path: string) =>
        path === migrationsDirFor(root)
          ? [fileEntry(migrationPathFor(root), migrationFileName)]
          : [],
      );
      const readTextFile = vi.fn(async (path: string) => {
        if (path === controllerPathFor(root)) {
          return controllerSource;
        }

        if (path === modelPathFor(root)) {
          return aiUsageModel;
        }

        if (path === migrationPathFor(root)) {
          return aiUsagesMigration();
        }

        return `<?php\n// ${path}\n`;
      });
      const { getWorkbench } = renderController({
        appSettings: {
          ...defaultAppSettings(),
          recentWorkspacePath: root,
        },
        readDirectory,
        readTextFile,
        workspaceDescriptor: phpWorkspaceDescriptor(),
      });
      await flushAsyncTurns();
      await act(async () => {
        await getWorkbench().setSmartMode("fullSmart");
      });
      await act(async () => {
        await getWorkbench().openFile(fileEntry(controllerPathFor(root), "UsageController.php"));
      });

      // First completion warms the cache off the hot path; it is served from
      // the (empty) cache, so it may not yet carry migration columns.
      await act(async () => {
        await completionNames(getWorkbench);
      });
      await waitForReact(() => {
        expect(readTextFile).toHaveBeenCalledWith(migrationPathFor(root));
      });

      const warm = await completionNames(getWorkbench);

      // $fillable/$casts attributes remain.
      expect(warm).toEqual(expect.arrayContaining(["user_id", "account_id", "usage_count"]));
      // Columns that only exist in the migration (primary key + timestamps()).
      expect(warm).toEqual(expect.arrayContaining(["id", "created_at", "updated_at"]));
    });

    it("falls back to $fillable/$casts without crashing when no migrations exist", async () => {
      const root = "/workspace";
      const readDirectory = vi.fn(async () => []);
      const readTextFile = vi.fn(async (path: string) => {
        if (path === controllerPathFor(root)) {
          return controllerSource;
        }

        if (path === modelPathFor(root)) {
          return aiUsageModel;
        }

        return `<?php\n// ${path}\n`;
      });
      const { getWorkbench } = renderController({
        appSettings: {
          ...defaultAppSettings(),
          recentWorkspacePath: root,
        },
        readDirectory,
        readTextFile,
        workspaceDescriptor: phpWorkspaceDescriptor(),
      });
      await flushAsyncTurns();
      await act(async () => {
        await getWorkbench().setSmartMode("fullSmart");
      });
      await act(async () => {
        await getWorkbench().openFile(fileEntry(controllerPathFor(root), "UsageController.php"));
      });

      await act(async () => {
        await completionNames(getWorkbench);
      });
      await flushAsyncTurns();

      const names = await completionNames(getWorkbench);

      expect(names).toEqual(expect.arrayContaining(["user_id", "account_id", "usage_count"]));
      // Migration-only columns never appear when there are no migrations.
      expect(names).not.toContain("created_at");
      expect(names).not.toContain("id");
    });

    it("reads the migrations directory once and serves later completions from cache", async () => {
      const root = "/workspace";
      const readDirectory = vi.fn(async (path: string) =>
        path === migrationsDirFor(root)
          ? [fileEntry(migrationPathFor(root), migrationFileName)]
          : [],
      );
      const readTextFile = vi.fn(async (path: string) => {
        if (path === controllerPathFor(root)) {
          return controllerSource;
        }

        if (path === modelPathFor(root)) {
          return aiUsageModel;
        }

        if (path === migrationPathFor(root)) {
          return aiUsagesMigration();
        }

        return `<?php\n// ${path}\n`;
      });
      const { getWorkbench } = renderController({
        appSettings: {
          ...defaultAppSettings(),
          recentWorkspacePath: root,
        },
        readDirectory,
        readTextFile,
        workspaceDescriptor: phpWorkspaceDescriptor(),
      });
      await flushAsyncTurns();
      await act(async () => {
        await getWorkbench().setSmartMode("fullSmart");
      });
      await act(async () => {
        await getWorkbench().openFile(fileEntry(controllerPathFor(root), "UsageController.php"));
      });

      await act(async () => {
        await completionNames(getWorkbench);
      });
      await waitForReact(() => {
        expect(readTextFile).toHaveBeenCalledWith(migrationPathFor(root));
      });

      await completionNames(getWorkbench);
      await completionNames(getWorkbench);
      await completionNames(getWorkbench);

      const migrationDirReads = readDirectory.mock.calls.filter(
        ([path]) => path === migrationsDirFor(root),
      );
      expect(migrationDirReads).toHaveLength(1);
    });

    it("reloads migration sources after a migration file change", async () => {
      const root = "/workspace";
      let publishFileChange: ((event: WorkspaceFileChangeEvent) => void) | null = null;
      let migrationSource = aiUsagesMigration();
      const readDirectory = vi.fn(async (path: string) =>
        path === migrationsDirFor(root)
          ? [fileEntry(migrationPathFor(root), migrationFileName)]
          : [],
      );
      const readTextFile = vi.fn(async (path: string) => {
        if (path === controllerPathFor(root)) {
          return controllerSource;
        }

        if (path === modelPathFor(root)) {
          return aiUsageModel;
        }

        if (path === migrationPathFor(root)) {
          return migrationSource;
        }

        return `<?php\n// ${path}\n`;
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
          recentWorkspacePath: root,
        },
        readDirectory,
        readTextFile,
        workspaceFileChangeGateway,
        workspaceDescriptor: phpWorkspaceDescriptor(),
      });
      await flushAsyncTurns();
      await act(async () => {
        await getWorkbench().setSmartMode("fullSmart");
      });
      await act(async () => {
        await getWorkbench().openFile(fileEntry(controllerPathFor(root), "UsageController.php"));
      });

      await act(async () => {
        await completionNames(getWorkbench);
      });
      await waitForReact(() => {
        expect(readTextFile).toHaveBeenCalledWith(migrationPathFor(root));
      });

      expect(await completionNames(getWorkbench)).not.toContain("nickname");

      // A new migration column lands on disk and the watcher reports the change.
      migrationSource = aiUsagesMigration("\n            $table->string('nickname');");
      await act(async () => {
        publishFileChange?.({
          kind: "modified",
          path: migrationPathFor(root),
          relativePath: `database/migrations/${migrationFileName}`,
          rootPath: root,
        });
        await flushAsyncTurns();
      });

      await act(async () => {
        await completionNames(getWorkbench);
      });
      await waitForReact(async () => {
        expect(await completionNames(getWorkbench)).toContain("nickname");
      });
    });

    it("keeps migration sources isolated per workspace tab", async () => {
      const rootA = "/workspace-a";
      const rootB = "/workspace-b";
      const readDirectory = vi.fn(async (path: string) =>
        path === migrationsDirFor(rootA)
          ? [fileEntry(migrationPathFor(rootA), migrationFileName)]
          : [],
      );
      const readTextFile = vi.fn(async (path: string) => {
        if (path === controllerPathFor(rootA) || path === controllerPathFor(rootB)) {
          return controllerSource;
        }

        if (path === modelPathFor(rootA) || path === modelPathFor(rootB)) {
          return aiUsageModel;
        }

        if (path === migrationPathFor(rootA)) {
          return aiUsagesMigration();
        }

        return `<?php\n// ${path}\n`;
      });
      const { getWorkbench } = renderController({
        appSettings: {
          ...defaultAppSettings(),
          recentWorkspacePath: rootA,
          workspaceTabs: [rootA, rootB],
        },
        readDirectory,
        readTextFile,
        workspaceDescriptor: phpWorkspaceDescriptor(),
      });
      await waitForReact(() => {
        expect(getWorkbench().workspaceRoot).toBe(rootA);
      });
      await act(async () => {
        await getWorkbench().setSmartMode("fullSmart");
      });
      await act(async () => {
        await getWorkbench().openFile(fileEntry(controllerPathFor(rootA), "UsageController.php"));
      });

      await act(async () => {
        await completionNames(getWorkbench);
      });
      await waitForReact(async () => {
        expect(await completionNames(getWorkbench)).toContain("created_at");
      });

      // Switch to workspace B, which has no migrations: A's DB-only columns must
      // not leak into B's completions.
      await act(async () => {
        await getWorkbench().activateWorkspaceTab(rootB);
      });
      await waitForReact(() => {
        expect(getWorkbench().workspaceRoot).toBe(rootB);
      });
      await act(async () => {
        await getWorkbench().openFile(fileEntry(controllerPathFor(rootB), "UsageController.php"));
      });

      await act(async () => {
        await completionNames(getWorkbench);
      });
      await flushAsyncTurns();

      const namesForB = await completionNames(getWorkbench);
      expect(namesForB).toEqual(expect.arrayContaining(["user_id", "account_id"]));
      expect(namesForB).not.toContain("created_at");
      expect(namesForB).not.toContain("id");
    });
  });
  describe("Laravel provider-backed Eloquent Builder macro completions", () => {
    const providersDirFor = (root: string) => `${root}/app/Providers`;
    const providerFileName = "AppServiceProvider.php";
    const providerPathFor = (root: string) => `${providersDirFor(root)}/${providerFileName}`;
    const postModelPathFor = (root: string) => `${root}/app/Models/Post.php`;
    const controllerPathFor = (root: string) => `${root}/app/Http/Controllers/PostController.php`;

    const postModel = `<?php
namespace App\\Models;

use Illuminate\\Database\\Eloquent\\Model;

class Post extends Model
{
}
`;

    // Minimal vendor stub so the controller can resolve the Eloquent Builder
    // class (the receiver type of Post::query()) to a source file. The macro is
    // NOT declared here - it is contributed via the provider sources merged into
    // the workspace source context.
    const builderStub = `<?php
namespace Illuminate\\Database\\Eloquent;

class Builder
{
}
`;

    const appServiceProvider = (extraMacro = "") => `<?php
namespace App\\Providers;

use Illuminate\\Database\\Eloquent\\Builder;
use Illuminate\\Support\\ServiceProvider;

class AppServiceProvider extends ServiceProvider
{
    public function boot(): void
    {
        Builder::macro('withDashboardScope', function (array $relations = []): Builder {
            return $this->with($relations);
        });${extraMacro}
    }
}
`;

    const controllerSource = `<?php
namespace App\\Http\\Controllers;

use App\\Models\\Post;

class PostController
{
    public function index(): void
    {
        Post::query()->withDash
    }
}
`;
    const completionPosition = positionAfter(controllerSource, "withDash");

    async function completionNames(getWorkbench: () => WorkbenchController): Promise<string[]> {
      const completions = await getWorkbench().providePhpMethodCompletions(
        controllerSource,
        completionPosition,
      );

      return completions.map((completion) => completion.name);
    }

    it("surfaces a provider-registered Builder::macro once the per-root cache warms", async () => {
      const root = "/workspace";
      const readDirectory = vi.fn(async (path: string) =>
        path === providersDirFor(root) ? [fileEntry(providerPathFor(root), providerFileName)] : [],
      );
      const readTextFile = vi.fn(async (path: string) => {
        if (path === controllerPathFor(root)) {
          return controllerSource;
        }

        if (path === postModelPathFor(root)) {
          return postModel;
        }

        if (path === providerPathFor(root)) {
          return appServiceProvider();
        }

        if (path.endsWith("Builder.php")) {
          return builderStub;
        }

        return `<?php\n// ${path}\n`;
      });
      const { getWorkbench } = renderController({
        appSettings: {
          ...defaultAppSettings(),
          recentWorkspacePath: root,
        },
        readDirectory,
        readTextFile,
        workspaceDescriptor: phpWorkspaceDescriptor(),
      });
      await flushAsyncTurns();
      await act(async () => {
        await getWorkbench().setSmartMode("fullSmart");
      });
      await act(async () => {
        await getWorkbench().openFile(fileEntry(controllerPathFor(root), "PostController.php"));
      });

      // First completion warms the cache off the hot path; it is served from the
      // (empty) cache, so it may not yet carry the provider macro.
      await act(async () => {
        await completionNames(getWorkbench);
      });
      await waitForReact(() => {
        expect(readTextFile).toHaveBeenCalledWith(providerPathFor(root));
      });

      const warm = await completionNames(getWorkbench);

      expect(warm).toContain("withDashboardScope");
    });

    it("reclassifies existing provider macro diagnostics once the per-root cache warms", async () => {
      let diagnosticsListener: ((event: LanguageServerDiagnosticEvent) => void) | null = null;
      const root = "/workspace";
      const collectionControllerSource = `<?php
namespace App\\Http\\Controllers;

use Illuminate\\Support\\Collection;

class PostController
{
    public function index(Collection $items): void
    {
        collect([['id' => 1]])->diffAssocMultiple($items);
    }
}
`;
      const readDirectory = vi.fn(async (path: string) =>
        path === providersDirFor(root) ? [fileEntry(providerPathFor(root), providerFileName)] : [],
      );
      const readTextFile = vi.fn(async (path: string) => {
        if (path === controllerPathFor(root)) {
          return collectionControllerSource;
        }

        if (path === providerPathFor(root)) {
          return appServiceProvider(
            `\n        \\Illuminate\\Support\\Collection::macro('diffAssocMultiple', function (Collection $items) {\n            return $this;\n        });`,
          );
        }

        return `<?php\n// ${path}\n`;
      });
      const runningStatus: LanguageServerRuntimeStatus = {
        capabilities: emptyLanguageServerCapabilities(),
        kind: "running",
        sessionId: 75,
      };
      const diagnosticsGateway: LanguageServerDiagnosticsGateway = {
        subscribeDiagnostics: vi.fn(async (listener) => {
          diagnosticsListener = listener;
          return () => undefined;
        }),
      };
      const { getWorkbench } = renderController({
        appSettings: {
          ...defaultAppSettings(),
          recentWorkspacePath: root,
        },
        languageServerDiagnosticsGateway: diagnosticsGateway,
        readDirectory,
        readTextFile,
        runtimeStatus: runningStatus,
        workspaceDescriptor: phpWorkspaceDescriptor(),
      });
      await flushAsyncTurns();
      await act(async () => {
        await getWorkbench().setSmartMode("fullSmart");
      });
      await act(async () => {
        await getWorkbench().openFile(fileEntry(controllerPathFor(root), "PostController.php"));
      });

      expect(diagnosticsListener).not.toBeNull();

      act(() => {
        diagnosticsListener?.({
          diagnostics: [
            {
              character: 32,
              line: 9,
              message:
                'Method "diffAssocMultiple" does not exist on class "Illuminate\\Support\\Collection<TKey,TValue>"',
              severity: "error",
              source: "phpactor",
            },
          ],
          rootPath: root,
          sessionId: runningStatus.sessionId,
          uri: fileUriFromPath(controllerPathFor(root)),
          version: null,
        });
      });

      await waitForReact(() => {
        expect(readTextFile).toHaveBeenCalledWith(providerPathFor(root));
      });
      await waitForReact(() => {
        expect(getWorkbench().languageServerDiagnosticsByPath[controllerPathFor(root)]).toEqual([
          {
            character: 32,
            line: 9,
            message:
              'Method "diffAssocMultiple" does not exist on class "Illuminate\\Support\\Collection<TKey,TValue>"',
            severity: "hint",
            source: "laravel-magic",
          },
        ]);
      });
    });

    it("falls back without crashing when no providers exist", async () => {
      const root = "/workspace";
      const readDirectory = vi.fn(async () => []);
      const readTextFile = vi.fn(async (path: string) => {
        if (path === controllerPathFor(root)) {
          return controllerSource;
        }

        if (path === postModelPathFor(root)) {
          return postModel;
        }

        if (path.endsWith("Builder.php")) {
          return builderStub;
        }

        return `<?php\n// ${path}\n`;
      });
      const { getWorkbench } = renderController({
        appSettings: {
          ...defaultAppSettings(),
          recentWorkspacePath: root,
        },
        readDirectory,
        readTextFile,
        workspaceDescriptor: phpWorkspaceDescriptor(),
      });
      await flushAsyncTurns();
      await act(async () => {
        await getWorkbench().setSmartMode("fullSmart");
      });
      await act(async () => {
        await getWorkbench().openFile(fileEntry(controllerPathFor(root), "PostController.php"));
      });

      await act(async () => {
        await completionNames(getWorkbench);
      });
      await flushAsyncTurns();

      const names = await completionNames(getWorkbench);

      // No providers -> no provider-defined macro, and no crash.
      expect(names).not.toContain("withDashboardScope");
    });

    it("reads the providers directory once and serves later completions from cache", async () => {
      const root = "/workspace";
      const readDirectory = vi.fn(async (path: string) =>
        path === providersDirFor(root) ? [fileEntry(providerPathFor(root), providerFileName)] : [],
      );
      const readTextFile = vi.fn(async (path: string) => {
        if (path === controllerPathFor(root)) {
          return controllerSource;
        }

        if (path === postModelPathFor(root)) {
          return postModel;
        }

        if (path === providerPathFor(root)) {
          return appServiceProvider();
        }

        if (path.endsWith("Builder.php")) {
          return builderStub;
        }

        return `<?php\n// ${path}\n`;
      });
      const { getWorkbench } = renderController({
        appSettings: {
          ...defaultAppSettings(),
          recentWorkspacePath: root,
        },
        readDirectory,
        readTextFile,
        workspaceDescriptor: phpWorkspaceDescriptor(),
      });
      await flushAsyncTurns();
      await act(async () => {
        await getWorkbench().setSmartMode("fullSmart");
      });
      await act(async () => {
        await getWorkbench().openFile(fileEntry(controllerPathFor(root), "PostController.php"));
      });

      await act(async () => {
        await completionNames(getWorkbench);
      });
      await waitForReact(() => {
        expect(readTextFile).toHaveBeenCalledWith(providerPathFor(root));
      });

      await completionNames(getWorkbench);
      await completionNames(getWorkbench);
      await completionNames(getWorkbench);

      const providerDirReads = readDirectory.mock.calls.filter(
        ([path]) => path === providersDirFor(root),
      );
      expect(providerDirReads).toHaveLength(1);
    });

    it("reloads provider sources after a provider file change", async () => {
      const root = "/workspace";
      let publishFileChange: ((event: WorkspaceFileChangeEvent) => void) | null = null;
      let providerSource = appServiceProvider();
      const readDirectory = vi.fn(async (path: string) =>
        path === providersDirFor(root) ? [fileEntry(providerPathFor(root), providerFileName)] : [],
      );
      const readTextFile = vi.fn(async (path: string) => {
        if (path === controllerPathFor(root)) {
          return controllerSource;
        }

        if (path === postModelPathFor(root)) {
          return postModel;
        }

        if (path === providerPathFor(root)) {
          return providerSource;
        }

        if (path.endsWith("Builder.php")) {
          return builderStub;
        }

        return `<?php\n// ${path}\n`;
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
          recentWorkspacePath: root,
        },
        readDirectory,
        readTextFile,
        workspaceFileChangeGateway,
        workspaceDescriptor: phpWorkspaceDescriptor(),
      });
      await flushAsyncTurns();
      await act(async () => {
        await getWorkbench().setSmartMode("fullSmart");
      });
      await act(async () => {
        await getWorkbench().openFile(fileEntry(controllerPathFor(root), "PostController.php"));
      });

      await act(async () => {
        await completionNames(getWorkbench);
      });
      await waitForReact(() => {
        expect(readTextFile).toHaveBeenCalledWith(providerPathFor(root));
      });

      expect(await completionNames(getWorkbench)).not.toContain("withDashboardCounts");

      // A new macro lands on disk and the watcher reports the change.
      providerSource = appServiceProvider(
        `\n        Builder::macro('withDashboardCounts', function (): Builder {\n            return $this;\n        });`,
      );
      await act(async () => {
        publishFileChange?.({
          kind: "modified",
          path: providerPathFor(root),
          relativePath: `app/Providers/${providerFileName}`,
          rootPath: root,
        });
        await flushAsyncTurns();
      });

      await act(async () => {
        await completionNames(getWorkbench);
      });
      await waitForReact(async () => {
        expect(await completionNames(getWorkbench)).toContain("withDashboardCounts");
      });
    });

    it("keeps provider sources isolated per workspace tab", async () => {
      const rootA = "/workspace-a";
      const rootB = "/workspace-b";
      const readDirectory = vi.fn(async (path: string) =>
        path === providersDirFor(rootA)
          ? [fileEntry(providerPathFor(rootA), providerFileName)]
          : [],
      );
      const readTextFile = vi.fn(async (path: string) => {
        if (path === controllerPathFor(rootA) || path === controllerPathFor(rootB)) {
          return controllerSource;
        }

        if (path === postModelPathFor(rootA) || path === postModelPathFor(rootB)) {
          return postModel;
        }

        if (path === providerPathFor(rootA)) {
          return appServiceProvider();
        }

        if (path.endsWith("Builder.php")) {
          return builderStub;
        }

        return `<?php\n// ${path}\n`;
      });
      const { getWorkbench } = renderController({
        appSettings: {
          ...defaultAppSettings(),
          recentWorkspacePath: rootA,
          workspaceTabs: [rootA, rootB],
        },
        readDirectory,
        readTextFile,
        workspaceDescriptor: phpWorkspaceDescriptor(),
      });
      await waitForReact(() => {
        expect(getWorkbench().workspaceRoot).toBe(rootA);
      });
      await act(async () => {
        await getWorkbench().setSmartMode("fullSmart");
      });
      await act(async () => {
        await getWorkbench().openFile(fileEntry(controllerPathFor(rootA), "PostController.php"));
      });

      await act(async () => {
        await completionNames(getWorkbench);
      });
      await waitForReact(async () => {
        expect(await completionNames(getWorkbench)).toContain("withDashboardScope");
      });

      // Switch to workspace B, which has no providers: A's macro must not leak
      // into B's completions.
      await act(async () => {
        await getWorkbench().activateWorkspaceTab(rootB);
      });
      await waitForReact(() => {
        expect(getWorkbench().workspaceRoot).toBe(rootB);
      });
      await act(async () => {
        await getWorkbench().openFile(fileEntry(controllerPathFor(rootB), "PostController.php"));
      });

      await act(async () => {
        await completionNames(getWorkbench);
      });
      await flushAsyncTurns();

      expect(await completionNames(getWorkbench)).not.toContain("withDashboardScope");
    });
  });
  it("stops stale PHP class source resolver fallback after switching project tabs", async () => {
    const controllerPath = "/workspace-a/app/Http/Controllers/CommentController.php";
    const controllerSource = `<?php
namespace App\\Http\\Controllers;

use App\\Services\\CommentsService;

class CommentController
{
    public function __construct(
        private readonly CommentsService $commentsService,
    ) {}

    public function store(): void
    {
        $this->commentsService->cre
    }
}
`;
    const symbolSearch =
      createDeferred<Awaited<ReturnType<ProjectSymbolSearchGateway["searchProjectSymbols"]>>>();
    const searchFiles = vi.fn(async () => []);
    const { dependencies, getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace-a",
        workspaceTabs: ["/workspace-a", "/workspace-b"],
      },
      readTextFile: vi.fn(async (path: string) => {
        if (path === controllerPath) {
          return controllerSource;
        }

        return `<?php\n// ${path}\n`;
      }),
      searchFiles,
      workspaceDescriptor: phpWorkspaceDescriptor(),
    });
    await flushAsyncTurns();
    await act(async () => {
      await getWorkbench().setSmartMode("fullSmart");
    });
    vi.mocked(
      dependencies.workspaceGateways.projectSymbols.searchProjectSymbols,
    ).mockImplementationOnce(async () => symbolSearch.promise);
    await act(async () => {
      await getWorkbench().openFile(fileEntry(controllerPath, "CommentController.php"));
    });

    let completionsPromise: ReturnType<WorkbenchController["providePhpMethodCompletions"]> | null =
      null;
    await act(async () => {
      completionsPromise = getWorkbench().providePhpMethodCompletions(
        controllerSource,
        positionAfter(controllerSource, "$this->commentsService->cre"),
      );
      await Promise.resolve();
    });
    await waitForReact(() => {
      expect(
        dependencies.workspaceGateways.projectSymbols.searchProjectSymbols,
      ).toHaveBeenCalledWith("/workspace-a", "CommentsService", 50);
    });

    await act(async () => {
      await getWorkbench().activateWorkspaceTab("/workspace-b");
    });
    await flushAsyncTurns();

    symbolSearch.resolve([]);

    expect(completionsPromise).not.toBeNull();
    await expect(completionsPromise).resolves.toEqual([]);
    await flushAsyncTurns(24);

    expect(searchFiles).not.toHaveBeenCalledWith("/workspace-b", "CommentsService.php", 40);
  });
  it("stops stale PHP method completion traversal after switching project tabs", async () => {
    const controllerPath = "/workspace-a/app/Http/Controllers/CommentController.php";
    const servicePath = "/workspace-a/app/Services/CommentsService.php";
    const workspaceBBaseServicePath = "/workspace-b/app/Services/BaseCommentsService.php";
    const controllerSource = `<?php
namespace App\\Http\\Controllers;

use App\\Services\\CommentsService;

class CommentController
{
    public function __construct(
        private readonly CommentsService $commentsService,
    ) {}

    public function store(): void
    {
        $this->commentsService->cre
    }
}
`;
    const staleServiceRead = createDeferred<string>();
    let workspaceBBaseServiceReadCount = 0;
    const readTextFile = vi.fn(async (path: string) => {
      if (path === controllerPath) {
        return controllerSource;
      }

      if (path === servicePath) {
        return staleServiceRead.promise;
      }

      if (path === workspaceBBaseServicePath) {
        workspaceBBaseServiceReadCount += 1;
        return "<?php\nnamespace App\\Services;\nclass BaseCommentsService {}\n";
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
      workspaceDescriptor: phpWorkspaceDescriptor(),
    });
    await flushAsyncTurns();
    await act(async () => {
      await getWorkbench().openFile(fileEntry(controllerPath, "CommentController.php"));
    });

    let completionsPromise: ReturnType<WorkbenchController["providePhpMethodCompletions"]> | null =
      null;
    await act(async () => {
      completionsPromise = getWorkbench().providePhpMethodCompletions(
        controllerSource,
        positionAfter(controllerSource, "$this->commentsService->cre"),
      );
      await Promise.resolve();
    });
    await waitForReact(() => {
      expect(readTextFile).toHaveBeenCalledWith(servicePath);
    });

    await act(async () => {
      await getWorkbench().activateWorkspaceTab("/workspace-b");
    });
    await flushAsyncTurns();

    staleServiceRead.resolve(`<?php
namespace App\\Services;

class CommentsService extends BaseCommentsService
{
    public function create(): string {}
}
`);

    expect(completionsPromise).not.toBeNull();
    await expect(completionsPromise).resolves.toEqual([]);
    await flushAsyncTurns(24);

    expect(getWorkbench().workspaceRoot).toBe("/workspace-b");
    expect(workspaceBBaseServiceReadCount).toBe(0);
  });
  it("stops stale PHP method return type traversal after switching project tabs", async () => {
    const controllerPath = "/workspace-a/app/Http/Controllers/CommentController.php";
    const repositoryPath = "/workspace-a/app/Repositories/CommentRepository.php";
    const workspaceBBaseRepositoryPath = "/workspace-b/app/Repositories/BaseCommentRepository.php";
    const controllerSource = `<?php
namespace App\\Http\\Controllers;

use App\\Repositories\\CommentRepository;

class CommentController
{
    public function __construct(
        private readonly CommentRepository $comments,
    ) {}

    public function show(): void
    {
        $comment = $this->comments->findOrFail(1);
        $comment->get
    }
}
`;
    const staleRepositoryRead = createDeferred<string>();
    let workspaceBBaseRepositoryReadCount = 0;
    const readTextFile = vi.fn(async (path: string) => {
      if (path === controllerPath) {
        return controllerSource;
      }

      if (path === repositoryPath) {
        return staleRepositoryRead.promise;
      }

      if (path === workspaceBBaseRepositoryPath) {
        workspaceBBaseRepositoryReadCount += 1;
        return `<?php
namespace App\\Repositories;

use App\\Models\\Comment;

class BaseCommentRepository
{
    public function findOrFail(int $id): Comment {}
}
`;
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
      workspaceDescriptor: phpWorkspaceDescriptor(),
    });
    await flushAsyncTurns();
    await act(async () => {
      await getWorkbench().openFile(fileEntry(controllerPath, "CommentController.php"));
    });

    let completionsPromise: ReturnType<WorkbenchController["providePhpMethodCompletions"]> | null =
      null;
    await act(async () => {
      completionsPromise = getWorkbench().providePhpMethodCompletions(
        controllerSource,
        positionAfter(controllerSource, "$comment->get"),
      );
      await Promise.resolve();
    });
    await waitForReact(() => {
      expect(readTextFile).toHaveBeenCalledWith(repositoryPath);
    });

    await act(async () => {
      await getWorkbench().activateWorkspaceTab("/workspace-b");
    });
    await flushAsyncTurns();

    staleRepositoryRead.resolve(`<?php
namespace App\\Repositories;

class CommentRepository extends BaseCommentRepository
{
}
`);

    expect(completionsPromise).not.toBeNull();
    await expect(completionsPromise).resolves.toEqual([]);
    await flushAsyncTurns(24);

    expect(getWorkbench().workspaceRoot).toBe("/workspace-b");
    expect(workspaceBBaseRepositoryReadCount).toBe(0);
  });
  it("keeps late-static fluent return types bound to the receiver class", async () => {
    const controllerPath = "/workspace/app/Http/Controllers/CommentController.php";
    const baseCommentPath = "/workspace/app/Models/BaseComment.php";
    const specialCommentPath = "/workspace/app/Models/SpecialComment.php";
    const controllerSource = `<?php
namespace App\\Http\\Controllers;

use App\\Models\\SpecialComment;

class CommentController
{
    public function show(SpecialComment $comment): void
    {
        $comment->fluent()->spec
    }
}
`;
    const { getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace",
      },
      readTextFile: vi.fn(async (path: string) => {
        if (path === controllerPath) {
          return controllerSource;
        }

        if (path === baseCommentPath) {
          return `<?php
namespace App\\Models;

class BaseComment
{
    /** @return static */
    public function fluent() {}
}
`;
        }

        if (path === specialCommentPath) {
          return `<?php
namespace App\\Models;

class SpecialComment extends BaseComment
{
    public function specialOnly(): string {}
}
`;
        }

        return `<?php\n// ${path}\n`;
      }),
      workspaceDescriptor: phpWorkspaceDescriptor(),
    });
    await flushAsyncTurns();
    await act(async () => {
      await getWorkbench().setSmartMode("fullSmart");
    });

    await act(async () => {
      await getWorkbench().openFile(fileEntry(controllerPath, "CommentController.php"));
    });

    await expect(
      getWorkbench().providePhpMethodCompletions(
        controllerSource,
        positionAfter(controllerSource, "$comment->fluent()->spec"),
      ),
    ).resolves.toEqual([
      {
        declaringClassName: "App\\Models\\SpecialComment",
        name: "specialOnly",
        parameters: "",
        returnType: "string",
      },
    ]);
  });
  it("uses Laravel container receivers for method completions and signatures", async () => {
    const controllerPath = "/workspace/app/Http/Controllers/CommentController.php";
    const servicePath = "/workspace/app/Services/CommentService.php";
    const controllerSource = `<?php
namespace App\\Http\\Controllers;

use App\\Services\\CommentService;

class CommentController
{
    public function store(): void
    {
        app(CommentService::class)->cre
        App::make(CommentService::class)->cre
        Container::getInstance()->make(CommentService::class)->cre
    }
}
`;
    const { getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace",
      },
      readTextFile: vi.fn(async (path: string) => {
        if (path === controllerPath) {
          return controllerSource;
        }

        if (path === servicePath) {
          return `<?php
namespace App\\Services;

class CommentService
{
    public function createWithAttachments(array $attachments = []): string {}
}
`;
        }

        return `<?php\n// ${path}\n`;
      }),
      workspaceDescriptor: phpWorkspaceDescriptor(),
    });
    await flushAsyncTurns();
    await act(async () => {
      await getWorkbench().setSmartMode("fullSmart");
    });

    await act(async () => {
      await getWorkbench().openFile(fileEntry(controllerPath, "CommentController.php"));
    });

    const expectedCompletion = [
      {
        declaringClassName: "App\\Services\\CommentService",
        name: "createWithAttachments",
        parameters: "array $attachments = []",
        returnType: "string",
      },
    ];

    await expect(
      getWorkbench().providePhpMethodCompletions(
        controllerSource,
        positionAfter(controllerSource, "app(CommentService::class)->cre"),
      ),
    ).resolves.toEqual(expectedCompletion);
    await expect(
      getWorkbench().providePhpMethodCompletions(
        controllerSource,
        positionAfter(controllerSource, "App::make(CommentService::class)->cre"),
      ),
    ).resolves.toEqual(expectedCompletion);
    await expect(
      getWorkbench().providePhpMethodCompletions(
        controllerSource,
        positionAfter(
          controllerSource,
          "Container::getInstance()->make(CommentService::class)->cre",
        ),
      ),
    ).resolves.toEqual(expectedCompletion);

    const signatureSource = controllerSource.replace(
      "app(CommentService::class)->cre",
      "app(CommentService::class)->createWithAttachments(",
    );

    await expect(
      getWorkbench().providePhpMethodSignature(
        signatureSource,
        positionAfter(signatureSource, "app(CommentService::class)->createWithAttachments("),
      ),
    ).resolves.toEqual({
      argumentIndex: 0,
      method: expectedCompletion[0],
      parameters: [
        {
          defaultValue: "[]",
          name: "$attachments",
          optional: true,
          raw: "array $attachments = []",
          type: "array",
        },
      ],
    });
  });
  it("uses generic class-string helpers for method completions", async () => {
    const controllerPath = "/workspace/app/Http/Controllers/CommentController.php";
    const locatorPath = "/workspace/app/Support/ServiceLocator.php";
    const servicePath = "/workspace/app/Services/CommentService.php";
    const controllerSource = `<?php
namespace App\\Http\\Controllers;

use App\\Services\\CommentService;
use App\\Support\\ServiceLocator;

/**
 * @phpstan-template T of object
 * @psalm-param class-string<T> $className
 * @phpstan-return T
 */
function service(string $className): object {}

class CommentController
{
    public function __construct(
        private readonly ServiceLocator $locator,
    ) {}

    public function store(): void
    {
        $service = $this->locator->get(CommentService::class);
        $service->cre
        $this->locator->get(CommentService::class)->cre
        ServiceLocator::get(CommentService::class)->cre
        service(CommentService::class)->cre
    }
}
`;
    const { getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace",
      },
      readTextFile: vi.fn(async (path: string) => {
        if (path === controllerPath) {
          return controllerSource;
        }

        if (path === locatorPath) {
          return `<?php
namespace App\\Support;

class ServiceLocator
{
    /**
     * @psalm-template T of object
     * @phpstan-param class-string<T> $className
     * @psalm-return T
     */
    public static function get(string $className): object {}
}
`;
        }

        if (path === servicePath) {
          return `<?php
namespace App\\Services;

class CommentService
{
    public function createWithAttachments(): string {}
}
`;
        }

        return `<?php\n// ${path}\n`;
      }),
      workspaceDescriptor: phpWorkspaceDescriptor(),
    });
    await flushAsyncTurns();
    await act(async () => {
      await getWorkbench().setSmartMode("fullSmart");
    });

    await act(async () => {
      await getWorkbench().openFile(fileEntry(controllerPath, "CommentController.php"));
    });

    const expectedCompletion = [
      {
        declaringClassName: "App\\Services\\CommentService",
        name: "createWithAttachments",
        parameters: "",
        returnType: "string",
      },
    ];

    for (const needle of [
      "$service->cre",
      "$this->locator->get(CommentService::class)->cre",
      "ServiceLocator::get(CommentService::class)->cre",
      "service(CommentService::class)->cre",
    ]) {
      await expect(
        getWorkbench().providePhpMethodCompletions(
          controllerSource,
          positionAfter(controllerSource, needle),
        ),
      ).resolves.toEqual(expectedCompletion);
    }
  });
  it("opens Laravel container receiver method definitions", async () => {
    const controllerPath = "/workspace/app/Http/Controllers/CommentController.php";
    const servicePath = "/workspace/app/Services/CommentService.php";
    const controllerSource = `<?php
namespace App\\Http\\Controllers;

use App\\Services\\CommentService;

class CommentController
{
    public function store(): void
    {
        app(CommentService::class)->createWithAttachments();
    }
}
`;
    const { getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace",
      },
      readTextFile: vi.fn(async (path: string) => {
        if (path === controllerPath) {
          return controllerSource;
        }

        if (path === servicePath) {
          return `<?php
namespace App\\Services;

class CommentService
{
    public function createWithAttachments(array $attachments = []): string {}
}
`;
        }

        return `<?php\n// ${path}\n`;
      }),
      workspaceDescriptor: phpWorkspaceDescriptor(),
    });
    await flushAsyncTurns();
    await act(async () => {
      await getWorkbench().setSmartMode("fullSmart");
    });

    await act(async () => {
      await getWorkbench().openFile(fileEntry(controllerPath, "CommentController.php"));
    });
    act(() => {
      getWorkbench().updateActiveEditorPosition(
        positionAfter(controllerSource, "app(CommentService::class)->createWithAttachments"),
      );
    });

    await act(async () => {
      await getWorkbench()
        .commands.find((candidate) => candidate.id === "editor.goToDefinition")
        ?.run();
    });

    expect(getWorkbench().activePath).toBe(servicePath);
    expect(getWorkbench().editorRevealTarget).toEqual({
      path: servicePath,
      position: {
        column: 21,
        lineNumber: 6,
      },
    });
  });
  it("infers assigned variable completions from indexed interface method return types", async () => {
    const controllerPath = "/workspace/app/Http/Controllers/CommentController.php";
    const repositoryInterfacePath =
      "/workspace/app/Kontentino/src/Communication/Interfaces/CommentRepositoryInterface.php";
    const commentPath = "/workspace/app/Kontentino/src/Communication/Models/Comment.php";
    const controllerSource = `<?php
namespace App\\Http\\Controllers\\communication;

use Kontentino\\Communication\\Interfaces\\CommentRepositoryInterface;

class CommentController
{
    public function __construct(
        protected readonly CommentRepositoryInterface $commentRepository,
    ) {}

    public function getOne(): void
    {
        $comment = $this->commentRepository->findOrFail(1);
        $comment->get
    }
}
`;
    const { getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace",
      },
      projectSymbols: [
        {
          column: 11,
          containerName: null,
          fullyQualifiedName: "Kontentino\\Communication\\Interfaces\\CommentRepositoryInterface",
          kind: "interface",
          lineNumber: 7,
          name: "CommentRepositoryInterface",
          path: repositoryInterfacePath,
          relativePath:
            "app/Kontentino/src/Communication/Interfaces/CommentRepositoryInterface.php",
        },
        {
          column: 7,
          containerName: null,
          fullyQualifiedName: "Kontentino\\Communication\\Models\\Comment",
          kind: "class",
          lineNumber: 7,
          name: "Comment",
          path: commentPath,
          relativePath: "app/Kontentino/src/Communication/Models/Comment.php",
        },
      ],
      readTextFile: vi.fn(async (path: string) => {
        if (path === controllerPath) {
          return controllerSource;
        }

        if (path === repositoryInterfacePath) {
          return `<?php
namespace Kontentino\\Communication\\Interfaces;

use Kontentino\\Communication\\Models\\Comment;

interface CommentRepositoryInterface
{
    public function findOrFail(int $id): Comment;
}
`;
        }

        if (path === commentPath) {
          return `<?php
namespace Kontentino\\Communication\\Models;

class Comment
{
    public function getContent(): string {}
}
`;
        }

        return `<?php\n// ${path}\n`;
      }),
      workspaceDescriptor: phpWorkspaceDescriptor(),
    });
    await flushAsyncTurns();
    await act(async () => {
      await getWorkbench().setSmartMode("fullSmart");
    });

    await act(async () => {
      await getWorkbench().openFile(fileEntry(controllerPath, "CommentController.php"));
    });

    await expect(
      getWorkbench().providePhpMethodCompletions(
        controllerSource,
        positionAfter(controllerSource, "$comment->get"),
      ),
    ).resolves.toEqual([
      {
        declaringClassName: "Kontentino\\Communication\\Models\\Comment",
        name: "getContent",
        parameters: "",
        returnType: "string",
      },
    ]);
  });
  it("resolves generic repository interface method returns through PHPDoc extends", async () => {
    const controllerPath = "/workspace/app/Http/Controllers/CommentController.php";
    const repositoryInterfacePath = "/workspace/app/Contracts/CommentRepositoryInterface.php";
    const baseRepositoryInterfacePath = "/workspace/app/Contracts/RepositoryInterface.php";
    const commentPath = "/workspace/app/Models/Comment.php";
    const controllerSource = `<?php
namespace App\\Http\\Controllers;

use App\\Contracts\\CommentRepositoryInterface;

class CommentController
{
    public function __construct(
        protected readonly CommentRepositoryInterface $commentRepository,
    ) {}

    public function getOne(): void
    {
        $comment = $this->commentRepository->findOrFail(1);
        $comment->get
    }
}
`;
    const { getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace",
      },
      projectSymbols: [
        {
          column: 11,
          containerName: null,
          fullyQualifiedName: "App\\Contracts\\CommentRepositoryInterface",
          kind: "interface",
          lineNumber: 10,
          name: "CommentRepositoryInterface",
          path: repositoryInterfacePath,
          relativePath: "app/Contracts/CommentRepositoryInterface.php",
        },
        {
          column: 11,
          containerName: null,
          fullyQualifiedName: "App\\Contracts\\RepositoryInterface",
          kind: "interface",
          lineNumber: 8,
          name: "RepositoryInterface",
          path: baseRepositoryInterfacePath,
          relativePath: "app/Contracts/RepositoryInterface.php",
        },
        {
          column: 7,
          containerName: null,
          fullyQualifiedName: "App\\Models\\Comment",
          kind: "class",
          lineNumber: 5,
          name: "Comment",
          path: commentPath,
          relativePath: "app/Models/Comment.php",
        },
      ],
      readTextFile: vi.fn(async (path: string) => {
        if (path === controllerPath) {
          return controllerSource;
        }

        if (path === repositoryInterfacePath) {
          return `<?php
namespace App\\Contracts;

use App\\Models\\Comment;

/**
 * @phpstan-extends RepositoryInterface<Comment>
 */
interface CommentRepositoryInterface extends RepositoryInterface
{
}
`;
        }

        if (path === baseRepositoryInterfacePath) {
          return `<?php
namespace App\\Contracts;

/**
 * @template TModel of object
 */
interface RepositoryInterface
{
    /** @return TModel */
    public function findOrFail(int $id);
}
`;
        }

        if (path === commentPath) {
          return `<?php
namespace App\\Models;

class Comment
{
    public function getContent(): string {}
}
`;
        }

        return `<?php\n// ${path}\n`;
      }),
      workspaceDescriptor: phpWorkspaceDescriptor(),
    });
    await flushAsyncTurns();
    await act(async () => {
      await getWorkbench().setSmartMode("fullSmart");
    });

    await expect(
      getWorkbench().providePhpMethodCompletions(
        controllerSource,
        positionAfter(controllerSource, "$comment->get"),
      ),
    ).resolves.toEqual([
      {
        declaringClassName: "App\\Models\\Comment",
        name: "getContent",
        parameters: "",
        returnType: "string",
      },
    ]);
  });
  it("resolves generic repository magic properties through PHPDoc extends", async () => {
    const controllerPath = "/workspace/app/Http/Controllers/CommentController.php";
    const repositoryInterfacePath = "/workspace/app/Contracts/CommentRepositoryInterface.php";
    const baseRepositoryInterfacePath = "/workspace/app/Contracts/RepositoryInterface.php";
    const commentPath = "/workspace/app/Models/Comment.php";
    const controllerSource = `<?php
namespace App\\Http\\Controllers;

use App\\Contracts\\CommentRepositoryInterface;

class CommentController
{
    public function __construct(
        protected readonly CommentRepositoryInterface $commentRepository,
    ) {}

    public function getOne(): void
    {
        $this->commentRepository->model->getContent();
    }
}
`;
    const commentSource = `<?php
namespace App\\Models;

class Comment
{
    public function getContent(): string {}
}
`;
    const { getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace",
      },
      projectSymbols: [
        {
          column: 11,
          containerName: null,
          fullyQualifiedName: "App\\Contracts\\CommentRepositoryInterface",
          kind: "interface",
          lineNumber: 10,
          name: "CommentRepositoryInterface",
          path: repositoryInterfacePath,
          relativePath: "app/Contracts/CommentRepositoryInterface.php",
        },
        {
          column: 11,
          containerName: null,
          fullyQualifiedName: "App\\Contracts\\RepositoryInterface",
          kind: "interface",
          lineNumber: 8,
          name: "RepositoryInterface",
          path: baseRepositoryInterfacePath,
          relativePath: "app/Contracts/RepositoryInterface.php",
        },
        {
          column: 7,
          containerName: null,
          fullyQualifiedName: "App\\Models\\Comment",
          kind: "class",
          lineNumber: 4,
          name: "Comment",
          path: commentPath,
          relativePath: "app/Models/Comment.php",
        },
      ],
      readTextFile: vi.fn(async (path: string) => {
        if (path === controllerPath) {
          return controllerSource;
        }

        if (path === repositoryInterfacePath) {
          return `<?php
namespace App\\Contracts;

use App\\Models\\Comment;

/**
 * @phpstan-extends RepositoryInterface<Comment>
 */
interface CommentRepositoryInterface extends RepositoryInterface
{
}
`;
        }

        if (path === baseRepositoryInterfacePath) {
          return `<?php
namespace App\\Contracts;

/**
 * @template TModel of object
 * @property-read TModel $model
 */
interface RepositoryInterface
{
}
`;
        }

        if (path === commentPath) {
          return commentSource;
        }

        return `<?php\n// ${path}\n`;
      }),
      workspaceDescriptor: phpWorkspaceDescriptor(),
    });
    await flushAsyncTurns();
    await act(async () => {
      await getWorkbench().setSmartMode("fullSmart");
    });

    await expect(
      getWorkbench().providePhpMethodCompletions(
        controllerSource,
        positionAfter(controllerSource, "->model->get"),
      ),
    ).resolves.toEqual([
      {
        declaringClassName: "App\\Models\\Comment",
        name: "getContent",
        parameters: "",
        returnType: "string",
      },
    ]);

    await act(async () => {
      await getWorkbench().openFile(fileEntry(controllerPath, "CommentController.php"));
    });
    act(() => {
      getWorkbench().updateActiveEditorPosition(
        positionAfter(controllerSource, "->model->getContent"),
      );
    });

    await act(async () => {
      await getWorkbench()
        .commands.find((candidate) => candidate.id === "editor.goToDefinition")
        ?.run();
    });

    const methodNameEnd = positionAfter(commentSource, "function getContent");
    expect(getWorkbench().activePath).toBe(commentPath);
    expect(getWorkbench().editorRevealTarget).toEqual({
      path: commentPath,
      position: {
        column: methodNameEnd.column - "getContent".length,
        lineNumber: methodNameEnd.lineNumber,
      },
    });
  });
  it("resolves generic repository magic properties through PHPDoc mixins", async () => {
    const controllerPath = "/workspace/app/Http/Controllers/CommentController.php";
    const repositoryInterfacePath = "/workspace/app/Contracts/CommentRepositoryInterface.php";
    const baseRepositoryInterfacePath = "/workspace/app/Contracts/RepositoryInterface.php";
    const commentPath = "/workspace/app/Models/Comment.php";
    const controllerSource = `<?php
namespace App\\Http\\Controllers;

use App\\Contracts\\CommentRepositoryInterface;

class CommentController
{
    public function __construct(
        protected readonly CommentRepositoryInterface $commentRepository,
    ) {}

    public function getOne(): void
    {
        $this->commentRepository->model->get
    }
}
`;
    const { getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace",
      },
      projectSymbols: [
        {
          column: 11,
          containerName: null,
          fullyQualifiedName: "App\\Contracts\\CommentRepositoryInterface",
          kind: "interface",
          lineNumber: 9,
          name: "CommentRepositoryInterface",
          path: repositoryInterfacePath,
          relativePath: "app/Contracts/CommentRepositoryInterface.php",
        },
        {
          column: 11,
          containerName: null,
          fullyQualifiedName: "App\\Contracts\\RepositoryInterface",
          kind: "interface",
          lineNumber: 8,
          name: "RepositoryInterface",
          path: baseRepositoryInterfacePath,
          relativePath: "app/Contracts/RepositoryInterface.php",
        },
        {
          column: 7,
          containerName: null,
          fullyQualifiedName: "App\\Models\\Comment",
          kind: "class",
          lineNumber: 4,
          name: "Comment",
          path: commentPath,
          relativePath: "app/Models/Comment.php",
        },
      ],
      readTextFile: vi.fn(async (path: string) => {
        if (path === controllerPath) {
          return controllerSource;
        }

        if (path === repositoryInterfacePath) {
          return `<?php
namespace App\\Contracts;

use App\\Models\\Comment;

/**
 * @mixin RepositoryInterface<Comment>
 */
interface CommentRepositoryInterface
{
}
`;
        }

        if (path === baseRepositoryInterfacePath) {
          return `<?php
namespace App\\Contracts;

/**
 * @template TModel of object
 * @property-read TModel $model
 */
interface RepositoryInterface
{
}
`;
        }

        if (path === commentPath) {
          return `<?php
namespace App\\Models;

class Comment
{
    public function getContent(): string {}
}
`;
        }

        return `<?php\n// ${path}\n`;
      }),
      workspaceDescriptor: phpWorkspaceDescriptor(),
    });
    await flushAsyncTurns();
    await act(async () => {
      await getWorkbench().setSmartMode("fullSmart");
    });

    await expect(
      getWorkbench().providePhpMethodCompletions(
        controllerSource,
        positionAfter(controllerSource, "->model->get"),
      ),
    ).resolves.toEqual([
      {
        declaringClassName: "App\\Models\\Comment",
        name: "getContent",
        parameters: "",
        returnType: "string",
      },
    ]);
  });
  it("resolves implemented interface PHPDoc method returns on chains", async () => {
    const controllerPath = "/workspace/app/Http/Controllers/CommentController.php";
    const commentPath = "/workspace/app/Models/Comment.php";
    const interfacePath = "/workspace/app/Contracts/PublishesComments.php";
    const publisherPath = "/workspace/app/Services/CommentPublisher.php";
    const controllerSource = `<?php
namespace App\\Http\\Controllers;

use App\\Models\\Comment;

class CommentController
{
    public function show(Comment $comment): void
    {
        $comment->publisher()->pub
    }
}
`;
    const { getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace",
      },
      projectSymbols: [
        {
          column: 7,
          containerName: null,
          fullyQualifiedName: "App\\Models\\Comment",
          kind: "class",
          lineNumber: 7,
          name: "Comment",
          path: commentPath,
          relativePath: "app/Models/Comment.php",
        },
        {
          column: 11,
          containerName: null,
          fullyQualifiedName: "App\\Contracts\\PublishesComments",
          kind: "interface",
          lineNumber: 10,
          name: "PublishesComments",
          path: interfacePath,
          relativePath: "app/Contracts/PublishesComments.php",
        },
        {
          column: 7,
          containerName: null,
          fullyQualifiedName: "App\\Services\\CommentPublisher",
          kind: "class",
          lineNumber: 5,
          name: "CommentPublisher",
          path: publisherPath,
          relativePath: "app/Services/CommentPublisher.php",
        },
      ],
      readTextFile: vi.fn(async (path: string) => {
        if (path === controllerPath) {
          return controllerSource;
        }

        if (path === commentPath) {
          return `<?php
namespace App\\Models;

use App\\Contracts\\PublishesComments;

class Comment implements PublishesComments
{
}
`;
        }

        if (path === interfacePath) {
          return `<?php
namespace App\\Contracts;

use App\\Services\\CommentPublisher;

/**
 * @method CommentPublisher publisher()
 */
interface PublishesComments
{
}
`;
        }

        if (path === publisherPath) {
          return `<?php
namespace App\\Services;

class CommentPublisher
{
    public function publishNow(): void {}
}
`;
        }

        return `<?php\n// ${path}\n`;
      }),
      workspaceDescriptor: phpWorkspaceDescriptor(),
    });
    await flushAsyncTurns();
    await act(async () => {
      await getWorkbench().setSmartMode("fullSmart");
    });

    await expect(
      getWorkbench().providePhpMethodCompletions(
        controllerSource,
        positionAfter(controllerSource, "$comment->publisher()->pub"),
      ),
    ).resolves.toEqual([
      {
        declaringClassName: "App\\Services\\CommentPublisher",
        name: "publishNow",
        parameters: "",
        returnType: "void",
      },
    ]);
  });
  it("resolves implemented interface PHPDoc property types on chains", async () => {
    const controllerPath = "/workspace/app/Http/Controllers/CommentController.php";
    const commentPath = "/workspace/app/Models/Comment.php";
    const interfacePath = "/workspace/app/Contracts/PublishesComments.php";
    const publisherPath = "/workspace/app/Services/CommentPublisher.php";
    const controllerSource = `<?php
namespace App\\Http\\Controllers;

use App\\Models\\Comment;

class CommentController
{
    public function show(Comment $comment): void
    {
        $comment->publisher->pub
    }
}
`;
    const { getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace",
      },
      projectSymbols: [
        {
          column: 7,
          containerName: null,
          fullyQualifiedName: "App\\Models\\Comment",
          kind: "class",
          lineNumber: 7,
          name: "Comment",
          path: commentPath,
          relativePath: "app/Models/Comment.php",
        },
        {
          column: 11,
          containerName: null,
          fullyQualifiedName: "App\\Contracts\\PublishesComments",
          kind: "interface",
          lineNumber: 10,
          name: "PublishesComments",
          path: interfacePath,
          relativePath: "app/Contracts/PublishesComments.php",
        },
        {
          column: 7,
          containerName: null,
          fullyQualifiedName: "App\\Services\\CommentPublisher",
          kind: "class",
          lineNumber: 5,
          name: "CommentPublisher",
          path: publisherPath,
          relativePath: "app/Services/CommentPublisher.php",
        },
      ],
      readTextFile: vi.fn(async (path: string) => {
        if (path === controllerPath) {
          return controllerSource;
        }

        if (path === commentPath) {
          return `<?php
namespace App\\Models;

use App\\Contracts\\PublishesComments;

class Comment implements PublishesComments
{
}
`;
        }

        if (path === interfacePath) {
          return `<?php
namespace App\\Contracts;

use App\\Services\\CommentPublisher;

/**
 * @property-read CommentPublisher $publisher
 */
interface PublishesComments
{
}
`;
        }

        if (path === publisherPath) {
          return `<?php
namespace App\\Services;

class CommentPublisher
{
    public function publishNow(): void {}
}
`;
        }

        return `<?php\n// ${path}\n`;
      }),
      workspaceDescriptor: phpWorkspaceDescriptor(),
    });
    await flushAsyncTurns();
    await act(async () => {
      await getWorkbench().setSmartMode("fullSmart");
    });

    await expect(
      getWorkbench().providePhpMethodCompletions(
        controllerSource,
        positionAfter(controllerSource, "$comment->publisher->pub"),
      ),
    ).resolves.toEqual([
      {
        declaringClassName: "App\\Services\\CommentPublisher",
        name: "publishNow",
        parameters: "",
        returnType: "void",
      },
    ]);
  });
  it("resolves generic trait method returns through PHPDoc use", async () => {
    const controllerPath = "/workspace/app/Http/Controllers/CommentController.php";
    const repositoryPath = "/workspace/app/Repositories/CommentRepository.php";
    const traitPath = "/workspace/app/Support/FindsModels.php";
    const commentPath = "/workspace/app/Models/Comment.php";
    const controllerSource = `<?php
namespace App\\Http\\Controllers;

use App\\Repositories\\CommentRepository;

class CommentController
{
    public function __construct(
        protected readonly CommentRepository $commentRepository,
    ) {}

    public function getOne(): void
    {
        $comment = $this->commentRepository->findOrFail(1);
        $comment->get
    }
}
`;
    const { getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace",
      },
      projectSymbols: [
        {
          column: 7,
          containerName: null,
          fullyQualifiedName: "App\\Repositories\\CommentRepository",
          kind: "class",
          lineNumber: 9,
          name: "CommentRepository",
          path: repositoryPath,
          relativePath: "app/Repositories/CommentRepository.php",
        },
        {
          column: 7,
          containerName: null,
          fullyQualifiedName: "App\\Support\\FindsModels",
          kind: "trait",
          lineNumber: 7,
          name: "FindsModels",
          path: traitPath,
          relativePath: "app/Support/FindsModels.php",
        },
        {
          column: 7,
          containerName: null,
          fullyQualifiedName: "App\\Models\\Comment",
          kind: "class",
          lineNumber: 5,
          name: "Comment",
          path: commentPath,
          relativePath: "app/Models/Comment.php",
        },
      ],
      readTextFile: vi.fn(async (path: string) => {
        if (path === controllerPath) {
          return controllerSource;
        }

        if (path === repositoryPath) {
          return `<?php
namespace App\\Repositories;

use App\\Models\\Comment;
use App\\Support\\FindsModels;

/**
 * @use FindsModels<Comment>
 */
class CommentRepository
{
    use FindsModels;
}
`;
        }

        if (path === traitPath) {
          return `<?php
namespace App\\Support;

/**
 * @template TModel of object
 */
trait FindsModels
{
    /** @return TModel */
    public function findOrFail(int $id) {}
}
`;
        }

        if (path === commentPath) {
          return `<?php
namespace App\\Models;

class Comment
{
    public function getContent(): string {}
}
`;
        }

        return `<?php\n// ${path}\n`;
      }),
      workspaceDescriptor: phpWorkspaceDescriptor(),
    });
    await flushAsyncTurns();
    await act(async () => {
      await getWorkbench().setSmartMode("fullSmart");
    });

    await expect(
      getWorkbench().providePhpMethodCompletions(
        controllerSource,
        positionAfter(controllerSource, "$this->commentRepository->find"),
      ),
    ).resolves.toEqual([
      {
        declaringClassName: "App\\Support\\FindsModels",
        name: "findOrFail",
        parameters: "int $id",
        returnType: "App\\Models\\Comment",
      },
    ]);
    await expect(
      getWorkbench().providePhpMethodCompletions(
        controllerSource,
        positionAfter(controllerSource, "$comment->get"),
      ),
    ).resolves.toEqual([
      {
        declaringClassName: "App\\Models\\Comment",
        name: "getContent",
        parameters: "",
        returnType: "string",
      },
    ]);
  });
  it("completes trait $this host method from one same-source trait host", async () => {
    const source = `<?php
namespace App\\Models;

trait HasHostHooks
{
    public function bootHooks(): void
    {
        $this->host
    }
}

class User
{
    use HasHostHooks;

    public function hostHook(): void {}
}
`;
    const { getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace",
      },
      workspaceDescriptor: phpWorkspaceDescriptor(),
    });
    await flushAsyncTurns();

    await expect(
      getWorkbench().providePhpMethodCompletions(source, positionAfter(source, "$this->host")),
    ).resolves.toEqual([
      {
        declaringClassName: "App\\Models\\User",
        name: "hostHook",
        parameters: "",
        returnType: "void",
      },
    ]);
  });
  async function expectSameSourceTraitOverrideCompletion(
    crossFileReturnType: string | null,
    expectedReturnType: string | null,
  ): Promise<void> {
    const crossFileHostPath = "/workspace/app/Models/Admin.php";
    const source = `<?php
namespace App\\Models;

trait HasHostHooks
{
    public function resolveHook(): TraitResult
    {
        $this->resolve
    }
}

class User
{
    use HasHostHooks;

    public function resolveHook(): LocalResult {}
}
`;
    const crossFileHostSource = crossFileReturnType
      ? `<?php
namespace App\\Models;
class Admin
{
    use \\App\\Models\\HasHostHooks;
    public function resolveHook(): ${crossFileReturnType} {}
}
`
      : null;
    const { getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace",
      },
      projectSymbols: crossFileHostSource
        ? [
            {
              column: 7,
              containerName: null,
              fullyQualifiedName: "App\\Models\\Admin",
              kind: "class",
              lineNumber: 3,
              name: "Admin",
              path: crossFileHostPath,
              relativePath: "app/Models/Admin.php",
            },
          ]
        : [],
      readTextFile: vi.fn(async (path: string) =>
        path === crossFileHostPath && crossFileHostSource
          ? crossFileHostSource
          : `<?php\n// ${path}\n`,
      ),
      searchText: vi.fn(async (_root, query) =>
        query === "HasHostHooks" && crossFileHostSource
          ? [
              {
                column: 5,
                lineNumber: 5,
                lineText: "    use \\App\\Models\\HasHostHooks;",
                path: crossFileHostPath,
                relativePath: "app/Models/Admin.php",
              },
            ]
          : [],
      ),
      workspaceDescriptor: phpWorkspaceDescriptor(),
    });
    await flushAsyncTurns();
    await act(async () => {
      await getWorkbench().setSmartMode("fullSmart");
    });

    await expect(
      getWorkbench().providePhpMethodCompletions(source, positionAfter(source, "$this->resolve")),
    ).resolves.toEqual([
      {
        declaringClassName: "App\\Models\\User",
        name: "resolveHook",
        parameters: "",
        returnType: expectedReturnType,
      },
    ]);
  }
  it("lets a same-source host override the trait return type", async () => {
    await expectSameSourceTraitOverrideCompletion(null, "LocalResult");
  });
  it("nulls conflicting same-source and cross-file host override returns", async () => {
    await expectSameSourceTraitOverrideCompletion("CrossResult", null);
  });
  it("keeps identical same-source and cross-file host override returns typed", async () => {
    await expectSameSourceTraitOverrideCompletion("LocalResult", "LocalResult");
  });
  it("does not complete trait $this host method for trait-only source", async () => {
    const source = `<?php
namespace App\\Models;

trait HasHostHooks
{
    public function bootHooks(): void
    {
        $this->host
    }
}
`;
    const { getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace",
      },
      workspaceDescriptor: phpWorkspaceDescriptor(),
    });
    await flushAsyncTurns();

    await expect(
      getWorkbench().providePhpMethodCompletions(source, positionAfter(source, "$this->host")),
    ).resolves.toEqual([]);
  });
  it("does not complete trait $this host method when two same-source trait hosts exist", async () => {
    const source = `<?php
namespace App\\Models;

trait HasHostHooks
{
    public function bootHooks(): void
    {
        $this->host
    }
}

class User
{
    use HasHostHooks;

    public function hostHook(): void {}
}

class Admin
{
    use HasHostHooks;

    public function hostHook(): void {}
}
`;
    const { getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace",
      },
      workspaceDescriptor: phpWorkspaceDescriptor(),
    });
    await flushAsyncTurns();

    await expect(
      getWorkbench().providePhpMethodCompletions(source, positionAfter(source, "$this->host")),
    ).resolves.toEqual([]);
  });
  it("intersects cross-file trait hosts and includes inherited methods and properties", async () => {
    const traitPath = "/workspace/app/Traits/SortableTrait.php";
    const articlePath = "/workspace/app/Repositories/ArticleRepository.php";
    const postPath = "/workspace/app/Repositories/PostRepository.php";
    const articleBasePath = "/workspace/app/Base/ArticleRepositoryBase.php";
    const postBasePath = "/workspace/app/Base/PostRepositoryBase.php";
    const source = `<?php
namespace App\\Traits;

trait SortableTrait
{
    public function moveUp(): void
    {
        $this->get
        $this->upd
        $this->sorting
        $this->only
    }
}
`;
    const sources = new Map<string, string>([
      [traitPath, source],
      [
        articlePath,
        `<?php
namespace App\\Repositories;
use App\\Base\\ArticleRepositoryBase;
use App\\Traits\\SortableTrait;
class ArticleRepository extends ArticleRepositoryBase { use SortableTrait; }
`,
      ],
      [
        postPath,
        `<?php
namespace App\\Repositories;
use App\\Base\\PostRepositoryBase;
use App\\Traits\\SortableTrait;
class PostRepository extends PostRepositoryBase { use SortableTrait; }
`,
      ],
      [
        articleBasePath,
        `<?php
namespace App\\Base;
class ArticleRepositoryBase
{
    protected string $sortingColumn = 'sorting';
    protected int $sortingStep = 100;
    public function getTable(): object {}
    public function update(): bool {}
    public function onlyArticle(): void {}
}
`,
      ],
      [
        postBasePath,
        `<?php
namespace App\\Base;
class PostRepositoryBase
{
    protected string $sortingColumn = 'sorting';
    protected int $sortingStep = 100;
    public function getTable(): object {}
    public function update(): bool {}
    public function onlyPost(): void {}
}
`,
      ],
    ]);
    const symbols: ProjectSymbolSearchResult[] = [
      ["App\\Traits\\SortableTrait", "trait", traitPath],
      ["App\\Repositories\\ArticleRepository", "class", articlePath],
      ["App\\Repositories\\PostRepository", "class", postPath],
      ["App\\Base\\ArticleRepositoryBase", "class", articleBasePath],
      ["App\\Base\\PostRepositoryBase", "class", postBasePath],
    ].map(([fullyQualifiedName, kind, path]) => ({
      column: 1,
      containerName: null,
      fullyQualifiedName,
      kind: kind as "class" | "trait",
      lineNumber: 1,
      name: fullyQualifiedName.split("\\").pop() ?? fullyQualifiedName,
      path,
      relativePath: path.slice("/workspace/".length),
    }));
    const { getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace",
      },
      projectSymbols: symbols,
      readTextFile: vi.fn(async (path: string) => sources.get(path) ?? "<?php\n"),
      searchText: vi.fn(async (_root, query) =>
        query === "SortableTrait"
          ? [articlePath, postPath].map((path) => ({
              column: 5,
              lineNumber: 4,
              lineText: "use SortableTrait;",
              path,
              relativePath: path.slice("/workspace/".length),
            }))
          : [],
      ),
      workspaceDescriptor: phpWorkspaceDescriptor(),
    });
    await flushAsyncTurns();
    await act(async () => {
      await getWorkbench().setSmartMode("fullSmart");
    });

    const completionNamesAfter = async (needle: string) =>
      (await getWorkbench().providePhpMethodCompletions(source, positionAfter(source, needle))).map(
        (completion) => completion.name,
      );

    await expect(completionNamesAfter("$this->get")).resolves.toEqual(["getTable"]);
    await expect(completionNamesAfter("$this->upd")).resolves.toEqual(["update"]);
    await expect(completionNamesAfter("$this->sorting")).resolves.toEqual([
      "sortingColumn",
      "sortingStep",
    ]);
    await expect(completionNamesAfter("$this->only")).resolves.toEqual([]);
  });
  it("resolves generic mixin method returns through PHPDoc mixin", async () => {
    const controllerPath = "/workspace/app/Http/Controllers/CommentController.php";
    const repositoryPath = "/workspace/app/Repositories/CommentRepository.php";
    const mixinPath = "/workspace/app/Support/RepositoryMixin.php";
    const commentPath = "/workspace/app/Models/Comment.php";
    const controllerSource = `<?php
namespace App\\Http\\Controllers;

use App\\Repositories\\CommentRepository;

class CommentController
{
    public function __construct(
        protected readonly CommentRepository $commentRepository,
    ) {}

    public function getOne(): void
    {
        $comment = $this->commentRepository->findForDisplay(1);
        $comment->get
    }
}
`;
    const { getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace",
      },
      projectSymbols: [
        {
          column: 7,
          containerName: null,
          fullyQualifiedName: "App\\Repositories\\CommentRepository",
          kind: "class",
          lineNumber: 10,
          name: "CommentRepository",
          path: repositoryPath,
          relativePath: "app/Repositories/CommentRepository.php",
        },
        {
          column: 7,
          containerName: null,
          fullyQualifiedName: "App\\Support\\RepositoryMixin",
          kind: "class",
          lineNumber: 7,
          name: "RepositoryMixin",
          path: mixinPath,
          relativePath: "app/Support/RepositoryMixin.php",
        },
        {
          column: 7,
          containerName: null,
          fullyQualifiedName: "App\\Models\\Comment",
          kind: "class",
          lineNumber: 5,
          name: "Comment",
          path: commentPath,
          relativePath: "app/Models/Comment.php",
        },
      ],
      readTextFile: vi.fn(async (path: string) => {
        if (path === controllerPath) {
          return controllerSource;
        }

        if (path === repositoryPath) {
          return `<?php
namespace App\\Repositories;

use App\\Models\\Comment;
use App\\Support\\RepositoryMixin;

/**
 * @phpstan-mixin RepositoryMixin<Comment>
 */
class CommentRepository
{
}
`;
        }

        if (path === mixinPath) {
          return `<?php
namespace App\\Support;

/**
 * @template TModel of object
 */
class RepositoryMixin
{
    /** @return TModel */
    public function findForDisplay(int $id) {}
}
`;
        }

        if (path === commentPath) {
          return `<?php
namespace App\\Models;

class Comment
{
    public function getContent(): string {}
}
`;
        }

        return `<?php\n// ${path}\n`;
      }),
      workspaceDescriptor: phpWorkspaceDescriptor(),
    });
    await flushAsyncTurns();
    await act(async () => {
      await getWorkbench().setSmartMode("fullSmart");
    });

    await expect(
      getWorkbench().providePhpMethodCompletions(
        controllerSource,
        positionAfter(controllerSource, "$this->commentRepository->find"),
      ),
    ).resolves.toEqual([
      {
        declaringClassName: "App\\Support\\RepositoryMixin",
        name: "findForDisplay",
        parameters: "int $id",
        returnType: "App\\Models\\Comment",
      },
    ]);
    await expect(
      getWorkbench().providePhpMethodCompletions(
        controllerSource,
        positionAfter(controllerSource, "$comment->get"),
      ),
    ).resolves.toEqual([
      {
        declaringClassName: "App\\Models\\Comment",
        name: "getContent",
        parameters: "",
        returnType: "string",
      },
    ]);
  });
  it("uses Laravel container bindings to infer interface implementation return types", async () => {
    const controllerPath = "/workspace/app/Http/Controllers/CommentController.php";
    const providerPath = "/workspace/app/Providers/AppServiceProvider.php";
    const repositoryInterfacePath = "/workspace/app/Contracts/CommentRepositoryInterface.php";
    const repositoryPath = "/workspace/app/Repositories/EloquentCommentRepository.php";
    const commentPath = "/workspace/app/Models/Comment.php";
    const controllerSource = `<?php
namespace App\\Http\\Controllers;

use App\\Contracts\\CommentRepositoryInterface;
use App\\Http\\Requests\\GetOneCommentRequest;

class CommentController
{
    public function __construct(
        protected readonly CommentRepositoryInterface $commentRepository,
    ) {}

    public function getOne(GetOneCommentRequest $request): void
    {
        $comment = $this->commentRepository->findOrFail($request->getCommentId());
        $comment->force
    }
}
`;
    const { getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace",
      },
      readTextFile: vi.fn(async (path: string) => {
        if (path === controllerPath) {
          return controllerSource;
        }

        if (path === providerPath) {
          return `<?php
namespace App\\Providers;

use App\\Contracts\\CommentRepositoryInterface;
use App\\Repositories\\EloquentCommentRepository;

class AppServiceProvider
{
    public function register(): void
    {
        $this->app->bind(CommentRepositoryInterface::class, EloquentCommentRepository::class);
    }
}
`;
        }

        if (path === repositoryInterfacePath) {
          return `<?php
namespace App\\Contracts;

interface CommentRepositoryInterface
{
}
`;
        }

        if (path === repositoryPath) {
          return `<?php
namespace App\\Repositories;

use App\\Contracts\\CommentRepositoryInterface;
use App\\Models\\Comment;

class EloquentCommentRepository implements CommentRepositoryInterface
{
    public function findOrFail(int $id): Comment
    {
    }
}
`;
        }

        if (path === commentPath) {
          return `<?php
namespace App\\Models;

class Comment
{
    public function forceDelete(): bool
    {
    }
}
`;
        }

        return `<?php\n// ${path}\n`;
      }),
      searchText: vi.fn(async (_root, query) =>
        query === "CommentRepositoryInterface::class"
          ? [
              {
                column: 26,
                lineNumber: 11,
                lineText:
                  "        $this->app->bind(CommentRepositoryInterface::class, EloquentCommentRepository::class);",
                path: providerPath,
                relativePath: "app/Providers/AppServiceProvider.php",
              },
            ]
          : [],
      ),
      workspaceDescriptor: phpWorkspaceDescriptor(),
    });
    await flushAsyncTurns();
    await act(async () => {
      await getWorkbench().setSmartMode("fullSmart");
    });

    await act(async () => {
      await getWorkbench().openFile(fileEntry(controllerPath, "CommentController.php"));
    });

    await expect(
      getWorkbench().providePhpMethodCompletions(
        controllerSource,
        positionAfter(controllerSource, "$comment->force"),
      ),
    ).resolves.toEqual([
      {
        declaringClassName: "App\\Models\\Comment",
        name: "forceDelete",
        parameters: "",
        returnType: "bool",
      },
    ]);

    act(() => {
      getWorkbench().updateActiveEditorPosition(positionAfter(controllerSource, "findOrFail"));
    });

    await act(async () => {
      await getWorkbench()
        .commands.find((candidate) => candidate.id === "editor.goToDefinition")
        ?.run();
    });

    expect(getWorkbench().activePath).toBe(repositoryPath);
    expect(getWorkbench().editorRevealTarget).toEqual({
      path: repositoryPath,
      position: {
        column: 21,
        lineNumber: 9,
      },
    });
  });
  it("stops stale Laravel container binding search after switching project tabs", async () => {
    const controllerPath = "/workspace-a/app/Http/Controllers/CommentController.php";
    const providerPath = "/workspace-a/app/Providers/AppServiceProvider.php";
    const repositoryInterfacePath = "/workspace-a/app/Contracts/CommentRepositoryInterface.php";
    const repositoryPath = "/workspace-a/app/Repositories/EloquentCommentRepository.php";
    const commentPath = "/workspace-a/app/Models/Comment.php";
    const controllerSource = `<?php
namespace App\\Http\\Controllers;

use App\\Contracts\\CommentRepositoryInterface;
use App\\Http\\Requests\\GetOneCommentRequest;

class CommentController
{
    public function __construct(
        protected readonly CommentRepositoryInterface $commentRepository,
    ) {}

    public function getOne(GetOneCommentRequest $request): void
    {
        $comment = $this->commentRepository->findOrFail($request->getCommentId());
        $comment->force
    }
}
`;
    const providerSource = `<?php
namespace App\\Providers;

use App\\Contracts\\CommentRepositoryInterface;
use App\\Repositories\\EloquentCommentRepository;

class AppServiceProvider
{
    public function register(): void
    {
        $this->app->bind(CommentRepositoryInterface::class, EloquentCommentRepository::class);
    }
}
`;
    const staleBindingSearch = createDeferred<TextSearchResult[]>();
    const searchText = vi.fn(async (_root, query) =>
      query === "CommentRepositoryInterface::class" ? staleBindingSearch.promise : [],
    );
    let providerReadCount = 0;
    const { getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace-a",
        workspaceTabs: ["/workspace-a", "/workspace-b"],
      },
      readTextFile: vi.fn(async (path: string) => {
        if (path === controllerPath) {
          return controllerSource;
        }

        if (path === providerPath) {
          providerReadCount += 1;
          return providerSource;
        }

        if (path === repositoryInterfacePath) {
          return `<?php
namespace App\\Contracts;

interface CommentRepositoryInterface
{
}
`;
        }

        if (path === repositoryPath) {
          return `<?php
namespace App\\Repositories;

use App\\Contracts\\CommentRepositoryInterface;
use App\\Models\\Comment;

class EloquentCommentRepository implements CommentRepositoryInterface
{
    public function findOrFail(int $id): Comment
    {
    }
}
`;
        }

        if (path === commentPath) {
          return `<?php
namespace App\\Models;

class Comment
{
    public function forceDelete(): bool
    {
    }
}
`;
        }

        return `<?php\n// ${path}\n`;
      }),
      searchText,
      workspaceDescriptor: phpWorkspaceDescriptor(),
    });
    await flushAsyncTurns();
    await act(async () => {
      await getWorkbench().setSmartMode("fullSmart");
    });
    await act(async () => {
      await getWorkbench().openFile(fileEntry(controllerPath, "CommentController.php"));
    });

    const completions = getWorkbench().providePhpMethodCompletions(
      controllerSource,
      positionAfter(controllerSource, "$comment->force"),
    );
    await waitForReact(() => {
      expect(searchText).toHaveBeenCalledWith(
        "/workspace-a",
        "CommentRepositoryInterface::class",
        200,
      );
    });

    await act(async () => {
      await getWorkbench().activateWorkspaceTab("/workspace-b");
    });
    await flushAsyncTurns();

    staleBindingSearch.resolve([
      {
        column: 26,
        lineNumber: 11,
        lineText:
          "        $this->app->bind(CommentRepositoryInterface::class, EloquentCommentRepository::class);",
        path: providerPath,
        relativePath: "app/Providers/AppServiceProvider.php",
      },
    ]);

    await expect(completions).resolves.toEqual([]);
    expect(getWorkbench().workspaceRoot).toBe("/workspace-b");
    expect(providerReadCount).toBe(0);
  });
  it("refreshes Laravel container binding completions after editing service provider files", async () => {
    const controllerPath = "/workspace/app/Http/Controllers/CommentController.php";
    const providerPath = "/workspace/app/Providers/AppServiceProvider.php";
    const repositoryInterfacePath = "/workspace/app/Contracts/CommentRepositoryInterface.php";
    const eloquentRepositoryPath = "/workspace/app/Repositories/EloquentCommentRepository.php";
    const cachedRepositoryPath = "/workspace/app/Repositories/CachedCommentRepository.php";
    const commentPath = "/workspace/app/Models/Comment.php";
    const archivedCommentPath = "/workspace/app/Models/ArchivedComment.php";
    const controllerSource = `<?php
namespace App\\Http\\Controllers;

use App\\Contracts\\CommentRepositoryInterface;
use App\\Http\\Requests\\GetOneCommentRequest;

class CommentController
{
    public function __construct(
        protected readonly CommentRepositoryInterface $commentRepository,
    ) {}

    public function getOne(GetOneCommentRequest $request): void
    {
        $comment = $this->commentRepository->findOrFail($request->getCommentId());
        $comment->for
    }
}
`;
    const updatedControllerSource = controllerSource.replace("$comment->for", "$comment->arc");
    const unrelatedControllerSource = controllerSource.replace("$comment->for", "$comment->for ");
    const eloquentProviderSource = `<?php
namespace App\\Providers;

use App\\Contracts\\CommentRepositoryInterface;
use App\\Repositories\\EloquentCommentRepository;

class AppServiceProvider
{
    public function register(): void
    {
        $this->app->bind(CommentRepositoryInterface::class, EloquentCommentRepository::class);
    }
}
`;
    const cachedProviderSource = `<?php
namespace App\\Providers;

use App\\Contracts\\CommentRepositoryInterface;
use App\\Repositories\\CachedCommentRepository;

class AppServiceProvider
{
    public function register(): void
    {
        $this->app->bind(CommentRepositoryInterface::class, CachedCommentRepository::class);
    }
}
`;
    const readTextFile = vi.fn(async (path: string) => {
      if (path === controllerPath) {
        return controllerSource;
      }

      if (path === providerPath) {
        return eloquentProviderSource;
      }

      if (path === repositoryInterfacePath) {
        return `<?php
namespace App\\Contracts;

interface CommentRepositoryInterface
{
}
`;
      }

      if (path === eloquentRepositoryPath) {
        return `<?php
namespace App\\Repositories;

use App\\Contracts\\CommentRepositoryInterface;
use App\\Models\\Comment;

class EloquentCommentRepository implements CommentRepositoryInterface
{
    public function findOrFail(int $id): Comment
    {
    }
}
`;
      }

      if (path === cachedRepositoryPath) {
        return `<?php
namespace App\\Repositories;

use App\\Contracts\\CommentRepositoryInterface;
use App\\Models\\ArchivedComment;

class CachedCommentRepository implements CommentRepositoryInterface
{
    public function findOrFail(int $id): ArchivedComment
    {
    }
}
`;
      }

      if (path === commentPath) {
        return `<?php
namespace App\\Models;

class Comment
{
    public function forceDelete(): bool
    {
    }
}
`;
      }

      if (path === archivedCommentPath) {
        return `<?php
namespace App\\Models;

class ArchivedComment
{
    public function archive(): void
    {
    }
}
`;
      }

      return `<?php\n// ${path}\n`;
    });
    const searchText = vi.fn(async (_root, query) =>
      query === "CommentRepositoryInterface::class"
        ? [
            {
              column: 26,
              lineNumber: 11,
              lineText:
                "        $this->app->bind(CommentRepositoryInterface::class, EloquentCommentRepository::class);",
              path: providerPath,
              relativePath: "app/Providers/AppServiceProvider.php",
            },
          ]
        : [],
    );
    const bindingSearchCount = () =>
      searchText.mock.calls.filter(([, query]) => query === "CommentRepositoryInterface::class")
        .length;
    const { getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace",
      },
      readTextFile,
      searchText,
      workspaceDescriptor: phpWorkspaceDescriptor(),
    });
    const provideCompletions = (source: string, marker: string) =>
      resolveInReactAct(() =>
        getWorkbench().providePhpMethodCompletions(source, positionAfter(source, marker)),
      );
    await flushAsyncTurns();
    await act(async () => {
      await getWorkbench().setSmartMode("fullSmart");
    });
    await act(async () => {
      await getWorkbench().openFile(fileEntry(controllerPath, "CommentController.php"));
    });

    await expect(provideCompletions(controllerSource, "$comment->for")).resolves.toEqual([
      {
        declaringClassName: "App\\Models\\Comment",
        name: "forceDelete",
        parameters: "",
        returnType: "bool",
      },
    ]);
    expect(bindingSearchCount()).toBe(1);

    act(() => {
      getWorkbench().updateActiveDocument(unrelatedControllerSource);
    });
    await expect(provideCompletions(unrelatedControllerSource, "$comment->for")).resolves.toEqual([
      {
        declaringClassName: "App\\Models\\Comment",
        name: "forceDelete",
        parameters: "",
        returnType: "bool",
      },
    ]);
    // The first member-completion request warms Laravel provider-source
    // registries in the background; the settled source signature gets one
    // fresh binding lookup, then the cache is reused.
    expect(bindingSearchCount()).toBe(2);

    await expect(provideCompletions(unrelatedControllerSource, "$comment->for")).resolves.toEqual([
      {
        declaringClassName: "App\\Models\\Comment",
        name: "forceDelete",
        parameters: "",
        returnType: "bool",
      },
    ]);
    expect(bindingSearchCount()).toBe(2);

    await act(async () => {
      await getWorkbench().openFile(fileEntry(providerPath, "AppServiceProvider.php"));
    });
    act(() => {
      getWorkbench().updateActiveDocument(cachedProviderSource);
    });
    await flushAsyncTurns();
    await act(async () => {
      await getWorkbench().openFile(fileEntry(controllerPath, "CommentController.php"));
    });
    act(() => {
      getWorkbench().updateActiveDocument(updatedControllerSource);
    });
    expect(
      getWorkbench().openDocuments.find((document) => document.path === providerPath)?.content,
    ).toBe(cachedProviderSource);

    await expect(provideCompletions(updatedControllerSource, "$comment->arc")).resolves.toEqual([
      {
        declaringClassName: "App\\Models\\ArchivedComment",
        name: "archive",
        parameters: "",
        returnType: "void",
      },
    ]);
    expect(bindingSearchCount()).toBe(3);
  });
  it("invalidates a cached Laravel binding miss after external PHP changes", async () => {
    let publishFileChange: ((event: WorkspaceFileChangeEvent) => void) | null = null;
    let bindingFileExists = false;
    const controllerPath = "/workspace/app/Http/Controllers/CommentController.php";
    const interfacePath = "/workspace/app/Contracts/CommentStoreContract.php";
    const repositoryPath = "/workspace/app/Storage/DatabaseCommentStore.php";
    const commentPath = "/workspace/app/Models/Comment.php";
    const bindingPath = "/workspace/src/Bindings.php";
    const unrelatedPath = "/workspace/src/Unrelated.php";
    const unreadablePath = "/workspace/src/Unreadable.php";
    const controllerSource = `<?php
namespace App\\Http\\Controllers;

use App\\Contracts\\CommentStoreContract;

class CommentController
{
    public function __construct(
        protected readonly CommentStoreContract $commentStore,
    ) {}

    public function show(): void
    {
        $comment = $this->commentStore->findOrFail(1);
        $comment->for
    }
}
`;
    const bindingSource = `<?php
namespace App\\Support;

use App\\Contracts\\CommentStoreContract;
use App\\Storage\\DatabaseCommentStore;

app()->bind(CommentStoreContract::class, DatabaseCommentStore::class);
`;
    const readTextFile = vi.fn(async (path: string) => {
      if (path === controllerPath) {
        return controllerSource;
      }

      if (path === interfacePath) {
        return `<?php
namespace App\\Contracts;

interface CommentStoreContract {}
`;
      }

      if (path === repositoryPath) {
        return `<?php
namespace App\\Storage;

use App\\Contracts\\CommentStoreContract;
use App\\Models\\Comment;

class DatabaseCommentStore implements CommentStoreContract
{
    public function findOrFail(int $id): Comment {}
}
`;
      }

      if (path === commentPath) {
        return `<?php
namespace App\\Models;

class Comment
{
    public function forceDelete(): bool {}
}
`;
      }

      if (path === bindingPath && bindingFileExists) {
        return bindingSource;
      }

      if (path === unrelatedPath) {
        return `<?php
use App\\Contracts\\CommentStoreContract;

final class Unrelated
{
    public const CONTRACT = CommentStoreContract::class;
}
`;
      }

      if (path === unreadablePath) {
        throw new Error("transient external read failure");
      }

      return `<?php\n// ${path}\n`;
    });
    const searchText = vi.fn(async (_root, query) => {
      if (query !== "CommentStoreContract::class") {
        return [];
      }

      if (!bindingFileExists) {
        return [
          {
            column: 29,
            lineNumber: 6,
            lineText: "    public const CONTRACT = CommentStoreContract::class;",
            path: unrelatedPath,
            relativePath: "src/Unrelated.php",
          },
        ];
      }

      return [
        {
          column: 13,
          lineNumber: 7,
          lineText: "app()->bind(CommentStoreContract::class, DatabaseCommentStore::class);",
          path: bindingPath,
          relativePath: "src/Bindings.php",
        },
      ];
    });
    const bindingSearchCount = () =>
      searchText.mock.calls.filter(([, query]) => query === "CommentStoreContract::class").length;
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
      searchText,
      workspaceDescriptor: phpWorkspaceDescriptor(),
      workspaceFileChangeGateway,
    });
    await flushAsyncTurns();
    await act(async () => {
      await getWorkbench().setSmartMode("fullSmart");
      await getWorkbench().openFile(fileEntry(controllerPath, "CommentController.php"));
    });

    await expect(
      getWorkbench().providePhpMethodCompletions(
        controllerSource,
        positionAfter(controllerSource, "$comment->for"),
      ),
    ).resolves.toEqual([]);
    expect(bindingSearchCount()).toBe(1);

    await act(async () => {
      publishFileChange?.({
        kind: "modified",
        path: unrelatedPath,
        relativePath: "src/Unrelated.php",
        rootPath: "/workspace",
      });
      await flushAsyncTurns();
    });
    await expect(
      getWorkbench().providePhpMethodCompletions(
        controllerSource,
        positionAfter(controllerSource, "$comment->for"),
      ),
    ).resolves.toEqual([]);
    expect(bindingSearchCount()).toBe(2);

    await act(async () => {
      publishFileChange?.({
        kind: "modified",
        path: unreadablePath,
        relativePath: "src/Unreadable.php",
        rootPath: "/workspace",
      });
      await flushAsyncTurns();
    });
    await expect(
      getWorkbench().providePhpMethodCompletions(
        controllerSource,
        positionAfter(controllerSource, "$comment->for"),
      ),
    ).resolves.toEqual([]);
    expect(bindingSearchCount()).toBe(3);

    bindingFileExists = true;
    await act(async () => {
      publishFileChange?.({
        kind: "created",
        path: bindingPath,
        relativePath: "src/Bindings.php",
        rootPath: "/workspace",
      });
      await flushAsyncTurns();
    });

    await expect(
      getWorkbench().providePhpMethodCompletions(
        controllerSource,
        positionAfter(controllerSource, "$comment->for"),
      ),
    ).resolves.toEqual([
      {
        declaringClassName: "App\\Models\\Comment",
        name: "forceDelete",
        parameters: "",
        returnType: "bool",
      },
    ]);
    expect(bindingSearchCount()).toBe(4);

    bindingFileExists = false;
    await act(async () => {
      publishFileChange?.({
        kind: "deleted",
        path: bindingPath,
        relativePath: "src/Bindings.php",
        rootPath: "/workspace",
      });
      await flushAsyncTurns();
    });
    await getWorkbench().providePhpMethodCompletions(
      controllerSource,
      positionAfter(controllerSource, "$comment->for"),
    );
    expect(bindingSearchCount()).toBe(5);
  });
  it("keeps Laravel repository completions stable during container binding warm-up", async () => {
    const controllerPath = "/workspace/app/Http/Controllers/CommentController.php";
    const providerPath = "/workspace/app/Providers/AppServiceProvider.php";
    const repositoryInterfacePath = "/workspace/app/Contracts/CommentLookupInterface.php";
    const repositoryPath = "/workspace/app/Repositories/EloquentCommentRepository.php";
    const commentPath = "/workspace/app/Models/Comment.php";
    const controllerSource = `<?php
namespace App\\Http\\Controllers;

use App\\Contracts\\CommentLookupInterface;
use App\\Http\\Requests\\GetOneCommentRequest;

class CommentController
{
    public function __construct(
        protected readonly CommentLookupInterface $commentRepository,
    ) {}

    public function getOne(GetOneCommentRequest $request): void
    {
        $comment = $this->commentRepository->findOrFail($request->getCommentId());
        $comment->force
    }
}
`;
    const { getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace",
      },
      readTextFile: vi.fn(async (path: string) => {
        if (path === controllerPath) {
          return controllerSource;
        }

        if (path === providerPath) {
          return `<?php
namespace App\\Providers;

use App\\Contracts\\CommentLookupInterface;
use App\\Repositories\\EloquentCommentRepository;

class AppServiceProvider
{
    public function register(): void
    {
        $this->app->bind(CommentLookupInterface::class, EloquentCommentRepository::class);
    }
}
`;
        }

        if (path === repositoryInterfacePath) {
          return `<?php
namespace App\\Contracts;

interface CommentLookupInterface
{
}
`;
        }

        if (path === repositoryPath) {
          return `<?php
namespace App\\Repositories;

use App\\Contracts\\CommentLookupInterface;
use App\\Models\\Comment;

class EloquentCommentRepository implements CommentLookupInterface
{
    public function findOrFail(int $id): Comment
    {
    }
}
`;
        }

        if (path === commentPath) {
          return `<?php
namespace App\\Models;

class Comment
{
    public function forceDelete(): bool
    {
    }
}
`;
        }

        return `<?php\n// ${path}\n`;
      }),
      searchText: vi.fn(async (_root, query) => {
        if (query !== "CommentLookupInterface::class") {
          return [];
        }

        return [
          {
            column: 26,
            lineNumber: 11,
            lineText:
              "        $this->app->bind(CommentLookupInterface::class, EloquentCommentRepository::class);",
            path: providerPath,
            relativePath: "app/Providers/AppServiceProvider.php",
          },
        ];
      }),
      workspaceDescriptor: phpWorkspaceDescriptor(),
    });
    await flushAsyncTurns();
    await act(async () => {
      await getWorkbench().setSmartMode("fullSmart");
    });

    await act(async () => {
      await getWorkbench().openFile(fileEntry(controllerPath, "CommentController.php"));
    });

    await expect(
      getWorkbench().providePhpMethodCompletions(
        controllerSource,
        positionAfter(controllerSource, "$comment->force"),
      ),
    ).resolves.toEqual([
      {
        declaringClassName: "App\\Models\\Comment",
        name: "forceDelete",
        parameters: "",
        returnType: "bool",
      },
    ]);

    await expect(
      getWorkbench().providePhpMethodCompletions(
        controllerSource,
        positionAfter(controllerSource, "$comment->force"),
      ),
    ).resolves.toEqual([
      {
        declaringClassName: "App\\Models\\Comment",
        name: "forceDelete",
        parameters: "",
        returnType: "bool",
      },
    ]);
  });
  it("offers model methods and properties after typed repository findOrFail assignments", async () => {
    const controllerPath = "/workspace/app/Http/Controllers/CommentController.php";
    const repositoryInterfacePath =
      "/workspace/app/Kontentino/src/Communication/Interfaces/CommentRepositoryInterface.php";
    const commentPath = "/workspace/app/Kontentino/src/Communication/Models/Comment.php";
    const controllerSource = `<?php
namespace App\\Http\\Controllers\\communication;

use App\\Http\\Requests\\GetOneCommentRequest;
use Kontentino\\Communication\\Interfaces\\CommentRepositoryInterface;

class CommentController
{
    public function __construct(
        protected readonly CommentRepositoryInterface $commentRepository,
    ) {}

    public function getOne(GetOneCommentRequest $request): void
    {
        $comment = $this->commentRepository->findOrFail($request->getCommentId());
        $comment->

        $builderComment = $comment->newQuery()->first();
        $builderComment->get
    }
}
`;
    const { getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace",
      },
      projectSymbols: [
        {
          column: 11,
          containerName: null,
          fullyQualifiedName: "Kontentino\\Communication\\Interfaces\\CommentRepositoryInterface",
          kind: "interface",
          lineNumber: 7,
          name: "CommentRepositoryInterface",
          path: repositoryInterfacePath,
          relativePath:
            "app/Kontentino/src/Communication/Interfaces/CommentRepositoryInterface.php",
        },
        {
          column: 7,
          containerName: null,
          fullyQualifiedName: "Kontentino\\Communication\\Models\\Comment",
          kind: "class",
          lineNumber: 7,
          name: "Comment",
          path: commentPath,
          relativePath: "app/Kontentino/src/Communication/Models/Comment.php",
        },
      ],
      readTextFile: vi.fn(async (path: string) => {
        if (path === controllerPath) {
          return controllerSource;
        }

        if (path === repositoryInterfacePath) {
          return `<?php
namespace Kontentino\\Communication\\Interfaces;

use Kontentino\\Communication\\Models\\Comment;

interface CommentRepositoryInterface
{
    public function findOrFail(int $id): Comment;
}
`;
        }

        if (path === commentPath) {
          return `<?php
namespace Kontentino\\Communication\\Models;

use Illuminate\\Database\\Eloquent\\Casts\\Attribute;
use Kontentino\\Communication\\Enums\\CommentType;

/**
 * @property string $body
 */
class Comment
{
    protected $appends = ['summary'];

    protected $fillable = [
        'account_id',
        'user_id',
        'model_name',
        'model_id',
        'parent_id',
        'content',
        'type',
        'thread',
    ];

    protected $attributes = [
        'is_visible' => true,
        'label' => 'draft',
    ];

    protected array $casts = [
        'is_pinned' => 'bool',
        'meta' => 'array',
        'type' => CommentType::class,
    ];

    protected function casts(): array
    {
        return [
            'priority' => 'integer',
        ];
    }

    public string $status;

    public function getContent(): string {}

    /** @return Attribute<string, never> */
    protected function displayName(): Attribute
    {
        return Attribute::make(get: fn () => '');
    }
}
`;
        }

        return `<?php\n// ${path}\n`;
      }),
      workspaceDescriptor: phpWorkspaceDescriptor(),
    });
    await flushAsyncTurns();
    await act(async () => {
      await getWorkbench().setSmartMode("fullSmart");
    });

    await act(async () => {
      await getWorkbench().openFile(fileEntry(controllerPath, "CommentController.php"));
    });

    await expect(
      getWorkbench().providePhpMethodCompletions(
        controllerSource,
        positionAfter(controllerSource, "$comment->"),
      ),
    ).resolves.toEqual([
      {
        declaringClassName: "Kontentino\\Communication\\Models\\Comment",
        kind: "property",
        name: "account_id",
        parameters: "",
        returnType: "mixed",
      },
      {
        declaringClassName: "Kontentino\\Communication\\Models\\Comment",
        kind: "property",
        name: "body",
        parameters: "",
        returnType: "string",
      },
      {
        declaringClassName: "Kontentino\\Communication\\Models\\Comment",
        kind: "property",
        name: "content",
        parameters: "",
        returnType: "mixed",
      },
      {
        declaringClassName: "Kontentino\\Communication\\Models\\Comment",
        kind: "property",
        name: "display_name",
        parameters: "",
        returnType: "string",
      },
      {
        declaringClassName: "Kontentino\\Communication\\Models\\Comment",
        name: "getContent",
        parameters: "",
        returnType: "string",
      },
      {
        declaringClassName: "Kontentino\\Communication\\Models\\Comment",
        kind: "property",
        name: "is_pinned",
        parameters: "",
        returnType: "bool",
      },
      {
        declaringClassName: "Kontentino\\Communication\\Models\\Comment",
        kind: "property",
        name: "is_visible",
        parameters: "",
        returnType: "bool",
      },
      {
        declaringClassName: "Kontentino\\Communication\\Models\\Comment",
        kind: "property",
        name: "label",
        parameters: "",
        returnType: "string",
      },
      {
        declaringClassName: "Kontentino\\Communication\\Models\\Comment",
        kind: "property",
        name: "meta",
        parameters: "",
        returnType: "array",
      },
      {
        declaringClassName: "Kontentino\\Communication\\Models\\Comment",
        kind: "property",
        name: "model_id",
        parameters: "",
        returnType: "mixed",
      },
      {
        declaringClassName: "Kontentino\\Communication\\Models\\Comment",
        kind: "property",
        name: "model_name",
        parameters: "",
        returnType: "mixed",
      },
      {
        declaringClassName: "Kontentino\\Communication\\Models\\Comment",
        kind: "property",
        name: "parent_id",
        parameters: "",
        returnType: "mixed",
      },
      {
        declaringClassName: "Kontentino\\Communication\\Models\\Comment",
        kind: "property",
        name: "priority",
        parameters: "",
        returnType: "int",
      },
      {
        declaringClassName: "Kontentino\\Communication\\Models\\Comment",
        kind: "property",
        name: "status",
        parameters: "",
        returnType: "string",
      },
      {
        declaringClassName: "Kontentino\\Communication\\Models\\Comment",
        kind: "property",
        name: "summary",
        parameters: "",
        returnType: "mixed",
      },
      {
        declaringClassName: "Kontentino\\Communication\\Models\\Comment",
        kind: "property",
        name: "thread",
        parameters: "",
        returnType: "mixed",
      },
      {
        declaringClassName: "Kontentino\\Communication\\Models\\Comment",
        kind: "property",
        name: "type",
        parameters: "",
        returnType: "Kontentino\\Communication\\Enums\\CommentType",
      },
      {
        declaringClassName: "Kontentino\\Communication\\Models\\Comment",
        kind: "property",
        name: "user_id",
        parameters: "",
        returnType: "mixed",
      },
    ]);
    await expect(
      getWorkbench().providePhpMethodCompletions(
        controllerSource,
        positionAfter(controllerSource, "$builderComment->get"),
      ),
    ).resolves.toEqual([
      {
        declaringClassName: "Kontentino\\Communication\\Models\\Comment",
        name: "getContent",
        parameters: "",
        returnType: "string",
      },
    ]);
  });
  it("infers model completions from untyped repository body terminal Eloquent finder returns", async () => {
    const controllerPath = "/workspace/app/Http/Controllers/CommentController.php";
    const repositoryPath = "/workspace/app/Repositories/CommentRepository.php";
    const commentPath = "/workspace/app/Models/Comment.php";
    const controllerSource = `<?php
namespace App\\Http\\Controllers;

use App\\Repositories\\CommentRepository;

class CommentController
{
    public function __construct(
        protected readonly CommentRepository $commentRepository,
    ) {}

    public function getOne(): void
    {
        $comment = $this->commentRepository->findOrFail(1);
        $comment->

        $staticComment = $this->commentRepository->findStaticOrFail(1);
        $staticComment->get
    }
}
`;
    const { getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace",
      },
      projectSymbols: [
        {
          column: 7,
          containerName: null,
          fullyQualifiedName: "App\\Repositories\\CommentRepository",
          kind: "class",
          lineNumber: 7,
          name: "CommentRepository",
          path: repositoryPath,
          relativePath: "app/Repositories/CommentRepository.php",
        },
        {
          column: 7,
          containerName: null,
          fullyQualifiedName: "App\\Models\\Comment",
          kind: "class",
          lineNumber: 5,
          name: "Comment",
          path: commentPath,
          relativePath: "app/Models/Comment.php",
        },
      ],
      readTextFile: vi.fn(async (path: string) => {
        if (path === controllerPath) {
          return controllerSource;
        }

        if (path === repositoryPath) {
          return `<?php
namespace App\\Repositories;

use App\\Models\\Comment;

class CommentRepository
{
    public function findOrFail(int $id)
    {
        return Comment::query()->whereKey($id)->firstOrFail();
    }

    public function findStaticOrFail(int $id)
    {
        return Comment::findOrFail($id);
    }
}
`;
        }

        if (path === commentPath) {
          return `<?php
namespace App\\Models;

/**
 * @property string $body
 */
class Comment
{
    protected $fillable = ['content'];

    public function getContent(): string {}
}
`;
        }

        return `<?php\n// ${path}\n`;
      }),
      workspaceDescriptor: phpWorkspaceDescriptor(),
    });
    await flushAsyncTurns();
    await act(async () => {
      await getWorkbench().setSmartMode("fullSmart");
    });

    await act(async () => {
      await getWorkbench().openFile(fileEntry(controllerPath, "CommentController.php"));
    });

    await expect(
      getWorkbench().providePhpMethodCompletions(
        controllerSource,
        positionAfter(controllerSource, "$comment->"),
      ),
    ).resolves.toEqual(
      expect.arrayContaining([
        {
          declaringClassName: "App\\Models\\Comment",
          kind: "property",
          name: "body",
          parameters: "",
          returnType: "string",
        },
        {
          declaringClassName: "App\\Models\\Comment",
          kind: "property",
          name: "content",
          parameters: "",
          returnType: "mixed",
        },
        {
          declaringClassName: "App\\Models\\Comment",
          name: "getContent",
          parameters: "",
          returnType: "string",
        },
      ]),
    );
    await expect(
      getWorkbench().providePhpMethodCompletions(
        controllerSource,
        positionAfter(controllerSource, "$staticComment->get"),
      ),
    ).resolves.toEqual([
      {
        declaringClassName: "App\\Models\\Comment",
        name: "getContent",
        parameters: "",
        returnType: "string",
      },
    ]);
  });
  it("offers PHPDoc mixin members on inferred model receivers", async () => {
    const controllerPath = "/workspace/app/Http/Controllers/CommentController.php";
    const repositoryInterfacePath =
      "/workspace/app/Kontentino/src/Communication/Interfaces/CommentRepositoryInterface.php";
    const commentPath = "/workspace/app/Kontentino/src/Communication/Models/Comment.php";
    const helperPath = "/workspace/app/Kontentino/src/Communication/Models/CommentIdeHelper.php";
    const controllerSource = `<?php
namespace App\\Http\\Controllers\\communication;

use Kontentino\\Communication\\Interfaces\\CommentRepositoryInterface;

class CommentController
{
    public function __construct(
        protected readonly CommentRepositoryInterface $commentRepository,
    ) {}

    public function getOne(): void
    {
        $comment = $this->commentRepository->findOrFail(1);
        $comment->hel
    }
}
`;
    const { getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace",
      },
      projectSymbols: [
        {
          column: 11,
          containerName: null,
          fullyQualifiedName: "Kontentino\\Communication\\Interfaces\\CommentRepositoryInterface",
          kind: "interface",
          lineNumber: 7,
          name: "CommentRepositoryInterface",
          path: repositoryInterfacePath,
          relativePath:
            "app/Kontentino/src/Communication/Interfaces/CommentRepositoryInterface.php",
        },
        {
          column: 7,
          containerName: null,
          fullyQualifiedName: "Kontentino\\Communication\\Models\\Comment",
          kind: "class",
          lineNumber: 7,
          name: "Comment",
          path: commentPath,
          relativePath: "app/Kontentino/src/Communication/Models/Comment.php",
        },
        {
          column: 7,
          containerName: null,
          fullyQualifiedName: "Kontentino\\Communication\\Models\\CommentIdeHelper",
          kind: "class",
          lineNumber: 3,
          name: "CommentIdeHelper",
          path: helperPath,
          relativePath: "app/Kontentino/src/Communication/Models/CommentIdeHelper.php",
        },
      ],
      readTextFile: vi.fn(async (path: string) => {
        if (path === controllerPath) {
          return controllerSource;
        }

        if (path === repositoryInterfacePath) {
          return `<?php
namespace Kontentino\\Communication\\Interfaces;

use Kontentino\\Communication\\Models\\Comment;

interface CommentRepositoryInterface
{
    public function findOrFail(int $id): Comment;
}
`;
        }

        if (path === commentPath) {
          return `<?php
namespace Kontentino\\Communication\\Models;

/**
 * @mixin CommentIdeHelper
 */
class Comment
{
}
`;
        }

        if (path === helperPath) {
          return `<?php
namespace Kontentino\\Communication\\Models;

class CommentIdeHelper
{
    public function helpful(string $mode = 'fast'): string {}
}
`;
        }

        return `<?php\n// ${path}\n`;
      }),
      workspaceDescriptor: phpWorkspaceDescriptor(),
    });
    await flushAsyncTurns();
    await act(async () => {
      await getWorkbench().setSmartMode("fullSmart");
    });

    await act(async () => {
      await getWorkbench().openFile(fileEntry(controllerPath, "CommentController.php"));
    });

    await expect(
      getWorkbench().providePhpMethodCompletions(
        controllerSource,
        positionAfter(controllerSource, "$comment->hel"),
      ),
    ).resolves.toEqual([
      {
        declaringClassName: "Kontentino\\Communication\\Models\\CommentIdeHelper",
        name: "helpful",
        parameters: "string $mode = 'fast'",
        returnType: "string",
      },
    ]);
  });
  it("offers implemented interface PHPDoc method completions on inferred receivers", async () => {
    const controllerPath = "/workspace/app/Http/Controllers/CommentController.php";
    const commentPath = "/workspace/app/Models/Comment.php";
    const interfacePath = "/workspace/app/Contracts/PublishesComments.php";
    const controllerSource = `<?php
namespace App\\Http\\Controllers;

use App\\Models\\Comment;

class CommentController
{
    public function show(Comment $comment): void
    {
        $comment->pub
    }
}
`;
    const { getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace",
      },
      projectSymbols: [
        {
          column: 7,
          containerName: null,
          fullyQualifiedName: "App\\Models\\Comment",
          kind: "class",
          lineNumber: 7,
          name: "Comment",
          path: commentPath,
          relativePath: "app/Models/Comment.php",
        },
        {
          column: 11,
          containerName: null,
          fullyQualifiedName: "App\\Contracts\\PublishesComments",
          kind: "interface",
          lineNumber: 7,
          name: "PublishesComments",
          path: interfacePath,
          relativePath: "app/Contracts/PublishesComments.php",
        },
      ],
      readTextFile: vi.fn(async (path: string) => {
        if (path === controllerPath) {
          return controllerSource;
        }

        if (path === commentPath) {
          return `<?php
namespace App\\Models;

use App\\Contracts\\PublishesComments;

class Comment implements PublishesComments
{
}
`;
        }

        if (path === interfacePath) {
          return `<?php
namespace App\\Contracts;

/**
 * @method void publish(bool $quietly = false)
 */
interface PublishesComments
{
}
`;
        }

        return `<?php\n// ${path}\n`;
      }),
      workspaceDescriptor: phpWorkspaceDescriptor(),
    });
    await flushAsyncTurns();
    await act(async () => {
      await getWorkbench().setSmartMode("fullSmart");
    });

    await act(async () => {
      await getWorkbench().openFile(fileEntry(controllerPath, "CommentController.php"));
    });

    await expect(
      getWorkbench().providePhpMethodCompletions(
        controllerSource,
        positionAfter(controllerSource, "$comment->pub"),
      ),
    ).resolves.toEqual([
      {
        declaringClassName: "App\\Contracts\\PublishesComments",
        name: "publish",
        parameters: "bool $quietly = false",
        returnType: "void",
      },
    ]);
  });
  it("offers returnless PHPDoc method completions on inferred receivers", async () => {
    const controllerPath = "/workspace/app/Http/Controllers/CommentController.php";
    const commentPath = "/workspace/app/Models/Comment.php";
    const interfacePath = "/workspace/app/Contracts/ArchivesComments.php";
    const controllerSource = `<?php
namespace App\\Http\\Controllers;

use App\\Models\\Comment;

class CommentController
{
    public function show(Comment $comment): void
    {
        $comment->arc
    }
}
`;
    const { getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace",
      },
      projectSymbols: [
        {
          column: 7,
          containerName: null,
          fullyQualifiedName: "App\\Models\\Comment",
          kind: "class",
          lineNumber: 7,
          name: "Comment",
          path: commentPath,
          relativePath: "app/Models/Comment.php",
        },
        {
          column: 11,
          containerName: null,
          fullyQualifiedName: "App\\Contracts\\ArchivesComments",
          kind: "interface",
          lineNumber: 7,
          name: "ArchivesComments",
          path: interfacePath,
          relativePath: "app/Contracts/ArchivesComments.php",
        },
      ],
      readTextFile: vi.fn(async (path: string) => {
        if (path === controllerPath) {
          return controllerSource;
        }

        if (path === commentPath) {
          return `<?php
namespace App\\Models;

use App\\Contracts\\ArchivesComments;

class Comment implements ArchivesComments
{
}
`;
        }

        if (path === interfacePath) {
          return `<?php
namespace App\\Contracts;

/**
 * @method archive(bool $quietly = false)
 */
interface ArchivesComments
{
}
`;
        }

        return `<?php\n// ${path}\n`;
      }),
      workspaceDescriptor: phpWorkspaceDescriptor(),
    });
    await flushAsyncTurns();
    await act(async () => {
      await getWorkbench().setSmartMode("fullSmart");
    });

    await act(async () => {
      await getWorkbench().openFile(fileEntry(controllerPath, "CommentController.php"));
    });

    await expect(
      getWorkbench().providePhpMethodCompletions(
        controllerSource,
        positionAfter(controllerSource, "$comment->arc"),
      ),
    ).resolves.toEqual([
      {
        declaringClassName: "App\\Contracts\\ArchivesComments",
        name: "archive",
        parameters: "bool $quietly = false",
        returnType: null,
      },
    ]);
  });
  it("suppresses PHPDoc mixin member-method diagnostics on inferred receivers", async () => {
    let diagnosticsListener: ((event: LanguageServerDiagnosticEvent) => void) | null = null;
    const controllerPath = "/workspace/app/Http/Controllers/CommentController.php";
    const repositoryInterfacePath =
      "/workspace/app/Kontentino/src/Communication/Interfaces/CommentRepositoryInterface.php";
    const commentPath = "/workspace/app/Kontentino/src/Communication/Models/Comment.php";
    const helperPath = "/workspace/app/Kontentino/src/Communication/Models/CommentIdeHelper.php";
    const controllerSource = `<?php
namespace App\\Http\\Controllers\\communication;

use Kontentino\\Communication\\Interfaces\\CommentRepositoryInterface;

class CommentController
{
    public function __construct(
        protected readonly CommentRepositoryInterface $commentRepository,
    ) {}

    public function getOne(): void
    {
        $comment = $this->commentRepository->findOrFail(1);
        $comment->helpful();
        $comment->missingHelpful();
    }
}
`;
    const runningStatus: LanguageServerRuntimeStatus = {
      capabilities: emptyLanguageServerCapabilities(),
      kind: "running",
      sessionId: 23,
    };
    const diagnosticsGateway: LanguageServerDiagnosticsGateway = {
      subscribeDiagnostics: vi.fn(async (listener) => {
        diagnosticsListener = listener;
        return () => undefined;
      }),
    };
    const methodDiagnosticPosition = (methodName: string) => {
      const position = positionAfter(controllerSource, `$comment->${methodName}`);

      return {
        character: position.column - methodName.length - 1,
        line: position.lineNumber - 1,
      };
    };
    const { getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace",
      },
      languageServerDiagnosticsGateway: diagnosticsGateway,
      projectSymbols: [
        {
          column: 11,
          containerName: null,
          fullyQualifiedName: "Kontentino\\Communication\\Interfaces\\CommentRepositoryInterface",
          kind: "interface",
          lineNumber: 7,
          name: "CommentRepositoryInterface",
          path: repositoryInterfacePath,
          relativePath:
            "app/Kontentino/src/Communication/Interfaces/CommentRepositoryInterface.php",
        },
        {
          column: 7,
          containerName: null,
          fullyQualifiedName: "Kontentino\\Communication\\Models\\Comment",
          kind: "class",
          lineNumber: 7,
          name: "Comment",
          path: commentPath,
          relativePath: "app/Kontentino/src/Communication/Models/Comment.php",
        },
        {
          column: 7,
          containerName: null,
          fullyQualifiedName: "Kontentino\\Communication\\Models\\CommentIdeHelper",
          kind: "class",
          lineNumber: 3,
          name: "CommentIdeHelper",
          path: helperPath,
          relativePath: "app/Kontentino/src/Communication/Models/CommentIdeHelper.php",
        },
      ],
      readTextFile: vi.fn(async (path: string) => {
        if (path === controllerPath) {
          return controllerSource;
        }

        if (path === repositoryInterfacePath) {
          return `<?php
namespace Kontentino\\Communication\\Interfaces;

use Kontentino\\Communication\\Models\\Comment;

interface CommentRepositoryInterface
{
    public function findOrFail(int $id): Comment;
}
`;
        }

        if (path === commentPath) {
          return `<?php
namespace Kontentino\\Communication\\Models;

/**
 * @mixin CommentIdeHelper
 */
class Comment
{
}
`;
        }

        if (path === helperPath) {
          return `<?php
namespace Kontentino\\Communication\\Models;

class CommentIdeHelper
{
    public function helpful(string $mode = 'fast'): string {}
}
`;
        }

        return `<?php\n// ${path}\n`;
      }),
      runtimeStatus: runningStatus,
      workspaceDescriptor: phpWorkspaceDescriptor(),
    });
    await flushAsyncTurns(24);
    await act(async () => {
      await getWorkbench().setSmartMode("fullSmart");
    });
    await flushAsyncTurns(24);

    expect(diagnosticsListener).not.toBeNull();

    const helpfulPosition = methodDiagnosticPosition("helpful");
    const missingPosition = methodDiagnosticPosition("missingHelpful");

    act(() => {
      diagnosticsListener?.({
        diagnostics: [
          {
            ...helpfulPosition,
            message: "Method Kontentino\\Communication\\Models\\Comment::helpful() does not exist",
            severity: "error",
            source: "phpactor",
          },
          {
            ...missingPosition,
            message:
              "Method Kontentino\\Communication\\Models\\Comment::missingHelpful() does not exist",
            severity: "error",
            source: "phpactor",
          },
        ],
        rootPath: "/workspace",
        sessionId: runningStatus.sessionId,
        uri: fileUriFromPath(controllerPath),
        version: null,
      });
    });
    await flushAsyncTurns();

    expect(getWorkbench().languageServerDiagnosticsByPath[controllerPath]).toEqual([
      {
        ...missingPosition,
        message:
          "Method Kontentino\\Communication\\Models\\Comment::missingHelpful() does not exist",
        severity: "error",
        source: "phpactor",
      },
    ]);
  });
  it("suppresses implemented interface member-method diagnostics on inferred receivers", async () => {
    let diagnosticsListener: ((event: LanguageServerDiagnosticEvent) => void) | null = null;
    const controllerPath = "/workspace/app/Http/Controllers/CommentController.php";
    const repositoryPath = "/workspace/app/Repositories/CommentRepository.php";
    const repositoryInterfacePath = "/workspace/app/Contracts/CommentRepositoryInterface.php";
    const controllerSource = `<?php
namespace App\\Http\\Controllers;

use App\\Repositories\\CommentRepository;

class CommentController
{
    public function __construct(
        protected readonly CommentRepository $commentRepository,
    ) {}

    public function getOne(): void
    {
        $this->commentRepository->findOrFail(1);
        $this->commentRepository->missingMethod();
    }
}
`;
    const runningStatus: LanguageServerRuntimeStatus = {
      capabilities: emptyLanguageServerCapabilities(),
      kind: "running",
      sessionId: 24,
    };
    const diagnosticsGateway: LanguageServerDiagnosticsGateway = {
      subscribeDiagnostics: vi.fn(async (listener) => {
        diagnosticsListener = listener;
        return () => undefined;
      }),
    };
    const methodDiagnosticPosition = (methodName: string) => {
      const position = positionAfter(controllerSource, `$this->commentRepository->${methodName}`);

      return {
        character: position.column - methodName.length - 1,
        line: position.lineNumber - 1,
      };
    };
    const { getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace",
      },
      languageServerDiagnosticsGateway: diagnosticsGateway,
      projectSymbols: [
        {
          column: 7,
          containerName: null,
          fullyQualifiedName: "App\\Repositories\\CommentRepository",
          kind: "class",
          lineNumber: 6,
          name: "CommentRepository",
          path: repositoryPath,
          relativePath: "app/Repositories/CommentRepository.php",
        },
        {
          column: 11,
          containerName: null,
          fullyQualifiedName: "App\\Contracts\\CommentRepositoryInterface",
          kind: "interface",
          lineNumber: 5,
          name: "CommentRepositoryInterface",
          path: repositoryInterfacePath,
          relativePath: "app/Contracts/CommentRepositoryInterface.php",
        },
      ],
      readTextFile: vi.fn(async (path: string) => {
        if (path === controllerPath) {
          return controllerSource;
        }

        if (path === repositoryPath) {
          return `<?php
namespace App\\Repositories;

use App\\Contracts\\CommentRepositoryInterface;

class CommentRepository implements CommentRepositoryInterface
{
}
`;
        }

        if (path === repositoryInterfacePath) {
          return `<?php
namespace App\\Contracts;

interface CommentRepositoryInterface
{
    public function findOrFail(int $id): object;
}
`;
        }

        return `<?php\n// ${path}\n`;
      }),
      runtimeStatus: runningStatus,
      workspaceDescriptor: phpWorkspaceDescriptor(),
    });
    await flushAsyncTurns(24);
    await act(async () => {
      await getWorkbench().setSmartMode("fullSmart");
    });
    await flushAsyncTurns(24);

    expect(diagnosticsListener).not.toBeNull();

    const findPosition = methodDiagnosticPosition("findOrFail");
    const missingPosition = methodDiagnosticPosition("missingMethod");

    act(() => {
      diagnosticsListener?.({
        diagnostics: [
          {
            ...findPosition,
            message: "Method App\\Repositories\\CommentRepository::findOrFail() does not exist",
            severity: "error",
            source: "phpactor",
          },
          {
            ...missingPosition,
            message: "Method App\\Repositories\\CommentRepository::missingMethod() does not exist",
            severity: "error",
            source: "phpactor",
          },
        ],
        rootPath: "/workspace",
        sessionId: runningStatus.sessionId,
        uri: fileUriFromPath(controllerPath),
        version: null,
      });
    });
    await flushAsyncTurns();

    expect(getWorkbench().languageServerDiagnosticsByPath[controllerPath]).toEqual([
      {
        ...missingPosition,
        message: "Method App\\Repositories\\CommentRepository::missingMethod() does not exist",
        severity: "error",
        source: "phpactor",
      },
    ]);
  });
  it("stops stale PHP method hierarchy diagnostic traversal after switching project tabs", async () => {
    let diagnosticsListener: ((event: LanguageServerDiagnosticEvent) => void) | null = null;
    const controllerPath = "/workspace-a/app/Http/Controllers/CommentController.php";
    const commentPath = "/workspace-a/app/Models/Comment.php";
    const workspaceBBaseCommentPath = "/workspace-b/app/Models/BaseComment.php";
    const controllerSource = `<?php
namespace App\\Http\\Controllers;

use App\\Models\\Comment;

class CommentController
{
    public function show(Comment $comment): void
    {
        $comment->knownHook();
    }
}
`;
    const runningStatus: LanguageServerRuntimeStatus = {
      capabilities: emptyLanguageServerCapabilities(),
      kind: "running",
      sessionId: 36,
    };
    const diagnosticsGateway: LanguageServerDiagnosticsGateway = {
      subscribeDiagnostics: vi.fn(async (listener) => {
        diagnosticsListener = listener;
        return () => undefined;
      }),
    };
    const staleCommentRead = createDeferred<string>();
    let commentReadCount = 0;
    let workspaceBBaseCommentReadCount = 0;
    const diagnosticPosition = positionAfter(controllerSource, "knownHook");
    const { getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace-a",
        workspaceTabs: ["/workspace-a", "/workspace-b"],
      },
      languageServerDiagnosticsGateway: diagnosticsGateway,
      readTextFile: vi.fn(async (path: string) => {
        if (path === controllerPath) {
          return controllerSource;
        }

        if (path === commentPath) {
          commentReadCount += 1;
          return staleCommentRead.promise;
        }

        if (path === workspaceBBaseCommentPath) {
          workspaceBBaseCommentReadCount += 1;
          return `<?php
namespace App\\Models;

class BaseComment
{
    public function knownHook(): void {}
}
`;
        }

        return `<?php\n// ${path}\n`;
      }),
      runtimeStatus: runningStatus,
      workspaceDescriptor: phpWorkspaceDescriptor(),
    });
    await flushAsyncTurns(24);

    expect(diagnosticsListener).not.toBeNull();

    act(() => {
      diagnosticsListener?.({
        diagnostics: [
          {
            character: diagnosticPosition.column - "knownHook".length - 1,
            line: diagnosticPosition.lineNumber - 1,
            message: "Method App\\Models\\Comment::knownHook() does not exist",
            severity: "error",
            source: "phpactor",
          },
        ],
        rootPath: "/workspace-a",
        sessionId: runningStatus.sessionId,
        uri: fileUriFromPath(controllerPath),
        version: null,
      });
    });
    await waitForReact(() => {
      expect(commentReadCount).toBe(1);
    });

    await act(async () => {
      await getWorkbench().activateWorkspaceTab("/workspace-b");
    });
    await flushAsyncTurns();

    staleCommentRead.resolve(`<?php
namespace App\\Models;

class Comment extends BaseComment
{
}
`);
    await flushAsyncTurns(24);

    expect(getWorkbench().workspaceRoot).toBe("/workspace-b");
    expect(workspaceBBaseCommentReadCount).toBe(0);
  });
  it("suppresses implemented interface PHPDoc method diagnostics on inferred receivers", async () => {
    let diagnosticsListener: ((event: LanguageServerDiagnosticEvent) => void) | null = null;
    const controllerPath = "/workspace/app/Http/Controllers/CommentController.php";
    const commentPath = "/workspace/app/Models/Comment.php";
    const interfacePath = "/workspace/app/Contracts/PublishesComments.php";
    const controllerSource = `<?php
namespace App\\Http\\Controllers;

use App\\Models\\Comment;

class CommentController
{
    public function show(Comment $comment): void
    {
        $comment->publish();
        $comment->archive();
        $comment->restore();
        $comment->missingPublish();
    }
}
`;
    const runningStatus: LanguageServerRuntimeStatus = {
      capabilities: emptyLanguageServerCapabilities(),
      kind: "running",
      sessionId: 27,
    };
    const diagnosticsGateway: LanguageServerDiagnosticsGateway = {
      subscribeDiagnostics: vi.fn(async (listener) => {
        diagnosticsListener = listener;
        return () => undefined;
      }),
    };
    const methodDiagnosticPosition = (methodName: string) => {
      const position = positionAfter(controllerSource, `$comment->${methodName}`);

      return {
        character: position.column - methodName.length - 1,
        line: position.lineNumber - 1,
      };
    };
    const { getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace",
      },
      languageServerDiagnosticsGateway: diagnosticsGateway,
      projectSymbols: [
        {
          column: 7,
          containerName: null,
          fullyQualifiedName: "App\\Models\\Comment",
          kind: "class",
          lineNumber: 7,
          name: "Comment",
          path: commentPath,
          relativePath: "app/Models/Comment.php",
        },
        {
          column: 11,
          containerName: null,
          fullyQualifiedName: "App\\Contracts\\PublishesComments",
          kind: "interface",
          lineNumber: 7,
          name: "PublishesComments",
          path: interfacePath,
          relativePath: "app/Contracts/PublishesComments.php",
        },
      ],
      readTextFile: vi.fn(async (path: string) => {
        if (path === controllerPath) {
          return controllerSource;
        }

        if (path === commentPath) {
          return `<?php
namespace App\\Models;

use App\\Contracts\\PublishesComments;

class Comment implements PublishesComments
{
}
`;
        }

        if (path === interfacePath) {
          return `<?php
namespace App\\Contracts;

/**
 * @method void publish()
 * @phpstan-method archive()
 * @psalm-method restore()
 */
interface PublishesComments
{
}
`;
        }

        return `<?php\n// ${path}\n`;
      }),
      runtimeStatus: runningStatus,
      workspaceDescriptor: phpWorkspaceDescriptor(),
    });
    await flushAsyncTurns(24);
    await act(async () => {
      await getWorkbench().setSmartMode("fullSmart");
    });
    await flushAsyncTurns(24);

    expect(diagnosticsListener).not.toBeNull();

    const publishPosition = methodDiagnosticPosition("publish");
    const archivePosition = methodDiagnosticPosition("archive");
    const restorePosition = methodDiagnosticPosition("restore");
    const missingPosition = methodDiagnosticPosition("missingPublish");

    act(() => {
      diagnosticsListener?.({
        diagnostics: [
          {
            ...publishPosition,
            message: "Method App\\Models\\Comment::publish() does not exist",
            severity: "error",
            source: "phpactor",
          },
          {
            ...archivePosition,
            message: "Method App\\Models\\Comment::archive() does not exist",
            severity: "error",
            source: "phpactor",
          },
          {
            ...restorePosition,
            message: "Method App\\Models\\Comment::restore() does not exist",
            severity: "error",
            source: "phpactor",
          },
          {
            ...missingPosition,
            message: "Method App\\Models\\Comment::missingPublish() does not exist",
            severity: "error",
            source: "phpactor",
          },
        ],
        rootPath: "/workspace",
        sessionId: runningStatus.sessionId,
        uri: fileUriFromPath(controllerPath),
        version: null,
      });
    });
    await flushAsyncTurns();

    expect(getWorkbench().languageServerDiagnosticsByPath[controllerPath]).toEqual([
      {
        ...missingPosition,
        message: "Method App\\Models\\Comment::missingPublish() does not exist",
        severity: "error",
        source: "phpactor",
      },
    ]);
  });
  it("suppresses existing static-method diagnostics without hiding instance-only methods", async () => {
    let diagnosticsListener: ((event: LanguageServerDiagnosticEvent) => void) | null = null;
    const controllerPath = "/workspace/app/Http/Controllers/CommentController.php";
    const factoryPath = "/workspace/app/Factories/CommentFactory.php";
    const controllerSource = `<?php
namespace App\\Http\\Controllers;

use App\\Factories\\CommentFactory;

class CommentController
{
    public function store(): void
    {
        CommentFactory::make();
        CommentFactory::fromNamed('draft');
        CommentFactory::restoreBySlug('draft');
        CommentFactory::makeInstance();
        CommentFactory::missingStatic();
    }
}
`;
    const runningStatus: LanguageServerRuntimeStatus = {
      capabilities: emptyLanguageServerCapabilities(),
      kind: "running",
      sessionId: 25,
    };
    const diagnosticsGateway: LanguageServerDiagnosticsGateway = {
      subscribeDiagnostics: vi.fn(async (listener) => {
        diagnosticsListener = listener;
        return () => undefined;
      }),
    };
    const methodDiagnosticPosition = (methodName: string) => {
      const position = positionAfter(controllerSource, `CommentFactory::${methodName}`);

      return {
        character: position.column - methodName.length - 1,
        line: position.lineNumber - 1,
      };
    };
    const { getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace",
      },
      languageServerDiagnosticsGateway: diagnosticsGateway,
      projectSymbols: [
        {
          column: 7,
          containerName: null,
          fullyQualifiedName: "App\\Factories\\CommentFactory",
          kind: "class",
          lineNumber: 8,
          name: "CommentFactory",
          path: factoryPath,
          relativePath: "app/Factories/CommentFactory.php",
        },
      ],
      readTextFile: vi.fn(async (path: string) => {
        if (path === controllerPath) {
          return controllerSource;
        }

        if (path === factoryPath) {
          return `<?php
namespace App\\Factories;

/**
 * @method static object fromNamed(string $name)
 * @psalm-method static restoreBySlug(string $slug)
 */
class CommentFactory
{
    public static function make(): object {}
    public function makeInstance(): object {}
}
`;
        }

        return `<?php\n// ${path}\n`;
      }),
      runtimeStatus: runningStatus,
      workspaceDescriptor: phpWorkspaceDescriptor(),
    });
    await flushAsyncTurns(24);
    await act(async () => {
      await getWorkbench().setSmartMode("fullSmart");
    });
    await flushAsyncTurns(24);

    expect(diagnosticsListener).not.toBeNull();

    const makePosition = methodDiagnosticPosition("make");
    const fromNamedPosition = methodDiagnosticPosition("fromNamed");
    const restoreBySlugPosition = methodDiagnosticPosition("restoreBySlug");
    const makeInstancePosition = methodDiagnosticPosition("makeInstance");
    const missingPosition = methodDiagnosticPosition("missingStatic");

    act(() => {
      diagnosticsListener?.({
        diagnostics: [
          {
            ...makePosition,
            message: "Method App\\Factories\\CommentFactory::make() does not exist",
            severity: "error",
            source: "phpactor",
          },
          {
            ...fromNamedPosition,
            message: "Method App\\Factories\\CommentFactory::fromNamed() does not exist",
            severity: "error",
            source: "phpactor",
          },
          {
            ...restoreBySlugPosition,
            message: "Method App\\Factories\\CommentFactory::restoreBySlug() does not exist",
            severity: "error",
            source: "phpactor",
          },
          {
            ...makeInstancePosition,
            message: "Method App\\Factories\\CommentFactory::makeInstance() does not exist",
            severity: "error",
            source: "phpactor",
          },
          {
            ...missingPosition,
            message: "Method App\\Factories\\CommentFactory::missingStatic() does not exist",
            severity: "error",
            source: "phpactor",
          },
        ],
        rootPath: "/workspace",
        sessionId: runningStatus.sessionId,
        uri: fileUriFromPath(controllerPath),
        version: null,
      });
    });
    await flushAsyncTurns();

    expect(getWorkbench().languageServerDiagnosticsByPath[controllerPath]).toEqual([
      {
        ...makeInstancePosition,
        message: "Method App\\Factories\\CommentFactory::makeInstance() does not exist",
        severity: "error",
        source: "phpactor",
      },
      {
        ...missingPosition,
        message: "Method App\\Factories\\CommentFactory::missingStatic() does not exist",
        severity: "error",
        source: "phpactor",
      },
    ]);
  });
  it("stops stale PHP static method hierarchy diagnostic traversal after switching project tabs", async () => {
    let diagnosticsListener: ((event: LanguageServerDiagnosticEvent) => void) | null = null;
    const controllerPath = "/workspace-a/app/Http/Controllers/CommentController.php";
    const factoryPath = "/workspace-a/app/Factories/CommentFactory.php";
    const workspaceBBaseFactoryPath = "/workspace-b/app/Factories/BaseCommentFactory.php";
    const controllerSource = `<?php
namespace App\\Http\\Controllers;

use App\\Factories\\CommentFactory;

class CommentController
{
    public function store(): void
    {
        CommentFactory::make();
    }
}
`;
    const runningStatus: LanguageServerRuntimeStatus = {
      capabilities: emptyLanguageServerCapabilities(),
      kind: "running",
      sessionId: 37,
    };
    const diagnosticsGateway: LanguageServerDiagnosticsGateway = {
      subscribeDiagnostics: vi.fn(async (listener) => {
        diagnosticsListener = listener;
        return () => undefined;
      }),
    };
    const staleFactoryRead = createDeferred<string>();
    let factoryReadCount = 0;
    let workspaceBBaseFactoryReadCount = 0;
    const diagnosticPosition = positionAfter(controllerSource, "make");
    const { getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace-a",
        workspaceTabs: ["/workspace-a", "/workspace-b"],
      },
      languageServerDiagnosticsGateway: diagnosticsGateway,
      readTextFile: vi.fn(async (path: string) => {
        if (path === controllerPath) {
          return controllerSource;
        }

        if (path === factoryPath) {
          factoryReadCount += 1;
          return staleFactoryRead.promise;
        }

        if (path === workspaceBBaseFactoryPath) {
          workspaceBBaseFactoryReadCount += 1;
          return `<?php
namespace App\\Factories;

class BaseCommentFactory
{
    public static function make(): object {}
}
`;
        }

        return `<?php\n// ${path}\n`;
      }),
      runtimeStatus: runningStatus,
      workspaceDescriptor: phpWorkspaceDescriptor(),
    });
    await flushAsyncTurns(24);

    expect(diagnosticsListener).not.toBeNull();

    act(() => {
      diagnosticsListener?.({
        diagnostics: [
          {
            character: diagnosticPosition.column - "make".length - 1,
            line: diagnosticPosition.lineNumber - 1,
            message: "Method App\\Factories\\CommentFactory::make() does not exist",
            severity: "error",
            source: "phpactor",
          },
        ],
        rootPath: "/workspace-a",
        sessionId: runningStatus.sessionId,
        uri: fileUriFromPath(controllerPath),
        version: null,
      });
    });
    await waitForReact(() => {
      expect(factoryReadCount).toBe(1);
    });

    await act(async () => {
      await getWorkbench().activateWorkspaceTab("/workspace-b");
    });
    await flushAsyncTurns();

    staleFactoryRead.resolve(`<?php
namespace App\\Factories;

class CommentFactory extends BaseCommentFactory
{
}
`);
    await flushAsyncTurns(24);

    expect(getWorkbench().workspaceRoot).toBe("/workspace-b");
    expect(workspaceBBaseFactoryReadCount).toBe(0);
  });
  it("suppresses implemented interface PHPDoc property diagnostics on inferred receivers", async () => {
    let diagnosticsListener: ((event: LanguageServerDiagnosticEvent) => void) | null = null;
    const controllerPath = "/workspace/app/Http/Controllers/CommentController.php";
    const commentPath = "/workspace/app/Models/Comment.php";
    const interfacePath = "/workspace/app/Contracts/HasExternalId.php";
    const controllerSource = `<?php
namespace App\\Http\\Controllers;

use App\\Models\\Comment;

class CommentController
{
    public function show(Comment $comment): void
    {
        $comment->externalId;
        $comment->slug;
        $comment->hidden;
        $comment->missingProperty;
    }
}
`;
    const runningStatus: LanguageServerRuntimeStatus = {
      capabilities: emptyLanguageServerCapabilities(),
      kind: "running",
      sessionId: 26,
    };
    const diagnosticsGateway: LanguageServerDiagnosticsGateway = {
      subscribeDiagnostics: vi.fn(async (listener) => {
        diagnosticsListener = listener;
        return () => undefined;
      }),
    };
    const propertyDiagnosticPosition = (propertyName: string) => {
      const position = positionAfter(controllerSource, `$comment->${propertyName}`);

      return {
        character: position.column - propertyName.length - 1,
        line: position.lineNumber - 1,
      };
    };
    const { getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace",
      },
      languageServerDiagnosticsGateway: diagnosticsGateway,
      projectSymbols: [
        {
          column: 7,
          containerName: null,
          fullyQualifiedName: "App\\Models\\Comment",
          kind: "class",
          lineNumber: 6,
          name: "Comment",
          path: commentPath,
          relativePath: "app/Models/Comment.php",
        },
        {
          column: 11,
          containerName: null,
          fullyQualifiedName: "App\\Contracts\\HasExternalId",
          kind: "interface",
          lineNumber: 6,
          name: "HasExternalId",
          path: interfacePath,
          relativePath: "app/Contracts/HasExternalId.php",
        },
      ],
      readTextFile: vi.fn(async (path: string) => {
        if (path === controllerPath) {
          return controllerSource;
        }

        if (path === commentPath) {
          return `<?php
namespace App\\Models;

use App\\Contracts\\HasExternalId;

class Comment implements HasExternalId
{
}
`;
        }

        if (path === interfacePath) {
          return `<?php
namespace App\\Contracts;

/**
 * @property-read string $externalId
 * @phpstan-property-read string $slug
 * @psalm-property-write bool $hidden
 */
interface HasExternalId
{
}
`;
        }

        return `<?php\n// ${path}\n`;
      }),
      runtimeStatus: runningStatus,
      workspaceDescriptor: phpWorkspaceDescriptor(),
    });
    await flushAsyncTurns(24);
    await act(async () => {
      await getWorkbench().setSmartMode("fullSmart");
    });
    await flushAsyncTurns(24);

    expect(diagnosticsListener).not.toBeNull();

    const externalIdPosition = propertyDiagnosticPosition("externalId");
    const slugPosition = propertyDiagnosticPosition("slug");
    const hiddenPosition = propertyDiagnosticPosition("hidden");
    const missingPosition = propertyDiagnosticPosition("missingProperty");

    act(() => {
      diagnosticsListener?.({
        diagnostics: [
          {
            ...externalIdPosition,
            message: "Property App\\Models\\Comment::$externalId does not exist",
            severity: "error",
            source: "phpactor",
          },
          {
            ...slugPosition,
            message: "Property App\\Models\\Comment::$slug does not exist",
            severity: "error",
            source: "phpactor",
          },
          {
            ...hiddenPosition,
            message: "Property App\\Models\\Comment::$hidden does not exist",
            severity: "error",
            source: "phpactor",
          },
          {
            ...missingPosition,
            message: "Property App\\Models\\Comment::$missingProperty does not exist",
            severity: "error",
            source: "phpactor",
          },
        ],
        rootPath: "/workspace",
        sessionId: runningStatus.sessionId,
        uri: fileUriFromPath(controllerPath),
        version: null,
      });
    });
    await flushAsyncTurns();

    expect(getWorkbench().languageServerDiagnosticsByPath[controllerPath]).toEqual([
      {
        ...missingPosition,
        message: "Property App\\Models\\Comment::$missingProperty does not exist",
        severity: "error",
        source: "phpactor",
      },
    ]);
  });
  it("stops stale PHP property hierarchy diagnostic traversal after switching project tabs", async () => {
    let diagnosticsListener: ((event: LanguageServerDiagnosticEvent) => void) | null = null;
    const controllerPath = "/workspace-a/app/Http/Controllers/CommentController.php";
    const commentPath = "/workspace-a/app/Models/Comment.php";
    const workspaceBBaseCommentPath = "/workspace-b/app/Models/BaseComment.php";
    const controllerSource = `<?php
namespace App\\Http\\Controllers;

use App\\Models\\Comment;

class CommentController
{
    public function show(Comment $comment): void
    {
        $comment->externalId;
    }
}
`;
    const runningStatus: LanguageServerRuntimeStatus = {
      capabilities: emptyLanguageServerCapabilities(),
      kind: "running",
      sessionId: 38,
    };
    const diagnosticsGateway: LanguageServerDiagnosticsGateway = {
      subscribeDiagnostics: vi.fn(async (listener) => {
        diagnosticsListener = listener;
        return () => undefined;
      }),
    };
    const staleCommentRead = createDeferred<string>();
    let commentReadCount = 0;
    let workspaceBBaseCommentReadCount = 0;
    const diagnosticPosition = positionAfter(controllerSource, "externalId");
    const { getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace-a",
        workspaceTabs: ["/workspace-a", "/workspace-b"],
      },
      languageServerDiagnosticsGateway: diagnosticsGateway,
      readTextFile: vi.fn(async (path: string) => {
        if (path === controllerPath) {
          return controllerSource;
        }

        if (path === commentPath) {
          commentReadCount += 1;
          return staleCommentRead.promise;
        }

        if (path === workspaceBBaseCommentPath) {
          workspaceBBaseCommentReadCount += 1;
          return `<?php
namespace App\\Models;

class BaseComment
{
    public string $externalId;
}
`;
        }

        return `<?php\n// ${path}\n`;
      }),
      runtimeStatus: runningStatus,
      workspaceDescriptor: phpWorkspaceDescriptor(),
    });
    await flushAsyncTurns(24);

    expect(diagnosticsListener).not.toBeNull();

    act(() => {
      diagnosticsListener?.({
        diagnostics: [
          {
            character: diagnosticPosition.column - "externalId".length - 1,
            line: diagnosticPosition.lineNumber - 1,
            message: "Property App\\Models\\Comment::$externalId does not exist",
            severity: "error",
            source: "phpactor",
          },
        ],
        rootPath: "/workspace-a",
        sessionId: runningStatus.sessionId,
        uri: fileUriFromPath(controllerPath),
        version: null,
      });
    });
    await waitForReact(() => {
      expect(commentReadCount).toBe(1);
    });

    await act(async () => {
      await getWorkbench().activateWorkspaceTab("/workspace-b");
    });
    await flushAsyncTurns();

    staleCommentRead.resolve(`<?php
namespace App\\Models;

class Comment extends BaseComment
{
}
`);
    await flushAsyncTurns(24);

    expect(getWorkbench().workspaceRoot).toBe("/workspace-b");
    expect(workspaceBBaseCommentReadCount).toBe(0);
  });
  it("infers Laravel relation model completions from property and relation chains", async () => {
    const controllerPath = "/workspace/app/Http/Controllers/CommentController.php";
    const repositoryInterfacePath =
      "/workspace/app/Kontentino/src/Communication/Interfaces/CommentRepositoryInterface.php";
    const commentPath = "/workspace/app/Kontentino/src/Communication/Models/Comment.php";
    const userPath = "/workspace/app/Models/User.php";
    const commentModelSource = `<?php
namespace Kontentino\\Communication\\Models;

use App\\Models\\User;
use Illuminate\\Database\\Eloquent\\Relations\\BelongsTo;
use Illuminate\\Database\\Eloquent\\Relations\\HasMany;
use Illuminate\\Database\\Eloquent\\Relations\\MorphTo;
use Illuminate\\Database\\Eloquent\\Relations\\MorphedByMany;
use Illuminate\\Database\\Eloquent\\Relations\\Relation;
use Illuminate\\Database\\Eloquent\\Model;

/** @property-read \\Illuminate\\Database\\Eloquent\\Collection<int, User> $reviewers */
class Comment
{
    private const OWNER_MODEL = User::class;
    private const MORPH_MAP = [
        'user' => self::OWNER_MODEL,
    ];

    protected static function booted(): void
    {
        Relation::morphMap(self::MORPH_MAP);
    }

    public function parent(): BelongsTo
    {
        return $this->belongsTo(Comment::class, 'parent_id');
    }

    public function children(): HasMany
    {
        return $this->hasMany(Comment::class, 'parent_id');
    }

    public function localChildren(): HasMany
    {
        $related = Comment::class;
        return $this->hasMany($related, 'parent_id');
    }

    public function siblings(): HasMany
    {
        return $this->hasMany(self::class, 'parent_id');
    }

    public function replies(): HasMany
    {
        return $this->hasMany(__CLASS__, 'parent_id');
    }

    public function namedChildren(): HasMany
    {
        return $this->hasMany(
            foreignKey: 'parent_id',
            related: Comment::class,
        );
    }

    /** @return BelongsTo<Comment, self> */
    public function documentedParent(): BelongsTo
    {
        return $this->belongsTo();
    }

    /** @return MorphTo<Model, User> */
    public function documentedOwner(): MorphTo
    {
        return $this->morphTo();
    }

    public function mappedOwner(): MorphTo
    {
        return $this->morphTo();
    }

    public function likers(): MorphedByMany
    {
        return $this->morphedByMany(User::class, 'likeable');
    }

    public function getContent(): string {}
}
`;
    const controllerSource = `<?php
namespace App\\Http\\Controllers\\communication;

use App\\Http\\Requests\\GetOneCommentRequest;
use Kontentino\\Communication\\Interfaces\\CommentRepositoryInterface;

class CommentController
{
    public function __construct(
        protected readonly CommentRepositoryInterface $commentRepository,
    ) {}

    public function getOne(GetOneCommentRequest $request): void
    {
        $comment = $this->commentRepository->findOrFail($request->getCommentId());
        $comment->par
        $comment->parent->get

        $parent = $comment->parent()->first();
        $parent->getContent();

        $child = $comment->children()->get()->first();
        $child->get

        $comment->localChildren()->first()->get

        $childFromProperty = $comment->children->first();
        $childFromProperty->get

        $requiredChildFromProperty = $comment->children->firstOrFail();
        $requiredChildFromProperty->get

        $sibling = $comment->siblings()->first();
        $sibling->get

        $loadedComment = $comment->load('children');
        $loadedComment->get

        $reply = $comment->replies()->first();
        $reply->get

        $filteredChildFromProperty = $comment->children->filter()->first();
        $filteredChildFromProperty->get

        $reviewer = $comment->reviewers->first();
        $reviewer->get

        $owner = $comment->documentedOwner;
        $owner->get

        $mappedOwner = $comment->mappedOwner()->first();
        $mappedOwner->get

        $documentedParent = $comment->documentedParent()->first();
        $documentedParent->get

        $liker = $comment->likers()->first();
        $liker->get

        $namedChild = $comment->namedChildren()->first();
        $namedChild->get
    }
}
`;
    const { getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace",
      },
      projectSymbols: [
        {
          column: 11,
          containerName: null,
          fullyQualifiedName: "Kontentino\\Communication\\Interfaces\\CommentRepositoryInterface",
          kind: "interface",
          lineNumber: 7,
          name: "CommentRepositoryInterface",
          path: repositoryInterfacePath,
          relativePath:
            "app/Kontentino/src/Communication/Interfaces/CommentRepositoryInterface.php",
        },
        {
          column: 7,
          containerName: null,
          fullyQualifiedName: "Kontentino\\Communication\\Models\\Comment",
          kind: "class",
          lineNumber: 7,
          name: "Comment",
          path: commentPath,
          relativePath: "app/Kontentino/src/Communication/Models/Comment.php",
        },
        {
          column: 7,
          containerName: null,
          fullyQualifiedName: "App\\Models\\User",
          kind: "class",
          lineNumber: 5,
          name: "User",
          path: userPath,
          relativePath: "app/Models/User.php",
        },
      ],
      readTextFile: vi.fn(async (path: string) => {
        if (path === controllerPath) {
          return controllerSource;
        }

        if (path === repositoryInterfacePath) {
          return `<?php
namespace Kontentino\\Communication\\Interfaces;

use Kontentino\\Communication\\Models\\Comment;

interface CommentRepositoryInterface
{
    public function findOrFail(int $id): Comment;
}
`;
        }

        if (path === commentPath) {
          return commentModelSource;
        }

        if (path === userPath) {
          return `<?php
namespace App\\Models;

class User
{
    public function getName(): string {}
}
`;
        }

        return `<?php\n// ${path}\n`;
      }),
      workspaceDescriptor: phpWorkspaceDescriptor(),
    });
    await flushAsyncTurns();
    await act(async () => {
      await getWorkbench().setSmartMode("fullSmart");
    });

    await act(async () => {
      await getWorkbench().openFile(fileEntry(controllerPath, "CommentController.php"));
    });

    await expect(
      getWorkbench().providePhpMethodCompletions(
        controllerSource,
        positionAfter(controllerSource, "$comment->par"),
      ),
    ).resolves.toEqual([
      {
        declaringClassName: "Kontentino\\Communication\\Models\\Comment",
        name: "parent",
        parameters: "",
        returnType: "BelongsTo",
      },
      {
        declaringClassName: "Kontentino\\Communication\\Models\\Comment",
        kind: "property",
        name: "parent",
        parameters: "",
        returnType: "Comment",
      },
    ]);
    await expect(
      getWorkbench().providePhpMethodCompletions(
        controllerSource,
        positionAfter(controllerSource, "$comment->parent->get"),
      ),
    ).resolves.toEqual([
      {
        declaringClassName: "Kontentino\\Communication\\Models\\Comment",
        name: "getContent",
        parameters: "",
        returnType: "string",
      },
    ]);
    await expect(
      getWorkbench().providePhpMethodCompletions(
        controllerSource,
        positionAfter(controllerSource, "$reply->get"),
      ),
    ).resolves.toEqual([
      {
        declaringClassName: "Kontentino\\Communication\\Models\\Comment",
        name: "getContent",
        parameters: "",
        returnType: "string",
      },
    ]);
    await expect(
      getWorkbench().providePhpMethodCompletions(
        controllerSource,
        positionAfter(controllerSource, "$parent->get"),
      ),
    ).resolves.toEqual([
      {
        declaringClassName: "Kontentino\\Communication\\Models\\Comment",
        name: "getContent",
        parameters: "",
        returnType: "string",
      },
    ]);
    await expect(
      getWorkbench().providePhpMethodCompletions(
        controllerSource,
        positionAfter(controllerSource, "$documentedParent->get"),
      ),
    ).resolves.toEqual([
      {
        declaringClassName: "Kontentino\\Communication\\Models\\Comment",
        name: "getContent",
        parameters: "",
        returnType: "string",
      },
    ]);
    await expect(
      getWorkbench().providePhpMethodCompletions(
        controllerSource,
        positionAfter(controllerSource, "$childFromProperty->get"),
      ),
    ).resolves.toEqual([
      {
        declaringClassName: "Kontentino\\Communication\\Models\\Comment",
        name: "getContent",
        parameters: "",
        returnType: "string",
      },
    ]);
    await expect(
      getWorkbench().providePhpMethodCompletions(
        controllerSource,
        positionAfter(controllerSource, "$requiredChildFromProperty->get"),
      ),
    ).resolves.toEqual([
      {
        declaringClassName: "Kontentino\\Communication\\Models\\Comment",
        name: "getContent",
        parameters: "",
        returnType: "string",
      },
    ]);
    await expect(
      getWorkbench().providePhpMethodCompletions(
        controllerSource,
        positionAfter(controllerSource, "$sibling->get"),
      ),
    ).resolves.toEqual([
      {
        declaringClassName: "Kontentino\\Communication\\Models\\Comment",
        name: "getContent",
        parameters: "",
        returnType: "string",
      },
    ]);
    await expect(
      getWorkbench().providePhpMethodCompletions(
        controllerSource,
        positionAfter(controllerSource, "$loadedComment->get"),
      ),
    ).resolves.toEqual([
      {
        declaringClassName: "Kontentino\\Communication\\Models\\Comment",
        name: "getContent",
        parameters: "",
        returnType: "string",
      },
    ]);
    await expect(
      getWorkbench().providePhpMethodCompletions(
        controllerSource,
        positionAfter(controllerSource, "$filteredChildFromProperty->get"),
      ),
    ).resolves.toEqual([
      {
        declaringClassName: "Kontentino\\Communication\\Models\\Comment",
        name: "getContent",
        parameters: "",
        returnType: "string",
      },
    ]);
    await expect(
      getWorkbench().providePhpMethodCompletions(
        controllerSource,
        positionAfter(controllerSource, "$reviewer->get"),
      ),
    ).resolves.toEqual([
      {
        declaringClassName: "App\\Models\\User",
        name: "getName",
        parameters: "",
        returnType: "string",
      },
    ]);
    await expect(
      getWorkbench().providePhpMethodCompletions(
        controllerSource,
        positionAfter(controllerSource, "$owner->get"),
      ),
    ).resolves.toEqual([
      {
        declaringClassName: "App\\Models\\User",
        name: "getName",
        parameters: "",
        returnType: "string",
      },
    ]);
    await expect(
      getWorkbench().providePhpMethodCompletions(
        controllerSource,
        positionAfter(controllerSource, "$mappedOwner->get"),
      ),
    ).resolves.toEqual([
      {
        declaringClassName: "App\\Models\\User",
        name: "getName",
        parameters: "",
        returnType: "string",
      },
    ]);
    await expect(
      getWorkbench().providePhpMethodCompletions(
        controllerSource,
        positionAfter(controllerSource, "$child->get"),
      ),
    ).resolves.toEqual([
      {
        declaringClassName: "Kontentino\\Communication\\Models\\Comment",
        name: "getContent",
        parameters: "",
        returnType: "string",
      },
    ]);
    await expect(
      getWorkbench().providePhpMethodCompletions(
        controllerSource,
        positionAfter(controllerSource, "$comment->localChildren()->first()->get"),
      ),
    ).resolves.toEqual([
      {
        declaringClassName: "Kontentino\\Communication\\Models\\Comment",
        name: "getContent",
        parameters: "",
        returnType: "string",
      },
    ]);
    await expect(
      getWorkbench().providePhpMethodCompletions(
        controllerSource,
        positionAfter(controllerSource, "$liker->get"),
      ),
    ).resolves.toEqual([
      {
        declaringClassName: "App\\Models\\User",
        name: "getName",
        parameters: "",
        returnType: "string",
      },
    ]);
    await expect(
      getWorkbench().providePhpMethodCompletions(
        controllerSource,
        positionAfter(controllerSource, "$namedChild->get"),
      ),
    ).resolves.toEqual([
      {
        declaringClassName: "Kontentino\\Communication\\Models\\Comment",
        name: "getContent",
        parameters: "",
        returnType: "string",
      },
    ]);
    act(() => {
      getWorkbench().updateActiveEditorPosition(
        positionAfter(controllerSource, "$parent->getContent"),
      );
    });

    await act(async () => {
      await getWorkbench()
        .commands.find((candidate) => candidate.id === "editor.goToDefinition")
        ?.run();
    });

    expect(getWorkbench().activePath).toBe(commentPath);
    expect(getWorkbench().editorRevealTarget).toEqual({
      path: commentPath,
      position: {
        column: 21,
        lineNumber: lineNumberOf(commentModelSource, "getContent"),
      },
    });
  });
  it("infers Laravel model attributes through static builder and collection chains", async () => {
    const controllerPath = "/workspace/app/Http/Controllers/ProbeController.php";
    const commentPath = "/workspace/app/Models/Comment.php";
    const commentModelSource = `<?php
namespace App\\Models;

use Illuminate\\Database\\Eloquent\\Model;
use Illuminate\\Database\\Eloquent\\Relations\\BelongsTo;

class Comment extends Model
{
    protected $fillable = ['title'];

    public function parent(): BelongsTo
    {
        return $this->belongsTo(Comment::class, 'parent_id');
    }

    public function getContent(): string {}
}
`;
    const controllerSource = `<?php
namespace App\\Http\\Controllers;

use App\\Models\\Comment;

class ProbeController
{
    public function run(Comment $model): void
    {
        $a = $model->findOrFail(1);
        $a->getCon

        $b = Comment::query()->where('id', 1)->first();
        $b->getCon

        $c = Comment::with('parent')->first();
        $c->getCon

        $d = Comment::with('parent')->get()->first();
        $d->getCon

        $e = Comment::query()->where('id', 1)->get()->first();
        $e->getCon

        $f = $model->findOrFail(1)->parent;
        $f->getCon

        $titleHolder = Comment::query()->where('id', 1)->first();
        $titleHolder->titl

        $inlineAttr = Comment::findOrFail(1)->titl
    }
}
`;
    const { getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace",
      },
      readTextFile: vi.fn(async (path: string) => {
        if (path === controllerPath) {
          return controllerSource;
        }

        if (path === commentPath) {
          return commentModelSource;
        }

        return `<?php\n// ${path}\n`;
      }),
      workspaceDescriptor: phpWorkspaceDescriptor(),
    });
    await flushAsyncTurns();
    await act(async () => {
      await getWorkbench().setSmartMode("fullSmart");
    });
    await act(async () => {
      await getWorkbench().openFile(fileEntry(controllerPath, "ProbeController.php"));
    });

    const getContentCompletion = {
      declaringClassName: "App\\Models\\Comment",
      name: "getContent",
      parameters: "",
      returnType: "string",
    };

    await expect(
      getWorkbench().providePhpMethodCompletions(
        controllerSource,
        positionAfter(controllerSource, "$a->getCon"),
      ),
    ).resolves.toEqual([getContentCompletion]);
    await expect(
      getWorkbench().providePhpMethodCompletions(
        controllerSource,
        positionAfter(controllerSource, "$b->getCon"),
      ),
    ).resolves.toEqual([getContentCompletion]);
    await expect(
      getWorkbench().providePhpMethodCompletions(
        controllerSource,
        positionAfter(controllerSource, "$c->getCon"),
      ),
    ).resolves.toEqual([getContentCompletion]);
    await expect(
      getWorkbench().providePhpMethodCompletions(
        controllerSource,
        positionAfter(controllerSource, "$d->getCon"),
      ),
    ).resolves.toEqual([getContentCompletion]);
    await expect(
      getWorkbench().providePhpMethodCompletions(
        controllerSource,
        positionAfter(controllerSource, "$e->getCon"),
      ),
    ).resolves.toEqual([getContentCompletion]);
    await expect(
      getWorkbench().providePhpMethodCompletions(
        controllerSource,
        positionAfter(controllerSource, "$f->getCon"),
      ),
    ).resolves.toEqual([getContentCompletion]);
    const titleHolderNames = (
      await getWorkbench().providePhpMethodCompletions(
        controllerSource,
        positionAfter(controllerSource, "$titleHolder->titl"),
      )
    ).map((completion) => completion.name);
    expect(titleHolderNames).toContain("title");
    const inlineAttrNames = (
      await getWorkbench().providePhpMethodCompletions(
        controllerSource,
        positionAfter(controllerSource, "Comment::findOrFail(1)->titl"),
      )
    ).map((completion) => completion.name);
    expect(inlineAttrNames).toContain("title");
  });
  it("infers Laravel model attributes through builder, repository, scope, and dynamic-where chains", async () => {
    const controllerPath = "/workspace/app/Http/Controllers/Probe2Controller.php";
    const commentPath = "/workspace/app/Models/Comment.php";
    const repoPath = "/workspace/app/Repositories/CommentRepository.php";
    const commentModelSource = `<?php
namespace App\\Models;

use Illuminate\\Database\\Eloquent\\Builder;
use Illuminate\\Database\\Eloquent\\Model;
use Illuminate\\Database\\Eloquent\\Relations\\BelongsTo;

class Comment extends Model
{
    protected $fillable = ['title'];

    public function parent(): BelongsTo
    {
        return $this->belongsTo(Comment::class, 'parent_id');
    }

    public function scopePublished(Builder $query): void
    {
        $query->whereNotNull('published_at');
    }

    public function getContent(): string {}
}
`;
    const repoSource = `<?php
namespace App\\Repositories;

use App\\Models\\Comment;

class CommentRepository
{
    public function findById(int $id)
    {
        return Comment::findOrFail($id);
    }
}
`;
    const controllerSource = `<?php
namespace App\\Http\\Controllers;

use App\\Models\\Comment;
use App\\Repositories\\CommentRepository;

class Probe2Controller
{
    public function run(CommentRepository $repo): void
    {
        $a = Comment::all()->first();
        $a->getCon

        $b = Comment::where('id', 1)->first();
        $b->getCon

        $query = Comment::query();
        $c = $query->where('id', 1)->first();
        $c->getCon

        $d = Comment::with(['parent'])->first();
        $d->getCon

        $e = Comment::firstWhere('id', 1);
        $e->getCon

        $g = $repo->findById(1);
        $g->getCon

        $h = $repo->findById(1)->parent()->first();
        $h->getCon

        $i = Comment::whereTitle('hello')->first();
        $i->getCon

        $j = Comment::published()->first();
        $j->getCon
    }
}
`;
    const { getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace",
      },
      readTextFile: vi.fn(async (path: string) => {
        if (path === controllerPath) {
          return controllerSource;
        }

        if (path === commentPath) {
          return commentModelSource;
        }

        if (path === repoPath) {
          return repoSource;
        }

        return `<?php\n// ${path}\n`;
      }),
      workspaceDescriptor: phpWorkspaceDescriptor(),
    });
    await flushAsyncTurns();
    await act(async () => {
      await getWorkbench().setSmartMode("fullSmart");
    });
    await act(async () => {
      await getWorkbench().openFile(fileEntry(controllerPath, "Probe2Controller.php"));
    });

    const getContentCompletion = {
      declaringClassName: "App\\Models\\Comment",
      name: "getContent",
      parameters: "",
      returnType: "string",
    };

    for (const variable of ["$a", "$b", "$c", "$d", "$e", "$g", "$h", "$i", "$j"]) {
      const names = (
        await getWorkbench().providePhpMethodCompletions(
          controllerSource,
          positionAfter(controllerSource, `${variable}->getCon`),
        )
      ).map((completion) => completion.name);

      expect({ names, variable }).toEqual({
        names: [getContentCompletion.name],
        variable,
      });
    }
  });
  it("offers Laravel relation-name completions across static, chained, member, and nested receivers", async () => {
    const controllerPath = "/workspace/app/Http/Controllers/ProbeWithController.php";
    const commentPath = "/workspace/app/Models/Comment.php";
    const commentModelSource = `<?php
namespace App\\Models;

use Illuminate\\Database\\Eloquent\\Model;
use Illuminate\\Database\\Eloquent\\Relations\\BelongsTo;
use Illuminate\\Database\\Eloquent\\Relations\\HasMany;

class Comment extends Model
{
    public function parent(): BelongsTo
    {
        return $this->belongsTo(Comment::class, 'parent_id');
    }

    public function children(): HasMany
    {
        return $this->hasMany(Comment::class, 'parent_id');
    }
}
`;
    const controllerSource = `<?php
namespace App\\Http\\Controllers;

use App\\Models\\Comment;

class ProbeWithController
{
    public function run(Comment $comment): void
    {
        Comment::with('');
        Comment::query()->with('');
        $comment->load('');
        Comment::whereHas('');
        Comment::with('parent.');
    }
}
`;
    const { getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace",
      },
      readTextFile: vi.fn(async (path: string) => {
        if (path === controllerPath) {
          return controllerSource;
        }

        if (path === commentPath) {
          return commentModelSource;
        }

        return `<?php\n// ${path}\n`;
      }),
      workspaceDescriptor: phpWorkspaceDescriptor(),
    });
    await flushAsyncTurns();
    await act(async () => {
      await getWorkbench().setSmartMode("fullSmart");
    });
    await act(async () => {
      await getWorkbench().openFile(fileEntry(controllerPath, "ProbeWithController.php"));
    });

    const relationNamesAt = async (needle: string): Promise<string[]> =>
      (
        await getWorkbench().providePhpMethodCompletions(
          controllerSource,
          positionAfter(controllerSource, needle),
        )
      )
        .map((completion) => completion.name)
        .sort();

    expect({
      direct: await relationNamesAt("Comment::with('"),
      member: await relationNamesAt("$comment->load('"),
      nested: await relationNamesAt("Comment::with('parent."),
      staticChain: await relationNamesAt("Comment::query()->with('"),
      whereHas: await relationNamesAt("Comment::whereHas('"),
    }).toEqual({
      direct: ["children", "parent"],
      member: ["children", "parent"],
      nested: ["children", "parent"],
      staticChain: ["children", "parent"],
      whereHas: ["children", "parent"],
    });
  });
  it("infers Laravel enforced morph map completions from service provider files", async () => {
    const controllerPath = "/workspace/app/Http/Controllers/CommentController.php";
    const commentPath = "/workspace/app/Models/Comment.php";
    const userPath = "/workspace/app/Models/User.php";
    const providerPath = "/workspace/app/Providers/AppServiceProvider.php";
    const commentModelSource = `<?php
namespace App\\Models;

use Illuminate\\Database\\Eloquent\\Model;
use Illuminate\\Database\\Eloquent\\Relations\\MorphTo;

class Comment extends Model
{
    public function mappedOwner(): MorphTo
    {
        return $this->morphTo();
    }
}
`;
    const controllerSource = `<?php
namespace App\\Http\\Controllers;

use App\\Models\\Comment;

class CommentController
{
    public function show(Comment $comment): void
    {
        $owner = $comment->mappedOwner()->first();
        $owner->get
    }
}
`;
    const providerSource = `<?php
namespace App\\Providers;

use App\\Models\\User;
use Illuminate\\Database\\Eloquent\\Relations\\Relation;

class AppServiceProvider
{
    public function boot(): void
    {
        Relation::enforceMorphMap([
            'user' => User::class,
        ]);
    }
}
`;
    const { getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace",
      },
      projectSymbols: [
        {
          column: 7,
          containerName: null,
          fullyQualifiedName: "App\\Models\\Comment",
          kind: "class",
          lineNumber: 6,
          name: "Comment",
          path: commentPath,
          relativePath: "app/Models/Comment.php",
        },
        {
          column: 7,
          containerName: null,
          fullyQualifiedName: "App\\Models\\User",
          kind: "class",
          lineNumber: 5,
          name: "User",
          path: userPath,
          relativePath: "app/Models/User.php",
        },
      ],
      readTextFile: vi.fn(async (path: string) => {
        if (path === controllerPath) {
          return controllerSource;
        }

        if (path === commentPath) {
          return commentModelSource;
        }

        if (path === providerPath) {
          return providerSource;
        }

        if (path === userPath) {
          return `<?php
namespace App\\Models;

class User
{
    public function getName(): string {}
}
`;
        }

        return `<?php\n// ${path}\n`;
      }),
      searchText: vi.fn(async (_root: string, query: string, _limit: number) =>
        query === "enforceMorphMap"
          ? [
              {
                column: 19,
                lineText: "        Relation::enforceMorphMap([",
                lineNumber: 10,
                path: providerPath,
                relativePath: "app/Providers/AppServiceProvider.php",
              },
            ]
          : [],
      ),
      workspaceDescriptor: phpWorkspaceDescriptor(),
    });
    await flushAsyncTurns();
    await act(async () => {
      await getWorkbench().setSmartMode("fullSmart");
    });
    await act(async () => {
      await getWorkbench().openFile(fileEntry(controllerPath, "CommentController.php"));
    });

    await expect(
      getWorkbench().providePhpMethodCompletions(
        controllerSource,
        positionAfter(controllerSource, "$owner->get"),
      ),
    ).resolves.toEqual([
      {
        declaringClassName: "App\\Models\\User",
        name: "getName",
        parameters: "",
        returnType: "string",
      },
    ]);
  });
  it("stops stale Laravel morph map search after switching project tabs", async () => {
    const controllerPath = "/workspace-a/app/Http/Controllers/CommentController.php";
    const commentPath = "/workspace-a/app/Models/Comment.php";
    const providerPath = "/workspace-a/app/Providers/AppServiceProvider.php";
    const userPath = "/workspace-a/app/Models/User.php";
    const commentModelSource = `<?php
namespace App\\Models;

use Illuminate\\Database\\Eloquent\\Model;
use Illuminate\\Database\\Eloquent\\Relations\\MorphTo;

class Comment extends Model
{
    public function mappedOwner(): MorphTo
    {
        return $this->morphTo();
    }
}
`;
    const controllerSource = `<?php
namespace App\\Http\\Controllers;

use App\\Models\\Comment;

class CommentController
{
    public function show(Comment $comment): void
    {
        $owner = $comment->mappedOwner()->first();
        $owner->get
    }
}
`;
    const providerSource = `<?php
namespace App\\Providers;

use App\\Models\\User;
use Illuminate\\Database\\Eloquent\\Relations\\Relation;

class AppServiceProvider
{
    public function boot(): void
    {
        Relation::morphMap([
            'user' => User::class,
        ]);
    }
}
`;
    const staleMorphMapSearch = createDeferred<TextSearchResult[]>();
    const searchText = vi.fn(async (_root: string, query: string, _limit: number) =>
      query === "morphMap" ? staleMorphMapSearch.promise : [],
    );
    let providerReadCount = 0;
    const { getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace-a",
        workspaceTabs: ["/workspace-a", "/workspace-b"],
      },
      projectSymbols: [
        {
          column: 7,
          containerName: null,
          fullyQualifiedName: "App\\Models\\Comment",
          kind: "class",
          lineNumber: 6,
          name: "Comment",
          path: commentPath,
          relativePath: "app/Models/Comment.php",
        },
        {
          column: 7,
          containerName: null,
          fullyQualifiedName: "App\\Models\\User",
          kind: "class",
          lineNumber: 5,
          name: "User",
          path: userPath,
          relativePath: "app/Models/User.php",
        },
      ],
      readTextFile: vi.fn(async (path: string) => {
        if (path === controllerPath) {
          return controllerSource;
        }

        if (path === commentPath) {
          return commentModelSource;
        }

        if (path === providerPath) {
          providerReadCount += 1;
          return providerSource;
        }

        if (path === userPath) {
          return `<?php
namespace App\\Models;

class User
{
    public function getName(): string {}
}
`;
        }

        return `<?php\n// ${path}\n`;
      }),
      searchText,
      workspaceDescriptor: phpWorkspaceDescriptor(),
    });
    await flushAsyncTurns();
    await act(async () => {
      await getWorkbench().setSmartMode("fullSmart");
    });
    await act(async () => {
      await getWorkbench().openFile(fileEntry(controllerPath, "CommentController.php"));
    });

    const completions = getWorkbench().providePhpMethodCompletions(
      controllerSource,
      positionAfter(controllerSource, "$owner->get"),
    );
    await waitForReact(() => {
      expect(searchText).toHaveBeenCalledWith("/workspace-a", "morphMap", 200);
    });

    await act(async () => {
      await getWorkbench().activateWorkspaceTab("/workspace-b");
    });
    await flushAsyncTurns();

    staleMorphMapSearch.resolve([
      {
        column: 19,
        lineNumber: 10,
        lineText: "        Relation::morphMap([",
        path: providerPath,
        relativePath: "app/Providers/AppServiceProvider.php",
      },
    ]);

    await expect(completions).resolves.toEqual([]);
    expect(getWorkbench().workspaceRoot).toBe("/workspace-b");
    expect(providerReadCount).toBe(0);
  });
  it("refreshes Laravel morph map completions after editing service provider files", async () => {
    const controllerPath = "/workspace/app/Http/Controllers/CommentController.php";
    const commentPath = "/workspace/app/Models/Comment.php";
    const postPath = "/workspace/app/Models/Post.php";
    const providerPath = "/workspace/app/Providers/AppServiceProvider.php";
    const userPath = "/workspace/app/Models/User.php";
    const commentModelSource = `<?php
namespace App\\Models;

use Illuminate\\Database\\Eloquent\\Model;
use Illuminate\\Database\\Eloquent\\Relations\\MorphTo;

class Comment extends Model
{
    public function mappedOwner(): MorphTo
    {
        return $this->morphTo();
    }
}
`;
    const controllerSource = `<?php
namespace App\\Http\\Controllers;

use App\\Models\\Comment;

class CommentController
{
    public function show(Comment $comment): void
    {
        $owner = $comment->mappedOwner()->first();
        $owner->get
    }
}
`;
    const userProviderSource = `<?php
namespace App\\Providers;

use App\\Models\\User;
use Illuminate\\Database\\Eloquent\\Relations\\Relation;

class AppServiceProvider
{
    public function boot(): void
    {
        Relation::morphMap([
            'owner' => User::class,
        ]);
    }
}
`;
    const postProviderSource = `<?php
namespace App\\Providers;

use App\\Models\\Post;
use Illuminate\\Database\\Eloquent\\Relations\\Relation;

class AppServiceProvider
{
    public function boot(): void
    {
        Relation::morphMap([
            'owner' => Post::class,
        ]);
    }
}
`;
    const { getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace",
      },
      projectSymbols: [
        {
          column: 7,
          containerName: null,
          fullyQualifiedName: "App\\Models\\Comment",
          kind: "class",
          lineNumber: 6,
          name: "Comment",
          path: commentPath,
          relativePath: "app/Models/Comment.php",
        },
        {
          column: 7,
          containerName: null,
          fullyQualifiedName: "App\\Models\\Post",
          kind: "class",
          lineNumber: 5,
          name: "Post",
          path: postPath,
          relativePath: "app/Models/Post.php",
        },
        {
          column: 7,
          containerName: null,
          fullyQualifiedName: "App\\Models\\User",
          kind: "class",
          lineNumber: 5,
          name: "User",
          path: userPath,
          relativePath: "app/Models/User.php",
        },
      ],
      readTextFile: vi.fn(async (path: string) => {
        if (path === controllerPath) {
          return controllerSource;
        }

        if (path === commentPath) {
          return commentModelSource;
        }

        if (path === providerPath) {
          return userProviderSource;
        }

        if (path === postPath) {
          return `<?php
namespace App\\Models;

class Post
{
    public function getTitle(): string {}
}
`;
        }

        if (path === userPath) {
          return `<?php
namespace App\\Models;

class User
{
    public function getName(): string {}
}
`;
        }

        return `<?php\n// ${path}\n`;
      }),
      searchText: vi.fn(async (_root: string, query: string, _limit: number) =>
        query.includes("morphMap")
          ? [
              {
                column: 19,
                lineText: "        Relation::morphMap([",
                lineNumber: 10,
                path: providerPath,
                relativePath: "app/Providers/AppServiceProvider.php",
              },
            ]
          : [],
      ),
      workspaceDescriptor: phpWorkspaceDescriptor(),
    });
    await flushAsyncTurns();
    await act(async () => {
      await getWorkbench().setSmartMode("fullSmart");
    });
    await act(async () => {
      await getWorkbench().openFile(fileEntry(controllerPath, "CommentController.php"));
    });

    await expect(
      getWorkbench().providePhpMethodCompletions(
        controllerSource,
        positionAfter(controllerSource, "$owner->get"),
      ),
    ).resolves.toEqual([
      {
        declaringClassName: "App\\Models\\User",
        name: "getName",
        parameters: "",
        returnType: "string",
      },
    ]);

    await act(async () => {
      await getWorkbench().openFile(fileEntry(providerPath, "AppServiceProvider.php"));
    });
    act(() => {
      getWorkbench().updateActiveDocument(postProviderSource);
    });
    await act(async () => {
      await getWorkbench().openFile(fileEntry(controllerPath, "CommentController.php"));
    });

    await expect(
      getWorkbench().providePhpMethodCompletions(
        controllerSource,
        positionAfter(controllerSource, "$owner->get"),
      ),
    ).resolves.toEqual([
      {
        declaringClassName: "App\\Models\\Post",
        name: "getTitle",
        parameters: "",
        returnType: "string",
      },
    ]);
  });
  it("opens Laravel relation methods from relation-name strings", async () => {
    const controllerPath = "/workspace/app/Http/Controllers/CommentController.php";
    const commentPath = "/workspace/app/Models/Comment.php";
    const commentModelSource = `<?php
namespace App\\Models;

class Comment
{
    public function parent()
    {
        return $this->belongsTo(self::class, 'parent_id');
    }

    public function children()
    {
        return $this->hasMany(self::class, 'parent_id');
    }
}
`;
    const controllerSource = `<?php
namespace App\\Http\\Controllers;

use App\\Models\\Comment;

class CommentController
{
    public function show(Comment $comment): void
    {
        $comment->load('children');
        $comment->load('children.parent');
        Comment::with('parent')->first();
        Comment::query()->whereHas('children', fn ($query) => $query);
    }
}
`;
    const { getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace",
      },
      readTextFile: vi.fn(async (path: string) => {
        if (path === controllerPath) {
          return controllerSource;
        }

        if (path === commentPath) {
          return commentModelSource;
        }

        return `<?php\n// ${path}\n`;
      }),
      workspaceDescriptor: phpWorkspaceDescriptor(),
    });
    await flushAsyncTurns();
    await act(async () => {
      await getWorkbench().setSmartMode("fullSmart");
    });
    await act(async () => {
      await getWorkbench().openFile(fileEntry(controllerPath, "CommentController.php"));
    });

    act(() => {
      getWorkbench().updateActiveEditorPosition(positionAfter(controllerSource, "'children"));
    });
    await act(async () => {
      await getWorkbench()
        .commands.find((candidate) => candidate.id === "editor.goToDefinition")
        ?.run();
    });

    expect(getWorkbench().activePath).toBe(commentPath);
    expect(getWorkbench().editorRevealTarget).toEqual({
      path: commentPath,
      position: {
        column: 21,
        lineNumber: lineNumberOf(commentModelSource, "children"),
      },
    });

    await act(async () => {
      await getWorkbench().openFile(fileEntry(controllerPath, "CommentController.php"));
    });
    act(() => {
      getWorkbench().updateActiveEditorPosition(positionAfter(controllerSource, "'parent"));
    });
    await act(async () => {
      await getWorkbench()
        .commands.find((candidate) => candidate.id === "editor.goToDefinition")
        ?.run();
    });

    expect(getWorkbench().activePath).toBe(commentPath);
    expect(getWorkbench().editorRevealTarget).toEqual({
      path: commentPath,
      position: {
        column: 21,
        lineNumber: lineNumberOf(commentModelSource, "parent"),
      },
    });

    await act(async () => {
      await getWorkbench().openFile(fileEntry(controllerPath, "CommentController.php"));
    });
    act(() => {
      getWorkbench().updateActiveEditorPosition(
        positionAfter(controllerSource, "whereHas('children"),
      );
    });
    await act(async () => {
      await getWorkbench()
        .commands.find((candidate) => candidate.id === "editor.goToDefinition")
        ?.run();
    });

    expect(getWorkbench().activePath).toBe(commentPath);
    expect(getWorkbench().editorRevealTarget).toEqual({
      path: commentPath,
      position: {
        column: 21,
        lineNumber: lineNumberOf(commentModelSource, "children"),
      },
    });

    await act(async () => {
      await getWorkbench().openFile(fileEntry(controllerPath, "CommentController.php"));
    });
    act(() => {
      getWorkbench().updateActiveEditorPosition(positionAfter(controllerSource, "children.parent"));
    });
    await act(async () => {
      await getWorkbench()
        .commands.find((candidate) => candidate.id === "editor.goToDefinition")
        ?.run();
    });

    expect(getWorkbench().activePath).toBe(commentPath);
    expect(getWorkbench().editorRevealTarget).toEqual({
      path: commentPath,
      position: {
        column: 21,
        lineNumber: lineNumberOf(commentModelSource, "parent"),
      },
    });
  });
  it("stops stale Laravel relation string owner resolution after switching project tabs", async () => {
    const controllerPath = "/workspace-a/app/Http/Controllers/CommentController.php";
    const workspaceACommentPath = "/workspace-a/app/Models/Comment.php";
    const workspaceBCommentPath = "/workspace-b/app/Models/Comment.php";
    const commentModelSource = `<?php
namespace App\\Models;

class Comment
{
    public function parent()
    {
        return $this->belongsTo(self::class, 'parent_id');
    }

    public function children()
    {
        return $this->hasMany(self::class, 'parent_id');
    }
}
`;
    const controllerSource = `<?php
namespace App\\Http\\Controllers;

use App\\Models\\Comment;

class CommentController
{
    public function show(): void
    {
        Comment::with('children.parent')->first();
    }
}
`;
    const staleOwnerRead = createDeferred<string>();
    let workspaceACommentReadCount = 0;
    let workspaceBCommentReadCount = 0;
    const { getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace-a",
        workspaceTabs: ["/workspace-a", "/workspace-b"],
      },
      readTextFile: vi.fn(async (path: string) => {
        if (path === controllerPath) {
          return controllerSource;
        }

        if (path === workspaceACommentPath) {
          workspaceACommentReadCount += 1;
          return staleOwnerRead.promise;
        }

        if (path === workspaceBCommentPath) {
          workspaceBCommentReadCount += 1;
          return commentModelSource;
        }

        return `<?php\n// ${path}\n`;
      }),
      workspaceDescriptor: phpWorkspaceDescriptor(),
    });
    await flushAsyncTurns();
    await act(async () => {
      await getWorkbench().setSmartMode("fullSmart");
    });
    await act(async () => {
      await getWorkbench().openFile(fileEntry(controllerPath, "CommentController.php"));
    });
    act(() => {
      getWorkbench().updateActiveEditorPosition(positionAfter(controllerSource, "children.parent"));
    });

    const command = getWorkbench().commands.find(
      (candidate) => candidate.id === "editor.goToDefinition",
    );
    let commandPromise: Promise<void> = Promise.resolve();
    await act(async () => {
      commandPromise = Promise.resolve(command?.run());
      await Promise.resolve();
    });
    await waitForReact(() => {
      expect(workspaceACommentReadCount).toBe(1);
    });

    await act(async () => {
      await getWorkbench().activateWorkspaceTab("/workspace-b");
    });
    await flushAsyncTurns();

    staleOwnerRead.resolve(commentModelSource);
    await act(async () => {
      await commandPromise;
    });
    await flushAsyncTurns(24);

    expect(getWorkbench().workspaceRoot).toBe("/workspace-b");
    expect(workspaceBCommentReadCount).toBe(0);
    expect(getWorkbench().activePath).not.toBe(workspaceACommentPath);
    expect(getWorkbench().activePath).not.toBe(workspaceBCommentPath);
    expect(getWorkbench().editorRevealTarget).toBeNull();
    expect(getWorkbench().message).not.toBe(
      "No relation method found for App\\Models\\Comment::parent().",
    );
  });
  it("stops stale Laravel relation property owner traversal after switching project tabs", async () => {
    const controllerPath = "/workspace-a/app/Http/Controllers/CommentController.php";
    const workspaceACommentPath = "/workspace-a/app/Models/Comment.php";
    const workspaceBBaseCommentPath = "/workspace-b/app/Models/BaseComment.php";
    const controllerSource = `<?php
namespace App\\Http\\Controllers;

use App\\Models\\Comment;

class CommentController
{
    public function show(): void
    {
        Comment::with('children.parent')->first();
    }
}
`;
    const staleOwnerRead = createDeferred<string>();
    let workspaceACommentReadCount = 0;
    let workspaceBBaseCommentReadCount = 0;
    const { getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace-a",
        workspaceTabs: ["/workspace-a", "/workspace-b"],
      },
      readTextFile: vi.fn(async (path: string) => {
        if (path === controllerPath) {
          return controllerSource;
        }

        if (path === workspaceACommentPath) {
          workspaceACommentReadCount += 1;
          return staleOwnerRead.promise;
        }

        if (path === workspaceBBaseCommentPath) {
          workspaceBBaseCommentReadCount += 1;
          return `<?php
namespace App\\Models;

class BaseComment
{
    public function children()
    {
        return $this->hasMany(Comment::class);
    }
}
`;
        }

        return `<?php\n// ${path}\n`;
      }),
      workspaceDescriptor: phpWorkspaceDescriptor(),
    });
    await flushAsyncTurns();
    await act(async () => {
      await getWorkbench().setSmartMode("fullSmart");
    });
    await act(async () => {
      await getWorkbench().openFile(fileEntry(controllerPath, "CommentController.php"));
    });
    act(() => {
      getWorkbench().updateActiveEditorPosition(positionAfter(controllerSource, "children.parent"));
    });

    const command = getWorkbench().commands.find(
      (candidate) => candidate.id === "editor.goToDefinition",
    );
    let commandPromise: Promise<void> = Promise.resolve();
    await act(async () => {
      commandPromise = Promise.resolve(command?.run());
      await Promise.resolve();
    });
    await waitForReact(() => {
      expect(workspaceACommentReadCount).toBe(1);
    });

    await act(async () => {
      await getWorkbench().activateWorkspaceTab("/workspace-b");
    });
    await flushAsyncTurns();

    staleOwnerRead.resolve(`<?php
namespace App\\Models;

class Comment extends BaseComment
{
}
`);
    await act(async () => {
      await commandPromise;
    });
    await flushAsyncTurns(24);

    expect(getWorkbench().workspaceRoot).toBe("/workspace-b");
    expect(workspaceBBaseCommentReadCount).toBe(0);
    expect(getWorkbench().editorRevealTarget).toBeNull();
  });
  it("opens Laravel relation methods from model property access", async () => {
    const controllerPath = "/workspace/app/Http/Controllers/CommentController.php";
    const commentPath = "/workspace/app/Models/Comment.php";
    const commentModelSource = `<?php
namespace App\\Models;

use Illuminate\\Database\\Eloquent\\Model;

class Comment extends Model
{
    protected $fillable = [
        'content',
    ];

    public function parent()
    {
        return $this->belongsTo(self::class, 'parent_id');
    }

    public function children()
    {
        return $this->hasMany(self::class, 'parent_id');
    }
}
`;
    const controllerSource = `<?php
namespace App\\Http\\Controllers;

use App\\Models\\Comment;

class CommentController
{
    public function show(Comment $comment): void
    {
        echo $comment->parent;
        echo $comment->content;
    }
}
`;
    const { getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace",
      },
      readTextFile: vi.fn(async (path: string) => {
        if (path === controllerPath) {
          return controllerSource;
        }

        if (path === commentPath) {
          return commentModelSource;
        }

        return `<?php\n// ${path}\n`;
      }),
      workspaceDescriptor: phpWorkspaceDescriptor(),
    });
    await flushAsyncTurns();
    await act(async () => {
      await getWorkbench().setSmartMode("fullSmart");
    });
    await act(async () => {
      await getWorkbench().openFile(fileEntry(controllerPath, "CommentController.php"));
    });
    act(() => {
      getWorkbench().updateActiveEditorPosition(
        positionAfter(controllerSource, "$comment->parent"),
      );
    });

    await act(async () => {
      await getWorkbench()
        .commands.find((candidate) => candidate.id === "editor.goToDefinition")
        ?.run();
    });

    expect(getWorkbench().activePath).toBe(commentPath);
    expect(getWorkbench().editorRevealTarget).toEqual({
      path: commentPath,
      position: {
        column: 21,
        lineNumber: lineNumberOf(commentModelSource, "parent"),
      },
    });

    await act(async () => {
      await getWorkbench().openFile(fileEntry(controllerPath, "CommentController.php"));
    });
    act(() => {
      getWorkbench().updateActiveEditorPosition(
        positionAfter(controllerSource, "$comment->content"),
      );
    });

    await act(async () => {
      await getWorkbench()
        .commands.find((candidate) => candidate.id === "editor.goToDefinition")
        ?.run();
    });

    expect(getWorkbench().activePath).toBe(commentPath);
    expect(getWorkbench().editorRevealTarget).toEqual({
      path: commentPath,
      position: {
        column: 10,
        lineNumber: lineNumberOf(commentModelSource, "'content'"),
      },
    });
  });
  it("completes Laravel relation strings from the owning model", async () => {
    const controllerPath = "/workspace/app/Http/Controllers/CommentController.php";
    const attachmentPath = "/workspace/app/Models/Attachment.php";
    const commentPath = "/workspace/app/Models/Comment.php";
    const controllerSource = `<?php
namespace App\\Http\\Controllers;

use App\\Models\\Comment;

class CommentController
{
    public function show(Comment $comment): void
    {
        $comment->load('chi');
        $comment->load('children.pa');
        $comment->load('attachments.own');
        $comment->load(relations: 'child');
        Comment::with('par')->first();
        Comment::query()->whereHas('att', fn ($query) => $query);
        Comment::query()->whereHas(relation: 'attach', callback: fn ($query) => $query);
        Comment::query()->whereHas(callback: fn ($query) => $query, relation: 'attach');
        Comment::query()->whereRelation('children', 'is_vis', true);
    }
}
`;
    const commentModelSource = `<?php
namespace App\\Models;

use Illuminate\\Database\\Eloquent\\Model;

class Comment extends Model
{
    public function children()
    {
        return $this->hasMany(self::class, 'parent_id');
    }

    public function parent()
    {
        return $this->belongsTo(self::class, 'parent_id');
    }

    public function attachments()
    {
        return $this->hasMany(Attachment::class);
    }

    public function content(): string
    {
        return '';
    }
}
`;
    const attachmentModelSource = `<?php
namespace App\\Models;

use Illuminate\\Database\\Eloquent\\Model;

class Attachment extends Model
{
    public function owner()
    {
        return $this->belongsTo(User::class);
    }
}
`;
    const { getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace",
      },
      readTextFile: vi.fn(async (path: string) => {
        if (path === controllerPath) {
          return controllerSource;
        }

        if (path === commentPath) {
          return commentModelSource;
        }

        if (path === attachmentPath) {
          return attachmentModelSource;
        }

        return `<?php\n// ${path}\n`;
      }),
      workspaceDescriptor: phpWorkspaceDescriptor(),
    });
    await flushAsyncTurns();
    await act(async () => {
      await getWorkbench().openFile(fileEntry(controllerPath, "CommentController.php"));
    });

    await expect(
      getWorkbench().providePhpMethodCompletions(
        controllerSource,
        positionAfter(controllerSource, "$comment->load('chi"),
      ),
    ).resolves.toEqual([
      {
        declaringClassName: "App\\Models\\Comment",
        kind: "relation",
        name: "children",
        parameters: "",
        returnType: "App\\Models\\Comment",
      },
    ]);
    await expect(
      getWorkbench().providePhpMethodCompletions(
        controllerSource,
        positionAfter(controllerSource, "$comment->load('attachments.own"),
      ),
    ).resolves.toEqual([
      {
        declaringClassName: "App\\Models\\Attachment",
        kind: "relation",
        name: "owner",
        parameters: "",
        returnType: "App\\Models\\User",
      },
    ]);
    await expect(
      getWorkbench().providePhpMethodCompletions(
        controllerSource,
        positionAfter(controllerSource, "load(relations: 'child"),
      ),
    ).resolves.toEqual([
      {
        declaringClassName: "App\\Models\\Comment",
        kind: "relation",
        name: "children",
        parameters: "",
        returnType: "App\\Models\\Comment",
      },
    ]);
    await expect(
      getWorkbench().providePhpMethodCompletions(
        controllerSource,
        positionAfter(controllerSource, "Comment::with('par"),
      ),
    ).resolves.toEqual([
      {
        declaringClassName: "App\\Models\\Comment",
        kind: "relation",
        name: "parent",
        parameters: "",
        returnType: "App\\Models\\Comment",
      },
    ]);
    await expect(
      getWorkbench().providePhpMethodCompletions(
        controllerSource,
        positionAfter(controllerSource, "$comment->load('children.pa"),
      ),
    ).resolves.toEqual([
      {
        declaringClassName: "App\\Models\\Comment",
        kind: "relation",
        name: "parent",
        parameters: "",
        returnType: "App\\Models\\Comment",
      },
    ]);
    await expect(
      getWorkbench().providePhpMethodCompletions(
        controllerSource,
        positionAfter(controllerSource, "whereHas('att"),
      ),
    ).resolves.toEqual([
      {
        declaringClassName: "App\\Models\\Comment",
        kind: "relation",
        name: "attachments",
        parameters: "",
        returnType: "App\\Models\\Attachment",
      },
    ]);
    await expect(
      getWorkbench().providePhpMethodCompletions(
        controllerSource,
        positionAfter(controllerSource, "whereHas(relation: 'attach"),
      ),
    ).resolves.toEqual([
      {
        declaringClassName: "App\\Models\\Comment",
        kind: "relation",
        name: "attachments",
        parameters: "",
        returnType: "App\\Models\\Attachment",
      },
    ]);
    await expect(
      getWorkbench().providePhpMethodCompletions(
        controllerSource,
        positionAfter(
          controllerSource,
          "whereHas(callback: fn ($query) => $query, relation: 'attach",
        ),
      ),
    ).resolves.toEqual([
      {
        declaringClassName: "App\\Models\\Comment",
        kind: "relation",
        name: "attachments",
        parameters: "",
        returnType: "App\\Models\\Attachment",
      },
    ]);
    await expect(
      getWorkbench().providePhpMethodCompletions(
        controllerSource,
        positionAfter(controllerSource, "whereRelation('children', 'is_vis"),
      ),
    ).resolves.toEqual([]);
  });
  it("stops stale Laravel relation string completion traversal after switching project tabs", async () => {
    const controllerPath = "/workspace-a/app/Http/Controllers/CommentController.php";
    const workspaceACommentPath = "/workspace-a/app/Models/Comment.php";
    const workspaceBBaseCommentPath = "/workspace-b/app/Models/BaseComment.php";
    const controllerSource = `<?php
namespace App\\Http\\Controllers;

use App\\Models\\Comment;

class CommentController
{
    public function show(): void
    {
        Comment::with('par')->first();
    }
}
`;
    const commentModelSource = `<?php
namespace App\\Models;

class Comment extends BaseComment
{
    public function parent()
    {
        return $this->belongsTo(self::class, 'parent_id');
    }
}
`;
    const staleCommentRead = createDeferred<string>();
    let workspaceACommentReadCount = 0;
    let workspaceBBaseCommentReadCount = 0;
    const { getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace-a",
        workspaceTabs: ["/workspace-a", "/workspace-b"],
      },
      readTextFile: vi.fn(async (path: string) => {
        if (path === controllerPath) {
          return controllerSource;
        }

        if (path === workspaceACommentPath) {
          workspaceACommentReadCount += 1;
          return staleCommentRead.promise;
        }

        if (path === workspaceBBaseCommentPath) {
          workspaceBBaseCommentReadCount += 1;
          return "<?php\nnamespace App\\Models;\nclass BaseComment {}\n";
        }

        return `<?php\n// ${path}\n`;
      }),
      workspaceDescriptor: phpWorkspaceDescriptor(),
    });
    await flushAsyncTurns();
    await act(async () => {
      await getWorkbench().openFile(fileEntry(controllerPath, "CommentController.php"));
    });

    let completionsPromise: ReturnType<WorkbenchController["providePhpMethodCompletions"]> =
      Promise.resolve([]);
    await act(async () => {
      completionsPromise = getWorkbench().providePhpMethodCompletions(
        controllerSource,
        positionAfter(controllerSource, "Comment::with('par"),
      );
      await Promise.resolve();
    });
    await waitForReact(() => {
      expect(workspaceACommentReadCount).toBe(1);
    });

    await act(async () => {
      await getWorkbench().activateWorkspaceTab("/workspace-b");
    });
    await flushAsyncTurns();

    staleCommentRead.resolve(commentModelSource);

    await expect(completionsPromise).resolves.toEqual([]);
    await flushAsyncTurns(24);

    expect(getWorkbench().workspaceRoot).toBe("/workspace-b");
    expect(workspaceBBaseCommentReadCount).toBe(0);
  });
  it("opens inherited Laravel model methods from repository model assignments", async () => {
    const controllerPath = "/workspace/app/Http/Controllers/CommentController.php";
    const repositoryInterfacePath =
      "/workspace/app/Kontentino/src/Communication/Interfaces/CommentRepositoryInterface.php";
    const commentPath = "/workspace/app/Kontentino/src/Communication/Models/Comment.php";
    const softDeletesPath =
      "/workspace/vendor/laravel/framework/src/Illuminate/Database/Eloquent/SoftDeletes.php";
    const controllerSource = `<?php
namespace App\\Http\\Controllers\\communication;

use App\\Http\\Requests\\GetOneCommentRequest;
use Kontentino\\Communication\\Interfaces\\CommentRepositoryInterface;

class CommentController
{
    public function __construct(
        protected readonly CommentRepositoryInterface $commentRepository,
    ) {}

    public function getOne(GetOneCommentRequest $request): void
    {
        $comment = $this->commentRepository->findOrFail($request->getCommentId());
        $comment->forceDelete();
    }
}
`;
    const { getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace",
      },
      projectSymbols: [
        {
          column: 11,
          containerName: null,
          fullyQualifiedName: "Kontentino\\Communication\\Interfaces\\CommentRepositoryInterface",
          kind: "interface",
          lineNumber: 7,
          name: "CommentRepositoryInterface",
          path: repositoryInterfacePath,
          relativePath:
            "app/Kontentino/src/Communication/Interfaces/CommentRepositoryInterface.php",
        },
        {
          column: 7,
          containerName: null,
          fullyQualifiedName: "Kontentino\\Communication\\Models\\Comment",
          kind: "class",
          lineNumber: 7,
          name: "Comment",
          path: commentPath,
          relativePath: "app/Kontentino/src/Communication/Models/Comment.php",
        },
      ],
      readTextFile: vi.fn(async (path: string) => {
        if (path === controllerPath) {
          return controllerSource;
        }

        if (path === repositoryInterfacePath) {
          return `<?php
namespace Kontentino\\Communication\\Interfaces;

use Kontentino\\Communication\\Models\\Comment;

interface CommentRepositoryInterface
{
    public function findOrFail(int $id): Comment;
}
`;
        }

        if (path === commentPath) {
          return `<?php
namespace Kontentino\\Communication\\Models;

use Illuminate\\Database\\Eloquent\\SoftDeletes;

class Comment
{
    use SoftDeletes;
}
`;
        }

        if (path === softDeletesPath) {
          return `<?php
namespace Illuminate\\Database\\Eloquent;

trait SoftDeletes
{
    public function forceDelete(): bool
    {
    }
}
`;
        }

        return `<?php\n// ${path}\n`;
      }),
      workspaceDescriptor: phpWorkspaceDescriptor(),
    });
    await flushAsyncTurns();
    await act(async () => {
      await getWorkbench().setSmartMode("fullSmart");
    });

    await act(async () => {
      await getWorkbench().openFile(fileEntry(controllerPath, "CommentController.php"));
    });
    await expect(
      getWorkbench().providePhpMethodCompletions(
        controllerSource,
        positionAfter(controllerSource, "$comment->force"),
      ),
    ).resolves.toEqual([
      {
        declaringClassName: "Illuminate\\Database\\Eloquent\\SoftDeletes",
        name: "forceDelete",
        parameters: "",
        returnType: "bool",
      },
    ]);
    act(() => {
      getWorkbench().updateActiveEditorPosition(
        positionAfter(controllerSource, "$comment->forceDelete"),
      );
    });

    await act(async () => {
      await getWorkbench()
        .commands.find((candidate) => candidate.id === "editor.goToDefinition")
        ?.run();
    });

    expect(getWorkbench().activePath).toBe(softDeletesPath);
    expect(getWorkbench().editorRevealTarget).toEqual({
      path: softDeletesPath,
      position: {
        column: 21,
        lineNumber: 6,
      },
    });
  });
  it("suppresses trait host-method diagnostics when an indexed host provides the method", async () => {
    let diagnosticsListener: ((event: LanguageServerDiagnosticEvent) => void) | null = null;
    const commentPath = "/workspace/app/Kontentino/src/Communication/Models/Comment.php";
    const modelPath =
      "/workspace/vendor/laravel/framework/src/Illuminate/Database/Eloquent/Model.php";
    const softDeletesPath =
      "/workspace/vendor/laravel/framework/src/Illuminate/Database/Eloquent/SoftDeletes.php";
    const runningStatus: LanguageServerRuntimeStatus = {
      capabilities: emptyLanguageServerCapabilities(),
      kind: "running",
      sessionId: 9,
    };
    const diagnosticsGateway: LanguageServerDiagnosticsGateway = {
      subscribeDiagnostics: vi.fn(async (listener) => {
        diagnosticsListener = listener;
        return () => undefined;
      }),
    };
    const { getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace",
      },
      languageServerDiagnosticsGateway: diagnosticsGateway,
      languageServerPlan: {
        command: {
          args: ["language-server"],
          executable: "phpactor",
          workingDirectory: "/workspace",
        },
        initializeRequest: null,
        message: "PHPactor ready",
        provider: "phpactor",
        status: "ready",
      },
      readTextFile: vi.fn(async (path: string) => {
        if (path === commentPath) {
          return `<?php
namespace Kontentino\\Communication\\Models;

use Illuminate\\Database\\Eloquent\\Model;
use Illuminate\\Database\\Eloquent\\SoftDeletes;

class Comment extends Model
{
    use SoftDeletes;
}
`;
        }

        if (path === modelPath) {
          return `<?php
namespace Illuminate\\Database\\Eloquent;

class Model
{
    protected function fireModelEvent(string $event)
    {
    }
}
`;
        }

        if (path === softDeletesPath) {
          return `<?php
namespace Illuminate\\Database\\Eloquent;

trait SoftDeletes
{
    public function forceDelete()
    {
        if ($this->fireModelEvent('forceDeleting') === false) {
            return false;
        }
    }
}
`;
        }

        return `<?php\n// ${path}\n`;
      }),
      runtimeStatus: runningStatus,
      searchFiles: vi.fn(async (_root, query) =>
        query === "Comment.php"
          ? [
              {
                name: "Comment.php",
                path: commentPath,
                relativePath: "app/Kontentino/src/Communication/Models/Comment.php",
              },
            ]
          : [],
      ),
      searchText: vi.fn(async () => [
        {
          column: 5,
          lineNumber: 9,
          lineText: "    use SoftDeletes;",
          path: commentPath,
          relativePath: "app/Kontentino/src/Communication/Models/Comment.php",
        },
      ]),
      workspaceDescriptor: phpWorkspaceDescriptor(),
    });
    await flushAsyncTurns(24);
    await act(async () => {
      await getWorkbench().setSmartMode("fullSmart");
    });
    await flushAsyncTurns(24);

    expect(getWorkbench().languageServerRuntimeStatus).toEqual({
      ...runningStatus,
      rootPath: "/workspace",
    });
    expect(diagnosticsListener).not.toBeNull();

    act(() => {
      diagnosticsListener?.({
        diagnostics: [
          {
            character: 20,
            line: 7,
            message:
              'Method "fireModelEvent" does not exist on trait "Illuminate\\Database\\Eloquent\\SoftDeletes"',
            severity: "error",
            source: "phpactor",
          },
        ],
        rootPath: "/workspace",
        sessionId: runningStatus.sessionId,
        uri: fileUriFromPath(softDeletesPath),
        version: null,
      });
    });
    await flushAsyncTurns();

    expect(getWorkbench().languageServerDiagnosticsByPath[softDeletesPath]).toBeUndefined();
  });
  it("stops stale PHP trait host-method search after switching project tabs", async () => {
    let diagnosticsListener: ((event: LanguageServerDiagnosticEvent) => void) | null = null;
    const commentPath = "/workspace-a/app/Models/Comment.php";
    const softDeletesPath =
      "/workspace-a/vendor/laravel/framework/src/Illuminate/Database/Eloquent/SoftDeletes.php";
    const softDeletesSource = `<?php
namespace Illuminate\\Database\\Eloquent;

trait SoftDeletes
{
    public function forceDelete()
    {
        if ($this->fireModelEvent('forceDeleting') === false) {
            return false;
        }
    }
}
`;
    const runningStatus: LanguageServerRuntimeStatus = {
      capabilities: emptyLanguageServerCapabilities(),
      kind: "running",
      sessionId: 40,
    };
    const diagnosticsGateway: LanguageServerDiagnosticsGateway = {
      subscribeDiagnostics: vi.fn(async (listener) => {
        diagnosticsListener = listener;
        return () => undefined;
      }),
    };
    const staleTraitHostSearch = createDeferred<TextSearchResult[]>();
    const searchText = vi.fn(async (_root, query) =>
      query === "SoftDeletes" ? staleTraitHostSearch.promise : [],
    );
    let commentReadCount = 0;
    const { getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace-a",
        workspaceTabs: ["/workspace-a", "/workspace-b"],
      },
      languageServerDiagnosticsGateway: diagnosticsGateway,
      languageServerPlan: phpactorLanguageServerPlan(),
      readTextFile: vi.fn(async (path: string) => {
        if (path === softDeletesPath) {
          return softDeletesSource;
        }

        if (path === commentPath) {
          commentReadCount += 1;
          return `<?php
namespace App\\Models;

use Illuminate\\Database\\Eloquent\\SoftDeletes;

class Comment
{
    use SoftDeletes;

    protected function fireModelEvent(string $event): void {}
}
`;
        }

        return `<?php\n// ${path}\n`;
      }),
      runtimeStatus: runningStatus,
      searchText,
      workspaceDescriptor: phpWorkspaceDescriptor(),
    });
    await flushAsyncTurns(24);
    await act(async () => {
      await getWorkbench().setSmartMode("fullSmart");
    });
    await flushAsyncTurns(24);

    expect(diagnosticsListener).not.toBeNull();

    act(() => {
      diagnosticsListener?.({
        diagnostics: [
          {
            character: 20,
            line: lineNumberOf(softDeletesSource, "fireModelEvent") - 1,
            message:
              'Method "fireModelEvent" does not exist on trait "Illuminate\\Database\\Eloquent\\SoftDeletes"',
            severity: "error",
            source: "phpactor",
          },
        ],
        rootPath: "/workspace-a",
        sessionId: runningStatus.sessionId,
        uri: fileUriFromPath(softDeletesPath),
        version: null,
      });
    });
    await waitForReact(() => {
      expect(searchText).toHaveBeenCalledWith("/workspace-a", "SoftDeletes", 200);
    });

    await act(async () => {
      await getWorkbench().activateWorkspaceTab("/workspace-b");
    });
    await flushAsyncTurns();

    staleTraitHostSearch.resolve([
      {
        column: 5,
        lineNumber: 8,
        lineText: "    use SoftDeletes;",
        path: commentPath,
        relativePath: "app/Models/Comment.php",
      },
    ]);
    await flushAsyncTurns(24);

    expect(getWorkbench().workspaceRoot).toBe("/workspace-b");
    expect(commentReadCount).toBe(0);
  });
  it("ignores stale PHP diagnostic filter errors after switching project tabs", async () => {
    let diagnosticsListener: ((event: LanguageServerDiagnosticEvent) => void) | null = null;
    const softDeletesPath =
      "/workspace-a/vendor/laravel/framework/src/Illuminate/Database/Eloquent/SoftDeletes.php";
    const softDeletesSource = `<?php
namespace Illuminate\\Database\\Eloquent;

trait SoftDeletes
{
    public function forceDelete()
    {
        if ($this->fireModelEvent('forceDeleting') === false) {
            return false;
        }
    }
}
`;
    const runningStatus: LanguageServerRuntimeStatus = {
      capabilities: emptyLanguageServerCapabilities(),
      kind: "running",
      sessionId: 41,
    };
    const diagnosticsGateway: LanguageServerDiagnosticsGateway = {
      subscribeDiagnostics: vi.fn(async (listener) => {
        diagnosticsListener = listener;
        return () => undefined;
      }),
    };
    const staleTraitHostSearch = createDeferred<TextSearchResult[]>();
    const searchText = vi.fn(async (_root, query) =>
      query === "SoftDeletes" ? staleTraitHostSearch.promise : [],
    );
    const { getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace-a",
        workspaceTabs: ["/workspace-a", "/workspace-b"],
      },
      languageServerDiagnosticsGateway: diagnosticsGateway,
      languageServerPlan: phpactorLanguageServerPlan(),
      readTextFile: vi.fn(async (path: string) => {
        if (path === softDeletesPath) {
          return softDeletesSource;
        }

        return `<?php\n// ${path}\n`;
      }),
      runtimeStatus: runningStatus,
      searchText,
      workspaceDescriptor: phpWorkspaceDescriptor(),
    });
    await flushAsyncTurns(24);
    await act(async () => {
      await getWorkbench().setSmartMode("fullSmart");
    });
    await flushAsyncTurns(24);

    expect(diagnosticsListener).not.toBeNull();

    act(() => {
      diagnosticsListener?.({
        diagnostics: [
          {
            character: 20,
            line: lineNumberOf(softDeletesSource, "fireModelEvent") - 1,
            message:
              'Method "fireModelEvent" does not exist on trait "Illuminate\\Database\\Eloquent\\SoftDeletes"',
            severity: "error",
            source: "phpactor",
          },
        ],
        rootPath: "/workspace-a",
        sessionId: runningStatus.sessionId,
        uri: fileUriFromPath(softDeletesPath),
        version: null,
      });
    });
    await waitForReact(() => {
      expect(searchText).toHaveBeenCalledWith("/workspace-a", "SoftDeletes", 200);
    });

    await act(async () => {
      await getWorkbench().activateWorkspaceTab("/workspace-b");
    });
    await flushAsyncTurns();

    staleTraitHostSearch.reject(new Error("stale diagnostic filter"));
    await flushAsyncTurns(24);

    expect(getWorkbench().workspaceRoot).toBe("/workspace-b");
    expect(
      getWorkbench().notices.some(
        (notice) =>
          notice.source === "Language Server" && notice.message.includes("stale diagnostic filter"),
      ),
    ).toBe(false);
  });
  it("keeps trait host-method diagnostics when no host hierarchy provides the method", async () => {
    let diagnosticsListener: ((event: LanguageServerDiagnosticEvent) => void) | null = null;
    const commentPath = "/workspace/app/Models/Comment.php";
    const softDeletesPath =
      "/workspace/vendor/laravel/framework/src/Illuminate/Database/Eloquent/SoftDeletes.php";
    const softDeletesSource = `<?php
namespace Illuminate\\Database\\Eloquent;

trait SoftDeletes
{
    public function forceDelete()
    {
        if ($this->fireModelEvent('forceDeleting') === false) {
            return false;
        }
    }
}
`;
    const diagnostic = {
      character: 20,
      line: lineNumberOf(softDeletesSource, "fireModelEvent") - 1,
      message:
        'Method "fireModelEvent" does not exist on trait "Illuminate\\Database\\Eloquent\\SoftDeletes"',
      severity: "error" as const,
      source: "phpactor",
    };
    const runningStatus: LanguageServerRuntimeStatus = {
      capabilities: emptyLanguageServerCapabilities(),
      kind: "running",
      sessionId: 19,
    };
    const diagnosticsGateway: LanguageServerDiagnosticsGateway = {
      subscribeDiagnostics: vi.fn(async (listener) => {
        diagnosticsListener = listener;
        return () => undefined;
      }),
    };
    const { getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace",
      },
      languageServerDiagnosticsGateway: diagnosticsGateway,
      languageServerPlan: phpactorLanguageServerPlan(),
      readTextFile: vi.fn(async (path: string) => {
        if (path === commentPath) {
          return `<?php
namespace App\\Models;

use Illuminate\\Database\\Eloquent\\SoftDeletes;

class Comment
{
    use SoftDeletes;
}
`;
        }

        if (path === softDeletesPath) {
          return softDeletesSource;
        }

        return `<?php\n// ${path}\n`;
      }),
      runtimeStatus: runningStatus,
      searchText: vi.fn(async (_root, query) =>
        query === "SoftDeletes"
          ? [
              {
                column: 5,
                lineNumber: 8,
                lineText: "    use SoftDeletes;",
                path: commentPath,
                relativePath: "app/Models/Comment.php",
              },
            ]
          : [],
      ),
      workspaceDescriptor: phpWorkspaceDescriptor(),
    });
    await flushAsyncTurns(24);
    await act(async () => {
      await getWorkbench().setSmartMode("fullSmart");
    });
    await flushAsyncTurns(24);

    expect(diagnosticsListener).not.toBeNull();

    act(() => {
      diagnosticsListener?.({
        diagnostics: [diagnostic],
        rootPath: "/workspace",
        sessionId: runningStatus.sessionId,
        uri: fileUriFromPath(softDeletesPath),
        version: null,
      });
    });
    await flushAsyncTurns();

    expect(getWorkbench().languageServerDiagnosticsByPath[softDeletesPath]).toEqual([diagnostic]);
  });
  it("suppresses app trait host-method diagnostics per confirmed method", async () => {
    let diagnosticsListener: ((event: LanguageServerDiagnosticEvent) => void) | null = null;
    const commentPath = "/workspace/app/Models/Comment.php";
    const baseModelPath = "/workspace/app/Models/BaseModel.php";
    const dispatchesEventsPath = "/workspace/app/Models/Concerns/DispatchesEvents.php";
    const dispatchesEventsSource = `<?php
namespace App\\Models\\Concerns;

trait DispatchesEvents
{
    public function dispatchSaved(): void
    {
        $this->knownHostHook();
        $this->missingHostHook();
    }
}
`;
    const missingDiagnostic = {
      character: 15,
      line: lineNumberOf(dispatchesEventsSource, "missingHostHook") - 1,
      message:
        'Method "missingHostHook" does not exist on trait "App\\Models\\Concerns\\DispatchesEvents"',
      severity: "error" as const,
      source: "phpactor",
    };
    const runningStatus: LanguageServerRuntimeStatus = {
      capabilities: emptyLanguageServerCapabilities(),
      kind: "running",
      sessionId: 23,
    };
    const diagnosticsGateway: LanguageServerDiagnosticsGateway = {
      subscribeDiagnostics: vi.fn(async (listener) => {
        diagnosticsListener = listener;
        return () => undefined;
      }),
    };
    const { getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace",
      },
      languageServerDiagnosticsGateway: diagnosticsGateway,
      languageServerPlan: phpactorLanguageServerPlan(),
      readTextFile: vi.fn(async (path: string) => {
        if (path === commentPath) {
          return `<?php
namespace App\\Models;

use App\\Models\\Concerns\\DispatchesEvents;

class Comment extends BaseModel
{
    use DispatchesEvents;
}
`;
        }

        if (path === baseModelPath) {
          return `<?php
namespace App\\Models;

class BaseModel
{
    protected function knownHostHook(): void
    {
    }
}
`;
        }

        if (path === dispatchesEventsPath) {
          return dispatchesEventsSource;
        }

        return `<?php\n// ${path}\n`;
      }),
      runtimeStatus: runningStatus,
      searchText: vi.fn(async (_root, query) =>
        query === "DispatchesEvents"
          ? [
              {
                column: 5,
                lineNumber: 8,
                lineText: "    use DispatchesEvents;",
                path: commentPath,
                relativePath: "app/Models/Comment.php",
              },
            ]
          : [],
      ),
      workspaceDescriptor: phpWorkspaceDescriptor(),
    });
    await flushAsyncTurns(24);
    await act(async () => {
      await getWorkbench().setSmartMode("fullSmart");
    });
    await flushAsyncTurns(24);

    expect(diagnosticsListener).not.toBeNull();

    act(() => {
      diagnosticsListener?.({
        diagnostics: [
          {
            character: 15,
            line: lineNumberOf(dispatchesEventsSource, "knownHostHook") - 1,
            message:
              'Method "knownHostHook" does not exist on trait "App\\Models\\Concerns\\DispatchesEvents"',
            severity: "error",
            source: "phpactor",
          },
          missingDiagnostic,
        ],
        rootPath: "/workspace",
        sessionId: runningStatus.sessionId,
        uri: fileUriFromPath(dispatchesEventsPath),
        version: null,
      });
    });
    await flushAsyncTurns();

    expect(getWorkbench().languageServerDiagnosticsByPath[dispatchesEventsPath]).toEqual([
      missingDiagnostic,
    ]);
  });
  it("suppresses trait host-property diagnostics when a Laravel model host exposes the property", async () => {
    let diagnosticsListener: ((event: LanguageServerDiagnosticEvent) => void) | null = null;
    const commentPath = "/workspace/app/Models/Comment.php";
    const usesConnectionNamePath = "/workspace/app/Models/Concerns/UsesConnectionName.php";
    const usesConnectionNameSource = `<?php
namespace App\\Models\\Concerns;

trait UsesConnectionName
{
    public function connectionName(): mixed
    {
        return $this->connectionName;
    }

    public function missingConnectionName(): mixed
    {
        return $this->missingConnectionName;
    }
}
`;
    const missingDiagnostic = {
      character: 22,
      line: lineNumberOf(usesConnectionNameSource, "$this->missingConnectionName") - 1,
      message:
        'Property "$missingConnectionName" does not exist on trait "App\\Models\\Concerns\\UsesConnectionName"',
      severity: "error" as const,
      source: "phpactor",
    };
    const runningStatus: LanguageServerRuntimeStatus = {
      capabilities: emptyLanguageServerCapabilities(),
      kind: "running",
      sessionId: 24,
    };
    const diagnosticsGateway: LanguageServerDiagnosticsGateway = {
      subscribeDiagnostics: vi.fn(async (listener) => {
        diagnosticsListener = listener;
        return () => undefined;
      }),
    };
    const { getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace",
      },
      languageServerDiagnosticsGateway: diagnosticsGateway,
      languageServerPlan: phpactorLanguageServerPlan(),
      readTextFile: vi.fn(async (path: string) => {
        if (path === commentPath) {
          return `<?php
namespace App\\Models;

use App\\Models\\Concerns\\UsesConnectionName;
use Illuminate\\Database\\Eloquent\\Model;

class Comment extends Model
{
    use UsesConnectionName;

    protected $fillable = [
        'connectionName',
    ];
}
`;
        }

        if (path === usesConnectionNamePath) {
          return usesConnectionNameSource;
        }

        return `<?php\n// ${path}\n`;
      }),
      runtimeStatus: runningStatus,
      searchText: vi.fn(async (_root, query) =>
        query === "UsesConnectionName"
          ? [
              {
                column: 5,
                lineNumber: 9,
                lineText: "    use UsesConnectionName;",
                path: commentPath,
                relativePath: "app/Models/Comment.php",
              },
            ]
          : [],
      ),
      workspaceDescriptor: phpWorkspaceDescriptor(),
    });
    await flushAsyncTurns(24);
    await act(async () => {
      await getWorkbench().setSmartMode("fullSmart");
    });
    await flushAsyncTurns(24);

    expect(diagnosticsListener).not.toBeNull();

    act(() => {
      diagnosticsListener?.({
        diagnostics: [
          {
            character: 22,
            line: lineNumberOf(usesConnectionNameSource, "$this->connectionName") - 1,
            message:
              'Property "$connectionName" does not exist on trait "App\\Models\\Concerns\\UsesConnectionName"',
            severity: "error",
            source: "phpactor",
          },
          missingDiagnostic,
        ],
        rootPath: "/workspace",
        sessionId: runningStatus.sessionId,
        uri: fileUriFromPath(usesConnectionNamePath),
        version: null,
      });
    });
    await flushAsyncTurns();

    expect(getWorkbench().languageServerDiagnosticsByPath[usesConnectionNamePath]).toEqual([
      missingDiagnostic,
    ]);
  });
  it("stops stale PHP trait host-property search after switching project tabs", async () => {
    let diagnosticsListener: ((event: LanguageServerDiagnosticEvent) => void) | null = null;
    const commentPath = "/workspace-a/app/Models/Comment.php";
    const usesConnectionNamePath = "/workspace-a/app/Models/Concerns/UsesConnectionName.php";
    const usesConnectionNameSource = `<?php
namespace App\\Models\\Concerns;

trait UsesConnectionName
{
    public function connectionName(): mixed
    {
        return $this->connectionName;
    }
}
`;
    const runningStatus: LanguageServerRuntimeStatus = {
      capabilities: emptyLanguageServerCapabilities(),
      kind: "running",
      sessionId: 41,
    };
    const diagnosticsGateway: LanguageServerDiagnosticsGateway = {
      subscribeDiagnostics: vi.fn(async (listener) => {
        diagnosticsListener = listener;
        return () => undefined;
      }),
    };
    const staleTraitHostSearch = createDeferred<TextSearchResult[]>();
    const searchText = vi.fn(async (_root, query) =>
      query === "UsesConnectionName" ? staleTraitHostSearch.promise : [],
    );
    let commentReadCount = 0;
    const { getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace-a",
        workspaceTabs: ["/workspace-a", "/workspace-b"],
      },
      languageServerDiagnosticsGateway: diagnosticsGateway,
      languageServerPlan: phpactorLanguageServerPlan(),
      readTextFile: vi.fn(async (path: string) => {
        if (path === usesConnectionNamePath) {
          return usesConnectionNameSource;
        }

        if (path === commentPath) {
          commentReadCount += 1;
          return `<?php
namespace App\\Models;

use App\\Models\\Concerns\\UsesConnectionName;

class Comment
{
    use UsesConnectionName;

    protected $fillable = [
        'connectionName',
    ];
}
`;
        }

        return `<?php\n// ${path}\n`;
      }),
      runtimeStatus: runningStatus,
      searchText,
      workspaceDescriptor: phpWorkspaceDescriptor(),
    });
    await flushAsyncTurns(24);
    await act(async () => {
      await getWorkbench().setSmartMode("fullSmart");
    });
    await flushAsyncTurns(24);

    expect(diagnosticsListener).not.toBeNull();

    act(() => {
      diagnosticsListener?.({
        diagnostics: [
          {
            character: 22,
            line: lineNumberOf(usesConnectionNameSource, "$this->connectionName") - 1,
            message:
              'Property "$connectionName" does not exist on trait "App\\Models\\Concerns\\UsesConnectionName"',
            severity: "error",
            source: "phpactor",
          },
        ],
        rootPath: "/workspace-a",
        sessionId: runningStatus.sessionId,
        uri: fileUriFromPath(usesConnectionNamePath),
        version: null,
      });
    });
    await waitForReact(() => {
      expect(searchText).toHaveBeenCalledWith("/workspace-a", "UsesConnectionName", 200);
    });

    await act(async () => {
      await getWorkbench().activateWorkspaceTab("/workspace-b");
    });
    await flushAsyncTurns();

    staleTraitHostSearch.resolve([
      {
        column: 5,
        lineNumber: 8,
        lineText: "    use UsesConnectionName;",
        path: commentPath,
        relativePath: "app/Models/Comment.php",
      },
    ]);
    await flushAsyncTurns(24);

    expect(getWorkbench().workspaceRoot).toBe("/workspace-b");
    expect(commentReadCount).toBe(0);
  });
  it("suppresses Laravel model attribute property diagnostics only when the property exists", async () => {
    let diagnosticsListener: ((event: LanguageServerDiagnosticEvent) => void) | null = null;
    const controllerPath = "/workspace/app/Http/Controllers/CommentController.php";
    const commentPath = "/workspace/app/Models/Comment.php";
    const controllerSource = `<?php
namespace App\\Http\\Controllers;

use App\\Models\\Comment;

class CommentController
{
    public function show(): void
    {
        $comment = Comment::query()->first();
        echo $comment->content;
        echo $comment->missing;
    }
}
`;
    const missingDiagnostic = {
      character: 23,
      line: lineNumberOf(controllerSource, "$comment->missing") - 1,
      message: 'Property "$missing" does not exist on class "App\\Models\\Comment"',
      severity: "error" as const,
      source: "phpactor",
    };
    const runningStatus: LanguageServerRuntimeStatus = {
      capabilities: emptyLanguageServerCapabilities(),
      kind: "running",
      sessionId: 28,
    };
    const diagnosticsGateway: LanguageServerDiagnosticsGateway = {
      subscribeDiagnostics: vi.fn(async (listener) => {
        diagnosticsListener = listener;
        return () => undefined;
      }),
    };
    const { getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace",
      },
      languageServerDiagnosticsGateway: diagnosticsGateway,
      languageServerPlan: phpactorLanguageServerPlan(),
      readTextFile: vi.fn(async (path: string) => {
        if (path === controllerPath) {
          return controllerSource;
        }

        if (path === commentPath) {
          return `<?php
namespace App\\Models;

use Illuminate\\Database\\Eloquent\\Model;

class Comment extends Model
{
    protected $fillable = [
        'content',
    ];
}
`;
        }

        return `<?php\n// ${path}\n`;
      }),
      runtimeStatus: runningStatus,
      workspaceDescriptor: phpWorkspaceDescriptor(),
    });
    await flushAsyncTurns(24);
    await act(async () => {
      await getWorkbench().setSmartMode("fullSmart");
    });
    await flushAsyncTurns(24);

    expect(diagnosticsListener).not.toBeNull();

    act(() => {
      diagnosticsListener?.({
        diagnostics: [
          {
            character: 23,
            line: lineNumberOf(controllerSource, "$comment->content") - 1,
            message: 'Property "$content" does not exist on class "App\\Models\\Comment"',
            severity: "error",
            source: "phpactor",
          },
          missingDiagnostic,
        ],
        rootPath: "/workspace",
        sessionId: runningStatus.sessionId,
        uri: fileUriFromPath(controllerPath),
        version: null,
      });
    });
    await flushAsyncTurns();

    expect(getWorkbench().languageServerDiagnosticsByPath[controllerPath]).toEqual([
      missingDiagnostic,
    ]);
  });
  it("suppresses trait host chained-method diagnostics through implemented interface PHPDoc properties", async () => {
    let diagnosticsListener: ((event: LanguageServerDiagnosticEvent) => void) | null = null;
    const commentPath = "/workspace/app/Models/Comment.php";
    const interfacePath = "/workspace/app/Contracts/PublishesComments.php";
    const publisherPath = "/workspace/app/Services/CommentPublisher.php";
    const traitPath = "/workspace/app/Support/PublishesFromHost.php";
    const traitSource = `<?php
namespace App\\Support;

trait PublishesFromHost
{
    public function publishFromHost(): void
    {
        $this->publish();
        echo $this->publisher;
        $this->publisher->publishNow();
        $this->missingPublisher->publishNow();
        $this->missingMagic();
    }
}
`;
    const missingDiagnostic = {
      character: 34,
      line: lineNumberOf(traitSource, "$this->missingPublisher->publishNow") - 1,
      message: 'Method "publishNow" does not exist on trait "App\\Support\\PublishesFromHost"',
      severity: "error" as const,
      source: "phpactor",
    };
    const missingMagicDiagnostic = {
      character: 15,
      line: lineNumberOf(traitSource, "missingMagic") - 1,
      message: 'Method "missingMagic" does not exist on trait "App\\Support\\PublishesFromHost"',
      severity: "error" as const,
      source: "phpactor",
    };
    const runningStatus: LanguageServerRuntimeStatus = {
      capabilities: emptyLanguageServerCapabilities(),
      kind: "running",
      sessionId: 43,
    };
    const diagnosticsGateway: LanguageServerDiagnosticsGateway = {
      subscribeDiagnostics: vi.fn(async (listener) => {
        diagnosticsListener = listener;
        return () => undefined;
      }),
    };
    const { getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace",
      },
      languageServerDiagnosticsGateway: diagnosticsGateway,
      languageServerPlan: phpactorLanguageServerPlan(),
      projectSymbols: [
        {
          column: 7,
          containerName: null,
          fullyQualifiedName: "App\\Models\\Comment",
          kind: "class",
          lineNumber: 7,
          name: "Comment",
          path: commentPath,
          relativePath: "app/Models/Comment.php",
        },
        {
          column: 11,
          containerName: null,
          fullyQualifiedName: "App\\Contracts\\PublishesComments",
          kind: "interface",
          lineNumber: 10,
          name: "PublishesComments",
          path: interfacePath,
          relativePath: "app/Contracts/PublishesComments.php",
        },
        {
          column: 7,
          containerName: null,
          fullyQualifiedName: "App\\Services\\CommentPublisher",
          kind: "class",
          lineNumber: 5,
          name: "CommentPublisher",
          path: publisherPath,
          relativePath: "app/Services/CommentPublisher.php",
        },
      ],
      readTextFile: vi.fn(async (path: string) => {
        if (path === commentPath) {
          return `<?php
namespace App\\Models;

use App\\Contracts\\PublishesComments;
use App\\Support\\PublishesFromHost;

class Comment implements PublishesComments
{
    use PublishesFromHost;
}
`;
        }

        if (path === interfacePath) {
          return `<?php
namespace App\\Contracts;

use App\\Services\\CommentPublisher;

/**
 * @method void publish()
 * @property-read CommentPublisher $publisher
 */
interface PublishesComments
{
}
`;
        }

        if (path === publisherPath) {
          return `<?php
namespace App\\Services;

class CommentPublisher
{
    public function publishNow(): void {}
}
`;
        }

        if (path === traitPath) {
          return traitSource;
        }

        return `<?php\n// ${path}\n`;
      }),
      runtimeStatus: runningStatus,
      searchText: vi.fn(async (_root, query) =>
        query === "PublishesFromHost"
          ? [
              {
                column: 5,
                lineNumber: 8,
                lineText: "    use PublishesFromHost;",
                path: commentPath,
                relativePath: "app/Models/Comment.php",
              },
            ]
          : [],
      ),
      workspaceDescriptor: phpWorkspaceDescriptor(),
    });
    await flushAsyncTurns(24);
    await act(async () => {
      await getWorkbench().setSmartMode("fullSmart");
    });
    await flushAsyncTurns(24);

    expect(diagnosticsListener).not.toBeNull();

    act(() => {
      diagnosticsListener?.({
        diagnostics: [
          {
            character: 15,
            line: lineNumberOf(traitSource, "$this->publish") - 1,
            message: 'Method "publish" does not exist on trait "App\\Support\\PublishesFromHost"',
            severity: "error",
            source: "phpactor",
          },
          {
            character: 21,
            line: lineNumberOf(traitSource, "publisher") - 1,
            message:
              'Property "$publisher" does not exist on trait "App\\Support\\PublishesFromHost"',
            severity: "error",
            source: "phpactor",
          },
          {
            character: 27,
            line: lineNumberOf(traitSource, "$this->publisher->publishNow") - 1,
            message:
              'Method "publishNow" does not exist on trait "App\\Support\\PublishesFromHost"',
            severity: "error",
            source: "phpactor",
          },
          missingDiagnostic,
          missingMagicDiagnostic,
        ],
        rootPath: "/workspace",
        sessionId: runningStatus.sessionId,
        uri: fileUriFromPath(traitPath),
        version: null,
      });
    });
    await flushAsyncTurns();

    expect(getWorkbench().languageServerDiagnosticsByPath[traitPath]).toEqual([
      missingDiagnostic,
      missingMagicDiagnostic,
    ]);
  });
  it("suppresses static trait host-property diagnostics when the host declares the property", async () => {
    let diagnosticsListener: ((event: LanguageServerDiagnosticEvent) => void) | null = null;
    const hostStatePath = "/workspace/app/Support/HostState.php";
    const resolvesHostStatePath = "/workspace/app/Support/ResolvesHostState.php";
    const resolvesHostStateSource = `<?php
namespace App\\Support;

trait ResolvesHostState
{
    public function resolve(): mixed
    {
        return static::$hostState;
    }
}
`;
    const runningStatus: LanguageServerRuntimeStatus = {
      capabilities: emptyLanguageServerCapabilities(),
      kind: "running",
      sessionId: 25,
    };
    const diagnosticsGateway: LanguageServerDiagnosticsGateway = {
      subscribeDiagnostics: vi.fn(async (listener) => {
        diagnosticsListener = listener;
        return () => undefined;
      }),
    };
    const { getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace",
      },
      languageServerDiagnosticsGateway: diagnosticsGateway,
      languageServerPlan: phpactorLanguageServerPlan(),
      readTextFile: vi.fn(async (path: string) => {
        if (path === hostStatePath) {
          return `<?php
namespace App\\Support;

class HostState
{
    use ResolvesHostState;

    protected static string $hostState = 'ready';
}
`;
        }

        if (path === resolvesHostStatePath) {
          return resolvesHostStateSource;
        }

        return `<?php\n// ${path}\n`;
      }),
      runtimeStatus: runningStatus,
      searchText: vi.fn(async (_root, query) =>
        query === "ResolvesHostState"
          ? [
              {
                column: 5,
                lineNumber: 6,
                lineText: "    use ResolvesHostState;",
                path: hostStatePath,
                relativePath: "app/Support/HostState.php",
              },
            ]
          : [],
      ),
      workspaceDescriptor: phpWorkspaceDescriptor(),
    });
    await flushAsyncTurns(24);
    await act(async () => {
      await getWorkbench().setSmartMode("fullSmart");
    });
    await flushAsyncTurns(24);

    expect(diagnosticsListener).not.toBeNull();

    act(() => {
      diagnosticsListener?.({
        diagnostics: [
          {
            character: 24,
            line: lineNumberOf(resolvesHostStateSource, "static::$hostState") - 1,
            message:
              'Property "$hostState" does not exist on trait "App\\Support\\ResolvesHostState"',
            severity: "error",
            source: "phpactor",
          },
        ],
        rootPath: "/workspace",
        sessionId: runningStatus.sessionId,
        uri: fileUriFromPath(resolvesHostStatePath),
        version: null,
      });
    });
    await flushAsyncTurns();

    expect(getWorkbench().languageServerDiagnosticsByPath[resolvesHostStatePath]).toBeUndefined();
  });
  it("suppresses trait host-constant diagnostics when the host declares the constant", async () => {
    let diagnosticsListener: ((event: LanguageServerDiagnosticEvent) => void) | null = null;
    const hostStatePath = "/workspace/app/Support/HostState.php";
    const resolvesHostStatePath = "/workspace/app/Support/ResolvesHostState.php";
    const resolvesHostStateSource = `<?php
namespace App\\Support;

trait ResolvesHostState
{
    public function resolve(): string
    {
        return static::HOST_STATE;
    }
}
`;
    const runningStatus: LanguageServerRuntimeStatus = {
      capabilities: emptyLanguageServerCapabilities(),
      kind: "running",
      sessionId: 26,
    };
    const diagnosticsGateway: LanguageServerDiagnosticsGateway = {
      subscribeDiagnostics: vi.fn(async (listener) => {
        diagnosticsListener = listener;
        return () => undefined;
      }),
    };
    const { getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace",
      },
      languageServerDiagnosticsGateway: diagnosticsGateway,
      languageServerPlan: phpactorLanguageServerPlan(),
      readTextFile: vi.fn(async (path: string) => {
        if (path === hostStatePath) {
          return `<?php
namespace App\\Support;

class HostState
{
    use ResolvesHostState;

    private const HOST_STATE = 'ready';
}
`;
        }

        if (path === resolvesHostStatePath) {
          return resolvesHostStateSource;
        }

        return `<?php\n// ${path}\n`;
      }),
      runtimeStatus: runningStatus,
      searchText: vi.fn(async (_root, query) =>
        query === "ResolvesHostState"
          ? [
              {
                column: 5,
                lineNumber: 6,
                lineText: "    use ResolvesHostState;",
                path: hostStatePath,
                relativePath: "app/Support/HostState.php",
              },
            ]
          : [],
      ),
      workspaceDescriptor: phpWorkspaceDescriptor(),
    });
    await flushAsyncTurns(24);
    await act(async () => {
      await getWorkbench().setSmartMode("fullSmart");
    });
    await flushAsyncTurns(24);

    expect(diagnosticsListener).not.toBeNull();

    act(() => {
      diagnosticsListener?.({
        diagnostics: [
          {
            character: 24,
            line: lineNumberOf(resolvesHostStateSource, "static::HOST_STATE") - 1,
            message:
              'Constant "HOST_STATE" does not exist on trait "App\\Support\\ResolvesHostState"',
            severity: "error",
            source: "phpactor",
          },
        ],
        rootPath: "/workspace",
        sessionId: runningStatus.sessionId,
        uri: fileUriFromPath(resolvesHostStatePath),
        version: null,
      });
    });
    await flushAsyncTurns();

    expect(getWorkbench().languageServerDiagnosticsByPath[resolvesHostStatePath]).toBeUndefined();
  });
  it("stops stale PHP trait host-constant search after switching project tabs", async () => {
    let diagnosticsListener: ((event: LanguageServerDiagnosticEvent) => void) | null = null;
    const hostStatePath = "/workspace-a/app/Support/HostState.php";
    const resolvesHostStatePath = "/workspace-a/app/Support/ResolvesHostState.php";
    const resolvesHostStateSource = `<?php
namespace App\\Support;

trait ResolvesHostState
{
    public function resolve(): string
    {
        return static::HOST_STATE;
    }
}
`;
    const runningStatus: LanguageServerRuntimeStatus = {
      capabilities: emptyLanguageServerCapabilities(),
      kind: "running",
      sessionId: 42,
    };
    const diagnosticsGateway: LanguageServerDiagnosticsGateway = {
      subscribeDiagnostics: vi.fn(async (listener) => {
        diagnosticsListener = listener;
        return () => undefined;
      }),
    };
    const staleTraitHostSearch = createDeferred<TextSearchResult[]>();
    const searchText = vi.fn(async (_root, query) =>
      query === "ResolvesHostState" ? staleTraitHostSearch.promise : [],
    );
    let hostStateReadCount = 0;
    const { getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace-a",
        workspaceTabs: ["/workspace-a", "/workspace-b"],
      },
      languageServerDiagnosticsGateway: diagnosticsGateway,
      languageServerPlan: phpactorLanguageServerPlan(),
      readTextFile: vi.fn(async (path: string) => {
        if (path === resolvesHostStatePath) {
          return resolvesHostStateSource;
        }

        if (path === hostStatePath) {
          hostStateReadCount += 1;
          return `<?php
namespace App\\Support;

class HostState
{
    use ResolvesHostState;

    private const HOST_STATE = 'ready';
}
`;
        }

        return `<?php\n// ${path}\n`;
      }),
      runtimeStatus: runningStatus,
      searchText,
      workspaceDescriptor: phpWorkspaceDescriptor(),
    });
    await flushAsyncTurns(24);
    await act(async () => {
      await getWorkbench().setSmartMode("fullSmart");
    });
    await flushAsyncTurns(24);

    expect(diagnosticsListener).not.toBeNull();

    act(() => {
      diagnosticsListener?.({
        diagnostics: [
          {
            character: 24,
            line: lineNumberOf(resolvesHostStateSource, "static::HOST_STATE") - 1,
            message:
              'Constant "HOST_STATE" does not exist on trait "App\\Support\\ResolvesHostState"',
            severity: "error",
            source: "phpactor",
          },
        ],
        rootPath: "/workspace-a",
        sessionId: runningStatus.sessionId,
        uri: fileUriFromPath(resolvesHostStatePath),
        version: null,
      });
    });
    await waitForReact(() => {
      expect(searchText).toHaveBeenCalledWith("/workspace-a", "ResolvesHostState", 200);
    });

    await act(async () => {
      await getWorkbench().activateWorkspaceTab("/workspace-b");
    });
    await flushAsyncTurns();

    staleTraitHostSearch.resolve([
      {
        column: 5,
        lineNumber: 6,
        lineText: "    use ResolvesHostState;",
        path: hostStatePath,
        relativePath: "app/Support/HostState.php",
      },
    ]);
    await flushAsyncTurns(24);

    expect(getWorkbench().workspaceRoot).toBe("/workspace-b");
    expect(hostStateReadCount).toBe(0);
  });
  it("stops stale PHP constant hierarchy diagnostic traversal after switching project tabs", async () => {
    let diagnosticsListener: ((event: LanguageServerDiagnosticEvent) => void) | null = null;
    const hostStatePath = "/workspace-a/app/Support/HostState.php";
    const resolvesHostStatePath = "/workspace-a/app/Support/ResolvesHostState.php";
    const workspaceBBaseHostStatePath = "/workspace-b/app/Support/BaseHostState.php";
    const resolvesHostStateSource = `<?php
namespace App\\Support;

trait ResolvesHostState
{
    public function resolve(): string
    {
        return static::HOST_STATE;
    }
}
`;
    const hostStateSource = `<?php
namespace App\\Support;

class HostState extends BaseHostState
{
    use ResolvesHostState;
}
`;
    const runningStatus: LanguageServerRuntimeStatus = {
      capabilities: emptyLanguageServerCapabilities(),
      kind: "running",
      sessionId: 39,
    };
    const diagnosticsGateway: LanguageServerDiagnosticsGateway = {
      subscribeDiagnostics: vi.fn(async (listener) => {
        diagnosticsListener = listener;
        return () => undefined;
      }),
    };
    const staleHostHierarchyRead = createDeferred<string>();
    let hostStateReadCount = 0;
    let workspaceBBaseHostStateReadCount = 0;
    const { getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace-a",
        workspaceTabs: ["/workspace-a", "/workspace-b"],
      },
      languageServerDiagnosticsGateway: diagnosticsGateway,
      languageServerPlan: phpactorLanguageServerPlan(),
      readTextFile: vi.fn(async (path: string) => {
        if (path === hostStatePath) {
          hostStateReadCount += 1;
          return hostStateReadCount === 2 ? staleHostHierarchyRead.promise : hostStateSource;
        }

        if (path === resolvesHostStatePath) {
          return resolvesHostStateSource;
        }

        if (path === workspaceBBaseHostStatePath) {
          workspaceBBaseHostStateReadCount += 1;
          return `<?php
namespace App\\Support;

class BaseHostState
{
    private const HOST_STATE = 'ready';
}
`;
        }

        return `<?php\n// ${path}\n`;
      }),
      runtimeStatus: runningStatus,
      searchText: vi.fn(async (_root, query) =>
        query === "ResolvesHostState"
          ? [
              {
                column: 5,
                lineNumber: 6,
                lineText: "    use ResolvesHostState;",
                path: hostStatePath,
                relativePath: "app/Support/HostState.php",
              },
            ]
          : [],
      ),
      workspaceDescriptor: phpWorkspaceDescriptor(),
    });
    await flushAsyncTurns(24);
    await act(async () => {
      await getWorkbench().setSmartMode("fullSmart");
    });
    await flushAsyncTurns(24);

    expect(diagnosticsListener).not.toBeNull();

    act(() => {
      diagnosticsListener?.({
        diagnostics: [
          {
            character: 24,
            line: lineNumberOf(resolvesHostStateSource, "static::HOST_STATE") - 1,
            message:
              'Constant "HOST_STATE" does not exist on trait "App\\Support\\ResolvesHostState"',
            severity: "error",
            source: "phpactor",
          },
        ],
        rootPath: "/workspace-a",
        sessionId: runningStatus.sessionId,
        uri: fileUriFromPath(resolvesHostStatePath),
        version: null,
      });
    });
    await waitForReact(() => {
      expect(hostStateReadCount).toBe(2);
    });

    await act(async () => {
      await getWorkbench().activateWorkspaceTab("/workspace-b");
    });
    await flushAsyncTurns();

    staleHostHierarchyRead.resolve(hostStateSource);
    await flushAsyncTurns(24);

    expect(getWorkbench().workspaceRoot).toBe("/workspace-b");
    expect(workspaceBBaseHostStateReadCount).toBe(0);
  });
  it("suppresses trait host-method diagnostics through an intermediate trait and parent method", async () => {
    let diagnosticsListener: ((event: LanguageServerDiagnosticEvent) => void) | null = null;
    const commentPath = "/workspace/app/Models/Comment.php";
    const concernPath = "/workspace/app/Models/Concerns/HasSoftDeletes.php";
    const modelPath =
      "/workspace/vendor/laravel/framework/src/Illuminate/Database/Eloquent/Model.php";
    const softDeletesPath =
      "/workspace/vendor/laravel/framework/src/Illuminate/Database/Eloquent/SoftDeletes.php";
    const softDeletesSource = `<?php
namespace Illuminate\\Database\\Eloquent;

trait SoftDeletes
{
    public function forceDelete()
    {
        if ($this->fireModelEvent('forceDeleting') === false) {
            return false;
        }
    }
}
`;
    const runningStatus: LanguageServerRuntimeStatus = {
      capabilities: emptyLanguageServerCapabilities(),
      kind: "running",
      sessionId: 20,
    };
    const diagnosticsGateway: LanguageServerDiagnosticsGateway = {
      subscribeDiagnostics: vi.fn(async (listener) => {
        diagnosticsListener = listener;
        return () => undefined;
      }),
    };
    const { getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace",
      },
      languageServerDiagnosticsGateway: diagnosticsGateway,
      languageServerPlan: phpactorLanguageServerPlan(),
      readTextFile: vi.fn(async (path: string) => {
        if (path === commentPath) {
          return `<?php
namespace App\\Models;

use App\\Models\\Concerns\\HasSoftDeletes;
use Illuminate\\Database\\Eloquent\\Model;

class Comment extends Model
{
    use HasSoftDeletes;
}
`;
        }

        if (path === concernPath) {
          return `<?php
namespace App\\Models\\Concerns;

use Illuminate\\Database\\Eloquent\\SoftDeletes;

trait HasSoftDeletes
{
    use SoftDeletes;
}
`;
        }

        if (path === modelPath) {
          return `<?php
namespace Illuminate\\Database\\Eloquent;

class Model
{
    protected function fireModelEvent(string $event)
    {
    }
}
`;
        }

        if (path === softDeletesPath) {
          return softDeletesSource;
        }

        return `<?php\n// ${path}\n`;
      }),
      runtimeStatus: runningStatus,
      searchText: vi.fn(async (_root, query) => {
        if (query === "SoftDeletes") {
          return [
            {
              column: 5,
              lineNumber: 8,
              lineText: "    use SoftDeletes;",
              path: concernPath,
              relativePath: "app/Models/Concerns/HasSoftDeletes.php",
            },
          ];
        }

        if (query === "HasSoftDeletes") {
          return [
            {
              column: 5,
              lineNumber: 9,
              lineText: "    use HasSoftDeletes;",
              path: commentPath,
              relativePath: "app/Models/Comment.php",
            },
          ];
        }

        return [];
      }),
      workspaceDescriptor: phpWorkspaceDescriptor(),
    });
    await flushAsyncTurns(24);
    await act(async () => {
      await getWorkbench().setSmartMode("fullSmart");
    });
    await flushAsyncTurns(24);

    expect(diagnosticsListener).not.toBeNull();

    act(() => {
      diagnosticsListener?.({
        diagnostics: [
          {
            character: 20,
            line: lineNumberOf(softDeletesSource, "fireModelEvent") - 1,
            message:
              'Method "fireModelEvent" does not exist on trait "Illuminate\\Database\\Eloquent\\SoftDeletes"',
            severity: "error",
            source: "phpactor",
          },
        ],
        rootPath: "/workspace",
        sessionId: runningStatus.sessionId,
        uri: fileUriFromPath(softDeletesPath),
        version: null,
      });
    });
    await flushAsyncTurns();

    expect(getWorkbench().languageServerDiagnosticsByPath[softDeletesPath]).toBeUndefined();
  });
  it("suppresses trait host-method diagnostics when a descendant provides the method", async () => {
    let diagnosticsListener: ((event: LanguageServerDiagnosticEvent) => void) | null = null;
    const baseModelPath = "/workspace/app/Models/BaseModel.php";
    const commentPath = "/workspace/app/Models/Comment.php";
    const softDeletesPath =
      "/workspace/vendor/laravel/framework/src/Illuminate/Database/Eloquent/SoftDeletes.php";
    const softDeletesSource = `<?php
namespace Illuminate\\Database\\Eloquent;

trait SoftDeletes
{
    public function forceDelete()
    {
        if ($this->fireModelEvent('forceDeleting') === false) {
            return false;
        }
    }
}
`;
    const runningStatus: LanguageServerRuntimeStatus = {
      capabilities: emptyLanguageServerCapabilities(),
      kind: "running",
      sessionId: 21,
    };
    const diagnosticsGateway: LanguageServerDiagnosticsGateway = {
      subscribeDiagnostics: vi.fn(async (listener) => {
        diagnosticsListener = listener;
        return () => undefined;
      }),
    };
    const { getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace",
      },
      languageServerDiagnosticsGateway: diagnosticsGateway,
      languageServerPlan: phpactorLanguageServerPlan(),
      readTextFile: vi.fn(async (path: string) => {
        if (path === baseModelPath) {
          return `<?php
namespace App\\Models;

use Illuminate\\Database\\Eloquent\\SoftDeletes;

class BaseModel
{
    use SoftDeletes;
}
`;
        }

        if (path === commentPath) {
          return `<?php
namespace App\\Models;

class Comment extends BaseModel
{
    protected function fireModelEvent(string $event)
    {
    }
}
`;
        }

        if (path === softDeletesPath) {
          return softDeletesSource;
        }

        return `<?php\n// ${path}\n`;
      }),
      runtimeStatus: runningStatus,
      searchText: vi.fn(async (_root, query) => {
        if (query === "SoftDeletes") {
          return [
            {
              column: 5,
              lineNumber: 8,
              lineText: "    use SoftDeletes;",
              path: baseModelPath,
              relativePath: "app/Models/BaseModel.php",
            },
          ];
        }

        if (query === "BaseModel") {
          return [
            {
              column: 23,
              lineNumber: 4,
              lineText: "class Comment extends BaseModel",
              path: commentPath,
              relativePath: "app/Models/Comment.php",
            },
          ];
        }

        return [];
      }),
      workspaceDescriptor: phpWorkspaceDescriptor(),
    });
    await flushAsyncTurns(24);
    await act(async () => {
      await getWorkbench().setSmartMode("fullSmart");
    });
    await flushAsyncTurns(24);

    expect(diagnosticsListener).not.toBeNull();

    act(() => {
      diagnosticsListener?.({
        diagnostics: [
          {
            character: 20,
            line: lineNumberOf(softDeletesSource, "fireModelEvent") - 1,
            message:
              'Method "fireModelEvent" does not exist on trait "Illuminate\\Database\\Eloquent\\SoftDeletes"',
            severity: "error",
            source: "phpactor",
          },
        ],
        rootPath: "/workspace",
        sessionId: runningStatus.sessionId,
        uri: fileUriFromPath(softDeletesPath),
        version: null,
      });
    });
    await flushAsyncTurns();

    expect(getWorkbench().languageServerDiagnosticsByPath[softDeletesPath]).toBeUndefined();
  });
  it("suppresses trait host-method diagnostics reported with a short trait name", async () => {
    let diagnosticsListener: ((event: LanguageServerDiagnosticEvent) => void) | null = null;
    const commentPath = "/workspace/app/Models/Comment.php";
    const modelPath =
      "/workspace/vendor/laravel/framework/src/Illuminate/Database/Eloquent/Model.php";
    const softDeletesPath =
      "/workspace/vendor/laravel/framework/src/Illuminate/Database/Eloquent/SoftDeletes.php";
    const softDeletesSource = `<?php
namespace Illuminate\\Database\\Eloquent;

trait SoftDeletes
{
    public function forceDelete()
    {
        if ($this->fireModelEvent('forceDeleting') === false) {
            return false;
        }
    }
}
`;
    const runningStatus: LanguageServerRuntimeStatus = {
      capabilities: emptyLanguageServerCapabilities(),
      kind: "running",
      sessionId: 22,
    };
    const diagnosticsGateway: LanguageServerDiagnosticsGateway = {
      subscribeDiagnostics: vi.fn(async (listener) => {
        diagnosticsListener = listener;
        return () => undefined;
      }),
    };
    const { getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace",
      },
      languageServerDiagnosticsGateway: diagnosticsGateway,
      languageServerPlan: phpactorLanguageServerPlan(),
      readTextFile: vi.fn(async (path: string) => {
        if (path === commentPath) {
          return `<?php
namespace App\\Models;

use Illuminate\\Database\\Eloquent\\Model;
use Illuminate\\Database\\Eloquent\\SoftDeletes;

class Comment extends Model
{
    use SoftDeletes;
}
`;
        }

        if (path === modelPath) {
          return `<?php
namespace Illuminate\\Database\\Eloquent;

class Model
{
    protected function fireModelEvent(string $event)
    {
    }
}
`;
        }

        if (path === softDeletesPath) {
          return softDeletesSource;
        }

        return `<?php\n// ${path}\n`;
      }),
      runtimeStatus: runningStatus,
      searchText: vi.fn(async (_root, query) =>
        query === "SoftDeletes"
          ? [
              {
                column: 5,
                lineNumber: 9,
                lineText: "    use SoftDeletes;",
                path: commentPath,
                relativePath: "app/Models/Comment.php",
              },
            ]
          : [],
      ),
      workspaceDescriptor: phpWorkspaceDescriptor(),
    });
    await flushAsyncTurns(24);
    await act(async () => {
      await getWorkbench().setSmartMode("fullSmart");
    });
    await flushAsyncTurns(24);

    expect(diagnosticsListener).not.toBeNull();

    act(() => {
      diagnosticsListener?.({
        diagnostics: [
          {
            character: 20,
            line: lineNumberOf(softDeletesSource, "fireModelEvent") - 1,
            message: 'Method "fireModelEvent" does not exist on trait "SoftDeletes"',
            severity: "error",
            source: "phpactor",
          },
        ],
        rootPath: "/workspace",
        sessionId: runningStatus.sessionId,
        uri: fileUriFromPath(softDeletesPath),
        version: null,
      });
    });
    await flushAsyncTurns();

    expect(getWorkbench().languageServerDiagnosticsByPath[softDeletesPath]).toBeUndefined();
  });
  it("suppresses static local-scope diagnostics only when the model defines the scope", async () => {
    let diagnosticsListener: ((event: LanguageServerDiagnosticEvent) => void) | null = null;
    const controllerPath = "/workspace/app/Http/Controllers/AlbumController.php";
    const albumPath = "/workspace/app/Models/Album.php";
    const controllerSource = `<?php
namespace App\\Http\\Controllers;

use App\\Models\\Album;

class AlbumController
{
    public function index(): void
    {
        Album::published()->first();
        Album::popular()->first();
        Album::missingMagic()->first();
    }
}
`;
    const runningStatus: LanguageServerRuntimeStatus = {
      capabilities: emptyLanguageServerCapabilities(),
      kind: "running",
      sessionId: 12,
    };
    const diagnosticsGateway: LanguageServerDiagnosticsGateway = {
      subscribeDiagnostics: vi.fn(async (listener) => {
        diagnosticsListener = listener;
        return () => undefined;
      }),
    };
    const { getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace",
      },
      languageServerDiagnosticsGateway: diagnosticsGateway,
      readTextFile: vi.fn(async (path: string) => {
        if (path === controllerPath) {
          return controllerSource;
        }

        if (path === albumPath) {
          return `<?php
namespace App\\Models;

use Illuminate\\Database\\Eloquent\\Builder;
use Illuminate\\Database\\Eloquent\\Attributes\\Scope;

class Album
{
    public function scopePublished(Builder $query): Builder
    {
        return $query;
    }

    #[Scope]
    protected function popular(Builder $query): void
    {
    }
}
`;
        }

        return `<?php\n// ${path}\n`;
      }),
      runtimeStatus: runningStatus,
      workspaceDescriptor: phpWorkspaceDescriptor(),
    });
    await flushAsyncTurns(24);
    await act(async () => {
      await getWorkbench().setSmartMode("fullSmart");
    });
    await flushAsyncTurns(24);

    expect(diagnosticsListener).not.toBeNull();

    act(() => {
      diagnosticsListener?.({
        diagnostics: [
          {
            character: 16,
            line: 9,
            message: "Method App\\Models\\Album::published() does not exist",
            severity: "error",
            source: "phpactor",
          },
          {
            character: 16,
            line: 10,
            message: "Method App\\Models\\Album::popular() does not exist",
            severity: "error",
            source: "phpactor",
          },
          {
            character: 16,
            line: 11,
            message: "Method App\\Models\\Album::missingMagic() does not exist",
            severity: "error",
            source: "phpactor",
          },
        ],
        rootPath: "/workspace",
        sessionId: runningStatus.sessionId,
        uri: fileUriFromPath(controllerPath),
        version: null,
      });
    });
    await flushAsyncTurns();

    expect(getWorkbench().languageServerDiagnosticsByPath[controllerPath]).toEqual([
      {
        character: 16,
        line: 11,
        message: "Method App\\Models\\Album::missingMagic() does not exist",
        severity: "error",
        source: "phpactor",
      },
    ]);
  });
  it("keeps local-scope diagnostics in plain Composer projects", async () => {
    let diagnosticsListener: ((event: LanguageServerDiagnosticEvent) => void) | null = null;
    const controllerPath = "/workspace/app/Http/Controllers/AlbumController.php";
    const albumPath = "/workspace/app/Models/Album.php";
    const controllerSource = `<?php
namespace App\\Http\\Controllers;

use App\\Models\\Album;

class AlbumController
{
    public function index(): void
    {
        Album::published()->first();
    }
}
`;
    const runningStatus: LanguageServerRuntimeStatus = {
      capabilities: emptyLanguageServerCapabilities(),
      kind: "running",
      sessionId: 15,
    };
    const diagnosticsGateway: LanguageServerDiagnosticsGateway = {
      subscribeDiagnostics: vi.fn(async (listener) => {
        diagnosticsListener = listener;
        return () => undefined;
      }),
    };
    const { getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace",
      },
      languageServerDiagnosticsGateway: diagnosticsGateway,
      readTextFile: vi.fn(async (path: string) => {
        if (path === controllerPath) {
          return controllerSource;
        }

        if (path === albumPath) {
          return `<?php
namespace App\\Models;

class Album
{
    public function scopePublished($query)
    {
        return $query;
    }
}
`;
        }

        return `<?php\n// ${path}\n`;
      }),
      runtimeStatus: runningStatus,
      workspaceDescriptor: phpWorkspaceDescriptor({
        packageName: "custom/api",
        packages: [],
      }),
    });
    await flushAsyncTurns(24);
    await act(async () => {
      await getWorkbench().setSmartMode("fullSmart");
    });
    await flushAsyncTurns(24);

    expect(diagnosticsListener).not.toBeNull();

    act(() => {
      diagnosticsListener?.({
        diagnostics: [
          {
            character: 16,
            line: 9,
            message: "Method App\\Models\\Album::published() does not exist",
            severity: "error",
            source: "phpactor",
          },
        ],
        rootPath: "/workspace",
        sessionId: runningStatus.sessionId,
        uri: fileUriFromPath(controllerPath),
        version: null,
      });
    });
    await flushAsyncTurns();

    expect(getWorkbench().languageServerDiagnosticsByPath[controllerPath]).toEqual([
      {
        character: 16,
        line: 9,
        message: "Method App\\Models\\Album::published() does not exist",
        severity: "error",
        source: "phpactor",
      },
    ]);
  });
  it("suppresses builder local-scope diagnostics only when the inferred model defines the scope", async () => {
    let diagnosticsListener: ((event: LanguageServerDiagnosticEvent) => void) | null = null;
    const controllerPath = "/workspace/app/Http/Controllers/AlbumController.php";
    const albumPath = "/workspace/app/Models/Album.php";
    const controllerSource = `<?php
namespace App\\Http\\Controllers;

use App\\Models\\Album;

class AlbumController
{
    public function index(): void
    {
        Album::query()->withRelations()->first();
        Album::query()->missingMagic()->first();
    }
}
`;
    const runningStatus: LanguageServerRuntimeStatus = {
      capabilities: emptyLanguageServerCapabilities(),
      kind: "running",
      sessionId: 14,
    };
    const diagnosticsGateway: LanguageServerDiagnosticsGateway = {
      subscribeDiagnostics: vi.fn(async (listener) => {
        diagnosticsListener = listener;
        return () => undefined;
      }),
    };
    const { getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace",
      },
      languageServerDiagnosticsGateway: diagnosticsGateway,
      readTextFile: vi.fn(async (path: string) => {
        if (path === controllerPath) {
          return controllerSource;
        }

        if (path === albumPath) {
          return `<?php
namespace App\\Models;

use Illuminate\\Database\\Eloquent\\Builder;

class Album
{
    public function scopeWithRelations(Builder $query): Builder
    {
        return $query;
    }
}
`;
        }

        return `<?php\n// ${path}\n`;
      }),
      runtimeStatus: runningStatus,
      workspaceDescriptor: phpWorkspaceDescriptor(),
    });
    await flushAsyncTurns(24);
    await act(async () => {
      await getWorkbench().setSmartMode("fullSmart");
    });
    await flushAsyncTurns(24);

    expect(diagnosticsListener).not.toBeNull();

    act(() => {
      diagnosticsListener?.({
        diagnostics: [
          {
            character: 25,
            line: 9,
            message:
              "Method Illuminate\\Database\\Eloquent\\Builder::withRelations() does not exist",
            severity: "error",
            source: "phpactor",
          },
          {
            character: 25,
            line: 10,
            message:
              "Method Illuminate\\Database\\Eloquent\\Builder::missingMagic() does not exist",
            severity: "error",
            source: "phpactor",
          },
        ],
        rootPath: "/workspace",
        sessionId: runningStatus.sessionId,
        uri: fileUriFromPath(controllerPath),
        version: null,
      });
    });
    await flushAsyncTurns();

    expect(getWorkbench().languageServerDiagnosticsByPath[controllerPath]).toEqual([
      {
        character: 25,
        line: 10,
        message: "Method Illuminate\\Database\\Eloquent\\Builder::missingMagic() does not exist",
        severity: "error",
        source: "phpactor",
      },
    ]);
  });
  it("suppresses builder local-scope diagnostics through generic repository returns", async () => {
    let diagnosticsListener: ((event: LanguageServerDiagnosticEvent) => void) | null = null;
    const controllerPath = "/workspace/app/Http/Controllers/AlbumController.php";
    const albumPath = "/workspace/app/Models/Album.php";
    const repositoryPath = "/workspace/app/Repositories/AlbumRepository.php";
    const controllerSource = `<?php
namespace App\\Http\\Controllers;

use App\\Repositories\\AlbumRepository;

class AlbumController
{
    public function index(AlbumRepository $albums): void
    {
        $query = $albums->query();
        $query->withRelations()->first();
        $query->missingMagic()->first();
    }
}
`;
    const runningStatus: LanguageServerRuntimeStatus = {
      capabilities: emptyLanguageServerCapabilities(),
      kind: "running",
      sessionId: 17,
    };
    const diagnosticsGateway: LanguageServerDiagnosticsGateway = {
      subscribeDiagnostics: vi.fn(async (listener) => {
        diagnosticsListener = listener;
        return () => undefined;
      }),
    };
    const { getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace",
      },
      languageServerDiagnosticsGateway: diagnosticsGateway,
      projectSymbols: [
        {
          column: 7,
          containerName: null,
          fullyQualifiedName: "App\\Repositories\\AlbumRepository",
          kind: "class",
          lineNumber: 8,
          name: "AlbumRepository",
          path: repositoryPath,
          relativePath: "app/Repositories/AlbumRepository.php",
        },
      ],
      readTextFile: vi.fn(async (path: string) => {
        if (path === controllerPath) {
          return controllerSource;
        }

        if (path === albumPath) {
          return `<?php
namespace App\\Models;

use Illuminate\\Database\\Eloquent\\Builder;

class Album
{
    public function scopeWithRelations(Builder $query): Builder
    {
        return $query;
    }
}
`;
        }

        if (path === repositoryPath) {
          return `<?php
namespace App\\Repositories;

use App\\Models\\Album;
use Illuminate\\Database\\Eloquent\\Builder;

class AlbumRepository
{
    /** @psalm-return Builder<Album> */
    public function query(): Builder {}
}
`;
        }

        return `<?php\n// ${path}\n`;
      }),
      runtimeStatus: runningStatus,
      workspaceDescriptor: phpWorkspaceDescriptor(),
    });
    await flushAsyncTurns(24);
    await act(async () => {
      await getWorkbench().setSmartMode("fullSmart");
    });
    await flushAsyncTurns(24);

    expect(diagnosticsListener).not.toBeNull();

    const scopeLine = positionAfter(controllerSource, "$query->withRelations").lineNumber - 1;
    const missingLine = positionAfter(controllerSource, "$query->missingMagic").lineNumber - 1;

    act(() => {
      diagnosticsListener?.({
        diagnostics: [
          {
            character: 16,
            line: scopeLine,
            message:
              "Method Illuminate\\Database\\Eloquent\\Builder::withRelations() does not exist",
            severity: "error",
            source: "phpactor",
          },
          {
            character: 16,
            line: missingLine,
            message:
              "Method Illuminate\\Database\\Eloquent\\Builder::missingMagic() does not exist",
            severity: "error",
            source: "phpactor",
          },
        ],
        rootPath: "/workspace",
        sessionId: runningStatus.sessionId,
        uri: fileUriFromPath(controllerPath),
        version: null,
      });
    });
    await flushAsyncTurns();

    expect(getWorkbench().languageServerDiagnosticsByPath[controllerPath]).toEqual([
      {
        character: 16,
        line: missingLine,
        message: "Method Illuminate\\Database\\Eloquent\\Builder::missingMagic() does not exist",
        severity: "error",
        source: "phpactor",
      },
    ]);
  });
  it("exposes Laravel dynamic where helpers from model attributes", async () => {
    let diagnosticsListener: ((event: LanguageServerDiagnosticEvent) => void) | null = null;
    const controllerPath = "/workspace/app/Http/Controllers/CommentController.php";
    const commentPath = "/workspace/app/Models/Comment.php";
    const builderPath =
      "/workspace/vendor/laravel/framework/src/Illuminate/Database/Eloquent/Builder.php";
    const controllerSource = `<?php
namespace App\\Http\\Controllers;

use App\\Models\\Comment;

class CommentController
{
    public function index(): void
    {
        Comment::whereCon
        Comment::whereContent(

        $foundComment = Comment::whereContent('hello')->first();
        $foundComment->getC
        $foundComment->full_name;

        $query = Comment::query();
        $query->whereIsP
        $query->whereIsPinned(true)->ord

        Comment::missingDynamic()->first();
    }
}
`;
    const runningStatus: LanguageServerRuntimeStatus = {
      capabilities: emptyLanguageServerCapabilities(),
      kind: "running",
      sessionId: 13,
    };
    const diagnosticsGateway: LanguageServerDiagnosticsGateway = {
      subscribeDiagnostics: vi.fn(async (listener) => {
        diagnosticsListener = listener;
        return () => undefined;
      }),
    };
    const { getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace",
      },
      languageServerDiagnosticsGateway: diagnosticsGateway,
      readTextFile: vi.fn(async (path: string) => {
        if (path === controllerPath) {
          return controllerSource;
        }

        if (path === commentPath) {
          return `<?php
namespace App\\Models;

class Comment
{
    protected $fillable = [
        'content',
    ];

    protected array $casts = [
        'is_pinned' => 'bool',
    ];

    public function getContent(): string {}

    public function getFullNameAttribute(): string
    {
        return '';
    }
}
`;
        }

        if (path === builderPath) {
          return `<?php
namespace Illuminate\\Database\\Eloquent;

class Builder
{
    /** @return static */
    public function orderBy($column, $direction = 'asc') {}

    /** @return TModel|null */
    public function first($columns = ['*']) {}
}
`;
        }

        return `<?php\n// ${path}\n`;
      }),
      runtimeStatus: runningStatus,
      workspaceDescriptor: phpWorkspaceDescriptor(),
    });
    await flushAsyncTurns(24);
    await act(async () => {
      await getWorkbench().setSmartMode("fullSmart");
    });
    await act(async () => {
      await getWorkbench().openFile(fileEntry(controllerPath, "CommentController.php"));
    });

    await expect(
      getWorkbench().providePhpMethodCompletions(
        controllerSource,
        positionAfter(controllerSource, "Comment::whereCon"),
      ),
    ).resolves.toEqual([
      {
        declaringClassName: "App\\Models\\Comment",
        isStatic: true,
        kind: "magic-where",
        name: "whereContent",
        parameters: "$value",
        returnType: "Illuminate\\Database\\Eloquent\\Builder",
      },
    ]);
    await expect(
      getWorkbench().providePhpMethodSignature(
        controllerSource,
        positionAfter(controllerSource, "Comment::whereContent("),
      ),
    ).resolves.toEqual({
      argumentIndex: 0,
      method: {
        declaringClassName: "App\\Models\\Comment",
        isStatic: true,
        kind: "magic-where",
        name: "whereContent",
        parameters: "$value",
        returnType: "Illuminate\\Database\\Eloquent\\Builder",
      },
      parameters: [
        {
          defaultValue: null,
          name: "$value",
          optional: false,
          raw: "$value",
          type: null,
        },
      ],
    });
    await expect(
      getWorkbench().providePhpMethodCompletions(
        controllerSource,
        positionAfter(controllerSource, "$query->whereIsP"),
      ),
    ).resolves.toEqual([
      {
        declaringClassName: "App\\Models\\Comment",
        kind: "magic-where",
        name: "whereIsPinned",
        parameters: "$value",
        returnType: "Illuminate\\Database\\Eloquent\\Builder",
      },
    ]);
    await expect(
      getWorkbench().providePhpMethodCompletions(
        controllerSource,
        positionAfter(controllerSource, "$foundComment->getC"),
      ),
    ).resolves.toEqual([
      {
        declaringClassName: "App\\Models\\Comment",
        name: "getContent",
        parameters: "",
        returnType: "string",
      },
    ]);
    await expect(
      getWorkbench().providePhpMethodCompletions(
        controllerSource,
        positionAfter(controllerSource, "$query->whereIsPinned(true)->ord"),
      ),
    ).resolves.toEqual([
      {
        declaringClassName: "Illuminate\\Database\\Eloquent\\Builder",
        name: "orderBy",
        parameters: "$column, $direction = 'asc'",
        returnType: "static",
      },
    ]);

    act(() => {
      getWorkbench().updateActiveEditorPosition(
        positionAfter(controllerSource, "Comment::whereContent"),
      );
    });
    await act(async () => {
      await getWorkbench()
        .commands.find((candidate) => candidate.id === "editor.goToDefinition")
        ?.run();
    });

    expect(getWorkbench().activePath).toBe(commentPath);
    expect(getWorkbench().editorRevealTarget).toEqual({
      path: commentPath,
      position: {
        column: 10,
        lineNumber: 7,
      },
    });

    await act(async () => {
      await getWorkbench().openFile(fileEntry(controllerPath, "CommentController.php"));
    });
    act(() => {
      getWorkbench().updateActiveEditorPosition(
        positionAfter(controllerSource, "$query->whereIsPinned"),
      );
    });
    await act(async () => {
      await getWorkbench()
        .commands.find((candidate) => candidate.id === "editor.goToDefinition")
        ?.run();
    });

    expect(getWorkbench().activePath).toBe(commentPath);
    expect(getWorkbench().editorRevealTarget).toEqual({
      path: commentPath,
      position: {
        column: 10,
        lineNumber: 11,
      },
    });

    await act(async () => {
      await getWorkbench().openFile(fileEntry(controllerPath, "CommentController.php"));
    });
    act(() => {
      getWorkbench().updateActiveEditorPosition(
        positionAfter(controllerSource, "$foundComment->full_name"),
      );
    });
    await act(async () => {
      await getWorkbench()
        .commands.find((candidate) => candidate.id === "editor.goToDefinition")
        ?.run();
    });

    expect(getWorkbench().activePath).toBe(commentPath);
    expect(getWorkbench().editorRevealTarget).toEqual({
      path: commentPath,
      position: {
        column: 21,
        lineNumber: 16,
      },
    });

    expect(diagnosticsListener).not.toBeNull();

    act(() => {
      diagnosticsListener?.({
        diagnostics: [
          {
            character: 24,
            line: 10,
            message: "Method App\\Models\\Comment::whereContent() does not exist",
            severity: "error",
            source: "phpactor",
          },
          {
            character: 24,
            line: lineNumberOf(controllerSource, "Comment::missingDynamic") - 1,
            message: "Method App\\Models\\Comment::missingDynamic() does not exist",
            severity: "error",
            source: "phpactor",
          },
        ],
        rootPath: "/workspace",
        sessionId: runningStatus.sessionId,
        uri: fileUriFromPath(controllerPath),
        version: null,
      });
    });
    await flushAsyncTurns();

    expect(getWorkbench().languageServerDiagnosticsByPath[controllerPath]).toEqual([
      {
        character: 24,
        line: lineNumberOf(controllerSource, "Comment::missingDynamic") - 1,
        message: "Method App\\Models\\Comment::missingDynamic() does not exist",
        severity: "error",
        source: "phpactor",
      },
    ]);
  });
  it("stops stale Laravel dynamic where completion traversal after switching project tabs", async () => {
    const controllerPath = "/workspace-a/app/Http/Controllers/CommentController.php";
    const commentPath = "/workspace-a/app/Models/Comment.php";
    const packageCommentPath = "/workspace-a/vendor/shared/package/src/Models/Comment.php";
    const controllerSource = `<?php
namespace App\\Http\\Controllers;

use App\\Models\\Comment;

class CommentController
{
    public function index(): void
    {
        $foundComment = Comment::whereContent('hello')->first();
        $foundComment->getC
    }
}
`;
    const commentSource = `<?php
namespace App\\Models;

class Comment
{
    protected $fillable = [
        'content',
    ];

    public function getContent(): string {}
}
`;
    const staleDynamicWhereRead = createDeferred<string>();
    let commentReadCount = 0;
    let packageCommentReadCount = 0;
    let completionsPromise: ReturnType<WorkbenchController["providePhpMethodCompletions"]> | null =
      null;
    const { getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace-a",
        workspaceTabs: ["/workspace-a", "/workspace-b"],
      },
      readTextFile: vi.fn(async (path: string) => {
        if (path === controllerPath) {
          return controllerSource;
        }

        if (path === commentPath) {
          commentReadCount += 1;
          return commentReadCount === 1 ? staleDynamicWhereRead.promise : commentSource;
        }

        if (path === packageCommentPath) {
          packageCommentReadCount += 1;
          return commentSource;
        }

        return `<?php\n// ${path}\n`;
      }),
      workspaceDescriptor: phpWorkspaceDescriptor({
        packageName: "app/app",
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
          {
            classmapRoots: [],
            dev: false,
            installPath: "../shared/package",
            name: "shared/package",
            packageType: "library",
            psr4Roots: [
              {
                dev: false,
                namespace: "App\\",
                paths: ["src/"],
              },
            ],
            version: "1.0.0",
          },
        ],
      }),
    });
    await flushAsyncTurns();
    await act(async () => {
      await getWorkbench().setSmartMode("fullSmart");
    });
    await act(async () => {
      await getWorkbench().openFile(fileEntry(controllerPath, "CommentController.php"));
    });

    act(() => {
      completionsPromise = getWorkbench().providePhpMethodCompletions(
        controllerSource,
        positionAfter(controllerSource, "$foundComment->getC"),
      );
    });
    await waitForReact(() => {
      expect(commentReadCount).toBe(1);
    });
    const packageReadsBeforeSwitch = packageCommentReadCount;

    await act(async () => {
      await getWorkbench().activateWorkspaceTab("/workspace-b");
    });
    await flushAsyncTurns();

    staleDynamicWhereRead.resolve(commentSource);

    await expect(completionsPromise!).resolves.toEqual([]);
    expect(getWorkbench().workspaceRoot).toBe("/workspace-b");
    expect(packageCommentReadCount).toBe(packageReadsBeforeSwitch);
  });
  it("does not expose Laravel dynamic where helpers in plain Composer projects", async () => {
    let diagnosticsListener: ((event: LanguageServerDiagnosticEvent) => void) | null = null;
    const controllerPath = "/workspace/app/Http/Controllers/CommentController.php";
    const commentPath = "/workspace/app/Models/Comment.php";
    const controllerSource = `<?php
namespace App\\Http\\Controllers;

use App\\Models\\Comment;

class CommentController
{
    public function index(): void
    {
        Comment::whereCon
    }
}
`;
    const runningStatus: LanguageServerRuntimeStatus = {
      capabilities: emptyLanguageServerCapabilities(),
      kind: "running",
      sessionId: 14,
    };
    const diagnosticsGateway: LanguageServerDiagnosticsGateway = {
      subscribeDiagnostics: vi.fn(async (listener) => {
        diagnosticsListener = listener;
        return () => undefined;
      }),
    };
    const { getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace",
      },
      languageServerDiagnosticsGateway: diagnosticsGateway,
      readTextFile: vi.fn(async (path: string) => {
        if (path === controllerPath) {
          return controllerSource;
        }

        if (path === commentPath) {
          return `<?php
namespace App\\Models;

class Comment
{
    protected $fillable = [
        'content',
    ];
}
`;
        }

        return `<?php\n// ${path}\n`;
      }),
      runtimeStatus: runningStatus,
      workspaceDescriptor: phpWorkspaceDescriptor({
        packageName: "custom/api",
        packages: [],
      }),
    });
    await flushAsyncTurns(24);
    await act(async () => {
      await getWorkbench().setSmartMode("fullSmart");
    });
    await act(async () => {
      await getWorkbench().openFile(fileEntry(controllerPath, "CommentController.php"));
    });

    await expect(
      getWorkbench().providePhpMethodCompletions(
        controllerSource,
        positionAfter(controllerSource, "Comment::whereCon"),
      ),
    ).resolves.toEqual([]);

    expect(diagnosticsListener).not.toBeNull();

    act(() => {
      diagnosticsListener?.({
        diagnostics: [
          {
            character: 24,
            line: 10,
            message: "Method App\\Models\\Comment::whereContent() does not exist",
            severity: "error",
            source: "phpactor",
          },
        ],
        rootPath: "/workspace",
        sessionId: runningStatus.sessionId,
        uri: fileUriFromPath(controllerPath),
        version: null,
      });
    });
    await flushAsyncTurns();

    expect(getWorkbench().languageServerDiagnosticsByPath[controllerPath]).toEqual([
      {
        character: 24,
        line: 10,
        message: "Method App\\Models\\Comment::whereContent() does not exist",
        severity: "error",
        source: "phpactor",
      },
    ]);
  });
  it("keeps Laravel Eloquent builder generics through fluent chains", async () => {
    const controllerPath = "/workspace/app/Http/Controllers/AlbumController.php";
    const albumCollectionPath = "/workspace/app/Collections/AlbumCollection.php";
    const albumPath = "/workspace/app/Models/Album.php";
    const albumRepositoryPath = "/workspace/app/Repositories/AlbumRepository.php";
    const builderPath =
      "/workspace/vendor/laravel/framework/src/Illuminate/Database/Eloquent/Builder.php";
    const controllerSource = `<?php
namespace App\\Http\\Controllers;

use App\\Collections\\AlbumCollection;
use App\\Models\\Album;
use App\\Repositories\\AlbumRepository;

class AlbumController
{
    public function index(Album $existingAlbum, AlbumRepository $albums): void
    {
        $album = Album::query()->whereNull('parent_id')->first();
        $album->get

        $existingAlbum->pub
        $existingAlbum->pop
        $existingAlbum->published()->ord

        $multilineAlbum = Album::query()
            ->whereNull('parent_id')
            ->first();
        $multilineAlbum->get

        $factoryAlbum = $existingAlbum->newQuery()->whereNull('parent_id')->first();
        $factoryAlbum->get

        $factoryQuery = $existingAlbum->newModelQuery();
        $factoryQuery->pub
        $factoryQuery->published()->ord

        $trashedAlbum = Album::withTrashed()->whereNull('parent_id')->first();
        $trashedAlbum->get

        Album::withR
        Album::withRelations(
        Album::pub
        Album::published(

        $albumWithRelations = Album::withRelations()->findOrFail(1);
        $albumWithRelations->get

        $albumFromCollection = Album::query()->whereNull('parent_id')->get()->first();
        $albumFromCollection->get

        $filteredAlbumFromCollection = Album::query()->whereNull('parent_id')->get()->filter()->first();
        $filteredAlbumFromCollection->get

        $albums = Album::query()->get();
        $albumFromAssignedCollection = $albums->first();
        $albumFromAssignedCollection->get

        $filteredAlbums = Album::query()->get()->filter();
        $albumFromAssignedFilteredCollection = $filteredAlbums->first();
        $albumFromAssignedFilteredCollection->get

        $query = Album::query();
        $query->whereNull('parent_id')->ord
        $query->withTrashed()->ord
        $query->pub
        $query->published()->ord

        $scopedAlbum = Album::query()->published()->first();
        $scopedAlbum->get

        /** @var \\Illuminate\\Database\\Eloquent\\Builder<Album> $typedQuery */
        $typedQuery = Album::query();
        $typed = $typedQuery->first();
        $typed->get

        /** @var \\Illuminate\\Database\\Eloquent\\Collection<int, Album> $typedAlbums */
        $typedAlbums = Album::query()->get();
        $typedAlbum = $typedAlbums->first();
        $typedAlbum->get

        /** @var \\Illuminate\\Database\\Eloquent\\Collection<int, Album> $documentedAlbums */
        $documentedAlbum = $documentedAlbums->first();
        $documentedAlbum->get

        /** @var AlbumCollection $customAlbums */
        $customAlbum = $customAlbums->first();
        $customAlbum->get

        $repositoryQuery = $albums->query();
        $repositoryQuery->pub
        $repositoryQuery->published()->ord
        $repositoryAlbum = $albums->query()->published()->first();
        $repositoryAlbum->get

        $repositoryCollectionAlbum = $albums->matching()->first();
        $repositoryCollectionAlbum->get

        $repositoryBodyQuery = $albums->queryFromBody();
        $repositoryBodyQuery->published()->ord

        $repositoryBodyCollectionAlbum = $albums->matchingFromBody()->first();
        $repositoryBodyCollectionAlbum->get

        /** @var Result<Album> $result */
        $resultAlbum = $result->first();
        $resultAlbum->get

        /** @var Paginator<Album> $paginator */
        $paginatorAlbum = $paginator->first();
        $paginatorAlbum->get
    }
}
`;
    const { getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace",
      },
      projectSymbols: [
        {
          column: 7,
          containerName: null,
          fullyQualifiedName: "App\\Repositories\\AlbumRepository",
          kind: "class",
          lineNumber: 8,
          name: "AlbumRepository",
          path: albumRepositoryPath,
          relativePath: "app/Repositories/AlbumRepository.php",
        },
      ],
      readTextFile: vi.fn(async (path: string) => {
        if (path === controllerPath) {
          return controllerSource;
        }

        if (path === albumPath) {
          return `<?php
namespace App\\Models;

use Illuminate\\Database\\Eloquent\\Attributes\\Scope;
use Illuminate\\Database\\Eloquent\\Builder;

class Album
{
    public string $title;

    public function getTitle(): string {}

    public function scopePublished($query, bool $strict = true): void {}
    #[Scope]
    protected function popular(Builder $query): void {}
    public function scopeWithRelations(Builder $query): Builder {}
}
`;
        }

        if (path === albumCollectionPath) {
          return `<?php
namespace App\\Collections;

use App\\Models\\Album;
use Illuminate\\Database\\Eloquent\\Collection;

/** @phpstan-extends Collection<int, Album> */
class AlbumCollection extends Collection
{
}
`;
        }

        if (path === albumRepositoryPath) {
          return `<?php
namespace App\\Repositories;

use App\\Models\\Album;
use Illuminate\\Database\\Eloquent\\Builder;
use Illuminate\\Database\\Eloquent\\Collection;

class AlbumRepository
{
    /** @return Builder<Album> */
    public function query(): Builder {}

    public function matching(): Collection {}

    public function queryFromBody()
    {
        return Album::query()->published();
    }

    public function matchingFromBody()
    {
        return Album::query()->published()->get()->filter();
    }
}
`;
        }

        if (path === builderPath) {
          return `<?php
namespace Illuminate\\Database\\Eloquent;

class Builder
{
    /** @return static */
    public function whereNull($columns, $boolean = 'and', $not = false) {}

    /** @return static */
    public function orderBy($column, $direction = 'asc') {}

    /** @return \\Illuminate\\Database\\Eloquent\\Collection<int, TModel> */
    public function get($columns = ['*']) {}

    /** @return TModel|null */
    public function first($columns = ['*']) {}
}
`;
        }

        return `<?php\n// ${path}\n`;
      }),
      workspaceDescriptor: phpWorkspaceDescriptor(),
    });
    await flushAsyncTurns();
    await act(async () => {
      await getWorkbench().setSmartMode("fullSmart");
    });

    await act(async () => {
      await getWorkbench().openFile(fileEntry(controllerPath, "AlbumController.php"));
    });

    await expect(
      getWorkbench().providePhpMethodCompletions(
        controllerSource,
        positionAfter(controllerSource, "$album->get"),
      ),
    ).resolves.toEqual([
      {
        declaringClassName: "App\\Models\\Album",
        name: "getTitle",
        parameters: "",
        returnType: "string",
      },
    ]);
    await expect(
      getWorkbench().providePhpMethodCompletions(
        controllerSource,
        positionAfter(controllerSource, "$existingAlbum->pub"),
      ),
    ).resolves.toEqual([
      {
        declaringClassName: "App\\Models\\Album",
        kind: "scope",
        name: "published",
        parameters: "bool $strict = true",
        returnType: "Illuminate\\Database\\Eloquent\\Builder",
      },
    ]);
    await expect(
      getWorkbench().providePhpMethodCompletions(
        controllerSource,
        positionAfter(controllerSource, "$existingAlbum->pop"),
      ),
    ).resolves.toEqual([
      {
        declaringClassName: "App\\Models\\Album",
        kind: "scope",
        name: "popular",
        parameters: "",
        returnType: "Illuminate\\Database\\Eloquent\\Builder",
      },
    ]);
    await expect(
      getWorkbench().providePhpMethodCompletions(
        controllerSource,
        positionAfter(controllerSource, "$existingAlbum->published()->ord"),
      ),
    ).resolves.toEqual([
      {
        declaringClassName: "Illuminate\\Database\\Eloquent\\Builder",
        name: "orderBy",
        parameters: "$column, $direction = 'asc'",
        returnType: "static",
      },
    ]);
    await expect(
      getWorkbench().providePhpMethodCompletions(
        controllerSource,
        positionAfter(controllerSource, "$multilineAlbum->get"),
      ),
    ).resolves.toEqual([
      {
        declaringClassName: "App\\Models\\Album",
        name: "getTitle",
        parameters: "",
        returnType: "string",
      },
    ]);
    await expect(
      getWorkbench().providePhpMethodCompletions(
        controllerSource,
        positionAfter(controllerSource, "$repositoryQuery->pub"),
      ),
    ).resolves.toEqual([
      {
        declaringClassName: "App\\Models\\Album",
        kind: "scope",
        name: "published",
        parameters: "bool $strict = true",
        returnType: "Illuminate\\Database\\Eloquent\\Builder",
      },
    ]);
    await expect(
      getWorkbench().providePhpMethodCompletions(
        controllerSource,
        positionAfter(controllerSource, "$repositoryQuery->published()->ord"),
      ),
    ).resolves.toEqual([
      {
        declaringClassName: "Illuminate\\Database\\Eloquent\\Builder",
        name: "orderBy",
        parameters: "$column, $direction = 'asc'",
        returnType: "static",
      },
    ]);
    await expect(
      getWorkbench().providePhpMethodCompletions(
        controllerSource,
        positionAfter(controllerSource, "$repositoryAlbum->get"),
      ),
    ).resolves.toEqual([
      {
        declaringClassName: "App\\Models\\Album",
        name: "getTitle",
        parameters: "",
        returnType: "string",
      },
    ]);
    await expect(
      getWorkbench().providePhpMethodCompletions(
        controllerSource,
        positionAfter(controllerSource, "$repositoryCollectionAlbum->get"),
      ),
    ).resolves.toEqual([
      {
        declaringClassName: "App\\Models\\Album",
        name: "getTitle",
        parameters: "",
        returnType: "string",
      },
    ]);
    await expect(
      getWorkbench().providePhpMethodCompletions(
        controllerSource,
        positionAfter(controllerSource, "$repositoryBodyQuery->published()->ord"),
      ),
    ).resolves.toEqual([
      {
        declaringClassName: "Illuminate\\Database\\Eloquent\\Builder",
        name: "orderBy",
        parameters: "$column, $direction = 'asc'",
        returnType: "static",
      },
    ]);
    await expect(
      getWorkbench().providePhpMethodCompletions(
        controllerSource,
        positionAfter(controllerSource, "$repositoryBodyCollectionAlbum->get"),
      ),
    ).resolves.toEqual([
      {
        declaringClassName: "App\\Models\\Album",
        name: "getTitle",
        parameters: "",
        returnType: "string",
      },
    ]);
    await expect(
      getWorkbench().providePhpMethodCompletions(
        controllerSource,
        positionAfter(controllerSource, "$albumFromCollection->get"),
      ),
    ).resolves.toEqual([
      {
        declaringClassName: "App\\Models\\Album",
        name: "getTitle",
        parameters: "",
        returnType: "string",
      },
    ]);
    await expect(
      getWorkbench().providePhpMethodCompletions(
        controllerSource,
        positionAfter(controllerSource, "$factoryAlbum->get"),
      ),
    ).resolves.toEqual([
      {
        declaringClassName: "App\\Models\\Album",
        name: "getTitle",
        parameters: "",
        returnType: "string",
      },
    ]);
    await expect(
      getWorkbench().providePhpMethodCompletions(
        controllerSource,
        positionAfter(controllerSource, "$factoryQuery->pub"),
      ),
    ).resolves.toEqual([
      {
        declaringClassName: "App\\Models\\Album",
        kind: "scope",
        name: "published",
        parameters: "bool $strict = true",
        returnType: "Illuminate\\Database\\Eloquent\\Builder",
      },
    ]);
    await expect(
      getWorkbench().providePhpMethodCompletions(
        controllerSource,
        positionAfter(controllerSource, "$factoryQuery->published()->ord"),
      ),
    ).resolves.toEqual([
      {
        declaringClassName: "Illuminate\\Database\\Eloquent\\Builder",
        name: "orderBy",
        parameters: "$column, $direction = 'asc'",
        returnType: "static",
      },
    ]);
    await expect(
      getWorkbench().providePhpMethodCompletions(
        controllerSource,
        positionAfter(controllerSource, "$filteredAlbumFromCollection->get"),
      ),
    ).resolves.toEqual([
      {
        declaringClassName: "App\\Models\\Album",
        name: "getTitle",
        parameters: "",
        returnType: "string",
      },
    ]);
    await expect(
      getWorkbench().providePhpMethodCompletions(
        controllerSource,
        positionAfter(controllerSource, "$trashedAlbum->get"),
      ),
    ).resolves.toEqual([
      {
        declaringClassName: "App\\Models\\Album",
        name: "getTitle",
        parameters: "",
        returnType: "string",
      },
    ]);
    await expect(
      getWorkbench().providePhpMethodCompletions(
        controllerSource,
        positionAfter(controllerSource, "Album::withR"),
      ),
    ).resolves.toEqual([
      {
        declaringClassName: "App\\Models\\Album",
        isStatic: true,
        kind: "scope",
        name: "withRelations",
        parameters: "",
        returnType: "Builder",
      },
    ]);
    await expect(
      getWorkbench().providePhpMethodSignature(
        controllerSource,
        positionAfter(controllerSource, "Album::withRelations("),
      ),
    ).resolves.toEqual({
      argumentIndex: 0,
      method: {
        declaringClassName: "App\\Models\\Album",
        isStatic: true,
        kind: "scope",
        name: "withRelations",
        parameters: "",
        returnType: "Builder",
      },
      parameters: [],
    });
    await expect(
      getWorkbench().providePhpMethodCompletions(
        controllerSource,
        positionAfter(controllerSource, "Album::pub"),
      ),
    ).resolves.toEqual([
      {
        declaringClassName: "App\\Models\\Album",
        isStatic: true,
        kind: "scope",
        name: "published",
        parameters: "bool $strict = true",
        returnType: "Illuminate\\Database\\Eloquent\\Builder",
      },
    ]);
    await expect(
      getWorkbench().providePhpMethodSignature(
        controllerSource,
        positionAfter(controllerSource, "Album::published("),
      ),
    ).resolves.toEqual({
      argumentIndex: 0,
      method: {
        declaringClassName: "App\\Models\\Album",
        isStatic: true,
        kind: "scope",
        name: "published",
        parameters: "bool $strict = true",
        returnType: "Illuminate\\Database\\Eloquent\\Builder",
      },
      parameters: [
        {
          defaultValue: "true",
          name: "$strict",
          optional: true,
          raw: "bool $strict = true",
          type: "bool",
        },
      ],
    });
    await expect(
      getWorkbench().providePhpMethodCompletions(
        controllerSource,
        positionAfter(controllerSource, "$albumWithRelations->get"),
      ),
    ).resolves.toEqual([
      {
        declaringClassName: "App\\Models\\Album",
        name: "getTitle",
        parameters: "",
        returnType: "string",
      },
    ]);
    await expect(
      getWorkbench().providePhpMethodCompletions(
        controllerSource,
        positionAfter(controllerSource, "$albumFromAssignedCollection->get"),
      ),
    ).resolves.toEqual([
      {
        declaringClassName: "App\\Models\\Album",
        name: "getTitle",
        parameters: "",
        returnType: "string",
      },
    ]);
    await expect(
      getWorkbench().providePhpMethodCompletions(
        controllerSource,
        positionAfter(controllerSource, "$albumFromAssignedFilteredCollection->get"),
      ),
    ).resolves.toEqual([
      {
        declaringClassName: "App\\Models\\Album",
        name: "getTitle",
        parameters: "",
        returnType: "string",
      },
    ]);
    await expect(
      getWorkbench().providePhpMethodCompletions(
        controllerSource,
        positionAfter(controllerSource, "$query->whereNull('parent_id')->ord"),
      ),
    ).resolves.toEqual([
      {
        declaringClassName: "Illuminate\\Database\\Eloquent\\Builder",
        name: "orderBy",
        parameters: "$column, $direction = 'asc'",
        returnType: "static",
      },
    ]);
    await expect(
      getWorkbench().providePhpMethodCompletions(
        controllerSource,
        positionAfter(controllerSource, "$query->withTrashed()->ord"),
      ),
    ).resolves.toEqual([
      {
        declaringClassName: "Illuminate\\Database\\Eloquent\\Builder",
        name: "orderBy",
        parameters: "$column, $direction = 'asc'",
        returnType: "static",
      },
    ]);
    await expect(
      getWorkbench().providePhpMethodCompletions(
        controllerSource,
        positionAfter(controllerSource, "$query->pub"),
      ),
    ).resolves.toEqual([
      {
        declaringClassName: "App\\Models\\Album",
        kind: "scope",
        name: "published",
        parameters: "bool $strict = true",
        returnType: "Illuminate\\Database\\Eloquent\\Builder",
      },
    ]);
    await expect(
      getWorkbench().providePhpMethodCompletions(
        controllerSource,
        positionAfter(controllerSource, "$query->published()->ord"),
      ),
    ).resolves.toEqual([
      {
        declaringClassName: "Illuminate\\Database\\Eloquent\\Builder",
        name: "orderBy",
        parameters: "$column, $direction = 'asc'",
        returnType: "static",
      },
    ]);
    await expect(
      getWorkbench().providePhpMethodCompletions(
        controllerSource,
        positionAfter(controllerSource, "$scopedAlbum->get"),
      ),
    ).resolves.toEqual([
      {
        declaringClassName: "App\\Models\\Album",
        name: "getTitle",
        parameters: "",
        returnType: "string",
      },
    ]);
    await expect(
      getWorkbench().providePhpMethodCompletions(
        controllerSource,
        positionAfter(controllerSource, "$typedAlbum->get"),
      ),
    ).resolves.toEqual([
      {
        declaringClassName: "App\\Models\\Album",
        name: "getTitle",
        parameters: "",
        returnType: "string",
      },
    ]);
    await expect(
      getWorkbench().providePhpMethodCompletions(
        controllerSource,
        positionAfter(controllerSource, "$typed->get"),
      ),
    ).resolves.toEqual([
      {
        declaringClassName: "App\\Models\\Album",
        name: "getTitle",
        parameters: "",
        returnType: "string",
      },
    ]);
    await expect(
      getWorkbench().providePhpMethodCompletions(
        controllerSource,
        positionAfter(controllerSource, "$documentedAlbum->get"),
      ),
    ).resolves.toEqual([
      {
        declaringClassName: "App\\Models\\Album",
        name: "getTitle",
        parameters: "",
        returnType: "string",
      },
    ]);
    await expect(
      getWorkbench().providePhpMethodCompletions(
        controllerSource,
        positionAfter(controllerSource, "$customAlbum->get"),
      ),
    ).resolves.toEqual([
      {
        declaringClassName: "App\\Models\\Album",
        name: "getTitle",
        parameters: "",
        returnType: "string",
      },
    ]);
    await expect(
      getWorkbench().providePhpMethodCompletions(
        controllerSource,
        positionAfter(controllerSource, "$resultAlbum->get"),
      ),
    ).resolves.toEqual([]);
    await expect(
      getWorkbench().providePhpMethodCompletions(
        controllerSource,
        positionAfter(controllerSource, "$paginatorAlbum->get"),
      ),
    ).resolves.toEqual([]);
  });
  it("stops stale PHP collection model type traversal after switching project tabs", async () => {
    const controllerPath = "/workspace-a/app/Http/Controllers/AlbumController.php";
    const collectionPath = "/workspace-a/app/Collections/AlbumCollection.php";
    const workspaceBBaseCollectionPath = "/workspace-b/app/Collections/BaseAlbumCollection.php";
    const controllerSource = `<?php
namespace App\\Http\\Controllers;

use App\\Collections\\AlbumCollection;

class AlbumController
{
    public function index(): void
    {
        /** @var AlbumCollection $customAlbums */
        $customAlbum = $customAlbums->first();
        $customAlbum->get
    }
}
`;
    const staleCollectionRead = createDeferred<string>();
    let collectionReadCount = 0;
    let workspaceBBaseCollectionReadCount = 0;
    const { getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace-a",
        workspaceTabs: ["/workspace-a", "/workspace-b"],
      },
      readTextFile: vi.fn(async (path: string) => {
        if (path === controllerPath) {
          return controllerSource;
        }

        if (path === collectionPath) {
          collectionReadCount += 1;
          return staleCollectionRead.promise;
        }

        if (path === workspaceBBaseCollectionPath) {
          workspaceBBaseCollectionReadCount += 1;
          return `<?php
namespace App\\Collections;

/** @phpstan-extends \\Illuminate\\Database\\Eloquent\\Collection<int, \\App\\Models\\Album> */
class BaseAlbumCollection
{
}
`;
        }

        return `<?php\n// ${path}\n`;
      }),
      workspaceDescriptor: phpWorkspaceDescriptor(),
    });
    await flushAsyncTurns();
    await act(async () => {
      await getWorkbench().openFile(fileEntry(controllerPath, "AlbumController.php"));
    });

    let completionsPromise: ReturnType<WorkbenchController["providePhpMethodCompletions"]> | null =
      null;
    await act(async () => {
      completionsPromise = getWorkbench().providePhpMethodCompletions(
        controllerSource,
        positionAfter(controllerSource, "$customAlbum->get"),
      );
      await Promise.resolve();
    });
    await waitForReact(() => {
      expect(collectionReadCount).toBe(1);
    });

    await act(async () => {
      await getWorkbench().activateWorkspaceTab("/workspace-b");
    });
    await flushAsyncTurns();

    staleCollectionRead.resolve(`<?php
namespace App\\Collections;

class AlbumCollection extends BaseAlbumCollection
{
}
`);

    expect(completionsPromise).not.toBeNull();
    await expect(completionsPromise).resolves.toEqual([]);
    await flushAsyncTurns(24);

    expect(getWorkbench().workspaceRoot).toBe("/workspace-b");
    expect(workspaceBBaseCollectionReadCount).toBe(0);
  });
  it("infers Laravel relation query callback builders", async () => {
    const controllerPath = "/workspace/app/Http/Controllers/AlbumController.php";
    const albumPath = "/workspace/app/Models/Album.php";
    const artistPath = "/workspace/app/Models/Artist.php";
    const postPath = "/workspace/app/Models/Post.php";
    const trackPath = "/workspace/app/Models/Track.php";
    const builderPath =
      "/workspace/vendor/laravel/framework/src/Illuminate/Database/Eloquent/Builder.php";
    const controllerSource = `<?php
namespace App\\Http\\Controllers;

use App\\Models\\Album;
use App\\Models\\Post;

class AlbumController
{
    public function index(): void
    {
        Album::query()->whereHas('tracks', function ($query): void {
            $query->pub
            $query->published()->ord
            $track = $query->first();
            $track->get
        });

        Album::query()->whereHas('tracks', fn ($arrowQuery) => $arrowQuery->pub);

        Album::query()->with(['tracks.artist' => function ($artistQuery): void {
            $artistQuery->pub
            $artistQuery->published()->ord
            $artist = $artistQuery->first();
            $artist->get
        }]);

        Album::query()->whereHasMorph('commentable', [Post::class], function ($morphQuery): void {
            $morphQuery->pub
            $morphQuery->published()->ord
            $post = $morphQuery->first();
            $post->get
        });

        Album::query()->when($flag, function ($whenQuery): void {
            $whenQuery->pub
            $whenQuery->published()->ord
            $whenAlbum = $whenQuery->first();
            $whenAlbum->get
        });

        Album::query()->unless($flag, function ($unlessQuery): void {
            $unlessQuery->pub
            $unlessQuery->published()->ord
            $unlessAlbum = $unlessQuery->first();
            $unlessAlbum->get
        });

        Album::query()->tap(function ($tapQuery): void {
            $tapQuery->pub
            $tapQuery->published()->ord
            $tapAlbum = $tapQuery->first();
            $tapAlbum->get
        });
    }
}
`;
    const { getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace",
      },
      projectSymbols: [
        {
          column: 7,
          containerName: null,
          fullyQualifiedName: "App\\Models\\Album",
          kind: "class",
          lineNumber: 7,
          name: "Album",
          path: albumPath,
          relativePath: "app/Models/Album.php",
        },
        {
          column: 7,
          containerName: null,
          fullyQualifiedName: "App\\Models\\Artist",
          kind: "class",
          lineNumber: 7,
          name: "Artist",
          path: artistPath,
          relativePath: "app/Models/Artist.php",
        },
        {
          column: 7,
          containerName: null,
          fullyQualifiedName: "App\\Models\\Post",
          kind: "class",
          lineNumber: 7,
          name: "Post",
          path: postPath,
          relativePath: "app/Models/Post.php",
        },
        {
          column: 7,
          containerName: null,
          fullyQualifiedName: "App\\Models\\Track",
          kind: "class",
          lineNumber: 7,
          name: "Track",
          path: trackPath,
          relativePath: "app/Models/Track.php",
        },
      ],
      readTextFile: vi.fn(async (path: string) => {
        if (path === controllerPath) {
          return controllerSource;
        }

        if (path === albumPath) {
          return `<?php
namespace App\\Models;

use Illuminate\\Database\\Eloquent\\Builder;
use Illuminate\\Database\\Eloquent\\Relations\\HasMany;
use Illuminate\\Database\\Eloquent\\Relations\\MorphTo;

class Album
{
    public function getTitle(): string {}

    public function scopePublished(Builder $query): Builder {}

    public function tracks(): HasMany
    {
        $related = Track::class;
        return $this->hasMany($related);
    }

    public function commentable(): MorphTo
    {
        return $this->morphTo();
    }
}
`;
        }

        if (path === artistPath) {
          return `<?php
namespace App\\Models;

use Illuminate\\Database\\Eloquent\\Builder;

class Artist
{
    public function getTitle(): string {}

    public function scopePublished(Builder $query): Builder {}
}
`;
        }

        if (path === postPath) {
          return `<?php
namespace App\\Models;

use Illuminate\\Database\\Eloquent\\Builder;

class Post
{
    public function getTitle(): string {}

    public function scopePublished(Builder $query): Builder {}
}
`;
        }

        if (path === trackPath) {
          return `<?php
namespace App\\Models;

use Illuminate\\Database\\Eloquent\\Builder;
use Illuminate\\Database\\Eloquent\\Relations\\BelongsTo;

class Track
{
    public function getTitle(): string {}

    public function scopePublished(Builder $query): Builder {}

    public function artist(): BelongsTo
    {
        return $this->belongsTo(Artist::class);
    }
}
`;
        }

        if (path === builderPath) {
          return `<?php
namespace Illuminate\\Database\\Eloquent;

class Builder
{
    /** @return static */
    public function orderBy($column, $direction = 'asc') {}

    /** @return TModel|null */
    public function first($columns = ['*']) {}
}
`;
        }

        return `<?php\n// ${path}\n`;
      }),
      workspaceDescriptor: phpWorkspaceDescriptor(),
    });
    await flushAsyncTurns();
    await act(async () => {
      await getWorkbench().setSmartMode("fullSmart");
    });

    await act(async () => {
      await getWorkbench().openFile(fileEntry(controllerPath, "AlbumController.php"));
    });

    await expect(
      getWorkbench().providePhpMethodCompletions(
        controllerSource,
        positionAfter(controllerSource, "$query->pub"),
      ),
    ).resolves.toEqual([
      {
        declaringClassName: "App\\Models\\Track",
        kind: "scope",
        name: "published",
        parameters: "",
        returnType: "Builder",
      },
    ]);
    await expect(
      getWorkbench().providePhpMethodCompletions(
        controllerSource,
        positionAfter(controllerSource, "$query->published()->ord"),
      ),
    ).resolves.toEqual([
      {
        declaringClassName: "Illuminate\\Database\\Eloquent\\Builder",
        name: "orderBy",
        parameters: "$column, $direction = 'asc'",
        returnType: "static",
      },
    ]);
    await expect(
      getWorkbench().providePhpMethodCompletions(
        controllerSource,
        positionAfter(controllerSource, "$track->get"),
      ),
    ).resolves.toEqual([
      {
        declaringClassName: "App\\Models\\Track",
        name: "getTitle",
        parameters: "",
        returnType: "string",
      },
    ]);
    await expect(
      getWorkbench().providePhpMethodCompletions(
        controllerSource,
        positionAfter(controllerSource, "$arrowQuery->pub"),
      ),
    ).resolves.toEqual([
      {
        declaringClassName: "App\\Models\\Track",
        kind: "scope",
        name: "published",
        parameters: "",
        returnType: "Builder",
      },
    ]);
    await expect(
      getWorkbench().providePhpMethodCompletions(
        controllerSource,
        positionAfter(controllerSource, "$morphQuery->pub"),
      ),
    ).resolves.toEqual([
      {
        declaringClassName: "App\\Models\\Post",
        kind: "scope",
        name: "published",
        parameters: "",
        returnType: "Builder",
      },
    ]);
    await expect(
      getWorkbench().providePhpMethodCompletions(
        controllerSource,
        positionAfter(controllerSource, "$artistQuery->pub"),
      ),
    ).resolves.toEqual([
      {
        declaringClassName: "App\\Models\\Artist",
        kind: "scope",
        name: "published",
        parameters: "",
        returnType: "Builder",
      },
    ]);
    await expect(
      getWorkbench().providePhpMethodCompletions(
        controllerSource,
        positionAfter(controllerSource, "$artistQuery->published()->ord"),
      ),
    ).resolves.toEqual([
      {
        declaringClassName: "Illuminate\\Database\\Eloquent\\Builder",
        name: "orderBy",
        parameters: "$column, $direction = 'asc'",
        returnType: "static",
      },
    ]);
    await expect(
      getWorkbench().providePhpMethodCompletions(
        controllerSource,
        positionAfter(controllerSource, "$artist->get"),
      ),
    ).resolves.toEqual([
      {
        declaringClassName: "App\\Models\\Artist",
        name: "getTitle",
        parameters: "",
        returnType: "string",
      },
    ]);
    await expect(
      getWorkbench().providePhpMethodCompletions(
        controllerSource,
        positionAfter(controllerSource, "$morphQuery->published()->ord"),
      ),
    ).resolves.toEqual([
      {
        declaringClassName: "Illuminate\\Database\\Eloquent\\Builder",
        name: "orderBy",
        parameters: "$column, $direction = 'asc'",
        returnType: "static",
      },
    ]);
    await expect(
      getWorkbench().providePhpMethodCompletions(
        controllerSource,
        positionAfter(controllerSource, "$post->get"),
      ),
    ).resolves.toEqual([
      {
        declaringClassName: "App\\Models\\Post",
        name: "getTitle",
        parameters: "",
        returnType: "string",
      },
    ]);
    await expect(
      getWorkbench().providePhpMethodCompletions(
        controllerSource,
        positionAfter(controllerSource, "$whenQuery->pub"),
      ),
    ).resolves.toEqual([
      {
        declaringClassName: "App\\Models\\Album",
        kind: "scope",
        name: "published",
        parameters: "",
        returnType: "Builder",
      },
    ]);
    await expect(
      getWorkbench().providePhpMethodCompletions(
        controllerSource,
        positionAfter(controllerSource, "$whenQuery->published()->ord"),
      ),
    ).resolves.toEqual([
      {
        declaringClassName: "Illuminate\\Database\\Eloquent\\Builder",
        name: "orderBy",
        parameters: "$column, $direction = 'asc'",
        returnType: "static",
      },
    ]);
    await expect(
      getWorkbench().providePhpMethodCompletions(
        controllerSource,
        positionAfter(controllerSource, "$whenAlbum->get"),
      ),
    ).resolves.toEqual([
      {
        declaringClassName: "App\\Models\\Album",
        name: "getTitle",
        parameters: "",
        returnType: "string",
      },
    ]);
    await expect(
      getWorkbench().providePhpMethodCompletions(
        controllerSource,
        positionAfter(controllerSource, "$unlessQuery->pub"),
      ),
    ).resolves.toEqual([
      {
        declaringClassName: "App\\Models\\Album",
        kind: "scope",
        name: "published",
        parameters: "",
        returnType: "Builder",
      },
    ]);
    await expect(
      getWorkbench().providePhpMethodCompletions(
        controllerSource,
        positionAfter(controllerSource, "$unlessQuery->published()->ord"),
      ),
    ).resolves.toEqual([
      {
        declaringClassName: "Illuminate\\Database\\Eloquent\\Builder",
        name: "orderBy",
        parameters: "$column, $direction = 'asc'",
        returnType: "static",
      },
    ]);
    await expect(
      getWorkbench().providePhpMethodCompletions(
        controllerSource,
        positionAfter(controllerSource, "$unlessAlbum->get"),
      ),
    ).resolves.toEqual([
      {
        declaringClassName: "App\\Models\\Album",
        name: "getTitle",
        parameters: "",
        returnType: "string",
      },
    ]);
    await expect(
      getWorkbench().providePhpMethodCompletions(
        controllerSource,
        positionAfter(controllerSource, "$tapQuery->pub"),
      ),
    ).resolves.toEqual([
      {
        declaringClassName: "App\\Models\\Album",
        kind: "scope",
        name: "published",
        parameters: "",
        returnType: "Builder",
      },
    ]);
    await expect(
      getWorkbench().providePhpMethodCompletions(
        controllerSource,
        positionAfter(controllerSource, "$tapQuery->published()->ord"),
      ),
    ).resolves.toEqual([
      {
        declaringClassName: "Illuminate\\Database\\Eloquent\\Builder",
        name: "orderBy",
        parameters: "$column, $direction = 'asc'",
        returnType: "static",
      },
    ]);
    await expect(
      getWorkbench().providePhpMethodCompletions(
        controllerSource,
        positionAfter(controllerSource, "$tapAlbum->get"),
      ),
    ).resolves.toEqual([
      {
        declaringClassName: "App\\Models\\Album",
        name: "getTitle",
        parameters: "",
        returnType: "string",
      },
    ]);
  });
  it("opens Laravel fluent builder methods from chained calls", async () => {
    const controllerPath = "/workspace/app/Http/Controllers/AlbumController.php";
    const builderPath =
      "/workspace/vendor/laravel/framework/src/Illuminate/Database/Eloquent/Builder.php";
    const controllerSource = `<?php
namespace App\\Http\\Controllers;

use App\\Models\\Album;

class AlbumController
{
    public function index(): void
    {
        $album = Album::query()->whereNull('parent_id')->first();
    }
}
`;
    const { getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace",
      },
      readTextFile: vi.fn(async (path: string) => {
        if (path === controllerPath) {
          return controllerSource;
        }

        if (path === builderPath) {
          return `<?php
namespace Illuminate\\Database\\Eloquent;

class Builder
{
    public function whereNull($columns, $boolean = 'and')
    {
        return $this;
    }

    public function first($columns = ['*'])
    {
    }
}
`;
        }

        return `<?php\n// ${path}\n`;
      }),
      workspaceDescriptor: phpWorkspaceDescriptor(),
    });
    await flushAsyncTurns();
    await act(async () => {
      await getWorkbench().setSmartMode("fullSmart");
    });

    await act(async () => {
      await getWorkbench().openFile(fileEntry(controllerPath, "AlbumController.php"));
    });
    act(() => {
      getWorkbench().updateActiveEditorPosition(positionAfter(controllerSource, "->first"));
    });

    await act(async () => {
      await getWorkbench()
        .commands.find((candidate) => candidate.id === "editor.goToDefinition")
        ?.run();
    });

    expect(getWorkbench().activePath).toBe(builderPath);
    expect(getWorkbench().editorRevealTarget).toEqual({
      path: builderPath,
      position: {
        column: 21,
        lineNumber: 11,
      },
    });
  });
  it("opens Laravel model scopes and builder magic methods", async () => {
    const controllerPath = "/workspace/app/Http/Controllers/AlbumController.php";
    const albumPath = "/workspace/app/Models/Album.php";
    const builderPath =
      "/workspace/vendor/laravel/framework/src/Illuminate/Database/Eloquent/Builder.php";
    const controllerSource = `<?php
namespace App\\Http\\Controllers;

use App\\Models\\Album;

class AlbumController
{
    public function index(): void
    {
        Album::published()->findOrFail(1);
        $query = Album::query();
        $query->published()->first();
        Album::whereNull('parent_id')->first();
    }
}
`;
    const { getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace",
      },
      readTextFile: vi.fn(async (path: string) => {
        if (path === controllerPath) {
          return controllerSource;
        }

        if (path === albumPath) {
          return `<?php
namespace App\\Models;

use Illuminate\\Database\\Eloquent\\Builder;

class Album
{
    public function scopePublished(Builder $query): Builder
    {
        return $query;
    }
}
`;
        }

        if (path === builderPath) {
          return `<?php
namespace Illuminate\\Database\\Eloquent;

class Builder
{
    public function whereNull($columns, $boolean = 'and', $not = false)
    {
        return $this;
    }

    public function findOrFail($id)
    {
    }
}
`;
        }

        return `<?php\n// ${path}\n`;
      }),
      workspaceDescriptor: phpWorkspaceDescriptor(),
    });
    await flushAsyncTurns();
    await act(async () => {
      await getWorkbench().setSmartMode("fullSmart");
    });

    await act(async () => {
      await getWorkbench().openFile(fileEntry(controllerPath, "AlbumController.php"));
    });
    act(() => {
      getWorkbench().updateActiveEditorPosition(
        positionAfter(controllerSource, "Album::published"),
      );
    });

    await act(async () => {
      await getWorkbench()
        .commands.find((candidate) => candidate.id === "editor.goToDefinition")
        ?.run();
    });

    expect(getWorkbench().activePath).toBe(albumPath);
    expect(getWorkbench().editorRevealTarget).toEqual({
      path: albumPath,
      position: {
        column: 21,
        lineNumber: 8,
      },
    });

    await act(async () => {
      await getWorkbench().openFile(fileEntry(controllerPath, "AlbumController.php"));
    });
    act(() => {
      getWorkbench().updateActiveEditorPosition(
        positionAfter(controllerSource, "$query->published"),
      );
    });

    await act(async () => {
      await getWorkbench()
        .commands.find((candidate) => candidate.id === "editor.goToDefinition")
        ?.run();
    });

    expect(getWorkbench().activePath).toBe(albumPath);
    expect(getWorkbench().editorRevealTarget).toEqual({
      path: albumPath,
      position: {
        column: 21,
        lineNumber: 8,
      },
    });

    await act(async () => {
      await getWorkbench().openFile(fileEntry(controllerPath, "AlbumController.php"));
    });
    act(() => {
      getWorkbench().updateActiveEditorPosition(
        positionAfter(controllerSource, "Album::whereNull"),
      );
    });

    await act(async () => {
      await getWorkbench()
        .commands.find((candidate) => candidate.id === "editor.goToDefinition")
        ?.run();
    });

    expect(getWorkbench().activePath).toBe(builderPath);
    expect(getWorkbench().editorRevealTarget).toEqual({
      path: builderPath,
      position: {
        column: 21,
        lineNumber: 6,
      },
    });
  });
  it("opens PHPDoc magic method definitions", async () => {
    const controllerPath = "/workspace/app/Http/Controllers/CommentController.php";
    const factoryPath = "/workspace/app/Factories/CommentFactory.php";
    const controllerSource = `<?php
namespace App\\Http\\Controllers;

use App\\Factories\\CommentFactory;

class CommentController
{
    public function store(): void
    {
        CommentFactory::fromNamed('draft');
        CommentFactory::findForSlug('draft');
        CommentFactory::activeComments();
        CommentFactory::archiveQuietly('draft');
        CommentFactory::restoreBySlug('draft');
    }
}
`;
    const factorySource = `<?php
namespace App\\Factories;

/**
 * @method static object fromNamed(string $name)
 * @method static findForSlug(string $slug)
 * @method static \\Illuminate\\Support\\Collection<int, Comment> activeComments()
 * @phpstan-method static bool archiveQuietly(string $slug)
 * @psalm-method static restoreBySlug(string $slug)
 */
class CommentFactory
{
}
`;
    const { getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace",
      },
      readTextFile: vi.fn(async (path: string) => {
        if (path === controllerPath) {
          return controllerSource;
        }

        if (path === factoryPath) {
          return factorySource;
        }

        return `<?php\n// ${path}\n`;
      }),
      workspaceDescriptor: phpWorkspaceDescriptor(),
    });
    await flushAsyncTurns();
    await act(async () => {
      await getWorkbench().setSmartMode("fullSmart");
    });

    await act(async () => {
      await getWorkbench().openFile(fileEntry(controllerPath, "CommentController.php"));
    });
    act(() => {
      getWorkbench().updateActiveEditorPosition(
        positionAfter(controllerSource, "CommentFactory::fromNamed"),
      );
    });

    await act(async () => {
      await getWorkbench()
        .commands.find((candidate) => candidate.id === "editor.goToDefinition")
        ?.run();
    });

    expect(getWorkbench().activePath).toBe(factoryPath);
    expect(getWorkbench().editorRevealTarget).toEqual({
      path: factoryPath,
      position: {
        column: 26,
        lineNumber: 5,
      },
    });

    await act(async () => {
      await getWorkbench().openFile(fileEntry(controllerPath, "CommentController.php"));
    });
    act(() => {
      getWorkbench().updateActiveEditorPosition(
        positionAfter(controllerSource, "CommentFactory::findForSlug"),
      );
    });

    await act(async () => {
      await getWorkbench()
        .commands.find((candidate) => candidate.id === "editor.goToDefinition")
        ?.run();
    });

    expect(getWorkbench().activePath).toBe(factoryPath);
    expect(getWorkbench().editorRevealTarget).toEqual({
      path: factoryPath,
      position: {
        column: 19,
        lineNumber: lineNumberOf(factorySource, "findForSlug"),
      },
    });

    await act(async () => {
      await getWorkbench().openFile(fileEntry(controllerPath, "CommentController.php"));
    });
    act(() => {
      getWorkbench().updateActiveEditorPosition(
        positionAfter(controllerSource, "CommentFactory::activeComments"),
      );
    });

    await act(async () => {
      await getWorkbench()
        .commands.find((candidate) => candidate.id === "editor.goToDefinition")
        ?.run();
    });

    const activeCommentsPosition = positionAfter(factorySource, "activeComments");
    expect(getWorkbench().activePath).toBe(factoryPath);
    expect(getWorkbench().editorRevealTarget).toEqual({
      path: factoryPath,
      position: {
        column: activeCommentsPosition.column - "activeComments".length,
        lineNumber: activeCommentsPosition.lineNumber,
      },
    });

    await act(async () => {
      await getWorkbench().openFile(fileEntry(controllerPath, "CommentController.php"));
    });
    act(() => {
      getWorkbench().updateActiveEditorPosition(
        positionAfter(controllerSource, "CommentFactory::archiveQuietly"),
      );
    });

    await act(async () => {
      await getWorkbench()
        .commands.find((candidate) => candidate.id === "editor.goToDefinition")
        ?.run();
    });

    const archiveQuietlyPosition = positionAfter(factorySource, "archiveQuietly");
    expect(getWorkbench().activePath).toBe(factoryPath);
    expect(getWorkbench().editorRevealTarget).toEqual({
      path: factoryPath,
      position: {
        column: archiveQuietlyPosition.column - "archiveQuietly".length,
        lineNumber: archiveQuietlyPosition.lineNumber,
      },
    });

    await act(async () => {
      await getWorkbench().openFile(fileEntry(controllerPath, "CommentController.php"));
    });
    act(() => {
      getWorkbench().updateActiveEditorPosition(
        positionAfter(controllerSource, "CommentFactory::restoreBySlug"),
      );
    });

    await act(async () => {
      await getWorkbench()
        .commands.find((candidate) => candidate.id === "editor.goToDefinition")
        ?.run();
    });

    const restoreBySlugPosition = positionAfter(factorySource, "restoreBySlug");
    expect(getWorkbench().activePath).toBe(factoryPath);
    expect(getWorkbench().editorRevealTarget).toEqual({
      path: factoryPath,
      position: {
        column: restoreBySlugPosition.column - "restoreBySlug".length,
        lineNumber: restoreBySlugPosition.lineNumber,
      },
    });
  });
  it("opens implemented interface PHPDoc magic method definitions", async () => {
    const controllerPath = "/workspace/app/Http/Controllers/CommentController.php";
    const commentPath = "/workspace/app/Models/Comment.php";
    const interfacePath = "/workspace/app/Contracts/PublishesComments.php";
    const controllerSource = `<?php
namespace App\\Http\\Controllers;

use App\\Models\\Comment;

class CommentController
{
    public function show(Comment $comment): void
    {
        $comment->publish();
        $comment->missingPublish();
    }
}
`;
    const commentSource = `<?php
namespace App\\Models;

use App\\Contracts\\PublishesComments;

class Comment implements PublishesComments
{
}
`;
    const interfaceSource = `<?php
namespace App\\Contracts;

/**
 * @method void publish()
 */
interface PublishesComments
{
}
`;
    const { getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace",
      },
      readTextFile: vi.fn(async (path: string) => {
        if (path === controllerPath) {
          return controllerSource;
        }

        if (path === commentPath) {
          return commentSource;
        }

        if (path === interfacePath) {
          return interfaceSource;
        }

        return `<?php\n// ${path}\n`;
      }),
      workspaceDescriptor: phpWorkspaceDescriptor(),
    });
    await flushAsyncTurns();
    await act(async () => {
      await getWorkbench().setSmartMode("fullSmart");
    });

    await act(async () => {
      await getWorkbench().openFile(fileEntry(controllerPath, "CommentController.php"));
    });
    act(() => {
      getWorkbench().updateActiveEditorPosition(
        positionAfter(controllerSource, "$comment->publish"),
      );
    });

    await act(async () => {
      await getWorkbench()
        .commands.find((candidate) => candidate.id === "editor.goToDefinition")
        ?.run();
    });

    expect(getWorkbench().activePath).toBe(interfacePath);
    expect(getWorkbench().editorRevealTarget).toEqual({
      path: interfacePath,
      position: {
        column: 17,
        lineNumber: 5,
      },
    });

    await act(async () => {
      await getWorkbench().openFile(fileEntry(controllerPath, "CommentController.php"));
    });
    act(() => {
      getWorkbench().updateActiveEditorPosition(
        positionAfter(controllerSource, "$comment->missingPublish"),
      );
    });

    await act(async () => {
      await getWorkbench()
        .commands.find((candidate) => candidate.id === "editor.goToDefinition")
        ?.run();
    });

    expect(getWorkbench().activePath).toBe(controllerPath);
  });
  it("opens PHPDoc magic property definitions", async () => {
    const controllerPath = "/workspace/app/Http/Controllers/CommentController.php";
    const commentPath = "/workspace/app/Models/Comment.php";
    const interfacePath = "/workspace/app/Contracts/HasExternalId.php";
    const controllerSource = `<?php
namespace App\\Http\\Controllers;

use App\\Models\\Comment;

class CommentController
{
    public function show(Comment $comment): void
    {
        $comment->externalId;
        $comment->slug;
        $comment->hidden;
        $comment->missingProperty;
    }
}
`;
    const commentSource = `<?php
namespace App\\Models;

use App\\Contracts\\HasExternalId;

class Comment implements HasExternalId
{
}
`;
    const interfaceSource = `<?php
namespace App\\Contracts;

/**
 * @property-read string $externalId
 * @phpstan-property-read string $slug
 * @psalm-property-write bool $hidden
 */
interface HasExternalId
{
}
`;
    const { getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace",
      },
      readTextFile: vi.fn(async (path: string) => {
        if (path === controllerPath) {
          return controllerSource;
        }

        if (path === commentPath) {
          return commentSource;
        }

        if (path === interfacePath) {
          return interfaceSource;
        }

        return `<?php\n// ${path}\n`;
      }),
      workspaceDescriptor: phpWorkspaceDescriptor(),
    });
    await flushAsyncTurns();
    await act(async () => {
      await getWorkbench().setSmartMode("fullSmart");
    });

    await act(async () => {
      await getWorkbench().openFile(fileEntry(controllerPath, "CommentController.php"));
    });
    act(() => {
      getWorkbench().updateActiveEditorPosition(
        positionAfter(controllerSource, "$comment->externalId"),
      );
    });

    await act(async () => {
      await getWorkbench()
        .commands.find((candidate) => candidate.id === "editor.goToDefinition")
        ?.run();
    });

    expect(getWorkbench().activePath).toBe(interfacePath);
    expect(getWorkbench().editorRevealTarget).toEqual({
      path: interfacePath,
      position: {
        column: 27,
        lineNumber: 5,
      },
    });

    await act(async () => {
      await getWorkbench().openFile(fileEntry(controllerPath, "CommentController.php"));
    });
    act(() => {
      getWorkbench().updateActiveEditorPosition(positionAfter(controllerSource, "$comment->slug"));
    });

    await act(async () => {
      await getWorkbench()
        .commands.find((candidate) => candidate.id === "editor.goToDefinition")
        ?.run();
    });

    const slugPosition = positionAfter(interfaceSource, "$slug");
    expect(getWorkbench().activePath).toBe(interfacePath);
    expect(getWorkbench().editorRevealTarget).toEqual({
      path: interfacePath,
      position: {
        column: slugPosition.column - "slug".length,
        lineNumber: slugPosition.lineNumber,
      },
    });

    await act(async () => {
      await getWorkbench().openFile(fileEntry(controllerPath, "CommentController.php"));
    });
    act(() => {
      getWorkbench().updateActiveEditorPosition(
        positionAfter(controllerSource, "$comment->hidden"),
      );
    });

    await act(async () => {
      await getWorkbench()
        .commands.find((candidate) => candidate.id === "editor.goToDefinition")
        ?.run();
    });

    const hiddenPosition = positionAfter(interfaceSource, "$hidden");
    expect(getWorkbench().activePath).toBe(interfacePath);
    expect(getWorkbench().editorRevealTarget).toEqual({
      path: interfacePath,
      position: {
        column: hiddenPosition.column - "hidden".length,
        lineNumber: hiddenPosition.lineNumber,
      },
    });

    await act(async () => {
      await getWorkbench().openFile(fileEntry(controllerPath, "CommentController.php"));
    });
    act(() => {
      getWorkbench().updateActiveEditorPosition(
        positionAfter(controllerSource, "$comment->missingProperty"),
      );
    });

    await act(async () => {
      await getWorkbench()
        .commands.find((candidate) => candidate.id === "editor.goToDefinition")
        ?.run();
    });

    expect(getWorkbench().activePath).toBe(controllerPath);
  });
  it("falls back to verified PHP filename lookup before the index is warm", async () => {
    const controllerPath = "/workspace/app/Http/Controllers/CommentController.php";
    const repositoryInterfacePath =
      "/workspace/app/Kontentino/src/Communication/Interfaces/CommentRepositoryInterface.php";
    const commentPath = "/workspace/app/Kontentino/src/Communication/Models/Comment.php";
    const controllerSource = `<?php
namespace App\\Http\\Controllers\\communication;

use App\\Http\\Requests\\GetOneCommentRequest;
use Kontentino\\Communication\\Interfaces\\CommentRepositoryInterface;

class CommentController
{
    public function __construct(
        protected readonly CommentRepositoryInterface $commentRepository,
    ) {}

    public function getOne(GetOneCommentRequest $request): void
    {
        $comment = $this->commentRepository->findOrFail($request->getCommentId());
        $comment->get
    }
}
`;
    const searchFiles = vi.fn(async (_root: string, query: string): Promise<FileSearchResult[]> => {
      if (query === "CommentRepositoryInterface.php") {
        return [
          {
            name: "CommentRepositoryInterface.php",
            path: repositoryInterfacePath,
            relativePath:
              "app/Kontentino/src/Communication/Interfaces/CommentRepositoryInterface.php",
          },
        ];
      }

      if (query === "Comment.php") {
        return [
          {
            name: "Comment.php",
            path: commentPath,
            relativePath: "app/Kontentino/src/Communication/Models/Comment.php",
          },
        ];
      }

      return [];
    });
    const { getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace",
      },
      projectSymbols: [],
      readTextFile: vi.fn(async (path: string) => {
        if (path === controllerPath) {
          return controllerSource;
        }

        if (path === repositoryInterfacePath) {
          return `<?php
namespace Kontentino\\Communication\\Interfaces;

use Kontentino\\Communication\\Models\\Comment;

interface CommentRepositoryInterface
{
    public function findOrFail(int $id): Comment;
}
`;
        }

        if (path === commentPath) {
          return `<?php
namespace Kontentino\\Communication\\Models;

class Comment
{
    public function getContent(): string {}
}
`;
        }

        return `<?php\n// ${path}\n`;
      }),
      searchFiles,
      workspaceDescriptor: phpWorkspaceDescriptor(),
    });
    await flushAsyncTurns();
    await act(async () => {
      await getWorkbench().setSmartMode("fullSmart");
    });

    await expect(
      getWorkbench().providePhpMethodCompletions(
        controllerSource,
        positionAfter(controllerSource, "$comment->get"),
      ),
    ).resolves.toEqual([
      {
        declaringClassName: "Kontentino\\Communication\\Models\\Comment",
        name: "getContent",
        parameters: "",
        returnType: "string",
      },
    ]);
    expect(searchFiles).toHaveBeenCalledWith("/workspace", "CommentRepositoryInterface.php", 40);
    expect(searchFiles).toHaveBeenCalledWith("/workspace", "Comment.php", 40);
  });
  it("suggests model methods from repository interface naming when return types are unavailable", async () => {
    const controllerPath = "/workspace/app/Http/Controllers/CommentController.php";
    const commentPath = "/workspace/app/Kontentino/src/Communication/Models/Comment.php";
    const controllerSource = `<?php
namespace App\\Http\\Controllers\\communication;

use App\\Http\\Requests\\GetOneCommentRequest;
use Kontentino\\Communication\\Interfaces\\CommentRepositoryInterface;

class CommentController
{
    public function __construct(
        protected readonly CommentRepositoryInterface $commentRepository,
    ) {}

    public function getOne(GetOneCommentRequest $request): void
    {
        $comment = $this->commentRepository->findOrFail($request->getCommentId());
        $comment->get
    }
}
`;
    const searchFiles = vi.fn(async (_root: string, query: string): Promise<FileSearchResult[]> =>
      query === "Comment.php"
        ? [
            {
              name: "Comment.php",
              path: commentPath,
              relativePath: "app/Kontentino/src/Communication/Models/Comment.php",
            },
          ]
        : [],
    );
    const { getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace",
      },
      projectSymbols: [],
      readTextFile: vi.fn(async (path: string) => {
        if (path === controllerPath) {
          return controllerSource;
        }

        if (path === commentPath) {
          return `<?php
namespace Kontentino\\Communication\\Models;

class Comment
{
    public function getContent(): string {}
}
`;
        }

        return `<?php\n// ${path}\n`;
      }),
      searchFiles,
      workspaceDescriptor: phpWorkspaceDescriptor(),
    });
    await flushAsyncTurns();
    await act(async () => {
      await getWorkbench().setSmartMode("fullSmart");
    });

    await expect(
      getWorkbench().providePhpMethodCompletions(
        controllerSource,
        positionAfter(controllerSource, "$comment->get"),
      ),
    ).resolves.toEqual([
      {
        declaringClassName: "Kontentino\\Communication\\Models\\Comment",
        name: "getContent",
        parameters: "",
        returnType: "string",
      },
    ]);
    expect(searchFiles).toHaveBeenCalledWith("/workspace", "Comment.php", 40);
  });
  it("suggests Laravel model attributes from repository interface naming when return types are unavailable", async () => {
    const controllerPath = "/workspace/app/Http/Controllers/CommentController.php";
    const commentPath = "/workspace/app/Kontentino/src/Communication/Models/Comment.php";
    const controllerSource = `<?php
namespace App\\Http\\Controllers\\communication;

use App\\Http\\Requests\\GetOneCommentRequest;
use Kontentino\\Communication\\Interfaces\\CommentRepositoryInterface;

class CommentController
{
    public function __construct(
        protected readonly CommentRepositoryInterface $commentRepository,
    ) {}

    public function getOne(GetOneCommentRequest $request): void
    {
        $comment = $this->commentRepository->findOrFail($request->getCommentId());
        $comment->
    }
}
`;
    const searchFiles = vi.fn(async (_root: string, query: string): Promise<FileSearchResult[]> =>
      query === "Comment.php"
        ? [
            {
              name: "Comment.php",
              path: commentPath,
              relativePath: "app/Kontentino/src/Communication/Models/Comment.php",
            },
          ]
        : [],
    );
    const { getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace",
      },
      projectSymbols: [],
      readTextFile: vi.fn(async (path: string) => {
        if (path === controllerPath) {
          return controllerSource;
        }

        if (path === commentPath) {
          return `<?php
namespace Kontentino\\Communication\\Models;

class Comment
{
    protected $fillable = [
        'account_id',
        'content',
    ];

    protected array $casts = [
        'is_pinned' => 'bool',
        'meta' => 'array',
    ];

    public function getContent(): string {}
}
`;
        }

        return `<?php\n// ${path}\n`;
      }),
      searchFiles,
      workspaceDescriptor: phpWorkspaceDescriptor(),
    });
    await flushAsyncTurns();
    await act(async () => {
      await getWorkbench().setSmartMode("fullSmart");
    });

    await expect(
      getWorkbench().providePhpMethodCompletions(
        controllerSource,
        positionAfter(controllerSource, "$comment->"),
      ),
    ).resolves.toEqual(
      expect.arrayContaining([
        {
          declaringClassName: "Kontentino\\Communication\\Models\\Comment",
          kind: "property",
          name: "account_id",
          parameters: "",
          returnType: "mixed",
        },
        {
          declaringClassName: "Kontentino\\Communication\\Models\\Comment",
          kind: "property",
          name: "is_pinned",
          parameters: "",
          returnType: "bool",
        },
        {
          declaringClassName: "Kontentino\\Communication\\Models\\Comment",
          kind: "property",
          name: "meta",
          parameters: "",
          returnType: "array",
        },
        {
          declaringClassName: "Kontentino\\Communication\\Models\\Comment",
          name: "getContent",
          parameters: "",
          returnType: "string",
        },
      ]),
    );
    expect(searchFiles).toHaveBeenCalledWith("/workspace", "Comment.php", 40);
  });
  it("offers Laravel Eloquent model completions after fluent findOrFail chains", async () => {
    let diagnosticsListener: ((event: LanguageServerDiagnosticEvent) => void) | null = null;
    const controllerPath = "/workspace/app/Http/Controllers/CommentController.php";
    const commentPath = "/workspace/app/Models/Comment.php";
    const controllerSource = `<?php
namespace App\\Http\\Controllers;

use App\\Models\\Comment;

class CommentController
{
    public function show(int $threadId, int $id): void
    {
        $comment = Comment::where('thread_id', $threadId)->findOrFail($id);
        $comment->
        $comment->visible();
        $missing = Comment::where('thread_id', $threadId)->definitelyMissingMagic();
    }
}
`;
    const runningStatus: LanguageServerRuntimeStatus = {
      capabilities: emptyLanguageServerCapabilities(),
      kind: "running",
      sessionId: 144,
    };
    const diagnosticsGateway: LanguageServerDiagnosticsGateway = {
      subscribeDiagnostics: vi.fn(async (listener) => {
        diagnosticsListener = listener;
        return () => undefined;
      }),
    };
    const diagnosticPosition = (needle: string) => {
      const position = positionAfter(controllerSource, needle);

      return {
        character: position.column - needle.length - 1,
        line: position.lineNumber - 1,
      };
    };
    const { getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace",
      },
      languageServerDiagnosticsGateway: diagnosticsGateway,
      readTextFile: vi.fn(async (path: string) => {
        if (path === controllerPath) {
          return controllerSource;
        }

        if (path === commentPath) {
          return `<?php
namespace App\\Models;

use Illuminate\\Database\\Eloquent\\Builder;
use Illuminate\\Database\\Eloquent\\Model;
use Illuminate\\Database\\Eloquent\\Relations\\HasMany;

class Comment extends Model
{
    protected $fillable = [
        'content',
        'thread_id',
    ];

    protected array $casts = [
        'is_pinned' => 'bool',
        'meta' => 'array',
    ];

    public function replies(): HasMany
    {
        return $this->hasMany(self::class, 'parent_id');
    }

    public function approve(int $actorId): void {}

    public function scopeVisible(Builder $query, bool $pinned = false): Builder
    {
        return $query;
    }
}
`;
        }

        return `<?php\n// ${path}\n`;
      }),
      runtimeStatus: runningStatus,
      workspaceDescriptor: phpWorkspaceDescriptor(),
    });
    await flushAsyncTurns(24);
    await act(async () => {
      await getWorkbench().setSmartMode("fullSmart");
    });
    await act(async () => {
      await getWorkbench().openFile(fileEntry(controllerPath, "CommentController.php"));
    });

    await expect(
      getWorkbench().providePhpMethodCompletions(
        controllerSource,
        positionAfter(controllerSource, "$comment->"),
      ),
    ).resolves.toEqual(
      expect.arrayContaining([
        {
          declaringClassName: "App\\Models\\Comment",
          kind: "property",
          name: "content",
          parameters: "",
          returnType: "mixed",
        },
        {
          declaringClassName: "App\\Models\\Comment",
          kind: "property",
          name: "is_pinned",
          parameters: "",
          returnType: "bool",
        },
        {
          declaringClassName: "App\\Models\\Comment",
          kind: "property",
          name: "meta",
          parameters: "",
          returnType: "array",
        },
        {
          declaringClassName: "App\\Models\\Comment",
          kind: "property",
          name: "replies",
          parameters: "",
          returnType: "App\\Models\\Comment",
        },
        {
          declaringClassName: "App\\Models\\Comment",
          kind: "scope",
          name: "visible",
          parameters: "bool $pinned = false",
          returnType: "Builder",
        },
        {
          declaringClassName: "App\\Models\\Comment",
          name: "approve",
          parameters: "int $actorId",
          returnType: "void",
        },
      ]),
    );

    expect(diagnosticsListener).not.toBeNull();

    act(() => {
      diagnosticsListener?.({
        diagnostics: [
          {
            ...diagnosticPosition("where"),
            message: "Method App\\Models\\Comment::where() does not exist",
            severity: "error",
            source: "phpactor",
          },
          {
            ...diagnosticPosition("findOrFail"),
            message: "Method Illuminate\\Database\\Eloquent\\Builder::findOrFail() does not exist",
            severity: "error",
            source: "phpactor",
          },
          {
            ...diagnosticPosition("visible"),
            message: "Method App\\Models\\Comment::visible() does not exist",
            severity: "error",
            source: "phpactor",
          },
          {
            ...diagnosticPosition("definitelyMissingMagic"),
            message:
              "Method Illuminate\\Database\\Eloquent\\Builder::definitelyMissingMagic() does not exist",
            severity: "error",
            source: "phpactor",
          },
        ],
        rootPath: "/workspace",
        sessionId: runningStatus.sessionId,
        uri: fileUriFromPath(controllerPath),
        version: null,
      });
    });
    await flushAsyncTurns();

    expect(getWorkbench().languageServerDiagnosticsByPath[controllerPath]).toEqual([
      {
        ...diagnosticPosition("where"),
        message: "Method App\\Models\\Comment::where() does not exist",
        severity: "hint",
        source: "laravel-magic",
      },
      {
        ...diagnosticPosition("findOrFail"),
        message: "Method Illuminate\\Database\\Eloquent\\Builder::findOrFail() does not exist",
        severity: "hint",
        source: "laravel-magic",
      },
      {
        ...diagnosticPosition("definitelyMissingMagic"),
        message:
          "Method Illuminate\\Database\\Eloquent\\Builder::definitelyMissingMagic() does not exist",
        severity: "error",
        source: "phpactor",
      },
    ]);
  });
  it("surfaces derived local scopes as their own category without raw or duplicate members", async () => {
    const controllerPath = "/workspace/app/Http/Controllers/ReportController.php";
    const reportRunPath = "/workspace/app/Models/ReportRun.php";
    const controllerSource = `<?php
namespace App\\Http\\Controllers;

use App\\Models\\ReportRun;

class ReportController
{
    public function index(): void
    {
        /** @var ReportRun $report */
        $report->
    }
}
`;
    const { getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace",
      },
      readTextFile: vi.fn(async (path: string) => {
        if (path === controllerPath) {
          return controllerSource;
        }

        if (path === reportRunPath) {
          return `<?php
namespace App\\Models;

use Illuminate\\Database\\Eloquent\\Attributes\\Scope;
use Illuminate\\Database\\Eloquent\\Builder;
use Illuminate\\Database\\Eloquent\\Model;
use Illuminate\\Database\\Eloquent\\Relations\\HasOne;

class ReportRun extends Model
{
    public string $status;

    public function owner(): HasOne
    {
        return $this->hasOne(User::class);
    }

    public function process(): void {}

    public function scopeInFlight(Builder $query): Builder {}

    #[Scope]
    protected function failed(Builder $query): void {}

    public function scopeStale(Builder $query): Builder {}

    public function scopeStatus(Builder $query): Builder {}

    public function scopeOwner(Builder $query): Builder {}

    public function scopeProcess(Builder $query): Builder {}
}
`;
        }

        return `<?php\n// ${path}\n`;
      }),
      workspaceDescriptor: phpWorkspaceDescriptor(),
    });
    await flushAsyncTurns();
    await act(async () => {
      await getWorkbench().setSmartMode("fullSmart");
    });
    await act(async () => {
      await getWorkbench().openFile(fileEntry(controllerPath, "ReportController.php"));
    });

    const completions = await getWorkbench().providePhpMethodCompletions(
      controllerSource,
      positionAfter(controllerSource, "$report->"),
    );
    const byName = (name: string) => completions.filter((completion) => completion.name === name);

    // Derived scopes (classic `scopeX` and `#[Scope]`) carry `kind: "scope"` so
    // the ordering layer can group them into their own category.
    expect(completions).toEqual(
      expect.arrayContaining([
        {
          declaringClassName: "App\\Models\\ReportRun",
          kind: "scope",
          name: "inFlight",
          parameters: "",
          returnType: "Builder",
        },
        {
          declaringClassName: "App\\Models\\ReportRun",
          kind: "scope",
          name: "failed",
          parameters: "",
          returnType: "Illuminate\\Database\\Eloquent\\Builder",
        },
        {
          declaringClassName: "App\\Models\\ReportRun",
          kind: "scope",
          name: "stale",
          parameters: "",
          returnType: "Builder",
        },
      ]),
    );

    // No raw `scopeX` source method leaks alongside the derived scope.
    expect(
      completions.filter((completion) => completion.name.toLowerCase().startsWith("scope")),
    ).toEqual([]);

    // The `#[Scope]` source method `failed` is represented exactly once - the
    // derived scope - never duplicated by the raw attributed method.
    expect(byName("failed")).toHaveLength(1);
    expect(byName("inFlight")).toHaveLength(1);
    expect(byName("stale")).toHaveLength(1);

    // A scope whose name collides with a property keeps both, each in its own
    // kind, and still drops the raw `scopeX` source.
    expect(
      byName("status")
        .map((completion) => completion.kind)
        .sort(),
    ).toEqual(["property", "scope"]);

    // A scope whose name collides with a relation or a plain method survives the
    // collision: the derived scope is present exactly once (the raw `scopeX`
    // source is already proven dropped above) and the colliding member remains.
    expect(byName("owner").filter((completion) => completion.kind === "scope")).toHaveLength(1);
    expect(byName("owner").some((completion) => completion.kind !== "scope")).toBe(true);
    expect(byName("process").filter((completion) => completion.kind === "scope")).toHaveLength(1);
    expect(byName("process").some((completion) => (completion.kind ?? "method") === "method")).toBe(
      true,
    );
  });
  it("uses filename lookup when Composer PSR-4 points at a missing model path", async () => {
    const controllerPath = "/workspace/app/Http/Controllers/CommentController.php";
    const repositoryPath = "/workspace/app/Repositories/CommentRepository.php";
    const expectedPsrModelPath = "/workspace/app/Models/Comment.php";
    const actualModelPath = "/workspace/packages/domain/Models/Comment.php";
    const controllerSource = `<?php
namespace App\\Http\\Controllers;

use App\\Repositories\\CommentRepository;

class CommentController
{
    public function __construct(
        protected readonly CommentRepository $commentRepository,
    ) {}

    public function getOne(): void
    {
        $comment = $this->commentRepository->findOrFail(1);
        $comment->get
    }
}
`;
    const searchFiles = vi.fn(async (_root: string, query: string): Promise<FileSearchResult[]> => {
      if (query === "Comment.php") {
        return [
          {
            name: "Comment.php",
            path: actualModelPath,
            relativePath: "packages/domain/Models/Comment.php",
          },
        ];
      }

      return [];
    });
    const readTextFile = vi.fn(async (path: string) => {
      if (path === controllerPath) {
        return controllerSource;
      }

      if (path === repositoryPath) {
        return `<?php
namespace App\\Repositories;

use App\\Models\\Comment;

class CommentRepository
{
    public function findOrFail(int $id): Comment {}
}
`;
      }

      if (path === expectedPsrModelPath) {
        throw new Error("missing PSR-4 model path");
      }

      if (path === actualModelPath) {
        return `<?php
namespace App\\Models;

class Comment
{
    public function getContent(): string {}
}
`;
      }

      return `<?php\n// ${path}\n`;
    });
    const { getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace",
      },
      projectSymbols: [],
      readTextFile,
      searchFiles,
      workspaceDescriptor: phpWorkspaceDescriptor(),
    });
    await flushAsyncTurns();
    await act(async () => {
      await getWorkbench().setSmartMode("fullSmart");
    });

    await expect(
      getWorkbench().providePhpMethodCompletions(
        controllerSource,
        positionAfter(controllerSource, "$comment->get"),
      ),
    ).resolves.toEqual([
      {
        declaringClassName: "App\\Models\\Comment",
        name: "getContent",
        parameters: "",
        returnType: "string",
      },
    ]);
    expect(readTextFile).toHaveBeenCalledWith(expectedPsrModelPath);
    expect(searchFiles).toHaveBeenCalledWith("/workspace", "Comment.php", 40);
  });
  it("opens Laravel database connection methods inferred from return expressions", async () => {
    const localUserPath = "/workspace/app/Models/LocalUser.php";
    const userAccountPath = "/workspace/app/Models/UserAccount.php";
    const userAccountModelPath = "/workspace/app/Kontentino/src/Eloquent/UserAccountModel.php";
    const eloquentModelPath =
      "/workspace/vendor/laravel/framework/src/Illuminate/Database/Eloquent/Model.php";
    const connectionPath =
      "/workspace/vendor/laravel/framework/src/Illuminate/Database/Connection.php";
    const queryBuilderPath =
      "/workspace/vendor/laravel/framework/src/Illuminate/Database/Query/Builder.php";
    const localUserSource = `<?php
namespace App\\Models;

class LocalUser
{
    /** @var UserAccount */
    private $userAccount = null;

    public function loadByLogin($login)
    {
        $connection = $this->userAccount->getDatabaseConnection();
        $userData = $connection->table('users')->get();
        $connection->table('users')->wh
        $userQuery = $connection->table('users')->where('login', $login);
        $userQuery->ord
    }
}
`;
    const workspaceDescriptor = phpWorkspaceDescriptor();
    workspaceDescriptor.php?.psr4Roots.push({
      dev: false,
      namespace: "Kontentino\\",
      paths: ["app/Kontentino/src/"],
    });
    const readTextFile = vi.fn(async (path: string) => {
      if (path === localUserPath) {
        return localUserSource;
      }

      if (path === userAccountPath) {
        return `<?php
namespace App\\Models;

use Kontentino\\Eloquent\\UserAccountModel;

class UserAccount
{
    public function getDatabaseConnection()
    {
        return new UserAccountModel()->getConnection();
    }
}
`;
      }

      if (path === userAccountModelPath) {
        return `<?php
namespace Kontentino\\Eloquent;

use Illuminate\\Database\\Eloquent\\Model;

class UserAccountModel extends Model
{
}
`;
      }

      if (path === eloquentModelPath) {
        return `<?php
namespace Illuminate\\Database\\Eloquent;

class Model
{
    /**
     * @return \\Illuminate\\Database\\Connection
     */
    public function getConnection()
    {
    }
}
`;
      }

      if (path === connectionPath) {
        return `<?php
namespace Illuminate\\Database;

class Connection
{
    public function table($table, $as = null)
    {
    }
}
`;
      }

      if (path === queryBuilderPath) {
        return `<?php
namespace Illuminate\\Database\\Query;

class Builder
{
    public function where($column, $operator = null, $value = null, $boolean = 'and')
    {
    }

    public function orderBy($column, $direction = 'asc')
    {
    }

    public function first($columns = ['*'])
    {
    }
}
`;
      }

      return `<?php\n// ${path}\n`;
    });
    const { getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace",
      },
      readTextFile,
      workspaceDescriptor,
    });
    await flushAsyncTurns();
    await act(async () => {
      await getWorkbench().setSmartMode("fullSmart");
    });

    await act(async () => {
      await getWorkbench().openFile(fileEntry(localUserPath, "LocalUser.php"));
    });
    act(() => {
      getWorkbench().updateActiveEditorPosition(
        positionAfter(localUserSource, "$connection->table"),
      );
    });

    await act(async () => {
      await getWorkbench()
        .commands.find((candidate) => candidate.id === "editor.goToDefinition")
        ?.run();
    });

    expect({
      activePath: getWorkbench().activePath,
      editorRevealTarget: getWorkbench().editorRevealTarget,
      message: getWorkbench().message,
    }).toEqual({
      activePath: connectionPath,
      editorRevealTarget: {
        path: connectionPath,
        position: {
          column: 21,
          lineNumber: 6,
        },
      },
      message: "Opened table() Connection.php:6:21",
    });

    await expect(
      getWorkbench().providePhpMethodCompletions(
        localUserSource,
        positionAfter(localUserSource, "$connection->table('users')->wh"),
      ),
    ).resolves.toEqual([
      {
        declaringClassName: "Illuminate\\Database\\Query\\Builder",
        name: "where",
        parameters: "$column, $operator = null, $value = null, $boolean = 'and'",
        returnType: null,
      },
    ]);
    await expect(
      getWorkbench().providePhpMethodCompletions(
        localUserSource,
        positionAfter(localUserSource, "$userQuery->ord"),
      ),
    ).resolves.toEqual([
      {
        declaringClassName: "Illuminate\\Database\\Query\\Builder",
        name: "orderBy",
        parameters: "$column, $direction = 'asc'",
        returnType: null,
      },
    ]);
  });
  it("resolves Laravel route action strings to the paired controller method before LSP fallback", async () => {
    const routesPath = "/workspace/routes/comments.php";
    const commentControllerPath =
      "/workspace/app/Http/Controllers/communication/CommentController.php";
    const reactionControllerPath =
      "/workspace/app/Http/Controllers/communication/ReactionController.php";
    const languageServerFeaturesGateway = featuresGateway();
    const projectSymbols: ProjectSymbolSearchResult[] = [
      {
        column: 21,
        containerName: "App\\Http\\Controllers\\communication\\ReactionController",
        fullyQualifiedName: "App\\Http\\Controllers\\communication\\ReactionController::store",
        kind: "method",
        lineNumber: 8,
        name: "store",
        path: reactionControllerPath,
        relativePath: "app/Http/Controllers/communication/ReactionController.php",
      },
      {
        column: 21,
        containerName: "App\\Http\\Controllers\\communication\\CommentController",
        fullyQualifiedName: "App\\Http\\Controllers\\communication\\CommentController::store",
        kind: "method",
        lineNumber: 12,
        name: "store",
        path: commentControllerPath,
        relativePath: "app/Http/Controllers/communication/CommentController.php",
      },
    ];
    const { dependencies, getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace",
      },
      languageServerFeaturesGateway,
      projectSymbols,
      readTextFile: vi.fn(async (path: string) => {
        if (path === routesPath) {
          return `<?php
use App\\Http\\Controllers\\communication\\CommentController;
use App\\Http\\Controllers\\communication\\ReactionController;

Route::post('/comments', [CommentController::class, 'store']);
Route::post('/reactions', [ReactionController::class, 'store']);
`;
        }

        return "<?php\nclass Controller { public function store() {} }\n";
      }),
      runtimeStatus: {
        capabilities: {
          ...emptyLanguageServerCapabilities(),
          definition: true,
        },
        kind: "running",
        sessionId: 1,
      },
      workspaceDescriptor: phpWorkspaceDescriptor(),
    });
    await flushAsyncTurns();
    await act(async () => {
      await getWorkbench().setSmartMode("lightSmart");
    });

    await act(async () => {
      await getWorkbench().openFile(fileEntry(routesPath, "comments.php"));
    });
    act(() => {
      getWorkbench().updateActiveEditorPosition({
        column: 54,
        lineNumber: 5,
      });
    });

    await act(async () => {
      await getWorkbench()
        .commands.find((candidate) => candidate.id === "editor.goToDefinition")
        ?.run();
    });

    expect(languageServerFeaturesGateway.definition).not.toHaveBeenCalled();
    expect(dependencies.workspaceGateways.projectSymbols.searchProjectSymbols).toHaveBeenCalledWith(
      "/workspace",
      "store",
      50,
    );
    expect(getWorkbench().activePath).toBe(commentControllerPath);
    expect(getWorkbench().editorRevealTarget).toEqual({
      path: commentControllerPath,
      position: {
        column: 21,
        lineNumber: 12,
      },
    });
  });
});
