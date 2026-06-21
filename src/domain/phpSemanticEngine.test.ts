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
import {
  phpLaravelFrameworkProvider,
  type PhpFrameworkProvider,
} from "./phpFrameworkProviders";

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

  it("resolves semantic types through framework provider hooks", () => {
    const semanticProvider: PhpFrameworkProvider = {
      id: "semantic-test",
      semantics: {
        propertyTypeFromSource: ({ propertyName }) =>
          propertyName === "publishedAt" ? "DateTimeImmutable" : null,
        methodCallReturnTypeFromSource: ({ methodName, receiverType }) =>
          methodName === "fetchPublished" && receiverType === "PostRepository"
            ? "Domain\\Post"
            : null,
      },
    };
    const options = { frameworkProviders: [semanticProvider] };
    const source = `<?php
namespace App\\Http;

class Controller
{
    public function __construct(private PostRepository $posts)
    {
    }

    public function show(): void
    {
        $post = $this->posts->fetchPublished();

        $post->tit
        $this->publishedAt->format('c');
    }
}
`;

    expect(
      phpVariableTypeInSource(
        source,
        positionAfter(source, "$post->tit"),
        "post",
        options,
      ),
    ).toBe("Domain\\Post");
    expect(
      phpReceiverExpressionTypeInSource(
        source,
        positionAfter(source, "$this->publishedAt"),
        "$this->publishedAt",
        options,
      ),
    ).toBe("DateTimeImmutable");
  });

  it("resolves nullsafe member calls through framework provider hooks", () => {
    const semanticProvider: PhpFrameworkProvider = {
      id: "nullsafe-semantic-test",
      semantics: {
        methodCallReturnTypeFromSource: ({ methodName, receiverType }) =>
          methodName === "fetchPublished" && receiverType === "PostRepository"
            ? "Domain\\Post"
            : null,
      },
    };
    const options = { frameworkProviders: [semanticProvider] };
    const source = `<?php
namespace App\\Http;

class Controller
{
    public function __construct(private PostRepository $posts)
    {
    }

    public function show(): void
    {
        $post = $this?->posts?->fetchPublished();

        $post->tit
    }
}
`;

    expect(
      phpReceiverExpressionTypeInSource(
        source,
        positionAfter(source, "$post->tit"),
        "$this?->posts",
        options,
      ),
    ).toBe("PostRepository");
    expect(
      phpVariableTypeInSource(
        source,
        positionAfter(source, "$post->tit"),
        "post",
        options,
      ),
    ).toBe("Domain\\Post");
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

  it("resolves Laravel repository finder assignments from injected repository conventions", () => {
    const source = `<?php
namespace App\\Http\\Controllers;

use App\\Repositories\\AlbumRepositoryInterface;

class AlbumController
{
    public function __construct(private AlbumRepositoryInterface $albums)
    {
    }

    public function show(int $id): void
    {
        $album = $this->albums->findOrFail($id);

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
      phpVariableTypeInSource(
        source,
        positionAfter(source, "$album->tit"),
        "album",
      ),
    ).toBeNull();
  });

  it("resolves Laravel repository convention models in package namespaces", () => {
    const source = `<?php
namespace Kontentino\\Communication\\Http\\Controllers;

use Kontentino\\Communication\\Interfaces\\CommentRepositoryInterface;

class CommentController
{
    public function __construct(private CommentRepositoryInterface $comments)
    {
    }

    public function getOne(int $id): void
    {
        $comment = $this->comments->findOrFail($id);

        $comment->loa
    }
}
`;

    expect(
      phpVariableTypeInSource(
        source,
        positionAfter(source, "$comment->loa"),
        "comment",
        laravelOptions,
      ),
    ).toBe("Kontentino\\Communication\\Models\\Comment");
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

  it("resolves Laravel model assignments from Eloquent builder chains", () => {
    const source = `<?php
namespace App\\Http\\Controllers;

use App\\Models\\Album;
use App\\Models\\Post;

class AlbumController
{
    public function show(): void
    {
        $album = Album::query()
            ->whereNull('parent_id')
            ->firstOrFail();
        $morphAlbum = Album::query()
            ->whereHasMorph('commentable', [Post::class])
            ->first();
        $withWhereHasAlbum = Album::query()
            ->withWhereHas('tracks', fn ($trackQuery) => $trackQuery->where('visible', true))
            ->first();
        $fromEagerHelpers = Album::query()
            ->withOnly('tracks')
            ->withCasts(['released_at' => 'datetime'])
            ->first();
        $fromScopeHelpers = Album::query()
            ->withoutGlobalScopes()
            ->scopes(['popular'])
            ->applyScopes()
            ->first();
        $fromRelationHelpers = Album::query()
            ->withWhereRelation('tracks', 'visible', true)
            ->whereDoesntHaveRelation('tracks', 'visible', true)
            ->orWhereMorphDoesntHaveRelation('commentable', [Post::class], 'visible', true)
            ->first();
        $fromAttachedHelper = Album::query()
            ->whereAttachedTo(new Album())
            ->first();
        $summedAlbum = Album::query()
            ->withSum('tracks', 'duration')
            ->first();
        $lazySummedAlbum = Album::query()
            ->first()
            ->loadSum('tracks', 'duration');
        $fromLoadedCollection = Album::query()
            ->get()
            ->loadSum('tracks', 'duration')
            ->first();
        $foundOr = Album::query()
            ->findOr(1, fn () => null);
        $fromFindMany = Album::query()
            ->findMany([1, 2])
            ->first();
        $foundOrNew = Album::query()
            ->findOrNew(1);
        $foundSole = Album::query()
            ->findSole(1);
        $fromCreateOrFirst = Album::query()
            ->createOrFirst(['title' => 'Blue']);
        $fromCreateOrRestore = Album::query()
            ->createOrRestore(['title' => 'Blue']);
        $fromRestoreOrCreate = Album::query()
            ->restoreOrCreate(['title' => 'Blue']);
        $fromIncrementOrCreate = Album::query()
            ->incrementOrCreate(['title' => 'Blue']);
        $fromGetModel = Album::query()
            ->getModel();
        $fromNewModelInstance = Album::query()
            ->newModelInstance(['title' => 'Blue']);
        $query = Album::query()->whereKey(1);
        $latest = $query->first();
        $afterValueTerminal = Album::query()
            ->value('title')
            ->first();
        $afterSoleValueTerminal = Album::query()
            ->soleValue('title')
            ->first();
        $afterValueOrFailTerminal = Album::query()
            ->valueOrFail('title')
            ->first();
        $afterSumTerminal = Album::query()
            ->sum('plays')
            ->first();
        $afterAvgTerminal = Album::query()
            ->avg('plays')
            ->first();
        $afterAverageTerminal = Album::query()
            ->average('plays')
            ->first();
        $afterMinTerminal = Album::query()
            ->min('plays')
            ->first();
        $afterMaxTerminal = Album::query()
            ->max('plays')
            ->first();
        $afterAggregateTerminal = Album::query()
            ->aggregate('max', ['plays'])
            ->first();
        $afterNumericAggregateTerminal = Album::query()
            ->numericAggregate('avg', ['plays'])
            ->first();
        $afterRawValueTerminal = Album::query()
            ->rawValue('count(*)')
            ->first();
        $afterExistsOrTerminal = Album::query()
            ->existsOr(fn () => false)
            ->first();
        $afterDoesntExistOrTerminal = Album::query()
            ->doesntExistOr(fn () => false)
            ->first();
        $afterImplodeTerminal = Album::query()
            ->implode('title', ',')
            ->first();
        $afterUpdateTerminal = Album::query()
            ->update(['title' => 'Blue'])
            ->first();
        $afterDeleteTerminal = Album::query()
            ->delete()
            ->first();
        $afterIncrementTerminal = Album::query()
            ->increment('plays')
            ->first();
        $afterChunkByIdTerminal = Album::query()
            ->chunkById(100, fn () => true)
            ->first();
        $afterCursorPaginateTerminal = Album::query()
            ->cursorPaginate(15)
            ->first();
        $afterGetModelsTerminal = Album::query()
            ->getModels()
            ->first();
        $afterToBaseTerminal = Album::query()
            ->toBase()
            ->first();
        $afterQualifyColumnTerminal = Album::query()
            ->qualifyColumn('title')
            ->first();
        $afterGetRelationTerminal = Album::query()
            ->getRelation('tracks')
            ->first();
        $afterFillInsertTerminal = Album::query()
            ->fillAndInsertGetId(['title' => 'Blue'])
            ->first();
        $afterInsertGetIdTerminal = Album::query()
            ->insertGetId(['title' => 'Blue'])
            ->first();
        $afterInsertOrIgnoreTerminal = Album::query()
            ->insertOrIgnore(['title' => 'Blue'])
            ->first();
        $afterInsertOrIgnoreReturningTerminal = Album::query()
            ->insertOrIgnoreReturning(['title' => 'Blue'])
            ->first();
        $afterInsertUsingTerminal = Album::query()
            ->insertUsing(['title'], Album::query()->select('title'))
            ->first();
        $afterInsertOrIgnoreUsingTerminal = Album::query()
            ->insertOrIgnoreUsing(['title'], Album::query()->select('title'))
            ->first();
        $afterUpdateOrInsertTerminal = Album::query()
            ->updateOrInsert(['id' => 1], ['title' => 'Blue'])
            ->first();
        $afterUpdateFromTerminal = Album::query()
            ->updateFrom(['title' => 'Blue'])
            ->first();
        $afterTruncateTerminal = Album::query()
            ->truncate()
            ->first();

        $album->tit
        $morphAlbum->tit
        $withWhereHasAlbum->tit
        $fromEagerHelpers->tit
        $fromScopeHelpers->tit
        $fromRelationHelpers->tit
        $fromAttachedHelper->tit
        $summedAlbum->tit
        $lazySummedAlbum->tit
        $fromLoadedCollection->tit
        $foundOr->tit
        $fromFindMany->tit
        $foundOrNew->tit
        $foundSole->tit
        $fromCreateOrFirst->tit
        $fromCreateOrRestore->tit
        $fromRestoreOrCreate->tit
        $fromIncrementOrCreate->tit
        $fromGetModel->tit
        $fromNewModelInstance->tit
        $query->whe
        $latest->tit
        $afterValueTerminal->tit
        $afterSoleValueTerminal->tit
        $afterValueOrFailTerminal->tit
        $afterSumTerminal->tit
        $afterAvgTerminal->tit
        $afterAverageTerminal->tit
        $afterMinTerminal->tit
        $afterMaxTerminal->tit
        $afterAggregateTerminal->tit
        $afterNumericAggregateTerminal->tit
        $afterRawValueTerminal->tit
        $afterExistsOrTerminal->tit
        $afterDoesntExistOrTerminal->tit
        $afterImplodeTerminal->tit
        $afterUpdateTerminal->tit
        $afterDeleteTerminal->tit
        $afterIncrementTerminal->tit
        $afterChunkByIdTerminal->tit
        $afterCursorPaginateTerminal->tit
        $afterGetModelsTerminal->tit
        $afterToBaseTerminal->tit
        $afterQualifyColumnTerminal->tit
        $afterGetRelationTerminal->tit
        $afterFillInsertTerminal->tit
        $afterInsertGetIdTerminal->tit
        $afterInsertOrIgnoreTerminal->tit
        $afterInsertOrIgnoreReturningTerminal->tit
        $afterInsertUsingTerminal->tit
        $afterInsertOrIgnoreUsingTerminal->tit
        $afterUpdateOrInsertTerminal->tit
        $afterUpdateFromTerminal->tit
        $afterTruncateTerminal->tit
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
      phpVariableTypeInSource(
        source,
        positionAfter(source, "$morphAlbum->tit"),
        "morphAlbum",
        laravelOptions,
      ),
    ).toBe("App\\Models\\Album");
    expect(
      phpVariableTypeInSource(
        source,
        positionAfter(source, "$withWhereHasAlbum->tit"),
        "withWhereHasAlbum",
        laravelOptions,
      ),
    ).toBe("App\\Models\\Album");
    expect(
      phpVariableTypeInSource(
        source,
        positionAfter(source, "$fromEagerHelpers->tit"),
        "fromEagerHelpers",
        laravelOptions,
      ),
    ).toBe("App\\Models\\Album");
    expect(
      phpVariableTypeInSource(
        source,
        positionAfter(source, "$fromScopeHelpers->tit"),
        "fromScopeHelpers",
        laravelOptions,
      ),
    ).toBe("App\\Models\\Album");
    expect(
      phpVariableTypeInSource(
        source,
        positionAfter(source, "$fromRelationHelpers->tit"),
        "fromRelationHelpers",
        laravelOptions,
      ),
    ).toBe("App\\Models\\Album");
    expect(
      phpVariableTypeInSource(
        source,
        positionAfter(source, "$fromAttachedHelper->tit"),
        "fromAttachedHelper",
        laravelOptions,
      ),
    ).toBe("App\\Models\\Album");
    expect(
      phpVariableTypeInSource(
        source,
        positionAfter(source, "$summedAlbum->tit"),
        "summedAlbum",
        laravelOptions,
      ),
    ).toBe("App\\Models\\Album");
    expect(
      phpVariableTypeInSource(
        source,
        positionAfter(source, "$lazySummedAlbum->tit"),
        "lazySummedAlbum",
        laravelOptions,
      ),
    ).toBe("App\\Models\\Album");
    expect(
      phpVariableTypeInSource(
        source,
        positionAfter(source, "$fromLoadedCollection->tit"),
        "fromLoadedCollection",
        laravelOptions,
      ),
    ).toBe("App\\Models\\Album");
    expect(
      phpVariableTypeInSource(
        source,
        positionAfter(source, "$foundOr->tit"),
        "foundOr",
        laravelOptions,
      ),
    ).toBe("App\\Models\\Album");
    expect(
      phpVariableTypeInSource(
        source,
        positionAfter(source, "$fromFindMany->tit"),
        "fromFindMany",
        laravelOptions,
      ),
    ).toBe("App\\Models\\Album");
    expect(
      phpVariableTypeInSource(
        source,
        positionAfter(source, "$foundOrNew->tit"),
        "foundOrNew",
        laravelOptions,
      ),
    ).toBe("App\\Models\\Album");
    expect(
      phpVariableTypeInSource(
        source,
        positionAfter(source, "$foundSole->tit"),
        "foundSole",
        laravelOptions,
      ),
    ).toBe("App\\Models\\Album");
    expect(
      phpVariableTypeInSource(
        source,
        positionAfter(source, "$fromCreateOrFirst->tit"),
        "fromCreateOrFirst",
        laravelOptions,
      ),
    ).toBe("App\\Models\\Album");
    expect(
      phpVariableTypeInSource(
        source,
        positionAfter(source, "$fromCreateOrRestore->tit"),
        "fromCreateOrRestore",
        laravelOptions,
      ),
    ).toBe("App\\Models\\Album");
    expect(
      phpVariableTypeInSource(
        source,
        positionAfter(source, "$fromRestoreOrCreate->tit"),
        "fromRestoreOrCreate",
        laravelOptions,
      ),
    ).toBe("App\\Models\\Album");
    expect(
      phpVariableTypeInSource(
        source,
        positionAfter(source, "$fromIncrementOrCreate->tit"),
        "fromIncrementOrCreate",
        laravelOptions,
      ),
    ).toBe("App\\Models\\Album");
    expect(
      phpVariableTypeInSource(
        source,
        positionAfter(source, "$fromGetModel->tit"),
        "fromGetModel",
        laravelOptions,
      ),
    ).toBe("App\\Models\\Album");
    expect(
      phpVariableTypeInSource(
        source,
        positionAfter(source, "$fromNewModelInstance->tit"),
        "fromNewModelInstance",
        laravelOptions,
      ),
    ).toBe("App\\Models\\Album");
    expect(
      phpVariableTypeInSource(
        source,
        positionAfter(source, "$query->whe"),
        "query",
        laravelOptions,
      ),
    ).toBe("Illuminate\\Database\\Eloquent\\Builder<App\\Models\\Album>");
    expect(
      phpVariableTypeInSource(
        source,
        positionAfter(source, "$latest->tit"),
        "latest",
        laravelOptions,
      ),
    ).toBe("App\\Models\\Album");
    expect(
      phpVariableTypeInSource(
        source,
        positionAfter(source, "$afterValueTerminal->tit"),
        "afterValueTerminal",
        laravelOptions,
      ),
    ).toBeNull();
    expect(
      phpVariableTypeInSource(
        source,
        positionAfter(source, "$afterSoleValueTerminal->tit"),
        "afterSoleValueTerminal",
        laravelOptions,
      ),
    ).toBeNull();
    expect(
      phpVariableTypeInSource(
        source,
        positionAfter(source, "$afterValueOrFailTerminal->tit"),
        "afterValueOrFailTerminal",
        laravelOptions,
      ),
    ).toBeNull();
    for (const terminalVariableName of [
      "afterSumTerminal",
      "afterAvgTerminal",
      "afterAverageTerminal",
      "afterMinTerminal",
      "afterMaxTerminal",
      "afterAggregateTerminal",
      "afterNumericAggregateTerminal",
      "afterRawValueTerminal",
      "afterExistsOrTerminal",
      "afterDoesntExistOrTerminal",
      "afterImplodeTerminal",
      "afterInsertGetIdTerminal",
      "afterInsertOrIgnoreTerminal",
      "afterInsertOrIgnoreReturningTerminal",
      "afterInsertUsingTerminal",
      "afterInsertOrIgnoreUsingTerminal",
      "afterUpdateOrInsertTerminal",
      "afterUpdateFromTerminal",
      "afterTruncateTerminal",
    ]) {
      expect(
        phpVariableTypeInSource(
          source,
          positionAfter(source, `$${terminalVariableName}->tit`),
          terminalVariableName,
          laravelOptions,
        ),
      ).toBeNull();
    }
    expect(
      phpVariableTypeInSource(
        source,
        positionAfter(source, "$afterUpdateTerminal->tit"),
        "afterUpdateTerminal",
        laravelOptions,
      ),
    ).toBeNull();
    expect(
      phpVariableTypeInSource(
        source,
        positionAfter(source, "$afterDeleteTerminal->tit"),
        "afterDeleteTerminal",
        laravelOptions,
      ),
    ).toBeNull();
    expect(
      phpVariableTypeInSource(
        source,
        positionAfter(source, "$afterIncrementTerminal->tit"),
        "afterIncrementTerminal",
        laravelOptions,
      ),
    ).toBeNull();
    expect(
      phpVariableTypeInSource(
        source,
        positionAfter(source, "$afterChunkByIdTerminal->tit"),
        "afterChunkByIdTerminal",
        laravelOptions,
      ),
    ).toBeNull();
    expect(
      phpVariableTypeInSource(
        source,
        positionAfter(source, "$afterCursorPaginateTerminal->tit"),
        "afterCursorPaginateTerminal",
        laravelOptions,
      ),
    ).toBeNull();
    expect(
      phpVariableTypeInSource(
        source,
        positionAfter(source, "$afterGetModelsTerminal->tit"),
        "afterGetModelsTerminal",
        laravelOptions,
      ),
    ).toBeNull();
    expect(
      phpVariableTypeInSource(
        source,
        positionAfter(source, "$afterToBaseTerminal->tit"),
        "afterToBaseTerminal",
        laravelOptions,
      ),
    ).toBeNull();
    expect(
      phpVariableTypeInSource(
        source,
        positionAfter(source, "$afterQualifyColumnTerminal->tit"),
        "afterQualifyColumnTerminal",
        laravelOptions,
      ),
    ).toBeNull();
    expect(
      phpVariableTypeInSource(
        source,
        positionAfter(source, "$afterGetRelationTerminal->tit"),
        "afterGetRelationTerminal",
        laravelOptions,
      ),
    ).toBeNull();
    expect(
      phpVariableTypeInSource(
        source,
        positionAfter(source, "$afterFillInsertTerminal->tit"),
        "afterFillInsertTerminal",
        laravelOptions,
      ),
    ).toBeNull();
  });

  it("resolves Laravel model assignments from Eloquent collection chains", () => {
    const source = `<?php
namespace App\\Models;

use Illuminate\\Database\\Eloquent\\Model;

class Album extends Model
{
    public function preview(): void
    {
        $albums = Album::query()->get();
        $fromAssignedCollection = $albums->filter()->first();
        $fromDirectCollection = Album::query()->get()->first();
        $fromStaticCollection = Album::all()->first();
        $fromCursor = Album::cursor()->first();
        $fromLazyById = Album::query()->lazyById()->first();
        $fromHydrated = Album::hydrate([])->first();

        $fromAssignedCollection->tit
        $fromDirectCollection->tit
        $fromStaticCollection->tit
        $fromCursor->tit
        $fromLazyById->tit
        $fromHydrated->tit
    }
}
`;

    expect(
      phpReceiverExpressionTypeInSource(
        source,
        positionAfter(source, "$fromAssignedCollection->tit"),
        "Album::query()->get()",
        laravelOptions,
      ),
    ).toBe("Illuminate\\Database\\Eloquent\\Collection<int, App\\Models\\Album>");
    expect(
      phpVariableTypeInSource(
        source,
        positionAfter(source, "$fromAssignedCollection->tit"),
        "fromAssignedCollection",
        laravelOptions,
      ),
    ).toBe("App\\Models\\Album");
    expect(
      phpVariableTypeInSource(
        source,
        positionAfter(source, "$fromDirectCollection->tit"),
        "fromDirectCollection",
        laravelOptions,
      ),
    ).toBe("App\\Models\\Album");
    expect(
      phpVariableTypeInSource(
        source,
        positionAfter(source, "$fromStaticCollection->tit"),
        "fromStaticCollection",
        laravelOptions,
      ),
    ).toBe("App\\Models\\Album");
    expect(
      phpVariableTypeInSource(
        source,
        positionAfter(source, "$fromCursor->tit"),
        "fromCursor",
        laravelOptions,
      ),
    ).toBe("App\\Models\\Album");
    expect(
      phpVariableTypeInSource(
        source,
        positionAfter(source, "$fromLazyById->tit"),
        "fromLazyById",
        laravelOptions,
      ),
    ).toBe("App\\Models\\Album");
    expect(
      phpVariableTypeInSource(
        source,
        positionAfter(source, "$fromHydrated->tit"),
        "fromHydrated",
        laravelOptions,
      ),
    ).toBe("App\\Models\\Album");
    expect(
      phpVariableTypeInSource(
        source,
        positionAfter(source, "$fromStaticCollection->tit"),
        "fromStaticCollection",
      ),
    ).toBeNull();
  });

  it("resolves Laravel relation factory chains to related model assignments", () => {
    const source = `<?php
namespace App\\Models;

use Illuminate\\Database\\Eloquent\\Model;
use Illuminate\\Database\\Eloquent\\Relations\\HasManyThrough;

class Comment extends Model
{
    private const POST_MODEL = Post::class;
    private const TRACK_MODEL = Track::class;

    public function preview(): void
    {
        $direct = $this->hasMany(Post::class)
            ->whereNull('archived_at')
            ->firstOrFail();
        $related = Post::class;
        $parent = $this->belongsTo($related)->first();
        $defaultParent = $this->belongsTo(Post::class)
            ->withDefault()
            ->first();
        $defaultSoftDeletedParent = $this->belongsTo(Post::class)
            ->withTrashed()
            ->withDefault()
            ->first();
        $morphed = $this->morphMany(Post::class, 'commentable')->get()->first();
        $relation = $this->hasOne(self::class);
        $selfComment = $relation->first();
        $constantPost = $this->hasMany(self::POST_MODEL)->firstOrFail();
        $relationMethodPost = $this->posts()->first();
        $relationMethodRequiredPost = $this->posts()->firstOrFail();
        $relationMethodSolePost = $this->posts()->sole();
        $relationMethodFoundPost = $this->posts()->find(1);
        $relationMethodFoundOrPost = $this->posts()->findOr(1, fn () => null);
        $relationMethodFoundSolePost = $this->posts()->findSole(1);
        $relationMethodFirstWherePost = $this->posts()->firstWhere('published', true);
        $relationMethodFirstOrPost = $this->posts()->firstOr(fn () => new Post());
        $relationMethodFirstOrNewPost = $this->posts()->firstOrNew(['title' => 'Draft']);
        $relationMethodRelationshipQueriedPost = $this->posts()
            ->has('comments')
            ->orHas('comments')
            ->doesntHave('comments')
            ->orDoesntHave('comments')
            ->hasMorph('commentable', [Post::class])
            ->orHasMorph('commentable', [Post::class])
            ->doesntHaveMorph('commentable', [Post::class])
            ->orDoesntHaveMorph('commentable', [Post::class])
            ->whereRelation('comments', 'approved', true)
            ->orWhereRelation('comments', 'flagged', false)
            ->whereDoesntHave('comments')
            ->orWhereDoesntHave('comments')
            ->whereDoesntHaveMorph('commentable', [Post::class])
            ->orWhereDoesntHaveMorph('commentable', [Post::class])
            ->whereMorphRelation('commentable', [Post::class], 'visible', true)
            ->orWhereMorphRelation('commentable', [Post::class], 'featured', true)
            ->first();
        $relationMethodLatestPost = $this->posts()->latest()->first();
        $relationMethodOldestPost = $this->posts()->oldest()->first();
        $relationMethodRandomPost = $this->posts()->inRandomOrder()->first();
        $relationMethodDescendingPost = $this->posts()->orderByDesc('created_at')->first();
        $relationMethodReorderedPost = $this->posts()->reorder('created_at')->first();
        $relationMethodLockedPost = $this->posts()->lock()->lockForUpdate()->sharedLock()->first();
        $relationMethodControlledPost = $this->posts()
            ->beforeQuery(fn () => null)
            ->afterQuery(fn ($results) => $results)
            ->timeout(5)
            ->forPage(1, 10)
            ->forPageAfterId(10, 0)
            ->forPageBeforeId(10, 100)
            ->reorderDesc('created_at')
            ->union($this->posts()->select('posts.*'))
            ->unionAll($this->posts()->select('posts.*'))
            ->first();
        $relationMethodJoinedPost = $this->posts()
            ->addSelect('posts.*')
            ->selectSub($this->posts()->selectRaw('count(*)'), 'post_count')
            ->selectExpression('1', 'one')
            ->fromSub($this->posts()->select('posts.*'), 'posts')
            ->fromRaw('posts')
            ->useIndex('posts_created_at_index')
            ->forceIndex('posts_created_at_index')
            ->ignoreIndex('posts_created_at_index')
            ->joinWhere('comments', 'comments.post_id', '=', 'posts.id')
            ->joinSub($this->posts()->select('id'), 'recent_posts', 'recent_posts.id', '=', 'posts.id')
            ->joinLateral($this->posts()->select('id'), 'lateral_posts')
            ->leftJoinWhere('comments as left_comments', 'left_comments.post_id', '=', 'posts.id')
            ->leftJoinSub($this->posts()->select('id'), 'left_posts', 'left_posts.id', '=', 'posts.id')
            ->leftJoinLateral($this->posts()->select('id'), 'left_lateral_posts')
            ->rightJoinWhere('comments as right_comments', 'right_comments.post_id', '=', 'posts.id')
            ->rightJoinSub($this->posts()->select('id'), 'right_posts', 'right_posts.id', '=', 'posts.id')
            ->crossJoinSub($this->posts()->select('id'), 'cross_posts')
            ->straightJoin('comments as straight_comments', 'straight_comments.post_id', '=', 'posts.id')
            ->straightJoinWhere('comments as straight_where_comments', 'straight_where_comments.post_id', '=', 'posts.id')
            ->straightJoinSub($this->posts()->select('id'), 'straight_posts', 'straight_posts.id', '=', 'posts.id')
            ->first();
        $relationMethodVectorOrderedPost = $this->posts()
            ->selectVectorDistance('embedding', [0.1, 0.2, 0.3], 'distance')
            ->whereVectorSimilarTo('embedding', [0.1, 0.2, 0.3], 0.7)
            ->whereVectorDistanceLessThan('embedding', [0.1, 0.2, 0.3], 0.5)
            ->orWhereVectorDistanceLessThan('embedding', [0.3, 0.2, 0.1], 0.6)
            ->orderByVectorDistance('embedding', [0.1, 0.2, 0.3])
            ->inOrderOf('id', [1, 2, 3])
            ->groupLimit(1, 'user_id')
            ->first();
        $relationMethodRawFilteredPost = $this->posts()
            ->selectRaw('posts.*')
            ->whereRaw('published = 1')
            ->orWhereRaw('featured = 1')
            ->groupByRaw('posts.id')
            ->havingRaw('count(*) > 0')
            ->having('score', '>', 0)
            ->orHaving('rating', '>', 0)
            ->havingBetween('score', [1, 10])
            ->orHavingBetween('rating', [1, 10])
            ->havingNotBetween('score', [20, 30])
            ->orHavingNotBetween('rating', [20, 30])
            ->havingNull('deleted_at')
            ->orHavingNull('archived_at')
            ->havingNotNull('created_at')
            ->orHavingNotNull('updated_at')
            ->havingNested(fn ($query) => $query->having('score', '>', 0))
            ->orHavingRaw('sum(score) > 10')
            ->orderByRaw('created_at desc')
            ->first();
        $relationMethodExistsFilteredPost = $this->posts()
            ->whereExists(fn ($query) => $query->selectRaw('1'))
            ->orWhereExists(fn ($query) => $query->selectRaw('1'))
            ->whereNotExists(fn ($query) => $query->selectRaw('1'))
            ->orWhereNotExists(fn ($query) => $query->selectRaw('1'))
            ->first();
        $relationMethodColumnFilteredPost = $this->posts()
            ->whereColumn('created_at', 'updated_at')
            ->orWhereColumn('published_at', 'updated_at')
            ->orWhereNotBetween('score', [0, 10])
            ->first();
        $relationMethodNegatedWherePost = $this->posts()
            ->whereNot('status', 'archived')
            ->orWhereNot(fn ($query) => $query->where('hidden', false))
            ->first();
        $relationMethodBetweenFilteredPost = $this->posts()
            ->whereBetweenColumns('score', ['min_score', 'max_score'])
            ->orWhereBetweenColumns('rating', ['min_rating', 'max_rating'])
            ->whereNotBetweenColumns('archived_score', ['min_score', 'max_score'])
            ->orWhereNotBetweenColumns('deprecated_rating', ['min_rating', 'max_rating'])
            ->whereValueBetween(5, ['min_score', 'max_score'])
            ->orWhereValueBetween(4, ['min_rating', 'max_rating'])
            ->whereValueNotBetween(0, ['min_score', 'max_score'])
            ->orWhereValueNotBetween(1, ['min_rating', 'max_rating'])
            ->first();
        $relationMethodIntegerRowFilteredPost = $this->posts()
            ->whereIntegerInRaw('id', [1, 2])
            ->orWhereIntegerInRaw('parent_id', [3, 4])
            ->whereIntegerNotInRaw('legacy_id', [5, 6])
            ->orWhereIntegerNotInRaw('archived_id', [7, 8])
            ->whereRowValues(['id', 'score'], '>', [1, 0])
            ->orWhereRowValues(['id', 'score'], '<', [10, 100])
            ->first();
        $relationMethodLikeFilteredPost = $this->posts()
            ->whereLike('title', '%Laravel%')
            ->orWhereLike('summary', '%Laravel%')
            ->whereNotLike('slug', '%draft%')
            ->orWhereNotLike('body', '%deprecated%')
            ->whereAny(['title', 'summary'], 'like', '%tips%')
            ->orWhereAny(['title', 'summary'], 'like', '%news%')
            ->whereAll(['title', 'summary'], 'like', '%Laravel%')
            ->orWhereAll(['title', 'summary'], 'like', '%PHP%')
            ->whereNone(['slug', 'body'], 'like', '%archived%')
            ->orWhereNone(['slug', 'body'], 'like', '%deleted%')
            ->first();
        $relationMethodSearchFilteredPost = $this->posts()
            ->whereFullText(['title', 'body'], 'laravel')
            ->orWhereFullText('summary', 'php')
            ->whereNullSafeEquals('published_at', null)
            ->orWhereNullSafeEquals('archived_at', null)
            ->first();
        $relationMethodJsonFilteredPost = $this->posts()
            ->whereJsonContains('meta->tags', 'php')
            ->orWhereJsonContains('meta->tags', 'laravel')
            ->whereJsonDoesntContain('meta->tags', 'draft')
            ->orWhereJsonDoesntContain('meta->tags', 'archived')
            ->whereJsonOverlaps('meta->tags', ['php'])
            ->orWhereJsonOverlaps('meta->tags', ['laravel'])
            ->whereJsonDoesntOverlap('meta->tags', ['deprecated'])
            ->orWhereJsonDoesntOverlap('meta->tags', ['legacy'])
            ->whereJsonContainsKey('meta->published')
            ->orWhereJsonContainsKey('meta->featured')
            ->whereJsonDoesntContainKey('meta->hidden')
            ->orWhereJsonDoesntContainKey('meta->blocked')
            ->whereJsonLength('meta->tags', '>', 0)
            ->orWhereJsonLength('meta->tags', '>', 1)
            ->first();
        $relationMethodDatePartFilteredPost = $this->posts()
            ->whereDate('published_at', '>=', '2026-01-01')
            ->orWhereDate('published_at', '<', '2027-01-01')
            ->whereDay('published_at', '>=', 1)
            ->orWhereDay('published_at', '<=', 31)
            ->whereMonth('published_at', '>=', 1)
            ->orWhereMonth('published_at', '<=', 12)
            ->whereTime('published_at', '>=', '08:00:00')
            ->orWhereTime('published_at', '<=', '18:00:00')
            ->whereYear('published_at', '>=', 2026)
            ->orWhereYear('published_at', '<=', 2027)
            ->first();
        $relationMethodRelativeDateFilteredPost = $this->posts()
            ->wherePast('published_at')
            ->orWherePast('expires_at')
            ->whereNowOrPast('published_at')
            ->orWhereNowOrPast('updated_at')
            ->whereFuture('expires_at')
            ->orWhereFuture('reviewed_at')
            ->whereNowOrFuture('expires_at')
            ->orWhereNowOrFuture('reviewed_at')
            ->whereToday('published_at')
            ->orWhereToday('reviewed_at')
            ->whereBeforeToday('created_at')
            ->orWhereBeforeToday('archived_at')
            ->whereTodayOrBefore('published_at')
            ->orWhereTodayOrBefore('updated_at')
            ->whereAfterToday('expires_at')
            ->orWhereAfterToday('reviewed_at')
            ->whereTodayOrAfter('expires_at')
            ->orWhereTodayOrAfter('reviewed_at')
            ->first();
        $relationMethodFoundManyPosts = $this->posts()->findMany([1, 2]);
        $relationMethodFoundManyPost = $this->posts()->findMany([1, 2])->first();
        $relationMethodAfterValueTerminal = $this->posts()->value('title')->first();
        $relationMethodAfterExistsTerminal = $this->posts()->exists()->first();
        $relationMethodAfterDoesntExistTerminal = $this->posts()->doesntExist()->first();
        $relationMethodPosts = $this->posts()->get();
        $relationMethodCollectionPost = $this->posts()->get()->first();
        $relationMethodLazyPosts = $this->posts()->lazy();
        $relationMethodLazyPost = $this->posts()->lazy()->first();
        $relationMethodCursorPost = $this->posts()->cursor()->first();
        $throughTrack = $this->hasManyThrough(self::TRACK_MODEL, Playlist::class)
            ->whereNull('archived_at')
            ->first();
        $documentedThroughTrack = $this->documentedTracks()->first();
        $namedThroughTrack = $this
            ->through(relationship: 'playlists')
            ->has(relation: 'tracks')
            ->first();
        $dynamicThroughTrack = $this->throughPlaylists()->hasTracks()->first();
        $namedThroughTracks = $this
            ->through(relationship: 'playlists')
            ->has(relation: 'tracks')
            ->get();
        $tag = $this->belongsToMany(Tag::class)
            ->as('subscription')
            ->withPivot('active')
            ->wherePivot('active', true)
            ->first();
        $latestPost = $this->hasOne(Post::class)
            ->latestOfMany()
            ->first();

        $direct->tit
        $parent->tit
        $defaultParent->tit
        $defaultSoftDeletedParent->tit
        $morphed->tit
        $selfComment->bod
        $constantPost->tit
        $relationMethodPost->tit
        $relationMethodRequiredPost->tit
        $relationMethodSolePost->tit
        $relationMethodFoundPost->tit
        $relationMethodFoundOrPost->tit
        $relationMethodFoundSolePost->tit
        $relationMethodFirstWherePost->tit
        $relationMethodFirstOrPost->tit
        $relationMethodFirstOrNewPost->tit
        $relationMethodRelationshipQueriedPost->tit
        $relationMethodLatestPost->tit
        $relationMethodOldestPost->tit
        $relationMethodRandomPost->tit
        $relationMethodDescendingPost->tit
        $relationMethodReorderedPost->tit
        $relationMethodLockedPost->tit
        $relationMethodControlledPost->tit
        $relationMethodJoinedPost->tit
        $relationMethodVectorOrderedPost->tit
        $relationMethodRawFilteredPost->tit
        $relationMethodExistsFilteredPost->tit
        $relationMethodColumnFilteredPost->tit
        $relationMethodNegatedWherePost->tit
        $relationMethodBetweenFilteredPost->tit
        $relationMethodIntegerRowFilteredPost->tit
        $relationMethodLikeFilteredPost->tit
        $relationMethodSearchFilteredPost->tit
        $relationMethodJsonFilteredPost->tit
        $relationMethodDatePartFilteredPost->tit
        $relationMethodRelativeDateFilteredPost->tit
        $relationMethodFoundManyPosts->first()->tit
        $relationMethodFoundManyPost->tit
        $relationMethodAfterValueTerminal->tit
        $relationMethodAfterExistsTerminal->tit
        $relationMethodAfterDoesntExistTerminal->tit
        $relationMethodPosts->first()->tit
        $relationMethodCollectionPost->tit
        $relationMethodLazyPosts->first()->tit
        $relationMethodLazyPost->tit
        $relationMethodCursorPost->tit
        $throughTrack->dur
        $documentedThroughTrack->dur
        $namedThroughTrack->dur
        $dynamicThroughTrack->dur
        $namedThroughTracks->first()->dur
        $tag->nam
        $latestPost->tit
    }

    public function playlists()
    {
        return $this->hasMany(Playlist::class);
    }

    public function posts()
    {
        return $this->hasMany(Post::class);
    }

    /** @return HasManyThrough<Track, Playlist> */
    public function documentedTracks(): HasManyThrough
    {
        return $this->hasManyThrough($related, $through);
    }
}

class Post extends Model
{
}

class Playlist extends Model
{
    public function tracks()
    {
        return $this->hasMany(Track::class);
    }
}

class Track extends Model
{
}

class Tag extends Model
{
}
`;

    expect(
      phpReceiverExpressionTypeInSource(
        source,
        positionAfter(source, "$direct->tit"),
        "$this->hasMany(Post::class)",
        laravelOptions,
      ),
    ).toBe(
      "Illuminate\\Database\\Eloquent\\Relations\\HasMany<App\\Models\\Post>",
    );
    expect(
      phpVariableTypeInSource(
        source,
        positionAfter(source, "$direct->tit"),
        "direct",
        laravelOptions,
      ),
    ).toBe("App\\Models\\Post");
    expect(
      phpVariableTypeInSource(
        source,
        positionAfter(source, "$parent->tit"),
        "parent",
        laravelOptions,
      ),
    ).toBe("App\\Models\\Post");
    expect(
      phpVariableTypeInSource(
        source,
        positionAfter(source, "$defaultParent->tit"),
        "defaultParent",
        laravelOptions,
      ),
    ).toBe("App\\Models\\Post");
    expect(
      phpVariableTypeInSource(
        source,
        positionAfter(source, "$defaultSoftDeletedParent->tit"),
        "defaultSoftDeletedParent",
        laravelOptions,
      ),
    ).toBe("App\\Models\\Post");
    expect(
      phpVariableTypeInSource(
        source,
        positionAfter(source, "$morphed->tit"),
        "morphed",
        laravelOptions,
      ),
    ).toBe("App\\Models\\Post");
    expect(
      phpVariableTypeInSource(
        source,
        positionAfter(source, "$selfComment->bod"),
        "selfComment",
        laravelOptions,
      ),
    ).toBe("App\\Models\\Comment");
    expect(
      phpVariableTypeInSource(
        source,
        positionAfter(source, "$constantPost->tit"),
        "constantPost",
        laravelOptions,
      ),
    ).toBe("App\\Models\\Post");
    expect(
      phpVariableTypeInSource(
        source,
        positionAfter(source, "$relationMethodPost->tit"),
        "relationMethodPost",
        laravelOptions,
      ),
    ).toBe("App\\Models\\Post");
    expect(
      phpVariableTypeInSource(
        source,
        positionAfter(source, "$relationMethodRequiredPost->tit"),
        "relationMethodRequiredPost",
        laravelOptions,
      ),
    ).toBe("App\\Models\\Post");
    expect(
      phpVariableTypeInSource(
        source,
        positionAfter(source, "$relationMethodSolePost->tit"),
        "relationMethodSolePost",
        laravelOptions,
      ),
    ).toBe("App\\Models\\Post");
    expect(
      phpVariableTypeInSource(
        source,
        positionAfter(source, "$relationMethodFoundPost->tit"),
        "relationMethodFoundPost",
        laravelOptions,
      ),
    ).toBe("App\\Models\\Post");
    expect(
      phpVariableTypeInSource(
        source,
        positionAfter(source, "$relationMethodFoundOrPost->tit"),
        "relationMethodFoundOrPost",
        laravelOptions,
      ),
    ).toBe("App\\Models\\Post");
    expect(
      phpVariableTypeInSource(
        source,
        positionAfter(source, "$relationMethodFoundSolePost->tit"),
        "relationMethodFoundSolePost",
        laravelOptions,
      ),
    ).toBe("App\\Models\\Post");
    expect(
      phpVariableTypeInSource(
        source,
        positionAfter(source, "$relationMethodFirstWherePost->tit"),
        "relationMethodFirstWherePost",
        laravelOptions,
      ),
    ).toBe("App\\Models\\Post");
    expect(
      phpVariableTypeInSource(
        source,
        positionAfter(source, "$relationMethodFirstOrPost->tit"),
        "relationMethodFirstOrPost",
        laravelOptions,
      ),
    ).toBe("App\\Models\\Post");
    expect(
      phpVariableTypeInSource(
        source,
        positionAfter(source, "$relationMethodFirstOrNewPost->tit"),
        "relationMethodFirstOrNewPost",
        laravelOptions,
      ),
    ).toBe("App\\Models\\Post");
    expect(
      phpVariableTypeInSource(
        source,
        positionAfter(source, "$relationMethodRelationshipQueriedPost->tit"),
        "relationMethodRelationshipQueriedPost",
        laravelOptions,
      ),
    ).toBe("App\\Models\\Post");
    expect(
      phpVariableTypeInSource(
        source,
        positionAfter(source, "$relationMethodLatestPost->tit"),
        "relationMethodLatestPost",
        laravelOptions,
      ),
    ).toBe("App\\Models\\Post");
    expect(
      phpVariableTypeInSource(
        source,
        positionAfter(source, "$relationMethodOldestPost->tit"),
        "relationMethodOldestPost",
        laravelOptions,
      ),
    ).toBe("App\\Models\\Post");
    expect(
      phpVariableTypeInSource(
        source,
        positionAfter(source, "$relationMethodRandomPost->tit"),
        "relationMethodRandomPost",
        laravelOptions,
      ),
    ).toBe("App\\Models\\Post");
    expect(
      phpVariableTypeInSource(
        source,
        positionAfter(source, "$relationMethodDescendingPost->tit"),
        "relationMethodDescendingPost",
        laravelOptions,
      ),
    ).toBe("App\\Models\\Post");
    expect(
      phpVariableTypeInSource(
        source,
        positionAfter(source, "$relationMethodReorderedPost->tit"),
        "relationMethodReorderedPost",
        laravelOptions,
      ),
    ).toBe("App\\Models\\Post");
    expect(
      phpVariableTypeInSource(
        source,
        positionAfter(source, "$relationMethodLockedPost->tit"),
        "relationMethodLockedPost",
        laravelOptions,
      ),
    ).toBe("App\\Models\\Post");
    expect(
      phpVariableTypeInSource(
        source,
        positionAfter(source, "$relationMethodControlledPost->tit"),
        "relationMethodControlledPost",
        laravelOptions,
      ),
    ).toBe("App\\Models\\Post");
    expect(
      phpVariableTypeInSource(
        source,
        positionAfter(source, "$relationMethodJoinedPost->tit"),
        "relationMethodJoinedPost",
        laravelOptions,
      ),
    ).toBe("App\\Models\\Post");
    expect(
      phpVariableTypeInSource(
        source,
        positionAfter(source, "$relationMethodVectorOrderedPost->tit"),
        "relationMethodVectorOrderedPost",
        laravelOptions,
      ),
    ).toBe("App\\Models\\Post");
    expect(
      phpVariableTypeInSource(
        source,
        positionAfter(source, "$relationMethodRawFilteredPost->tit"),
        "relationMethodRawFilteredPost",
        laravelOptions,
      ),
    ).toBe("App\\Models\\Post");
    expect(
      phpVariableTypeInSource(
        source,
        positionAfter(source, "$relationMethodExistsFilteredPost->tit"),
        "relationMethodExistsFilteredPost",
        laravelOptions,
      ),
    ).toBe("App\\Models\\Post");
    expect(
      phpVariableTypeInSource(
        source,
        positionAfter(source, "$relationMethodColumnFilteredPost->tit"),
        "relationMethodColumnFilteredPost",
        laravelOptions,
      ),
    ).toBe("App\\Models\\Post");
    expect(
      phpVariableTypeInSource(
        source,
        positionAfter(source, "$relationMethodNegatedWherePost->tit"),
        "relationMethodNegatedWherePost",
        laravelOptions,
      ),
    ).toBe("App\\Models\\Post");
    expect(
      phpVariableTypeInSource(
        source,
        positionAfter(source, "$relationMethodBetweenFilteredPost->tit"),
        "relationMethodBetweenFilteredPost",
        laravelOptions,
      ),
    ).toBe("App\\Models\\Post");
    expect(
      phpVariableTypeInSource(
        source,
        positionAfter(source, "$relationMethodIntegerRowFilteredPost->tit"),
        "relationMethodIntegerRowFilteredPost",
        laravelOptions,
      ),
    ).toBe("App\\Models\\Post");
    expect(
      phpVariableTypeInSource(
        source,
        positionAfter(source, "$relationMethodLikeFilteredPost->tit"),
        "relationMethodLikeFilteredPost",
        laravelOptions,
      ),
    ).toBe("App\\Models\\Post");
    expect(
      phpVariableTypeInSource(
        source,
        positionAfter(source, "$relationMethodSearchFilteredPost->tit"),
        "relationMethodSearchFilteredPost",
        laravelOptions,
      ),
    ).toBe("App\\Models\\Post");
    expect(
      phpVariableTypeInSource(
        source,
        positionAfter(source, "$relationMethodJsonFilteredPost->tit"),
        "relationMethodJsonFilteredPost",
        laravelOptions,
      ),
    ).toBe("App\\Models\\Post");
    expect(
      phpVariableTypeInSource(
        source,
        positionAfter(source, "$relationMethodDatePartFilteredPost->tit"),
        "relationMethodDatePartFilteredPost",
        laravelOptions,
      ),
    ).toBe("App\\Models\\Post");
    expect(
      phpVariableTypeInSource(
        source,
        positionAfter(source, "$relationMethodRelativeDateFilteredPost->tit"),
        "relationMethodRelativeDateFilteredPost",
        laravelOptions,
      ),
    ).toBe("App\\Models\\Post");
    expect(
      phpVariableTypeInSource(
        source,
        positionAfter(source, "$relationMethodFoundManyPosts->first()->tit"),
        "relationMethodFoundManyPosts",
        laravelOptions,
      ),
    ).toBe("Illuminate\\Database\\Eloquent\\Collection<int, App\\Models\\Post>");
    expect(
      phpVariableTypeInSource(
        source,
        positionAfter(source, "$relationMethodFoundManyPost->tit"),
        "relationMethodFoundManyPost",
        laravelOptions,
      ),
    ).toBe("App\\Models\\Post");
    expect(
      phpVariableTypeInSource(
        source,
        positionAfter(source, "$relationMethodAfterValueTerminal->tit"),
        "relationMethodAfterValueTerminal",
        laravelOptions,
      ),
    ).toBeNull();
    expect(
      phpVariableTypeInSource(
        source,
        positionAfter(source, "$relationMethodAfterExistsTerminal->tit"),
        "relationMethodAfterExistsTerminal",
        laravelOptions,
      ),
    ).toBeNull();
    expect(
      phpVariableTypeInSource(
        source,
        positionAfter(source, "$relationMethodAfterDoesntExistTerminal->tit"),
        "relationMethodAfterDoesntExistTerminal",
        laravelOptions,
      ),
    ).toBeNull();
    expect(
      phpVariableTypeInSource(
        source,
        positionAfter(source, "$relationMethodPosts->first()->tit"),
        "relationMethodPosts",
        laravelOptions,
      ),
    ).toBe(
      "Illuminate\\Database\\Eloquent\\Collection<int, App\\Models\\Post>",
    );
    expect(
      phpVariableTypeInSource(
        source,
        positionAfter(source, "$relationMethodCollectionPost->tit"),
        "relationMethodCollectionPost",
        laravelOptions,
      ),
    ).toBe("App\\Models\\Post");
    expect(
      phpVariableTypeInSource(
        source,
        positionAfter(source, "$relationMethodLazyPosts->first()->tit"),
        "relationMethodLazyPosts",
        laravelOptions,
      ),
    ).toBe("Illuminate\\Support\\LazyCollection<int, App\\Models\\Post>");
    expect(
      phpVariableTypeInSource(
        source,
        positionAfter(source, "$relationMethodLazyPost->tit"),
        "relationMethodLazyPost",
        laravelOptions,
      ),
    ).toBe("App\\Models\\Post");
    expect(
      phpVariableTypeInSource(
        source,
        positionAfter(source, "$relationMethodCursorPost->tit"),
        "relationMethodCursorPost",
        laravelOptions,
      ),
    ).toBe("App\\Models\\Post");
    expect(
      phpVariableTypeInSource(
        source,
        positionAfter(source, "$throughTrack->dur"),
        "throughTrack",
        laravelOptions,
      ),
    ).toBe("App\\Models\\Track");
    expect(
      phpVariableTypeInSource(
        source,
        positionAfter(source, "$documentedThroughTrack->dur"),
        "documentedThroughTrack",
        laravelOptions,
      ),
    ).toBe("App\\Models\\Track");
    expect(
      phpVariableTypeInSource(
        source,
        positionAfter(source, "$namedThroughTrack->dur"),
        "namedThroughTrack",
        laravelOptions,
      ),
    ).toBe("App\\Models\\Track");
    expect(
      phpVariableTypeInSource(
        source,
        positionAfter(source, "$dynamicThroughTrack->dur"),
        "dynamicThroughTrack",
        laravelOptions,
      ),
    ).toBe("App\\Models\\Track");
    expect(
      phpVariableTypeInSource(
        source,
        positionAfter(source, "$namedThroughTracks->first()->dur"),
        "namedThroughTracks",
        laravelOptions,
      ),
    ).toBe(
      "Illuminate\\Database\\Eloquent\\Collection<int, App\\Models\\Track>",
    );
    expect(
      phpVariableTypeInSource(
        source,
        positionAfter(source, "$tag->nam"),
        "tag",
        laravelOptions,
      ),
    ).toBe("App\\Models\\Tag");
    expect(
      phpVariableTypeInSource(
        source,
        positionAfter(source, "$latestPost->tit"),
        "latestPost",
        laravelOptions,
      ),
    ).toBe("App\\Models\\Post");
    expect(
      phpVariableTypeInSource(
        source,
        positionAfter(source, "$direct->tit"),
        "direct",
      ),
    ).toBeNull();
  });

  it("resolves documented Laravel morphTo inverse targets for properties and terminal chains", () => {
    const source = `<?php
namespace App\\Models;

use Illuminate\\Database\\Eloquent\\Model;
use Illuminate\\Database\\Eloquent\\Relations\\MorphTo;

class Comment extends Model
{
    /** @return MorphTo<Post, self> */
    public function commentable(): MorphTo
    {
        return $this->morphTo();
    }

    public function preview(Comment $comment): void
    {
        $fromProperty = $comment->commentable;
        $fromTerminal = $this->morphTo()->first();
        $fromRelationMethod = $this->commentable()->first();

        $fromProperty->tit
        $fromTerminal->tit
        $fromRelationMethod->tit
        $comment->commentable->tit
    }
}

class Post extends Model
{
}
`;

    expect(
      phpReceiverExpressionTypeInSource(
        source,
        positionAfter(source, "$comment->commentable->tit"),
        "$comment->commentable",
        laravelOptions,
      ),
    ).toBe("App\\Models\\Post");
    expect(
      phpVariableTypeInSource(
        source,
        positionAfter(source, "$fromProperty->tit"),
        "fromProperty",
        laravelOptions,
      ),
    ).toBe("App\\Models\\Post");
    expect(
      phpVariableTypeInSource(
        source,
        positionAfter(source, "$fromRelationMethod->tit"),
        "fromRelationMethod",
        laravelOptions,
      ),
    ).toBe("App\\Models\\Post");
    expect(
      phpVariableTypeInSource(
        source,
        positionAfter(source, "$fromTerminal->tit"),
        "fromTerminal",
        laravelOptions,
      ),
    ).toBe("App\\Models\\Post");
    expect(
      phpReceiverExpressionTypeInSource(
        source,
        positionAfter(source, "$comment->commentable->tit"),
        "$comment->commentable",
      ),
    ).toBeNull();
  });

  it("keeps multi-target Laravel morphTo relation method chains ambiguous", () => {
    const source = `<?php
namespace App\\Models;

use Illuminate\\Database\\Eloquent\\Model;
use Illuminate\\Database\\Eloquent\\Relations\\MorphTo;

class Comment extends Model
{
    /** @return MorphTo<Post|Video, self> */
    public function attachable(): MorphTo
    {
        return $this->morphTo();
    }

    public function preview(): void
    {
        $fromAmbiguousRelationMethod = $this->attachable()->first();

        $fromAmbiguousRelationMethod->tit
    }
}

class Post extends Model
{
}

class Video extends Model
{
}
`;

    expect(
      phpVariableTypeInSource(
        source,
        positionAfter(source, "$fromAmbiguousRelationMethod->tit"),
        "fromAmbiguousRelationMethod",
        laravelOptions,
      ),
    ).toBeNull();
  });

  it("resolves unambiguous Laravel morph map targets for morphTo relations", () => {
    const source = `<?php
namespace App\\Models;

use Illuminate\\Database\\Eloquent\\Model;
use Illuminate\\Database\\Eloquent\\Relations\\MorphTo;
use Illuminate\\Database\\Eloquent\\Relations\\Relation;

Relation::enforceMorphMap([
    'post' => Post::class,
]);

class Comment extends Model
{
    public function commentable(): MorphTo
    {
        return $this->morphTo();
    }

    public function preview(Comment $comment): void
    {
        $fromProperty = $comment->commentable;
        $fromTerminal = $this->morphTo()->first();

        $fromProperty->tit
        $fromTerminal->tit
        $comment->commentable->tit
    }
}

class Post extends Model
{
}
`;

    expect(
      phpReceiverExpressionTypeInSource(
        source,
        positionAfter(source, "$comment->commentable->tit"),
        "$comment->commentable",
        laravelOptions,
      ),
    ).toBe("App\\Models\\Post");
    expect(
      phpVariableTypeInSource(
        source,
        positionAfter(source, "$fromProperty->tit"),
        "fromProperty",
        laravelOptions,
      ),
    ).toBe("App\\Models\\Post");
    expect(
      phpVariableTypeInSource(
        source,
        positionAfter(source, "$fromTerminal->tit"),
        "fromTerminal",
        laravelOptions,
      ),
    ).toBe("App\\Models\\Post");
  });

  it("resolves Laravel repository builder chains from model return expressions", () => {
    const source = `<?php
namespace App\\Models;

use Illuminate\\Database\\Eloquent\\Builder;
use Illuminate\\Database\\Eloquent\\Model;

class AlbumRepository
{
    public function query(): Builder
    {
        return Album::query()->withRelations();
    }

    public function show(int $id): void
    {
        $album = $this->query()->whereKey($id)->firstOrFail();

        $album->tit
    }
}

class Album extends Model
{
    public function scopeWithRelations(Builder $query): Builder
    {
        return $query;
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
    expect(
      phpAssignmentExpressionForVariableBefore(
        `<?php
class Controller
{
    public function show(): void
    {
        $album = Album::query()
            ->whereNull('parent_id')
            ->first();

        $album->tit
    }
}
`,
        { column: 16, lineNumber: 10 },
        "album",
      ),
    ).toBe("Album::query()\n            ->whereNull('parent_id')\n            ->first()");
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
    expect(
      phpMethodCallExpression(
        "Album::query()->withWhereHas('tracks', fn ($trackQuery) => $trackQuery->where('visible', true))->first()",
      ),
    ).toEqual({
      methodName: "first",
      receiverExpression:
        "Album::query()->withWhereHas('tracks', fn ($trackQuery) => $trackQuery->where('visible', true))",
    });
    expect(phpMethodCallExpression("$user?->profile?->getName()")).toEqual({
      methodName: "getName",
      receiverExpression: "$user?->profile",
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
    expect(phpPropertyAccessExpression("$user?->profile?->name")).toEqual({
      propertyName: "name",
      receiverExpression: "$user?->profile",
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

Album::query()->when($flag, fn ($whenQuery) => $whenQuery->pub);

Album::query()->unless($flag, function ($unlessQuery): void {
    $unlessQuery->pub
});

Album::query()->tap(fn ($tapQuery) => $tapQuery->pub);

Album::query()->when(fn ($conditionQuery) => $conditionQuery->pub, fn ($matchedWhenQuery) => $matchedWhenQuery->pub);

Album::query()->whereHasMorph('commentable', [Post::class], function ($morphQuery): void {
    $morphQuery->ord
});

Album::query()->whereHasMorph('taggable', Post::class, function ($singleMorphQuery): void {
    $singleMorphQuery->ord
});

Album::query()->orWhereHasMorph('commentable', [Post::class, Video::class, '*'], function ($multipleMorphQuery): void {
    $multipleMorphQuery->ord
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
        positionAfter(source, "$whenQuery->pub"),
        "whenQuery",
      ),
    ).toEqual({
      methodName: "when",
      modelClassName: null,
      receiverExpression: "Album::query()",
      relationName: null,
    });
    expect(
      phpLaravelQueryCallbackContextForVariable(
        source,
        positionAfter(source, "$unlessQuery->pub"),
        "unlessQuery",
      ),
    ).toEqual({
      methodName: "unless",
      modelClassName: null,
      receiverExpression: "Album::query()",
      relationName: null,
    });
    expect(
      phpLaravelQueryCallbackContextForVariable(
        source,
        positionAfter(source, "$tapQuery->pub"),
        "tapQuery",
      ),
    ).toEqual({
      methodName: "tap",
      modelClassName: null,
      receiverExpression: "Album::query()",
      relationName: null,
    });
    expect(
      phpLaravelQueryCallbackContextForVariable(
        source,
        positionAfter(source, "$conditionQuery->pub"),
        "conditionQuery",
      ),
    ).toBeNull();
    expect(
      phpLaravelQueryCallbackContextForVariable(
        source,
        positionAfter(source, "$matchedWhenQuery->pub"),
        "matchedWhenQuery",
      ),
    ).toEqual({
      methodName: "when",
      modelClassName: null,
      receiverExpression: "Album::query()",
      relationName: null,
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
      morphTypeClassNames: ["Post"],
      receiverExpression: "Album::query()",
      relationName: "commentable",
    });
    expect(
      phpLaravelQueryCallbackContextForVariable(
        source,
        positionAfter(source, "$singleMorphQuery->ord"),
        "singleMorphQuery",
      ),
    ).toEqual({
      methodName: "whereHasMorph",
      modelClassName: null,
      morphTypeClassNames: ["Post"],
      receiverExpression: "Album::query()",
      relationName: "taggable",
    });
    expect(
      phpLaravelQueryCallbackContextForVariable(
        source,
        positionAfter(source, "$multipleMorphQuery->ord"),
        "multipleMorphQuery",
      ),
    ).toEqual({
      methodName: "orWhereHasMorph",
      modelClassName: null,
      morphTypeClassNames: ["Post", "Video"],
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
      morphTypeClassNames: ["User"],
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
      previousRelationNames: ["tracks"],
      receiverExpression: "Album::query()",
      relationName: "artist",
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
use App\\Contracts\\NotificationRepositoryInterface;
use App\\Repositories\\EloquentNotificationRepository;
use App\\Contracts\\AuditRepositoryInterface;
use App\\Repositories\\DatabaseAuditRepository;
use App\\Contracts\\InvoiceRepositoryInterface;
use App\\Repositories\\DatabaseInvoiceRepository;

class AppServiceProvider
{
    public function register(): void
    {
        $this->app->bind(CommentRepositoryInterface::class, EloquentCommentRepository::class);
        $this->app->singleton(StatusRepositoryInterface::class, DatabaseStatusRepository::class);
        app()->scoped(ReportRepositoryInterface::class, CachedReportRepository::class);
        $this->app->bind(NotificationRepositoryInterface::class, fn () => new EloquentNotificationRepository());
        $this->app->singleton(AuditRepositoryInterface::class, function () {
            return new DatabaseAuditRepository();
        });
        $this->app->when(SendWebhookJob::class)
            ->needs(WebhookRepositoryInterface::class)
            ->give(DatabaseWebhookRepository::class);
        $this->app->when(SendInvoiceJob::class)
            ->needs(InvoiceRepositoryInterface::class)
            ->give(fn () => new DatabaseInvoiceRepository());
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
        abstractClassName: "NotificationRepositoryInterface",
        concreteClassName: "EloquentNotificationRepository",
      },
      {
        abstractClassName: "AuditRepositoryInterface",
        concreteClassName: "DatabaseAuditRepository",
      },
      {
        abstractClassName: "WebhookRepositoryInterface",
        concreteClassName: "DatabaseWebhookRepository",
      },
      {
        abstractClassName: "InvoiceRepositoryInterface",
        concreteClassName: "DatabaseInvoiceRepository",
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

  it("keeps PHPDoc @var types scoped to their own docblock", () => {
    const source = `<?php
/** @var \\Illuminate\\Database\\Eloquent\\Builder<Album> $typedQuery */
$typed = $typedQuery->first();

/** @var Result<Album> $result */
$resultAlbum = $result->first();
`;

    expect(
      phpDocRawTypeForVariableBefore(
        source,
        positionAfter(source, "$resultAlbum"),
        "result",
      ),
    ).toBe("Result<Album>");
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
