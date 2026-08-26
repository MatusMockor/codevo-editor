// @vitest-environment jsdom

import {
  workspaceAppSettings,
  act,
  createDeferred,
  defaultAppSettings,
  describe,
  emptyLanguageServerCapabilities,
  expect,
  featuresGateway,
  fileEntry,
  type FileSearchResult,
  fileUriFromPath,
  flushAsyncTurns as flushControllerTurns,
  it,
  type LanguageServerDiagnosticEvent,
  type LanguageServerDiagnosticsGateway,
  type LanguageServerRuntimeStatus,
  lineNumberOf,
  phpWorkspaceDescriptor,
  positionAfter,
  type ProjectSymbolSearchResult,
  vi,
  waitForReact as waitForController,
  type WorkbenchController,
  defaultWorkspaceSettings,
  type ProjectSymbolSearchGateway,
  type WorkbenchWorkspaceGateways,
  type WorkspaceFileChangeEvent,
} from "./testSupport";
import { setupRegisteredWorkbenchControllerTestHarness } from "../../test/workbenchRegisteredAuthorityTestFixtures";

const pendingWorkspaceAdmissions: Array<() => Promise<void>> = [];

async function drainWorkspaceAdmissions() {
  while (pendingWorkspaceAdmissions.length > 0) await pendingWorkspaceAdmissions.shift()?.();
}

async function flushAsyncTurns(turns?: number) {
  await flushControllerTurns(turns);
  await drainWorkspaceAdmissions();
  await flushControllerTurns(turns);
}

async function waitForReact(assertion: () => void | Promise<void>) {
  await flushControllerTurns();
  await drainWorkspaceAdmissions();
  await waitForController(assertion);
}

function setupAdmittedWorkbenchControllerTestHarness() {
  const harness = setupRegisteredWorkbenchControllerTestHarness();
  return {
    ...harness,
    renderController: (options: Parameters<typeof harness.renderController>[0] = {}) => {
      const rendered = harness.renderController(options);
      pendingWorkspaceAdmissions.push(rendered.drainAdmissions);
      return rendered;
    },
  };
}

describe("useWorkbenchController PHP language intelligence", () => {
  const { renderController } = setupAdmittedWorkbenchControllerTestHarness();
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
      appSettings: workspaceAppSettings(),
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
      appSettings: workspaceAppSettings(),
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
      appSettings: workspaceAppSettings(),
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
      appSettings: workspaceAppSettings(),
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
      appSettings: workspaceAppSettings(),
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
      appSettings: workspaceAppSettings(),
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
      appSettings: workspaceAppSettings(),
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
      appSettings: workspaceAppSettings(),
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
      appSettings: workspaceAppSettings(),
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
      appSettings: workspaceAppSettings(),
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
      appSettings: workspaceAppSettings(),
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

    expect(
      completions.filter((completion) => completion.name.toLowerCase().startsWith("scope")),
    ).toEqual([]);

    expect(byName("failed")).toHaveLength(1);
    expect(byName("inFlight")).toHaveLength(1);
    expect(byName("stale")).toHaveLength(1);

    expect(
      byName("status")
        .map((completion) => completion.kind)
        .sort(),
    ).toEqual(["property", "scope"]);

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
      appSettings: workspaceAppSettings(),
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
      appSettings: workspaceAppSettings(),
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
      appSettings: workspaceAppSettings(),
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

describe("useWorkbenchController PHP language intelligence", () => {
  const { renderController } = setupAdmittedWorkbenchControllerTestHarness();

  it("resolves a basic-mode method call instantly without a project-wide file search", async () => {
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
      appSettings: workspaceAppSettings(),
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
      appSettings: workspaceAppSettings(),
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
      appSettings: workspaceAppSettings(),
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
      appSettings: workspaceAppSettings(),
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
      appSettings: workspaceAppSettings(),
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
      appSettings: workspaceAppSettings(),
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
      appSettings: workspaceAppSettings(),
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

      await act(async () => {
        await completionNames(getWorkbench);
      });
      await waitForReact(() => {
        expect(readTextFile).toHaveBeenCalledWith(migrationPathFor(root));
      });

      const warm = await completionNames(getWorkbench);

      expect(warm).toEqual(expect.arrayContaining(["user_id", "account_id", "usage_count"]));
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
      appSettings: workspaceAppSettings(),
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
      appSettings: workspaceAppSettings(),
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
      appSettings: workspaceAppSettings(),
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
      appSettings: workspaceAppSettings(),
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
      appSettings: workspaceAppSettings(),
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
      appSettings: workspaceAppSettings(),
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
      appSettings: workspaceAppSettings(),
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
});
