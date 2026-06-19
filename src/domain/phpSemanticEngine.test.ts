import { describe, expect, it } from "vitest";
import {
  phpAssignmentExpressionForVariableBefore,
  phpClassStringCallExpression,
  phpCurrentClassName,
  phpDocGenericInheritances,
  phpDocGenericMixins,
  phpDocTemplateNames,
  phpDocRawTypeForVariableBefore,
  phpFunctionReturnsClassStringArgument,
  phpLaravelContainerBindingsFromSource,
  phpLaravelContainerExpressionClassName,
  phpLaravelQueryCallbackContextForVariable,
  phpMethodCallExpression,
  phpNewExpressionClassName,
  phpPropertyAccessExpression,
  phpReceiverExpressionTypeInSource,
  phpStaticCallExpression,
  phpThisPropertyType,
  phpVariableTypeInSource,
} from "./phpSemanticEngine";
import {
  phpDeclaredGenericTypeCandidates,
  phpDeclaredTypeCandidate,
  phpMethodReturnExpressions,
} from "./phpTypeAnalysis";
import { phpLaravelFrameworkProvider } from "./phpFrameworkProviders";

const laravelOptions = {
  frameworkProviders: [phpLaravelFrameworkProvider],
};

function positionAfter(source: string, needle: string) {
  const offset = source.indexOf(needle);

  if (offset < 0) {
    throw new Error(`Missing test needle: ${needle}`);
  }

  const before = source.slice(0, offset + needle.length);
  const lines = before.split("\n");
  const lastLine = lines[lines.length - 1] ?? "";

  return {
    column: lastLine.length + 1,
    lineNumber: lines.length,
  };
}

describe("phpSemanticEngine", () => {
  const source = `<?php
namespace App\\Http\\Controllers;

use App\\Services\\CommentService;
use App\\Repositories\\CommentRepository;

class CommentController
{
    /** @var CommentRepository */
    private $legacyRepository;

    public function __construct(
        private readonly CommentService $commentService,
    ) {}

    public function store(): void
    {
        /** @var CommentRepository $repository */
        $repository = app(CommentRepository::class);
        $agent = new CommentService();
        $comment = $this->commentService->create();

        $agent->cre
    }
}
`;

  it("builds basic class and property symbols", () => {
    expect(phpCurrentClassName(source)).toBe(
      "App\\Http\\Controllers\\CommentController",
    );
    expect(phpThisPropertyType(source, "commentService")).toBe("CommentService");
    expect(phpThisPropertyType(source, "legacyRepository")).toBe(
      "CommentRepository",
    );
  });

  it("resolves receiver expressions from scope symbols", () => {
    expect(
      phpReceiverExpressionTypeInSource(source, { column: 20, lineNumber: 22 }, "$this"),
    ).toBe("App\\Http\\Controllers\\CommentController");
    expect(
      phpReceiverExpressionTypeInSource(
        source,
        { column: 20, lineNumber: 22 },
        "$this->commentService",
      ),
    ).toBe("CommentService");
    expect(
      phpVariableTypeInSource(source, { column: 20, lineNumber: 22 }, "repository"),
    ).toBe("CommentRepository");
    expect(
      phpVariableTypeInSource(source, { column: 20, lineNumber: 22 }, "agent"),
    ).toBe("CommentService");
  });

  it("resolves Laravel model cast attributes as property receiver types", () => {
    const source = `<?php
namespace App\\Models;

use App\\Enums\\CommentType;
use Illuminate\\Database\\Eloquent\\Model;

class Comment extends Model
{
    protected function casts(): array
    {
        return [
            'published_at' => 'datetime',
            'type' => CommentType::class,
            'metadata' => 'array',
        ];
    }

    public function publish(): void
    {
        $this->published_at->format('c');
    }
}
`;

    expect(phpThisPropertyType(source, "published_at", laravelOptions)).toBe(
      "Illuminate\\Support\\Carbon",
    );
    expect(phpThisPropertyType(source, "type", laravelOptions)).toBe(
      "App\\Enums\\CommentType",
    );
    expect(phpThisPropertyType(source, "metadata", laravelOptions)).toBeNull();
    expect(
      phpReceiverExpressionTypeInSource(
        source,
        positionAfter(source, "$this->published_at"),
        "$this->published_at",
        laravelOptions,
      ),
    ).toBe("Illuminate\\Support\\Carbon");
  });

  it("does not resolve Laravel model cast attributes without an active Laravel provider", () => {
    const source = `<?php
namespace App\\Models;

use App\\Enums\\CommentType;
use Illuminate\\Database\\Eloquent\\Model;

class Comment extends Model
{
    protected function casts(): array
    {
        return [
            'type' => CommentType::class,
        ];
    }

    public function publish(): void
    {
        $this->type->value;
    }
}
`;

    expect(phpThisPropertyType(source, "type")).toBeNull();
    expect(
      phpReceiverExpressionTypeInSource(
        source,
        positionAfter(source, "$this->type"),
        "$this->type",
      ),
    ).toBeNull();
  });

  it("resolves Laravel repository finder assignments from model return types", () => {
    const source = `<?php
namespace App\\Repositories;

use App\\Models\\Album;

class AlbumRepository
{
    public function findOrFail(int $id): Album
    {
    }

    public function show(int $id): void
    {
        $album = $this->findOrFail($id);

        $album->tit
    }
}
`;

    expect(
      phpVariableTypeInSource(
        source,
        positionAfter(source, "$album->tit"),
        "album",
        laravelOptions,
      ),
    ).toBe("App\\Models\\Album");
    expect(
      phpReceiverExpressionTypeInSource(
        source,
        positionAfter(source, "$album->tit"),
        "$album",
        laravelOptions,
      ),
    ).toBe("App\\Models\\Album");
  });

  it("resolves Laravel repository finder assignments from PHPDoc methods", () => {
    const source = `<?php
namespace App\\Repositories;

use App\\Models\\Album;

/**
 * @method Album findOrFail(int $id)
 */
class AlbumRepository
{
    public function show(int $id): void
    {
        $album = $this->findOrFail($id);

        $album->tit
    }
}
`;

    expect(
      phpVariableTypeInSource(
        source,
        positionAfter(source, "$album->tit"),
        "album",
        laravelOptions,
      ),
    ).toBe("App\\Models\\Album");
  });

  it("resolves Laravel repository creation-helper assignments from declared interface return types", () => {
    const source = `<?php
namespace App\\Repositories;

use App\\Models\\Album;

interface AlbumRepository
{
    public function firstOrCreate(array $attributes): Album;
    public function firstOrNew(array $attributes): Album;
    public function updateOrCreate(array $attributes, array $values): Album;
}

class AlbumService
{
    public function __construct(private AlbumRepository $albums)
    {
    }

    public function store(): void
    {
        $created = $this->albums->firstOrCreate(['slug' => 'kind-of-blue']);
        $new = $this->albums->firstOrNew(['slug' => 'blue-train']);
        $updated = $this->albums->updateOrCreate(['slug' => 'giant-steps'], ['title' => 'Giant Steps']);

        $created->tit
        $new->tit
        $updated->tit
    }
}
`;

    expect(
      phpVariableTypeInSource(
        source,
        positionAfter(source, "$created->tit"),
        "created",
        laravelOptions,
      ),
    ).toBe("App\\Models\\Album");
    expect(
      phpVariableTypeInSource(
        source,
        positionAfter(source, "$new->tit"),
        "new",
        laravelOptions,
      ),
    ).toBe("App\\Models\\Album");
    expect(
      phpVariableTypeInSource(
        source,
        positionAfter(source, "$updated->tit"),
        "updated",
        laravelOptions,
      ),
    ).toBe("App\\Models\\Album");
  });

  it("resolves Laravel repository creation-helper assignments from PHPDoc methods", () => {
    const source = `<?php
namespace App\\Repositories;

use App\\Models\\Album;

/**
 * @method Album firstOrCreate(array $attributes)
 * @method Album firstOrNew(array $attributes)
 * @method Album updateOrCreate(array $attributes, array $values)
 */
class AlbumRepository
{
    public function store(): void
    {
        $created = $this->firstOrCreate(['slug' => 'kind-of-blue']);
        $new = $this->firstOrNew(['slug' => 'blue-train']);
        $updated = $this->updateOrCreate(['slug' => 'giant-steps'], ['title' => 'Giant Steps']);

        $created->tit
        $new->tit
        $updated->tit
    }
}
`;

    expect(
      phpVariableTypeInSource(
        source,
        positionAfter(source, "$created->tit"),
        "created",
        laravelOptions,
      ),
    ).toBe("App\\Models\\Album");
    expect(
      phpVariableTypeInSource(
        source,
        positionAfter(source, "$new->tit"),
        "new",
        laravelOptions,
      ),
    ).toBe("App\\Models\\Album");
    expect(
      phpVariableTypeInSource(
        source,
        positionAfter(source, "$updated->tit"),
        "updated",
        laravelOptions,
      ),
    ).toBe("App\\Models\\Album");
  });

  it("does not infer Laravel repository assignments without an active Laravel provider", () => {
    const source = `<?php
namespace App\\Repositories;

use App\\Models\\Album;

class AlbumRepository
{
    public function findOrFail(int $id): Album
    {
    }

    public function show(int $id): void
    {
        $album = $this->findOrFail($id);

        $album->tit
    }
}
`;

    expect(
      phpVariableTypeInSource(
        source,
        positionAfter(source, "$album->tit"),
        "album",
      ),
    ).toBeNull();
  });

  it("does not infer finder assignment model types from non-repository receivers", () => {
    const source = `<?php
namespace App\\Services;

use App\\Models\\Album;

class AlbumFinder
{
    public function findOrFail(int $id): Album
    {
    }

    public function show(int $id): void
    {
        $album = $this->findOrFail($id);

        $album->tit
    }
}
`;

    expect(
      phpVariableTypeInSource(
        source,
        positionAfter(source, "$album->tit"),
        "album",
      ),
    ).toBeNull();
  });

  it("extracts assignment expressions and expression types", () => {
    expect(
      phpAssignmentExpressionForVariableBefore(
        source,
        { column: 20, lineNumber: 22 },
        "agent",
      ),
    ).toBe("new CommentService()");
    expect(phpNewExpressionClassName("new CommentService()")).toBe(
      "CommentService",
    );
    expect(
      phpNewExpressionClassName("new UserAccountModel()->getConnection()"),
    ).toBeNull();
    expect(phpLaravelContainerExpressionClassName("app(CommentRepository::class)")).toBe(
      "CommentRepository",
    );
    expect(
      phpLaravelContainerExpressionClassName("resolve(CommentRepository::class)"),
    ).toBe("CommentRepository");
    expect(
      phpLaravelContainerExpressionClassName(
        "app()->make(CommentRepository::class)",
      ),
    ).toBe("CommentRepository");
    expect(
      phpLaravelContainerExpressionClassName(
        "App::make(CommentRepository::class)",
      ),
    ).toBe("CommentRepository");
    expect(
      phpLaravelContainerExpressionClassName(
        "Container::getInstance()->make(CommentRepository::class)",
      ),
    ).toBe("CommentRepository");
  });

  it("detects method and static call expressions", () => {
    expect(phpMethodCallExpression("$this->commentService->create()")).toEqual({
      methodName: "create",
      receiverExpression: "$this->commentService",
    });
    expect(
      phpMethodCallExpression("$this->userAccount->getDatabaseConnection()"),
    ).toEqual({
      methodName: "getDatabaseConnection",
      receiverExpression: "$this->userAccount",
    });
    expect(phpMethodCallExpression("new UserAccountModel()->getConnection()")).toEqual(
      {
        methodName: "getConnection",
        receiverExpression: "new UserAccountModel()",
      },
    );
    expect(
      phpMethodCallExpression("Album::query()->whereNull('parent_id')->first()"),
    ).toEqual({
      methodName: "first",
      receiverExpression: "Album::query()->whereNull('parent_id')",
    });
    expect(phpMethodCallExpression("app(CommentService::class)->create()")).toEqual(
      {
        methodName: "create",
        receiverExpression: "app(CommentService::class)",
      },
    );
    expect(
      phpMethodCallExpression("App::make(CommentService::class)->create()"),
    ).toEqual({
      methodName: "create",
      receiverExpression: "App::make(CommentService::class)",
    });
    expect(phpPropertyAccessExpression("$comment->parent")).toEqual({
      propertyName: "parent",
      receiverExpression: "$comment",
    });
    expect(
      phpPropertyAccessExpression("$comment->parent()->first()->author"),
    ).toEqual({
      propertyName: "author",
      receiverExpression: "$comment->parent()->first()",
    });
    expect(phpStaticCallExpression("CommentFactory::make()")).toEqual({
      className: "CommentFactory",
      methodName: "make",
    });
  });

  it("detects calls that pass class-string arguments", () => {
    expect(
      phpClassStringCallExpression("$this->container->get(CommentService::class)"),
    ).toEqual({
      argumentClassName: "CommentService",
      kind: "methodCall",
      methodName: "get",
      receiverExpression: "$this->container",
    });
    expect(
      phpClassStringCallExpression("ServiceLocator::get(CommentService::class)"),
    ).toEqual({
      argumentClassName: "CommentService",
      className: "ServiceLocator",
      kind: "staticCall",
      methodName: "get",
    });
    expect(phpClassStringCallExpression("service(CommentService::class)")).toEqual(
      {
        argumentClassName: "CommentService",
        functionName: "service",
        kind: "functionCall",
      },
    );
  });

  it("detects generic functions that return their class-string argument", () => {
    expect(
      phpFunctionReturnsClassStringArgument(
        `<?php
/**
 * @template T of object
 * @param class-string<T> $className
 * @return T
 */
function service(string $className): object {}
`,
        "service",
      ),
    ).toBe(true);
    expect(
      phpFunctionReturnsClassStringArgument(
        "<?php\n/** @return object */\nfunction service(string $className): object {}\n",
        "service",
      ),
    ).toBe(false);
  });

  it("detects Laravel query callback context for closure variables", () => {
    const source = `<?php
use App\\Models\\Album;

Album::query()->whereHas('tracks', function ($query): void {
    $query->ord
});

Album::whereHas(relation: 'artist', callback: function ($builder): void {
    $builder->ord
});

Album::query()->whereHas('tracks', fn ($arrowQuery) => $arrowQuery->ord);

Album::query()->whereHasMorph('commentable', [Post::class], function ($morphQuery): void {
    $morphQuery->ord
});

Album::whereDoesntHaveMorph(
    relation: 'authorable',
    types: [User::class],
    callback: fn ($namedMorphQuery) => $namedMorphQuery->ord,
);

Album::with(['tracks' => function ($eagerQuery): void {
    $eagerQuery->ord
}]);

Album::query()->with(['tracks.artist' => fn ($nestedQuery) => $nestedQuery->ord]);

Album::with(relations: ['tracks' => function ($namedEagerQuery): void {
    $namedEagerQuery->ord
}]);
`;

    expect(
      phpLaravelQueryCallbackContextForVariable(
        source,
        positionAfter(source, "$query->ord"),
        "query",
      ),
    ).toEqual({
      methodName: "whereHas",
      modelClassName: null,
      receiverExpression: "Album::query()",
      relationName: "tracks",
    });
    expect(
      phpLaravelQueryCallbackContextForVariable(
        source,
        positionAfter(source, "$morphQuery->ord"),
        "morphQuery",
      ),
    ).toEqual({
      methodName: "whereHasMorph",
      modelClassName: null,
      receiverExpression: "Album::query()",
      relationName: "commentable",
    });
    expect(
      phpLaravelQueryCallbackContextForVariable(
        source,
        positionAfter(source, "$namedMorphQuery->ord"),
        "namedMorphQuery",
      ),
    ).toEqual({
      methodName: "whereDoesntHaveMorph",
      modelClassName: "Album",
      receiverExpression: null,
      relationName: "authorable",
    });
    expect(
      phpLaravelQueryCallbackContextForVariable(
        source,
        positionAfter(source, "$builder->ord"),
        "builder",
      ),
    ).toEqual({
      methodName: "whereHas",
      modelClassName: "Album",
      receiverExpression: null,
      relationName: "artist",
    });
    expect(
      phpLaravelQueryCallbackContextForVariable(
        source,
        positionAfter(source, "$arrowQuery->ord"),
        "arrowQuery",
      ),
    ).toEqual({
      methodName: "whereHas",
      modelClassName: null,
      receiverExpression: "Album::query()",
      relationName: "tracks",
    });
    expect(
      phpLaravelQueryCallbackContextForVariable(
        source,
        positionAfter(source, "$eagerQuery->ord"),
        "eagerQuery",
      ),
    ).toEqual({
      methodName: "with",
      modelClassName: "Album",
      receiverExpression: null,
      relationName: "tracks",
    });
    expect(
      phpLaravelQueryCallbackContextForVariable(
        source,
        positionAfter(source, "$nestedQuery->ord"),
        "nestedQuery",
      ),
    ).toEqual({
      methodName: "with",
      modelClassName: null,
      receiverExpression: "Album::query()",
      relationName: "tracks",
    });
    expect(
      phpLaravelQueryCallbackContextForVariable(
        source,
        positionAfter(source, "$namedEagerQuery->ord"),
        "namedEagerQuery",
      ),
    ).toEqual({
      methodName: "with",
      modelClassName: "Album",
      receiverExpression: null,
      relationName: "tracks",
    });
  });

  it("extracts Laravel container bindings from service providers", () => {
    expect(
      phpLaravelContainerBindingsFromSource(`<?php
namespace App\\Providers;

use App\\Contracts\\CommentRepositoryInterface;
use App\\Repositories\\EloquentCommentRepository;
use App\\Contracts\\StatusRepositoryInterface;
use App\\Repositories\\DatabaseStatusRepository;
use App\\Contracts\\ReportRepositoryInterface;
use App\\Repositories\\CachedReportRepository;
use App\\Contracts\\WebhookRepositoryInterface;
use App\\Repositories\\DatabaseWebhookRepository;

class AppServiceProvider
{
    public function register(): void
    {
        $this->app->bind(CommentRepositoryInterface::class, EloquentCommentRepository::class);
        $this->app->singleton(StatusRepositoryInterface::class, DatabaseStatusRepository::class);
        app()->scoped(ReportRepositoryInterface::class, CachedReportRepository::class);
        $this->app->when(SendWebhookJob::class)
            ->needs(WebhookRepositoryInterface::class)
            ->give(DatabaseWebhookRepository::class);
    }
}
`),
    ).toEqual([
      {
        abstractClassName: "CommentRepositoryInterface",
        concreteClassName: "EloquentCommentRepository",
      },
      {
        abstractClassName: "StatusRepositoryInterface",
        concreteClassName: "DatabaseStatusRepository",
      },
      {
        abstractClassName: "ReportRepositoryInterface",
        concreteClassName: "CachedReportRepository",
      },
      {
        abstractClassName: "WebhookRepositoryInterface",
        concreteClassName: "DatabaseWebhookRepository",
      },
    ]);
  });

  it("normalizes generic PHPDoc type candidates", () => {
    expect(
      phpDeclaredTypeCandidate(
        "\\Illuminate\\Database\\Eloquent\\Builder<\\App\\Models\\Album>",
      ),
    ).toBe("Illuminate\\Database\\Eloquent\\Builder");
    expect(
      phpDeclaredGenericTypeCandidates(
        "\\Illuminate\\Database\\Eloquent\\Builder<\\App\\Models\\Album>",
      ),
    ).toEqual(["App\\Models\\Album"]);
    expect(phpDeclaredTypeCandidate("array<int, \\App\\Models\\Album>")).toBe(
      "App\\Models\\Album",
    );
  });

  it("extracts PHPDoc template inheritance declarations", () => {
    const source = `<?php
namespace App\\Repositories;

use App\\Models\\Comment;

/**
 * @template TModel of object
 * @phpstan-template TKey of array-key
 * @phpstan-extends BaseRepository<Comment>
 * @psalm-implements SearchRepository<int, Comment>
 * @template-use FindsModels<Comment>
 */
class CommentRepository extends BaseRepository implements SearchRepository
{
}
`;

    expect(phpDocTemplateNames(source)).toEqual(["TModel", "TKey"]);
    expect(phpDocGenericInheritances(source)).toEqual([
      {
        className: "BaseRepository",
        genericTypes: ["Comment"],
      },
      {
        className: "SearchRepository",
        genericTypes: ["Comment"],
      },
      {
        className: "FindsModels",
        genericTypes: ["Comment"],
      },
    ]);
  });

  it("extracts PHPDoc generic mixin declarations", () => {
    const source = `<?php
namespace App\\Models;

use App\\Support\\IdeHelper;
use App\\Models\\Comment;

/**
 * @mixin IdeHelper<Comment>
 * @mixin \\Illuminate\\Database\\Eloquent\\Builder<Comment>
 */
class CommentModel
{
}
`;

    expect(phpDocGenericMixins(source)).toEqual([
      {
        className: "IdeHelper",
        genericTypes: ["Comment"],
      },
      {
        className: "Illuminate\\Database\\Eloquent\\Builder",
        genericTypes: ["Comment"],
      },
    ]);
  });

  it("keeps spaced PHPDoc generic @var types intact", () => {
    const source = `<?php
/** @var \\Illuminate\\Database\\Eloquent\\Collection<int, \\App\\Models\\Album> $albums */
$album = $albums->first();
`;
    const rawType = phpDocRawTypeForVariableBefore(
      source,
      { column: 10, lineNumber: 3 },
      "albums",
    );

    expect(rawType).toBe(
      "\\Illuminate\\Database\\Eloquent\\Collection<int, \\App\\Models\\Album>",
    );
    expect(phpDeclaredGenericTypeCandidates(rawType ?? "")).toEqual([
      "App\\Models\\Album",
    ]);
  });

  it("extracts method return expressions from concrete method bodies", () => {
    expect(
      phpMethodReturnExpressions(
        `<?php
class UserAccount
{
    public function getDatabaseConnection()
    {
        if (! $this->isValid()) {
            return null;
        }

        return new UserAccountModel()->getConnection();
    }
}
`,
        "getDatabaseConnection",
      ),
    ).toEqual(["new UserAccountModel()->getConnection()"]);
  });
});
