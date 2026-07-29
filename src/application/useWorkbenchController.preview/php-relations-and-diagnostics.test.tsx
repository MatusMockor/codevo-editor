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
  lineNumberOf,
  phpactorLanguageServerPlan,
  phpWorkspaceDescriptor,
  positionAfter,
  setupWorkbenchControllerTestHarness,
  type TextSearchResult,
  vi,
  waitForReact,
  type WorkbenchController,
} from "./testSupport";

describe("useWorkbenchController PHP language intelligence", () => {
  const { renderController } = setupWorkbenchControllerTestHarness();
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
      appSettings: workspaceAppSettings(),
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
      appSettings: workspaceAppSettings(),
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
      appSettings: workspaceAppSettings(),
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
      appSettings: workspaceAppSettings(),
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
      appSettings: workspaceAppSettings(),
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
      appSettings: workspaceAppSettings(),
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
      appSettings: workspaceAppSettings(),
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
      appSettings: workspaceAppSettings(),
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
      appSettings: workspaceAppSettings(),
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
      appSettings: workspaceAppSettings(),
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
      appSettings: workspaceAppSettings(),
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
      appSettings: workspaceAppSettings(),
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
      appSettings: workspaceAppSettings(),
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
      appSettings: workspaceAppSettings(),
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
      appSettings: workspaceAppSettings(),
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
      appSettings: workspaceAppSettings(),
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
      appSettings: workspaceAppSettings(),
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
      appSettings: workspaceAppSettings(),
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
      appSettings: workspaceAppSettings(),
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
      appSettings: workspaceAppSettings(),
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
      appSettings: workspaceAppSettings(),
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
      appSettings: workspaceAppSettings(),
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
      appSettings: workspaceAppSettings(),
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
      appSettings: workspaceAppSettings(),
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
      appSettings: workspaceAppSettings(),
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
      appSettings: workspaceAppSettings(),
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
});
