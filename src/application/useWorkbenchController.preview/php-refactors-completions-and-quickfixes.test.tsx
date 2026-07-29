// @vitest-environment jsdom

import {
  workspaceAppSettings,
  act,
  createDeferred,
  defaultAppSettings,
  describe,
  emptyLanguageServerCapabilities,
  expect,
  fileEntry,
  fileUriFromPath,
  flushAsyncTurns,
  it,
  type LanguageServerDiagnosticEvent,
  type LanguageServerDiagnosticsGateway,
  type LanguageServerRuntimeStatus,
  phpWorkspaceDescriptor,
  positionAfter,
  type ProjectSymbolSearchResult,
  setupWorkbenchControllerTestHarness,
  type TextSearchResult,
  vi,
  waitForReact,
  type WorkbenchController,
  type ProjectSymbolSearchGateway,
  resolveInReactAct,
  type WorkbenchWorkspaceGateways,
  type WorkspaceFileChangeEvent,
  applyPhpDescriptorEdits,
  expectBalancedPhp,
} from "./testSupport";

describe("useWorkbenchController PHP language intelligence", () => {
  const { renderController } = setupWorkbenchControllerTestHarness();

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
      appSettings: workspaceAppSettings(),
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
      appSettings: workspaceAppSettings(),
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
      appSettings: workspaceAppSettings(),
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
      appSettings: workspaceAppSettings(),
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
      appSettings: workspaceAppSettings(),
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
      appSettings: workspaceAppSettings(),
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
      appSettings: workspaceAppSettings(),
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
      appSettings: workspaceAppSettings(),
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
      appSettings: workspaceAppSettings(),
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
      appSettings: workspaceAppSettings(),
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
      appSettings: workspaceAppSettings(),
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
      appSettings: workspaceAppSettings(),
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
      appSettings: workspaceAppSettings(),
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
      appSettings: workspaceAppSettings(),
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
      appSettings: workspaceAppSettings(),
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
      appSettings: workspaceAppSettings(),
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
      appSettings: workspaceAppSettings(),
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
      appSettings: workspaceAppSettings(),
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
      appSettings: workspaceAppSettings(),
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
      appSettings: workspaceAppSettings(),
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
      appSettings: workspaceAppSettings(),
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
});

describe("useWorkbenchController workspace sessions and PHP code actions", () => {
  const { renderController } = setupWorkbenchControllerTestHarness();
  it("offers a generate constructor action for a class with properties and no constructor", async () => {
    const classPath = "/workspace/app/Models/Account.php";
    const classSource = `<?php

namespace App\\Models;

class Account
{
    private string $name;

    private int $balance;
}
`;
    const { getWorkbench } = renderController({
      appSettings: workspaceAppSettings(),
      readTextFile: vi.fn(async (path: string) => {
        if (path === classPath) {
          return classSource;
        }

        return `<?php\n// ${path}\n`;
      }),
      workspaceDescriptor: phpWorkspaceDescriptor(),
    });
    await flushAsyncTurns();
    await act(async () => {
      await getWorkbench().openFile(fileEntry(classPath, "Account.php"));
    });

    const actions = await getWorkbench().providePhpCodeActions(classSource);

    const constructorAction = actions.find((action) => action.title === "Generate constructor");
    expect(constructorAction).toBeDefined();
    const constructorText = constructorAction?.edits[0]?.text ?? "";
    expect(constructorText).toContain("public function __construct(string $name, int $balance)");
    expect(constructorText).toContain("$this->name = $name;");
    expect(constructorText).toContain("$this->balance = $balance;");
  });
  it("moves declared properties into a genuinely promoted constructor", async () => {
    const classPath = "/workspace/app/Models/Account.php";
    const classSource = `<?php

namespace App\\Models;

class Account
{
    private string $name;

    private int $balance;
}
`;
    const { getWorkbench } = renderController({
      appSettings: workspaceAppSettings(),
      readTextFile: vi.fn(async (path: string) => {
        if (path === classPath) {
          return classSource;
        }

        return `<?php\n// ${path}\n`;
      }),
      workspaceDescriptor: phpWorkspaceDescriptor(),
    });
    await flushAsyncTurns();
    await act(async () => {
      await getWorkbench().openFile(fileEntry(classPath, "Account.php"));
    });

    const actions = await getWorkbench().providePhpCodeActions(classSource);

    const classicAction = actions.find((action) => action.title === "Generate constructor");
    expect(classicAction).toBeDefined();

    const promotedAction = actions.find(
      (action) => action.title === "Generate constructor with promotion",
    );
    expect(promotedAction).toBeDefined();
    expect(applyPhpDescriptorEdits(classSource, promotedAction!)).toBe(`<?php

namespace App\\Models;

class Account
{

    public function __construct(
        private string $name,
        private int $balance,
    ) {}
}
`);
  });
  it("offers no promoted constructor action when the class already has a constructor", async () => {
    const classPath = "/workspace/app/Models/Account.php";
    const classSource = `<?php

namespace App\\Models;

class Account
{
    private string $name;

    public function __construct(string $name)
    {
        $this->name = $name;
    }
}
`;
    const { getWorkbench } = renderController({
      appSettings: workspaceAppSettings(),
      readTextFile: vi.fn(async (path: string) => {
        if (path === classPath) {
          return classSource;
        }

        return `<?php\n// ${path}\n`;
      }),
      workspaceDescriptor: phpWorkspaceDescriptor(),
    });
    await flushAsyncTurns();
    await act(async () => {
      await getWorkbench().openFile(fileEntry(classPath, "Account.php"));
    });

    const actions = await getWorkbench().providePhpCodeActions(classSource);

    expect(actions.some((action) => action.title === "Generate constructor with promotion")).toBe(
      false,
    );
  });
  it("offers no generate constructor action when the class already has a constructor", async () => {
    const classPath = "/workspace/app/Models/Account.php";
    const classSource = `<?php

namespace App\\Models;

class Account
{
    private string $name;

    public function __construct(string $name)
    {
        $this->name = $name;
    }
}
`;
    const { getWorkbench } = renderController({
      appSettings: workspaceAppSettings(),
      readTextFile: vi.fn(async (path: string) => {
        if (path === classPath) {
          return classSource;
        }

        return `<?php\n// ${path}\n`;
      }),
      workspaceDescriptor: phpWorkspaceDescriptor(),
    });
    await flushAsyncTurns();
    await act(async () => {
      await getWorkbench().openFile(fileEntry(classPath, "Account.php"));
    });

    const actions = await getWorkbench().providePhpCodeActions(classSource);

    expect(actions.some((action) => action.title === "Generate constructor")).toBe(false);
  });
  it("offers Generate PHPDoc when the cursor sits on an undocumented method", async () => {
    const classPath = "/workspace/app/Services/Greeter.php";
    const classSource = `<?php

namespace App\\Services;

class Greeter
{
    public function greet(string $name, int $count): bool
    {
        return true;
    }
}
`;
    const { getWorkbench } = renderController({
      appSettings: workspaceAppSettings(),
      readTextFile: vi.fn(async (path: string) =>
        path === classPath ? classSource : `<?php\n// ${path}\n`,
      ),
      workspaceDescriptor: phpWorkspaceDescriptor(),
    });
    await flushAsyncTurns();
    await act(async () => {
      await getWorkbench().openFile(fileEntry(classPath, "Greeter.php"));
    });

    const offset = classSource.indexOf("greet(");
    const actions = await getWorkbench().providePhpCodeActions(classSource, {
      end: offset,
      start: offset,
    });

    const phpDocAction = actions.find((action) => action.title === "Generate PHPDoc");
    expect(phpDocAction).toBeDefined();

    const edit = phpDocAction?.edits[0];
    const text = edit?.text ?? "";
    expect(text).toContain("    /**");
    expect(text).toContain("     * @param string $name");
    expect(text).toContain("     * @param int $count");
    expect(text).toContain("     * @return bool");

    // Inserted at the start of the declaration line (zero-length edit) so the
    // docblock sits directly above the method.
    const declarationLineNumber = classSource
      .slice(0, classSource.indexOf("public function greet"))
      .split("\n").length;
    expect(edit?.range.startColumn).toBe(1);
    expect(edit?.range.endColumn).toBe(1);
    expect(edit?.range.startLineNumber).toBe(declarationLineNumber);
    expect(edit?.range.endLineNumber).toBe(declarationLineNumber);
  });
  it("does not offer Generate PHPDoc on a method that already has a docblock", async () => {
    const classPath = "/workspace/app/Services/Greeter.php";
    const classSource = `<?php

namespace App\\Services;

class Greeter
{
    /**
     * @param string $name
     * @return bool
     */
    public function greet(string $name): bool
    {
        return true;
    }
}
`;
    const { getWorkbench } = renderController({
      appSettings: workspaceAppSettings(),
      readTextFile: vi.fn(async (path: string) =>
        path === classPath ? classSource : `<?php\n// ${path}\n`,
      ),
      workspaceDescriptor: phpWorkspaceDescriptor(),
    });
    await flushAsyncTurns();
    await act(async () => {
      await getWorkbench().openFile(fileEntry(classPath, "Greeter.php"));
    });

    const offset = classSource.indexOf("greet(");
    const actions = await getWorkbench().providePhpCodeActions(classSource, {
      end: offset,
      start: offset,
    });

    expect(actions.some((action) => action.title === "Generate PHPDoc")).toBe(false);
  });
  it("does not offer Generate PHPDoc when the cursor is not on any method", async () => {
    const classPath = "/workspace/app/Services/Greeter.php";
    const classSource = `<?php

namespace App\\Services;

class Greeter
{
    public function greet(string $name): bool
    {
        return true;
    }
}
`;
    const { getWorkbench } = renderController({
      appSettings: workspaceAppSettings(),
      readTextFile: vi.fn(async (path: string) =>
        path === classPath ? classSource : `<?php\n// ${path}\n`,
      ),
      workspaceDescriptor: phpWorkspaceDescriptor(),
    });
    await flushAsyncTurns();
    await act(async () => {
      await getWorkbench().openFile(fileEntry(classPath, "Greeter.php"));
    });

    const offset = classSource.indexOf("class Greeter");
    const actions = await getWorkbench().providePhpCodeActions(classSource, {
      end: offset,
      start: offset,
    });

    expect(actions.some((action) => action.title === "Generate PHPDoc")).toBe(false);
  });
  it("offers Generate PHPDoc when the cursor sits on a method's leading attribute", async () => {
    const classPath = "/workspace/app/Http/Controllers/UserController.php";
    const classSource = `<?php

namespace App\\Http\\Controllers;

class UserController
{
    #[Route('/users/{id}')]
    public function show(int $id): string
    {
        return (string) $id;
    }
}
`;
    const { getWorkbench } = renderController({
      appSettings: workspaceAppSettings(),
      readTextFile: vi.fn(async (path: string) =>
        path === classPath ? classSource : `<?php\n// ${path}\n`,
      ),
      workspaceDescriptor: phpWorkspaceDescriptor(),
    });
    await flushAsyncTurns();
    await act(async () => {
      await getWorkbench().openFile(fileEntry(classPath, "UserController.php"));
    });

    // Cursor parked on the `#[Route(...)]` attribute line above the method.
    const offset = classSource.indexOf("Route('/users");
    const actions = await getWorkbench().providePhpCodeActions(classSource, {
      end: offset,
      start: offset,
    });

    const phpDocAction = actions.find((action) => action.title === "Generate PHPDoc");
    expect(phpDocAction).toBeDefined();
    expect(phpDocAction?.edits[0]?.text).toContain(" * @param int $id");

    // The docblock is still inserted above the `function` line (below the
    // attribute), not above the attribute line.
    const declarationLineNumber = classSource
      .slice(0, classSource.indexOf("public function show"))
      .split("\n").length;
    expect(phpDocAction?.edits[0]?.range.startLineNumber).toBe(declarationLineNumber);
  });
  it("offers Generate PHPDoc when the cursor sits on a method's modifier line", async () => {
    const classPath = "/workspace/app/Services/Greeter.php";
    const classSource = `<?php

namespace App\\Services;

class Greeter
{
    public function first(): int
    {
        return 1;
    }

    public function greet(string $name): bool
    {
        return true;
    }
}
`;
    const { getWorkbench } = renderController({
      appSettings: workspaceAppSettings(),
      readTextFile: vi.fn(async (path: string) =>
        path === classPath ? classSource : `<?php\n// ${path}\n`,
      ),
      workspaceDescriptor: phpWorkspaceDescriptor(),
    });
    await flushAsyncTurns();
    await act(async () => {
      await getWorkbench().openFile(fileEntry(classPath, "Greeter.php"));
    });

    // Cursor on the `public` modifier of `greet`, before its `function` keyword.
    const offset = classSource.indexOf("public function greet");
    const actions = await getWorkbench().providePhpCodeActions(classSource, {
      end: offset,
      start: offset,
    });

    const phpDocAction = actions.find((action) => action.title === "Generate PHPDoc");
    expect(phpDocAction).toBeDefined();
    // Resolves to `greet`, not the preceding `first` method.
    expect(phpDocAction?.edits[0]?.text).toContain(" * @param string $name");
    expect(phpDocAction?.edits[0]?.text).toContain(" * @return bool");
  });
  it("does not offer Generate PHPDoc when the docblock would be empty", async () => {
    const classPath = "/workspace/app/Services/Greeter.php";
    const classSource = `<?php

namespace App\\Services;

class Greeter
{
    public function boot(): void
    {
    }
}
`;
    const { getWorkbench } = renderController({
      appSettings: workspaceAppSettings(),
      readTextFile: vi.fn(async (path: string) =>
        path === classPath ? classSource : `<?php\n// ${path}\n`,
      ),
      workspaceDescriptor: phpWorkspaceDescriptor(),
    });
    await flushAsyncTurns();
    await act(async () => {
      await getWorkbench().openFile(fileEntry(classPath, "Greeter.php"));
    });

    // A no-parameter `void` method would produce a docblock with neither
    // `@param` nor `@return`; PhpStorm offers nothing here, so neither do we.
    const offset = classSource.indexOf("boot(");
    const actions = await getWorkbench().providePhpCodeActions(classSource, {
      end: offset,
      start: offset,
    });

    expect(actions.some((action) => action.title === "Generate PHPDoc")).toBe(false);
  });
  it("offers an Add parameter code action that appends an optional parameter to a method", async () => {
    const classPath = "/workspace/app/Services/Greeter.php";
    const classSource = `<?php

namespace App\\Services;

class Greeter
{
    public function greet(string $name): string
    {
        return $name;
    }
}
`;
    const { getWorkbench } = renderController({
      appSettings: workspaceAppSettings(),
      readTextFile: vi.fn(async (path: string) =>
        path === classPath ? classSource : `<?php\n// ${path}\n`,
      ),
      workspaceDescriptor: phpWorkspaceDescriptor(),
    });
    await flushAsyncTurns();
    await act(async () => {
      await getWorkbench().openFile(fileEntry(classPath, "Greeter.php"));
    });

    const offset = classSource.indexOf("greet(");
    const actions = await getWorkbench().providePhpCodeActions(classSource, {
      end: offset,
      start: offset,
    });

    const addParameterAction = actions.find((action) => action.title === "Add parameter");
    expect(addParameterAction).toBeDefined();
    expect(applyPhpDescriptorEdits(classSource, addParameterAction!)).toBe(`<?php

namespace App\\Services;

class Greeter
{
    public function greet(string $name, $parameter = null): string
    {
        return $name;
    }
}
`);
  });
  it("offers an Add parameter code action on a free function with the cursor in its body", async () => {
    const filePath = "/workspace/app/helpers.php";
    const fileSource = `<?php

function add(int $a, int $b): int
{
    return $a + $b;
}
`;
    const { getWorkbench } = renderController({
      appSettings: workspaceAppSettings(),
      readTextFile: vi.fn(async (path: string) =>
        path === filePath ? fileSource : `<?php\n// ${path}\n`,
      ),
      workspaceDescriptor: phpWorkspaceDescriptor(),
    });
    await flushAsyncTurns();
    await act(async () => {
      await getWorkbench().openFile(fileEntry(filePath, "helpers.php"));
    });

    const offset = fileSource.indexOf("return $a");
    const actions = await getWorkbench().providePhpCodeActions(fileSource, {
      end: offset,
      start: offset,
    });

    const addParameterAction = actions.find((action) => action.title === "Add parameter");
    expect(addParameterAction).toBeDefined();
    expect(applyPhpDescriptorEdits(fileSource, addParameterAction!)).toBe(`<?php

function add(int $a, int $b, $parameter = null): int
{
    return $a + $b;
}
`);
  });
  it("does not offer Add parameter on an abstract method declaration", async () => {
    const classPath = "/workspace/app/Contracts/Base.php";
    const classSource = `<?php

namespace App\\Contracts;

abstract class Base
{
    abstract public function handle(string $name): void;
}
`;
    const { getWorkbench } = renderController({
      appSettings: workspaceAppSettings(),
      readTextFile: vi.fn(async (path: string) =>
        path === classPath ? classSource : `<?php\n// ${path}\n`,
      ),
      workspaceDescriptor: phpWorkspaceDescriptor(),
    });
    await flushAsyncTurns();
    await act(async () => {
      await getWorkbench().openFile(fileEntry(classPath, "Base.php"));
    });

    const offset = classSource.indexOf("handle(");
    const actions = await getWorkbench().providePhpCodeActions(classSource, {
      end: offset,
      start: offset,
    });

    expect(actions.some((action) => action.title === "Add parameter")).toBe(false);
  });
  it("does not offer Add parameter when the cursor is not on any function", async () => {
    const classPath = "/workspace/app/Services/Greeter.php";
    const classSource = `<?php

namespace App\\Services;

class Greeter
{
    public function greet(): void
    {
    }
}
`;
    const { getWorkbench } = renderController({
      appSettings: workspaceAppSettings(),
      readTextFile: vi.fn(async (path: string) =>
        path === classPath ? classSource : `<?php\n// ${path}\n`,
      ),
      workspaceDescriptor: phpWorkspaceDescriptor(),
    });
    await flushAsyncTurns();
    await act(async () => {
      await getWorkbench().openFile(fileEntry(classPath, "Greeter.php"));
    });

    const offset = classSource.indexOf("class Greeter");
    const actions = await getWorkbench().providePhpCodeActions(classSource, {
      end: offset,
      start: offset,
    });

    expect(actions.some((action) => action.title === "Add parameter")).toBe(false);
  });
  it("offers Add return type using the method's PHPDoc @return", async () => {
    const classPath = "/workspace/app/Services/Maker.php";
    const classSource = `<?php

namespace App\\Services;

class Maker
{
    /**
     * @return Foo
     */
    public function make()
    {
        return $this->foo;
    }
}
`;
    const { getWorkbench } = renderController({
      appSettings: workspaceAppSettings(),
      readTextFile: vi.fn(async (path: string) =>
        path === classPath ? classSource : `<?php\n// ${path}\n`,
      ),
      workspaceDescriptor: phpWorkspaceDescriptor(),
    });
    await flushAsyncTurns();
    await act(async () => {
      await getWorkbench().openFile(fileEntry(classPath, "Maker.php"));
    });

    const offset = classSource.indexOf("make(");
    const actions = await getWorkbench().providePhpCodeActions(classSource, {
      end: offset,
      start: offset,
    });

    const addReturnTypeAction = actions.find((action) => action.title === "Add return type");
    expect(addReturnTypeAction).toBeDefined();
    expect(applyPhpDescriptorEdits(classSource, addReturnTypeAction!)).toContain(
      "public function make(): Foo",
    );
  });
  it("offers Add return type as void on a free function with no return value", async () => {
    const filePath = "/workspace/app/helpers.php";
    const fileSource = `<?php

function log_message($message)
{
    error_log($message);
}
`;
    const { getWorkbench } = renderController({
      appSettings: workspaceAppSettings(),
      readTextFile: vi.fn(async (path: string) =>
        path === filePath ? fileSource : `<?php\n// ${path}\n`,
      ),
      workspaceDescriptor: phpWorkspaceDescriptor(),
    });
    await flushAsyncTurns();
    await act(async () => {
      await getWorkbench().openFile(fileEntry(filePath, "helpers.php"));
    });

    const offset = fileSource.indexOf("error_log");
    const actions = await getWorkbench().providePhpCodeActions(fileSource, {
      end: offset,
      start: offset,
    });

    const addReturnTypeAction = actions.find((action) => action.title === "Add return type");
    expect(addReturnTypeAction).toBeDefined();
    expect(applyPhpDescriptorEdits(fileSource, addReturnTypeAction!)).toContain(
      "function log_message($message): void",
    );
  });
  it("offers Add return type before the semicolon on an abstract method", async () => {
    const classPath = "/workspace/app/Contracts/Maker.php";
    const classSource = `<?php

namespace App\\Contracts;

abstract class Maker
{
    /**
     * @return Foo
     */
    abstract public function make();
}
`;
    const { getWorkbench } = renderController({
      appSettings: workspaceAppSettings(),
      readTextFile: vi.fn(async (path: string) =>
        path === classPath ? classSource : `<?php\n// ${path}\n`,
      ),
      workspaceDescriptor: phpWorkspaceDescriptor(),
    });
    await flushAsyncTurns();
    await act(async () => {
      await getWorkbench().openFile(fileEntry(classPath, "Maker.php"));
    });

    const offset = classSource.indexOf("make(");
    const actions = await getWorkbench().providePhpCodeActions(classSource, {
      end: offset,
      start: offset,
    });

    const addReturnTypeAction = actions.find((action) => action.title === "Add return type");
    expect(addReturnTypeAction).toBeDefined();
    expect(applyPhpDescriptorEdits(classSource, addReturnTypeAction!)).toContain(
      "abstract public function make(): Foo;",
    );
  });
  it("does not offer Add return type when the method already declares one", async () => {
    const classPath = "/workspace/app/Services/Maker.php";
    const classSource = `<?php

namespace App\\Services;

class Maker
{
    public function make(): Foo
    {
        return new Foo();
    }
}
`;
    const { getWorkbench } = renderController({
      appSettings: workspaceAppSettings(),
      readTextFile: vi.fn(async (path: string) =>
        path === classPath ? classSource : `<?php\n// ${path}\n`,
      ),
      workspaceDescriptor: phpWorkspaceDescriptor(),
    });
    await flushAsyncTurns();
    await act(async () => {
      await getWorkbench().openFile(fileEntry(classPath, "Maker.php"));
    });

    const offset = classSource.indexOf("make(");
    const actions = await getWorkbench().providePhpCodeActions(classSource, {
      end: offset,
      start: offset,
    });

    expect(actions.some((action) => action.title === "Add return type")).toBe(false);
  });
  it("does not offer Add return type when returns mix types", async () => {
    const classPath = "/workspace/app/Services/Maker.php";
    const classSource = `<?php

namespace App\\Services;

class Maker
{
    public function maybe($flag)
    {
        if ($flag) {
            return 'x';
        }

        return 123;
    }
}
`;
    const { getWorkbench } = renderController({
      appSettings: workspaceAppSettings(),
      readTextFile: vi.fn(async (path: string) =>
        path === classPath ? classSource : `<?php\n// ${path}\n`,
      ),
      workspaceDescriptor: phpWorkspaceDescriptor(),
    });
    await flushAsyncTurns();
    await act(async () => {
      await getWorkbench().openFile(fileEntry(classPath, "Maker.php"));
    });

    const offset = classSource.indexOf("maybe(");
    const actions = await getWorkbench().providePhpCodeActions(classSource, {
      end: offset,
      start: offset,
    });

    expect(actions.some((action) => action.title === "Add return type")).toBe(false);
  });
  it("offers Add type hint using the parameter's PHPDoc @param", async () => {
    const classPath = "/workspace/app/Services/Setter.php";
    const classSource = `<?php

namespace App\\Services;

class Setter
{
    /**
     * @param Foo $foo
     */
    public function set($foo)
    {
        $this->foo = $foo;
    }
}
`;
    const { getWorkbench } = renderController({
      appSettings: workspaceAppSettings(),
      readTextFile: vi.fn(async (path: string) =>
        path === classPath ? classSource : `<?php\n// ${path}\n`,
      ),
      workspaceDescriptor: phpWorkspaceDescriptor(),
    });
    await flushAsyncTurns();
    await act(async () => {
      await getWorkbench().openFile(fileEntry(classPath, "Setter.php"));
    });

    const offset = classSource.indexOf("$foo)");
    const actions = await getWorkbench().providePhpCodeActions(classSource, {
      end: offset,
      start: offset,
    });

    const addTypeHintAction = actions.find((action) => action.title === "Add type hint");
    expect(addTypeHintAction).toBeDefined();
    expect(applyPhpDescriptorEdits(classSource, addTypeHintAction!)).toContain(
      "public function set(Foo $foo)",
    );
  });
  it("offers Add type hint as array from an empty-array default", async () => {
    const classPath = "/workspace/app/Services/Setter.php";
    const classSource = `<?php

namespace App\\Services;

class Setter
{
    public function set($items = [])
    {
        $this->items = $items;
    }
}
`;
    const { getWorkbench } = renderController({
      appSettings: workspaceAppSettings(),
      readTextFile: vi.fn(async (path: string) =>
        path === classPath ? classSource : `<?php\n// ${path}\n`,
      ),
      workspaceDescriptor: phpWorkspaceDescriptor(),
    });
    await flushAsyncTurns();
    await act(async () => {
      await getWorkbench().openFile(fileEntry(classPath, "Setter.php"));
    });

    const offset = classSource.indexOf("$items");
    const actions = await getWorkbench().providePhpCodeActions(classSource, {
      end: offset,
      start: offset,
    });

    const addTypeHintAction = actions.find((action) => action.title === "Add type hint");
    expect(addTypeHintAction).toBeDefined();
    expect(applyPhpDescriptorEdits(classSource, addTypeHintAction!)).toContain(
      "public function set(array $items = [])",
    );
  });
  it("does not offer Add type hint for a `= null` default", async () => {
    const classPath = "/workspace/app/Services/Setter.php";
    const classSource = `<?php

namespace App\\Services;

class Setter
{
    public function set($foo = null)
    {
    }
}
`;
    const { getWorkbench } = renderController({
      appSettings: workspaceAppSettings(),
      readTextFile: vi.fn(async (path: string) =>
        path === classPath ? classSource : `<?php\n// ${path}\n`,
      ),
      workspaceDescriptor: phpWorkspaceDescriptor(),
    });
    await flushAsyncTurns();
    await act(async () => {
      await getWorkbench().openFile(fileEntry(classPath, "Setter.php"));
    });

    const offset = classSource.indexOf("$foo");
    const actions = await getWorkbench().providePhpCodeActions(classSource, {
      end: offset,
      start: offset,
    });

    expect(actions.some((action) => action.title === "Add type hint")).toBe(false);
  });
  it("does not offer Add type hint when the parameter already has a type", async () => {
    const classPath = "/workspace/app/Services/Setter.php";
    const classSource = `<?php

namespace App\\Services;

class Setter
{
    public function set(Foo $foo)
    {
    }
}
`;
    const { getWorkbench } = renderController({
      appSettings: workspaceAppSettings(),
      readTextFile: vi.fn(async (path: string) =>
        path === classPath ? classSource : `<?php\n// ${path}\n`,
      ),
      workspaceDescriptor: phpWorkspaceDescriptor(),
    });
    await flushAsyncTurns();
    await act(async () => {
      await getWorkbench().openFile(fileEntry(classPath, "Setter.php"));
    });

    const offset = classSource.indexOf("$foo");
    const actions = await getWorkbench().providePhpCodeActions(classSource, {
      end: offset,
      start: offset,
    });

    expect(actions.some((action) => action.title === "Add type hint")).toBe(false);
  });
  it("offers an optimize imports action when an import is unused", async () => {
    const classPath = "/workspace/app/Models/Account.php";
    const classSource = `<?php

namespace App\\Models;

use App\\Support\\Unused;
use App\\Support\\Money;

class Account
{
    private Money $balance;
}
`;
    const { getWorkbench } = renderController({
      appSettings: workspaceAppSettings(),
      readTextFile: vi.fn(async (path: string) => {
        if (path === classPath) {
          return classSource;
        }

        return `<?php\n// ${path}\n`;
      }),
      workspaceDescriptor: phpWorkspaceDescriptor(),
    });
    await flushAsyncTurns();
    await act(async () => {
      await getWorkbench().openFile(fileEntry(classPath, "Account.php"));
    });

    const actions = await getWorkbench().providePhpCodeActions(classSource);

    const optimizeAction = actions.find((action) => action.title === "Optimize imports");
    expect(optimizeAction).toBeDefined();
    const optimizeText = optimizeAction?.edits[0]?.text ?? "";
    expect(optimizeText).toContain("use App\\Support\\Money;");
    expect(optimizeText).not.toContain("Unused");
  });
  it("offers no optimize imports action when imports are already clean", async () => {
    const classPath = "/workspace/app/Models/Account.php";
    const classSource = `<?php

namespace App\\Models;

use App\\Support\\Money;

class Account
{
    private Money $balance;
}
`;
    const { getWorkbench } = renderController({
      appSettings: workspaceAppSettings(),
      readTextFile: vi.fn(async (path: string) => {
        if (path === classPath) {
          return classSource;
        }

        return `<?php\n// ${path}\n`;
      }),
      workspaceDescriptor: phpWorkspaceDescriptor(),
    });
    await flushAsyncTurns();
    await act(async () => {
      await getWorkbench().openFile(fileEntry(classPath, "Account.php"));
    });

    const actions = await getWorkbench().providePhpCodeActions(classSource);

    expect(actions.some((action) => action.title === "Optimize imports")).toBe(false);
  });
  it("does not offer optimize imports when a comment sits between use statements", async () => {
    const classPath = "/workspace/app/Models/Account.php";
    const classSource = `<?php

namespace App\\Models;

use App\\Support\\Unused;
// keep this note about Money
use App\\Support\\Money;

class Account
{
    private Money $balance;
}
`;
    const { getWorkbench } = renderController({
      appSettings: workspaceAppSettings(),
      readTextFile: vi.fn(async (path: string) => {
        if (path === classPath) {
          return classSource;
        }

        return `<?php\n// ${path}\n`;
      }),
      workspaceDescriptor: phpWorkspaceDescriptor(),
    });
    await flushAsyncTurns();
    await act(async () => {
      await getWorkbench().openFile(fileEntry(classPath, "Account.php"));
    });

    const actions = await getWorkbench().providePhpCodeActions(classSource);

    expect(actions.some((action) => action.title === "Optimize imports")).toBe(false);
  });
  it("replaces the use block with an empty string when every import is unused", async () => {
    const classPath = "/workspace/app/Models/Account.php";
    const classSource = `<?php

namespace App\\Models;

use App\\Support\\Unused;

class Account
{
    private string $name;
}
`;
    const { getWorkbench } = renderController({
      appSettings: workspaceAppSettings(),
      readTextFile: vi.fn(async (path: string) => {
        if (path === classPath) {
          return classSource;
        }

        return `<?php\n// ${path}\n`;
      }),
      workspaceDescriptor: phpWorkspaceDescriptor(),
    });
    await flushAsyncTurns();
    await act(async () => {
      await getWorkbench().openFile(fileEntry(classPath, "Account.php"));
    });

    const actions = await getWorkbench().providePhpCodeActions(classSource);

    const optimizeAction = actions.find((action) => action.title === "Optimize imports");
    expect(optimizeAction).toBeDefined();
    const optimizeEdit = optimizeAction?.edits[0];
    expect(optimizeEdit?.text).toBe("");
    expect(optimizeEdit?.range.startLineNumber).toBe(5);
    expect(optimizeEdit?.range.endLineNumber).toBe(5);
  });
  it("offers an Import class action for an unimported class found in the index", async () => {
    const classPath = "/workspace/app/Http/PostController.php";
    const classSource = `<?php

namespace App\\Http;

use App\\Models\\Comment;

class PostController
{
    public function show(): Post
    {
        return new Post();
    }
}
`;
    const { dependencies, getWorkbench } = renderController({
      appSettings: workspaceAppSettings(),
      readTextFile: vi.fn(async (path: string) =>
        path === classPath ? classSource : `<?php\n// ${path}\n`,
      ),
      workspaceDescriptor: phpWorkspaceDescriptor(),
    });
    await flushAsyncTurns();
    await act(async () => {
      await getWorkbench().setSmartMode("fullSmart");
    });
    vi.mocked(
      dependencies.workspaceGateways.projectSymbols.searchProjectSymbols,
    ).mockImplementation(async () => [
      {
        column: 7,
        containerName: null,
        fullyQualifiedName: "App\\Models\\Post",
        kind: "class",
        lineNumber: 5,
        name: "Post",
        path: "/workspace/app/Models/Post.php",
        relativePath: "app/Models/Post.php",
      },
    ]);
    await act(async () => {
      await getWorkbench().openFile(fileEntry(classPath, "PostController.php"));
    });

    const offset = classSource.indexOf("Post", classSource.indexOf("show()"));
    const actions = await getWorkbench().providePhpCodeActions(classSource, {
      end: offset,
      start: offset,
    });

    expect(dependencies.workspaceGateways.projectSymbols.searchProjectSymbols).toHaveBeenCalledWith(
      "/workspace",
      "Post",
      25,
    );
    const importAction = actions.find((action) => action.title === "Import App\\Models\\Post");
    expect(importAction).toBeDefined();
    const importEdit = importAction?.edits[0];
    expect(importEdit?.text).toBe("use App\\Models\\Post;\n");
    // Inserted before the alphabetically-later `use App\\Models\\Comment;`? No:
    // Post sorts after Comment, so it lands on the line AFTER Comment (line 6).
    expect(importEdit?.range.startColumn).toBe(1);
    expect(importEdit?.range.endColumn).toBe(1);
    expect(importEdit?.range.startLineNumber).toBe(6);
    expect(importEdit?.range.endLineNumber).toBe(6);
  });
  it("offers one Import action per candidate namespace for an ambiguous class", async () => {
    const classPath = "/workspace/app/Http/UserController.php";
    const classSource = `<?php

namespace App\\Http;

class UserController
{
    public function show(): User
    {
        return new User();
    }
}
`;
    const { dependencies, getWorkbench } = renderController({
      appSettings: workspaceAppSettings(),
      readTextFile: vi.fn(async (path: string) =>
        path === classPath ? classSource : `<?php\n// ${path}\n`,
      ),
      workspaceDescriptor: phpWorkspaceDescriptor(),
    });
    await flushAsyncTurns();
    await act(async () => {
      await getWorkbench().setSmartMode("fullSmart");
    });
    vi.mocked(
      dependencies.workspaceGateways.projectSymbols.searchProjectSymbols,
    ).mockImplementation(async () => [
      {
        column: 7,
        containerName: null,
        fullyQualifiedName: "App\\Models\\User",
        kind: "class",
        lineNumber: 5,
        name: "User",
        path: "/workspace/app/Models/User.php",
        relativePath: "app/Models/User.php",
      },
      {
        column: 7,
        containerName: null,
        fullyQualifiedName: "App\\Support\\User",
        kind: "class",
        lineNumber: 9,
        name: "User",
        path: "/workspace/app/Support/User.php",
        relativePath: "app/Support/User.php",
      },
    ]);
    await act(async () => {
      await getWorkbench().openFile(fileEntry(classPath, "UserController.php"));
    });

    const offset = classSource.indexOf("User", classSource.indexOf("show()"));
    const actions = await getWorkbench().providePhpCodeActions(classSource, {
      end: offset,
      start: offset,
    });

    const importTitles = actions
      .map((action) => action.title)
      .filter((title) => title.startsWith("Import "));
    expect(importTitles).toEqual(["Import App\\Models\\User", "Import App\\Support\\User"]);
  });
  it("does not offer an Import action when the class is already imported", async () => {
    const classPath = "/workspace/app/Http/PostController.php";
    const classSource = `<?php

namespace App\\Http;

use App\\Models\\Post;

class PostController
{
    public function show(): Post
    {
        return new Post();
    }
}
`;
    const { dependencies, getWorkbench } = renderController({
      appSettings: workspaceAppSettings(),
      readTextFile: vi.fn(async (path: string) =>
        path === classPath ? classSource : `<?php\n// ${path}\n`,
      ),
      workspaceDescriptor: phpWorkspaceDescriptor(),
    });
    await flushAsyncTurns();
    await act(async () => {
      await getWorkbench().setSmartMode("fullSmart");
    });
    vi.mocked(
      dependencies.workspaceGateways.projectSymbols.searchProjectSymbols,
    ).mockImplementation(async () => [
      {
        column: 7,
        containerName: null,
        fullyQualifiedName: "App\\Models\\Post",
        kind: "class",
        lineNumber: 5,
        name: "Post",
        path: "/workspace/app/Models/Post.php",
        relativePath: "app/Models/Post.php",
      },
    ]);
    await act(async () => {
      await getWorkbench().openFile(fileEntry(classPath, "PostController.php"));
    });

    const offset = classSource.indexOf("Post", classSource.indexOf("show()"));
    const actions = await getWorkbench().providePhpCodeActions(classSource, {
      end: offset,
      start: offset,
    });

    expect(actions.some((action) => action.title.startsWith("Import "))).toBe(false);
  });
  it("does not offer an Import action when the only candidate is in the current namespace", async () => {
    const classPath = "/workspace/app/Models/PostController.php";
    const classSource = `<?php

namespace App\\Models;

class PostController
{
    public function show(): Post
    {
        return new Post();
    }
}
`;
    const { dependencies, getWorkbench } = renderController({
      appSettings: workspaceAppSettings(),
      readTextFile: vi.fn(async (path: string) =>
        path === classPath ? classSource : `<?php\n// ${path}\n`,
      ),
      workspaceDescriptor: phpWorkspaceDescriptor(),
    });
    await flushAsyncTurns();
    await act(async () => {
      await getWorkbench().setSmartMode("fullSmart");
    });
    vi.mocked(
      dependencies.workspaceGateways.projectSymbols.searchProjectSymbols,
    ).mockImplementation(async () => [
      {
        column: 7,
        containerName: null,
        fullyQualifiedName: "App\\Models\\Post",
        kind: "class",
        lineNumber: 5,
        name: "Post",
        path: "/workspace/app/Models/Post.php",
        relativePath: "app/Models/Post.php",
      },
    ]);
    await act(async () => {
      await getWorkbench().openFile(fileEntry(classPath, "PostController.php"));
    });

    const offset = classSource.indexOf("Post", classSource.indexOf("show()"));
    const actions = await getWorkbench().providePhpCodeActions(classSource, {
      end: offset,
      start: offset,
    });

    expect(actions.some((action) => action.title.startsWith("Import "))).toBe(false);
  });
  it("does not offer an Import action when no candidate exists in the index", async () => {
    const classPath = "/workspace/app/Http/PostController.php";
    const classSource = `<?php

namespace App\\Http;

class PostController
{
    public function show(): Post
    {
        return new Post();
    }
}
`;
    const { getWorkbench } = renderController({
      appSettings: workspaceAppSettings(),
      readTextFile: vi.fn(async (path: string) =>
        path === classPath ? classSource : `<?php\n// ${path}\n`,
      ),
      workspaceDescriptor: phpWorkspaceDescriptor(),
    });
    await flushAsyncTurns();
    await act(async () => {
      await getWorkbench().setSmartMode("fullSmart");
    });
    await act(async () => {
      await getWorkbench().openFile(fileEntry(classPath, "PostController.php"));
    });

    const offset = classSource.indexOf("Post", classSource.indexOf("show()"));
    const actions = await getWorkbench().providePhpCodeActions(classSource, {
      end: offset,
      start: offset,
    });

    expect(actions.some((action) => action.title.startsWith("Import "))).toBe(false);
  });
  it("drops stale Import class actions after switching project tabs", async () => {
    const classPath = "/workspace-a/app/Http/PostController.php";
    const classSource = `<?php

namespace App\\Http;

class PostController
{
    public function show(): Post
    {
        return new Post();
    }
}
`;
    const symbolSearch =
      createDeferred<Awaited<ReturnType<ProjectSymbolSearchGateway["searchProjectSymbols"]>>>();
    const { dependencies, getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace-a",
        workspaceTabs: ["/workspace-a", "/workspace-b"],
      },
      readTextFile: vi.fn(async (path: string) =>
        path === classPath ? classSource : `<?php\n// ${path}\n`,
      ),
      workspaceDescriptor: phpWorkspaceDescriptor(),
    });
    await flushAsyncTurns();
    await act(async () => {
      await getWorkbench().setSmartMode("fullSmart");
    });
    vi.mocked(
      dependencies.workspaceGateways.projectSymbols.searchProjectSymbols,
    ).mockImplementation(async () => symbolSearch.promise);
    await act(async () => {
      await getWorkbench().openFile(fileEntry(classPath, "PostController.php"));
    });

    const offset = classSource.indexOf("Post", classSource.indexOf("show()"));
    let actionsPromise: ReturnType<WorkbenchController["providePhpCodeActions"]> | null = null;
    await act(async () => {
      actionsPromise = getWorkbench().providePhpCodeActions(classSource, {
        end: offset,
        start: offset,
      });
      await Promise.resolve();
    });
    await waitForReact(() => {
      // The Create-class existence probe (limit 50) and/or the Import-class
      // lookup (limit 25) both query the symbol index for the short name; either
      // confirms the in-flight search started before we switch tabs.
      expect(
        dependencies.workspaceGateways.projectSymbols.searchProjectSymbols,
      ).toHaveBeenCalledWith("/workspace-a", "Post", expect.any(Number));
    });

    await act(async () => {
      await getWorkbench().activateWorkspaceTab("/workspace-b");
    });
    await flushAsyncTurns();

    symbolSearch.resolve([
      {
        column: 7,
        containerName: null,
        fullyQualifiedName: "App\\Models\\Post",
        kind: "class",
        lineNumber: 5,
        name: "Post",
        path: "/workspace-a/app/Models/Post.php",
        relativePath: "app/Models/Post.php",
      },
    ]);

    expect(actionsPromise).not.toBeNull();
    await expect(actionsPromise).resolves.toEqual([]);
  });
  it("drops stale generate-constructor code actions after switching project tabs", async () => {
    const classPath = "/workspace-a/app/Services/Greeter.php";
    const interfacePath = "/workspace-a/app/Contracts/GreeterContract.php";
    const classSource = `<?php

namespace App\\Services;

use App\\Contracts\\GreeterContract;

class Greeter implements GreeterContract
{
    private string $name;
}
`;
    const interfaceRead = createDeferred<string>();
    const readTextFile = vi.fn(async (path: string) => {
      if (path === classPath) {
        return classSource;
      }

      if (path === interfacePath) {
        return interfaceRead.promise;
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
      await getWorkbench().openFile(fileEntry(classPath, "Greeter.php"));
    });

    let actionsPromise: ReturnType<WorkbenchController["providePhpCodeActions"]> | null = null;
    await act(async () => {
      actionsPromise = getWorkbench().providePhpCodeActions(classSource);
      await Promise.resolve();
    });
    await waitForReact(() => {
      expect(readTextFile).toHaveBeenCalledWith(interfacePath);
    });

    await act(async () => {
      await getWorkbench().activateWorkspaceTab("/workspace-b");
    });
    await flushAsyncTurns();

    interfaceRead.resolve(`<?php

namespace App\\Contracts;

interface GreeterContract
{
    public function greet(string $name): string;
}
`);

    expect(actionsPromise).not.toBeNull();
    await expect(actionsPromise).resolves.toEqual([]);
  });
  it("offers a create-method code action when the cursor is on a missing $this method", async () => {
    const classPath = "/workspace/app/Services/Greeter.php";
    const classSource = `<?php

namespace App\\Services;

class Greeter
{
    public function run(): void
    {
        $this->doWork(1, 'x');
    }
}
`;
    const { getWorkbench } = renderController({
      appSettings: workspaceAppSettings(),
      readTextFile: vi.fn(async (path: string) =>
        path === classPath ? classSource : `<?php\n// ${path}\n`,
      ),
      workspaceDescriptor: phpWorkspaceDescriptor(),
    });
    await flushAsyncTurns();
    await act(async () => {
      await getWorkbench().openFile(fileEntry(classPath, "Greeter.php"));
    });

    const offset = classSource.indexOf("doWork");
    const actions = await getWorkbench().providePhpCodeActions(classSource, {
      end: offset,
      start: offset,
    });

    const createMethod = actions.find((action) => action.title === "Create method 'doWork'");
    expect(createMethod).toBeDefined();
    const stubText = createMethod?.edits[0]?.text ?? "";
    expect(stubText).toContain("private function doWork(int $arg0, string $arg1)");
  });
  it("offers a create-property code action when the cursor is on a missing $this property", async () => {
    const classPath = "/workspace/app/Services/Greeter.php";
    const classSource = `<?php

namespace App\\Services;

class Greeter
{
    public function run(): void
    {
        echo $this->status;
    }
}
`;
    const { getWorkbench } = renderController({
      appSettings: workspaceAppSettings(),
      readTextFile: vi.fn(async (path: string) =>
        path === classPath ? classSource : `<?php\n// ${path}\n`,
      ),
      workspaceDescriptor: phpWorkspaceDescriptor(),
    });
    await flushAsyncTurns();
    await act(async () => {
      await getWorkbench().openFile(fileEntry(classPath, "Greeter.php"));
    });

    const offset = classSource.indexOf("status");
    const actions = await getWorkbench().providePhpCodeActions(classSource, {
      end: offset,
      start: offset,
    });

    const createProperty = actions.find((action) => action.title === "Create property 'status'");
    expect(createProperty).toBeDefined();
    expect(createProperty?.edits[0]?.text ?? "").toContain("private $status;");
  });
  it("offers no create-method action when the $this method already exists", async () => {
    const classPath = "/workspace/app/Services/Greeter.php";
    const classSource = `<?php

namespace App\\Services;

class Greeter
{
    public function run(): void
    {
        $this->doWork();
    }

    private function doWork(): void
    {
    }
}
`;
    const { getWorkbench } = renderController({
      appSettings: workspaceAppSettings(),
      readTextFile: vi.fn(async (path: string) =>
        path === classPath ? classSource : `<?php\n// ${path}\n`,
      ),
      workspaceDescriptor: phpWorkspaceDescriptor(),
    });
    await flushAsyncTurns();
    await act(async () => {
      await getWorkbench().openFile(fileEntry(classPath, "Greeter.php"));
    });

    const offset = classSource.indexOf("doWork");
    const actions = await getWorkbench().providePhpCodeActions(classSource, {
      end: offset,
      start: offset,
    });

    expect(actions.some((action) => action.title.startsWith("Create method"))).toBe(false);
  });
  it("marks Create method as the preferred quickfix on an unresolved member", async () => {
    const classPath = "/workspace/app/Services/Greeter.php";
    const classSource = `<?php

namespace App\\Services;

class Greeter
{
    public function run(): void
    {
        $this->doWork(1, 'x');
    }
}
`;
    const { getWorkbench } = renderController({
      appSettings: workspaceAppSettings(),
      readTextFile: vi.fn(async (path: string) =>
        path === classPath ? classSource : `<?php\n// ${path}\n`,
      ),
      workspaceDescriptor: phpWorkspaceDescriptor(),
    });
    await flushAsyncTurns();
    await act(async () => {
      await getWorkbench().openFile(fileEntry(classPath, "Greeter.php"));
    });

    const offset = classSource.indexOf("doWork");
    const actions = await getWorkbench().providePhpCodeActions(classSource, {
      end: offset,
      start: offset,
    });

    const createMethod = actions.find((action) => action.title === "Create method 'doWork'");
    // PhpStorm Alt+Enter: the contextual fix for the unresolved member is the
    // single most-likely action - a "quickfix" lightbulb, flagged preferred so
    // Monaco floats it to the top of the list.
    expect(createMethod?.kind).toBe("quickfix");
    expect(createMethod?.isPreferred).toBe(true);
    // And it leads the returned list (ordering = "most likely first").
    expect(actions[0]?.title).toBe("Create method 'doWork'");
  });
  it("offers a static create-method action when the cursor is on a missing self:: call", async () => {
    const classPath = "/workspace/app/Services/Factory.php";
    const classSource = `<?php

namespace App\\Services;

class Factory
{
    public function run(): void
    {
        self::make('x');
    }
}
`;
    const { getWorkbench } = renderController({
      appSettings: workspaceAppSettings(),
      readTextFile: vi.fn(async (path: string) =>
        path === classPath ? classSource : `<?php\n// ${path}\n`,
      ),
      workspaceDescriptor: phpWorkspaceDescriptor(),
    });
    await flushAsyncTurns();
    await act(async () => {
      await getWorkbench().openFile(fileEntry(classPath, "Factory.php"));
    });

    const offset = classSource.indexOf("make");
    const actions = await getWorkbench().providePhpCodeActions(classSource, {
      end: offset,
      start: offset,
    });

    const createMethod = actions.find((action) => action.title === "Create method 'make'");
    expect(createMethod).toBeDefined();
    expect(createMethod?.edits[0]?.text ?? "").toContain(
      "private static function make(string $arg0)",
    );
  });
  it("offers a create-constant action when the cursor is on a missing self::CONST", async () => {
    const classPath = "/workspace/app/Services/Factory.php";
    const classSource = `<?php

namespace App\\Services;

class Factory
{
    public function run(): string
    {
        return self::DEFAULT_NAME;
    }
}
`;
    const { getWorkbench } = renderController({
      appSettings: workspaceAppSettings(),
      readTextFile: vi.fn(async (path: string) =>
        path === classPath ? classSource : `<?php\n// ${path}\n`,
      ),
      workspaceDescriptor: phpWorkspaceDescriptor(),
    });
    await flushAsyncTurns();
    await act(async () => {
      await getWorkbench().openFile(fileEntry(classPath, "Factory.php"));
    });

    const offset = classSource.indexOf("DEFAULT_NAME");
    const actions = await getWorkbench().providePhpCodeActions(classSource, {
      end: offset,
      start: offset,
    });

    const createConstant = actions.find(
      (action) => action.title === "Create constant 'DEFAULT_NAME'",
    );
    expect(createConstant).toBeDefined();
    expect(createConstant?.edits[0]?.text ?? "").toContain("private const DEFAULT_NAME = null;");
  });
  it("infers the property type from a typed $this assignment", async () => {
    const classPath = "/workspace/app/Services/Factory.php";
    const classSource = `<?php

namespace App\\Services;

class Factory
{
    public function run(): void
    {
        $this->client = new HttpClient();
    }
}
`;
    const { getWorkbench } = renderController({
      appSettings: workspaceAppSettings(),
      readTextFile: vi.fn(async (path: string) =>
        path === classPath ? classSource : `<?php\n// ${path}\n`,
      ),
      workspaceDescriptor: phpWorkspaceDescriptor(),
    });
    await flushAsyncTurns();
    await act(async () => {
      await getWorkbench().openFile(fileEntry(classPath, "Factory.php"));
    });

    const offset = classSource.indexOf("client");
    const actions = await getWorkbench().providePhpCodeActions(classSource, {
      end: offset,
      start: offset,
    });

    const createProperty = actions.find((action) => action.title === "Create property 'client'");
    expect(createProperty).toBeDefined();
    expect(createProperty?.edits[0]?.text ?? "").toContain("private HttpClient $client;");
  });
  it("offers a same-file parent:: create-method action targeting the parent class", async () => {
    const classPath = "/workspace/app/Services/Pair.php";
    const classSource = `<?php

namespace App\\Services;

class Base
{
}

class Child extends Base
{
    public function run(): void
    {
        parent::handle('x');
    }
}
`;
    const { getWorkbench } = renderController({
      appSettings: workspaceAppSettings(),
      readTextFile: vi.fn(async (path: string) =>
        path === classPath ? classSource : `<?php\n// ${path}\n`,
      ),
      workspaceDescriptor: phpWorkspaceDescriptor(),
    });
    await flushAsyncTurns();
    await act(async () => {
      await getWorkbench().openFile(fileEntry(classPath, "Pair.php"));
    });

    const offset = classSource.indexOf("parent::handle") + "parent::".length;
    const actions = await getWorkbench().providePhpCodeActions(classSource, {
      end: offset,
      start: offset,
    });

    const createMethod = actions.find(
      (action) => action.title === "Create method 'handle' in 'Base'",
    );
    expect(createMethod).toBeDefined();
    const insertOffset = classSource.split("\n").slice(0, 6).join("\n").length + 1;
    // The edit lands inside Base's body (before Child), not at the end of file.
    const editLine = createMethod?.edits[0]?.range.startLineNumber ?? 0;
    expect(editLine).toBeLessThan(
      classSource.slice(0, classSource.indexOf("class Child")).split("\n").length,
    );
    expect(insertOffset).toBeGreaterThan(0);
  });
  it("does not offer a parent:: action when the same-file parent already has the method", async () => {
    const classPath = "/workspace/app/Services/Pair.php";
    const classSource = `<?php

namespace App\\Services;

class Base
{
    public function handle(string $value): void
    {
    }
}

class Child extends Base
{
    public function run(): void
    {
        parent::handle('x');
    }
}
`;
    const { getWorkbench } = renderController({
      appSettings: workspaceAppSettings(),
      readTextFile: vi.fn(async (path: string) =>
        path === classPath ? classSource : `<?php\n// ${path}\n`,
      ),
      workspaceDescriptor: phpWorkspaceDescriptor(),
    });
    await flushAsyncTurns();
    await act(async () => {
      await getWorkbench().openFile(fileEntry(classPath, "Pair.php"));
    });

    const offset = classSource.indexOf("parent::handle") + "parent::".length;
    const actions = await getWorkbench().providePhpCodeActions(classSource, {
      end: offset,
      start: offset,
    });

    expect(actions.some((action) => action.title.startsWith("Create method"))).toBe(false);
  });
  it("offers a parent::CONST create-constant action targeting the same-file parent", async () => {
    const classPath = "/workspace/app/Services/Pair.php";
    const classSource = `<?php

namespace App\\Services;

class Base
{
}

class Child extends Base
{
    public function run(): string
    {
        return parent::DEFAULT_LABEL;
    }
}
`;
    const { getWorkbench } = renderController({
      appSettings: workspaceAppSettings(),
      readTextFile: vi.fn(async (path: string) =>
        path === classPath ? classSource : `<?php\n// ${path}\n`,
      ),
      workspaceDescriptor: phpWorkspaceDescriptor(),
    });
    await flushAsyncTurns();
    await act(async () => {
      await getWorkbench().openFile(fileEntry(classPath, "Pair.php"));
    });

    const offset = classSource.indexOf("parent::DEFAULT_LABEL") + "parent::".length;
    const actions = await getWorkbench().providePhpCodeActions(classSource, {
      end: offset,
      start: offset,
    });

    const createConstant = actions.find(
      (action) => action.title === "Create constant 'DEFAULT_LABEL' in 'Base'",
    );
    expect(createConstant).toBeDefined();
    const editText = createConstant?.edits[0]?.text ?? "";
    expect(editText).toContain("protected const DEFAULT_LABEL = null;");
    expect(editText).not.toContain("private const DEFAULT_LABEL = null;");
  });
  it("does not offer a parent:: action when the parent lives in another file", async () => {
    const classPath = "/workspace/app/Services/Child.php";
    const classSource = `<?php

namespace App\\Services;

class Child extends Base
{
    public function run(): void
    {
        parent::handle('x');
    }
}
`;
    const { getWorkbench } = renderController({
      appSettings: workspaceAppSettings(),
      readTextFile: vi.fn(async (path: string) =>
        path === classPath ? classSource : `<?php\n// ${path}\n`,
      ),
      workspaceDescriptor: phpWorkspaceDescriptor(),
    });
    await flushAsyncTurns();
    await act(async () => {
      await getWorkbench().openFile(fileEntry(classPath, "Child.php"));
    });

    const offset = classSource.indexOf("parent::handle") + "parent::".length;
    const actions = await getWorkbench().providePhpCodeActions(classSource, {
      end: offset,
      start: offset,
    });

    expect(actions.some((action) => action.title.startsWith("Create method"))).toBe(false);
  });
  it("tags an Import class action as a preferred quickfix", async () => {
    const classPath = "/workspace/app/Http/PostController.php";
    const classSource = `<?php

namespace App\\Http;

class PostController
{
    public function show(): Post
    {
        return new Post();
    }
}
`;
    const { dependencies, getWorkbench } = renderController({
      appSettings: workspaceAppSettings(),
      readTextFile: vi.fn(async (path: string) =>
        path === classPath ? classSource : `<?php\n// ${path}\n`,
      ),
      workspaceDescriptor: phpWorkspaceDescriptor(),
    });
    await flushAsyncTurns();
    await act(async () => {
      await getWorkbench().setSmartMode("fullSmart");
    });
    vi.mocked(
      dependencies.workspaceGateways.projectSymbols.searchProjectSymbols,
    ).mockImplementation(async () => [
      {
        column: 7,
        containerName: null,
        fullyQualifiedName: "App\\Models\\Post",
        kind: "class",
        lineNumber: 5,
        name: "Post",
        path: "/workspace/app/Models/Post.php",
        relativePath: "app/Models/Post.php",
      },
    ]);
    await act(async () => {
      await getWorkbench().openFile(fileEntry(classPath, "PostController.php"));
    });

    const offset = classSource.indexOf("Post", classSource.indexOf("show()"));
    const actions = await getWorkbench().providePhpCodeActions(classSource, {
      end: offset,
      start: offset,
    });

    const importAction = actions.find((action) => action.title === "Import App\\Models\\Post");
    expect(importAction?.kind).toBe("quickfix");
    expect(importAction?.isPreferred).toBe(true);
  });
  it("classifies Generate constructor as a generate-family refactor (not a quickfix)", async () => {
    const classPath = "/workspace/app/Services/Greeter.php";
    const classSource = `<?php

namespace App\\Services;

class Greeter
{
    private string $name;
}
`;
    const { getWorkbench } = renderController({
      appSettings: workspaceAppSettings(),
      readTextFile: vi.fn(async (path: string) =>
        path === classPath ? classSource : `<?php\n// ${path}\n`,
      ),
      workspaceDescriptor: phpWorkspaceDescriptor(),
    });
    await flushAsyncTurns();
    await act(async () => {
      await getWorkbench().openFile(fileEntry(classPath, "Greeter.php"));
    });

    const offset = classSource.indexOf("class Greeter");
    const actions = await getWorkbench().providePhpCodeActions(classSource, {
      end: offset,
      start: offset,
    });

    const constructor = actions.find((action) => action.title === "Generate constructor");
    // Generate-family actions read as "refactor" in the action widget (distinct
    // icon/group from the quickfix lightbulb), matching PhpStorm's Generate menu.
    expect(constructor?.kind).toBe("refactor.rewrite");
    expect(constructor?.isPreferred).not.toBe(true);

    const accessors = actions.find((action) => action.title === "Generate getters and setters");
    expect(accessors?.kind).toBe("refactor.rewrite");
  });
  it("tags Optimize imports with the organize-imports source kind", async () => {
    const classPath = "/workspace/app/Services/Greeter.php";
    const classSource = `<?php

namespace App\\Services;

use App\\Models\\Unused;
use App\\Models\\Apple;

class Greeter
{
    public function run(Apple $apple): void
    {
    }
}
`;
    const { getWorkbench } = renderController({
      appSettings: workspaceAppSettings(),
      readTextFile: vi.fn(async (path: string) =>
        path === classPath ? classSource : `<?php\n// ${path}\n`,
      ),
      workspaceDescriptor: phpWorkspaceDescriptor(),
    });
    await flushAsyncTurns();
    await act(async () => {
      await getWorkbench().openFile(fileEntry(classPath, "Greeter.php"));
    });

    const offset = classSource.indexOf("class Greeter");
    const actions = await getWorkbench().providePhpCodeActions(classSource, {
      end: offset,
      start: offset,
    });

    const optimize = actions.find((action) => action.title === "Optimize imports");
    expect(optimize?.kind).toBe("source.organizeImports");
  });
  it("orders the contextual quickfix ahead of generate-family refactors", async () => {
    const classPath = "/workspace/app/Services/Greeter.php";
    // The cursor sits on an unresolved `$this->status`, so the contextual fix
    // (Create property) must lead - ahead of the class-level generate actions
    // (constructor / accessors) that are also offered for the same class.
    const classSource = `<?php

namespace App\\Services;

class Greeter
{
    private string $name;

    public function run(): void
    {
        echo $this->status;
    }
}
`;
    const { getWorkbench } = renderController({
      appSettings: workspaceAppSettings(),
      readTextFile: vi.fn(async (path: string) =>
        path === classPath ? classSource : `<?php\n// ${path}\n`,
      ),
      workspaceDescriptor: phpWorkspaceDescriptor(),
    });
    await flushAsyncTurns();
    await act(async () => {
      await getWorkbench().openFile(fileEntry(classPath, "Greeter.php"));
    });

    const offset = classSource.indexOf("status");
    const actions = await getWorkbench().providePhpCodeActions(classSource, {
      end: offset,
      start: offset,
    });

    const createIndex = actions.findIndex((action) => action.title === "Create property 'status'");
    const constructorIndex = actions.findIndex((action) => action.title === "Generate constructor");
    expect(createIndex).toBeGreaterThanOrEqual(0);
    expect(constructorIndex).toBeGreaterThanOrEqual(0);
    // Quickfix before generate-family refactor (PhpStorm "most likely first").
    expect(createIndex).toBeLessThan(constructorIndex);
    expect(actions[createIndex]?.isPreferred).toBe(true);
  });
  it("orders free-function refactors by kind family (extract before rewrite)", async () => {
    const classPath = "/workspace/app/helpers.php";
    // A free function (no enclosing class) with a selected expression (so
    // Extract variable - refactor.extract is offered) and no declared return
    // type but a literal return (so Add return type - refactor.rewrite fires).
    const classSource = `<?php

function total()
{
    return 42;
}
`;
    const { getWorkbench } = renderController({
      appSettings: workspaceAppSettings(),
      readTextFile: vi.fn(async (path: string) =>
        path === classPath ? classSource : `<?php\n// ${path}\n`,
      ),
      workspaceDescriptor: phpWorkspaceDescriptor(),
    });
    await flushAsyncTurns();
    await act(async () => {
      await getWorkbench().openFile(fileEntry(classPath, "helpers.php"));
    });

    const exprStart = classSource.indexOf("42");
    const actions = await getWorkbench().providePhpCodeActions(classSource, {
      end: exprStart + "42".length,
      start: exprStart,
    });

    const extractIndex = actions.findIndex((action) => action.title === "Extract variable");
    const returnTypeIndex = actions.findIndex((action) => action.title === "Add return type");
    expect(extractIndex).toBeGreaterThanOrEqual(0);
    expect(returnTypeIndex).toBeGreaterThanOrEqual(0);
    // refactor.extract sorts ahead of refactor.rewrite even in a free function.
    expect(extractIndex).toBeLessThan(returnTypeIndex);
  });
  it("offers an extract-variable code action for a selected expression", async () => {
    const classPath = "/workspace/app/Services/Greeter.php";
    const classSource = `<?php

namespace App\\Services;

class Greeter
{
    public function run(): int
    {
        return price() + tax();
    }
}
`;
    const { getWorkbench } = renderController({
      appSettings: workspaceAppSettings(),
      readTextFile: vi.fn(async (path: string) =>
        path === classPath ? classSource : `<?php\n// ${path}\n`,
      ),
      workspaceDescriptor: phpWorkspaceDescriptor(),
    });
    await flushAsyncTurns();
    await act(async () => {
      await getWorkbench().openFile(fileEntry(classPath, "Greeter.php"));
    });

    const start = classSource.indexOf("price()");
    const end = classSource.indexOf("tax()") + "tax()".length;
    const actions = await getWorkbench().providePhpCodeActions(classSource, {
      end,
      start,
    });

    const extract = actions.find((action) => action.title === "Extract variable");
    expect(extract).toBeDefined();
    expect(extract?.edits).toHaveLength(2);
    const declaration = extract?.edits.find((edit) =>
      edit.text.includes("$extracted = price() + tax();"),
    );
    expect(declaration).toBeDefined();
    const replacement = extract?.edits.find((edit) => edit.text === "$extracted");
    expect(replacement).toBeDefined();
  });
  it("offers no extract-variable action when the selection is empty", async () => {
    const classPath = "/workspace/app/Services/Greeter.php";
    const classSource = `<?php

namespace App\\Services;

class Greeter
{
    public function run(): int
    {
        return price() + tax();
    }
}
`;
    const { getWorkbench } = renderController({
      appSettings: workspaceAppSettings(),
      readTextFile: vi.fn(async (path: string) =>
        path === classPath ? classSource : `<?php\n// ${path}\n`,
      ),
      workspaceDescriptor: phpWorkspaceDescriptor(),
    });
    await flushAsyncTurns();
    await act(async () => {
      await getWorkbench().openFile(fileEntry(classPath, "Greeter.php"));
    });

    const offset = classSource.indexOf("price()");
    const actions = await getWorkbench().providePhpCodeActions(classSource, {
      end: offset,
      start: offset,
    });

    expect(actions.some((action) => action.title === "Extract variable")).toBe(false);
  });
  it("offers an inline-variable code action when the cursor is on a single-assignment local", async () => {
    const classPath = "/workspace/app/Services/Greeter.php";
    const classSource = `<?php

namespace App\\Services;

class Greeter
{
    public function run(): string
    {
        $name = $user->name;
        echo $name;
        return $name;
    }
}
`;
    const { getWorkbench } = renderController({
      appSettings: workspaceAppSettings(),
      readTextFile: vi.fn(async (path: string) =>
        path === classPath ? classSource : `<?php\n// ${path}\n`,
      ),
      workspaceDescriptor: phpWorkspaceDescriptor(),
    });
    await flushAsyncTurns();
    await act(async () => {
      await getWorkbench().openFile(fileEntry(classPath, "Greeter.php"));
    });

    const offset = classSource.indexOf("$name");
    const actions = await getWorkbench().providePhpCodeActions(classSource, {
      end: offset,
      start: offset,
    });

    const inline = actions.find((action) => action.title === "Inline variable");
    expect(inline).toBeDefined();
    // Declaration deletion plus one replacement per usage.
    expect(inline?.edits).toHaveLength(3);
    const deletion = inline?.edits.find((edit) => edit.text === "");
    expect(deletion).toBeDefined();
    expect(inline?.edits.every((edit) => edit.text === "" || edit.text === "$user->name")).toBe(
      true,
    );
  });
  it("offers no inline-variable action when the local is reassigned", async () => {
    const classPath = "/workspace/app/Services/Greeter.php";
    const classSource = `<?php

namespace App\\Services;

class Greeter
{
    public function run(): string
    {
        $name = $a;
        $name = $b;
        return $name;
    }
}
`;
    const { getWorkbench } = renderController({
      appSettings: workspaceAppSettings(),
      readTextFile: vi.fn(async (path: string) =>
        path === classPath ? classSource : `<?php\n// ${path}\n`,
      ),
      workspaceDescriptor: phpWorkspaceDescriptor(),
    });
    await flushAsyncTurns();
    await act(async () => {
      await getWorkbench().openFile(fileEntry(classPath, "Greeter.php"));
    });

    const offset = classSource.indexOf("$name");
    const actions = await getWorkbench().providePhpCodeActions(classSource, {
      end: offset,
      start: offset,
    });

    expect(actions.some((action) => action.title === "Inline variable")).toBe(false);
  });
  it("offers an introduce-constant code action when the cursor is on a literal", async () => {
    const classPath = "/workspace/app/Services/Greeter.php";
    const classSource = `<?php

namespace App\\Services;

class Greeter
{
    public function greet(): string
    {
        return 'Hello world';
    }
}
`;
    const { getWorkbench } = renderController({
      appSettings: workspaceAppSettings(),
      readTextFile: vi.fn(async (path: string) =>
        path === classPath ? classSource : `<?php\n// ${path}\n`,
      ),
      workspaceDescriptor: phpWorkspaceDescriptor(),
    });
    await flushAsyncTurns();
    await act(async () => {
      await getWorkbench().openFile(fileEntry(classPath, "Greeter.php"));
    });

    const offset = classSource.indexOf("'Hello world'") + 2;
    const actions = await getWorkbench().providePhpCodeActions(classSource, {
      end: offset,
      start: offset,
    });

    const introduce = actions.find((action) => action.title === "Introduce constant");
    expect(introduce).toBeDefined();
    expect(introduce?.edits).toHaveLength(2);
    const declaration = introduce?.edits.find((edit) =>
      edit.text.includes("private const HELLO_WORLD = 'Hello world';"),
    );
    expect(declaration).toBeDefined();
    const replacement = introduce?.edits.find((edit) => edit.text === "self::HELLO_WORLD");
    expect(replacement).toBeDefined();
  });
  it("offers an introduce-field code action when the cursor is on a literal", async () => {
    const classPath = "/workspace/app/Services/Greeter.php";
    const classSource = `<?php

namespace App\\Services;

class Greeter
{
    public function greet(): string
    {
        return 'Hello world';
    }
}
`;
    const { getWorkbench } = renderController({
      appSettings: workspaceAppSettings(),
      readTextFile: vi.fn(async (path: string) =>
        path === classPath ? classSource : `<?php\n// ${path}\n`,
      ),
      workspaceDescriptor: phpWorkspaceDescriptor(),
    });
    await flushAsyncTurns();
    await act(async () => {
      await getWorkbench().openFile(fileEntry(classPath, "Greeter.php"));
    });

    const offset = classSource.indexOf("'Hello world'") + 2;
    const actions = await getWorkbench().providePhpCodeActions(classSource, {
      end: offset,
      start: offset,
    });

    const introduce = actions.find((action) => action.title === "Introduce field");
    expect(introduce).toBeDefined();
    expect(introduce?.edits).toHaveLength(2);
    const declaration = introduce?.edits.find((edit) =>
      edit.text.includes("private string $helloWorld = 'Hello world';"),
    );
    expect(declaration).toBeDefined();
    const replacement = introduce?.edits.find((edit) => edit.text === "$this->helloWorld");
    expect(replacement).toBeDefined();
  });
  it("offers no introduce-constant or introduce-field action outside a class", async () => {
    const filePath = "/workspace/script.php";
    const fileSource = `<?php

$greeting = 'Hello world';
`;
    const { getWorkbench } = renderController({
      appSettings: workspaceAppSettings(),
      readTextFile: vi.fn(async (path: string) =>
        path === filePath ? fileSource : `<?php\n// ${path}\n`,
      ),
      workspaceDescriptor: phpWorkspaceDescriptor(),
    });
    await flushAsyncTurns();
    await act(async () => {
      await getWorkbench().openFile(fileEntry(filePath, "script.php"));
    });

    const offset = fileSource.indexOf("'Hello world'") + 2;
    const actions = await getWorkbench().providePhpCodeActions(fileSource, {
      end: offset,
      start: offset,
    });

    expect(
      actions.some(
        (action) => action.title === "Introduce constant" || action.title === "Introduce field",
      ),
    ).toBe(false);
  });
  it("offers an extract-method code action for a whole-statement selection", async () => {
    const classPath = "/workspace/app/Services/Greeter.php";
    const classSource = `<?php

namespace App\\Services;

class Greeter
{
    public function run(int $seed): void
    {
        $base = $seed * 2;
        $total = $base + 10;
        echo $total;
    }
}
`;
    const { getWorkbench } = renderController({
      appSettings: workspaceAppSettings(),
      readTextFile: vi.fn(async (path: string) =>
        path === classPath ? classSource : `<?php\n// ${path}\n`,
      ),
      workspaceDescriptor: phpWorkspaceDescriptor(),
    });
    await flushAsyncTurns();
    await act(async () => {
      await getWorkbench().openFile(fileEntry(classPath, "Greeter.php"));
    });

    const start = classSource.lastIndexOf("\n", classSource.indexOf("$total = $base")) + 1;
    const end = classSource.indexOf("\n", classSource.indexOf("echo $total;"));
    const actions = await getWorkbench().providePhpCodeActions(classSource, {
      end,
      start,
    });

    const extract = actions.find((action) => action.title === "Extract method");
    expect(extract).toBeDefined();
    expect(extract?.kind).toBe("refactor.extract");
    expect(extract?.edits).toHaveLength(2);

    const applied = applyPhpDescriptorEdits(classSource, extract!);
    expect(applied).toContain("$this->extracted($base);");
    expect(applied).toContain("private function extracted($base): void");
    expect(applied).toContain("$total = $base + 10;");
    expectBalancedPhp(applied);
  });
  it("offers no extract-method action when the selection is empty", async () => {
    const classPath = "/workspace/app/Services/Greeter.php";
    const classSource = `<?php

namespace App\\Services;

class Greeter
{
    public function run(): void
    {
        $a = 1;
        echo $a;
    }
}
`;
    const { getWorkbench } = renderController({
      appSettings: workspaceAppSettings(),
      readTextFile: vi.fn(async (path: string) =>
        path === classPath ? classSource : `<?php\n// ${path}\n`,
      ),
      workspaceDescriptor: phpWorkspaceDescriptor(),
    });
    await flushAsyncTurns();
    await act(async () => {
      await getWorkbench().openFile(fileEntry(classPath, "Greeter.php"));
    });

    const offset = classSource.indexOf("$a = 1;");
    const actions = await getWorkbench().providePhpCodeActions(classSource, {
      end: offset,
      start: offset,
    });

    expect(actions.some((action) => action.title === "Extract method")).toBe(false);
  });
  it("offers no extract-method action outside a class (free function)", async () => {
    const classPath = "/workspace/app/helpers.php";
    const classSource = `<?php

function run(): void
{
    $a = 1;
    echo $a;
}
`;
    const { getWorkbench } = renderController({
      appSettings: workspaceAppSettings(),
      readTextFile: vi.fn(async (path: string) =>
        path === classPath ? classSource : `<?php\n// ${path}\n`,
      ),
      workspaceDescriptor: phpWorkspaceDescriptor(),
    });
    await flushAsyncTurns();
    await act(async () => {
      await getWorkbench().openFile(fileEntry(classPath, "helpers.php"));
    });

    const start = classSource.indexOf("    $a = 1;");
    const end = classSource.indexOf("\n", classSource.indexOf("echo $a;"));
    const actions = await getWorkbench().providePhpCodeActions(classSource, {
      end,
      start,
    });

    expect(actions.some((action) => action.title === "Extract method")).toBe(false);
  });
  it("offers no extract-method action when more than one variable must be returned", async () => {
    const classPath = "/workspace/app/Services/Calculator.php";
    const classSource = `<?php

namespace App\\Services;

class Calculator
{
    public function run(): int
    {
        $a = 1;
        $b = 2;
        return $a + $b;
    }
}
`;
    const { getWorkbench } = renderController({
      appSettings: workspaceAppSettings(),
      readTextFile: vi.fn(async (path: string) =>
        path === classPath ? classSource : `<?php\n// ${path}\n`,
      ),
      workspaceDescriptor: phpWorkspaceDescriptor(),
    });
    await flushAsyncTurns();
    await act(async () => {
      await getWorkbench().openFile(fileEntry(classPath, "Calculator.php"));
    });

    const start = classSource.lastIndexOf("\n", classSource.indexOf("$a = 1;")) + 1;
    const end = classSource.indexOf("\n", classSource.indexOf("$b = 2;"));
    const actions = await getWorkbench().providePhpCodeActions(classSource, {
      end,
      start,
    });

    expect(actions.some((action) => action.title === "Extract method")).toBe(false);
  });
  it.each([
    {
      name: "selection cutting an if/else boundary",
      from: "echo 'positive';",
      to: "} else {",
      source: `<?php

class Greeter
{
    public function run(int $x): void
    {
        if ($x > 0) {
            echo 'positive';
        } else {
            echo 'other';
        }
    }
}
`,
    },
    {
      name: "selection containing a break inside a loop",
      from: "$double = $item * 2;",
      to: "break;",
      source: `<?php

class Greeter
{
    public function run(array $items): void
    {
        foreach ($items as $item) {
            $double = $item * 2;
            break;
        }
    }
}
`,
    },
    {
      name: "selection containing a closure with use()",
      from: "$fn = function",
      to: "};",
      source: `<?php

class Greeter
{
    public function run(): void
    {
        $factor = 2;
        $fn = function ($x) use ($factor) {
            return $x * $factor;
        };
        echo $fn(3);
    }
}
`,
    },
  ])("extract-method adversarial sweep never corrupts: $name", async ({ source, from, to }) => {
    const classPath = "/workspace/app/Services/Edge.php";
    const { getWorkbench } = renderController({
      appSettings: workspaceAppSettings(),
      readTextFile: vi.fn(async (path: string) =>
        path === classPath ? source : `<?php\n// ${path}\n`,
      ),
      workspaceDescriptor: phpWorkspaceDescriptor(),
    });
    await flushAsyncTurns();
    await act(async () => {
      await getWorkbench().openFile(fileEntry(classPath, "Edge.php"));
    });

    const start = source.lastIndexOf("\n", source.indexOf(from)) + 1;
    const toEnd = source.indexOf(to) + to.length;
    const end = source.indexOf("\n", toEnd);
    const actions = await getWorkbench().providePhpCodeActions(source, {
      end: end < 0 ? source.length : end,
      start,
    });

    const extract = actions.find((action) => action.title === "Extract method");

    // Either the action is withheld (conservative no-op) or, if offered, the
    // applied edits keep the file syntactically balanced - never corruption.
    if (!extract) {
      return;
    }

    const applied = applyPhpDescriptorEdits(source, extract);
    expectBalancedPhp(applied);
  });
  it("drops stale introduce-constant code actions after switching project tabs", async () => {
    const classPath = "/workspace-a/app/Services/Greeter.php";
    const interfacePath = "/workspace-a/app/Contracts/GreeterContract.php";
    const classSource = `<?php

namespace App\\Services;

use App\\Contracts\\GreeterContract;

class Greeter implements GreeterContract
{
    public function greet(): string
    {
        return 'Hello world';
    }
}
`;
    const interfaceRead = createDeferred<string>();
    const readTextFile = vi.fn(async (path: string) => {
      if (path === classPath) {
        return classSource;
      }

      if (path === interfacePath) {
        return interfaceRead.promise;
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
      await getWorkbench().openFile(fileEntry(classPath, "Greeter.php"));
    });

    const offset = classSource.indexOf("'Hello world'") + 2;
    let actionsPromise: ReturnType<WorkbenchController["providePhpCodeActions"]> | null = null;
    await act(async () => {
      actionsPromise = getWorkbench().providePhpCodeActions(classSource, {
        end: offset,
        start: offset,
      });
      await Promise.resolve();
    });
    await waitForReact(() => {
      expect(readTextFile).toHaveBeenCalledWith(interfacePath);
    });

    await act(async () => {
      await getWorkbench().activateWorkspaceTab("/workspace-b");
    });
    await flushAsyncTurns();

    interfaceRead.resolve(`<?php

namespace App\\Contracts;

interface GreeterContract
{
    public function greet(): string;
}
`);

    expect(actionsPromise).not.toBeNull();
    await expect(actionsPromise).resolves.toEqual([]);
  });
});
