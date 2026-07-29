// @vitest-environment jsdom

import {
  workspaceAppSettings,
  act,
  completion,
  createDeferred,
  defaultAppSettings,
  describe,
  directoryEntry,
  emptyLanguageServerCapabilities,
  expect,
  featuresGateway,
  fileEntry,
  type FileEntry,
  flushAsyncTurns,
  it,
  phpWorkspaceDescriptor,
  positionAfter,
  type ProjectSymbolSearchResult,
  setupWorkbenchControllerTestHarness,
  vi,
  waitForReact,
  type WorkbenchController,
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
      appSettings: workspaceAppSettings(),
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
      appSettings: workspaceAppSettings(),
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
      appSettings: workspaceAppSettings(),
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
      appSettings: workspaceAppSettings(),
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
      appSettings: workspaceAppSettings(),
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
      appSettings: workspaceAppSettings(),
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
      appSettings: workspaceAppSettings(),
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
      appSettings: workspaceAppSettings(),
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
      appSettings: workspaceAppSettings(),
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
      appSettings: workspaceAppSettings(),
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
      appSettings: workspaceAppSettings(),
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
      appSettings: workspaceAppSettings(),
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
      appSettings: workspaceAppSettings(),
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
      appSettings: workspaceAppSettings(),
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
      appSettings: workspaceAppSettings(),
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
      appSettings: workspaceAppSettings(),
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
      appSettings: workspaceAppSettings(),
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
      appSettings: workspaceAppSettings(),
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
      appSettings: workspaceAppSettings(),
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
      appSettings: workspaceAppSettings(),
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
      appSettings: workspaceAppSettings(),
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
      appSettings: workspaceAppSettings(),
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
      appSettings: workspaceAppSettings(),
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
      appSettings: workspaceAppSettings(),
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
      appSettings: workspaceAppSettings(),
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
      appSettings: workspaceAppSettings(),
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
      appSettings: workspaceAppSettings(),
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
      appSettings: workspaceAppSettings(),
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
      appSettings: workspaceAppSettings(),
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
      appSettings: workspaceAppSettings(),
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
      appSettings: workspaceAppSettings(),
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
      appSettings: workspaceAppSettings(),
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
      appSettings: workspaceAppSettings(),
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
      appSettings: workspaceAppSettings(),
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
      appSettings: workspaceAppSettings(),
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
      appSettings: workspaceAppSettings(),
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
      appSettings: workspaceAppSettings(),
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
      appSettings: workspaceAppSettings(),
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
      appSettings: workspaceAppSettings(),
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
      appSettings: workspaceAppSettings(),
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
      appSettings: workspaceAppSettings(),
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
      appSettings: workspaceAppSettings(),
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
      appSettings: workspaceAppSettings(),
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
      appSettings: workspaceAppSettings(),
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
      appSettings: workspaceAppSettings(),
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
      appSettings: workspaceAppSettings(),
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
      appSettings: workspaceAppSettings(),
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
      appSettings: workspaceAppSettings(),
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
      appSettings: workspaceAppSettings(),
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
      appSettings: workspaceAppSettings(),
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
      appSettings: workspaceAppSettings(),
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
      appSettings: workspaceAppSettings(),
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
      appSettings: workspaceAppSettings(),
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
      appSettings: workspaceAppSettings(),
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
      appSettings: workspaceAppSettings(),
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
      appSettings: workspaceAppSettings(),
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
      appSettings: workspaceAppSettings(),
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
      appSettings: workspaceAppSettings(),
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
      appSettings: workspaceAppSettings(),
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
      appSettings: workspaceAppSettings(),
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
      appSettings: workspaceAppSettings(),
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
      appSettings: workspaceAppSettings(),
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
      appSettings: workspaceAppSettings(),
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
});
