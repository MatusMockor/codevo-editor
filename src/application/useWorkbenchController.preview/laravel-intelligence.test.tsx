// @vitest-environment jsdom

import { act } from "react";
import { describe, expect, it, vi } from "vitest";
import { fileUriFromPath } from "../../domain/languageServerDocumentSync";
import {
  emptyLanguageServerCapabilities,
  type LanguageServerRuntimeStatus,
} from "../../domain/languageServerRuntime";
import type { ProjectSymbolSearchResult } from "../../domain/projectSymbols";
import { defaultAppSettings } from "../../domain/settings";
import { type FileEntry } from "../../domain/workspace";
import type { WorkspaceFileChangeEvent } from "../../domain/workspaceFileChange";
import { waitForReact } from "../../test/reactTestLifecycle";
import {
  featuresGateway,
  flushAsyncTurns,
  setupWorkbenchControllerTestHarness,
  type WorkbenchController,
} from "../../test/workbenchControllerTestHarness";
import { type WorkbenchWorkspaceGateways } from "../useWorkbenchController";
import {
  completion,
  createDeferred,
  directoryEntry,
  fileEntry,
  flushWorkspaceDirectoryRefresh,
  lineNumberOf,
  netteWorkspaceDescriptor,
  phpWorkspaceDescriptor,
  positionAfter,
  range,
} from "./testSupport";

describe("useWorkbenchController Laravel language intelligence", () => {
  const { renderController } = setupWorkbenchControllerTestHarness();

  it("resolves Laravel invokable route controller classes to __invoke before LSP fallback", async () => {
    const routesPath = "/workspace/routes/web.php";
    const dashboardControllerPath = "/workspace/app/Http/Controllers/DashboardController.php";
    const routesSource = `<?php
use App\\Http\\Controllers\\DashboardController;

Route::get('/dashboard', DashboardController::class);
Route::get(uri: '/named-dashboard', action: DashboardController::class);
`;
    const languageServerFeaturesGateway = featuresGateway();
    const projectSymbols: ProjectSymbolSearchResult[] = [
      {
        column: 21,
        containerName: "App\\Http\\Controllers\\DashboardController",
        fullyQualifiedName: "App\\Http\\Controllers\\DashboardController::__invoke",
        kind: "method",
        lineNumber: 8,
        name: "__invoke",
        path: dashboardControllerPath,
        relativePath: "app/Http/Controllers/DashboardController.php",
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
          return routesSource;
        }

        return `<?php
namespace App\\Http\\Controllers;

final class DashboardController
{
    public function __invoke(): void
    {
    }
}
`;
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
      await getWorkbench().openFile(fileEntry(routesPath, "web.php"));
    });
    act(() => {
      getWorkbench().updateActiveEditorPosition(
        positionAfter(routesSource, "DashboardController::class"),
      );
    });

    await act(async () => {
      await getWorkbench()
        .commands.find((candidate) => candidate.id === "editor.goToDefinition")
        ?.run();
    });

    expect(languageServerFeaturesGateway.definition).not.toHaveBeenCalled();
    expect(dependencies.workspaceGateways.projectSymbols.searchProjectSymbols).toHaveBeenCalledWith(
      "/workspace",
      "__invoke",
      50,
    );
    expect(getWorkbench().activePath).toBe(dashboardControllerPath);
    expect(getWorkbench().editorRevealTarget).toEqual({
      path: dashboardControllerPath,
      position: {
        column: 21,
        lineNumber: 8,
      },
    });
  });
  it("resolves Laravel controller group route action strings before LSP fallback", async () => {
    const routesPath = "/workspace/routes/comments.php";
    const commentControllerPath =
      "/workspace/app/Http/Controllers/communication/CommentController.php";
    const routesSource = `<?php
use App\\Http\\Controllers\\communication\\CommentController;

Route::prefix('admin/comments')->controller(controller: CommentController::class)->group(function () {
    Route::get(action: 'show', uri: '/comments/{comment}');
    Route::post('/comments', 'store');
});
`;
    const languageServerFeaturesGateway = featuresGateway();
    const projectSymbols: ProjectSymbolSearchResult[] = [
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
      {
        column: 21,
        containerName: "App\\Http\\Controllers\\communication\\CommentController",
        fullyQualifiedName: "App\\Http\\Controllers\\communication\\CommentController::show",
        kind: "method",
        lineNumber: 8,
        name: "show",
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
          return routesSource;
        }

        return `<?php
namespace App\\Http\\Controllers\\communication;

final class CommentController
{
    public function store(): void
    {
    }

    public function show(): void
    {
    }
}
`;
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
      getWorkbench().updateActiveEditorPosition(positionAfter(routesSource, "'show"));
    });

    await act(async () => {
      await getWorkbench()
        .commands.find((candidate) => candidate.id === "editor.goToDefinition")
        ?.run();
    });

    expect(languageServerFeaturesGateway.definition).not.toHaveBeenCalled();
    expect(dependencies.workspaceGateways.projectSymbols.searchProjectSymbols).toHaveBeenCalledWith(
      "/workspace",
      "show",
      50,
    );
    expect(getWorkbench().activePath).toBe(commentControllerPath);
    expect(getWorkbench().editorRevealTarget).toEqual({
      path: commentControllerPath,
      position: {
        column: 21,
        lineNumber: 8,
      },
    });
  });
  it("suggests Laravel controller methods inside route action strings", async () => {
    const routesPath = "/workspace/routes/comments.php";
    const commentControllerPath =
      "/workspace/app/Http/Controllers/communication/CommentController.php";
    const routesSource = `<?php
use App\\Http\\Controllers\\communication\\CommentController;

Route::post('/comments', [CommentController::class, 'st']);
Route::post(uri: '/named-comments', action: [CommentController::class, 'sto']);
Route::controller(CommentController::class)->group(function () {
    Route::get('/comments/{comment}', 'sh');
    Route::get(action: 'sho', uri: '/named-action');
    Route::get(label: 'notAction', uri: '/ignored');
});
Route::view('/comments-view', 'comments.sh');
Route::resource('comments', CommentController::class);
`;
    const { getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace",
      },
      readTextFile: vi.fn(async (path: string) => {
        if (path === routesPath) {
          return routesSource;
        }

        if (path === commentControllerPath) {
          return `<?php
namespace App\\Http\\Controllers\\communication;

final class CommentController
{
    public function store(): void
    {
    }

    public function show(): void
    {
    }

    protected function shadow(): void
    {
    }

    private function stale(): void
    {
    }

    public static function status(): void
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
      await getWorkbench().openFile(fileEntry(routesPath, "comments.php"));
    });

    await expect(
      getWorkbench().providePhpMethodCompletions(routesSource, positionAfter(routesSource, "'st")),
    ).resolves.toEqual([
      {
        declaringClassName: "App\\Http\\Controllers\\communication\\CommentController",
        name: "store",
        parameters: "",
        returnType: "void",
      },
    ]);
    await expect(
      getWorkbench().providePhpMethodCompletions(routesSource, positionAfter(routesSource, "'sto")),
    ).resolves.toEqual([
      {
        declaringClassName: "App\\Http\\Controllers\\communication\\CommentController",
        name: "store",
        parameters: "",
        returnType: "void",
      },
    ]);
    await expect(
      getWorkbench().providePhpMethodCompletions(routesSource, positionAfter(routesSource, "'sh")),
    ).resolves.toEqual([
      {
        declaringClassName: "App\\Http\\Controllers\\communication\\CommentController",
        name: "show",
        parameters: "",
        returnType: "void",
      },
    ]);
    await expect(
      getWorkbench().providePhpMethodCompletions(routesSource, positionAfter(routesSource, "'sho")),
    ).resolves.toEqual([
      {
        declaringClassName: "App\\Http\\Controllers\\communication\\CommentController",
        name: "show",
        parameters: "",
        returnType: "void",
      },
    ]);
    await expect(
      getWorkbench().providePhpMethodCompletions(
        routesSource,
        positionAfter(routesSource, "'notAction"),
      ),
    ).resolves.toEqual([]);
    await expect(
      getWorkbench().providePhpMethodCompletions(
        routesSource,
        positionAfter(routesSource, "comments.sh"),
      ),
    ).resolves.toEqual([]);
  });
  it("suggests Laravel named routes inside route helper strings", async () => {
    const controllerPath = "/workspace/app/Http/Controllers/CommentController.php";
    const routesPath = "/workspace/routes/web.php";
    const apiRoutesPath = "/workspace/routes/api.php";
    const controllerSource = `<?php

class CommentController
{
    public function show(): string
    {
        return route('comments.sh');
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

        if (path === routesPath) {
          return `<?php
Route::get('/comments/{comment}', [CommentController::class, 'show'])
    ->name('comments.show');
Route::get('/comments', [CommentController::class, 'index'])
    ->name('comments.index');
`;
        }

        if (path === apiRoutesPath) {
          return `<?php
Route::post('/comments', [CommentController::class, 'store'])
    ->name('comments.store');
`;
        }

        return `<?php\n// ${path}\n`;
      }),
      searchText: vi.fn(async (_root, query) =>
        query === "->name("
          ? [
              {
                column: 5,
                lineNumber: 3,
                lineText: "    ->name('comments.show');",
                path: routesPath,
                relativePath: "routes/web.php",
              },
              {
                column: 5,
                lineNumber: 3,
                lineText: "    ->name('comments.store');",
                path: apiRoutesPath,
                relativePath: "routes/api.php",
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
        positionAfter(controllerSource, "comments.sh"),
      ),
    ).resolves.toEqual([
      completion({
        declaringClassName: "routes/web.php",
        insertText: "show",
        kind: "route",
        name: "comments.show",
        parameters: "",
        returnType: null,
      }),
    ]);
  });
  it("suggests Laravel gate abilities inside Gate::allows strings", async () => {
    const controllerPath = "/workspace/app/Http/Controllers/PostController.php";
    const providerPath = "/workspace/app/Providers/AuthServiceProvider.php";
    const controllerSource = `<?php

class PostController
{
    public function check(): bool
    {
        return Gate::allows('upd');
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
Gate::define('update-post', [PostPolicy::class, 'update']);
Gate::define('delete-post', [PostPolicy::class, 'delete']);
`;
        }

        return `<?php\n// ${path}\n`;
      }),
      searchText: vi.fn(async (_root, query) =>
        query === "Gate::define"
          ? [
              {
                column: 1,
                lineNumber: 2,
                lineText: "Gate::define('update-post', ...);",
                path: providerPath,
                relativePath: "app/Providers/AuthServiceProvider.php",
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
      await getWorkbench().openFile(fileEntry(controllerPath, "PostController.php"));
    });

    await expect(
      getWorkbench().providePhpMethodCompletions(
        controllerSource,
        positionAfter(controllerSource, "upd"),
      ),
    ).resolves.toEqual([
      completion({
        declaringClassName: "app/Providers/AuthServiceProvider.php",
        insertText: "update-post",
        kind: "config",
        name: "update-post",
        parameters: "",
        returnType: null,
      }),
    ]);
  });
  it("suggests Laravel gate abilities inside $user->can strings", async () => {
    const controllerPath = "/workspace/app/Http/Controllers/PostController.php";
    const providerPath = "/workspace/app/Providers/AuthServiceProvider.php";
    const controllerSource = `<?php

class PostController
{
    public function update($user): bool
    {
        return $user->can('del');
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
Gate::define('update-post', [PostPolicy::class, 'update']);
Gate::define('delete-post', [PostPolicy::class, 'delete']);
`;
        }

        return `<?php\n// ${path}\n`;
      }),
      searchText: vi.fn(async (_root, query) =>
        query === "Gate::define"
          ? [
              {
                column: 1,
                lineNumber: 2,
                lineText: "Gate::define('update-post', ...);",
                path: providerPath,
                relativePath: "app/Providers/AuthServiceProvider.php",
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
      await getWorkbench().openFile(fileEntry(controllerPath, "PostController.php"));
    });

    await expect(
      getWorkbench().providePhpMethodCompletions(
        controllerSource,
        positionAfter(controllerSource, "del"),
      ),
    ).resolves.toEqual([
      completion({
        declaringClassName: "app/Providers/AuthServiceProvider.php",
        insertText: "delete-post",
        kind: "config",
        name: "delete-post",
        parameters: "",
        returnType: null,
      }),
    ]);
  });
  it("suggests Laravel middleware aliases inside ->middleware strings", async () => {
    const routesPath = "/workspace/routes/web.php";
    const kernelPath = "/workspace/app/Http/Kernel.php";
    const routesSource = `<?php

Route::get('/admin')->middleware('ver');
`;
    const { getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace",
      },
      readTextFile: vi.fn(async (path: string) => {
        if (path === routesPath) {
          return routesSource;
        }

        if (path === kernelPath) {
          return `<?php

class Kernel extends HttpKernel
{
    protected $middlewareAliases = [
        'auth' => Authenticate::class,
        'verified' => EnsureEmailIsVerified::class,
    ];
}
`;
        }

        return `<?php\n// ${path}\n`;
      }),
      searchText: vi.fn(async (_root, query) =>
        query === "middlewareAliases"
          ? [
              {
                column: 5,
                lineNumber: 5,
                lineText: "    protected $middlewareAliases = [",
                path: kernelPath,
                relativePath: "app/Http/Kernel.php",
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
      await getWorkbench().openFile(fileEntry(routesPath, "web.php"));
    });

    await expect(
      getWorkbench().providePhpMethodCompletions(routesSource, positionAfter(routesSource, "ver")),
    ).resolves.toEqual([
      completion({
        declaringClassName: "app/Http/Kernel.php",
        insertText: "verified",
        kind: "config",
        name: "verified",
        parameters: "",
        returnType: null,
      }),
    ]);
  });
  it("stops stale Laravel gate ability completions after switching project tabs", async () => {
    const controllerPath = "/workspace-a/app/Http/Controllers/PostController.php";
    const providerPath = "/workspace-a/app/Providers/AuthServiceProvider.php";
    const staleProviderRead = createDeferred<string>();
    const controllerSource = `<?php

class PostController
{
    public function check(): bool
    {
        return Gate::allows('upd');
    }
}
`;
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

        if (path === providerPath) {
          return staleProviderRead.promise;
        }

        return "";
      }),
      searchText: vi.fn(async (_root, query) =>
        query === "Gate::define"
          ? [
              {
                column: 1,
                lineNumber: 2,
                lineText: "Gate::define('update-post', ...);",
                path: providerPath,
                relativePath: "app/Providers/AuthServiceProvider.php",
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
      await getWorkbench().openFile(fileEntry(controllerPath, "PostController.php"));
    });

    act(() => {
      completionsPromise = getWorkbench().providePhpMethodCompletions(
        controllerSource,
        positionAfter(controllerSource, "upd"),
      );
    });
    await waitForReact(() => {
      expect(completionsPromise).not.toBeNull();
    });

    await act(async () => {
      await getWorkbench().activateWorkspaceTab("/workspace-b");
    });
    await flushAsyncTurns();

    staleProviderRead.resolve(`<?php
Gate::define('update-post', [PostPolicy::class, 'update']);
`);

    await expect(completionsPromise!).resolves.toEqual([]);
    expect(getWorkbench().workspaceRoot).toBe("/workspace-b");
  });
  it("suggests Laravel named routes inside named route helper arguments", async () => {
    const controllerPath = "/workspace/app/Http/Controllers/CommentController.php";
    const routesPath = "/workspace/routes/web.php";
    const controllerSource = `<?php

class CommentController
{
    public function show(): string
    {
        return route(name: 'comments.sh');
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

        if (path === routesPath) {
          return `<?php
Route::get('/comments/{comment}', [CommentController::class, 'show'])
    ->name('comments.show');
`;
        }

        return `<?php\n// ${path}\n`;
      }),
      searchText: vi.fn(async (_root, query) =>
        query === "->name("
          ? [
              {
                column: 5,
                lineNumber: 3,
                lineText: "    ->name('comments.show');",
                path: routesPath,
                relativePath: "routes/web.php",
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
        positionAfter(controllerSource, "comments.sh"),
      ),
    ).resolves.toEqual([
      completion({
        declaringClassName: "routes/web.php",
        insertText: "show",
        kind: "route",
        name: "comments.show",
        parameters: "",
        returnType: null,
      }),
    ]);
  });
  it("suggests Laravel named routes from named route group attributes", async () => {
    const controllerPath = "/workspace/app/Http/Controllers/CommentController.php";
    const routesPath = "/workspace/routes/web.php";
    const controllerSource = `<?php

class CommentController
{
    public function dashboard(): string
    {
        return route('admin.dash');
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

        if (path === routesPath) {
          return `<?php
Route::group(attributes: ['as' => 'admin.'], routes: function () {
    Route::get('/dashboard', [CommentController::class, 'dashboard'])
        ->name('dashboard');
});
`;
        }

        return `<?php\n// ${path}\n`;
      }),
      searchText: vi.fn(async (_root, query) =>
        query === "->name("
          ? [
              {
                column: 9,
                lineNumber: 4,
                lineText: "        ->name('dashboard');",
                path: routesPath,
                relativePath: "routes/web.php",
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
        positionAfter(controllerSource, "admin.dash"),
      ),
    ).resolves.toEqual([
      completion({
        declaringClassName: "routes/web.php",
        insertText: "dashboard",
        kind: "route",
        name: "admin.dashboard",
        parameters: "",
        returnType: null,
      }),
    ]);
  });
  it("suggests Laravel named routes from named route definition arguments", async () => {
    const controllerPath = "/workspace/app/Http/Controllers/CommentController.php";
    const routesPath = "/workspace/routes/web.php";
    const controllerSource = `<?php

class CommentController
{
    public function show(): string
    {
        return route('comments.sh');
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

        if (path === routesPath) {
          return `<?php
Route::get('/comments/{comment}', [CommentController::class, 'show'])
    ->name(name: 'comments.show');
`;
        }

        return `<?php\n// ${path}\n`;
      }),
      searchText: vi.fn(async (_root, query) =>
        query === "->name("
          ? [
              {
                column: 5,
                lineNumber: 3,
                lineText: "    ->name(name: 'comments.show');",
                path: routesPath,
                relativePath: "routes/web.php",
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
        positionAfter(controllerSource, "comments.sh"),
      ),
    ).resolves.toEqual([
      completion({
        declaringClassName: "routes/web.php",
        insertText: "show",
        kind: "route",
        name: "comments.show",
        parameters: "",
        returnType: null,
      }),
    ]);
  });
  it("suggests Laravel named routes from legacy route action arrays", async () => {
    const controllerPath = "/workspace/app/Http/Controllers/CommentController.php";
    const routesPath = "/workspace/routes/web.php";
    const controllerSource = `<?php

class CommentController
{
    public function index(): string
    {
        return route('comments.in');
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

        if (path === routesPath) {
          return `<?php
Route::get('/comments', ['as' => 'comments.index', 'uses' => CommentController::class]);
`;
        }

        return `<?php\n// ${path}\n`;
      }),
      searchText: vi.fn(async (_root, query) =>
        query === "'as' =>"
          ? [
              {
                column: 24,
                lineNumber: 2,
                lineText:
                  "Route::get('/comments', ['as' => 'comments.index', 'uses' => CommentController::class]);",
                path: routesPath,
                relativePath: "routes/web.php",
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
        positionAfter(controllerSource, "comments.in"),
      ),
    ).resolves.toEqual([
      completion({
        declaringClassName: "routes/web.php",
        insertText: "index",
        kind: "route",
        name: "comments.index",
        parameters: "",
        returnType: null,
      }),
    ]);
  });
  it("suggests Laravel named routes inside Redirect facade route strings", async () => {
    const controllerPath = "/workspace/app/Http/Controllers/CommentController.php";
    const routesPath = "/workspace/routes/web.php";
    const controllerSource = `<?php

class CommentController
{
    public function preview(): mixed
    {
        return Redirect::route('comments.pre');
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

        if (path === routesPath) {
          return `<?php
Route::get('/comments/preview', [CommentController::class, 'preview'])
    ->name('comments.preview');
`;
        }

        return `<?php\n// ${path}\n`;
      }),
      searchText: vi.fn(async (_root, query) =>
        query === "->name("
          ? [
              {
                column: 5,
                lineNumber: 3,
                lineText: "    ->name('comments.preview');",
                path: routesPath,
                relativePath: "routes/web.php",
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
        positionAfter(controllerSource, "comments.pre"),
      ),
    ).resolves.toEqual([
      completion({
        declaringClassName: "routes/web.php",
        insertText: "preview",
        kind: "route",
        name: "comments.preview",
        parameters: "",
        returnType: null,
      }),
    ]);
  });
  it("suggests Laravel named routes inside signed URL route strings", async () => {
    const controllerPath = "/workspace/app/Http/Controllers/CommentController.php";
    const routesPath = "/workspace/routes/web.php";
    const controllerSource = `<?php

class CommentController
{
    public function unsubscribe(): mixed
    {
        return URL::temporarySignedRoute('comments.uns', now()->addHour());
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

        if (path === routesPath) {
          return `<?php
Route::get('/comments/unsubscribe', [CommentController::class, 'unsubscribe'])
    ->name('comments.unsubscribe');
`;
        }

        return `<?php\n// ${path}\n`;
      }),
      searchText: vi.fn(async (_root, query) =>
        query === "->name("
          ? [
              {
                column: 5,
                lineNumber: 3,
                lineText: "    ->name('comments.unsubscribe');",
                path: routesPath,
                relativePath: "routes/web.php",
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
        positionAfter(controllerSource, "comments.uns"),
      ),
    ).resolves.toEqual([
      completion({
        declaringClassName: "routes/web.php",
        insertText: "unsubscribe",
        kind: "route",
        name: "comments.unsubscribe",
        parameters: "",
        returnType: null,
      }),
    ]);
  });
  it("suggests Laravel named routes inside Uri route strings", async () => {
    const controllerPath = "/workspace/app/Http/Controllers/CommentController.php";
    const routesPath = "/workspace/routes/web.php";
    const controllerSource = `<?php

class CommentController
{
    public function uri(): mixed
    {
        return Uri::route('comments.ur');
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

        if (path === routesPath) {
          return `<?php
Route::get('/comments/uri', [CommentController::class, 'uri'])
    ->name('comments.uri');
`;
        }

        return `<?php\n// ${path}\n`;
      }),
      searchText: vi.fn(async (_root, query) =>
        query === "->name("
          ? [
              {
                column: 5,
                lineNumber: 3,
                lineText: "    ->name('comments.uri');",
                path: routesPath,
                relativePath: "routes/web.php",
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
        positionAfter(controllerSource, "comments.ur"),
      ),
    ).resolves.toEqual([
      completion({
        declaringClassName: "routes/web.php",
        insertText: "uri",
        kind: "route",
        name: "comments.uri",
        parameters: "",
        returnType: null,
      }),
    ]);
  });
  it("suggests Laravel named routes inside signed redirect route strings", async () => {
    const controllerPath = "/workspace/app/Http/Controllers/CommentController.php";
    const routesPath = "/workspace/routes/web.php";
    const controllerSource = `<?php

class CommentController
{
    public function expiringPreview(): mixed
    {
        return redirect()->temporarySignedRoute('comments.pre', now()->addHour());
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

        if (path === routesPath) {
          return `<?php
Route::get('/comments/preview', [CommentController::class, 'expiringPreview'])
    ->name('comments.preview');
`;
        }

        return `<?php\n// ${path}\n`;
      }),
      searchText: vi.fn(async (_root, query) =>
        query === "->name("
          ? [
              {
                column: 5,
                lineNumber: 3,
                lineText: "    ->name('comments.preview');",
                path: routesPath,
                relativePath: "routes/web.php",
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
        positionAfter(controllerSource, "comments.pre"),
      ),
    ).resolves.toEqual([
      completion({
        declaringClassName: "routes/web.php",
        insertText: "preview",
        kind: "route",
        name: "comments.preview",
        parameters: "",
        returnType: null,
      }),
    ]);
  });
  it("suggests Laravel resource route names from resource-only route files", async () => {
    const controllerPath = "/workspace/app/Http/Controllers/CommentController.php";
    const routesPath = "/workspace/routes/web.php";
    const controllerSource = `<?php

class CommentController
{
    public function edit(): string
    {
        return route('comments.ed');
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

        if (path === routesPath) {
          return `<?php
Route::resource(name: 'comments', controller: CommentController::class)
    ->only(only: ['edit']);
`;
        }

        return `<?php\n// ${path}\n`;
      }),
      searchText: vi.fn(async (_root, query) =>
        query === "Route::resource"
          ? [
              {
                column: 1,
                lineNumber: 2,
                lineText: "Route::resource(name: 'comments', controller: CommentController::class)",
                path: routesPath,
                relativePath: "routes/web.php",
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
        positionAfter(controllerSource, "comments.ed"),
      ),
    ).resolves.toEqual([
      completion({
        declaringClassName: "routes/web.php",
        insertText: "edit",
        kind: "route",
        name: "comments.edit",
        parameters: "",
        returnType: null,
      }),
    ]);
  });
  it("suggests Laravel singleton route names from singleton-only route files", async () => {
    const controllerPath = "/workspace/app/Http/Controllers/ProfileController.php";
    const routesPath = "/workspace/routes/web.php";
    const controllerSource = `<?php

class ProfileController
{
    public function show(): string
    {
        return route('profile.sh');
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

        if (path === routesPath) {
          return `<?php
Route::singleton(name: 'profile', controller: ProfileController::class);
`;
        }

        return `<?php\n// ${path}\n`;
      }),
      searchText: vi.fn(async (_root, query) =>
        query === "Route::singleton"
          ? [
              {
                column: 1,
                lineNumber: 2,
                lineText:
                  "Route::singleton(name: 'profile', controller: ProfileController::class);",
                path: routesPath,
                relativePath: "routes/web.php",
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
      await getWorkbench().openFile(fileEntry(controllerPath, "ProfileController.php"));
    });

    await expect(
      getWorkbench().providePhpMethodCompletions(
        controllerSource,
        positionAfter(controllerSource, "profile.sh"),
      ),
    ).resolves.toEqual([
      completion({
        declaringClassName: "routes/web.php",
        insertText: "show",
        kind: "route",
        name: "profile.show",
        parameters: "",
        returnType: null,
      }),
    ]);
  });
  it("suggests Laravel resource route name overrides from named arguments", async () => {
    const controllerPath = "/workspace/app/Http/Controllers/CommentController.php";
    const routesPath = "/workspace/routes/web.php";
    const controllerSource = `<?php

class CommentController
{
    public function edit(): string
    {
        return route('comments.mo');
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

        if (path === routesPath) {
          return `<?php
Route::resource(name: 'comments', controller: CommentController::class)
    ->only(only: ['edit'])
    ->names(names: ['edit' => 'comments.modify']);
`;
        }

        return `<?php\n// ${path}\n`;
      }),
      searchText: vi.fn(async (_root, query) =>
        query === "Route::resource"
          ? [
              {
                column: 1,
                lineNumber: 2,
                lineText: "Route::resource(name: 'comments', controller: CommentController::class)",
                path: routesPath,
                relativePath: "routes/web.php",
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
        positionAfter(controllerSource, "comments.mo"),
      ),
    ).resolves.toEqual([
      completion({
        declaringClassName: "routes/web.php",
        insertText: "modify",
        kind: "route",
        name: "comments.modify",
        parameters: "",
        returnType: null,
      }),
    ]);
  });
  it("opens Laravel named route definitions before LSP fallback", async () => {
    const controllerPath = "/workspace/app/Http/Controllers/CommentController.php";
    const routesPath = "/workspace/routes/web.php";
    const controllerSource = `<?php

class CommentController
{
    public function show(): string
    {
        return route('comments.show');
    }
}
`;
    const languageServerFeaturesGateway = featuresGateway();
    const { getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace",
      },
      languageServerFeaturesGateway,
      readTextFile: vi.fn(async (path: string) => {
        if (path === controllerPath) {
          return controllerSource;
        }

        if (path === routesPath) {
          return `<?php
Route::get('/comments/{comment}', [CommentController::class, 'show'])
    ->name('comments.show');
`;
        }

        return `<?php\n// ${path}\n`;
      }),
      runtimeStatus: {
        capabilities: {
          ...emptyLanguageServerCapabilities(),
          definition: true,
        },
        kind: "running",
        sessionId: 1,
      },
      searchText: vi.fn(async (_root, query) =>
        query === "->name("
          ? [
              {
                column: 5,
                lineNumber: 3,
                lineText: "    ->name('comments.show');",
                path: routesPath,
                relativePath: "routes/web.php",
              },
            ]
          : [],
      ),
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
      getWorkbench().updateActiveEditorPosition(positionAfter(controllerSource, "comments.show"));
    });

    await act(async () => {
      await getWorkbench()
        .commands.find((candidate) => candidate.id === "editor.goToDefinition")
        ?.run();
    });

    expect(languageServerFeaturesGateway.definition).not.toHaveBeenCalled();
    expect(getWorkbench().activePath).toBe(routesPath);
    expect(getWorkbench().editorRevealTarget).toEqual({
      path: routesPath,
      position: {
        column: 13,
        lineNumber: 3,
      },
    });
  });
  it("suggests Laravel config keys inside config helper strings", async () => {
    const controllerPath = "/workspace/app/Http/Controllers/AppController.php";
    const configRoot = "/workspace/config";
    const appConfigPath = "/workspace/config/app.php";
    const controllerSource = `<?php

class AppController
{
    public function name(): string
    {
        return config('app.na');
    }

    public function rename(): void
    {
        config(['app.na' => 'Codevo']);
    }
}
`;
    const appConfigSource = `<?php

return [
    'name' => env('APP_NAME', 'Laravel'),
    'mail' => [
        'from' => [
            'address' => 'hello@example.com',
        ],
    ],
];
`;
    const { getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace",
      },
      readDirectory: vi.fn(async (path: string) =>
        path === configRoot
          ? [
              fileEntry(appConfigPath, "app.php"),
              fileEntry("/workspace/config/ignored.txt", "ignored.txt"),
            ]
          : [],
      ),
      readTextFile: vi.fn(async (path: string) => {
        if (path === controllerPath) {
          return controllerSource;
        }

        if (path === appConfigPath) {
          return appConfigSource;
        }

        return "";
      }),
      workspaceDescriptor: phpWorkspaceDescriptor(),
    });
    await flushAsyncTurns();
    await act(async () => {
      await getWorkbench().setSmartMode("fullSmart");
    });
    await act(async () => {
      await getWorkbench().openFile(fileEntry(controllerPath, "AppController.php"));
    });

    await expect(
      getWorkbench().providePhpMethodCompletions(
        controllerSource,
        positionAfter(controllerSource, "app.na"),
      ),
    ).resolves.toEqual([
      completion({
        declaringClassName: "config/app.php",
        insertText: "name",
        kind: "config",
        name: "app.name",
        parameters: "",
        returnType: null,
      }),
    ]);
    await expect(
      getWorkbench().providePhpMethodCompletions(
        controllerSource,
        positionAfter(controllerSource, "['app.na"),
      ),
    ).resolves.toEqual([
      completion({
        declaringClassName: "config/app.php",
        insertText: "name",
        kind: "config",
        name: "app.name",
        parameters: "",
        returnType: null,
      }),
    ]);
  });
  it("reuses cached Laravel config targets across repeated completions", async () => {
    const controllerPath = "/workspace/app/Http/Controllers/AppController.php";
    const configRoot = "/workspace/config";
    const appConfigPath = "/workspace/config/app.php";
    const controllerSource = `<?php

class AppController
{
    public function name(): string
    {
        return config('app.na');
    }
}
`;
    const appConfigSource = `<?php

return [
    'name' => env('APP_NAME', 'Laravel'),
];
`;
    const readDirectory = vi.fn(async (path: string) =>
      path === configRoot ? [fileEntry(appConfigPath, "app.php")] : [],
    );
    const readTextFile = vi.fn(async (path: string) => {
      if (path === controllerPath) {
        return controllerSource;
      }

      if (path === appConfigPath) {
        return appConfigSource;
      }

      return "";
    });
    const { getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace",
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
      await getWorkbench().openFile(fileEntry(controllerPath, "AppController.php"));
    });

    const expected = [
      completion({
        declaringClassName: "config/app.php",
        insertText: "name",
        kind: "config",
        name: "app.name",
        parameters: "",
        returnType: null,
      }),
    ];

    await expect(
      getWorkbench().providePhpMethodCompletions(
        controllerSource,
        positionAfter(controllerSource, "app.na"),
      ),
    ).resolves.toEqual(expected);

    const configDirectoryReadsAfterFirst = readDirectory.mock.calls.filter(
      ([path]) => path === configRoot,
    ).length;
    const configFileReadsAfterFirst = readTextFile.mock.calls.filter(
      ([path]) => path === appConfigPath,
    ).length;
    expect(configDirectoryReadsAfterFirst).toBeGreaterThan(0);
    expect(configFileReadsAfterFirst).toBeGreaterThan(0);

    // Second completion for the same workspace must serve cached targets and
    // never re-scan the config directory or re-read config files.
    await expect(
      getWorkbench().providePhpMethodCompletions(
        controllerSource,
        positionAfter(controllerSource, "app.na"),
      ),
    ).resolves.toEqual(expected);

    expect(readDirectory.mock.calls.filter(([path]) => path === configRoot).length).toBe(
      configDirectoryReadsAfterFirst,
    );
    expect(readTextFile.mock.calls.filter(([path]) => path === appConfigPath).length).toBe(
      configFileReadsAfterFirst,
    );
  });
  it("reuses cached Laravel view targets across repeated completions", async () => {
    const controllerPath = "/workspace/app/Http/Controllers/CommentController.php";
    const viewsRoot = "/workspace/resources/views";
    const commentsDirectory = "/workspace/resources/views/comments";
    const controllerSource = `<?php

class CommentController
{
    public function show(): mixed
    {
        return view('comments.sh');
    }
}
`;
    const readDirectory = vi.fn(async (path: string) => {
      if (path === viewsRoot) {
        return [directoryEntry(commentsDirectory, "comments")];
      }

      if (path === commentsDirectory) {
        return [fileEntry("/workspace/resources/views/comments/show.blade.php", "show.blade.php")];
      }

      return [];
    });
    const { getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace",
      },
      readDirectory,
      readTextFile: vi.fn(async (path: string) =>
        path === controllerPath ? controllerSource : "",
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

    const expected = [
      completion({
        declaringClassName: "resources/views/comments/show.blade.php",
        insertText: "show",
        kind: "view",
        name: "comments.show",
        parameters: "",
        returnType: null,
      }),
    ];

    await expect(
      getWorkbench().providePhpMethodCompletions(
        controllerSource,
        positionAfter(controllerSource, "comments.sh"),
      ),
    ).resolves.toEqual(expected);

    const viewsRootReadsAfterFirst = readDirectory.mock.calls.filter(
      ([path]) => path === viewsRoot,
    ).length;
    expect(viewsRootReadsAfterFirst).toBeGreaterThan(0);

    // Second completion for the same workspace must serve cached targets and
    // never re-walk the resources/views directory tree.
    await expect(
      getWorkbench().providePhpMethodCompletions(
        controllerSource,
        positionAfter(controllerSource, "comments.sh"),
      ),
    ).resolves.toEqual(expected);

    expect(readDirectory.mock.calls.filter(([path]) => path === viewsRoot).length).toBe(
      viewsRootReadsAfterFirst,
    );
  });
  it("rescans Laravel config targets after switching project tabs", async () => {
    const controllerPathA = "/workspace-a/app/Http/Controllers/AppController.php";
    const controllerPathB = "/workspace-b/app/Http/Controllers/AppController.php";
    const configRootA = "/workspace-a/config";
    const configRootB = "/workspace-b/config";
    const appConfigPathA = "/workspace-a/config/alpha.php";
    const appConfigPathB = "/workspace-b/config/beta.php";
    const controllerSource = (workspace: string) => `<?php

class AppController
{
    public function name(): string
    {
        return config('${workspace}.na');
    }
}
`;
    const readDirectory = vi.fn(async (path: string) => {
      if (path === configRootA) {
        return [fileEntry(appConfigPathA, "alpha.php")];
      }

      if (path === configRootB) {
        return [fileEntry(appConfigPathB, "beta.php")];
      }

      return [];
    });
    const readTextFile = vi.fn(async (path: string) => {
      if (path === controllerPathA) {
        return controllerSource("alpha");
      }

      if (path === controllerPathB) {
        return controllerSource("beta");
      }

      if (path === appConfigPathA) {
        return `<?php\n\nreturn [\n    'name' => 'Alpha',\n];\n`;
      }

      if (path === appConfigPathB) {
        return `<?php\n\nreturn [\n    'name' => 'Beta',\n];\n`;
      }

      return "";
    });
    const { getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace-a",
        workspaceTabs: ["/workspace-a", "/workspace-b"],
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
      await getWorkbench().openFile(fileEntry(controllerPathA, "AppController.php"));
    });

    await expect(
      getWorkbench().providePhpMethodCompletions(
        controllerSource("alpha"),
        positionAfter(controllerSource("alpha"), "alpha.na"),
      ),
    ).resolves.toEqual([
      completion({
        declaringClassName: "config/alpha.php",
        insertText: "name",
        kind: "config",
        name: "alpha.name",
        parameters: "",
        returnType: null,
      }),
    ]);

    await act(async () => {
      await getWorkbench().activateWorkspaceTab("/workspace-b");
    });
    await flushAsyncTurns();
    await act(async () => {
      await getWorkbench().openFile(fileEntry(controllerPathB, "AppController.php"));
    });

    // The cache is keyed by workspace root and reset on switch, so workspace B
    // must scan its own config and never serve workspace A's cached targets.
    await expect(
      getWorkbench().providePhpMethodCompletions(
        controllerSource("beta"),
        positionAfter(controllerSource("beta"), "beta.na"),
      ),
    ).resolves.toEqual([
      completion({
        declaringClassName: "config/beta.php",
        insertText: "name",
        kind: "config",
        name: "beta.name",
        parameters: "",
        returnType: null,
      }),
    ]);
    expect(getWorkbench().workspaceRoot).toBe("/workspace-b");
    expect(readDirectory.mock.calls.some(([path]) => path === configRootB)).toBe(true);
  });
  it("suggests Laravel config repository keys", async () => {
    const controllerPath = "/workspace/app/Http/Controllers/AppController.php";
    const configRoot = "/workspace/config";
    const appConfigPath = "/workspace/config/app.php";
    const controllerSource = `<?php

use Illuminate\\Support\\Facades\\Config;

class AppController
{
    public function name(): string
    {
        return Config::string('app.na');
    }

    public function rename(): void
    {
        Config::set('app.na', 'Codevo');
        Config::set(['app.na' => 'Codevo']);
    }

    public function senderAddress(): string
    {
        return config()->integer('app.mail.from.ad');
    }
}
`;
    const appConfigSource = `<?php

return [
    'name' => env('APP_NAME', 'Laravel'),
    'mail' => [
        'from' => [
            'address' => 'hello@example.com',
        ],
    ],
];
`;
    const { getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace",
      },
      readDirectory: vi.fn(async (path: string) =>
        path === configRoot ? [fileEntry(appConfigPath, "app.php")] : [],
      ),
      readTextFile: vi.fn(async (path: string) => {
        if (path === controllerPath) {
          return controllerSource;
        }

        if (path === appConfigPath) {
          return appConfigSource;
        }

        return "";
      }),
      workspaceDescriptor: phpWorkspaceDescriptor(),
    });
    await flushAsyncTurns();
    await act(async () => {
      await getWorkbench().setSmartMode("fullSmart");
    });
    await act(async () => {
      await getWorkbench().openFile(fileEntry(controllerPath, "AppController.php"));
    });

    await expect(
      getWorkbench().providePhpMethodCompletions(
        controllerSource,
        positionAfter(controllerSource, "app.na"),
      ),
    ).resolves.toEqual([
      completion({
        declaringClassName: "config/app.php",
        insertText: "name",
        kind: "config",
        name: "app.name",
        parameters: "",
        returnType: null,
      }),
    ]);
    await expect(
      getWorkbench().providePhpMethodCompletions(
        controllerSource,
        positionAfter(controllerSource, "Config::set('app.na"),
      ),
    ).resolves.toEqual([
      completion({
        declaringClassName: "config/app.php",
        insertText: "name",
        kind: "config",
        name: "app.name",
        parameters: "",
        returnType: null,
      }),
    ]);
    await expect(
      getWorkbench().providePhpMethodCompletions(
        controllerSource,
        positionAfter(controllerSource, "Config::set(['app.na"),
      ),
    ).resolves.toEqual([
      completion({
        declaringClassName: "config/app.php",
        insertText: "name",
        kind: "config",
        name: "app.name",
        parameters: "",
        returnType: null,
      }),
    ]);
    await expect(
      getWorkbench().providePhpMethodCompletions(
        controllerSource,
        positionAfter(controllerSource, "app.mail.from.ad"),
      ),
    ).resolves.toEqual([
      completion({
        declaringClassName: "config/app.php",
        insertText: "address",
        kind: "config",
        name: "app.mail.from.address",
        parameters: "",
        returnType: null,
      }),
    ]);
  });
  it("uses Laravel contextual attributes for config completions and guard definitions", async () => {
    const controllerPath = "/workspace/app/Http/Controllers/AttributeController.php";
    const configRoot = "/workspace/config";
    const appConfigPath = "/workspace/config/app.php";
    const authConfigPath = "/workspace/config/auth.php";
    const controllerSource = `<?php

use Illuminate\\Container\\Attributes\\Auth as GuardAttribute;
use Illuminate\\Container\\Attributes\\Config;

class AttributeController
{
    public function __construct(
        #[Config('app.na')] private string $name,
        #[GuardAttribute('admin')] private mixed $guard,
    ) {
    }
}
`;
    const appConfigSource = `<?php

return [
    'name' => env('APP_NAME', 'Laravel'),
];
`;
    const authConfigSource = `<?php

return [
    'defaults' => [
        'guard' => 'web',
    ],
    'guards' => [
        'web' => [
            'driver' => 'session',
        ],
        'admin' => [
            'driver' => 'session',
        ],
    ],
];
`;
    const languageServerFeaturesGateway = featuresGateway();
    const { getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace",
      },
      languageServerFeaturesGateway,
      readDirectory: vi.fn(async (path: string) =>
        path === configRoot
          ? [fileEntry(appConfigPath, "app.php"), fileEntry(authConfigPath, "auth.php")]
          : [],
      ),
      readTextFile: vi.fn(async (path: string) => {
        if (path === controllerPath) {
          return controllerSource;
        }

        if (path === appConfigPath) {
          return appConfigSource;
        }

        if (path === authConfigPath) {
          return authConfigSource;
        }

        throw new Error(`Unexpected read ${path}`);
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
      await getWorkbench().setSmartMode("fullSmart");
    });
    await act(async () => {
      await getWorkbench().openFile(fileEntry(controllerPath, "AttributeController.php"));
    });

    await expect(
      getWorkbench().providePhpMethodCompletions(
        controllerSource,
        positionAfter(controllerSource, "Config('app.na"),
      ),
    ).resolves.toEqual([
      completion({
        declaringClassName: "config/app.php",
        insertText: "name",
        kind: "config",
        name: "app.name",
        parameters: "",
        returnType: null,
      }),
    ]);

    act(() => {
      getWorkbench().updateActiveEditorPosition(
        positionAfter(controllerSource, "GuardAttribute('admin"),
      );
    });

    await act(async () => {
      await getWorkbench()
        .commands.find((candidate) => candidate.id === "editor.goToDefinition")
        ?.run();
    });

    expect(languageServerFeaturesGateway.definition).not.toHaveBeenCalled();
    expect(getWorkbench().activePath).toBe(authConfigPath);
    expect(getWorkbench().editorRevealTarget).toEqual({
      path: authConfigPath,
      position: {
        column: 10,
        lineNumber: 11,
      },
    });
  });
  it("stops stale Laravel config completions after switching project tabs", async () => {
    const controllerPath = "/workspace-a/app/Http/Controllers/AppController.php";
    const configRoot = "/workspace-a/config";
    const appConfigPath = "/workspace-a/config/app.php";
    const configDirectoryRead = createDeferred<FileEntry[]>();
    const controllerSource = `<?php

class AppController
{
    public function name(): string
    {
        return config('app.na');
    }
    }
`;
    let completionsPromise: ReturnType<WorkbenchController["providePhpMethodCompletions"]> | null =
      null;
    const { getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace-a",
        workspaceTabs: ["/workspace-a", "/workspace-b"],
      },
      readDirectory: vi.fn(async (path: string) =>
        path === configRoot ? configDirectoryRead.promise : [],
      ),
      readTextFile: vi.fn(async (path: string) =>
        path === controllerPath ? controllerSource : "",
      ),
      workspaceDescriptor: phpWorkspaceDescriptor(),
    });
    await flushAsyncTurns();
    await act(async () => {
      await getWorkbench().setSmartMode("fullSmart");
    });
    await act(async () => {
      await getWorkbench().openFile(fileEntry(controllerPath, "AppController.php"));
    });

    act(() => {
      completionsPromise = getWorkbench().providePhpMethodCompletions(
        controllerSource,
        positionAfter(controllerSource, "app.na"),
      );
    });
    await waitForReact(() => {
      expect(completionsPromise).not.toBeNull();
    });

    await act(async () => {
      await getWorkbench().activateWorkspaceTab("/workspace-b");
    });
    await flushAsyncTurns();

    configDirectoryRead.resolve([fileEntry(appConfigPath, "app.php")]);

    await expect(completionsPromise!).resolves.toEqual([]);
    expect(getWorkbench().workspaceRoot).toBe("/workspace-b");
  });
  it("stops stale Laravel config file completion reads after switching project tabs", async () => {
    const controllerPath = "/workspace-a/app/Http/Controllers/AppController.php";
    const configRoot = "/workspace-a/config";
    const appConfigPath = "/workspace-a/config/app.php";
    const staleConfigRead = createDeferred<string>();
    const controllerSource = `<?php

class AppController
{
    public function name(): string
    {
        return config('app.na');
    }
}
`;
    let configReadCount = 0;
    let completionsPromise: ReturnType<WorkbenchController["providePhpMethodCompletions"]> | null =
      null;
    const { getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace-a",
        workspaceTabs: ["/workspace-a", "/workspace-b"],
      },
      readDirectory: vi.fn(async (path: string) =>
        path === configRoot ? [fileEntry(appConfigPath, "app.php")] : [],
      ),
      readTextFile: vi.fn(async (path: string) => {
        if (path === controllerPath) {
          return controllerSource;
        }

        if (path === appConfigPath) {
          configReadCount += 1;
          return staleConfigRead.promise;
        }

        return "";
      }),
      workspaceDescriptor: phpWorkspaceDescriptor(),
    });
    await flushAsyncTurns();
    await act(async () => {
      await getWorkbench().setSmartMode("fullSmart");
    });
    await act(async () => {
      await getWorkbench().openFile(fileEntry(controllerPath, "AppController.php"));
    });

    act(() => {
      completionsPromise = getWorkbench().providePhpMethodCompletions(
        controllerSource,
        positionAfter(controllerSource, "app.na"),
      );
    });
    await waitForReact(() => {
      expect(configReadCount).toBe(1);
    });

    await act(async () => {
      await getWorkbench().activateWorkspaceTab("/workspace-b");
    });
    await flushAsyncTurns();

    staleConfigRead.resolve(`<?php

return [
    'name' => 'Stale',
];
`);

    await expect(completionsPromise!).resolves.toEqual([]);
    expect(getWorkbench().workspaceRoot).toBe("/workspace-b");
  });
  it("opens Laravel config keys before LSP fallback", async () => {
    const controllerPath = "/workspace/app/Http/Controllers/AppController.php";
    const appConfigPath = "/workspace/config/app.php";
    const controllerSource = `<?php

class AppController
{
    public function name(): string
    {
        return config('app.name');
    }
}
`;
    const appConfigSource = `<?php

return [
    'name' => env('APP_NAME', 'Laravel'),
];
`;
    const languageServerFeaturesGateway = featuresGateway();
    const { getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace",
      },
      languageServerFeaturesGateway,
      readTextFile: vi.fn(async (path: string) => {
        if (path === controllerPath) {
          return controllerSource;
        }

        if (path === appConfigPath) {
          return appConfigSource;
        }

        throw new Error(`Unexpected read ${path}`);
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
      await getWorkbench().openFile(fileEntry(controllerPath, "AppController.php"));
    });
    act(() => {
      getWorkbench().updateActiveEditorPosition(positionAfter(controllerSource, "app.name"));
    });

    await act(async () => {
      await getWorkbench()
        .commands.find((candidate) => candidate.id === "editor.goToDefinition")
        ?.run();
    });

    expect(languageServerFeaturesGateway.definition).not.toHaveBeenCalled();
    expect(getWorkbench().activePath).toBe(appConfigPath);
    expect(getWorkbench().editorRevealTarget).toEqual({
      path: appConfigPath,
      position: {
        column: 6,
        lineNumber: 4,
      },
    });
  });
  it("opens Laravel config update array keys before LSP fallback", async () => {
    const controllerPath = "/workspace/app/Http/Controllers/AppController.php";
    const appConfigPath = "/workspace/config/app.php";
    const controllerSource = `<?php

class AppController
{
    public function name(): void
    {
        config(['app.name' => 'Codevo']);
    }
}
`;
    const appConfigSource = `<?php

return [
    'name' => env('APP_NAME', 'Laravel'),
];
`;
    const languageServerFeaturesGateway = featuresGateway();
    const { getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace",
      },
      languageServerFeaturesGateway,
      readTextFile: vi.fn(async (path: string) => {
        if (path === controllerPath) {
          return controllerSource;
        }

        if (path === appConfigPath) {
          return appConfigSource;
        }

        throw new Error(`Unexpected read ${path}`);
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
      await getWorkbench().openFile(fileEntry(controllerPath, "AppController.php"));
    });
    act(() => {
      getWorkbench().updateActiveEditorPosition(positionAfter(controllerSource, "['app.name"));
    });

    await act(async () => {
      await getWorkbench()
        .commands.find((candidate) => candidate.id === "editor.goToDefinition")
        ?.run();
    });

    expect(languageServerFeaturesGateway.definition).not.toHaveBeenCalled();
    expect(getWorkbench().activePath).toBe(appConfigPath);
    expect(getWorkbench().editorRevealTarget).toEqual({
      path: appConfigPath,
      position: {
        column: 6,
        lineNumber: 4,
      },
    });
  });
  it("opens Laravel typed config repository keys before LSP fallback", async () => {
    const controllerPath = "/workspace/app/Http/Controllers/AppController.php";
    const appConfigPath = "/workspace/config/app.php";
    const controllerSource = `<?php

use Illuminate\\Support\\Facades\\Config;

class AppController
{
    public function name(): string
    {
        return Config::string('app.name');
    }
}
`;
    const appConfigSource = `<?php

return [
    'name' => env('APP_NAME', 'Laravel'),
];
`;
    const languageServerFeaturesGateway = featuresGateway();
    const { getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace",
      },
      languageServerFeaturesGateway,
      readTextFile: vi.fn(async (path: string) => {
        if (path === controllerPath) {
          return controllerSource;
        }

        if (path === appConfigPath) {
          return appConfigSource;
        }

        throw new Error(`Unexpected read ${path}`);
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
      await getWorkbench().openFile(fileEntry(controllerPath, "AppController.php"));
    });
    act(() => {
      getWorkbench().updateActiveEditorPosition(positionAfter(controllerSource, "app.name"));
    });

    await act(async () => {
      await getWorkbench()
        .commands.find((candidate) => candidate.id === "editor.goToDefinition")
        ?.run();
    });

    expect(languageServerFeaturesGateway.definition).not.toHaveBeenCalled();
    expect(getWorkbench().activePath).toBe(appConfigPath);
    expect(getWorkbench().editorRevealTarget).toEqual({
      path: appConfigPath,
      position: {
        column: 6,
        lineNumber: 4,
      },
    });
  });
  it("opens Laravel config set keys before LSP fallback", async () => {
    const controllerPath = "/workspace/app/Http/Controllers/AppController.php";
    const appConfigPath = "/workspace/config/app.php";
    const controllerSource = `<?php

use Illuminate\\Support\\Facades\\Config;

class AppController
{
    public function name(): void
    {
        Config::set('app.name', 'Codevo');
    }
}
`;
    const appConfigSource = `<?php

return [
    'name' => env('APP_NAME', 'Laravel'),
];
`;
    const languageServerFeaturesGateway = featuresGateway();
    const { getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace",
      },
      languageServerFeaturesGateway,
      readTextFile: vi.fn(async (path: string) => {
        if (path === controllerPath) {
          return controllerSource;
        }

        if (path === appConfigPath) {
          return appConfigSource;
        }

        throw new Error(`Unexpected read ${path}`);
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
      await getWorkbench().openFile(fileEntry(controllerPath, "AppController.php"));
    });
    act(() => {
      getWorkbench().updateActiveEditorPosition(
        positionAfter(controllerSource, "Config::set('app.name"),
      );
    });

    await act(async () => {
      await getWorkbench()
        .commands.find((candidate) => candidate.id === "editor.goToDefinition")
        ?.run();
    });

    expect(languageServerFeaturesGateway.definition).not.toHaveBeenCalled();
    expect(getWorkbench().activePath).toBe(appConfigPath);
    expect(getWorkbench().editorRevealTarget).toEqual({
      path: appConfigPath,
      position: {
        column: 6,
        lineNumber: 4,
      },
    });
  });
  it("opens Laravel config set array keys before LSP fallback", async () => {
    const controllerPath = "/workspace/app/Http/Controllers/AppController.php";
    const appConfigPath = "/workspace/config/app.php";
    const controllerSource = `<?php

use Illuminate\\Support\\Facades\\Config;

class AppController
{
    public function name(): void
    {
        Config::set(['app.name' => 'Codevo']);
    }
}
`;
    const appConfigSource = `<?php

return [
    'name' => env('APP_NAME', 'Laravel'),
];
`;
    const languageServerFeaturesGateway = featuresGateway();
    const { getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace",
      },
      languageServerFeaturesGateway,
      readTextFile: vi.fn(async (path: string) => {
        if (path === controllerPath) {
          return controllerSource;
        }

        if (path === appConfigPath) {
          return appConfigSource;
        }

        throw new Error(`Unexpected read ${path}`);
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
      await getWorkbench().openFile(fileEntry(controllerPath, "AppController.php"));
    });
    act(() => {
      getWorkbench().updateActiveEditorPosition(positionAfter(controllerSource, "['app.name"));
    });

    await act(async () => {
      await getWorkbench()
        .commands.find((candidate) => candidate.id === "editor.goToDefinition")
        ?.run();
    });

    expect(languageServerFeaturesGateway.definition).not.toHaveBeenCalled();
    expect(getWorkbench().activePath).toBe(appConfigPath);
    expect(getWorkbench().editorRevealTarget).toEqual({
      path: appConfigPath,
      position: {
        column: 6,
        lineNumber: 4,
      },
    });
  });
  it("drops stale Laravel config targets after switching project tabs", async () => {
    const controllerPath = "/workspace-a/app/Http/Controllers/AppController.php";
    const appConfigPath = "/workspace-a/config/app.php";
    const controllerSource = `<?php

class AppController
{
    public function name(): string
    {
        return config('app.name');
    }
}
`;
    const staleConfigRead = createDeferred<string>();
    let configReadCount = 0;
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

        if (path === appConfigPath) {
          configReadCount += 1;
          return staleConfigRead.promise;
        }

        throw new Error(`Unexpected read ${path}`);
      }),
      workspaceDescriptor: phpWorkspaceDescriptor(),
    });
    await flushAsyncTurns();
    await act(async () => {
      await getWorkbench().setSmartMode("lightSmart");
    });
    await act(async () => {
      await getWorkbench().openFile(fileEntry(controllerPath, "AppController.php"));
    });
    act(() => {
      getWorkbench().updateActiveEditorPosition(positionAfter(controllerSource, "app.name"));
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
      expect(configReadCount).toBe(1);
    });

    await act(async () => {
      await getWorkbench().activateWorkspaceTab("/workspace-b");
    });
    await flushAsyncTurns();

    staleConfigRead.resolve(`<?php

return [
    'name' => 'Stale',
];
`);
    await act(async () => {
      await commandPromise;
    });
    await flushAsyncTurns(24);

    expect(getWorkbench().workspaceRoot).toBe("/workspace-b");
    expect(getWorkbench().activePath).not.toBe(appConfigPath);
    expect(getWorkbench().editorRevealTarget).toBeNull();
  });
  it("suggests Laravel Cache store names from cache config", async () => {
    const controllerPath = "/workspace/app/Http/Controllers/CacheController.php";
    const configRoot = "/workspace/config";
    const cacheConfigPath = "/workspace/config/cache.php";
    const controllerSource = `<?php

use Illuminate\\Support\\Facades\\Cache;

class CacheController
{
    public function store(): void
    {
        Cache::store('red');
        Cache::memo('red');
        cache()->store('dat');
    }
}
`;
    const cacheConfigSource = `<?php

return [
    'default' => 'file',
    'stores' => [
        'file' => [
            'driver' => 'file',
        ],
        'redis' => [
            'driver' => 'redis',
        ],
        'database' => [
            'driver' => 'database',
        ],
    ],
];
`;
    const { getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace",
      },
      readDirectory: vi.fn(async (path: string) =>
        path === configRoot ? [fileEntry(cacheConfigPath, "cache.php")] : [],
      ),
      readTextFile: vi.fn(async (path: string) => {
        if (path === controllerPath) {
          return controllerSource;
        }

        if (path === cacheConfigPath) {
          return cacheConfigSource;
        }

        return "";
      }),
      workspaceDescriptor: phpWorkspaceDescriptor(),
    });
    await flushAsyncTurns();
    await act(async () => {
      await getWorkbench().setSmartMode("fullSmart");
    });
    await act(async () => {
      await getWorkbench().openFile(fileEntry(controllerPath, "CacheController.php"));
    });

    await expect(
      getWorkbench().providePhpMethodCompletions(
        controllerSource,
        positionAfter(controllerSource, "Cache::store('red"),
      ),
    ).resolves.toEqual([
      completion({
        declaringClassName: "config/cache.php",
        insertText: "redis",
        kind: "config",
        name: "redis",
        parameters: "",
        returnType: null,
      }),
    ]);
    await expect(
      getWorkbench().providePhpMethodCompletions(
        controllerSource,
        positionAfter(controllerSource, "Cache::memo('red"),
      ),
    ).resolves.toEqual([
      completion({
        declaringClassName: "config/cache.php",
        insertText: "redis",
        kind: "config",
        name: "redis",
        parameters: "",
        returnType: null,
      }),
    ]);
    await expect(
      getWorkbench().providePhpMethodCompletions(
        controllerSource,
        positionAfter(controllerSource, "cache()->store('dat"),
      ),
    ).resolves.toEqual([
      completion({
        declaringClassName: "config/cache.php",
        insertText: "database",
        kind: "config",
        name: "database",
        parameters: "",
        returnType: null,
      }),
    ]);
  });
  it("opens Laravel Cache store names before LSP fallback", async () => {
    const controllerPath = "/workspace/app/Http/Controllers/CacheController.php";
    const cacheConfigPath = "/workspace/config/cache.php";
    const controllerSource = `<?php

use Illuminate\\Support\\Facades\\Cache;

class CacheController
{
    public function store(): mixed
    {
        return Cache::memo('redis')->get('profile');
    }
}
`;
    const cacheConfigSource = `<?php

return [
    'default' => 'file',
    'stores' => [
        'file' => [
            'driver' => 'file',
        ],
        'redis' => [
            'driver' => 'redis',
        ],
    ],
];
`;
    const languageServerFeaturesGateway = featuresGateway();
    const { getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace",
      },
      languageServerFeaturesGateway,
      readTextFile: vi.fn(async (path: string) => {
        if (path === controllerPath) {
          return controllerSource;
        }

        if (path === cacheConfigPath) {
          return cacheConfigSource;
        }

        throw new Error(`Unexpected read ${path}`);
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
      await getWorkbench().openFile(fileEntry(controllerPath, "CacheController.php"));
    });
    act(() => {
      getWorkbench().updateActiveEditorPosition(
        positionAfter(controllerSource, "Cache::memo('redis"),
      );
    });

    await act(async () => {
      await getWorkbench()
        .commands.find((candidate) => candidate.id === "editor.goToDefinition")
        ?.run();
    });

    expect(languageServerFeaturesGateway.definition).not.toHaveBeenCalled();
    expect(getWorkbench().activePath).toBe(cacheConfigPath);
    expect(getWorkbench().editorRevealTarget).toEqual({
      path: cacheConfigPath,
      position: {
        column: 10,
        lineNumber: 9,
      },
    });
  });
  it("suggests Laravel database connection names from database config", async () => {
    const controllerPath = "/workspace/app/Http/Controllers/DatabaseController.php";
    const configRoot = "/workspace/config";
    const databaseConfigPath = "/workspace/config/database.php";
    const controllerSource = `<?php

use Illuminate\\Support\\Facades\\DB;
use Illuminate\\Support\\Facades\\Schema;
use Illuminate\\Database\\Eloquent\\Model;

class DatabaseController
{
    public function connections(): void
    {
        DB::connection('my');
        Schema::connection('sq');
        db()->connection('my');
    }
}

class User extends Model
{
    protected $connection = 'my';
}
`;
    const databaseConfigSource = `<?php

return [
    'default' => 'sqlite',
    'connections' => [
        'sqlite' => [
            'driver' => 'sqlite',
        ],
        'mysql' => [
            'driver' => 'mysql',
        ],
    ],
];
`;
    const { getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace",
      },
      readDirectory: vi.fn(async (path: string) =>
        path === configRoot ? [fileEntry(databaseConfigPath, "database.php")] : [],
      ),
      readTextFile: vi.fn(async (path: string) => {
        if (path === controllerPath) {
          return controllerSource;
        }

        if (path === databaseConfigPath) {
          return databaseConfigSource;
        }

        return "";
      }),
      workspaceDescriptor: phpWorkspaceDescriptor(),
    });
    await flushAsyncTurns();
    await act(async () => {
      await getWorkbench().setSmartMode("fullSmart");
    });
    await act(async () => {
      await getWorkbench().openFile(fileEntry(controllerPath, "DatabaseController.php"));
    });

    await expect(
      getWorkbench().providePhpMethodCompletions(
        controllerSource,
        positionAfter(controllerSource, "DB::connection('my"),
      ),
    ).resolves.toEqual([
      completion({
        declaringClassName: "config/database.php",
        insertText: "mysql",
        kind: "config",
        name: "mysql",
        parameters: "",
        returnType: null,
      }),
    ]);
    await expect(
      getWorkbench().providePhpMethodCompletions(
        controllerSource,
        positionAfter(controllerSource, "Schema::connection('sq"),
      ),
    ).resolves.toEqual([
      completion({
        declaringClassName: "config/database.php",
        insertText: "sqlite",
        kind: "config",
        name: "sqlite",
        parameters: "",
        returnType: null,
      }),
    ]);
    await expect(
      getWorkbench().providePhpMethodCompletions(
        controllerSource,
        positionAfter(controllerSource, "db()->connection('my"),
      ),
    ).resolves.toEqual([
      completion({
        declaringClassName: "config/database.php",
        insertText: "mysql",
        kind: "config",
        name: "mysql",
        parameters: "",
        returnType: null,
      }),
    ]);
    await expect(
      getWorkbench().providePhpMethodCompletions(
        controllerSource,
        positionAfter(controllerSource, "protected $connection = 'my"),
      ),
    ).resolves.toEqual([
      completion({
        declaringClassName: "config/database.php",
        insertText: "mysql",
        kind: "config",
        name: "mysql",
        parameters: "",
        returnType: null,
      }),
    ]);
  });
  it("opens Laravel database connection names before LSP fallback", async () => {
    const controllerPath = "/workspace/app/Http/Controllers/DatabaseController.php";
    const databaseConfigPath = "/workspace/config/database.php";
    const controllerSource = `<?php

use Illuminate\\Support\\Facades\\DB;

class DatabaseController
{
    public function connection(): mixed
    {
        return DB::connection('mysql')->table('users')->count();
    }
}
`;
    const databaseConfigSource = `<?php

return [
    'default' => 'sqlite',
    'connections' => [
        'sqlite' => [
            'driver' => 'sqlite',
        ],
        'mysql' => [
            'driver' => 'mysql',
        ],
    ],
];
`;
    const languageServerFeaturesGateway = featuresGateway();
    const { getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace",
      },
      languageServerFeaturesGateway,
      readTextFile: vi.fn(async (path: string) => {
        if (path === controllerPath) {
          return controllerSource;
        }

        if (path === databaseConfigPath) {
          return databaseConfigSource;
        }

        throw new Error(`Unexpected read ${path}`);
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
      await getWorkbench().openFile(fileEntry(controllerPath, "DatabaseController.php"));
    });
    act(() => {
      getWorkbench().updateActiveEditorPosition(
        positionAfter(controllerSource, "DB::connection('mysql"),
      );
    });

    await act(async () => {
      await getWorkbench()
        .commands.find((candidate) => candidate.id === "editor.goToDefinition")
        ?.run();
    });

    expect(languageServerFeaturesGateway.definition).not.toHaveBeenCalled();
    expect(getWorkbench().activePath).toBe(databaseConfigPath);
    expect(getWorkbench().editorRevealTarget).toEqual({
      path: databaseConfigPath,
      position: {
        column: 10,
        lineNumber: 9,
      },
    });
  });
  it("opens Laravel Eloquent model connection properties before LSP fallback", async () => {
    const modelPath = "/workspace/app/Models/User.php";
    const databaseConfigPath = "/workspace/config/database.php";
    const modelSource = `<?php

namespace App\\Models;

use Illuminate\\Database\\Eloquent\\Model;

class User extends Model
{
    protected $connection = 'mysql';
}
`;
    const databaseConfigSource = `<?php

return [
    'default' => 'sqlite',
    'connections' => [
        'sqlite' => [
            'driver' => 'sqlite',
        ],
        'mysql' => [
            'driver' => 'mysql',
        ],
    ],
];
`;
    const languageServerFeaturesGateway = featuresGateway();
    const { getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace",
      },
      languageServerFeaturesGateway,
      readTextFile: vi.fn(async (path: string) => {
        if (path === modelPath) {
          return modelSource;
        }

        if (path === databaseConfigPath) {
          return databaseConfigSource;
        }

        throw new Error(`Unexpected read ${path}`);
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
      await getWorkbench().openFile(fileEntry(modelPath, "User.php"));
    });
    act(() => {
      getWorkbench().updateActiveEditorPosition(
        positionAfter(modelSource, "protected $connection = 'mysql"),
      );
    });

    await act(async () => {
      await getWorkbench()
        .commands.find((candidate) => candidate.id === "editor.goToDefinition")
        ?.run();
    });

    expect(languageServerFeaturesGateway.definition).not.toHaveBeenCalled();
    expect(getWorkbench().activePath).toBe(databaseConfigPath);
    expect(getWorkbench().editorRevealTarget).toEqual({
      path: databaseConfigPath,
      position: {
        column: 10,
        lineNumber: 9,
      },
    });
  });
  it("suggests Laravel Redis connection names from database config", async () => {
    const controllerPath = "/workspace/app/Http/Controllers/RedisController.php";
    const configRoot = "/workspace/config";
    const databaseConfigPath = "/workspace/config/database.php";
    const controllerSource = `<?php

use Illuminate\\Support\\Facades\\Redis;

class RedisController
{
    public function connect(): void
    {
        Redis::connection('ca');
        Redis::connection(name: 'de');
    }
}
`;
    const databaseConfigSource = `<?php

return [
    'default' => 'mysql',
    'connections' => [
        'mysql' => [
            'driver' => 'mysql',
        ],
    ],
    'redis' => [
        'client' => env('REDIS_CLIENT', 'phpredis'),
        'options' => [
            'cluster' => env('REDIS_CLUSTER', 'redis'),
        ],
        'default' => [
            'host' => env('REDIS_HOST', '127.0.0.1'),
        ],
        'cache' => [
            'host' => env('REDIS_HOST', '127.0.0.1'),
        ],
    ],
];
`;
    const { getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace",
      },
      readDirectory: vi.fn(async (path: string) =>
        path === configRoot ? [fileEntry(databaseConfigPath, "database.php")] : [],
      ),
      readTextFile: vi.fn(async (path: string) => {
        if (path === controllerPath) {
          return controllerSource;
        }

        if (path === databaseConfigPath) {
          return databaseConfigSource;
        }

        return "";
      }),
      workspaceDescriptor: phpWorkspaceDescriptor(),
    });
    await flushAsyncTurns();
    await act(async () => {
      await getWorkbench().setSmartMode("fullSmart");
    });
    await act(async () => {
      await getWorkbench().openFile(fileEntry(controllerPath, "RedisController.php"));
    });

    await expect(
      getWorkbench().providePhpMethodCompletions(
        controllerSource,
        positionAfter(controllerSource, "Redis::connection('ca"),
      ),
    ).resolves.toEqual([
      completion({
        declaringClassName: "config/database.php",
        insertText: "cache",
        kind: "config",
        name: "cache",
        parameters: "",
        returnType: null,
      }),
    ]);
    await expect(
      getWorkbench().providePhpMethodCompletions(
        controllerSource,
        positionAfter(controllerSource, "Redis::connection(name: 'de"),
      ),
    ).resolves.toEqual([
      completion({
        declaringClassName: "config/database.php",
        insertText: "default",
        kind: "config",
        name: "default",
        parameters: "",
        returnType: null,
      }),
    ]);
  });
  it("opens Laravel Redis connection names before LSP fallback", async () => {
    const controllerPath = "/workspace/app/Http/Controllers/RedisController.php";
    const databaseConfigPath = "/workspace/config/database.php";
    const controllerSource = `<?php

use Illuminate\\Support\\Facades\\Redis;

class RedisController
{
    public function connect(): mixed
    {
        return Redis::connection('cache')->get('key');
    }
}
`;
    const databaseConfigSource = `<?php

return [
    'redis' => [
        'client' => env('REDIS_CLIENT', 'phpredis'),
        'default' => [
            'host' => env('REDIS_HOST', '127.0.0.1'),
        ],
        'cache' => [
            'host' => env('REDIS_HOST', '127.0.0.1'),
        ],
    ],
];
`;
    const languageServerFeaturesGateway = featuresGateway();
    const { getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace",
      },
      languageServerFeaturesGateway,
      readTextFile: vi.fn(async (path: string) => {
        if (path === controllerPath) {
          return controllerSource;
        }

        if (path === databaseConfigPath) {
          return databaseConfigSource;
        }

        throw new Error(`Unexpected read ${path}`);
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
      await getWorkbench().openFile(fileEntry(controllerPath, "RedisController.php"));
    });
    act(() => {
      getWorkbench().updateActiveEditorPosition(
        positionAfter(controllerSource, "Redis::connection('cache"),
      );
    });

    await act(async () => {
      await getWorkbench()
        .commands.find((candidate) => candidate.id === "editor.goToDefinition")
        ?.run();
    });

    expect(languageServerFeaturesGateway.definition).not.toHaveBeenCalled();
    expect(getWorkbench().activePath).toBe(databaseConfigPath);
    expect(getWorkbench().editorRevealTarget).toEqual({
      path: databaseConfigPath,
      position: {
        column: 10,
        lineNumber: 9,
      },
    });
  });
  it("suggests Laravel Broadcast connection names from broadcasting config", async () => {
    const controllerPath = "/workspace/app/Http/Controllers/BroadcastController.php";
    const configRoot = "/workspace/config";
    const broadcastConfigPath = "/workspace/config/broadcasting.php";
    const controllerSource = `<?php

use Illuminate\\Support\\Facades\\Broadcast;

class BroadcastController
{
    public function connect(): void
    {
        Broadcast::connection('pu');
        Broadcast::driver('re');
        Broadcast::purge('lo');
        Broadcast::setDefaultDriver('pu');
        broadcast(new OrderUpdated())->via('pu');
        Broadcast::event(new OrderUpdated())->via('re');
    }
}
`;
    const broadcastConfigSource = `<?php

return [
    'default' => 'reverb',
    'connections' => [
        'reverb' => [
            'driver' => 'reverb',
        ],
        'pusher' => [
            'driver' => 'pusher',
        ],
        'log' => [
            'driver' => 'log',
        ],
    ],
];
`;
    const { getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace",
      },
      readDirectory: vi.fn(async (path: string) =>
        path === configRoot ? [fileEntry(broadcastConfigPath, "broadcasting.php")] : [],
      ),
      readTextFile: vi.fn(async (path: string) => {
        if (path === controllerPath) {
          return controllerSource;
        }

        if (path === broadcastConfigPath) {
          return broadcastConfigSource;
        }

        return "";
      }),
      workspaceDescriptor: phpWorkspaceDescriptor(),
    });
    await flushAsyncTurns();
    await act(async () => {
      await getWorkbench().setSmartMode("fullSmart");
    });
    await act(async () => {
      await getWorkbench().openFile(fileEntry(controllerPath, "BroadcastController.php"));
    });

    await expect(
      getWorkbench().providePhpMethodCompletions(
        controllerSource,
        positionAfter(controllerSource, "Broadcast::connection('pu"),
      ),
    ).resolves.toEqual([
      completion({
        declaringClassName: "config/broadcasting.php",
        insertText: "pusher",
        kind: "config",
        name: "pusher",
        parameters: "",
        returnType: null,
      }),
    ]);
    await expect(
      getWorkbench().providePhpMethodCompletions(
        controllerSource,
        positionAfter(controllerSource, "Broadcast::driver('re"),
      ),
    ).resolves.toEqual([
      completion({
        declaringClassName: "config/broadcasting.php",
        insertText: "reverb",
        kind: "config",
        name: "reverb",
        parameters: "",
        returnType: null,
      }),
    ]);
    await expect(
      getWorkbench().providePhpMethodCompletions(
        controllerSource,
        positionAfter(controllerSource, "Broadcast::purge('lo"),
      ),
    ).resolves.toEqual([
      completion({
        declaringClassName: "config/broadcasting.php",
        insertText: "log",
        kind: "config",
        name: "log",
        parameters: "",
        returnType: null,
      }),
    ]);
    await expect(
      getWorkbench().providePhpMethodCompletions(
        controllerSource,
        positionAfter(controllerSource, "broadcast(new OrderUpdated())->via('pu"),
      ),
    ).resolves.toEqual([
      completion({
        declaringClassName: "config/broadcasting.php",
        insertText: "pusher",
        kind: "config",
        name: "pusher",
        parameters: "",
        returnType: null,
      }),
    ]);
    await expect(
      getWorkbench().providePhpMethodCompletions(
        controllerSource,
        positionAfter(controllerSource, "Broadcast::event(new OrderUpdated())->via('re"),
      ),
    ).resolves.toEqual([
      completion({
        declaringClassName: "config/broadcasting.php",
        insertText: "reverb",
        kind: "config",
        name: "reverb",
        parameters: "",
        returnType: null,
      }),
    ]);
  });
  it("opens Laravel Broadcast connection names before LSP fallback", async () => {
    const controllerPath = "/workspace/app/Http/Controllers/BroadcastController.php";
    const broadcastConfigPath = "/workspace/config/broadcasting.php";
    const controllerSource = `<?php

use Illuminate\\Support\\Facades\\Broadcast;

class BroadcastController
{
    public function connect(): void
    {
        $this->broadcastVia(['reverb', 'pusher']);
    }
}
`;
    const broadcastConfigSource = `<?php

return [
    'default' => 'reverb',
    'connections' => [
        'reverb' => [
            'driver' => 'reverb',
        ],
        'pusher' => [
            'driver' => 'pusher',
        ],
    ],
];
`;
    const languageServerFeaturesGateway = featuresGateway();
    const { getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace",
      },
      languageServerFeaturesGateway,
      readTextFile: vi.fn(async (path: string) => {
        if (path === controllerPath) {
          return controllerSource;
        }

        if (path === broadcastConfigPath) {
          return broadcastConfigSource;
        }

        throw new Error(`Unexpected read ${path}`);
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
      await getWorkbench().openFile(fileEntry(controllerPath, "BroadcastController.php"));
    });
    act(() => {
      getWorkbench().updateActiveEditorPosition(positionAfter(controllerSource, "pusher"));
    });

    await act(async () => {
      await getWorkbench()
        .commands.find((candidate) => candidate.id === "editor.goToDefinition")
        ?.run();
    });

    expect(languageServerFeaturesGateway.definition).not.toHaveBeenCalled();
    expect(getWorkbench().activePath).toBe(broadcastConfigPath);
    expect(getWorkbench().editorRevealTarget).toEqual({
      path: broadcastConfigPath,
      position: {
        column: 10,
        lineNumber: 9,
      },
    });
  });
  it("suggests Laravel Queue connection names from queue config", async () => {
    const controllerPath = "/workspace/app/Http/Controllers/QueueController.php";
    const configRoot = "/workspace/config";
    const queueConfigPath = "/workspace/config/queue.php";
    const controllerSource = `<?php

use App\\Jobs\\ProcessPodcast;
use Illuminate\\Support\\Facades\\Bus;
use Illuminate\\Support\\Facades\\Queue;

class QueueController
{
    public function connections(): void
    {
        Queue::connection('re');
        Queue::connected('sy');
        ProcessPodcast::dispatch()->onConnection('sq');
        Bus::chain([])->allOnConnection('re');
        Queue::route(ProcessPodcast::class, connection: 'da');
        Queue::route(ProcessPodcast::class, 'emails', 're');
    }
}
`;
    const queueConfigSource = `<?php

return [
    'default' => 'sync',
    'connections' => [
        'sync' => [
            'driver' => 'sync',
        ],
        'redis' => [
            'driver' => 'redis',
        ],
        'sqs' => [
            'driver' => 'sqs',
        ],
        'database' => [
            'driver' => 'database',
        ],
    ],
];
`;
    const { getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace",
      },
      readDirectory: vi.fn(async (path: string) =>
        path === configRoot ? [fileEntry(queueConfigPath, "queue.php")] : [],
      ),
      readTextFile: vi.fn(async (path: string) => {
        if (path === controllerPath) {
          return controllerSource;
        }

        if (path === queueConfigPath) {
          return queueConfigSource;
        }

        return "";
      }),
      workspaceDescriptor: phpWorkspaceDescriptor(),
    });
    await flushAsyncTurns();
    await act(async () => {
      await getWorkbench().setSmartMode("fullSmart");
    });
    await act(async () => {
      await getWorkbench().openFile(fileEntry(controllerPath, "QueueController.php"));
    });

    await expect(
      getWorkbench().providePhpMethodCompletions(
        controllerSource,
        positionAfter(controllerSource, "Queue::connection('re"),
      ),
    ).resolves.toEqual([
      completion({
        declaringClassName: "config/queue.php",
        insertText: "redis",
        kind: "config",
        name: "redis",
        parameters: "",
        returnType: null,
      }),
    ]);
    await expect(
      getWorkbench().providePhpMethodCompletions(
        controllerSource,
        positionAfter(controllerSource, "Queue::connected('sy"),
      ),
    ).resolves.toEqual([
      completion({
        declaringClassName: "config/queue.php",
        insertText: "sync",
        kind: "config",
        name: "sync",
        parameters: "",
        returnType: null,
      }),
    ]);
    await expect(
      getWorkbench().providePhpMethodCompletions(
        controllerSource,
        positionAfter(controllerSource, "onConnection('sq"),
      ),
    ).resolves.toEqual([
      completion({
        declaringClassName: "config/queue.php",
        insertText: "sqs",
        kind: "config",
        name: "sqs",
        parameters: "",
        returnType: null,
      }),
    ]);
    await expect(
      getWorkbench().providePhpMethodCompletions(
        controllerSource,
        positionAfter(controllerSource, "allOnConnection('re"),
      ),
    ).resolves.toEqual([
      completion({
        declaringClassName: "config/queue.php",
        insertText: "redis",
        kind: "config",
        name: "redis",
        parameters: "",
        returnType: null,
      }),
    ]);
    await expect(
      getWorkbench().providePhpMethodCompletions(
        controllerSource,
        positionAfter(controllerSource, "connection: 'da"),
      ),
    ).resolves.toEqual([
      completion({
        declaringClassName: "config/queue.php",
        insertText: "database",
        kind: "config",
        name: "database",
        parameters: "",
        returnType: null,
      }),
    ]);
    await expect(
      getWorkbench().providePhpMethodCompletions(
        controllerSource,
        positionAfter(controllerSource, "'emails', 're"),
      ),
    ).resolves.toEqual([
      completion({
        declaringClassName: "config/queue.php",
        insertText: "redis",
        kind: "config",
        name: "redis",
        parameters: "",
        returnType: null,
      }),
    ]);
  });
  it("opens Laravel Queue connection names before LSP fallback", async () => {
    const controllerPath = "/workspace/app/Http/Controllers/QueueController.php";
    const queueConfigPath = "/workspace/config/queue.php";
    const controllerSource = `<?php

use App\\Jobs\\ProcessPodcast;

class QueueController
{
    public function dispatch(): void
    {
        ProcessPodcast::dispatch()->onConnection('redis');
    }
}
`;
    const queueConfigSource = `<?php

return [
    'default' => 'sync',
    'connections' => [
        'sync' => [
            'driver' => 'sync',
        ],
        'redis' => [
            'driver' => 'redis',
        ],
    ],
];
`;
    const languageServerFeaturesGateway = featuresGateway();
    const { getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace",
      },
      languageServerFeaturesGateway,
      readTextFile: vi.fn(async (path: string) => {
        if (path === controllerPath) {
          return controllerSource;
        }

        if (path === queueConfigPath) {
          return queueConfigSource;
        }

        throw new Error(`Unexpected read ${path}`);
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
      await getWorkbench().openFile(fileEntry(controllerPath, "QueueController.php"));
    });
    act(() => {
      getWorkbench().updateActiveEditorPosition(
        positionAfter(controllerSource, "onConnection('redis"),
      );
    });

    await act(async () => {
      await getWorkbench()
        .commands.find((candidate) => candidate.id === "editor.goToDefinition")
        ?.run();
    });

    expect(languageServerFeaturesGateway.definition).not.toHaveBeenCalled();
    expect(getWorkbench().activePath).toBe(queueConfigPath);
    expect(getWorkbench().editorRevealTarget).toEqual({
      path: queueConfigPath,
      position: {
        column: 10,
        lineNumber: 9,
      },
    });
  });
  it("suggests Laravel Mail mailer names from mail config", async () => {
    const controllerPath = "/workspace/app/Http/Controllers/MailController.php";
    const configRoot = "/workspace/config";
    const mailConfigPath = "/workspace/config/mail.php";
    const controllerSource = `<?php

use Illuminate\\Support\\Facades\\Mail;
use Illuminate\\Notifications\\Messages\\MailMessage;

class MailController
{
    public function send(): void
    {
        Mail::mailer('post');
        Mail::driver('sm');
        Mail::purge('post');
        Mail::setDefaultDriver('sm');
        (new MailMessage)->mailer('post');
    }
}
`;
    const mailConfigSource = `<?php

return [
    'default' => 'smtp',
    'mailers' => [
        'smtp' => [
            'transport' => 'smtp',
        ],
        'postmark' => [
            'transport' => 'postmark',
        ],
    ],
];
`;
    const { getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace",
      },
      readDirectory: vi.fn(async (path: string) =>
        path === configRoot ? [fileEntry(mailConfigPath, "mail.php")] : [],
      ),
      readTextFile: vi.fn(async (path: string) => {
        if (path === controllerPath) {
          return controllerSource;
        }

        if (path === mailConfigPath) {
          return mailConfigSource;
        }

        return "";
      }),
      workspaceDescriptor: phpWorkspaceDescriptor(),
    });
    await flushAsyncTurns();
    await act(async () => {
      await getWorkbench().setSmartMode("fullSmart");
    });
    await act(async () => {
      await getWorkbench().openFile(fileEntry(controllerPath, "MailController.php"));
    });

    await expect(
      getWorkbench().providePhpMethodCompletions(
        controllerSource,
        positionAfter(controllerSource, "Mail::mailer('post"),
      ),
    ).resolves.toEqual([
      completion({
        declaringClassName: "config/mail.php",
        insertText: "postmark",
        kind: "config",
        name: "postmark",
        parameters: "",
        returnType: null,
      }),
    ]);
    await expect(
      getWorkbench().providePhpMethodCompletions(
        controllerSource,
        positionAfter(controllerSource, "Mail::driver('sm"),
      ),
    ).resolves.toEqual([
      completion({
        declaringClassName: "config/mail.php",
        insertText: "smtp",
        kind: "config",
        name: "smtp",
        parameters: "",
        returnType: null,
      }),
    ]);
    await expect(
      getWorkbench().providePhpMethodCompletions(
        controllerSource,
        positionAfter(controllerSource, "Mail::purge('post"),
      ),
    ).resolves.toEqual([
      completion({
        declaringClassName: "config/mail.php",
        insertText: "postmark",
        kind: "config",
        name: "postmark",
        parameters: "",
        returnType: null,
      }),
    ]);
    await expect(
      getWorkbench().providePhpMethodCompletions(
        controllerSource,
        positionAfter(controllerSource, "Mail::setDefaultDriver('sm"),
      ),
    ).resolves.toEqual([
      completion({
        declaringClassName: "config/mail.php",
        insertText: "smtp",
        kind: "config",
        name: "smtp",
        parameters: "",
        returnType: null,
      }),
    ]);
    await expect(
      getWorkbench().providePhpMethodCompletions(
        controllerSource,
        positionAfter(controllerSource, "(new MailMessage)->mailer('post"),
      ),
    ).resolves.toEqual([
      completion({
        declaringClassName: "config/mail.php",
        insertText: "postmark",
        kind: "config",
        name: "postmark",
        parameters: "",
        returnType: null,
      }),
    ]);
  });
  it("opens Laravel Mail mailer names before LSP fallback", async () => {
    const controllerPath = "/workspace/app/Http/Controllers/MailController.php";
    const mailConfigPath = "/workspace/config/mail.php";
    const controllerSource = `<?php

use Illuminate\\Notifications\\Messages\\MailMessage;

class MailController
{
    public function send(): MailMessage
    {
        return (new MailMessage)->mailer('postmark');
    }
}
`;
    const mailConfigSource = `<?php

return [
    'default' => 'smtp',
    'mailers' => [
        'smtp' => [
            'transport' => 'smtp',
        ],
        'postmark' => [
            'transport' => 'postmark',
        ],
    ],
];
`;
    const languageServerFeaturesGateway = featuresGateway();
    const { getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace",
      },
      languageServerFeaturesGateway,
      readTextFile: vi.fn(async (path: string) => {
        if (path === controllerPath) {
          return controllerSource;
        }

        if (path === mailConfigPath) {
          return mailConfigSource;
        }

        throw new Error(`Unexpected read ${path}`);
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
      await getWorkbench().openFile(fileEntry(controllerPath, "MailController.php"));
    });
    act(() => {
      getWorkbench().updateActiveEditorPosition(
        positionAfter(controllerSource, "(new MailMessage)->mailer('postmark"),
      );
    });

    await act(async () => {
      await getWorkbench()
        .commands.find((candidate) => candidate.id === "editor.goToDefinition")
        ?.run();
    });

    expect(languageServerFeaturesGateway.definition).not.toHaveBeenCalled();
    expect(getWorkbench().activePath).toBe(mailConfigPath);
    expect(getWorkbench().editorRevealTarget).toEqual({
      path: mailConfigPath,
      position: {
        column: 10,
        lineNumber: 9,
      },
    });
  });
  it("suggests Laravel Log channel names from logging config", async () => {
    const controllerPath = "/workspace/app/Http/Controllers/LogController.php";
    const configRoot = "/workspace/config";
    const loggingConfigPath = "/workspace/config/logging.php";
    const controllerSource = `<?php

use Illuminate\\Support\\Facades\\Log;

class LogController
{
    public function report(): void
    {
        Log::channel('sl');
        Log::driver('da');
        Log::stack(['sl']);
        Log::stack(channels: ['da']);
    }
}
`;
    const loggingConfigSource = `<?php

return [
    'default' => 'stack',
    'channels' => [
        'daily' => [
            'driver' => 'daily',
        ],
        'slack' => [
            'driver' => 'slack',
        ],
    ],
];
`;
    const { getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace",
      },
      readDirectory: vi.fn(async (path: string) =>
        path === configRoot ? [fileEntry(loggingConfigPath, "logging.php")] : [],
      ),
      readTextFile: vi.fn(async (path: string) => {
        if (path === controllerPath) {
          return controllerSource;
        }

        if (path === loggingConfigPath) {
          return loggingConfigSource;
        }

        return "";
      }),
      workspaceDescriptor: phpWorkspaceDescriptor(),
    });
    await flushAsyncTurns();
    await act(async () => {
      await getWorkbench().setSmartMode("fullSmart");
    });
    await act(async () => {
      await getWorkbench().openFile(fileEntry(controllerPath, "LogController.php"));
    });

    await expect(
      getWorkbench().providePhpMethodCompletions(
        controllerSource,
        positionAfter(controllerSource, "Log::channel('sl"),
      ),
    ).resolves.toEqual([
      completion({
        declaringClassName: "config/logging.php",
        insertText: "slack",
        kind: "config",
        name: "slack",
        parameters: "",
        returnType: null,
      }),
    ]);
    await expect(
      getWorkbench().providePhpMethodCompletions(
        controllerSource,
        positionAfter(controllerSource, "Log::driver('da"),
      ),
    ).resolves.toEqual([
      completion({
        declaringClassName: "config/logging.php",
        insertText: "daily",
        kind: "config",
        name: "daily",
        parameters: "",
        returnType: null,
      }),
    ]);
    await expect(
      getWorkbench().providePhpMethodCompletions(
        controllerSource,
        positionAfter(controllerSource, "Log::stack(['sl"),
      ),
    ).resolves.toEqual([
      completion({
        declaringClassName: "config/logging.php",
        insertText: "slack",
        kind: "config",
        name: "slack",
        parameters: "",
        returnType: null,
      }),
    ]);
    await expect(
      getWorkbench().providePhpMethodCompletions(
        controllerSource,
        positionAfter(controllerSource, "channels: ['da"),
      ),
    ).resolves.toEqual([
      completion({
        declaringClassName: "config/logging.php",
        insertText: "daily",
        kind: "config",
        name: "daily",
        parameters: "",
        returnType: null,
      }),
    ]);
  });
  it("opens Laravel Log channel names before LSP fallback", async () => {
    const controllerPath = "/workspace/app/Http/Controllers/LogController.php";
    const loggingConfigPath = "/workspace/config/logging.php";
    const controllerSource = `<?php

use Illuminate\\Support\\Facades\\Log;

class LogController
{
    public function report(): void
    {
        Log::stack(['daily', 'slack'])->error('Payment failed.');
    }
}
`;
    const loggingConfigSource = `<?php

return [
    'default' => 'stack',
    'channels' => [
        'daily' => [
            'driver' => 'daily',
        ],
        'slack' => [
            'driver' => 'slack',
        ],
    ],
];
`;
    const languageServerFeaturesGateway = featuresGateway();
    const { getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace",
      },
      languageServerFeaturesGateway,
      readTextFile: vi.fn(async (path: string) => {
        if (path === controllerPath) {
          return controllerSource;
        }

        if (path === loggingConfigPath) {
          return loggingConfigSource;
        }

        throw new Error(`Unexpected read ${path}`);
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
      await getWorkbench().openFile(fileEntry(controllerPath, "LogController.php"));
    });
    act(() => {
      getWorkbench().updateActiveEditorPosition(positionAfter(controllerSource, "slack"));
    });

    await act(async () => {
      await getWorkbench()
        .commands.find((candidate) => candidate.id === "editor.goToDefinition")
        ?.run();
    });

    expect(languageServerFeaturesGateway.definition).not.toHaveBeenCalled();
    expect(getWorkbench().activePath).toBe(loggingConfigPath);
    expect(getWorkbench().editorRevealTarget).toEqual({
      path: loggingConfigPath,
      position: {
        column: 10,
        lineNumber: 9,
      },
    });
  });
  it("suggests Laravel Storage disk names from filesystem config", async () => {
    const controllerPath = "/workspace/app/Http/Controllers/UploadController.php";
    const configRoot = "/workspace/config";
    const filesystemsConfigPath = "/workspace/config/filesystems.php";
    const controllerSource = `<?php

use Illuminate\\Support\\Facades\\Storage;

class UploadController
{
    public function store(): void
    {
        Storage::disk('s');
        Storage::persistentFake(disk: 'pu');
    }
}
`;
    const filesystemsConfigSource = `<?php

return [
    'default' => 'local',
    'disks' => [
        'local' => [
            'driver' => 'local',
        ],
        'public' => [
            'driver' => 'local',
        ],
        's3' => [
            'driver' => 's3',
        ],
    ],
];
`;
    const { getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace",
      },
      readDirectory: vi.fn(async (path: string) =>
        path === configRoot ? [fileEntry(filesystemsConfigPath, "filesystems.php")] : [],
      ),
      readTextFile: vi.fn(async (path: string) => {
        if (path === controllerPath) {
          return controllerSource;
        }

        if (path === filesystemsConfigPath) {
          return filesystemsConfigSource;
        }

        return "";
      }),
      workspaceDescriptor: phpWorkspaceDescriptor(),
    });
    await flushAsyncTurns();
    await act(async () => {
      await getWorkbench().setSmartMode("fullSmart");
    });
    await act(async () => {
      await getWorkbench().openFile(fileEntry(controllerPath, "UploadController.php"));
    });

    await expect(
      getWorkbench().providePhpMethodCompletions(
        controllerSource,
        positionAfter(controllerSource, "Storage::disk('s"),
      ),
    ).resolves.toEqual([
      completion({
        declaringClassName: "config/filesystems.php",
        insertText: "s3",
        kind: "config",
        name: "s3",
        parameters: "",
        returnType: null,
      }),
    ]);
    await expect(
      getWorkbench().providePhpMethodCompletions(
        controllerSource,
        positionAfter(controllerSource, "disk: 'pu"),
      ),
    ).resolves.toEqual([
      completion({
        declaringClassName: "config/filesystems.php",
        insertText: "public",
        kind: "config",
        name: "public",
        parameters: "",
        returnType: null,
      }),
    ]);
  });
  it("opens Laravel Storage disk names before LSP fallback", async () => {
    const controllerPath = "/workspace/app/Http/Controllers/UploadController.php";
    const filesystemsConfigPath = "/workspace/config/filesystems.php";
    const controllerSource = `<?php

use Illuminate\\Support\\Facades\\Storage;

class UploadController
{
    public function store(): void
    {
        Storage::disk('s3')->put('avatar.jpg', $contents);
    }
}
`;
    const filesystemsConfigSource = `<?php

return [
    'default' => 'local',
    'disks' => [
        'local' => [
            'driver' => 'local',
        ],
        's3' => [
            'driver' => 's3',
        ],
    ],
];
`;
    const languageServerFeaturesGateway = featuresGateway();
    const { getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace",
      },
      languageServerFeaturesGateway,
      readTextFile: vi.fn(async (path: string) => {
        if (path === controllerPath) {
          return controllerSource;
        }

        if (path === filesystemsConfigPath) {
          return filesystemsConfigSource;
        }

        throw new Error(`Unexpected read ${path}`);
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
      await getWorkbench().openFile(fileEntry(controllerPath, "UploadController.php"));
    });
    act(() => {
      getWorkbench().updateActiveEditorPosition(
        positionAfter(controllerSource, "Storage::disk('s3"),
      );
    });

    await act(async () => {
      await getWorkbench()
        .commands.find((candidate) => candidate.id === "editor.goToDefinition")
        ?.run();
    });

    expect(languageServerFeaturesGateway.definition).not.toHaveBeenCalled();
    expect(getWorkbench().activePath).toBe(filesystemsConfigPath);
    expect(getWorkbench().editorRevealTarget).toEqual({
      path: filesystemsConfigPath,
      position: {
        column: 10,
        lineNumber: 9,
      },
    });
  });
  it("suggests Laravel Auth guard names from auth config", async () => {
    const controllerPath = "/workspace/app/Http/Controllers/AuthController.php";
    const configRoot = "/workspace/config";
    const authConfigPath = "/workspace/config/auth.php";
    const controllerSource = `<?php

use Illuminate\\Support\\Facades\\Auth;
use Illuminate\\Container\\Attributes\\Authenticated;
use Illuminate\\Container\\Attributes\\CurrentUser;

class AuthController
{
    public function login(
        #[Authenticated('ad')] mixed $user,
        #[CurrentUser('we')] mixed $currentUser,
    ): void {
        Auth::guard('ad');
        Auth::shouldUse('we');
        Auth::setDefaultDriver(name: 'ad');
        auth('we');
        auth()->guard(name: 'ad');
        request()->user('ad');
        Route::middleware('auth:ad');
        Route::middleware(['guest:ad']);
    }
}
`;
    const authConfigSource = `<?php

return [
    'defaults' => [
        'guard' => 'web',
    ],
    'guards' => [
        'web' => [
            'driver' => 'session',
        ],
        'admin' => [
            'driver' => 'session',
        ],
    ],
];
`;
    const { getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace",
      },
      readDirectory: vi.fn(async (path: string) =>
        path === configRoot ? [fileEntry(authConfigPath, "auth.php")] : [],
      ),
      readTextFile: vi.fn(async (path: string) => {
        if (path === controllerPath) {
          return controllerSource;
        }

        if (path === authConfigPath) {
          return authConfigSource;
        }

        return "";
      }),
      workspaceDescriptor: phpWorkspaceDescriptor(),
    });
    await flushAsyncTurns();
    await act(async () => {
      await getWorkbench().setSmartMode("fullSmart");
    });
    await act(async () => {
      await getWorkbench().openFile(fileEntry(controllerPath, "AuthController.php"));
    });

    await expect(
      getWorkbench().providePhpMethodCompletions(
        controllerSource,
        positionAfter(controllerSource, "Auth::guard('ad"),
      ),
    ).resolves.toEqual([
      completion({
        declaringClassName: "config/auth.php",
        insertText: "admin",
        kind: "config",
        name: "admin",
        parameters: "",
        returnType: null,
      }),
    ]);
    await expect(
      getWorkbench().providePhpMethodCompletions(
        controllerSource,
        positionAfter(controllerSource, "Auth::shouldUse('we"),
      ),
    ).resolves.toEqual([
      completion({
        declaringClassName: "config/auth.php",
        insertText: "web",
        kind: "config",
        name: "web",
        parameters: "",
        returnType: null,
      }),
    ]);
    await expect(
      getWorkbench().providePhpMethodCompletions(
        controllerSource,
        positionAfter(controllerSource, "Auth::setDefaultDriver(name: 'ad"),
      ),
    ).resolves.toEqual([
      completion({
        declaringClassName: "config/auth.php",
        insertText: "admin",
        kind: "config",
        name: "admin",
        parameters: "",
        returnType: null,
      }),
    ]);
    await expect(
      getWorkbench().providePhpMethodCompletions(
        controllerSource,
        positionAfter(controllerSource, "auth('we"),
      ),
    ).resolves.toEqual([
      completion({
        declaringClassName: "config/auth.php",
        insertText: "web",
        kind: "config",
        name: "web",
        parameters: "",
        returnType: null,
      }),
    ]);
    await expect(
      getWorkbench().providePhpMethodCompletions(
        controllerSource,
        positionAfter(controllerSource, "auth()->guard(name: 'ad"),
      ),
    ).resolves.toEqual([
      completion({
        declaringClassName: "config/auth.php",
        insertText: "admin",
        kind: "config",
        name: "admin",
        parameters: "",
        returnType: null,
      }),
    ]);
    await expect(
      getWorkbench().providePhpMethodCompletions(
        controllerSource,
        positionAfter(controllerSource, "request()->user('ad"),
      ),
    ).resolves.toEqual([
      completion({
        declaringClassName: "config/auth.php",
        insertText: "admin",
        kind: "config",
        name: "admin",
        parameters: "",
        returnType: null,
      }),
    ]);
    await expect(
      getWorkbench().providePhpMethodCompletions(
        controllerSource,
        positionAfter(controllerSource, "Route::middleware('auth:ad"),
      ),
    ).resolves.toEqual([
      completion({
        declaringClassName: "config/auth.php",
        insertText: "admin",
        kind: "config",
        name: "admin",
        parameters: "",
        returnType: null,
      }),
    ]);
    await expect(
      getWorkbench().providePhpMethodCompletions(
        controllerSource,
        positionAfter(controllerSource, "Route::middleware(['guest:ad"),
      ),
    ).resolves.toEqual([
      completion({
        declaringClassName: "config/auth.php",
        insertText: "admin",
        kind: "config",
        name: "admin",
        parameters: "",
        returnType: null,
      }),
    ]);
    await expect(
      getWorkbench().providePhpMethodCompletions(
        controllerSource,
        positionAfter(controllerSource, "Authenticated('ad"),
      ),
    ).resolves.toEqual([
      completion({
        declaringClassName: "config/auth.php",
        insertText: "admin",
        kind: "config",
        name: "admin",
        parameters: "",
        returnType: null,
      }),
    ]);
    await expect(
      getWorkbench().providePhpMethodCompletions(
        controllerSource,
        positionAfter(controllerSource, "CurrentUser('we"),
      ),
    ).resolves.toEqual([
      completion({
        declaringClassName: "config/auth.php",
        insertText: "web",
        kind: "config",
        name: "web",
        parameters: "",
        returnType: null,
      }),
    ]);
  });
  it("opens Laravel Auth guard names before LSP fallback", async () => {
    const controllerPath = "/workspace/app/Http/Controllers/AuthController.php";
    const authConfigPath = "/workspace/config/auth.php";
    const controllerSource = `<?php

use Illuminate\\Container\\Attributes\\CurrentUser;

class AuthController
{
    public function login(#[CurrentUser('admin')] mixed $user): void
    {
    }
}
`;
    const authConfigSource = `<?php

return [
    'defaults' => [
        'guard' => 'web',
    ],
    'guards' => [
        'web' => [
            'driver' => 'session',
        ],
        'admin' => [
            'driver' => 'session',
        ],
    ],
];
`;
    const languageServerFeaturesGateway = featuresGateway();
    const { getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace",
      },
      languageServerFeaturesGateway,
      readTextFile: vi.fn(async (path: string) => {
        if (path === controllerPath) {
          return controllerSource;
        }

        if (path === authConfigPath) {
          return authConfigSource;
        }

        throw new Error(`Unexpected read ${path}`);
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
      await getWorkbench().openFile(fileEntry(controllerPath, "AuthController.php"));
    });
    act(() => {
      getWorkbench().updateActiveEditorPosition(
        positionAfter(controllerSource, "CurrentUser('admin"),
      );
    });

    await act(async () => {
      await getWorkbench()
        .commands.find((candidate) => candidate.id === "editor.goToDefinition")
        ?.run();
    });

    expect(languageServerFeaturesGateway.definition).not.toHaveBeenCalled();
    expect(getWorkbench().activePath).toBe(authConfigPath);
    expect(getWorkbench().editorRevealTarget).toEqual({
      path: authConfigPath,
      position: {
        column: 10,
        lineNumber: 11,
      },
    });
  });
  it("opens Laravel Auth route middleware guard names before LSP fallback", async () => {
    const controllerPath = "/workspace/routes/web.php";
    const authConfigPath = "/workspace/config/auth.php";
    const controllerSource = `<?php

use Illuminate\\Support\\Facades\\Route;

Route::middleware('auth:admin')->group(function () {
    Route::get('/admin', fn () => null);
});
`;
    const authConfigSource = `<?php

return [
    'defaults' => [
        'guard' => 'web',
    ],
    'guards' => [
        'web' => [
            'driver' => 'session',
        ],
        'admin' => [
            'driver' => 'session',
        ],
    ],
];
`;
    const languageServerFeaturesGateway = featuresGateway();
    const { getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace",
      },
      languageServerFeaturesGateway,
      readTextFile: vi.fn(async (path: string) => {
        if (path === controllerPath) {
          return controllerSource;
        }

        if (path === authConfigPath) {
          return authConfigSource;
        }

        throw new Error(`Unexpected read ${path}`);
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
      await getWorkbench().openFile(fileEntry(controllerPath, "web.php"));
    });
    act(() => {
      getWorkbench().updateActiveEditorPosition(positionAfter(controllerSource, "auth:admin"));
    });

    await act(async () => {
      await getWorkbench()
        .commands.find((candidate) => candidate.id === "editor.goToDefinition")
        ?.run();
    });

    expect(languageServerFeaturesGateway.definition).not.toHaveBeenCalled();
    expect(getWorkbench().activePath).toBe(authConfigPath);
    expect(getWorkbench().editorRevealTarget).toEqual({
      path: authConfigPath,
      position: {
        column: 10,
        lineNumber: 11,
      },
    });
  });
  it("opens Laravel middleware alias registrations before LSP fallback", async () => {
    const controllerPath = "/workspace/routes/web.php";
    const kernelPath = "/workspace/app/Http/Kernel.php";
    const controllerSource = `<?php

use Illuminate\\Support\\Facades\\Route;

Route::middleware('verified')->group(function () {
    Route::get('/admin', fn () => null);
});
`;
    const kernelSource = `<?php

namespace App\\Http;

use Illuminate\\Foundation\\Http\\Kernel as HttpKernel;

class Kernel extends HttpKernel
{
    protected $middlewareAliases = [
        'auth' => \\App\\Http\\Middleware\\Authenticate::class,
        'verified' => EnsureEmailIsVerified::class,
    ];
}
`;
    const languageServerFeaturesGateway = featuresGateway();
    const { getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace",
      },
      languageServerFeaturesGateway,
      readTextFile: vi.fn(async (path: string) => {
        if (path === controllerPath) {
          return controllerSource;
        }

        if (path === kernelPath) {
          return kernelSource;
        }

        throw new Error(`Unexpected read ${path}`);
      }),
      runtimeStatus: {
        capabilities: {
          ...emptyLanguageServerCapabilities(),
          definition: true,
        },
        kind: "running",
        sessionId: 1,
      },
      searchText: vi.fn(async (_root: string, query: string) =>
        query === "middlewareAliases"
          ? [
              {
                column: 15,
                lineNumber: 9,
                lineText: "    protected $middlewareAliases = [",
                path: kernelPath,
                relativePath: "app/Http/Kernel.php",
              },
            ]
          : [],
      ),
      workspaceDescriptor: phpWorkspaceDescriptor(),
    });
    await flushAsyncTurns();
    await act(async () => {
      await getWorkbench().setSmartMode("lightSmart");
    });
    await act(async () => {
      await getWorkbench().openFile(fileEntry(controllerPath, "web.php"));
    });
    act(() => {
      getWorkbench().updateActiveEditorPosition(
        positionAfter(controllerSource, "Route::middleware('verified"),
      );
    });

    await act(async () => {
      await getWorkbench()
        .commands.find((candidate) => candidate.id === "editor.goToDefinition")
        ?.run();
    });

    expect(languageServerFeaturesGateway.definition).not.toHaveBeenCalled();
    expect(getWorkbench().activePath).toBe(kernelPath);
    expect(getWorkbench().editorRevealTarget).toEqual({
      path: kernelPath,
      position: {
        column: 10,
        lineNumber: 11,
      },
    });
  });
  it("suggests Laravel Password broker names from auth config", async () => {
    const controllerPath = "/workspace/app/Http/Controllers/PasswordController.php";
    const configRoot = "/workspace/config";
    const authConfigPath = "/workspace/config/auth.php";
    const controllerSource = `<?php

use Illuminate\\Support\\Facades\\Password;

class PasswordController
{
    public function reset(): void
    {
        Password::broker('ad');
        Password::setDefaultDriver(name: 'us');
    }
}
`;
    const authConfigSource = `<?php

return [
    'defaults' => [
        'passwords' => 'users',
    ],
    'passwords' => [
        'users' => [
            'provider' => 'users',
        ],
        'admins' => [
            'provider' => 'admins',
        ],
    ],
];
`;
    const { getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace",
      },
      readDirectory: vi.fn(async (path: string) =>
        path === configRoot ? [fileEntry(authConfigPath, "auth.php")] : [],
      ),
      readTextFile: vi.fn(async (path: string) => {
        if (path === controllerPath) {
          return controllerSource;
        }

        if (path === authConfigPath) {
          return authConfigSource;
        }

        return "";
      }),
      workspaceDescriptor: phpWorkspaceDescriptor(),
    });
    await flushAsyncTurns();
    await act(async () => {
      await getWorkbench().setSmartMode("fullSmart");
    });
    await act(async () => {
      await getWorkbench().openFile(fileEntry(controllerPath, "PasswordController.php"));
    });

    await expect(
      getWorkbench().providePhpMethodCompletions(
        controllerSource,
        positionAfter(controllerSource, "Password::broker('ad"),
      ),
    ).resolves.toEqual([
      completion({
        declaringClassName: "config/auth.php",
        insertText: "admins",
        kind: "config",
        name: "admins",
        parameters: "",
        returnType: null,
      }),
    ]);
    await expect(
      getWorkbench().providePhpMethodCompletions(
        controllerSource,
        positionAfter(controllerSource, "Password::setDefaultDriver(name: 'us"),
      ),
    ).resolves.toEqual([
      completion({
        declaringClassName: "config/auth.php",
        insertText: "users",
        kind: "config",
        name: "users",
        parameters: "",
        returnType: null,
      }),
    ]);
  });
  it("opens Laravel Password broker names before LSP fallback", async () => {
    const controllerPath = "/workspace/app/Http/Controllers/PasswordController.php";
    const authConfigPath = "/workspace/config/auth.php";
    const controllerSource = `<?php

use Illuminate\\Support\\Facades\\Password;

class PasswordController
{
    public function reset(): void
    {
        Password::broker('admins')->sendResetLink([]);
    }
}
`;
    const authConfigSource = `<?php

return [
    'defaults' => [
        'passwords' => 'users',
    ],
    'passwords' => [
        'users' => [
            'provider' => 'users',
        ],
        'admins' => [
            'provider' => 'admins',
        ],
    ],
];
`;
    const languageServerFeaturesGateway = featuresGateway();
    const { getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace",
      },
      languageServerFeaturesGateway,
      readTextFile: vi.fn(async (path: string) => {
        if (path === controllerPath) {
          return controllerSource;
        }

        if (path === authConfigPath) {
          return authConfigSource;
        }

        throw new Error(`Unexpected read ${path}`);
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
      await getWorkbench().openFile(fileEntry(controllerPath, "PasswordController.php"));
    });
    act(() => {
      getWorkbench().updateActiveEditorPosition(
        positionAfter(controllerSource, "Password::broker('admins"),
      );
    });

    await act(async () => {
      await getWorkbench()
        .commands.find((candidate) => candidate.id === "editor.goToDefinition")
        ?.run();
    });

    expect(languageServerFeaturesGateway.definition).not.toHaveBeenCalled();
    expect(getWorkbench().activePath).toBe(authConfigPath);
    expect(getWorkbench().editorRevealTarget).toEqual({
      path: authConfigPath,
      position: {
        column: 10,
        lineNumber: 11,
      },
    });
  });
  it("suggests Laravel translation keys inside translation helper strings", async () => {
    const controllerPath = "/workspace/app/Http/Controllers/AppController.php";
    const langBase = "/workspace/lang";
    const langRoot = "/workspace/lang/en";
    const messagesPath = "/workspace/lang/en/messages.php";
    const controllerSource = `<?php

class AppController
{
    public function label(): string
    {
        return __('messages.we');
    }
}
`;
    const messagesSource = `<?php

return [
    'welcome' => 'Welcome',
    'nested' => [
        'label' => 'Nested',
    ],
];
`;
    const { getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace",
      },
      readDirectory: vi.fn(async (path: string) =>
        path === langBase
          ? [directoryEntry(langRoot, "en")]
          : path === langRoot
            ? [fileEntry(messagesPath, "messages.php")]
            : [],
      ),
      readTextFile: vi.fn(async (path: string) => {
        if (path === controllerPath) {
          return controllerSource;
        }

        if (path === messagesPath) {
          return messagesSource;
        }

        return "";
      }),
      workspaceDescriptor: phpWorkspaceDescriptor(),
    });
    await flushAsyncTurns();
    await act(async () => {
      await getWorkbench().setSmartMode("fullSmart");
    });
    await act(async () => {
      await getWorkbench().openFile(fileEntry(controllerPath, "AppController.php"));
    });

    await expect(
      getWorkbench().providePhpMethodCompletions(
        controllerSource,
        positionAfter(controllerSource, "messages.we"),
      ),
    ).resolves.toEqual([
      completion({
        declaringClassName: "lang/en/messages.php",
        insertText: "welcome",
        kind: "translation",
        name: "messages.welcome",
        parameters: "",
        returnType: null,
      }),
    ]);
  });
  it("suggests Laravel translation keys from discovered locale directories", async () => {
    const controllerPath = "/workspace/app/Http/Controllers/AppController.php";
    const langBase = "/workspace/lang";
    const langRoot = "/workspace/lang/sk";
    const messagesPath = "/workspace/lang/sk/messages.php";
    const controllerSource = `<?php

class AppController
{
    public function label(): string
    {
        return __('messages.vi');
    }
}
`;
    const { getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace",
      },
      readDirectory: vi.fn(async (path: string) =>
        path === langBase
          ? [directoryEntry(langRoot, "sk")]
          : path === langRoot
            ? [fileEntry(messagesPath, "messages.php")]
            : [],
      ),
      readTextFile: vi.fn(async (path: string) => {
        if (path === controllerPath) {
          return controllerSource;
        }

        if (path === messagesPath) {
          return `<?php

return [
    'vitajte' => 'Vitajte',
];
`;
        }

        return "";
      }),
      workspaceDescriptor: phpWorkspaceDescriptor(),
    });
    await flushAsyncTurns();
    await act(async () => {
      await getWorkbench().setSmartMode("fullSmart");
    });
    await act(async () => {
      await getWorkbench().openFile(fileEntry(controllerPath, "AppController.php"));
    });

    await expect(
      getWorkbench().providePhpMethodCompletions(
        controllerSource,
        positionAfter(controllerSource, "messages.vi"),
      ),
    ).resolves.toEqual([
      completion({
        declaringClassName: "lang/sk/messages.php",
        insertText: "vitajte",
        kind: "translation",
        name: "messages.vitajte",
        parameters: "",
        returnType: null,
      }),
    ]);
  });
  it("suggests Laravel JSON translation keys inside translation helper strings", async () => {
    const controllerPath = "/workspace/app/Http/Controllers/AppController.php";
    const langBase = "/workspace/lang";
    const jsonPath = "/workspace/lang/es.json";
    const controllerSource = `<?php

class AppController
{
    public function label(): string
    {
        return __('I lo');
    }
}
`;
    const { getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace",
      },
      readDirectory: vi.fn(async (path: string) =>
        path === langBase ? [fileEntry(jsonPath, "es.json")] : [],
      ),
      readTextFile: vi.fn(async (path: string) => {
        if (path === controllerPath) {
          return controllerSource;
        }

        if (path === jsonPath) {
          return `{
  "I love programming.": "Me encanta programar."
}
`;
        }

        return "";
      }),
      workspaceDescriptor: phpWorkspaceDescriptor(),
    });
    await flushAsyncTurns();
    await act(async () => {
      await getWorkbench().setSmartMode("fullSmart");
    });
    await act(async () => {
      await getWorkbench().openFile(fileEntry(controllerPath, "AppController.php"));
    });

    await expect(
      getWorkbench().providePhpMethodCompletions(
        controllerSource,
        positionAfter(controllerSource, "I lo"),
      ),
    ).resolves.toEqual([
      completion({
        declaringClassName: "lang/es.json",
        insertText: "love programming.",
        kind: "translation",
        name: "I love programming.",
        parameters: "",
        returnType: null,
      }),
    ]);
  });
  it("stops stale Laravel JSON translation discovery completions after switching project tabs", async () => {
    const controllerPath = "/workspace-a/app/Http/Controllers/AppController.php";
    const langBase = "/workspace-a/lang";
    const jsonPath = "/workspace-a/lang/es.json";
    const staleLangRead = createDeferred<FileEntry[]>();
    const controllerSource = `<?php

class AppController
{
    public function label(): string
    {
        return __('I lo');
    }
}
`;
    let langReadCount = 0;
    let completionsPromise: ReturnType<WorkbenchController["providePhpMethodCompletions"]> | null =
      null;
    const { getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace-a",
        workspaceTabs: ["/workspace-a", "/workspace-b"],
      },
      readDirectory: vi.fn(async (path: string) => {
        if (path === langBase) {
          langReadCount += 1;
          return staleLangRead.promise;
        }

        return [];
      }),
      readTextFile: vi.fn(async (path: string) =>
        path === controllerPath
          ? controllerSource
          : `{
  "I love programming.": "Stale"
}
`,
      ),
      workspaceDescriptor: phpWorkspaceDescriptor(),
    });
    await flushAsyncTurns();
    await act(async () => {
      await getWorkbench().setSmartMode("fullSmart");
    });
    await act(async () => {
      await getWorkbench().openFile(fileEntry(controllerPath, "AppController.php"));
    });

    act(() => {
      completionsPromise = getWorkbench().providePhpMethodCompletions(
        controllerSource,
        positionAfter(controllerSource, "I lo"),
      );
    });
    await waitForReact(() => {
      expect(langReadCount).toBe(1);
    });

    await act(async () => {
      await getWorkbench().activateWorkspaceTab("/workspace-b");
    });
    await flushAsyncTurns();

    staleLangRead.resolve([fileEntry(jsonPath, "es.json")]);

    await expect(completionsPromise!).resolves.toEqual([]);
    expect(getWorkbench().workspaceRoot).toBe("/workspace-b");
  });
  it("stops stale Laravel translation completions after switching project tabs", async () => {
    const controllerPath = "/workspace-a/app/Http/Controllers/AppController.php";
    const langBase = "/workspace-a/lang";
    const langRoot = "/workspace-a/lang/en";
    const messagesPath = "/workspace-a/lang/en/messages.php";
    const staleMessagesRead = createDeferred<string>();
    const controllerSource = `<?php

class AppController
{
    public function label(): string
    {
        return __('messages.we');
    }
}
`;
    let messagesReadCount = 0;
    let completionsPromise: ReturnType<WorkbenchController["providePhpMethodCompletions"]> | null =
      null;
    const { getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace-a",
        workspaceTabs: ["/workspace-a", "/workspace-b"],
      },
      readDirectory: vi.fn(async (path: string) =>
        path === langBase
          ? [directoryEntry(langRoot, "en")]
          : path === langRoot
            ? [fileEntry(messagesPath, "messages.php")]
            : [],
      ),
      readTextFile: vi.fn(async (path: string) => {
        if (path === controllerPath) {
          return controllerSource;
        }

        if (path === messagesPath) {
          messagesReadCount += 1;
          return staleMessagesRead.promise;
        }

        return "";
      }),
      workspaceDescriptor: phpWorkspaceDescriptor(),
    });
    await flushAsyncTurns();
    await act(async () => {
      await getWorkbench().setSmartMode("fullSmart");
    });
    await act(async () => {
      await getWorkbench().openFile(fileEntry(controllerPath, "AppController.php"));
    });

    act(() => {
      completionsPromise = getWorkbench().providePhpMethodCompletions(
        controllerSource,
        positionAfter(controllerSource, "messages.we"),
      );
    });
    await waitForReact(() => {
      expect(messagesReadCount).toBe(1);
    });

    await act(async () => {
      await getWorkbench().activateWorkspaceTab("/workspace-b");
    });
    await flushAsyncTurns();

    staleMessagesRead.resolve(`<?php

return [
    'welcome' => 'Stale',
];
`);

    await expect(completionsPromise!).resolves.toEqual([]);
    expect(getWorkbench().workspaceRoot).toBe("/workspace-b");
  });
  it("stops stale Laravel JSON translation completions after switching project tabs", async () => {
    const controllerPath = "/workspace-a/app/Http/Controllers/AppController.php";
    const langBase = "/workspace-a/lang";
    const jsonPath = "/workspace-a/lang/es.json";
    const staleJsonRead = createDeferred<string>();
    const controllerSource = `<?php

class AppController
{
    public function label(): string
    {
        return __('I lo');
    }
}
`;
    let jsonReadCount = 0;
    let completionsPromise: ReturnType<WorkbenchController["providePhpMethodCompletions"]> | null =
      null;
    const { getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace-a",
        workspaceTabs: ["/workspace-a", "/workspace-b"],
      },
      readDirectory: vi.fn(async (path: string) =>
        path === langBase ? [fileEntry(jsonPath, "es.json")] : [],
      ),
      readTextFile: vi.fn(async (path: string) => {
        if (path === controllerPath) {
          return controllerSource;
        }

        if (path === jsonPath) {
          jsonReadCount += 1;
          return staleJsonRead.promise;
        }

        return "";
      }),
      workspaceDescriptor: phpWorkspaceDescriptor(),
    });
    await flushAsyncTurns();
    await act(async () => {
      await getWorkbench().setSmartMode("fullSmart");
    });
    await act(async () => {
      await getWorkbench().openFile(fileEntry(controllerPath, "AppController.php"));
    });

    act(() => {
      completionsPromise = getWorkbench().providePhpMethodCompletions(
        controllerSource,
        positionAfter(controllerSource, "I lo"),
      );
    });
    await waitForReact(() => {
      expect(jsonReadCount).toBe(1);
    });

    await act(async () => {
      await getWorkbench().activateWorkspaceTab("/workspace-b");
    });
    await flushAsyncTurns();

    staleJsonRead.resolve(`{
  "I love programming.": "Stale"
}
`);

    await expect(completionsPromise!).resolves.toEqual([]);
    expect(getWorkbench().workspaceRoot).toBe("/workspace-b");
  });
  it("stops stale Laravel translation locale discovery after switching project tabs", async () => {
    const controllerPath = "/workspace-a/app/Http/Controllers/AppController.php";
    const langBase = "/workspace-a/lang";
    const langRoot = "/workspace-a/lang/en";
    const messagesPath = "/workspace-a/lang/en/messages.php";
    const staleLangRead = createDeferred<FileEntry[]>();
    const controllerSource = `<?php

class AppController
{
    public function label(): string
    {
        return __('messages.we');
    }
}
`;
    let completionsPromise: ReturnType<WorkbenchController["providePhpMethodCompletions"]> | null =
      null;
    const { getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace-a",
        workspaceTabs: ["/workspace-a", "/workspace-b"],
      },
      readDirectory: vi.fn(async (path: string) => {
        if (path === langBase) {
          return staleLangRead.promise;
        }

        if (path === langRoot) {
          return [fileEntry(messagesPath, "messages.php")];
        }

        return [];
      }),
      readTextFile: vi.fn(async (path: string) =>
        path === controllerPath
          ? controllerSource
          : `<?php

return [
    'welcome' => 'Stale',
];
`,
      ),
      workspaceDescriptor: phpWorkspaceDescriptor(),
    });
    await flushAsyncTurns();
    await act(async () => {
      await getWorkbench().setSmartMode("fullSmart");
    });
    await act(async () => {
      await getWorkbench().openFile(fileEntry(controllerPath, "AppController.php"));
    });

    act(() => {
      completionsPromise = getWorkbench().providePhpMethodCompletions(
        controllerSource,
        positionAfter(controllerSource, "messages.we"),
      );
    });
    await waitForReact(() => {
      expect(completionsPromise).not.toBeNull();
    });

    await act(async () => {
      await getWorkbench().activateWorkspaceTab("/workspace-b");
    });
    await flushAsyncTurns();

    staleLangRead.resolve([directoryEntry(langRoot, "en")]);

    await expect(completionsPromise!).resolves.toEqual([]);
    expect(getWorkbench().workspaceRoot).toBe("/workspace-b");
  });
  it("opens Laravel translation keys before LSP fallback", async () => {
    const controllerPath = "/workspace/app/Http/Controllers/AppController.php";
    const langBase = "/workspace/lang";
    const langRoot = "/workspace/lang/en";
    const messagesPath = "/workspace/lang/en/messages.php";
    const controllerSource = `<?php

class AppController
{
    public function label(): string
    {
        return __('messages.welcome');
    }
}
`;
    const messagesSource = `<?php

return [
    'welcome' => 'Welcome',
];
`;
    const languageServerFeaturesGateway = featuresGateway();
    const { getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace",
      },
      languageServerFeaturesGateway,
      readDirectory: vi.fn(async (path: string) =>
        path === langBase ? [directoryEntry(langRoot, "en")] : [],
      ),
      readTextFile: vi.fn(async (path: string) => {
        if (path === controllerPath) {
          return controllerSource;
        }

        if (path === messagesPath) {
          return messagesSource;
        }

        throw new Error(`Unexpected read ${path}`);
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
      await getWorkbench().openFile(fileEntry(controllerPath, "AppController.php"));
    });
    act(() => {
      getWorkbench().updateActiveEditorPosition(
        positionAfter(controllerSource, "messages.welcome"),
      );
    });

    await act(async () => {
      await getWorkbench()
        .commands.find((candidate) => candidate.id === "editor.goToDefinition")
        ?.run();
    });

    expect(languageServerFeaturesGateway.definition).not.toHaveBeenCalled();
    expect(getWorkbench().activePath).toBe(messagesPath);
    expect(getWorkbench().editorRevealTarget).toEqual({
      path: messagesPath,
      position: {
        column: 6,
        lineNumber: 4,
      },
    });
  });
  it("opens Laravel JSON translation keys before LSP fallback", async () => {
    const controllerPath = "/workspace/app/Http/Controllers/AppController.php";
    const langBase = "/workspace/lang";
    const jsonPath = "/workspace/lang/es.json";
    const controllerSource = `<?php

class AppController
{
    public function label(): string
    {
        return __('I love programming.');
    }
}
`;
    const languageServerFeaturesGateway = featuresGateway();
    const { getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace",
      },
      languageServerFeaturesGateway,
      readDirectory: vi.fn(async (path: string) =>
        path === langBase ? [fileEntry(jsonPath, "es.json")] : [],
      ),
      readTextFile: vi.fn(async (path: string) => {
        if (path === controllerPath) {
          return controllerSource;
        }

        if (path === jsonPath) {
          return `{
  "I love programming.": "Me encanta programar."
}
`;
        }

        throw new Error(`Unexpected read ${path}`);
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
      await getWorkbench().openFile(fileEntry(controllerPath, "AppController.php"));
    });
    act(() => {
      getWorkbench().updateActiveEditorPosition(
        positionAfter(controllerSource, "I love programming."),
      );
    });

    await act(async () => {
      await getWorkbench()
        .commands.find((candidate) => candidate.id === "editor.goToDefinition")
        ?.run();
    });

    expect(languageServerFeaturesGateway.definition).not.toHaveBeenCalled();
    expect(getWorkbench().activePath).toBe(jsonPath);
    expect(getWorkbench().editorRevealTarget).toEqual({
      path: jsonPath,
      position: {
        column: 4,
        lineNumber: 2,
      },
    });
  });
  it("drops stale Laravel JSON translation targets after switching project tabs", async () => {
    const controllerPath = "/workspace-a/app/Http/Controllers/AppController.php";
    const langBase = "/workspace-a/lang";
    const jsonPath = "/workspace-a/lang/es.json";
    const controllerSource = `<?php

class AppController
{
    public function label(): string
    {
        return __('I love programming.');
    }
}
`;
    const staleJsonRead = createDeferred<string>();
    let jsonReadCount = 0;
    const { getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace-a",
        workspaceTabs: ["/workspace-a", "/workspace-b"],
      },
      readDirectory: vi.fn(async (path: string) =>
        path === langBase ? [fileEntry(jsonPath, "es.json")] : [],
      ),
      readTextFile: vi.fn(async (path: string) => {
        if (path === controllerPath) {
          return controllerSource;
        }

        if (path === jsonPath) {
          jsonReadCount += 1;
          return staleJsonRead.promise;
        }

        throw new Error(`Unexpected read ${path}`);
      }),
      workspaceDescriptor: phpWorkspaceDescriptor(),
    });
    await flushAsyncTurns();
    await act(async () => {
      await getWorkbench().setSmartMode("lightSmart");
    });
    await act(async () => {
      await getWorkbench().openFile(fileEntry(controllerPath, "AppController.php"));
    });
    act(() => {
      getWorkbench().updateActiveEditorPosition(
        positionAfter(controllerSource, "I love programming."),
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
      expect(jsonReadCount).toBe(1);
    });

    await act(async () => {
      await getWorkbench().activateWorkspaceTab("/workspace-b");
    });
    await flushAsyncTurns();

    staleJsonRead.resolve(`{
  "I love programming.": "Stale"
}
`);
    await act(async () => {
      await commandPromise;
    });
    await flushAsyncTurns(24);

    expect(getWorkbench().workspaceRoot).toBe("/workspace-b");
    expect(getWorkbench().activePath).not.toBe(jsonPath);
    expect(getWorkbench().editorRevealTarget).toBeNull();
  });
  it("drops stale Laravel JSON translation discovery targets after switching project tabs", async () => {
    const controllerPath = "/workspace-a/app/Http/Controllers/AppController.php";
    const langBase = "/workspace-a/lang";
    const jsonPath = "/workspace-a/lang/es.json";
    const staleLangRead = createDeferred<FileEntry[]>();
    const controllerSource = `<?php

class AppController
{
    public function label(): string
    {
        return __('I love programming.');
    }
}
`;
    let langReadCount = 0;
    const { getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace-a",
        workspaceTabs: ["/workspace-a", "/workspace-b"],
      },
      readDirectory: vi.fn(async (path: string) => {
        if (path === langBase) {
          langReadCount += 1;
          return staleLangRead.promise;
        }

        return [];
      }),
      readTextFile: vi.fn(async (path: string) => {
        if (path === controllerPath) {
          return controllerSource;
        }

        if (path === jsonPath) {
          return `{
  "I love programming.": "Stale"
}
`;
        }

        throw new Error(`Unexpected read ${path}`);
      }),
      workspaceDescriptor: phpWorkspaceDescriptor(),
    });
    await flushAsyncTurns();
    await act(async () => {
      await getWorkbench().setSmartMode("lightSmart");
    });
    await act(async () => {
      await getWorkbench().openFile(fileEntry(controllerPath, "AppController.php"));
    });
    act(() => {
      getWorkbench().updateActiveEditorPosition(
        positionAfter(controllerSource, "I love programming."),
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
      expect(langReadCount).toBe(1);
    });

    await act(async () => {
      await getWorkbench().activateWorkspaceTab("/workspace-b");
    });
    await flushAsyncTurns();

    staleLangRead.resolve([fileEntry(jsonPath, "es.json")]);
    await act(async () => {
      await commandPromise;
    });
    await flushAsyncTurns(24);

    expect(getWorkbench().workspaceRoot).toBe("/workspace-b");
    expect(getWorkbench().activePath).not.toBe(jsonPath);
    expect(getWorkbench().editorRevealTarget).toBeNull();
  });
  it("opens Laravel Lang facade translation keys before LSP fallback", async () => {
    const controllerPath = "/workspace/app/Http/Controllers/AppController.php";
    const langBase = "/workspace/lang";
    const langRoot = "/workspace/lang/en";
    const messagesPath = "/workspace/lang/en/messages.php";
    const controllerSource = `<?php

use Illuminate\\Support\\Facades\\Lang;

class AppController
{
    public function label(): bool
    {
        return Lang::has('messages.welcome');
    }
}
`;
    const messagesSource = `<?php

return [
    'welcome' => 'Welcome',
];
`;
    const languageServerFeaturesGateway = featuresGateway();
    const { getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace",
      },
      languageServerFeaturesGateway,
      readDirectory: vi.fn(async (path: string) =>
        path === langBase ? [directoryEntry(langRoot, "en")] : [],
      ),
      readTextFile: vi.fn(async (path: string) => {
        if (path === controllerPath) {
          return controllerSource;
        }

        if (path === messagesPath) {
          return messagesSource;
        }

        throw new Error(`Unexpected read ${path}`);
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
      await getWorkbench().openFile(fileEntry(controllerPath, "AppController.php"));
    });
    act(() => {
      getWorkbench().updateActiveEditorPosition(
        positionAfter(controllerSource, "messages.welcome"),
      );
    });

    await act(async () => {
      await getWorkbench()
        .commands.find((candidate) => candidate.id === "editor.goToDefinition")
        ?.run();
    });

    expect(languageServerFeaturesGateway.definition).not.toHaveBeenCalled();
    expect(getWorkbench().activePath).toBe(messagesPath);
    expect(getWorkbench().editorRevealTarget).toEqual({
      path: messagesPath,
      position: {
        column: 6,
        lineNumber: 4,
      },
    });
  });
  it("drops stale Laravel translation targets after switching project tabs", async () => {
    const controllerPath = "/workspace-a/app/Http/Controllers/AppController.php";
    const langBase = "/workspace-a/lang";
    const langRoot = "/workspace-a/lang/en";
    const messagesPath = "/workspace-a/lang/en/messages.php";
    const controllerSource = `<?php

class AppController
{
    public function label(): string
    {
        return __('messages.welcome');
    }
}
`;
    const staleMessagesRead = createDeferred<string>();
    let messagesReadCount = 0;
    const { getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace-a",
        workspaceTabs: ["/workspace-a", "/workspace-b"],
      },
      readDirectory: vi.fn(async (path: string) =>
        path === langBase ? [directoryEntry(langRoot, "en")] : [],
      ),
      readTextFile: vi.fn(async (path: string) => {
        if (path === controllerPath) {
          return controllerSource;
        }

        if (path === messagesPath) {
          messagesReadCount += 1;
          return staleMessagesRead.promise;
        }

        throw new Error(`Unexpected read ${path}`);
      }),
      workspaceDescriptor: phpWorkspaceDescriptor(),
    });
    await flushAsyncTurns();
    await act(async () => {
      await getWorkbench().setSmartMode("lightSmart");
    });
    await act(async () => {
      await getWorkbench().openFile(fileEntry(controllerPath, "AppController.php"));
    });
    act(() => {
      getWorkbench().updateActiveEditorPosition(
        positionAfter(controllerSource, "messages.welcome"),
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
      expect(messagesReadCount).toBe(1);
    });

    await act(async () => {
      await getWorkbench().activateWorkspaceTab("/workspace-b");
    });
    await flushAsyncTurns();

    staleMessagesRead.resolve(`<?php

return [
    'welcome' => 'Stale',
];
`);
    await act(async () => {
      await commandPromise;
    });
    await flushAsyncTurns(24);

    expect(getWorkbench().workspaceRoot).toBe("/workspace-b");
    expect(getWorkbench().activePath).not.toBe(messagesPath);
    expect(getWorkbench().editorRevealTarget).toBeNull();
  });
  it("drops stale Laravel translation locale discovery targets after switching project tabs", async () => {
    const controllerPath = "/workspace-a/app/Http/Controllers/AppController.php";
    const langBase = "/workspace-a/lang";
    const langRoot = "/workspace-a/lang/en";
    const messagesPath = "/workspace-a/lang/en/messages.php";
    const controllerSource = `<?php

class AppController
{
    public function label(): string
    {
        return __('messages.welcome');
    }
    }
`;
    const staleLangRead = createDeferred<FileEntry[]>();
    let langReadCount = 0;
    const { getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace-a",
        workspaceTabs: ["/workspace-a", "/workspace-b"],
      },
      readDirectory: vi.fn(async (path: string) => {
        if (path === langBase) {
          langReadCount += 1;
          return staleLangRead.promise;
        }

        return [];
      }),
      readTextFile: vi.fn(async (path: string) => {
        if (path === controllerPath) {
          return controllerSource;
        }

        if (path === messagesPath) {
          return `<?php

return [
    'welcome' => 'Stale',
];
`;
        }

        throw new Error(`Unexpected read ${path}`);
      }),
      workspaceDescriptor: phpWorkspaceDescriptor(),
    });
    await flushAsyncTurns();
    await act(async () => {
      await getWorkbench().setSmartMode("lightSmart");
    });
    await act(async () => {
      await getWorkbench().openFile(fileEntry(controllerPath, "AppController.php"));
    });
    act(() => {
      getWorkbench().updateActiveEditorPosition(
        positionAfter(controllerSource, "messages.welcome"),
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
      expect(langReadCount).toBe(1);
    });

    await act(async () => {
      await getWorkbench().activateWorkspaceTab("/workspace-b");
    });
    await flushAsyncTurns();

    staleLangRead.resolve([directoryEntry(langRoot, "en")]);
    await act(async () => {
      await commandPromise;
    });
    await flushAsyncTurns(24);

    expect(getWorkbench().workspaceRoot).toBe("/workspace-b");
    expect(getWorkbench().activePath).not.toBe(messagesPath);
    expect(getWorkbench().editorRevealTarget).toBeNull();
  });
  it("suggests Laravel env keys inside env helper strings", async () => {
    const controllerPath = "/workspace/app/Http/Controllers/AppController.php";
    const envPath = "/workspace/.env";
    const controllerSource = `<?php

class AppController
{
    public function name(): string
    {
        return env('APP_NA');
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

        if (path === envPath) {
          return "APP_NAME=Codevo\nAPP_ENV=local\n";
        }

        return "";
      }),
      workspaceDescriptor: phpWorkspaceDescriptor(),
    });
    await flushAsyncTurns();
    await act(async () => {
      await getWorkbench().setSmartMode("fullSmart");
    });
    await act(async () => {
      await getWorkbench().openFile(fileEntry(controllerPath, "AppController.php"));
    });

    await expect(
      getWorkbench().providePhpMethodCompletions(
        controllerSource,
        positionAfter(controllerSource, "APP_NA"),
      ),
    ).resolves.toEqual([
      completion({
        declaringClassName: ".env",
        insertText: "APP_NAME",
        kind: "env",
        name: "APP_NAME",
        parameters: "",
        returnType: null,
      }),
    ]);
  });
  it("suggests Laravel env keys inside Env facade get strings", async () => {
    const controllerPath = "/workspace/app/Http/Controllers/AppController.php";
    const envPath = "/workspace/.env";
    const controllerSource = `<?php

class AppController
{
    public function name(): string
    {
        return Env::get('APP_NA');
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

        if (path === envPath) {
          return "APP_NAME=Codevo\nAPP_ENV=local\n";
        }

        return "";
      }),
      workspaceDescriptor: phpWorkspaceDescriptor(),
    });
    await flushAsyncTurns();
    await act(async () => {
      await getWorkbench().setSmartMode("fullSmart");
    });
    await act(async () => {
      await getWorkbench().openFile(fileEntry(controllerPath, "AppController.php"));
    });

    await expect(
      getWorkbench().providePhpMethodCompletions(
        controllerSource,
        positionAfter(controllerSource, "APP_NA"),
      ),
    ).resolves.toEqual([
      completion({
        declaringClassName: ".env",
        insertText: "APP_NAME",
        kind: "env",
        name: "APP_NAME",
        parameters: "",
        returnType: null,
      }),
    ]);
  });
  it("suggests Laravel env example keys when .env is missing", async () => {
    const controllerPath = "/workspace/app/Http/Controllers/AppController.php";
    const envPath = "/workspace/.env";
    const envExamplePath = "/workspace/.env.example";
    const controllerSource = `<?php

class AppController
{
    public function name(): string
    {
        return env('APP_NA');
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

        if (path === envPath) {
          throw new Error("missing .env");
        }

        if (path === envExamplePath) {
          return "APP_NAME=Codevo\n";
        }

        return "";
      }),
      workspaceDescriptor: phpWorkspaceDescriptor(),
    });
    await flushAsyncTurns();
    await act(async () => {
      await getWorkbench().setSmartMode("fullSmart");
    });
    await act(async () => {
      await getWorkbench().openFile(fileEntry(controllerPath, "AppController.php"));
    });

    await expect(
      getWorkbench().providePhpMethodCompletions(
        controllerSource,
        positionAfter(controllerSource, "APP_NA"),
      ),
    ).resolves.toEqual([
      completion({
        declaringClassName: ".env.example",
        insertText: "APP_NAME",
        kind: "env",
        name: "APP_NAME",
        parameters: "",
        returnType: null,
      }),
    ]);
  });
  it("stops stale Laravel env completions after switching project tabs", async () => {
    const controllerPath = "/workspace-a/app/Http/Controllers/AppController.php";
    const envPath = "/workspace-a/.env";
    const staleEnvRead = createDeferred<string>();
    const controllerSource = `<?php

class AppController
{
    public function name(): string
    {
        return env('APP_NA');
    }
}
`;
    let envReadCount = 0;
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

        if (path === envPath) {
          envReadCount += 1;
          return staleEnvRead.promise;
        }

        return "";
      }),
      workspaceDescriptor: phpWorkspaceDescriptor(),
    });
    await flushAsyncTurns();
    await act(async () => {
      await getWorkbench().setSmartMode("fullSmart");
    });
    await act(async () => {
      await getWorkbench().openFile(fileEntry(controllerPath, "AppController.php"));
    });

    act(() => {
      completionsPromise = getWorkbench().providePhpMethodCompletions(
        controllerSource,
        positionAfter(controllerSource, "APP_NA"),
      );
    });
    await waitForReact(() => {
      expect(envReadCount).toBe(1);
    });

    await act(async () => {
      await getWorkbench().activateWorkspaceTab("/workspace-b");
    });
    await flushAsyncTurns();

    staleEnvRead.resolve("APP_NAME=Stale\n");

    await expect(completionsPromise!).resolves.toEqual([]);
    expect(getWorkbench().workspaceRoot).toBe("/workspace-b");
  });
  it("opens Laravel env keys before LSP fallback", async () => {
    const controllerPath = "/workspace/app/Http/Controllers/AppController.php";
    const envPath = "/workspace/.env";
    const controllerSource = `<?php

class AppController
{
    public function name(): string
    {
        return env('APP_NAME');
    }
}
`;
    const languageServerFeaturesGateway = featuresGateway();
    const { getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace",
      },
      languageServerFeaturesGateway,
      readTextFile: vi.fn(async (path: string) => {
        if (path === controllerPath) {
          return controllerSource;
        }

        if (path === envPath) {
          return "APP_NAME=Codevo\nAPP_ENV=local\n";
        }

        throw new Error(`Unexpected read ${path}`);
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
      await getWorkbench().openFile(fileEntry(controllerPath, "AppController.php"));
    });
    act(() => {
      getWorkbench().updateActiveEditorPosition(positionAfter(controllerSource, "APP_NAME"));
    });

    await act(async () => {
      await getWorkbench()
        .commands.find((candidate) => candidate.id === "editor.goToDefinition")
        ?.run();
    });

    expect(languageServerFeaturesGateway.definition).not.toHaveBeenCalled();
    expect(getWorkbench().activePath).toBe(envPath);
    expect(getWorkbench().editorRevealTarget).toEqual({
      path: envPath,
      position: {
        column: 1,
        lineNumber: 1,
      },
    });
  });
  it("opens Laravel env example keys before LSP fallback when .env is missing", async () => {
    const controllerPath = "/workspace/app/Http/Controllers/AppController.php";
    const envPath = "/workspace/.env";
    const envExamplePath = "/workspace/.env.example";
    const controllerSource = `<?php

class AppController
{
    public function name(): string
    {
        return env('APP_NAME');
    }
}
`;
    const languageServerFeaturesGateway = featuresGateway();
    const { getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace",
      },
      languageServerFeaturesGateway,
      readTextFile: vi.fn(async (path: string) => {
        if (path === controllerPath) {
          return controllerSource;
        }

        if (path === envPath) {
          throw new Error("missing .env");
        }

        if (path === envExamplePath) {
          return "APP_NAME=Codevo\n";
        }

        throw new Error(`Unexpected read ${path}`);
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
      await getWorkbench().openFile(fileEntry(controllerPath, "AppController.php"));
    });
    act(() => {
      getWorkbench().updateActiveEditorPosition(positionAfter(controllerSource, "APP_NAME"));
    });

    await act(async () => {
      await getWorkbench()
        .commands.find((candidate) => candidate.id === "editor.goToDefinition")
        ?.run();
    });

    expect(languageServerFeaturesGateway.definition).not.toHaveBeenCalled();
    expect(getWorkbench().activePath).toBe(envExamplePath);
    expect(getWorkbench().editorRevealTarget).toEqual({
      path: envExamplePath,
      position: {
        column: 1,
        lineNumber: 1,
      },
    });
  });
  it("drops stale Laravel env targets after switching project tabs", async () => {
    const controllerPath = "/workspace-a/app/Http/Controllers/AppController.php";
    const envPath = "/workspace-a/.env";
    const controllerSource = `<?php

class AppController
{
    public function name(): string
    {
        return env('APP_NAME');
    }
}
`;
    const staleEnvRead = createDeferred<string>();
    let envReadCount = 0;
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

        if (path === envPath) {
          envReadCount += 1;
          return staleEnvRead.promise;
        }

        throw new Error(`Unexpected read ${path}`);
      }),
      workspaceDescriptor: phpWorkspaceDescriptor(),
    });
    await flushAsyncTurns();
    await act(async () => {
      await getWorkbench().setSmartMode("lightSmart");
    });
    await act(async () => {
      await getWorkbench().openFile(fileEntry(controllerPath, "AppController.php"));
    });
    act(() => {
      getWorkbench().updateActiveEditorPosition(positionAfter(controllerSource, "APP_NAME"));
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
      expect(envReadCount).toBe(1);
    });

    await act(async () => {
      await getWorkbench().activateWorkspaceTab("/workspace-b");
    });
    await flushAsyncTurns();

    staleEnvRead.resolve("APP_NAME=Stale\n");
    await act(async () => {
      await commandPromise;
    });
    await flushAsyncTurns(24);

    expect(getWorkbench().workspaceRoot).toBe("/workspace-b");
    expect(getWorkbench().activePath).not.toBe(envPath);
    expect(getWorkbench().editorRevealTarget).toBeNull();
  });
  describe("Laravel string-helper Cmd+Click definition", () => {
    it("navigates a config literal to the config file key line", async () => {
      const controllerPath = "/workspace/app/Http/Controllers/AppController.php";
      const appConfigPath = "/workspace/config/app.php";
      const controllerSource = `<?php

class AppController
{
    public function name(): string
    {
        return config('app.name');
    }
}
`;
      const appConfigSource = `<?php

return [
    'name' => env('APP_NAME', 'Laravel'),
];
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

          if (path === appConfigPath) {
            return appConfigSource;
          }

          throw new Error(`Unexpected read ${path}`);
        }),
        workspaceDescriptor: phpWorkspaceDescriptor(),
      });
      await flushAsyncTurns();
      await act(async () => {
        await getWorkbench().setSmartMode("lightSmart");
      });
      await act(async () => {
        await getWorkbench().openFile(fileEntry(controllerPath, "AppController.php"));
      });

      let handled = false;
      await act(async () => {
        handled = await getWorkbench().providePhpFrameworkDefinition(
          controllerSource,
          controllerSource.indexOf("app.name") + 1,
        );
      });

      expect(handled).toBe(true);
      expect(getWorkbench().activePath).toBe(appConfigPath);
      expect(getWorkbench().editorRevealTarget).toEqual({
        path: appConfigPath,
        position: {
          column: 6,
          lineNumber: 4,
        },
      });
    });

    it("keeps framework navigation active after cancelling the workspace picker", async () => {
      const controllerPath = "/workspace/app/Http/Controllers/AppController.php";
      const appConfigPath = "/workspace/config/app.php";
      const controllerSource = `<?php

class AppController
{
    public function name(): string
    {
        return config('app.name');
    }
}
`;
      const appConfigSource = `<?php

return [
    'name' => 'Codevo',
];
`;
      const openFromPicker = vi.fn(async () => ({
        status: "cancelled" as const,
      }));
      const { getWorkbench } = renderController({
        appSettings: {
          ...defaultAppSettings(),
          recentWorkspacePath: "/workspace",
        },
        readTextFile: vi.fn(async (path: string) => {
          if (path === controllerPath) {
            return controllerSource;
          }

          if (path === appConfigPath) {
            return appConfigSource;
          }

          throw new Error(`Unexpected read ${path}`);
        }),
        workspaceDescriptor: phpWorkspaceDescriptor(),
        workspaceIdentityGateway: {
          getDescriptor: vi.fn(),
          openFromPicker,
          unregister: vi.fn(async () => undefined),
        },
      });
      await flushAsyncTurns();
      await act(async () => {
        await getWorkbench().setSmartMode("lightSmart");
        await getWorkbench().openFile(fileEntry(controllerPath, "AppController.php"));
      });
      await act(async () => {
        await getWorkbench().openWorkspace();
      });

      expect(openFromPicker).toHaveBeenCalledOnce();
      expect(getWorkbench().workspaceRoot).toBe("/workspace");

      let handled = false;
      await act(async () => {
        handled = await getWorkbench().providePhpFrameworkDefinition(
          controllerSource,
          controllerSource.indexOf("app.name") + 1,
        );
      });

      expect(handled).toBe(true);
      expect(getWorkbench().activePath).toBe(appConfigPath);
    });

    it("navigates a view literal to its Blade file", async () => {
      const controllerPath = "/workspace/app/Http/Controllers/DashboardController.php";
      const bladePath = "/workspace/resources/views/admin/dashboard.blade.php";
      const controllerSource = `<?php

class DashboardController
{
    public function show(): mixed
    {
        return view('admin.dashboard');
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

          if (path === bladePath) {
            return "<h1>Dashboard</h1>\n";
          }

          throw new Error(`Unexpected read ${path}`);
        }),
        workspaceDescriptor: phpWorkspaceDescriptor(),
      });
      await flushAsyncTurns();
      await act(async () => {
        await getWorkbench().setSmartMode("lightSmart");
      });
      await act(async () => {
        await getWorkbench().openFile(fileEntry(controllerPath, "DashboardController.php"));
      });

      let handled = false;
      await act(async () => {
        handled = await getWorkbench().providePhpFrameworkDefinition(
          controllerSource,
          controllerSource.indexOf("admin.dashboard") + 1,
        );
      });

      expect(handled).toBe(true);
      expect(getWorkbench().activePath).toBe(bladePath);
      expect(getWorkbench().editorRevealTarget).toEqual({
        path: bladePath,
        position: {
          column: 1,
          lineNumber: 1,
        },
      });
    });

    it("navigates a View::make literal to its Blade file", async () => {
      const controllerPath = "/workspace/app/Http/Controllers/DashboardController.php";
      const bladePath = "/workspace/resources/views/admin/dashboard.blade.php";
      const controllerSource = `<?php

use Illuminate\\Support\\Facades\\View;

class DashboardController
{
    public function show(): mixed
    {
        return View::make('admin.dashboard');
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

          if (path === bladePath) {
            return "<h1>Dashboard</h1>\n";
          }

          throw new Error(`Unexpected read ${path}`);
        }),
        workspaceDescriptor: phpWorkspaceDescriptor(),
      });
      await flushAsyncTurns();
      await act(async () => {
        await getWorkbench().setSmartMode("lightSmart");
      });
      await act(async () => {
        await getWorkbench().openFile(fileEntry(controllerPath, "DashboardController.php"));
      });

      let handled = false;
      await act(async () => {
        handled = await getWorkbench().providePhpFrameworkDefinition(
          controllerSource,
          controllerSource.indexOf("admin.dashboard") + 1,
        );
      });

      expect(handled).toBe(true);
      expect(getWorkbench().activePath).toBe(bladePath);
      expect(getWorkbench().editorRevealTarget).toEqual({
        path: bladePath,
        position: {
          column: 1,
          lineNumber: 1,
        },
      });
    });

    it("navigates a trans literal to the lang file key line", async () => {
      const controllerPath = "/workspace/app/Http/Controllers/AppController.php";
      const langBase = "/workspace/lang";
      const langRoot = "/workspace/lang/en";
      const messagesPath = "/workspace/lang/en/messages.php";
      const controllerSource = `<?php

class AppController
{
    public function label(): string
    {
        return __('messages.welcome');
    }
}
`;
      const messagesSource = `<?php

return [
    'welcome' => 'Welcome',
];
`;
      const { getWorkbench } = renderController({
        appSettings: {
          ...defaultAppSettings(),
          recentWorkspacePath: "/workspace",
        },
        readDirectory: vi.fn(async (path: string) =>
          path === langBase ? [directoryEntry(langRoot, "en")] : [],
        ),
        readTextFile: vi.fn(async (path: string) => {
          if (path === controllerPath) {
            return controllerSource;
          }

          if (path === messagesPath) {
            return messagesSource;
          }

          throw new Error(`Unexpected read ${path}`);
        }),
        workspaceDescriptor: phpWorkspaceDescriptor(),
      });
      await flushAsyncTurns();
      await act(async () => {
        await getWorkbench().setSmartMode("lightSmart");
      });
      await act(async () => {
        await getWorkbench().openFile(fileEntry(controllerPath, "AppController.php"));
      });

      let handled = false;
      await act(async () => {
        handled = await getWorkbench().providePhpFrameworkDefinition(
          controllerSource,
          controllerSource.indexOf("messages.welcome") + 1,
        );
      });

      expect(handled).toBe(true);
      expect(getWorkbench().activePath).toBe(messagesPath);
      expect(getWorkbench().editorRevealTarget).toEqual({
        path: messagesPath,
        position: {
          column: 6,
          lineNumber: 4,
        },
      });
    });

    it("navigates a route literal to its named route definition", async () => {
      const controllerPath = "/workspace/app/Http/Controllers/CommentController.php";
      const routesPath = "/workspace/routes/web.php";
      const controllerSource = `<?php

class CommentController
{
    public function show(): string
    {
        return route('comments.show');
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

          if (path === routesPath) {
            return `<?php
Route::get('/comments/{comment}', [CommentController::class, 'show'])
    ->name('comments.show');
`;
          }

          return `<?php\n// ${path}\n`;
        }),
        searchText: vi.fn(async (_root, query) =>
          query === "->name("
            ? [
                {
                  column: 5,
                  lineNumber: 3,
                  lineText: "    ->name('comments.show');",
                  path: routesPath,
                  relativePath: "routes/web.php",
                },
              ]
            : [],
        ),
        workspaceDescriptor: phpWorkspaceDescriptor(),
      });
      await flushAsyncTurns();
      await act(async () => {
        await getWorkbench().setSmartMode("lightSmart");
      });
      await act(async () => {
        await getWorkbench().openFile(fileEntry(controllerPath, "CommentController.php"));
      });

      let handled = false;
      await act(async () => {
        handled = await getWorkbench().providePhpFrameworkDefinition(
          controllerSource,
          controllerSource.indexOf("comments.show") + 1,
        );
      });

      expect(handled).toBe(true);
      expect(getWorkbench().activePath).toBe(routesPath);
      expect(getWorkbench().editorRevealTarget).toEqual({
        path: routesPath,
        position: {
          column: 13,
          lineNumber: 3,
        },
      });
    });

    it("navigates a route parameter to its implicitly bound model", async () => {
      const routesPath = "/workspace/routes/web.php";
      const modelPath = "/workspace/app/Models/User.php";
      const routesSource = `<?php
Route::get('/users/{user}', [UserController::class, 'show']);
`;
      const modelSource = `<?php

namespace App\\Models;

class User extends Model
{
}
`;
      const { getWorkbench } = renderController({
        appSettings: {
          ...defaultAppSettings(),
          recentWorkspacePath: "/workspace",
        },
        readTextFile: vi.fn(async (path: string) => {
          if (path === routesPath) {
            return routesSource;
          }

          if (path === modelPath) {
            return modelSource;
          }

          throw new Error(`Unexpected read ${path}`);
        }),
        workspaceDescriptor: phpWorkspaceDescriptor(),
      });
      await flushAsyncTurns();
      await act(async () => {
        await getWorkbench().setSmartMode("lightSmart");
      });
      await act(async () => {
        await getWorkbench().openFile(fileEntry(routesPath, "web.php"));
      });

      let handled = false;
      await act(async () => {
        handled = await getWorkbench().providePhpFrameworkDefinition(
          routesSource,
          routesSource.indexOf("{user}") + 2,
        );
      });

      expect(handled).toBe(true);
      expect(getWorkbench().activePath).toBe(modelPath);
      expect(getWorkbench().editorRevealTarget).toEqual({
        path: modelPath,
        position: {
          column: 7,
          lineNumber: 5,
        },
      });
    });

    it("prefers an explicit Route::model binding over the implicit model guess", async () => {
      const routesPath = "/workspace/routes/web.php";
      const explicitModelPath = "/workspace/app/Models/Member.php";
      const implicitModelPath = "/workspace/app/Models/User.php";
      const routesSource = `<?php
use App\\Models\\Member;

Route::model('user', Member::class);
Route::get('/users/{user}', [UserController::class, 'show']);
`;
      const explicitModelSource = `<?php

namespace App\\Models;

class Member extends Model
{
}
`;
      const implicitModelSource = `<?php

namespace App\\Models;

class User extends Model
{
}
`;
      const { getWorkbench } = renderController({
        appSettings: {
          ...defaultAppSettings(),
          recentWorkspacePath: "/workspace",
        },
        readTextFile: vi.fn(async (path: string) => {
          if (path === routesPath) {
            return routesSource;
          }

          if (path === explicitModelPath) {
            return explicitModelSource;
          }

          if (path === implicitModelPath) {
            return implicitModelSource;
          }

          throw new Error(`Unexpected read ${path}`);
        }),
        workspaceDescriptor: phpWorkspaceDescriptor(),
      });
      await flushAsyncTurns();
      await act(async () => {
        await getWorkbench().setSmartMode("lightSmart");
      });
      await act(async () => {
        await getWorkbench().openFile(fileEntry(routesPath, "web.php"));
      });

      let handled = false;
      await act(async () => {
        handled = await getWorkbench().providePhpFrameworkDefinition(
          routesSource,
          routesSource.indexOf("{user}") + 2,
        );
      });

      expect(handled).toBe(true);
      expect(getWorkbench().activePath).toBe(explicitModelPath);
      expect(getWorkbench().activePath).not.toBe(implicitModelPath);
      expect(getWorkbench().editorRevealTarget).toEqual({
        path: explicitModelPath,
        position: {
          column: 7,
          lineNumber: 5,
        },
      });
    });

    it("prefers an explicit provider Route::model binding over the implicit model guess", async () => {
      const routesPath = "/workspace/routes/web.php";
      const providerPath = "/workspace/app/Providers/RouteServiceProvider.php";
      const explicitModelPath = "/workspace/app/Models/Member.php";
      const implicitModelPath = "/workspace/app/Models/User.php";
      const routesSource = `<?php
Route::get('/users/{user}', [UserController::class, 'show']);
`;
      const providerSource = `<?php

namespace App\\Providers;

use App\\Models\\Member;
use Illuminate\\Support\\Facades\\Route;

class RouteServiceProvider
{
    public function boot(): void
    {
        Route::model('user', Member::class);
    }
}
`;
      const explicitModelSource = `<?php

namespace App\\Models;

class Member extends Model
{
}
`;
      const implicitModelSource = `<?php

namespace App\\Models;

class User extends Model
{
}
`;
      const { getWorkbench } = renderController({
        appSettings: {
          ...defaultAppSettings(),
          recentWorkspacePath: "/workspace",
        },
        readTextFile: vi.fn(async (path: string) => {
          if (path === routesPath) {
            return routesSource;
          }

          if (path === providerPath) {
            return providerSource;
          }

          if (path === explicitModelPath) {
            return explicitModelSource;
          }

          if (path === implicitModelPath) {
            return implicitModelSource;
          }

          throw new Error(`Unexpected read ${path}`);
        }),
        searchText: vi.fn(async (_root, query) =>
          query === "Route::model"
            ? [
                {
                  column: 9,
                  lineNumber: 11,
                  lineText: "        Route::model('user', Member::class);",
                  path: providerPath,
                  relativePath: "app/Providers/RouteServiceProvider.php",
                },
              ]
            : [],
        ),
        workspaceDescriptor: phpWorkspaceDescriptor(),
      });
      await flushAsyncTurns();
      await act(async () => {
        await getWorkbench().setSmartMode("lightSmart");
      });
      await act(async () => {
        await getWorkbench().openFile(fileEntry(routesPath, "web.php"));
      });

      let handled = false;
      await act(async () => {
        handled = await getWorkbench().providePhpFrameworkDefinition(
          routesSource,
          routesSource.indexOf("{user}") + 2,
        );
      });

      expect(handled).toBe(true);
      expect(getWorkbench().activePath).toBe(explicitModelPath);
      expect(getWorkbench().activePath).not.toBe(implicitModelPath);
    });

    it("falls back to a legacy flat-namespaced model for a route parameter", async () => {
      const routesPath = "/workspace/routes/web.php";
      const modelsModelPath = "/workspace/app/Models/Project.php";
      const legacyModelPath = "/workspace/app/Project.php";
      const routesSource = `<?php
Route::get('/projects/{project}', [ProjectController::class, 'show']);
`;
      const legacyModelSource = `<?php

namespace App;

class Project extends Model
{
}
`;
      const { getWorkbench } = renderController({
        appSettings: {
          ...defaultAppSettings(),
          recentWorkspacePath: "/workspace",
        },
        readTextFile: vi.fn(async (path: string) => {
          if (path === routesPath) {
            return routesSource;
          }

          if (path === legacyModelPath) {
            return legacyModelSource;
          }

          throw new Error(`Unexpected read ${path}`);
        }),
        workspaceDescriptor: phpWorkspaceDescriptor(),
      });
      await flushAsyncTurns();
      await act(async () => {
        await getWorkbench().setSmartMode("lightSmart");
      });
      await act(async () => {
        await getWorkbench().openFile(fileEntry(routesPath, "web.php"));
      });

      let handled = false;
      await act(async () => {
        handled = await getWorkbench().providePhpFrameworkDefinition(
          routesSource,
          routesSource.indexOf("{project}") + 2,
        );
      });

      expect(handled).toBe(true);
      expect(getWorkbench().activePath).toBe(legacyModelPath);
      expect(getWorkbench().activePath).not.toBe(modelsModelPath);
    });

    it("does not navigate a route parameter when no bound model exists", async () => {
      const routesPath = "/workspace/routes/web.php";
      const routesSource = `<?php
Route::get('/widgets/{widget}', [WidgetController::class, 'show']);
`;
      const { getWorkbench } = renderController({
        appSettings: {
          ...defaultAppSettings(),
          recentWorkspacePath: "/workspace",
        },
        readTextFile: vi.fn(async (path: string) => {
          if (path === routesPath) {
            return routesSource;
          }

          throw new Error(`Unexpected read ${path}`);
        }),
        workspaceDescriptor: phpWorkspaceDescriptor(),
      });
      await flushAsyncTurns();
      await act(async () => {
        await getWorkbench().setSmartMode("lightSmart");
      });
      await act(async () => {
        await getWorkbench().openFile(fileEntry(routesPath, "web.php"));
      });

      let handled = true;
      await act(async () => {
        handled = await getWorkbench().providePhpFrameworkDefinition(
          routesSource,
          routesSource.indexOf("{widget}") + 2,
        );
      });

      expect(handled).toBe(false);
      expect(getWorkbench().activePath).toBe(routesPath);
    });

    it("stops stale route parameter model navigation after switching project tabs", async () => {
      const routesPath = "/workspace-a/routes/web.php";
      const modelPath = "/workspace-a/app/Models/User.php";
      const routesSource = `<?php
Route::get('/users/{user}', [UserController::class, 'show']);
`;
      const staleModelRead = createDeferred<string>();
      let modelReadCount = 0;
      const { getWorkbench } = renderController({
        appSettings: {
          ...defaultAppSettings(),
          recentWorkspacePath: "/workspace-a",
          workspaceTabs: ["/workspace-a", "/workspace-b"],
        },
        readTextFile: vi.fn(async (path: string) => {
          if (path === routesPath) {
            return routesSource;
          }

          if (path === modelPath) {
            modelReadCount += 1;
            return staleModelRead.promise;
          }

          throw new Error(`Unexpected read ${path}`);
        }),
        workspaceDescriptor: { ...phpWorkspaceDescriptor(), rootPath: "/workspace-a" },
      });
      await flushAsyncTurns();
      await act(async () => {
        await getWorkbench().setSmartMode("lightSmart");
      });
      await act(async () => {
        await getWorkbench().openFile(fileEntry(routesPath, "web.php"));
      });

      let handled = true;
      let definitionPromise: Promise<boolean> = Promise.resolve(false);
      await act(async () => {
        definitionPromise = getWorkbench().providePhpFrameworkDefinition(
          routesSource,
          routesSource.indexOf("{user}") + 2,
        );
        await Promise.resolve();
      });
      await waitForReact(() => {
        expect(modelReadCount).toBe(1);
      });

      await act(async () => {
        await getWorkbench().activateWorkspaceTab("/workspace-b");
      });
      await flushAsyncTurns();

      staleModelRead.resolve(`<?php

namespace App\\Models;

class User extends Model
{
}
`);
      await act(async () => {
        handled = await definitionPromise;
      });
      await flushAsyncTurns(24);

      expect(handled).toBe(false);
      expect(getWorkbench().workspaceRoot).toBe("/workspace-b");
      expect(getWorkbench().activePath).not.toBe(modelPath);
    });

    it("navigates a class type-hint to its definition on Cmd+Click", async () => {
      const servicePath = "/workspace/app/Services/PageService.php";
      const repositoryPath = "/workspace/app/Repositories/PageRepository.php";
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
      const repositorySource = `<?php

namespace App\\Repositories;

class PageRepository
{
}
`;
      const { getWorkbench } = renderController({
        appSettings: {
          ...defaultAppSettings(),
          recentWorkspacePath: "/workspace",
        },
        readTextFile: vi.fn(async (path: string) => {
          if (path === servicePath) {
            return serviceSource;
          }

          if (path === repositoryPath) {
            return repositorySource;
          }

          throw new Error(`Unexpected read ${path}`);
        }),
        workspaceDescriptor: phpWorkspaceDescriptor(),
      });
      await flushAsyncTurns();
      await act(async () => {
        await getWorkbench().openFile(fileEntry(servicePath, "PageService.php"));
      });

      let handled = false;
      await act(async () => {
        handled = await getWorkbench().providePhpFrameworkDefinition(
          serviceSource,
          serviceSource.indexOf("private PageRepository") + 12,
        );
      });

      expect(handled).toBe(true);
      expect(getWorkbench().activePath).toBe(repositoryPath);
      expect(getWorkbench().editorRevealTarget).toEqual({
        path: repositoryPath,
        position: {
          column: 7,
          lineNumber: lineNumberOf(repositorySource, "class PageRepository"),
        },
      });
    });

    it("navigates an interface type-hint to its definition on Cmd+Click", async () => {
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
      const { getWorkbench } = renderController({
        appSettings: {
          ...defaultAppSettings(),
          recentWorkspacePath: "/workspace",
        },
        readTextFile: vi.fn(async (path: string) => {
          if (path === servicePath) {
            return serviceSource;
          }

          if (path === interfacePath) {
            return interfaceSource;
          }

          throw new Error(`Unexpected read ${path}`);
        }),
        workspaceDescriptor: phpWorkspaceDescriptor(),
      });
      await flushAsyncTurns();
      await act(async () => {
        await getWorkbench().openFile(fileEntry(servicePath, "PageService.php"));
      });

      let handled = false;
      await act(async () => {
        handled = await getWorkbench().providePhpFrameworkDefinition(
          serviceSource,
          serviceSource.indexOf("private PageRepositoryInterface") + 12,
        );
      });

      expect(handled).toBe(true);
      expect(getWorkbench().activePath).toBe(interfacePath);
      expect(getWorkbench().editorRevealTarget).toEqual({
        path: interfacePath,
        position: {
          column: 11,
          lineNumber: lineNumberOf(interfaceSource, "interface PageRepositoryInterface"),
        },
      });
    });

    it("does not handle an unresolvable type-hint on Cmd+Click", async () => {
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
      const { getWorkbench } = renderController({
        appSettings: {
          ...defaultAppSettings(),
          recentWorkspacePath: "/workspace",
        },
        readTextFile: vi.fn(async (path: string) => {
          if (path === servicePath) {
            return serviceSource;
          }

          throw new Error(`Unexpected read ${path}`);
        }),
        workspaceDescriptor: phpWorkspaceDescriptor(),
      });
      await flushAsyncTurns();
      await act(async () => {
        await getWorkbench().openFile(fileEntry(servicePath, "PageService.php"));
      });

      let handled = true;
      await act(async () => {
        handled = await getWorkbench().providePhpFrameworkDefinition(
          serviceSource,
          serviceSource.indexOf("private UnknownDependency") + 12,
        );
      });

      expect(handled).toBe(false);
      expect(getWorkbench().activePath).toBe(servicePath);
      expect(getWorkbench().editorRevealTarget).toBeNull();
    });

    it("stops stale Cmd+Click type-hint navigation after switching project tabs", async () => {
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
      const { getWorkbench } = renderController({
        appSettings: {
          ...defaultAppSettings(),
          recentWorkspacePath: "/workspace-a",
          workspaceTabs: ["/workspace-a", "/workspace-b"],
        },
        readTextFile: vi.fn(async (path: string) => {
          if (path === servicePath) {
            return serviceSource;
          }

          if (path === repositoryPath) {
            repositoryReadCount += 1;
            return staleRepositoryRead.promise;
          }

          throw new Error(`Unexpected read ${path}`);
        }),
        workspaceDescriptor: {
          ...phpWorkspaceDescriptor(),
          rootPath: "/workspace-a",
        },
      });
      await flushAsyncTurns();
      await act(async () => {
        await getWorkbench().openFile(fileEntry(servicePath, "PageService.php"));
      });

      let handled = true;
      let definitionPromise: Promise<boolean> = Promise.resolve(false);
      await act(async () => {
        definitionPromise = getWorkbench().providePhpFrameworkDefinition(
          serviceSource,
          serviceSource.indexOf("private PageRepository") + 12,
        );
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
        handled = await definitionPromise;
      });
      await flushAsyncTurns(24);

      expect(handled).toBe(false);
      expect(getWorkbench().workspaceRoot).toBe("/workspace-b");
      expect(getWorkbench().activePath).not.toBe(repositoryPath);
    });

    it("does not navigate when the resolved Laravel file does not exist", async () => {
      const controllerPath = "/workspace/app/Http/Controllers/AppController.php";
      const missingConfigPath = "/workspace/config/missing.php";
      const controllerSource = `<?php

class AppController
{
    public function name(): string
    {
        return config('missing.key');
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

          if (path === missingConfigPath) {
            throw new Error(`Missing ${path}`);
          }

          throw new Error(`Unexpected read ${path}`);
        }),
        workspaceDescriptor: phpWorkspaceDescriptor(),
      });
      await flushAsyncTurns();
      await act(async () => {
        await getWorkbench().setSmartMode("lightSmart");
      });
      await act(async () => {
        await getWorkbench().openFile(fileEntry(controllerPath, "AppController.php"));
      });

      let handled = true;
      await act(async () => {
        handled = await getWorkbench().providePhpFrameworkDefinition(
          controllerSource,
          controllerSource.indexOf("missing.key") + 1,
        );
      });

      expect(handled).toBe(false);
      expect(getWorkbench().activePath).toBe(controllerPath);
      expect(getWorkbench().editorRevealTarget).toBeNull();
    });

    it("returns false when the offset is not inside a Laravel helper literal", async () => {
      const controllerPath = "/workspace/app/Http/Controllers/AppController.php";
      const controllerSource = `<?php

class AppController
{
    public function name(): string
    {
        return strtoupper('app.name');
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

          throw new Error(`Unexpected read ${path}`);
        }),
        workspaceDescriptor: phpWorkspaceDescriptor(),
      });
      await flushAsyncTurns();
      await act(async () => {
        await getWorkbench().setSmartMode("lightSmart");
      });
      await act(async () => {
        await getWorkbench().openFile(fileEntry(controllerPath, "AppController.php"));
      });

      let handled = true;
      await act(async () => {
        handled = await getWorkbench().providePhpFrameworkDefinition(
          controllerSource,
          controllerSource.indexOf("app.name") + 1,
        );
      });

      expect(handled).toBe(false);
      expect(getWorkbench().activePath).toBe(controllerPath);
    });

    it("drops a stale config navigation after switching project tabs mid-read", async () => {
      const controllerPath = "/workspace-a/app/Http/Controllers/AppController.php";
      const appConfigPath = "/workspace-a/config/app.php";
      const controllerSource = `<?php

class AppController
{
    public function name(): string
    {
        return config('app.name');
    }
}
`;
      const staleConfigRead = createDeferred<string>();
      let configReadCount = 0;
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

          if (path === appConfigPath) {
            configReadCount += 1;
            return staleConfigRead.promise;
          }

          throw new Error(`Unexpected read ${path}`);
        }),
        workspaceDescriptor: phpWorkspaceDescriptor(),
      });
      await flushAsyncTurns();
      await act(async () => {
        await getWorkbench().setSmartMode("lightSmart");
      });
      await act(async () => {
        await getWorkbench().openFile(fileEntry(controllerPath, "AppController.php"));
      });

      let definitionPromise: Promise<boolean> = Promise.resolve(false);
      await act(async () => {
        definitionPromise = getWorkbench().providePhpFrameworkDefinition(
          controllerSource,
          controllerSource.indexOf("app.name") + 1,
        );
        await Promise.resolve();
      });
      await waitForReact(() => {
        expect(configReadCount).toBe(1);
      });

      await act(async () => {
        await getWorkbench().activateWorkspaceTab("/workspace-b");
      });
      await flushAsyncTurns();

      staleConfigRead.resolve(`<?php

return [
    'name' => 'Stale',
];
`);
      let handled = true;
      await act(async () => {
        handled = await definitionPromise;
      });
      await flushAsyncTurns(24);

      expect(handled).toBe(false);
      expect(getWorkbench().workspaceRoot).toBe("/workspace-b");
      expect(getWorkbench().activePath).not.toBe(appConfigPath);
      expect(getWorkbench().editorRevealTarget).toBeNull();
    });

    it("drops a stale view navigation after switching project tabs mid-read", async () => {
      const controllerPath = "/workspace-a/app/Http/Controllers/DashboardController.php";
      const bladePath = "/workspace-a/resources/views/admin/dashboard.blade.php";
      const controllerSource = `<?php

class DashboardController
{
    public function show(): mixed
    {
        return view('admin.dashboard');
    }
}
`;
      const staleBladeRead = createDeferred<string>();
      let bladeReadCount = 0;
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

          if (path === bladePath) {
            bladeReadCount += 1;
            return staleBladeRead.promise;
          }

          throw new Error(`Unexpected read ${path}`);
        }),
        workspaceDescriptor: phpWorkspaceDescriptor(),
      });
      await flushAsyncTurns();
      await act(async () => {
        await getWorkbench().setSmartMode("lightSmart");
      });
      await act(async () => {
        await getWorkbench().openFile(fileEntry(controllerPath, "DashboardController.php"));
      });

      let definitionPromise: Promise<boolean> = Promise.resolve(false);
      await act(async () => {
        definitionPromise = getWorkbench().providePhpFrameworkDefinition(
          controllerSource,
          controllerSource.indexOf("admin.dashboard") + 1,
        );
        await Promise.resolve();
      });
      await waitForReact(() => {
        expect(bladeReadCount).toBe(1);
      });

      await act(async () => {
        await getWorkbench().activateWorkspaceTab("/workspace-b");
      });
      await flushAsyncTurns();

      staleBladeRead.resolve("<h1>Dashboard</h1>\n");
      let handled = true;
      await act(async () => {
        handled = await definitionPromise;
      });
      await flushAsyncTurns(24);

      expect(handled).toBe(false);
      expect(getWorkbench().workspaceRoot).toBe("/workspace-b");
      expect(getWorkbench().activePath).not.toBe(bladePath);
      expect(getWorkbench().editorRevealTarget).toBeNull();
    });
  });
  describe("Laravel Job/Event dispatch Cmd+Click definition", () => {
    it("navigates a dispatch(new Job) helper call to the job handle method", async () => {
      const controllerPath = "/workspace/app/Http/Controllers/PodcastController.php";
      const jobPath = "/workspace/app/Jobs/ProcessPodcast.php";
      const controllerSource = `<?php

namespace App\\Http\\Controllers;

use App\\Jobs\\ProcessPodcast;

class PodcastController
{
    public function store()
    {
        dispatch(new ProcessPodcast($podcast));
    }
}
`;
      const jobSource = `<?php

namespace App\\Jobs;

class ProcessPodcast
{
    public function handle()
    {
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

          if (path === jobPath) {
            return jobSource;
          }

          throw new Error(`Unexpected read ${path}`);
        }),
        workspaceDescriptor: phpWorkspaceDescriptor(),
      });
      await flushAsyncTurns();
      await act(async () => {
        await getWorkbench().setSmartMode("lightSmart");
      });
      await act(async () => {
        await getWorkbench().openFile(fileEntry(controllerPath, "PodcastController.php"));
      });

      let handled = false;
      await act(async () => {
        handled = await getWorkbench().providePhpFrameworkDefinition(
          controllerSource,
          controllerSource.indexOf("ProcessPodcast($podcast") + 2,
        );
      });

      expect(handled).toBe(true);
      expect(getWorkbench().activePath).toBe(jobPath);
      expect(getWorkbench().editorRevealTarget).toEqual({
        path: jobPath,
        position: {
          column: 21,
          lineNumber: 7,
        },
      });
    });

    it("navigates a static Job::dispatchSync call to the job handle method", async () => {
      const controllerPath = "/workspace/app/Http/Controllers/PodcastController.php";
      const jobPath = "/workspace/app/Jobs/ProcessPodcast.php";
      const controllerSource = `<?php

namespace App\\Http\\Controllers;

use App\\Jobs\\ProcessPodcast;

class PodcastController
{
    public function store()
    {
        ProcessPodcast::dispatchSync($podcast);
    }
}
`;
      const jobSource = `<?php

namespace App\\Jobs;

class ProcessPodcast
{
    public function handle()
    {
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

          if (path === jobPath) {
            return jobSource;
          }

          throw new Error(`Unexpected read ${path}`);
        }),
        workspaceDescriptor: phpWorkspaceDescriptor(),
      });
      await flushAsyncTurns();
      await act(async () => {
        await getWorkbench().setSmartMode("lightSmart");
      });
      await act(async () => {
        await getWorkbench().openFile(fileEntry(controllerPath, "PodcastController.php"));
      });

      let handled = false;
      await act(async () => {
        handled = await getWorkbench().providePhpFrameworkDefinition(
          controllerSource,
          controllerSource.indexOf("ProcessPodcast::dispatchSync") + 2,
        );
      });

      expect(handled).toBe(true);
      expect(getWorkbench().activePath).toBe(jobPath);
      expect(getWorkbench().editorRevealTarget?.position.lineNumber).toBe(7);
    });

    it("falls back to the job class declaration when handle is missing", async () => {
      const controllerPath = "/workspace/app/Http/Controllers/PodcastController.php";
      const jobPath = "/workspace/app/Jobs/ProcessPodcast.php";
      const controllerSource = `<?php

namespace App\\Http\\Controllers;

use App\\Jobs\\ProcessPodcast;

class PodcastController
{
    public function store()
    {
        dispatch(new ProcessPodcast($podcast));
    }
}
`;
      const jobSource = `<?php

namespace App\\Jobs;

class ProcessPodcast
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

          if (path === jobPath) {
            return jobSource;
          }

          throw new Error(`Unexpected read ${path}`);
        }),
        workspaceDescriptor: phpWorkspaceDescriptor(),
      });
      await flushAsyncTurns();
      await act(async () => {
        await getWorkbench().setSmartMode("lightSmart");
      });
      await act(async () => {
        await getWorkbench().openFile(fileEntry(controllerPath, "PodcastController.php"));
      });

      let handled = false;
      await act(async () => {
        handled = await getWorkbench().providePhpFrameworkDefinition(
          controllerSource,
          controllerSource.indexOf("ProcessPodcast($podcast") + 2,
        );
      });

      expect(handled).toBe(true);
      expect(getWorkbench().activePath).toBe(jobPath);
      expect(getWorkbench().editorRevealTarget?.position.lineNumber).toBe(5);
    });

    it("does not navigate when the dispatched job class cannot be resolved", async () => {
      const controllerPath = "/workspace/app/Http/Controllers/PodcastController.php";
      const controllerSource = `<?php

namespace App\\Http\\Controllers;

use App\\Jobs\\ProcessPodcast;

class PodcastController
{
    public function store()
    {
        dispatch(new ProcessPodcast($podcast));
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

          throw new Error(`Missing ${path}`);
        }),
        workspaceDescriptor: phpWorkspaceDescriptor(),
      });
      await flushAsyncTurns();
      await act(async () => {
        await getWorkbench().setSmartMode("lightSmart");
      });
      await act(async () => {
        await getWorkbench().openFile(fileEntry(controllerPath, "PodcastController.php"));
      });

      let handled = true;
      await act(async () => {
        handled = await getWorkbench().providePhpFrameworkDefinition(
          controllerSource,
          controllerSource.indexOf("ProcessPodcast($podcast") + 2,
        );
      });

      expect(handled).toBe(false);
      expect(getWorkbench().activePath).toBe(controllerPath);
    });

    it("navigates an event(new Event) helper call to the listener handle method", async () => {
      const controllerPath = "/workspace/app/Http/Controllers/OrderController.php";
      const providerPath = "/workspace/app/Providers/EventServiceProvider.php";
      const listenerPath = "/workspace/app/Listeners/SendShipmentNotification.php";
      const controllerSource = `<?php

namespace App\\Http\\Controllers;

use App\\Events\\OrderShipped;

class OrderController
{
    public function ship()
    {
        event(new OrderShipped($order));
    }
}
`;
      const providerSource = `<?php

namespace App\\Providers;

use App\\Events\\OrderShipped;
use App\\Listeners\\SendShipmentNotification;

class EventServiceProvider extends ServiceProvider
{
    protected $listen = [
        OrderShipped::class => [
            SendShipmentNotification::class,
        ],
    ];
}
`;
      const listenerSource = `<?php

namespace App\\Listeners;

class SendShipmentNotification
{
    public function handle($event)
    {
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
            return providerSource;
          }

          if (path === listenerPath) {
            return listenerSource;
          }

          throw new Error(`Unexpected read ${path}`);
        }),
        workspaceDescriptor: phpWorkspaceDescriptor(),
      });
      await flushAsyncTurns();
      await act(async () => {
        await getWorkbench().setSmartMode("lightSmart");
      });
      await act(async () => {
        await getWorkbench().openFile(fileEntry(controllerPath, "OrderController.php"));
      });

      let handled = false;
      await act(async () => {
        handled = await getWorkbench().providePhpFrameworkDefinition(
          controllerSource,
          controllerSource.indexOf("OrderShipped($order") + 2,
        );
      });

      expect(handled).toBe(true);
      expect(getWorkbench().activePath).toBe(listenerPath);
      expect(getWorkbench().editorRevealTarget?.position.lineNumber).toBe(7);
    });

    it("navigates an event to an __invoke listener", async () => {
      const controllerPath = "/workspace/app/Http/Controllers/OrderController.php";
      const providerPath = "/workspace/app/Providers/EventServiceProvider.php";
      const listenerPath = "/workspace/app/Listeners/SendShipmentNotification.php";
      const controllerSource = `<?php

namespace App\\Http\\Controllers;

use App\\Events\\OrderShipped;

class OrderController
{
    public function ship()
    {
        event(new OrderShipped($order));
    }
}
`;
      const providerSource = `<?php

namespace App\\Providers;

use App\\Events\\OrderShipped;
use App\\Listeners\\SendShipmentNotification;

class EventServiceProvider extends ServiceProvider
{
    protected $listen = [
        OrderShipped::class => [
            SendShipmentNotification::class,
        ],
    ];
}
`;
      const listenerSource = `<?php

namespace App\\Listeners;

class SendShipmentNotification
{
    public function __invoke($event)
    {
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
            return providerSource;
          }

          if (path === listenerPath) {
            return listenerSource;
          }

          throw new Error(`Unexpected read ${path}`);
        }),
        workspaceDescriptor: phpWorkspaceDescriptor(),
      });
      await flushAsyncTurns();
      await act(async () => {
        await getWorkbench().setSmartMode("lightSmart");
      });
      await act(async () => {
        await getWorkbench().openFile(fileEntry(controllerPath, "OrderController.php"));
      });

      let handled = false;
      await act(async () => {
        handled = await getWorkbench().providePhpFrameworkDefinition(
          controllerSource,
          controllerSource.indexOf("OrderShipped($order") + 2,
        );
      });

      expect(handled).toBe(true);
      expect(getWorkbench().activePath).toBe(listenerPath);
      expect(getWorkbench().editorRevealTarget?.position.lineNumber).toBe(7);
    });

    it("navigates to the first resolvable listener when an event has multiple", async () => {
      const controllerPath = "/workspace/app/Http/Controllers/OrderController.php";
      const providerPath = "/workspace/app/Providers/EventServiceProvider.php";
      const firstListenerPath = "/workspace/app/Listeners/SendShipmentNotification.php";
      const secondListenerPath = "/workspace/app/Listeners/UpdateInventory.php";
      const controllerSource = `<?php

namespace App\\Http\\Controllers;

use App\\Events\\OrderShipped;

class OrderController
{
    public function ship()
    {
        OrderShipped::dispatch($order);
    }
}
`;
      const providerSource = `<?php

namespace App\\Providers;

use App\\Events\\OrderShipped;
use App\\Listeners\\SendShipmentNotification;
use App\\Listeners\\UpdateInventory;

class EventServiceProvider extends ServiceProvider
{
    protected $listen = [
        OrderShipped::class => [
            SendShipmentNotification::class,
            UpdateInventory::class,
        ],
    ];
}
`;
      const firstListenerSource = `<?php

namespace App\\Listeners;

class SendShipmentNotification
{
    public function handle($event)
    {
    }
}
`;
      const readTextFile = vi.fn(async (path: string) => {
        if (path === controllerPath) {
          return controllerSource;
        }

        if (path === providerPath) {
          return providerSource;
        }

        if (path === firstListenerPath) {
          return firstListenerSource;
        }

        throw new Error(`Unexpected read ${path}`);
      });
      const { getWorkbench } = renderController({
        appSettings: {
          ...defaultAppSettings(),
          recentWorkspacePath: "/workspace",
        },
        readTextFile,
        workspaceDescriptor: phpWorkspaceDescriptor(),
      });
      await flushAsyncTurns();
      await act(async () => {
        await getWorkbench().setSmartMode("lightSmart");
      });
      await act(async () => {
        await getWorkbench().openFile(fileEntry(controllerPath, "OrderController.php"));
      });

      let handled = false;
      await act(async () => {
        handled = await getWorkbench().providePhpFrameworkDefinition(
          controllerSource,
          controllerSource.indexOf("OrderShipped::dispatch") + 2,
        );
      });

      expect(handled).toBe(true);
      expect(getWorkbench().activePath).toBe(firstListenerPath);
      expect(getWorkbench().activePath).not.toBe(secondListenerPath);
    });

    it("does not navigate an event with no listener mapping", async () => {
      const controllerPath = "/workspace/app/Http/Controllers/OrderController.php";
      const providerPath = "/workspace/app/Providers/EventServiceProvider.php";
      const controllerSource = `<?php

namespace App\\Http\\Controllers;

use App\\Events\\OrderShipped;

class OrderController
{
    public function ship()
    {
        event(new OrderShipped($order));
    }
}
`;
      const providerSource = `<?php

namespace App\\Providers;

class EventServiceProvider extends ServiceProvider
{
    protected $listen = [];
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
            return providerSource;
          }

          throw new Error(`Unexpected read ${path}`);
        }),
        workspaceDescriptor: phpWorkspaceDescriptor(),
      });
      await flushAsyncTurns();
      await act(async () => {
        await getWorkbench().setSmartMode("lightSmart");
      });
      await act(async () => {
        await getWorkbench().openFile(fileEntry(controllerPath, "OrderController.php"));
      });

      let handled = true;
      await act(async () => {
        handled = await getWorkbench().providePhpFrameworkDefinition(
          controllerSource,
          controllerSource.indexOf("OrderShipped($order") + 2,
        );
      });

      expect(handled).toBe(false);
      expect(getWorkbench().activePath).toBe(controllerPath);
    });

    it("stops stale event listener navigation after switching project tabs", async () => {
      const controllerPath = "/workspace-a/app/Http/Controllers/OrderController.php";
      const providerPath = "/workspace-a/app/Providers/EventServiceProvider.php";
      const listenerPath = "/workspace-a/app/Listeners/SendShipmentNotification.php";
      const controllerSource = `<?php

namespace App\\Http\\Controllers;

use App\\Events\\OrderShipped;

class OrderController
{
    public function ship()
    {
        event(new OrderShipped($order));
    }
}
`;
      const providerSource = `<?php

namespace App\\Providers;

use App\\Events\\OrderShipped;
use App\\Listeners\\SendShipmentNotification;

class EventServiceProvider extends ServiceProvider
{
    protected $listen = [
        OrderShipped::class => [
            SendShipmentNotification::class,
        ],
    ];
}
`;
      const staleListenerRead = createDeferred<string>();
      let listenerReadCount = 0;
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
            return providerSource;
          }

          if (path === listenerPath) {
            listenerReadCount += 1;
            return staleListenerRead.promise;
          }

          throw new Error(`Unexpected read ${path}`);
        }),
        workspaceDescriptor: {
          ...phpWorkspaceDescriptor(),
          rootPath: "/workspace-a",
        },
      });
      await flushAsyncTurns();
      await act(async () => {
        await getWorkbench().setSmartMode("lightSmart");
      });
      await act(async () => {
        await getWorkbench().openFile(fileEntry(controllerPath, "OrderController.php"));
      });

      let handled = true;
      let definitionPromise: Promise<boolean> = Promise.resolve(false);
      await act(async () => {
        definitionPromise = getWorkbench().providePhpFrameworkDefinition(
          controllerSource,
          controllerSource.indexOf("OrderShipped($order") + 2,
        );
        await Promise.resolve();
      });
      await waitForReact(() => {
        expect(listenerReadCount).toBe(1);
      });

      await act(async () => {
        await getWorkbench().activateWorkspaceTab("/workspace-b");
      });
      await flushAsyncTurns();

      staleListenerRead.resolve(`<?php

namespace App\\Listeners;

class SendShipmentNotification
{
    public function handle($event)
    {
    }
}
`);
      await act(async () => {
        handled = await definitionPromise;
      });
      await flushAsyncTurns(24);

      expect(handled).toBe(false);
      expect(getWorkbench().workspaceRoot).toBe("/workspace-b");
      expect(getWorkbench().activePath).not.toBe(listenerPath);
    });
  });
  describe("Latte Cmd+Click definition and completion", () => {
    it("prioritizes Latte include definitions over TypeScript symbols in IDE mode", async () => {
      const lattePath = "/workspace/app/UI/Home/show.latte";
      const partialPath = "/workspace/app/UI/Home/partials/@showHeader.latte";
      const typeScriptPath = "/workspace/src/showHeader.ts";
      const latteSource = "{include partials/@showHeader.latte}\n";
      const javaScriptTypeScriptRuntimeStatus: LanguageServerRuntimeStatus = {
        capabilities: {
          ...emptyLanguageServerCapabilities(),
          definition: true,
        },
        kind: "running",
        rootPath: "/workspace",
        sessionId: 73,
      };
      const javaScriptTypeScriptLanguageServerFeaturesGateway = featuresGateway();
      vi.mocked(javaScriptTypeScriptLanguageServerFeaturesGateway.definition).mockResolvedValue([
        {
          range: range(1, 13, 1, 23),
          uri: fileUriFromPath(typeScriptPath),
        },
      ]);
      const { getWorkbench } = renderController({
        appSettings: {
          ...defaultAppSettings(),
          recentWorkspacePath: "/workspace",
        },
        javaScriptTypeScriptInitialRuntimeStatus: javaScriptTypeScriptRuntimeStatus,
        javaScriptTypeScriptLanguageServerFeaturesGateway,
        javaScriptTypeScriptRuntimeStatus,
        readTextFile: vi.fn(async (path: string) => {
          if (path === lattePath) {
            return latteSource;
          }

          if (path === partialPath) {
            return "<h1>Header</h1>\n";
          }

          if (path === typeScriptPath) {
            return "export const showHeader = () => null;\n";
          }

          throw new Error(`Unexpected read ${path}`);
        }),
        workspaceDescriptor: netteWorkspaceDescriptor(),
      });
      await flushAsyncTurns();
      await act(async () => {
        await getWorkbench().setSmartMode("fullSmart");
      });
      await act(async () => {
        await getWorkbench().openFile(fileEntry(lattePath, "show.latte"));
      });
      act(() => {
        getWorkbench().updateActiveEditorPosition(
          positionAfter(latteSource, "partials/@showHeader"),
        );
      });

      await act(async () => {
        await getWorkbench()
          .commands.find((candidate) => candidate.id === "editor.goToDefinition")
          ?.run();
      });

      expect(javaScriptTypeScriptLanguageServerFeaturesGateway.definition).not.toHaveBeenCalled();
      expect(getWorkbench().activePath).toBe(partialPath);
      expect(getWorkbench().editorRevealTarget).toEqual({
        path: partialPath,
        position: { column: 1, lineNumber: 1 },
      });
    });
  });
  describe("Blade Cmd+Click definition and completion", () => {
    it("navigates an @include directive to the referenced view file", async () => {
      const bladePath = "/workspace/resources/views/show.blade.php";
      const partialPath = "/workspace/resources/views/partials/alert.blade.php";
      const bladeSource = "@include('partials.alert')\n";
      const { getWorkbench } = renderController({
        appSettings: {
          ...defaultAppSettings(),
          recentWorkspacePath: "/workspace",
        },
        readTextFile: vi.fn(async (path: string) => {
          if (path === bladePath) {
            return bladeSource;
          }

          if (path === partialPath) {
            return "<div>Alert</div>\n";
          }

          throw new Error(`Unexpected read ${path}`);
        }),
        workspaceDescriptor: phpWorkspaceDescriptor(),
      });
      await flushAsyncTurns();
      await act(async () => {
        await getWorkbench().setSmartMode("lightSmart");
      });
      await act(async () => {
        await getWorkbench().openFile(fileEntry(bladePath, "show.blade.php"));
      });

      let handled = false;
      await act(async () => {
        handled = await getWorkbench().frameworkIntelligenceProviders.provideBladeDefinition(
          bladeSource,
          bladeSource.indexOf("partials.alert") + 1,
        );
      });

      expect(handled).toBe(true);
      expect(getWorkbench().activePath).toBe(partialPath);
      expect(getWorkbench().editorRevealTarget).toEqual({
        path: partialPath,
        position: { column: 1, lineNumber: 1 },
      });
    });

    it("navigates a nested hyphenated @include directive to the referenced view file", async () => {
      const bladePath = "/workspace/resources/views/codevo-qa/show.blade.php";
      const partialPath = "/workspace/resources/views/codevo-qa/partials/card.blade.php";
      const bladeSource = "@include('codevo-qa.partials.card')\n";
      const { getWorkbench } = renderController({
        appSettings: {
          ...defaultAppSettings(),
          recentWorkspacePath: "/workspace",
        },
        readTextFile: vi.fn(async (path: string) => {
          if (path === bladePath) {
            return bladeSource;
          }

          if (path === partialPath) {
            return "<section>Card</section>\n";
          }

          throw new Error(`Unexpected read ${path}`);
        }),
        workspaceDescriptor: phpWorkspaceDescriptor(),
      });
      await flushAsyncTurns();
      await act(async () => {
        await getWorkbench().setSmartMode("lightSmart");
      });
      await act(async () => {
        await getWorkbench().openFile(fileEntry(bladePath, "show.blade.php"));
      });

      let handled = false;
      await act(async () => {
        handled = await getWorkbench().frameworkIntelligenceProviders.provideBladeDefinition(
          bladeSource,
          bladeSource.indexOf("codevo-qa.partials.card") + "codevo-qa.partials.card".length,
        );
      });

      expect(handled).toBe(true);
      expect(getWorkbench().activePath).toBe(partialPath);
      expect(getWorkbench().editorRevealTarget).toEqual({
        path: partialPath,
        position: { column: 1, lineNumber: 1 },
      });
    });

    it("prioritizes Blade include definitions over TypeScript symbols in IDE mode", async () => {
      const bladePath = "/workspace/resources/views/codevo-qa/show.blade.php";
      const partialPath = "/workspace/resources/views/codevo-qa/partials/card.blade.php";
      const cardComponentPath = "/workspace/resources/js/components/ui/card.tsx";
      const bladeSource = "@include('codevo-qa.partials.card')\n";
      const javaScriptTypeScriptRuntimeStatus: LanguageServerRuntimeStatus = {
        capabilities: {
          ...emptyLanguageServerCapabilities(),
          definition: true,
        },
        kind: "running",
        rootPath: "/workspace",
        sessionId: 72,
      };
      const javaScriptTypeScriptLanguageServerFeaturesGateway = featuresGateway();
      vi.mocked(javaScriptTypeScriptLanguageServerFeaturesGateway.definition).mockResolvedValue([
        {
          range: range(4, 6, 4, 10),
          uri: fileUriFromPath(cardComponentPath),
        },
      ]);
      const { getWorkbench } = renderController({
        appSettings: {
          ...defaultAppSettings(),
          recentWorkspacePath: "/workspace",
        },
        javaScriptTypeScriptInitialRuntimeStatus: javaScriptTypeScriptRuntimeStatus,
        javaScriptTypeScriptLanguageServerFeaturesGateway,
        javaScriptTypeScriptRuntimeStatus,
        readTextFile: vi.fn(async (path: string) => {
          if (path === bladePath) {
            return bladeSource;
          }

          if (path === partialPath) {
            return "<section>Card</section>\n";
          }

          if (path === cardComponentPath) {
            return "export const Card = () => null;\n";
          }

          throw new Error(`Unexpected read ${path}`);
        }),
        workspaceDescriptor: phpWorkspaceDescriptor(),
      });
      await flushAsyncTurns();
      await act(async () => {
        await getWorkbench().setSmartMode("fullSmart");
      });
      await act(async () => {
        await getWorkbench().openFile(fileEntry(bladePath, "show.blade.php"));
      });
      act(() => {
        getWorkbench().updateActiveEditorPosition(
          positionAfter(bladeSource, "codevo-qa.partials.card"),
        );
      });

      await act(async () => {
        await getWorkbench()
          .commands.find((candidate) => candidate.id === "editor.goToDefinition")
          ?.run();
      });

      expect(javaScriptTypeScriptLanguageServerFeaturesGateway.definition).not.toHaveBeenCalled();
      expect(getWorkbench().activePath).toBe(partialPath);
      expect(getWorkbench().editorRevealTarget).toEqual({
        path: partialPath,
        position: { column: 1, lineNumber: 1 },
      });
    });

    it("navigates a Blade view helper literal to the referenced view file", async () => {
      const bladePath = "/workspace/resources/views/show.blade.php";
      const partialPath = "/workspace/resources/views/comments/show.blade.php";
      const bladeSource = "{{ view('comments.show') }}\n";
      const { getWorkbench } = renderController({
        appSettings: {
          ...defaultAppSettings(),
          recentWorkspacePath: "/workspace",
        },
        readTextFile: vi.fn(async (path: string) => {
          if (path === bladePath) {
            return bladeSource;
          }

          if (path === partialPath) {
            return "<h1>Comment</h1>\n";
          }

          throw new Error(`Unexpected read ${path}`);
        }),
        workspaceDescriptor: phpWorkspaceDescriptor(),
      });
      await flushAsyncTurns();
      await act(async () => {
        await getWorkbench().setSmartMode("lightSmart");
      });
      await act(async () => {
        await getWorkbench().openFile(fileEntry(bladePath, "show.blade.php"));
      });

      let handled = false;
      await act(async () => {
        handled = await getWorkbench().frameworkIntelligenceProviders.provideBladeDefinition(
          bladeSource,
          bladeSource.indexOf("comments.show") + 1,
        );
      });

      expect(handled).toBe(true);
      expect(getWorkbench().activePath).toBe(partialPath);
      expect(getWorkbench().editorRevealTarget).toEqual({
        path: partialPath,
        position: { column: 1, lineNumber: 1 },
      });
    });

    it("navigates a Blade route helper literal to its named route definition", async () => {
      const bladePath = "/workspace/resources/views/comments/show.blade.php";
      const routesPath = "/workspace/routes/web.php";
      const bladeSource = "{{ route('comments.show', $comment) }}\n";
      const { getWorkbench } = renderController({
        appSettings: {
          ...defaultAppSettings(),
          recentWorkspacePath: "/workspace",
        },
        readTextFile: vi.fn(async (path: string) => {
          if (path === bladePath) {
            return bladeSource;
          }

          if (path === routesPath) {
            return `<?php
Route::get('/comments/{comment}', [CommentController::class, 'show'])
    ->name('comments.show');
`;
          }

          return `<?php\n// ${path}\n`;
        }),
        searchText: vi.fn(async (_root, query) =>
          query === "->name("
            ? [
                {
                  column: 5,
                  lineNumber: 3,
                  lineText: "    ->name('comments.show');",
                  path: routesPath,
                  relativePath: "routes/web.php",
                },
              ]
            : [],
        ),
        workspaceDescriptor: phpWorkspaceDescriptor(),
      });
      await flushAsyncTurns();
      await act(async () => {
        await getWorkbench().setSmartMode("lightSmart");
      });
      await act(async () => {
        await getWorkbench().openFile(fileEntry(bladePath, "show.blade.php"));
      });

      let handled = false;
      await act(async () => {
        handled = await getWorkbench().frameworkIntelligenceProviders.provideBladeDefinition(
          bladeSource,
          bladeSource.indexOf("comments.show") + 1,
        );
      });

      expect(handled).toBe(true);
      expect(getWorkbench().activePath).toBe(routesPath);
      expect(getWorkbench().editorRevealTarget).toEqual({
        path: routesPath,
        position: { column: 13, lineNumber: 3 },
      });
    });

    it("navigates a typed Blade view-data member to its PHP method", async () => {
      const bladePath = "/workspace/resources/views/comments/show.blade.php";
      const controllerPath = "/workspace/app/Http/Controllers/CommentController.php";
      const modelPath = "/workspace/app/Models/Comment.php";
      const bladeSource = "{{ $comment->author }}\n";
      const controllerSource = `<?php
namespace App\\Http\\Controllers;

use App\\Models\\Comment;

class CommentController
{
    public function show(): mixed
    {
        $comment = Comment::findOrFail(1);

        return view('comments.show', ['comment' => $comment]);
    }
}
`;
      const modelSource = `<?php
namespace App\\Models;

class Comment extends Model
{
    public function author()
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
          if (path === bladePath) {
            return bladeSource;
          }

          if (path === controllerPath) {
            return controllerSource;
          }

          if (path === modelPath) {
            return modelSource;
          }

          throw new Error(`Unexpected read ${path}`);
        }),
        searchText: vi.fn(async (_root, query) =>
          query === "view("
            ? [
                {
                  column: 16,
                  lineNumber: 12,
                  lineText: "return view('comments.show', ['comment' => $comment]);",
                  path: controllerPath,
                  relativePath: "app/Http/Controllers/CommentController.php",
                },
              ]
            : [],
        ),
        workspaceDescriptor: phpWorkspaceDescriptor(),
      });
      await flushAsyncTurns();
      await act(async () => {
        await getWorkbench().setSmartMode("lightSmart");
      });
      await act(async () => {
        await getWorkbench().openFile(fileEntry(bladePath, "show.blade.php"));
      });

      let handled = false;
      await act(async () => {
        handled = await getWorkbench().frameworkIntelligenceProviders.provideBladeDefinition(
          bladeSource,
          bladeSource.indexOf("author") + 1,
        );
      });

      expect(handled).toBe(true);
      expect(getWorkbench().activePath).toBe(modelPath);
      expect(getWorkbench().editorRevealTarget).toEqual({
        path: modelPath,
        position: { column: 21, lineNumber: 6 },
      });
    });

    it("navigates an <x-...> component tag to its component view file", async () => {
      const bladePath = "/workspace/resources/views/show.blade.php";
      // The flat candidate (forms/input.blade.php) is intentionally absent so the
      // resolver must fall through to the directory index candidate.
      const componentPath = "/workspace/resources/views/components/forms/input/index.blade.php";
      const bladeSource = '<x-forms.input name="email" />\n';
      const { getWorkbench } = renderController({
        appSettings: {
          ...defaultAppSettings(),
          recentWorkspacePath: "/workspace",
        },
        readTextFile: vi.fn(async (path: string) => {
          if (path === bladePath) {
            return bladeSource;
          }

          if (path === componentPath) {
            return "<input />\n";
          }

          throw new Error(`Unexpected read ${path}`);
        }),
        workspaceDescriptor: phpWorkspaceDescriptor(),
      });
      await flushAsyncTurns();
      await act(async () => {
        await getWorkbench().setSmartMode("lightSmart");
      });
      await act(async () => {
        await getWorkbench().openFile(fileEntry(bladePath, "show.blade.php"));
      });

      let handled = false;
      await act(async () => {
        handled = await getWorkbench().frameworkIntelligenceProviders.provideBladeDefinition(
          bladeSource,
          bladeSource.indexOf("forms.input") + 1,
        );
      });

      expect(handled).toBe(true);
      expect(getWorkbench().activePath).toBe(componentPath);
    });

    it("navigates an <x-...> component to its class-based PHP file when no blade view exists", async () => {
      const bladePath = "/workspace/resources/views/show.blade.php";
      // Only the class-based component file exists; the anonymous blade
      // candidates are absent so the resolver must fall through to the PHP class.
      const componentClassPath = "/workspace/app/View/Components/Alert.php";
      const bladeSource = "<x-alert />\n";
      const { getWorkbench } = renderController({
        appSettings: {
          ...defaultAppSettings(),
          recentWorkspacePath: "/workspace",
        },
        readTextFile: vi.fn(async (path: string) => {
          if (path === bladePath) {
            return bladeSource;
          }

          if (path === componentClassPath) {
            return "<?php\n\nnamespace App\\View\\Components;\n\nclass Alert {}\n";
          }

          throw new Error(`Unexpected read ${path}`);
        }),
        workspaceDescriptor: phpWorkspaceDescriptor(),
      });
      await flushAsyncTurns();
      await act(async () => {
        await getWorkbench().setSmartMode("lightSmart");
      });
      await act(async () => {
        await getWorkbench().openFile(fileEntry(bladePath, "show.blade.php"));
      });

      let handled = false;
      await act(async () => {
        handled = await getWorkbench().frameworkIntelligenceProviders.provideBladeDefinition(
          bladeSource,
          bladeSource.indexOf("alert") + 1,
        );
      });

      expect(handled).toBe(true);
      expect(getWorkbench().activePath).toBe(componentClassPath);
    });

    it("prefers the class-based PHP file over the anonymous blade view when both exist (PhpStorm parity)", async () => {
      const bladePath = "/workspace/resources/views/show.blade.php";
      const componentBladePath = "/workspace/resources/views/components/alert.blade.php";
      const componentClassPath = "/workspace/app/View/Components/Alert.php";
      const bladeSource = "<x-alert />\n";
      const { getWorkbench } = renderController({
        appSettings: {
          ...defaultAppSettings(),
          recentWorkspacePath: "/workspace",
        },
        readTextFile: vi.fn(async (path: string) => {
          if (path === bladePath) {
            return bladeSource;
          }

          if (path === componentBladePath) {
            return "<div>Alert</div>\n";
          }

          if (path === componentClassPath) {
            return "<?php\n\nnamespace App\\View\\Components;\n\nclass Alert {}\n";
          }

          throw new Error(`Unexpected read ${path}`);
        }),
        workspaceDescriptor: phpWorkspaceDescriptor(),
      });
      await flushAsyncTurns();
      await act(async () => {
        await getWorkbench().setSmartMode("lightSmart");
      });
      await act(async () => {
        await getWorkbench().openFile(fileEntry(bladePath, "show.blade.php"));
      });

      let handled = false;
      await act(async () => {
        handled = await getWorkbench().frameworkIntelligenceProviders.provideBladeDefinition(
          bladeSource,
          bladeSource.indexOf("alert") + 1,
        );
      });

      expect(handled).toBe(true);
      expect(getWorkbench().activePath).toBe(componentClassPath);
    });

    it("navigates a kebab-case <x-...> component to its PascalCase class file", async () => {
      const bladePath = "/workspace/resources/views/show.blade.php";
      const componentClassPath = "/workspace/app/View/Components/UserProfile.php";
      const bladeSource = "<x-user-profile />\n";
      const { getWorkbench } = renderController({
        appSettings: {
          ...defaultAppSettings(),
          recentWorkspacePath: "/workspace",
        },
        readTextFile: vi.fn(async (path: string) => {
          if (path === bladePath) {
            return bladeSource;
          }

          if (path === componentClassPath) {
            return "<?php\n\nnamespace App\\View\\Components;\n\nclass UserProfile {}\n";
          }

          throw new Error(`Unexpected read ${path}`);
        }),
        workspaceDescriptor: phpWorkspaceDescriptor(),
      });
      await flushAsyncTurns();
      await act(async () => {
        await getWorkbench().setSmartMode("lightSmart");
      });
      await act(async () => {
        await getWorkbench().openFile(fileEntry(bladePath, "show.blade.php"));
      });

      let handled = false;
      await act(async () => {
        handled = await getWorkbench().frameworkIntelligenceProviders.provideBladeDefinition(
          bladeSource,
          bladeSource.indexOf("user-profile") + 1,
        );
      });

      expect(handled).toBe(true);
      expect(getWorkbench().activePath).toBe(componentClassPath);
    });

    it("does not navigate an <x-...> component when neither blade nor class file exists", async () => {
      const bladePath = "/workspace/resources/views/show.blade.php";
      const bladeSource = "<x-alert />\n";
      const { getWorkbench } = renderController({
        appSettings: {
          ...defaultAppSettings(),
          recentWorkspacePath: "/workspace",
        },
        readTextFile: vi.fn(async (path: string) => {
          if (path === bladePath) {
            return bladeSource;
          }

          throw new Error(`Unexpected read ${path}`);
        }),
        workspaceDescriptor: phpWorkspaceDescriptor(),
      });
      await flushAsyncTurns();
      await act(async () => {
        await getWorkbench().setSmartMode("lightSmart");
      });
      await act(async () => {
        await getWorkbench().openFile(fileEntry(bladePath, "show.blade.php"));
      });

      let handled = true;
      await act(async () => {
        handled = await getWorkbench().frameworkIntelligenceProviders.provideBladeDefinition(
          bladeSource,
          bladeSource.indexOf("alert") + 1,
        );
      });

      expect(handled).toBe(false);
      expect(getWorkbench().activePath).toBe(bladePath);
      expect(getWorkbench().editorRevealTarget).toBeNull();
    });

    it("does not navigate when the referenced Blade view does not exist", async () => {
      const bladePath = "/workspace/resources/views/show.blade.php";
      const bladeSource = "@include('partials.missing')\n";
      const { getWorkbench } = renderController({
        appSettings: {
          ...defaultAppSettings(),
          recentWorkspacePath: "/workspace",
        },
        readTextFile: vi.fn(async (path: string) => {
          if (path === bladePath) {
            return bladeSource;
          }

          throw new Error(`Unexpected read ${path}`);
        }),
        workspaceDescriptor: phpWorkspaceDescriptor(),
      });
      await flushAsyncTurns();
      await act(async () => {
        await getWorkbench().setSmartMode("lightSmart");
      });
      await act(async () => {
        await getWorkbench().openFile(fileEntry(bladePath, "show.blade.php"));
      });

      let handled = true;
      await act(async () => {
        handled = await getWorkbench().frameworkIntelligenceProviders.provideBladeDefinition(
          bladeSource,
          bladeSource.indexOf("partials.missing") + 1,
        );
      });

      expect(handled).toBe(false);
      expect(getWorkbench().activePath).toBe(bladePath);
      expect(getWorkbench().editorRevealTarget).toBeNull();
    });

    it("drops a stale Blade view navigation after switching project tabs mid-read", async () => {
      const bladePath = "/workspace-a/resources/views/show.blade.php";
      const partialPath = "/workspace-a/resources/views/partials/alert.blade.php";
      const bladeSource = "@include('partials.alert')\n";
      const stalePartialRead = createDeferred<string>();
      let partialReadCount = 0;
      const { getWorkbench } = renderController({
        appSettings: {
          ...defaultAppSettings(),
          recentWorkspacePath: "/workspace-a",
          workspaceTabs: ["/workspace-a", "/workspace-b"],
        },
        readTextFile: vi.fn(async (path: string) => {
          if (path === bladePath) {
            return bladeSource;
          }

          if (path === partialPath) {
            partialReadCount += 1;
            return stalePartialRead.promise;
          }

          throw new Error(`Unexpected read ${path}`);
        }),
        workspaceDescriptor: phpWorkspaceDescriptor(),
      });
      await flushAsyncTurns();
      await act(async () => {
        await getWorkbench().setSmartMode("lightSmart");
      });
      await act(async () => {
        await getWorkbench().openFile(fileEntry(bladePath, "show.blade.php"));
      });

      let definitionPromise: Promise<boolean> = Promise.resolve(false);
      await act(async () => {
        definitionPromise = getWorkbench().frameworkIntelligenceProviders.provideBladeDefinition(
          bladeSource,
          bladeSource.indexOf("partials.alert") + 1,
        );
        await Promise.resolve();
      });
      await waitForReact(() => {
        expect(partialReadCount).toBe(1);
      });

      await act(async () => {
        await getWorkbench().activateWorkspaceTab("/workspace-b");
      });
      await flushAsyncTurns();

      stalePartialRead.resolve("<div>Alert</div>\n");
      let handled = true;
      await act(async () => {
        handled = await definitionPromise;
      });
      await flushAsyncTurns(24);

      expect(handled).toBe(false);
      expect(getWorkbench().workspaceRoot).toBe("/workspace-b");
      expect(getWorkbench().activePath).not.toBe(partialPath);
      expect(getWorkbench().editorRevealTarget).toBeNull();
    });

    it("suggests Blade directives after an @ prefix", async () => {
      const bladeSource = "@inc\n";
      const { getWorkbench } = renderController({
        appSettings: {
          ...defaultAppSettings(),
          recentWorkspacePath: "/workspace",
        },
        workspaceDescriptor: phpWorkspaceDescriptor(),
      });
      await flushAsyncTurns();
      await act(async () => {
        await getWorkbench().setSmartMode("lightSmart");
      });

      let completions: Awaited<
        ReturnType<WorkbenchController["frameworkIntelligenceProviders"]["provideBladeCompletions"]>
      > = [];
      await act(async () => {
        completions = await getWorkbench().frameworkIntelligenceProviders.provideBladeCompletions(
          bladeSource,
          {
            column: 5,
            lineNumber: 1,
          },
        );
      });

      const labels = completions.map((completion) => completion.label);
      expect(labels).toContain("@include");
      expect(labels).toContain("@includeIf");
      expect(completions.every((completion) => completion.kind === "directive")).toBe(true);
      const include = completions.find((completion) => completion.label === "@include");
      expect(include).toEqual(
        expect.objectContaining({
          insertText: "include",
          replaceEnd: bladeSource.indexOf("@inc") + 4,
          replaceStart: bladeSource.indexOf("@inc") + 1,
        }),
      );
    });

    it("suggests Blade view names inside an @include literal", async () => {
      const bladeSource = "@include('comments')\n";
      const viewsRoot = "/workspace/resources/views";
      const commentsDirectory = "/workspace/resources/views/comments";
      const { getWorkbench } = renderController({
        appSettings: {
          ...defaultAppSettings(),
          recentWorkspacePath: "/workspace",
        },
        readDirectory: vi.fn(async (path: string) => {
          if (path === viewsRoot) {
            return [directoryEntry(commentsDirectory, "comments")];
          }

          if (path === commentsDirectory) {
            return [
              fileEntry(`${commentsDirectory}/index.blade.php`, "index.blade.php"),
              fileEntry(`${commentsDirectory}/show.blade.php`, "show.blade.php"),
            ];
          }

          return [];
        }),
        workspaceDescriptor: phpWorkspaceDescriptor(),
      });
      await flushAsyncTurns();
      await act(async () => {
        await getWorkbench().setSmartMode("fullSmart");
      });

      let completions: Awaited<
        ReturnType<WorkbenchController["frameworkIntelligenceProviders"]["provideBladeCompletions"]>
      > = [];
      await act(async () => {
        completions = await getWorkbench().frameworkIntelligenceProviders.provideBladeCompletions(
          bladeSource,
          {
            column: bladeSource.indexOf("')") + 1,
            lineNumber: 1,
          },
        );
      });

      const labels = completions.map((completion) => completion.label).sort();
      expect(labels).toEqual(["comments.index", "comments.show"]);
      expect(completions.every((completion) => completion.kind === "view")).toBe(true);
    });

    it("suggests Blade component names inside an <x- tag", async () => {
      const bladeSource = "<x-fo\n";
      const componentsRoot = "/workspace/resources/views/components";
      const formsDirectory = "/workspace/resources/views/components/forms";
      const classComponentsRoot = "/workspace/app/View/Components";
      const classFormsDirectory = "/workspace/app/View/Components/Forms";
      const { getWorkbench } = renderController({
        appSettings: {
          ...defaultAppSettings(),
          recentWorkspacePath: "/workspace",
        },
        readDirectory: vi.fn(async (path: string) => {
          if (path === componentsRoot) {
            return [directoryEntry(formsDirectory, "forms")];
          }

          if (path === formsDirectory) {
            return [
              fileEntry(`${formsDirectory}/input.blade.php`, "input.blade.php"),
              fileEntry(`${formsDirectory}/select.blade.php`, "select.blade.php"),
            ];
          }

          if (path === classComponentsRoot) {
            return [
              directoryEntry(classFormsDirectory, "Forms"),
              fileEntry(`${classComponentsRoot}/Alert.php`, "Alert.php"),
            ];
          }

          if (path === classFormsDirectory) {
            return [
              fileEntry(`${classFormsDirectory}/TextInput.php`, "TextInput.php"),
              // Non-component helper: lowercase name must never surface.
              fileEntry(`${classFormsDirectory}/helpers.php`, "helpers.php"),
            ];
          }

          return [];
        }),
        workspaceDescriptor: phpWorkspaceDescriptor(),
      });
      await flushAsyncTurns();
      await act(async () => {
        await getWorkbench().setSmartMode("fullSmart");
      });

      let completions: Awaited<
        ReturnType<WorkbenchController["frameworkIntelligenceProviders"]["provideBladeCompletions"]>
      > = [];
      await act(async () => {
        completions = await getWorkbench().frameworkIntelligenceProviders.provideBladeCompletions(
          bladeSource,
          {
            column: bladeSource.indexOf("\n") + 1,
            lineNumber: 1,
          },
        );
      });

      const labels = completions.map((completion) => completion.label).sort();
      expect(labels).toEqual(["forms.input", "forms.select", "forms.text-input"]);
      expect(completions.every((completion) => completion.kind === "component")).toBe(true);
    });

    it("lists anonymous and class-based components right after typing <x-", async () => {
      const bladeSource = "<x-\n";
      const componentsRoot = "/workspace/resources/views/components";
      const classComponentsRoot = "/workspace/app/View/Components";
      const { getWorkbench } = renderController({
        appSettings: {
          ...defaultAppSettings(),
          recentWorkspacePath: "/workspace",
        },
        readDirectory: vi.fn(async (path: string) => {
          if (path === componentsRoot) {
            return [fileEntry(`${componentsRoot}/badge.blade.php`, "badge.blade.php")];
          }

          if (path === classComponentsRoot) {
            return [
              fileEntry(`${classComponentsRoot}/Alert.php`, "Alert.php"),
              fileEntry(`${classComponentsRoot}/UserProfile.php`, "UserProfile.php"),
            ];
          }

          return [];
        }),
        workspaceDescriptor: phpWorkspaceDescriptor(),
      });
      await flushAsyncTurns();
      await act(async () => {
        await getWorkbench().setSmartMode("fullSmart");
      });

      let completions: Awaited<
        ReturnType<WorkbenchController["frameworkIntelligenceProviders"]["provideBladeCompletions"]>
      > = [];
      await act(async () => {
        completions = await getWorkbench().frameworkIntelligenceProviders.provideBladeCompletions(
          bladeSource,
          {
            column: bladeSource.indexOf("\n") + 1,
            lineNumber: 1,
          },
        );
      });

      const labels = completions.map((completion) => completion.label).sort();
      expect(labels).toEqual(["alert", "badge", "user-profile"]);
    });

    it("caches the component scan per root and re-scans after a component file change", async () => {
      const bladeSource = "<x-\n";
      const componentsRoot = "/workspace/resources/views/components";
      let includeBadge = false;
      let publishFileChange: ((event: WorkspaceFileChangeEvent) => void) | null = null;
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
        readDirectory: vi.fn(async (path: string) => {
          if (path === componentsRoot) {
            const entries = [fileEntry(`${componentsRoot}/alert.blade.php`, "alert.blade.php")];

            if (includeBadge) {
              entries.push(fileEntry(`${componentsRoot}/badge.blade.php`, "badge.blade.php"));
            }

            return entries;
          }

          return [];
        }),
        workspaceDescriptor: phpWorkspaceDescriptor(),
        workspaceFileChangeGateway,
      });
      await flushAsyncTurns();
      await act(async () => {
        await getWorkbench().setSmartMode("fullSmart");
      });

      const completeComponents = async (): Promise<string[]> => {
        let completions: Awaited<
          ReturnType<
            WorkbenchController["frameworkIntelligenceProviders"]["provideBladeCompletions"]
          >
        > = [];
        await act(async () => {
          completions = await getWorkbench().frameworkIntelligenceProviders.provideBladeCompletions(
            bladeSource,
            {
              column: bladeSource.indexOf("\n") + 1,
              lineNumber: 1,
            },
          );
        });

        return completions.map((completion) => completion.label).sort();
      };

      expect(await completeComponents()).toEqual(["alert"]);

      // The scan is cached: a new file on disk is not picked up until a watcher
      // event under a component directory invalidates the per-root cache.
      includeBadge = true;
      expect(await completeComponents()).toEqual(["alert"]);

      await act(async () => {
        publishFileChange?.({
          kind: "created",
          path: `${componentsRoot}/badge.blade.php`,
          relativePath: "resources/views/components/badge.blade.php",
          rootPath: "/workspace",
        });
        await flushAsyncTurns();
      });
      await flushWorkspaceDirectoryRefresh();

      expect(await completeComponents()).toEqual(["alert", "badge"]);
    });

    it("suggests variables passed from a controller into the active Blade view", async () => {
      const controllerPath = "/workspace/app/Http/Controllers/CommentController.php";
      const bladePath = "/workspace/resources/views/comments/show.blade.php";
      const bladeSource = "{{ $co }}\n";
      const controllerSource = `<?php
use App\\Models\\Comment;

class CommentController
{
    public function show(): mixed
    {
        $comment = Comment::findOrFail(1);

        return view('comments.show', ['comment' => $comment]);
    }
}
`;
      const searchText = vi.fn(async (_root: string, query: string) =>
        query === "view("
          ? [
              {
                column: 16,
                lineNumber: 10,
                lineText: "return view('comments.show', ['comment' => $comment]);",
                path: controllerPath,
                relativePath: "app/Http/Controllers/CommentController.php",
              },
            ]
          : [],
      );
      const { getWorkbench } = renderController({
        appSettings: {
          ...defaultAppSettings(),
          recentWorkspacePath: "/workspace",
        },
        readTextFile: vi.fn(async (path: string) => {
          if (path === bladePath) {
            return bladeSource;
          }

          if (path === controllerPath) {
            return controllerSource;
          }

          throw new Error(`Unexpected read ${path}`);
        }),
        searchText,
        workspaceDescriptor: phpWorkspaceDescriptor(),
      });
      await flushAsyncTurns();
      await act(async () => {
        await getWorkbench().setSmartMode("lightSmart");
      });
      await act(async () => {
        await getWorkbench().openFile(fileEntry(bladePath, "show.blade.php"));
      });

      let completions: Awaited<
        ReturnType<WorkbenchController["frameworkIntelligenceProviders"]["provideBladeCompletions"]>
      > = [];
      await act(async () => {
        completions = await getWorkbench().frameworkIntelligenceProviders.provideBladeCompletions(
          bladeSource,
          {
            column: bladeSource.indexOf("$co") + "$co".length + 1,
            lineNumber: 1,
          },
        );
      });

      expect(completions).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            detail: "view data · Comment",
            insertText: "$comment",
            kind: "variable",
            label: "$comment",
          }),
        ]),
      );
      expect(searchText).toHaveBeenCalledWith("/workspace", "view(", 200);
    });

    it("suggests typed Blade members from controller view-data model bindings", async () => {
      const controllerPath = "/workspace/app/Http/Controllers/CommentController.php";
      const modelPath = "/workspace/app/Models/Comment.php";
      const bladePath = "/workspace/resources/views/comments/show.blade.php";
      const bladeSource = "{{ $comment-> }}\n";
      const controllerSource = `<?php
namespace App\\Http\\Controllers;

use App\\Models\\Comment;

class CommentController
{
    public function show(): mixed
    {
        $comment = Comment::findOrFail(1);

        return view('comments.show', ['comment' => $comment]);
    }
}
`;
      const modelSource = `<?php
namespace App\\Models;

use Illuminate\\Database\\Eloquent\\Model;
use Illuminate\\Database\\Eloquent\\Relations\\BelongsTo;

class Comment extends Model
{
    protected $fillable = [
        'body',
    ];

    protected array $casts = [
        'approved' => 'bool',
    ];

    public function author(): BelongsTo
    {
        return $this->belongsTo(User::class);
    }

    public function excerpt(): string
    {
        return '';
    }
}
`;
      const searchText = vi.fn(async (_root: string, query: string) =>
        query === "view("
          ? [
              {
                column: 16,
                lineNumber: 12,
                lineText: "return view('comments.show', ['comment' => $comment]);",
                path: controllerPath,
                relativePath: "app/Http/Controllers/CommentController.php",
              },
            ]
          : [],
      );
      const readTextFile = vi.fn(async (path: string) => {
        if (path === bladePath) {
          return bladeSource;
        }

        if (path === controllerPath) {
          return controllerSource;
        }

        if (path === modelPath) {
          return modelSource;
        }

        return `<?php\n// ${path}\n`;
      });
      const { getWorkbench } = renderController({
        appSettings: {
          ...defaultAppSettings(),
          recentWorkspacePath: "/workspace",
        },
        readTextFile,
        searchText,
        workspaceDescriptor: phpWorkspaceDescriptor(),
      });
      await flushAsyncTurns();
      await act(async () => {
        await getWorkbench().setSmartMode("lightSmart");
      });
      await act(async () => {
        await getWorkbench().openFile(fileEntry(bladePath, "show.blade.php"));
      });

      let completions: Awaited<
        ReturnType<WorkbenchController["frameworkIntelligenceProviders"]["provideBladeCompletions"]>
      > = [];
      await act(async () => {
        completions = await getWorkbench().frameworkIntelligenceProviders.provideBladeCompletions(
          bladeSource,
          {
            column: bladeSource.indexOf("$comment->") + "$comment->".length + 1,
            lineNumber: 1,
          },
        );
      });

      expect(completions).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            detail: "App\\Models\\Comment::$body: mixed",
            insertText: "body",
            kind: "member",
            label: "body",
          }),
          expect.objectContaining({
            detail: "App\\Models\\Comment::$approved: bool",
            insertText: "approved",
            kind: "member",
            label: "approved",
          }),
          expect.objectContaining({
            detail: "App\\Models\\Comment::$author: User",
            insertText: "author",
            kind: "member",
            label: "author",
          }),
          expect.objectContaining({
            detail: "App\\Models\\Comment::excerpt(): string",
            insertText: "excerpt()",
            kind: "member",
            label: "excerpt",
          }),
        ]),
      );
      expect(readTextFile).toHaveBeenCalledWith(modelPath);
    });

    it("suggests typed Blade members from a route-model-bound controller parameter", async () => {
      const controllerPath = "/workspace/app/Http/Controllers/CommentController.php";
      const modelPath = "/workspace/app/Models/Comment.php";
      const bladePath = "/workspace/resources/views/comments/show.blade.php";
      const bladeSource = "{{ $comment-> }}\n";
      const controllerSource = `<?php
namespace App\\Http\\Controllers;

use App\\Models\\Comment;

class CommentController
{
    public function show(Comment $comment): mixed
    {
        return view('comments.show', ['comment' => $comment]);
    }
}
`;
      const modelSource = `<?php
namespace App\\Models;

use Illuminate\\Database\\Eloquent\\Model;

class Comment extends Model
{
    protected $fillable = [
        'body',
    ];

    public function excerpt(): string
    {
        return '';
    }
}
`;
      const searchText = vi.fn(async (_root: string, query: string) =>
        query === "view("
          ? [
              {
                column: 16,
                lineNumber: 10,
                lineText: "return view('comments.show', ['comment' => $comment]);",
                path: controllerPath,
                relativePath: "app/Http/Controllers/CommentController.php",
              },
            ]
          : [],
      );
      const readTextFile = vi.fn(async (path: string) => {
        if (path === bladePath) {
          return bladeSource;
        }

        if (path === controllerPath) {
          return controllerSource;
        }

        if (path === modelPath) {
          return modelSource;
        }

        return `<?php\n// ${path}\n`;
      });
      const { getWorkbench } = renderController({
        appSettings: {
          ...defaultAppSettings(),
          recentWorkspacePath: "/workspace",
        },
        readTextFile,
        searchText,
        workspaceDescriptor: phpWorkspaceDescriptor(),
      });
      await flushAsyncTurns();
      await act(async () => {
        await getWorkbench().setSmartMode("lightSmart");
      });
      await act(async () => {
        await getWorkbench().openFile(fileEntry(bladePath, "show.blade.php"));
      });

      let completions: Awaited<
        ReturnType<WorkbenchController["frameworkIntelligenceProviders"]["provideBladeCompletions"]>
      > = [];
      await act(async () => {
        completions = await getWorkbench().frameworkIntelligenceProviders.provideBladeCompletions(
          bladeSource,
          {
            column: bladeSource.indexOf("$comment->") + "$comment->".length + 1,
            lineNumber: 1,
          },
        );
      });

      expect(completions).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            insertText: "body",
            kind: "member",
            label: "body",
          }),
          expect.objectContaining({
            insertText: "excerpt()",
            kind: "member",
            label: "excerpt",
          }),
        ]),
      );
    });

    it("suggests typed Blade members for foreach items from view-data relation chains", async () => {
      const controllerPath = "/workspace/app/Http/Controllers/BusinessEntityController.php";
      const userCompanyPath = "/workspace/app/Models/UserCompany.php";
      const invoicePath = "/workspace/app/Models/Invoice.php";
      const bladePath = "/workspace/resources/views/business-entities/show.blade.php";
      const bladeSource = `
@foreach($businessEntity->invoices as $invoice)
    {{ $invoice-> }}
@endforeach
`;
      const controllerSource = `<?php
namespace App\\Http\\Controllers;

use App\\Models\\UserCompany;

class BusinessEntityController
{
    public function show(UserCompany $businessEntity): mixed
    {
        return view('business-entities.show', ['businessEntity' => $businessEntity]);
    }
}
`;
      const userCompanySource = `<?php
namespace App\\Models;

use Illuminate\\Database\\Eloquent\\Model;
use Illuminate\\Database\\Eloquent\\Relations\\HasMany;

/**
 * @property-read \\Illuminate\\Database\\Eloquent\\Collection|\\App\\Models\\Invoice[] $invoices
 */
class UserCompany extends Model
{
    /** @return HasMany<Invoice> */
    public function invoices(): HasMany
    {
        return $this->hasMany(Invoice::class);
    }
}
`;
      const invoiceSource = `<?php
namespace App\\Models;

use Illuminate\\Database\\Eloquent\\Model;

class Invoice extends Model
{
    protected $fillable = [
        'invoice_number',
    ];

    public function getEffectiveVatStatus(): string
    {
        return '';
    }
}
`;
      const searchText = vi.fn(async (_root: string, query: string) =>
        query === "view("
          ? [
              {
                column: 16,
                lineNumber: 10,
                lineText:
                  "return view('business-entities.show', ['businessEntity' => $businessEntity]);",
                path: controllerPath,
                relativePath: "app/Http/Controllers/BusinessEntityController.php",
              },
            ]
          : [],
      );
      const readTextFile = vi.fn(async (path: string) => {
        if (path === bladePath) {
          return bladeSource;
        }

        if (path === controllerPath) {
          return controllerSource;
        }

        if (path === userCompanyPath) {
          return userCompanySource;
        }

        if (path === invoicePath) {
          return invoiceSource;
        }

        return `<?php\n// ${path}\n`;
      });
      const { getWorkbench } = renderController({
        appSettings: {
          ...defaultAppSettings(),
          recentWorkspacePath: "/workspace",
        },
        readTextFile,
        searchText,
        workspaceDescriptor: phpWorkspaceDescriptor(),
      });
      await flushAsyncTurns();
      await act(async () => {
        await getWorkbench().setSmartMode("lightSmart");
      });
      await act(async () => {
        await getWorkbench().openFile(fileEntry(bladePath, "show.blade.php"));
      });

      let completions: Awaited<
        ReturnType<WorkbenchController["frameworkIntelligenceProviders"]["provideBladeCompletions"]>
      > = [];
      await act(async () => {
        const memberLine = "    {{ $invoice-> }}";
        completions = await getWorkbench().frameworkIntelligenceProviders.provideBladeCompletions(
          bladeSource,
          {
            column: memberLine.indexOf("$invoice->") + "$invoice->".length + 1,
            lineNumber: 3,
          },
        );
      });

      expect(completions).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            detail: "App\\Models\\Invoice::$invoice_number: mixed",
            insertText: "invoice_number",
            kind: "member",
            label: "invoice_number",
          }),
          expect.objectContaining({
            detail: "App\\Models\\Invoice::getEffectiveVatStatus(): string",
            insertText: "getEffectiveVatStatus()",
            kind: "member",
            label: "getEffectiveVatStatus",
          }),
        ]),
      );
      expect(readTextFile).toHaveBeenCalledWith(userCompanyPath);
      expect(readTextFile).toHaveBeenCalledWith(invoicePath);
    });

    it("does not offer model members for a collection-valued Blade variable", async () => {
      const controllerPath = "/workspace/app/Http/Controllers/CommentController.php";
      const modelPath = "/workspace/app/Models/Comment.php";
      const bladePath = "/workspace/resources/views/comments/index.blade.php";
      const bladeSource = "{{ $comments-> }}\n";
      // The value expression is an Eloquent COLLECTION (`...->get()`), so the
      // full expression engine must win over the cheap `$comments = Comment::`
      // declared-hint heuristic - offering Comment model members on a
      // Collection would be wrong completions.
      const controllerSource = `<?php
namespace App\\Http\\Controllers;

use App\\Models\\Comment;

class CommentController
{
    public function index(): mixed
    {
        $comments = Comment::query()->where('approved', 1)->get();

        return view('comments.index', ['comments' => $comments]);
    }
}
`;
      const modelSource = `<?php
namespace App\\Models;

use Illuminate\\Database\\Eloquent\\Model;

class Comment extends Model
{
    protected $fillable = ['body'];
}
`;
      const searchText = vi.fn(async (_root: string, query: string) =>
        query === "view("
          ? [
              {
                column: 16,
                lineNumber: 11,
                lineText: "return view('comments.index', ['comments' => $comments]);",
                path: controllerPath,
                relativePath: "app/Http/Controllers/CommentController.php",
              },
            ]
          : [],
      );
      const readTextFile = vi.fn(async (path: string) => {
        if (path === bladePath) {
          return bladeSource;
        }

        if (path === controllerPath) {
          return controllerSource;
        }

        if (path === modelPath) {
          return modelSource;
        }

        return `<?php\n// ${path}\n`;
      });
      const { getWorkbench } = renderController({
        appSettings: {
          ...defaultAppSettings(),
          recentWorkspacePath: "/workspace",
        },
        readTextFile,
        searchText,
        workspaceDescriptor: phpWorkspaceDescriptor(),
      });
      await flushAsyncTurns();
      await act(async () => {
        await getWorkbench().setSmartMode("lightSmart");
      });
      await act(async () => {
        await getWorkbench().openFile(fileEntry(bladePath, "index.blade.php"));
      });

      let completions: Awaited<
        ReturnType<WorkbenchController["frameworkIntelligenceProviders"]["provideBladeCompletions"]>
      > = [];
      await act(async () => {
        completions = await getWorkbench().frameworkIntelligenceProviders.provideBladeCompletions(
          bladeSource,
          {
            column: bladeSource.indexOf("$comments->") + "$comments->".length + 1,
            lineNumber: 1,
          },
        );
      });

      expect(completions.map((completion) => completion.label)).not.toContain("body");
    });

    it("skips Blade member completions when controllers pass conflicting types", async () => {
      const commentControllerPath = "/workspace/app/Http/Controllers/CommentController.php";
      const postControllerPath = "/workspace/app/Http/Controllers/PostCommentController.php";
      const bladePath = "/workspace/resources/views/comments/show.blade.php";
      const bladeSource = "{{ $comment-> }}\n";
      const commentControllerSource = `<?php
namespace App\\Http\\Controllers;

use App\\Models\\Comment;

class CommentController
{
    public function show(): mixed
    {
        $comment = Comment::findOrFail(1);

        return view('comments.show', ['comment' => $comment]);
    }
}
`;
      const postControllerSource = `<?php
namespace App\\Http\\Controllers;

use App\\Models\\Post;

class PostCommentController
{
    public function show(): mixed
    {
        $comment = Post::findOrFail(1);

        return view('comments.show', ['comment' => $comment]);
    }
}
`;
      const commentModelSource = `<?php
namespace App\\Models;

use Illuminate\\Database\\Eloquent\\Model;

class Comment extends Model
{
    protected $fillable = ['body'];
}
`;
      const postModelSource = `<?php
namespace App\\Models;

use Illuminate\\Database\\Eloquent\\Model;

class Post extends Model
{
    protected $fillable = ['title'];
}
`;
      const searchText = vi.fn(async (_root: string, query: string) =>
        query === "view("
          ? [
              {
                column: 16,
                lineNumber: 10,
                lineText: "return view('comments.show', ['comment' => $comment]);",
                path: commentControllerPath,
                relativePath: "app/Http/Controllers/CommentController.php",
              },
              {
                column: 16,
                lineNumber: 10,
                lineText: "return view('comments.show', ['comment' => $comment]);",
                path: postControllerPath,
                relativePath: "app/Http/Controllers/PostCommentController.php",
              },
            ]
          : [],
      );
      const readTextFile = vi.fn(async (path: string) => {
        if (path === bladePath) {
          return bladeSource;
        }

        if (path === commentControllerPath) {
          return commentControllerSource;
        }

        if (path === postControllerPath) {
          return postControllerSource;
        }

        if (path === "/workspace/app/Models/Comment.php") {
          return commentModelSource;
        }

        if (path === "/workspace/app/Models/Post.php") {
          return postModelSource;
        }

        return `<?php\n// ${path}\n`;
      });
      const { getWorkbench } = renderController({
        appSettings: {
          ...defaultAppSettings(),
          recentWorkspacePath: "/workspace",
        },
        readTextFile,
        searchText,
        workspaceDescriptor: phpWorkspaceDescriptor(),
      });
      await flushAsyncTurns();
      await act(async () => {
        await getWorkbench().setSmartMode("lightSmart");
      });
      await act(async () => {
        await getWorkbench().openFile(fileEntry(bladePath, "show.blade.php"));
      });

      let completions: Awaited<
        ReturnType<WorkbenchController["frameworkIntelligenceProviders"]["provideBladeCompletions"]>
      > = [];
      await act(async () => {
        completions = await getWorkbench().frameworkIntelligenceProviders.provideBladeCompletions(
          bladeSource,
          {
            column: bladeSource.indexOf("$comment->") + "$comment->".length + 1,
            lineNumber: 1,
          },
        );
      });

      expect(completions).toEqual([]);
    });

    it("serves Blade view-data completions from the per-root cache and reloads after a PHP file change", async () => {
      const controllerPath = "/workspace/app/Http/Controllers/CommentController.php";
      const bladePath = "/workspace/resources/views/comments/show.blade.php";
      const bladeSource = "{{ $co }}\n";
      const controllerSource = `<?php
use App\\Models\\Comment;

class CommentController
{
    public function show(): mixed
    {
        $comment = Comment::findOrFail(1);

        return view('comments.show', ['comment' => $comment]);
    }
}
`;
      let publishFileChange: ((event: WorkspaceFileChangeEvent) => void) | null = null;
      const workspaceFileChangeGateway: WorkbenchWorkspaceGateways["fileChanges"] = {
        startWatching: vi.fn(async () => undefined),
        subscribeFileChanges: vi.fn(async (listener) => {
          publishFileChange = listener;
          return () => undefined;
        }),
      };
      const searchText = vi.fn(async (_root: string, query: string) =>
        query === "view("
          ? [
              {
                column: 16,
                lineNumber: 10,
                lineText: "return view('comments.show', ['comment' => $comment]);",
                path: controllerPath,
                relativePath: "app/Http/Controllers/CommentController.php",
              },
            ]
          : [],
      );
      const { getWorkbench } = renderController({
        appSettings: {
          ...defaultAppSettings(),
          recentWorkspacePath: "/workspace",
        },
        readTextFile: vi.fn(async (path: string) => {
          if (path === bladePath) {
            return bladeSource;
          }

          if (path === controllerPath) {
            return controllerSource;
          }

          return `<?php\n// ${path}\n`;
        }),
        searchText,
        workspaceFileChangeGateway,
        workspaceDescriptor: phpWorkspaceDescriptor(),
      });
      await flushAsyncTurns();
      await act(async () => {
        await getWorkbench().setSmartMode("lightSmart");
      });
      await act(async () => {
        await getWorkbench().openFile(fileEntry(bladePath, "show.blade.php"));
      });

      const completeVariables = async () => {
        let completions: Awaited<
          ReturnType<
            WorkbenchController["frameworkIntelligenceProviders"]["provideBladeCompletions"]
          >
        > = [];
        await act(async () => {
          completions = await getWorkbench().frameworkIntelligenceProviders.provideBladeCompletions(
            bladeSource,
            {
              column: bladeSource.indexOf("$co") + "$co".length + 1,
              lineNumber: 1,
            },
          );
        });
        return completions;
      };

      const first = await completeVariables();
      expect(first.map((completion) => completion.label)).toContain("$comment");

      await completeVariables();
      await completeVariables();

      const viewSearches = searchText.mock.calls.filter(([, query]) => query === "view(");
      expect(viewSearches).toHaveLength(1);

      // A controller changes on disk: the watcher event must invalidate the
      // per-root view-data cache so the next completion re-scans the workspace.
      await act(async () => {
        publishFileChange?.({
          kind: "modified",
          path: controllerPath,
          relativePath: "app/Http/Controllers/CommentController.php",
          rootPath: "/workspace",
        });
        await flushAsyncTurns();
      });

      await completeVariables();

      const viewSearchesAfterChange = searchText.mock.calls.filter(
        ([, query]) => query === "view(",
      );
      expect(viewSearchesAfterChange).toHaveLength(2);
    });

    it("shares one in-flight Blade view-data load between concurrent completions", async () => {
      const controllerPath = "/workspace/app/Http/Controllers/CommentController.php";
      const bladePath = "/workspace/resources/views/comments/show.blade.php";
      const bladeSource = "{{ $co }}\n";
      const controllerSource = `<?php
use App\\Models\\Comment;

class CommentController
{
    public function show(): mixed
    {
        $comment = Comment::findOrFail(1);

        return view('comments.show', ['comment' => $comment]);
    }
}
`;
      const deferredViewSearch = createDeferred<
        {
          column: number;
          lineNumber: number;
          lineText: string;
          path: string;
          relativePath: string;
        }[]
      >();
      const searchText = vi.fn(async (_root: string, query: string) =>
        query === "view(" ? deferredViewSearch.promise : [],
      );
      const { getWorkbench } = renderController({
        appSettings: {
          ...defaultAppSettings(),
          recentWorkspacePath: "/workspace",
        },
        readTextFile: vi.fn(async (path: string) => {
          if (path === bladePath) {
            return bladeSource;
          }

          if (path === controllerPath) {
            return controllerSource;
          }

          return `<?php\n// ${path}\n`;
        }),
        searchText,
        workspaceDescriptor: phpWorkspaceDescriptor(),
      });
      await flushAsyncTurns();
      await act(async () => {
        await getWorkbench().setSmartMode("lightSmart");
      });
      await act(async () => {
        await getWorkbench().openFile(fileEntry(bladePath, "show.blade.php"));
      });

      const position = {
        column: bladeSource.indexOf("$co") + "$co".length + 1,
        lineNumber: 1,
      };
      let firstPromise: Promise<
        Awaited<
          ReturnType<
            WorkbenchController["frameworkIntelligenceProviders"]["provideBladeCompletions"]
          >
        >
      > = Promise.resolve([]);
      let secondPromise: Promise<
        Awaited<
          ReturnType<
            WorkbenchController["frameworkIntelligenceProviders"]["provideBladeCompletions"]
          >
        >
      > = Promise.resolve([]);
      await act(async () => {
        firstPromise = getWorkbench().frameworkIntelligenceProviders.provideBladeCompletions(
          bladeSource,
          position,
        );
        secondPromise = getWorkbench().frameworkIntelligenceProviders.provideBladeCompletions(
          bladeSource,
          position,
        );
        await Promise.resolve();
      });

      deferredViewSearch.resolve([
        {
          column: 16,
          lineNumber: 10,
          lineText: "return view('comments.show', ['comment' => $comment]);",
          path: controllerPath,
          relativePath: "app/Http/Controllers/CommentController.php",
        },
      ]);

      let first: Awaited<
        ReturnType<WorkbenchController["frameworkIntelligenceProviders"]["provideBladeCompletions"]>
      > = [];
      let second: Awaited<
        ReturnType<WorkbenchController["frameworkIntelligenceProviders"]["provideBladeCompletions"]>
      > = [];
      await act(async () => {
        first = await firstPromise;
        second = await secondPromise;
      });

      expect(first.map((completion) => completion.label)).toContain("$comment");
      expect(second.map((completion) => completion.label)).toContain("$comment");

      const viewSearches = searchText.mock.calls.filter(([, query]) => query === "view(");
      expect(viewSearches).toHaveLength(1);
    });

    it("drops stale Blade view-data results after switching project tabs mid-search", async () => {
      const controllerPath = "/workspace-a/app/Http/Controllers/CommentController.php";
      const bladePath = "/workspace-a/resources/views/comments/show.blade.php";
      const bladeSource = "{{ $comment-> }}\n";
      const staleSearch = createDeferred<
        {
          column: number;
          lineNumber: number;
          lineText: string;
          path: string;
          relativePath: string;
        }[]
      >();
      const searchText = vi.fn(async (_root: string, query: string) =>
        query === "view(" ? staleSearch.promise : [],
      );
      const { getWorkbench } = renderController({
        appSettings: {
          ...defaultAppSettings(),
          recentWorkspacePath: "/workspace-a",
          workspaceTabs: ["/workspace-a", "/workspace-b"],
        },
        readTextFile: vi.fn(async (path: string) => {
          if (path === bladePath) {
            return bladeSource;
          }

          return `<?php\n// ${path}\n`;
        }),
        searchText,
        workspaceDescriptor: phpWorkspaceDescriptor(),
      });
      await flushAsyncTurns();
      await act(async () => {
        await getWorkbench().setSmartMode("lightSmart");
      });
      await act(async () => {
        await getWorkbench().openFile(fileEntry(bladePath, "show.blade.php"));
      });

      let completionsPromise: Promise<
        Awaited<
          ReturnType<
            WorkbenchController["frameworkIntelligenceProviders"]["provideBladeCompletions"]
          >
        >
      > = Promise.resolve([]);
      await act(async () => {
        completionsPromise = getWorkbench().frameworkIntelligenceProviders.provideBladeCompletions(
          bladeSource,
          {
            column: bladeSource.indexOf("$comment->") + "$comment->".length + 1,
            lineNumber: 1,
          },
        );
        await Promise.resolve();
      });

      await act(async () => {
        await getWorkbench().activateWorkspaceTab("/workspace-b");
      });
      await flushAsyncTurns();

      staleSearch.resolve([
        {
          column: 16,
          lineNumber: 10,
          lineText: "return view('comments.show', ['comment' => $comment]);",
          path: controllerPath,
          relativePath: "app/Http/Controllers/CommentController.php",
        },
      ]);

      let completions: Awaited<
        ReturnType<WorkbenchController["frameworkIntelligenceProviders"]["provideBladeCompletions"]>
      > = [];
      await act(async () => {
        completions = await completionsPromise;
      });
      await flushAsyncTurns(24);

      expect(completions).toEqual([]);
      expect(getWorkbench().workspaceRoot).toBe("/workspace-b");
    });

    it("suggests Laravel built-in Blade variables by prefix", async () => {
      const bladeSource = "{{ $e }}\n";
      const { getWorkbench } = renderController({
        appSettings: {
          ...defaultAppSettings(),
          recentWorkspacePath: "/workspace",
        },
        workspaceDescriptor: phpWorkspaceDescriptor(),
      });
      await flushAsyncTurns();
      await act(async () => {
        await getWorkbench().setSmartMode("lightSmart");
      });

      let completions: Awaited<
        ReturnType<WorkbenchController["frameworkIntelligenceProviders"]["provideBladeCompletions"]>
      > = [];
      await act(async () => {
        completions = await getWorkbench().frameworkIntelligenceProviders.provideBladeCompletions(
          bladeSource,
          {
            column: bladeSource.indexOf("$e") + "$e".length + 1,
            lineNumber: 1,
          },
        );
      });

      expect(completions).toEqual([
        expect.objectContaining({
          detail: "Laravel Blade variable · ViewErrorBag",
          insertText: "$errors",
          kind: "variable",
          label: "$errors",
        }),
      ]);
    });

    it("suggests Laravel helpers in Blade echo contexts", async () => {
      const bladeSource = "{{ ro }}\n";
      const { getWorkbench } = renderController({
        appSettings: {
          ...defaultAppSettings(),
          recentWorkspacePath: "/workspace",
        },
        workspaceDescriptor: phpWorkspaceDescriptor(),
      });
      await flushAsyncTurns();
      await act(async () => {
        await getWorkbench().setSmartMode("lightSmart");
      });

      let completions: Awaited<
        ReturnType<WorkbenchController["frameworkIntelligenceProviders"]["provideBladeCompletions"]>
      > = [];
      await act(async () => {
        completions = await getWorkbench().frameworkIntelligenceProviders.provideBladeCompletions(
          bladeSource,
          {
            column: bladeSource.indexOf("ro") + "ro".length + 1,
            lineNumber: 1,
          },
        );
      });

      expect(completions).toEqual([
        expect.objectContaining({
          insertText: "route()",
          kind: "helper",
          label: "route",
        }),
      ]);
    });

    it("completes $var-> after $ and > trigger characters across Blade contexts", async () => {
      const controllerPath = "/workspace/app/Http/Controllers/CommentController.php";
      const modelPath = "/workspace/app/Models/Comment.php";
      const bladePath = "/workspace/resources/views/comments/show.blade.php";
      // `$comment->` typed inside each Blade context the natural-typing triggers
      // reach: `{{ }}`, `{!! !!}`, an `@if(...)` expression, and an `@php` block.
      const bladeSource =
        "{{ $comment-> }}\n" +
        "{!! $comment-> !!}\n" +
        "@if($comment->)\n@endif\n" +
        "@php\n$comment->\n@endphp\n";
      const controllerSource = `<?php
namespace App\\Http\\Controllers;

use App\\Models\\Comment;

class CommentController
{
    public function show(): mixed
    {
        $comment = Comment::findOrFail(1);

        return view('comments.show', ['comment' => $comment]);
    }
}
`;
      const modelSource = `<?php
namespace App\\Models;

use Illuminate\\Database\\Eloquent\\Model;

class Comment extends Model
{
    protected $fillable = ['body'];
}
`;
      const searchText = vi.fn(async (_root: string, query: string) =>
        query === "view("
          ? [
              {
                column: 16,
                lineNumber: 10,
                lineText: "return view('comments.show', ['comment' => $comment]);",
                path: controllerPath,
                relativePath: "app/Http/Controllers/CommentController.php",
              },
            ]
          : [],
      );
      const readTextFile = vi.fn(async (path: string) => {
        if (path === bladePath) {
          return bladeSource;
        }

        if (path === controllerPath) {
          return controllerSource;
        }

        if (path === modelPath) {
          return modelSource;
        }

        return `<?php\n// ${path}\n`;
      });
      const { getWorkbench } = renderController({
        appSettings: {
          ...defaultAppSettings(),
          recentWorkspacePath: "/workspace",
        },
        readTextFile,
        searchText,
        workspaceDescriptor: phpWorkspaceDescriptor(),
      });
      await flushAsyncTurns();
      await act(async () => {
        await getWorkbench().setSmartMode("lightSmart");
      });
      await act(async () => {
        await getWorkbench().openFile(fileEntry(bladePath, "show.blade.php"));
      });

      const lines = bladeSource.split("\n");
      const memberContexts = [
        { column: lines[0].indexOf("$comment->") + "$comment->".length + 1, lineNumber: 1 },
        { column: lines[1].indexOf("$comment->") + "$comment->".length + 1, lineNumber: 2 },
        { column: lines[2].indexOf("$comment->") + "$comment->".length + 1, lineNumber: 3 },
        { column: lines[5].indexOf("$comment->") + "$comment->".length + 1, lineNumber: 6 },
      ];

      for (const position of memberContexts) {
        let completions: Awaited<
          ReturnType<
            WorkbenchController["frameworkIntelligenceProviders"]["provideBladeCompletions"]
          >
        > = [];
        await act(async () => {
          completions = await getWorkbench().frameworkIntelligenceProviders.provideBladeCompletions(
            bladeSource,
            position,
          );
        });

        expect(completions.map((completion) => completion.label)).toContain("body");
      }
    });

    it("lists view variables with their types the moment $ is typed", async () => {
      const controllerPath = "/workspace/app/Http/Controllers/InvoiceController.php";
      const bladePath = "/workspace/resources/views/invoices/show.blade.php";
      const bladeSource = "{{ $ }}\n";
      const controllerSource = `<?php
namespace App\\Http\\Controllers;

use App\\Models\\Invoice;

class InvoiceController
{
    public function show(Invoice $invoice): mixed
    {
        return view('invoices.show', ['invoice' => $invoice]);
    }
}
`;
      const searchText = vi.fn(async (_root: string, query: string) =>
        query === "view("
          ? [
              {
                column: 16,
                lineNumber: 9,
                lineText: "return view('invoices.show', ['invoice' => $invoice]);",
                path: controllerPath,
                relativePath: "app/Http/Controllers/InvoiceController.php",
              },
            ]
          : [],
      );
      const { getWorkbench } = renderController({
        appSettings: {
          ...defaultAppSettings(),
          recentWorkspacePath: "/workspace",
        },
        readTextFile: vi.fn(async (path: string) => {
          if (path === bladePath) {
            return bladeSource;
          }

          if (path === controllerPath) {
            return controllerSource;
          }

          return `<?php\n// ${path}\n`;
        }),
        searchText,
        workspaceDescriptor: phpWorkspaceDescriptor(),
      });
      await flushAsyncTurns();
      await act(async () => {
        await getWorkbench().setSmartMode("lightSmart");
      });
      await act(async () => {
        await getWorkbench().openFile(fileEntry(bladePath, "show.blade.php"));
      });

      let completions: Awaited<
        ReturnType<WorkbenchController["frameworkIntelligenceProviders"]["provideBladeCompletions"]>
      > = [];
      await act(async () => {
        completions = await getWorkbench().frameworkIntelligenceProviders.provideBladeCompletions(
          bladeSource,
          {
            column: bladeSource.indexOf("$") + "$".length + 1,
            lineNumber: 1,
          },
        );
      });

      expect(completions).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            detail: "view data · Invoice",
            insertText: "$invoice",
            kind: "variable",
            label: "$invoice",
          }),
        ]),
      );
    });

    it("offers the @foreach loop variable in the $ list and completes its element members", async () => {
      const controllerPath = "/workspace/app/Http/Controllers/InvoiceController.php";
      const modelPath = "/workspace/app/Models/Invoice.php";
      const bladePath = "/workspace/resources/views/invoices/index.blade.php";
      const bladeSource =
        "@foreach ($invoices as $invoice)\n  {{ $ }}\n  {{ $invoice-> }}\n@endforeach\n";
      const controllerSource = `<?php
namespace App\\Http\\Controllers;

use App\\Models\\Invoice;

class InvoiceController
{
    public function index(): mixed
    {
        $invoices = Invoice::all();

        return view('invoices.index', ['invoices' => $invoices]);
    }
}
`;
      const modelSource = `<?php
namespace App\\Models;

use Illuminate\\Database\\Eloquent\\Model;

class Invoice extends Model
{
    protected $fillable = ['total'];

    public function label(): string
    {
        return '';
    }
}
`;
      const searchText = vi.fn(async (_root: string, query: string) =>
        query === "view("
          ? [
              {
                column: 16,
                lineNumber: 12,
                lineText: "return view('invoices.index', ['invoices' => $invoices]);",
                path: controllerPath,
                relativePath: "app/Http/Controllers/InvoiceController.php",
              },
            ]
          : [],
      );
      const readTextFile = vi.fn(async (path: string) => {
        if (path === bladePath) {
          return bladeSource;
        }

        if (path === controllerPath) {
          return controllerSource;
        }

        if (path === modelPath) {
          return modelSource;
        }

        return `<?php\n// ${path}\n`;
      });
      const { getWorkbench } = renderController({
        appSettings: {
          ...defaultAppSettings(),
          recentWorkspacePath: "/workspace",
        },
        readTextFile,
        searchText,
        workspaceDescriptor: phpWorkspaceDescriptor(),
      });
      await flushAsyncTurns();
      await act(async () => {
        await getWorkbench().setSmartMode("lightSmart");
      });
      await act(async () => {
        await getWorkbench().openFile(fileEntry(bladePath, "index.blade.php"));
      });

      let variableCompletions: Awaited<
        ReturnType<WorkbenchController["frameworkIntelligenceProviders"]["provideBladeCompletions"]>
      > = [];
      await act(async () => {
        variableCompletions =
          await getWorkbench().frameworkIntelligenceProviders.provideBladeCompletions(bladeSource, {
            column: "  {{ $".length + 1,
            lineNumber: 2,
          });
      });

      expect(variableCompletions).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            insertText: "$invoice",
            kind: "variable",
            label: "$invoice",
          }),
        ]),
      );

      let memberCompletions: Awaited<
        ReturnType<WorkbenchController["frameworkIntelligenceProviders"]["provideBladeCompletions"]>
      > = [];
      await act(async () => {
        memberCompletions =
          await getWorkbench().frameworkIntelligenceProviders.provideBladeCompletions(bladeSource, {
            column: "  {{ $invoice->".length + 1,
            lineNumber: 3,
          });
      });

      const memberLabels = memberCompletions.map((completion) => completion.label);
      expect(memberLabels).toContain("total");
      expect(memberLabels).toContain("label");
    });

    it("stays conservative for a @foreach over an unknown-typed collection", async () => {
      const controllerPath = "/workspace/app/Http/Controllers/ReportController.php";
      const bladePath = "/workspace/resources/views/reports/index.blade.php";
      // The collection value is a plain PHP array of unknown element type, so the
      // loop variable must still surface (visibility) but with NO type and NO
      // invented members.
      const bladeSource = "@foreach ($rows as $row)\n  {{ $ }}\n  {{ $row-> }}\n@endforeach\n";
      const controllerSource = `<?php
namespace App\\Http\\Controllers;

class ReportController
{
    public function index(): mixed
    {
        $rows = compute_rows();

        return view('reports.index', ['rows' => $rows]);
    }
}
`;
      const searchText = vi.fn(async (_root: string, query: string) =>
        query === "view("
          ? [
              {
                column: 16,
                lineNumber: 11,
                lineText: "return view('reports.index', ['rows' => $rows]);",
                path: controllerPath,
                relativePath: "app/Http/Controllers/ReportController.php",
              },
            ]
          : [],
      );
      const { getWorkbench } = renderController({
        appSettings: {
          ...defaultAppSettings(),
          recentWorkspacePath: "/workspace",
        },
        readTextFile: vi.fn(async (path: string) => {
          if (path === bladePath) {
            return bladeSource;
          }

          if (path === controllerPath) {
            return controllerSource;
          }

          return `<?php\n// ${path}\n`;
        }),
        searchText,
        workspaceDescriptor: phpWorkspaceDescriptor(),
      });
      await flushAsyncTurns();
      await act(async () => {
        await getWorkbench().setSmartMode("lightSmart");
      });
      await act(async () => {
        await getWorkbench().openFile(fileEntry(bladePath, "index.blade.php"));
      });

      let variableCompletions: Awaited<
        ReturnType<WorkbenchController["frameworkIntelligenceProviders"]["provideBladeCompletions"]>
      > = [];
      await act(async () => {
        variableCompletions =
          await getWorkbench().frameworkIntelligenceProviders.provideBladeCompletions(bladeSource, {
            column: "  {{ $".length + 1,
            lineNumber: 2,
          });
      });

      const rowVariable = variableCompletions.find((completion) => completion.label === "$row");
      expect(rowVariable).toBeDefined();
      expect(rowVariable?.detail).toBe("foreach item");

      let memberCompletions: Awaited<
        ReturnType<WorkbenchController["frameworkIntelligenceProviders"]["provideBladeCompletions"]>
      > = [];
      await act(async () => {
        memberCompletions =
          await getWorkbench().frameworkIntelligenceProviders.provideBladeCompletions(bladeSource, {
            column: "  {{ $row->".length + 1,
            lineNumber: 3,
          });
      });

      expect(memberCompletions).toEqual([]);
    });

    it("drops stale @foreach element member completions after switching tabs", async () => {
      const controllerPath = "/workspace-a/app/Http/Controllers/InvoiceController.php";
      const bladePath = "/workspace-a/resources/views/invoices/index.blade.php";
      const bladeSource = "@foreach ($invoices as $invoice)\n  {{ $invoice-> }}\n@endforeach\n";
      const staleSearch = createDeferred<
        {
          column: number;
          lineNumber: number;
          lineText: string;
          path: string;
          relativePath: string;
        }[]
      >();
      const searchText = vi.fn(async (_root: string, query: string) =>
        query === "view(" ? staleSearch.promise : [],
      );
      const { getWorkbench } = renderController({
        appSettings: {
          ...defaultAppSettings(),
          recentWorkspacePath: "/workspace-a",
          workspaceTabs: ["/workspace-a", "/workspace-b"],
        },
        readTextFile: vi.fn(async (path: string) => {
          if (path === bladePath) {
            return bladeSource;
          }

          return `<?php\n// ${path}\n`;
        }),
        searchText,
        workspaceDescriptor: phpWorkspaceDescriptor(),
      });
      await flushAsyncTurns();
      await act(async () => {
        await getWorkbench().setSmartMode("lightSmart");
      });
      await act(async () => {
        await getWorkbench().openFile(fileEntry(bladePath, "index.blade.php"));
      });

      let completionsPromise: Promise<
        Awaited<
          ReturnType<
            WorkbenchController["frameworkIntelligenceProviders"]["provideBladeCompletions"]
          >
        >
      > = Promise.resolve([]);
      await act(async () => {
        completionsPromise = getWorkbench().frameworkIntelligenceProviders.provideBladeCompletions(
          bladeSource,
          {
            column: "  {{ $invoice->".length + 1,
            lineNumber: 2,
          },
        );
        await Promise.resolve();
      });

      await act(async () => {
        await getWorkbench().activateWorkspaceTab("/workspace-b");
      });
      await flushAsyncTurns();

      staleSearch.resolve([
        {
          column: 16,
          lineNumber: 12,
          lineText: "return view('invoices.index', ['invoices' => $invoices]);",
          path: controllerPath,
          relativePath: "app/Http/Controllers/InvoiceController.php",
        },
      ]);

      let completions: Awaited<
        ReturnType<WorkbenchController["frameworkIntelligenceProviders"]["provideBladeCompletions"]>
      > = [];
      await act(async () => {
        completions = await completionsPromise;
      });
      await flushAsyncTurns(24);

      expect(completions).toEqual([]);
      expect(getWorkbench().workspaceRoot).toBe("/workspace-b");
    });

    it("shadows a same-named view variable with the closer enclosing @foreach loop variable", async () => {
      // Real Blade views are rendered by MULTIPLE controllers, and generic loop
      // names (`$item`) are reused across them. Here `InvoiceController` renders
      // `invoices.index` with `$invoices` (no `item`), while an UNRELATED
      // `WidgetController` also renders the same view name with a top-level
      // `$item` of a completely different type. The template itself declares
      // `@foreach ($invoices as $item)` - PHP/Blade scoping means the ENCLOSING
      // LOOP variable must shadow the same-named outer view variable, so the
      // nested loop over `$item->rows` resolves against `Invoice::rows()`
      // (-> InvoiceLine), never against the unrelated `Widget::rows()`
      // (-> WidgetPart) merged in from the other controller's sighting.
      const invoiceControllerPath = "/workspace/app/Http/Controllers/InvoiceController.php";
      const widgetControllerPath = "/workspace/app/Http/Controllers/WidgetController.php";
      const invoiceModelPath = "/workspace/app/Models/Invoice.php";
      const invoiceLineModelPath = "/workspace/app/Models/InvoiceLine.php";
      const widgetModelPath = "/workspace/app/Models/Widget.php";
      const widgetPartModelPath = "/workspace/app/Models/WidgetPart.php";
      const bladePath = "/workspace/resources/views/invoices/index.blade.php";
      const bladeSource =
        "@foreach ($invoices as $item)\n" +
        "  @foreach ($item->rows as $line)\n" +
        "    {{ $line-> }}\n" +
        "  @endforeach\n" +
        "@endforeach\n";
      const invoiceControllerSource = `<?php
namespace App\\Http\\Controllers;

use App\\Models\\Invoice;

class InvoiceController
{
    public function index(): mixed
    {
        $invoices = Invoice::all();

        return view('invoices.index', ['invoices' => $invoices]);
    }
}
`;
      const widgetControllerSource = `<?php
namespace App\\Http\\Controllers;

use App\\Models\\Widget;

class WidgetController
{
    public function show(): mixed
    {
        $item = Widget::findOrFail(1);

        return view('invoices.index', ['item' => $item]);
    }
}
`;
      const invoiceModelSource = `<?php
namespace App\\Models;

use Illuminate\\Database\\Eloquent\\Model;
use Illuminate\\Database\\Eloquent\\Relations\\HasMany;

class Invoice extends Model
{
    /** @return HasMany<InvoiceLine> */
    public function rows(): HasMany
    {
        return $this->hasMany(InvoiceLine::class);
    }
}
`;
      const invoiceLineModelSource = `<?php
namespace App\\Models;

use Illuminate\\Database\\Eloquent\\Model;

class InvoiceLine extends Model
{
    protected $fillable = ['line_total'];

    public function formattedLineTotal(): string
    {
        return '';
    }
}
`;
      const widgetModelSource = `<?php
namespace App\\Models;

use Illuminate\\Database\\Eloquent\\Model;
use Illuminate\\Database\\Eloquent\\Relations\\HasMany;

class Widget extends Model
{
    /** @return HasMany<WidgetPart> */
    public function rows(): HasMany
    {
        return $this->hasMany(WidgetPart::class);
    }
}
`;
      const widgetPartModelSource = `<?php
namespace App\\Models;

use Illuminate\\Database\\Eloquent\\Model;

class WidgetPart extends Model
{
    protected $fillable = ['part_number'];

    public function formattedPartNumber(): string
    {
        return '';
    }
}
`;
      const searchText = vi.fn(async (_root: string, query: string) =>
        query === "view("
          ? [
              {
                column: 16,
                lineNumber: 10,
                lineText: "return view('invoices.index', ['invoices' => $invoices]);",
                path: invoiceControllerPath,
                relativePath: "app/Http/Controllers/InvoiceController.php",
              },
              {
                column: 16,
                lineNumber: 10,
                lineText: "return view('invoices.index', ['item' => $item]);",
                path: widgetControllerPath,
                relativePath: "app/Http/Controllers/WidgetController.php",
              },
            ]
          : [],
      );
      const readTextFile = vi.fn(async (path: string) => {
        if (path === bladePath) {
          return bladeSource;
        }

        if (path === invoiceControllerPath) {
          return invoiceControllerSource;
        }

        if (path === widgetControllerPath) {
          return widgetControllerSource;
        }

        if (path === invoiceModelPath) {
          return invoiceModelSource;
        }

        if (path === invoiceLineModelPath) {
          return invoiceLineModelSource;
        }

        if (path === widgetModelPath) {
          return widgetModelSource;
        }

        if (path === widgetPartModelPath) {
          return widgetPartModelSource;
        }

        return `<?php\n// ${path}\n`;
      });
      const { getWorkbench } = renderController({
        appSettings: {
          ...defaultAppSettings(),
          recentWorkspacePath: "/workspace",
        },
        readTextFile,
        searchText,
        workspaceDescriptor: phpWorkspaceDescriptor(),
      });
      await flushAsyncTurns();
      await act(async () => {
        await getWorkbench().setSmartMode("lightSmart");
      });
      await act(async () => {
        await getWorkbench().openFile(fileEntry(bladePath, "index.blade.php"));
      });

      let completions: Awaited<
        ReturnType<WorkbenchController["frameworkIntelligenceProviders"]["provideBladeCompletions"]>
      > = [];
      await act(async () => {
        const memberLine = "    {{ $line-> }}";
        completions = await getWorkbench().frameworkIntelligenceProviders.provideBladeCompletions(
          bladeSource,
          {
            column: memberLine.indexOf("$line->") + "$line->".length + 1,
            lineNumber: 3,
          },
        );
      });

      const memberLabels = completions.map((completion) => completion.label);
      expect(memberLabels).toContain("formattedLineTotal");
      expect(memberLabels).not.toContain("formattedPartNumber");
    });

    it("bounds the @foreach relation-chain walk for a self-referencing relation", async () => {
      // A pathological Blade collection expression can chain a self-referencing
      // relation (`$node->children->children->...`) arbitrarily deep. The
      // relation-chain walk must be capped (consistent with the other chain
      // resolvers in this file) so a long chain resolves in bounded work instead
      // of one file read per hop with no limit.
      const controllerPath = "/workspace/app/Http/Controllers/NodeController.php";
      const nodeModelPath = "/workspace/app/Models/Node.php";
      const bladePath = "/workspace/resources/views/nodes/index.blade.php";
      const relationHopCount = 20;
      const relationChain = Array.from({ length: relationHopCount }, () => "children").join("->");
      const bladeSource = `@foreach ($root->${relationChain} as $node)\n  {{ $node-> }}\n@endforeach\n`;
      const controllerSource = `<?php
namespace App\\Http\\Controllers;

use App\\Models\\Node;

class NodeController
{
    public function index(): mixed
    {
        $root = Node::findOrFail(1);

        return view('nodes.index', ['root' => $root]);
    }
}
`;
      const nodeModelSource = `<?php
namespace App\\Models;

use Illuminate\\Database\\Eloquent\\Model;
use Illuminate\\Database\\Eloquent\\Relations\\HasMany;

class Node extends Model
{
    /** @return HasMany<Node> */
    public function children(): HasMany
    {
        return $this->hasMany(Node::class);
    }
}
`;
      const searchText = vi.fn(async (_root: string, query: string) =>
        query === "view("
          ? [
              {
                column: 16,
                lineNumber: 10,
                lineText: "return view('nodes.index', ['root' => $root]);",
                path: controllerPath,
                relativePath: "app/Http/Controllers/NodeController.php",
              },
            ]
          : [],
      );
      const readTextFile = vi.fn(async (path: string) => {
        if (path === bladePath) {
          return bladeSource;
        }

        if (path === controllerPath) {
          return controllerSource;
        }

        if (path === nodeModelPath) {
          return nodeModelSource;
        }

        return `<?php\n// ${path}\n`;
      });
      const { getWorkbench } = renderController({
        appSettings: {
          ...defaultAppSettings(),
          recentWorkspacePath: "/workspace",
        },
        readTextFile,
        searchText,
        workspaceDescriptor: phpWorkspaceDescriptor(),
      });
      await flushAsyncTurns();
      await act(async () => {
        await getWorkbench().setSmartMode("lightSmart");
      });
      await act(async () => {
        await getWorkbench().openFile(fileEntry(bladePath, "index.blade.php"));
      });

      let completions: Awaited<
        ReturnType<WorkbenchController["frameworkIntelligenceProviders"]["provideBladeCompletions"]>
      > = [];
      await act(async () => {
        const memberLine = "  {{ $node-> }}";
        completions = await getWorkbench().frameworkIntelligenceProviders.provideBladeCompletions(
          bladeSource,
          {
            column: memberLine.indexOf("$node->") + "$node->".length + 1,
            lineNumber: 2,
          },
        );
      });

      // CONSERVATIVE: a chain past the cap yields no guessed members.
      expect(completions).toEqual([]);

      // BOUNDED: the walk must not read the model source once per hop - a
      // capped walk reads it a small, fixed number of times regardless of how
      // deep the (adversarial) chain in the Blade source goes.
      const nodeModelReadCount = readTextFile.mock.calls.filter(
        ([path]) => path === nodeModelPath,
      ).length;
      expect(nodeModelReadCount).toBeLessThan(relationHopCount);
    });
  });
  it("suggests Laravel Blade views inside view helper strings", async () => {
    const controllerPath = "/workspace/app/Http/Controllers/CommentController.php";
    const viewsRoot = "/workspace/resources/views";
    const commentsDirectory = "/workspace/resources/views/comments";
    const controllerSource = `<?php

class CommentController
{
    public function show(): mixed
    {
        return view('comments.sh');
    }
}
`;
    const { getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace",
      },
      readDirectory: vi.fn(async (path: string) => {
        if (path === viewsRoot) {
          return [
            directoryEntry(commentsDirectory, "comments"),
            fileEntry("/workspace/resources/views/dashboard.blade.php", "dashboard.blade.php"),
            fileEntry("/workspace/resources/views/ignored.txt", "ignored.txt"),
          ];
        }

        if (path === commentsDirectory) {
          return [
            fileEntry("/workspace/resources/views/comments/show.blade.php", "show.blade.php"),
            fileEntry("/workspace/resources/views/comments/show.php", "show.php"),
          ];
        }

        return [];
      }),
      readTextFile: vi.fn(async (path: string) =>
        path === controllerPath ? controllerSource : "",
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
        positionAfter(controllerSource, "comments.sh"),
      ),
    ).resolves.toEqual([
      completion({
        declaringClassName: "resources/views/comments/show.blade.php",
        insertText: "show",
        kind: "view",
        name: "comments.show",
        parameters: "",
        returnType: null,
      }),
    ]);
  });
  it("suggests Laravel Blade views inside view factory strings", async () => {
    const controllerPath = "/workspace/app/Http/Controllers/CommentController.php";
    const viewsRoot = "/workspace/resources/views";
    const commentsDirectory = "/workspace/resources/views/comments";
    const controllerSource = `<?php

use Illuminate\\Support\\Facades\\View;

class CommentController
{
    public function show(): mixed
    {
        return View::first(['comments.sh', 'dashboard']);
    }

    public function home(): mixed
    {
        return response()->view('dashboard');
    }

    public function fallback(): mixed
    {
        return view()->first(['dashb']);
    }
}
`;
    const { getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace",
      },
      readDirectory: vi.fn(async (path: string) => {
        if (path === viewsRoot) {
          return [
            directoryEntry(commentsDirectory, "comments"),
            fileEntry("/workspace/resources/views/dashboard.blade.php", "dashboard.blade.php"),
          ];
        }

        if (path === commentsDirectory) {
          return [
            fileEntry("/workspace/resources/views/comments/show.blade.php", "show.blade.php"),
          ];
        }

        return [];
      }),
      readTextFile: vi.fn(async (path: string) =>
        path === controllerPath ? controllerSource : "",
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
        positionAfter(controllerSource, "comments.sh"),
      ),
    ).resolves.toEqual([
      completion({
        declaringClassName: "resources/views/comments/show.blade.php",
        insertText: "show",
        kind: "view",
        name: "comments.show",
        parameters: "",
        returnType: null,
      }),
    ]);
    await expect(
      getWorkbench().providePhpMethodCompletions(
        controllerSource,
        positionAfter(controllerSource, "dashb"),
      ),
    ).resolves.toEqual([
      completion({
        declaringClassName: "resources/views/dashboard.blade.php",
        insertText: "dashboard",
        kind: "view",
        name: "dashboard",
        parameters: "",
        returnType: null,
      }),
    ]);
  });
  it("stops stale Laravel Blade view completions after switching project tabs", async () => {
    const controllerPath = "/workspace-a/app/Http/Controllers/CommentController.php";
    const viewsRoot = "/workspace-a/resources/views";
    const viewDirectoryRead = createDeferred<FileEntry[]>();
    const controllerSource = `<?php

class CommentController
{
    public function show(): mixed
    {
        return view('comments.sh');
    }
}
`;
    let completionsPromise: ReturnType<WorkbenchController["providePhpMethodCompletions"]> | null =
      null;
    const { getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace-a",
        workspaceTabs: ["/workspace-a", "/workspace-b"],
      },
      readDirectory: vi.fn(async (path: string) =>
        path === viewsRoot ? viewDirectoryRead.promise : [],
      ),
      readTextFile: vi.fn(async (path: string) =>
        path === controllerPath ? controllerSource : "",
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

    act(() => {
      completionsPromise = getWorkbench().providePhpMethodCompletions(
        controllerSource,
        positionAfter(controllerSource, "comments.sh"),
      );
    });
    await waitForReact(() => {
      expect(completionsPromise).not.toBeNull();
    });

    await act(async () => {
      await getWorkbench().activateWorkspaceTab("/workspace-b");
    });
    await flushAsyncTurns();

    viewDirectoryRead.resolve([
      fileEntry("/workspace-a/resources/views/comments/show.blade.php", "show.blade.php"),
    ]);

    await expect(completionsPromise!).resolves.toEqual([]);
    expect(getWorkbench().workspaceRoot).toBe("/workspace-b");
  });
  it("opens Laravel Blade views before LSP fallback", async () => {
    const controllerPath = "/workspace/app/Http/Controllers/CommentController.php";
    const viewPath = "/workspace/resources/views/comments/show.blade.php";
    const controllerSource = `<?php

class CommentController
{
    public function show(): mixed
    {
        return view('comments.show');
    }
}
`;
    const languageServerFeaturesGateway = featuresGateway();
    const { getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace",
      },
      languageServerFeaturesGateway,
      readTextFile: vi.fn(async (path: string) => {
        if (path === controllerPath) {
          return controllerSource;
        }

        if (path === viewPath) {
          return "<h1>{{ $comment->title }}</h1>\n";
        }

        throw new Error(`Unexpected read ${path}`);
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
      await getWorkbench().openFile(fileEntry(controllerPath, "CommentController.php"));
    });
    act(() => {
      getWorkbench().updateActiveEditorPosition(positionAfter(controllerSource, "comments.show"));
    });

    await act(async () => {
      await getWorkbench()
        .commands.find((candidate) => candidate.id === "editor.goToDefinition")
        ?.run();
    });

    expect(languageServerFeaturesGateway.definition).not.toHaveBeenCalled();
    expect(getWorkbench().activePath).toBe(viewPath);
    expect(getWorkbench().activeDocument?.language).toBe("blade");
    expect(getWorkbench().editorRevealTarget).toEqual({
      path: viewPath,
      position: {
        column: 1,
        lineNumber: 1,
      },
    });
  });
  it("opens Laravel View::make Blade views before LSP fallback", async () => {
    const controllerPath = "/workspace/app/Http/Controllers/CommentController.php";
    const viewPath = "/workspace/resources/views/comments/show.blade.php";
    const controllerSource = `<?php

use Illuminate\\Support\\Facades\\View;

class CommentController
{
    public function show(): mixed
    {
        return View::make('comments.show');
    }
}
`;
    const languageServerFeaturesGateway = featuresGateway();
    const { getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace",
      },
      languageServerFeaturesGateway,
      readTextFile: vi.fn(async (path: string) => {
        if (path === controllerPath) {
          return controllerSource;
        }

        if (path === viewPath) {
          return "<h1>{{ $comment->title }}</h1>\n";
        }

        throw new Error(`Unexpected read ${path}`);
      }),
      runtimeStatus: {
        capabilities: {
          ...emptyLanguageServerCapabilities(),
          definition: true,
        },
        kind: "running",
        sessionId: 3,
      },
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
      getWorkbench().updateActiveEditorPosition(positionAfter(controllerSource, "comments.show"));
    });

    await act(async () => {
      await getWorkbench()
        .commands.find((candidate) => candidate.id === "editor.goToDefinition")
        ?.run();
    });

    expect(languageServerFeaturesGateway.definition).not.toHaveBeenCalled();
    expect(getWorkbench().activePath).toBe(viewPath);
    expect(getWorkbench().activeDocument?.language).toBe("blade");
    expect(getWorkbench().editorRevealTarget).toEqual({
      path: viewPath,
      position: {
        column: 1,
        lineNumber: 1,
      },
    });
  });
  it("does not resolve a Laravel Blade view from another project tab", async () => {
    const controllerPath = "/workspace-a/app/Http/Controllers/CommentController.php";
    const workspaceAViewPath = "/workspace-a/resources/views/comments/show.blade.php";
    const workspaceBViewPath = "/workspace-b/resources/views/comments/show.blade.php";
    const controllerSource = `<?php

class CommentController
{
    public function show(): mixed
    {
        return view('comments.show');
    }
}
`;
    const readTextFile = vi.fn(async (path: string) => {
      if (path === controllerPath) {
        return controllerSource;
      }

      if (path === workspaceBViewPath) {
        return "<h1>Wrong project</h1>\n";
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
      workspaceDescriptor: phpWorkspaceDescriptor(),
    });
    await flushAsyncTurns();
    await act(async () => {
      await getWorkbench().setSmartMode("lightSmart");
    });
    await act(async () => {
      await getWorkbench().openFile(fileEntry(controllerPath, "CommentController.php"));
    });

    let handled = true;
    await act(async () => {
      handled = await getWorkbench().providePhpFrameworkDefinition(
        controllerSource,
        controllerSource.indexOf("comments.show") + 1,
      );
    });

    expect(handled).toBe(false);
    expect(readTextFile).toHaveBeenCalledWith(workspaceAViewPath);
    expect(readTextFile).not.toHaveBeenCalledWith(workspaceBViewPath);
    expect(getWorkbench().workspaceRoot).toBe("/workspace-a");
    expect(getWorkbench().activePath).toBe(controllerPath);
    expect(getWorkbench().editorRevealTarget).toBeNull();
  });
  it("keeps a basic Blade document free of diagnostics noise", async () => {
    const bladePath = "/workspace/resources/views/comments/show.blade.php";
    const bladeSource = `@extends('layouts.app')

@section('content')
    <x-alert type="info">{{ $comment->title }}</x-alert>
@endsection
`;
    const { getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace",
      },
      readTextFile: vi.fn(async (path: string) => {
        if (path === bladePath) {
          return bladeSource;
        }

        throw new Error(`Unexpected read ${path}`);
      }),
      runtimeStatus: {
        capabilities: emptyLanguageServerCapabilities(),
        kind: "running",
        rootPath: "/workspace",
        sessionId: 9,
      },
      workspaceDescriptor: phpWorkspaceDescriptor(),
    });
    await flushAsyncTurns();
    await act(async () => {
      await getWorkbench().openFile(fileEntry(bladePath, "show.blade.php"));
    });
    await flushAsyncTurns(4);

    expect(getWorkbench().activeDocument?.language).toBe("blade");
    expect(getWorkbench().diagnosticsSummary).toEqual({
      errors: 0,
      warnings: 0,
    });
    expect(getWorkbench().notices.some((notice) => notice.groupKey?.includes("diagnostics"))).toBe(
      false,
    );
  });
  it("opens Laravel Route::view Blade views before LSP fallback", async () => {
    const routesPath = "/workspace/routes/web.php";
    const viewPath = "/workspace/resources/views/dashboard.blade.php";
    const routesSource = `<?php

Route::view('/dashboard', 'dashboard');
`;
    const languageServerFeaturesGateway = featuresGateway();
    const { getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace",
      },
      languageServerFeaturesGateway,
      readTextFile: vi.fn(async (path: string) => {
        if (path === routesPath) {
          return routesSource;
        }

        if (path === viewPath) {
          return "<x-layout />\n";
        }

        throw new Error(`Unexpected read ${path}`);
      }),
      runtimeStatus: {
        capabilities: {
          ...emptyLanguageServerCapabilities(),
          definition: true,
        },
        kind: "running",
        sessionId: 2,
      },
      workspaceDescriptor: phpWorkspaceDescriptor(),
    });
    await flushAsyncTurns();
    await act(async () => {
      await getWorkbench().setSmartMode("lightSmart");
    });
    await act(async () => {
      await getWorkbench().openFile(fileEntry(routesPath, "web.php"));
    });
    act(() => {
      getWorkbench().updateActiveEditorPosition(positionAfter(routesSource, "', 'dashboard"));
    });

    await act(async () => {
      await getWorkbench()
        .commands.find((candidate) => candidate.id === "editor.goToDefinition")
        ?.run();
    });

    expect(languageServerFeaturesGateway.definition).not.toHaveBeenCalled();
    expect(getWorkbench().activePath).toBe(viewPath);
    expect(getWorkbench().editorRevealTarget).toEqual({
      path: viewPath,
      position: {
        column: 1,
        lineNumber: 1,
      },
    });
  });
  it("drops stale Laravel Blade view targets after switching project tabs", async () => {
    const controllerPath = "/workspace-a/app/Http/Controllers/CommentController.php";
    const viewPath = "/workspace-a/resources/views/comments/show.blade.php";
    const controllerSource = `<?php

class CommentController
{
    public function show(): mixed
    {
        return view('comments.show');
    }
}
`;
    const staleViewRead = createDeferred<string>();
    let viewReadCount = 0;
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

        if (path === viewPath) {
          viewReadCount += 1;
          return staleViewRead.promise;
        }

        throw new Error(`Unexpected read ${path}`);
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
      getWorkbench().updateActiveEditorPosition(positionAfter(controllerSource, "comments.show"));
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
      expect(viewReadCount).toBe(1);
    });

    await act(async () => {
      await getWorkbench().activateWorkspaceTab("/workspace-b");
    });
    await flushAsyncTurns();

    staleViewRead.resolve("<h1>Stale</h1>\n");
    await act(async () => {
      await commandPromise;
    });
    await flushAsyncTurns(24);

    expect(getWorkbench().workspaceRoot).toBe("/workspace-b");
    expect(getWorkbench().activePath).not.toBe(viewPath);
    expect(getWorkbench().editorRevealTarget).toBeNull();
  });
  it("drops stale Laravel named route definition targets after switching project tabs", async () => {
    const controllerPath = "/workspace-a/app/Http/Controllers/CommentController.php";
    const routesPath = "/workspace-a/routes/web.php";
    const controllerSource = `<?php

class CommentController
{
    public function show(): string
    {
        return route('comments.show');
    }
}
`;
    const staleRoutesRead = createDeferred<string>();
    let routesReadCount = 0;
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

        if (path === routesPath) {
          routesReadCount += 1;
          return staleRoutesRead.promise;
        }

        return `<?php\n// ${path}\n`;
      }),
      searchText: vi.fn(async (_root, query) =>
        query === "->name("
          ? [
              {
                column: 5,
                lineNumber: 3,
                lineText: "    ->name('comments.show');",
                path: routesPath,
                relativePath: "routes/web.php",
              },
            ]
          : [],
      ),
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
      getWorkbench().updateActiveEditorPosition(positionAfter(controllerSource, "comments.show"));
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
      expect(routesReadCount).toBe(1);
    });

    await act(async () => {
      await getWorkbench().activateWorkspaceTab("/workspace-b");
    });
    await flushAsyncTurns();

    staleRoutesRead.resolve(`<?php
Route::get('/comments/{comment}', [CommentController::class, 'show'])
    ->name('comments.show');
`);
    await act(async () => {
      await commandPromise;
    });
    await flushAsyncTurns(24);

    expect(getWorkbench().workspaceRoot).toBe("/workspace-b");
    expect(getWorkbench().activePath).not.toBe(routesPath);
    expect(getWorkbench().editorRevealTarget).toBeNull();
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
      await getWorkbench().openFile(fileEntry(requestPath, "StoreCommentRequest.php"));
    });
    act(() => {
      getWorkbench().updateActiveEditorPosition({
        column: 37,
        lineNumber: 6,
      });
    });

    await act(async () => {
      await getWorkbench()
        .commands.find((candidate) => candidate.id === "editor.goToDefinition")
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
  it("opens implementation targets from an explicit editor position", async () => {
    const interfacePath = "/workspace/app/Contracts/SearchRepository.php";
    const implementationPath = "/workspace/app/Repositories/AlbumRepository.php";
    const implementation = vi.fn(async () => [
      {
        range: {
          end: {
            character: 27,
            line: 14,
          },
          start: {
            character: 20,
            line: 14,
          },
        },
        uri: "file:///workspace/app/Repositories/AlbumRepository.php",
      },
    ]);
    const { getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace",
      },
      languageServerFeaturesGateway: {
        ...featuresGateway(),
        implementation,
      },
      readTextFile: vi.fn(async (path: string) => {
        if (path === interfacePath) {
          return `<?php

interface SearchRepository
{
    public function search(array $searchParams): LengthAwarePaginator;
}
`;
        }

        return "<?php\nfinal class AlbumRepository {}\n";
      }),
      runtimeStatus: {
        capabilities: {
          ...emptyLanguageServerCapabilities(),
          implementation: true,
        },
        kind: "running",
        sessionId: 1,
      },
    });
    await flushAsyncTurns();
    await act(async () => {
      await getWorkbench().setSmartMode("fullSmart");
    });
    await act(async () => {
      await getWorkbench().startLanguageServer();
    });

    await act(async () => {
      await getWorkbench().openFile(fileEntry(interfacePath, "SearchRepository.php"));
    });
    await flushAsyncTurns();

    expect(getWorkbench().languageServerRuntimeStatus?.kind).toBe("running");

    await act(async () => {
      await getWorkbench().goToImplementationAt({
        column: 21,
        lineNumber: 5,
      });
    });

    expect(implementation).toHaveBeenCalledWith("/workspace", {
      character: 20,
      line: 4,
      path: interfacePath,
    });
    expect(getWorkbench().activePath).toBe(implementationPath);
    expect(getWorkbench().editorRevealTarget).toEqual({
      path: implementationPath,
      position: {
        column: 21,
        lineNumber: 15,
      },
    });
  });
  it("asks which implementation to open when a symbol has multiple targets", async () => {
    const interfacePath = "/workspace/app/Contracts/PlatformAdapter.php";
    const baseAdapterPath = "/workspace/app/Services/Analytics/Adapters/BaseAdapter.php";
    const facebookAdapterPath =
      "/workspace/app/Services/Analytics/Adapters/Facebook/FacebookAdapterService.php";
    const interfaceSource = `<?php

namespace App\\Contracts;

interface PlatformAdapter
{
    public function getPlatform(): Platform;
}
`;
    const implementation = vi.fn(async () => [
      {
        range: {
          end: {
            character: 31,
            line: 6,
          },
          start: {
            character: 20,
            line: 6,
          },
        },
        uri: "file:///workspace/app/Services/Analytics/Adapters/BaseAdapter.php",
      },
      {
        range: {
          end: {
            character: 31,
            line: 6,
          },
          start: {
            character: 20,
            line: 6,
          },
        },
        uri: "file:///workspace/app/Services/Analytics/Adapters/Facebook/FacebookAdapterService.php",
      },
    ]);
    const { getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace",
      },
      languageServerFeaturesGateway: {
        ...featuresGateway(),
        implementation,
      },
      readTextFile: vi.fn(async (path: string) => {
        if (path === interfacePath) {
          return interfaceSource;
        }

        if (path === baseAdapterPath) {
          return `<?php

namespace App\\Services\\Analytics\\Adapters;

abstract class BaseAdapter
{
    public function getPlatform(): Platform
    {
    }
}
`;
        }

        if (path === facebookAdapterPath) {
          return `<?php

namespace App\\Services\\Analytics\\Adapters\\Facebook;

final class FacebookAdapterService extends BaseAdapter
{
    public function getPlatform(): Platform
    {
    }
}
`;
        }

        return "<?php\n";
      }),
      runtimeStatus: {
        capabilities: {
          ...emptyLanguageServerCapabilities(),
          implementation: true,
        },
        kind: "running",
        sessionId: 1,
      },
    });
    await flushAsyncTurns();
    await act(async () => {
      await getWorkbench().setSmartMode("fullSmart");
    });
    await act(async () => {
      await getWorkbench().startLanguageServer();
    });

    await act(async () => {
      await getWorkbench().openFile(fileEntry(interfacePath, "PlatformAdapter.php"));
    });
    await flushAsyncTurns();

    await act(async () => {
      await getWorkbench().goToImplementationAt({
        column: 23,
        lineNumber: 7,
      });
    });

    expect(getWorkbench().activePath).toBe(interfacePath);
    expect(getWorkbench().implementationChooser?.title).toBe(
      "Choose implementation of getPlatform",
    );
    expect(
      getWorkbench().implementationChooser?.targets.map((target) => ({
        detail: target.detail,
        label: target.label,
        path: target.path,
      })),
    ).toEqual([
      {
        detail: "\\App\\Services\\Analytics\\Adapters",
        label: "BaseAdapter",
        path: baseAdapterPath,
      },
      {
        detail: "\\App\\Services\\Analytics\\Adapters\\Facebook",
        label: "FacebookAdapterService",
        path: facebookAdapterPath,
      },
    ]);

    await act(async () => {
      const target = getWorkbench().implementationChooser?.targets[1];

      if (!target) {
        throw new Error("Expected a second implementation target.");
      }

      await getWorkbench().openImplementationTarget(target);
    });

    expect(getWorkbench().implementationChooser).toBe(null);
    expect(getWorkbench().activePath).toBe(facebookAdapterPath);
    expect(getWorkbench().editorRevealTarget).toEqual({
      path: facebookAdapterPath,
      position: {
        column: 21,
        lineNumber: 7,
      },
    });
  });
  it("opens the only indexed PHP implementation when the language server is unavailable", async () => {
    const interfacePath = "/workspace/app/Contracts/PlatformAdapter.php";
    const facebookAdapterPath =
      "/workspace/app/Services/Analytics/Adapters/Facebook/FacebookAdapterService.php";
    const billingAdapterPath = "/workspace/app/Billing/InvoiceAdapter.php";
    const interfaceSource = `<?php

namespace App\\Contracts;

interface PlatformAdapter
{
    public function getPlatform(): Platform;
}
`;
    const implementation = vi.fn(async () => []);
    const projectSymbols: ProjectSymbolSearchResult[] = [
      {
        column: 21,
        containerName: "App\\Services\\Analytics\\Adapters\\Facebook\\FacebookAdapterService",
        fullyQualifiedName:
          "App\\Services\\Analytics\\Adapters\\Facebook\\FacebookAdapterService::getPlatform",
        kind: "method",
        lineNumber: 10,
        name: "getPlatform",
        path: facebookAdapterPath,
        relativePath: "app/Services/Analytics/Adapters/Facebook/FacebookAdapterService.php",
      },
      {
        column: 21,
        containerName: "App\\Billing\\InvoiceAdapter",
        fullyQualifiedName: "App\\Billing\\InvoiceAdapter::getPlatform",
        kind: "method",
        lineNumber: 5,
        name: "getPlatform",
        path: billingAdapterPath,
        relativePath: "app/Billing/InvoiceAdapter.php",
      },
    ];
    const { getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace",
      },
      languageServerFeaturesGateway: {
        ...featuresGateway(),
        implementation,
      },
      projectSymbols,
      readTextFile: vi.fn(async (path: string) => {
        if (path === interfacePath) {
          return interfaceSource;
        }

        if (path === facebookAdapterPath) {
          return `<?php

namespace App\\Services\\Analytics\\Adapters\\Facebook;

use App\\Contracts\\PlatformAdapter;

final class FacebookAdapterService implements PlatformAdapter
{
    public function getPlatform(): Platform
    {
    }
}
`;
        }

        if (path === billingAdapterPath) {
          return `<?php
namespace App\\Billing;

final class InvoiceAdapter
{
    public function getPlatform()
    {
    }
}
`;
        }

        return "<?php\n";
      }),
      workspaceDescriptor: phpWorkspaceDescriptor(),
    });
    await flushAsyncTurns();
    await act(async () => {
      await getWorkbench().setSmartMode("fullSmart");
    });

    await act(async () => {
      await getWorkbench().openFile(fileEntry(interfacePath, "PlatformAdapter.php"));
    });

    await act(async () => {
      await getWorkbench().goToImplementationAt(positionAfter(interfaceSource, "getPlatform"));
    });

    expect(implementation).not.toHaveBeenCalled();
    expect(getWorkbench().implementationChooser).toBe(null);
    expect(getWorkbench().activePath).toBe(facebookAdapterPath);
    expect(getWorkbench().editorRevealTarget).toEqual({
      path: facebookAdapterPath,
      position: {
        column: 21,
        lineNumber: 10,
      },
    });
  });
  it("drops stale indexed PHP implementation results after switching project tabs", async () => {
    const interfacePath = "/workspace-a/app/Contracts/PlatformAdapter.php";
    const implementationPath =
      "/workspace-a/app/Services/Analytics/Adapters/Facebook/FacebookAdapterService.php";
    const interfaceSource = `<?php

namespace App\\Contracts;

interface PlatformAdapter
{
    public function getPlatform(): Platform;
}
`;
    const implementationSource = `<?php

namespace App\\Services\\Analytics\\Adapters\\Facebook;

use App\\Contracts\\PlatformAdapter;

final class FacebookAdapterService implements PlatformAdapter
{
    public function getPlatform(): Platform
    {
    }
}
`;
    const symbolSearch = createDeferred<ProjectSymbolSearchResult[]>();
    const readTextFile = vi.fn(async (path: string) => {
      if (path === interfacePath) {
        return interfaceSource;
      }

      if (path === implementationPath) {
        return implementationSource;
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
    vi.mocked(
      dependencies.workspaceGateways.projectSymbols.searchProjectSymbols,
    ).mockImplementationOnce(async () => symbolSearch.promise);
    await flushAsyncTurns();
    await act(async () => {
      await getWorkbench().setSmartMode("fullSmart");
    });

    await act(async () => {
      await getWorkbench().openFile(fileEntry(interfacePath, "PlatformAdapter.php"));
    });

    let implementationPromise: Promise<void> = Promise.resolve();
    await act(async () => {
      implementationPromise = getWorkbench().goToImplementationAt(
        positionAfter(interfaceSource, "getPlatform"),
      );
      await Promise.resolve();
    });
    await waitForReact(() => {
      expect(
        dependencies.workspaceGateways.projectSymbols.searchProjectSymbols,
      ).toHaveBeenCalledWith("/workspace-a", "getPlatform", 200);
    });

    await act(async () => {
      await getWorkbench().activateWorkspaceTab("/workspace-b");
    });
    await flushAsyncTurns(4);

    symbolSearch.resolve([
      {
        column: 21,
        containerName: "App\\Services\\Analytics\\Adapters\\Facebook\\FacebookAdapterService",
        fullyQualifiedName:
          "App\\Services\\Analytics\\Adapters\\Facebook\\FacebookAdapterService::getPlatform",
        kind: "method",
        lineNumber: 10,
        name: "getPlatform",
        path: implementationPath,
        relativePath: "app/Services/Analytics/Adapters/Facebook/FacebookAdapterService.php",
      },
    ]);
    await act(async () => {
      await implementationPromise;
    });

    expect(readTextFile).not.toHaveBeenCalledWith(implementationPath);
    expect(getWorkbench().workspaceRoot).toBe("/workspace-b");
    expect(getWorkbench().activePath).not.toBe(implementationPath);
    expect(getWorkbench().implementationChooser).toBe(null);
  });
  it("shows a chooser for multiple indexed PHP implementations when the language server returns no targets", async () => {
    const interfacePath = "/workspace/app/Contracts/PlatformAdapter.php";
    const baseAdapterPath = "/workspace/app/Services/Analytics/Adapters/BaseAdapter.php";
    const facebookAdapterPath =
      "/workspace/app/Services/Analytics/Adapters/Facebook/FacebookAdapterService.php";
    const interfaceSource = `<?php

namespace App\\Contracts;

interface PlatformAdapter
{
    public function getPlatform(): Platform;
}
`;
    const implementation = vi.fn(async () => []);
    const projectSymbols: ProjectSymbolSearchResult[] = [
      {
        column: 21,
        containerName: "App\\Services\\Analytics\\Adapters\\BaseAdapter",
        fullyQualifiedName: "App\\Services\\Analytics\\Adapters\\BaseAdapter::getPlatform",
        kind: "method",
        lineNumber: 9,
        name: "getPlatform",
        path: baseAdapterPath,
        relativePath: "app/Services/Analytics/Adapters/BaseAdapter.php",
      },
      {
        column: 21,
        containerName: "App\\Services\\Analytics\\Adapters\\Facebook\\FacebookAdapterService",
        fullyQualifiedName:
          "App\\Services\\Analytics\\Adapters\\Facebook\\FacebookAdapterService::getPlatform",
        kind: "method",
        lineNumber: 10,
        name: "getPlatform",
        path: facebookAdapterPath,
        relativePath: "app/Services/Analytics/Adapters/Facebook/FacebookAdapterService.php",
      },
      {
        column: 21,
        containerName: "App\\Billing\\InvoiceAdapter",
        fullyQualifiedName: "App\\Billing\\InvoiceAdapter::getPlatform",
        kind: "method",
        lineNumber: 5,
        name: "getPlatform",
        path: "/workspace/app/Billing/InvoiceAdapter.php",
        relativePath: "app/Billing/InvoiceAdapter.php",
      },
    ];
    const { getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace",
      },
      languageServerFeaturesGateway: {
        ...featuresGateway(),
        implementation,
      },
      projectSymbols,
      readTextFile: vi.fn(async (path: string) => {
        if (path === interfacePath) {
          return interfaceSource;
        }

        if (path === baseAdapterPath) {
          return `<?php

namespace App\\Services\\Analytics\\Adapters;

use App\\Contracts\\PlatformAdapter;

abstract class BaseAdapter implements PlatformAdapter
{
    public function getPlatform(): Platform
    {
    }
}
`;
        }

        if (path === facebookAdapterPath) {
          return `<?php

namespace App\\Services\\Analytics\\Adapters\\Facebook;

use App\\Services\\Analytics\\Adapters\\BaseAdapter;

final class FacebookAdapterService extends BaseAdapter
{
    public function getPlatform(): Platform
    {
    }
}
`;
        }

        return `<?php
final class InvoiceAdapter
{
    public function getPlatform()
    {
    }
}
`;
      }),
      runtimeStatus: {
        capabilities: {
          ...emptyLanguageServerCapabilities(),
          implementation: true,
        },
        kind: "running",
        sessionId: 1,
      },
      workspaceDescriptor: phpWorkspaceDescriptor(),
    });
    await flushAsyncTurns();
    await act(async () => {
      await getWorkbench().setSmartMode("fullSmart");
    });

    await act(async () => {
      await getWorkbench().openFile(fileEntry(interfacePath, "PlatformAdapter.php"));
    });

    await act(async () => {
      await getWorkbench().goToImplementationAt(positionAfter(interfaceSource, "getPlatform"));
    });

    expect(implementation).toHaveBeenCalledWith("/workspace", {
      character: 31,
      line: 6,
      path: interfacePath,
    });
    expect(getWorkbench().activePath).toBe(interfacePath);
    expect(getWorkbench().implementationChooser?.title).toBe(
      "Choose implementation of getPlatform",
    );
    expect(
      getWorkbench().implementationChooser?.targets.map((target) => ({
        detail: target.detail,
        label: target.label,
        path: target.path,
      })),
    ).toEqual([
      {
        detail: "\\App\\Services\\Analytics\\Adapters",
        label: "BaseAdapter",
        path: baseAdapterPath,
      },
      {
        detail: "\\App\\Services\\Analytics\\Adapters\\Facebook",
        label: "FacebookAdapterService",
        path: facebookAdapterPath,
      },
    ]);
  });
});
