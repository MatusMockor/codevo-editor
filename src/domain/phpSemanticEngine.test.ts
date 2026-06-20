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
        $query = Album::query()->whereKey(1);
        $latest = $query->first();

        $album->tit
        $morphAlbum->tit
        $query->whe
        $latest->tit
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

        $fromAssignedCollection->tit
        $fromDirectCollection->tit
        $fromStaticCollection->tit
        $fromCursor->tit
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
        positionAfter(source, "$fromStaticCollection->tit"),
        "fromStaticCollection",
      ),
    ).toBeNull();
  });

  it("resolves Laravel relation factory chains to related model assignments", () => {
    const source = `<?php
namespace App\\Models;

use Illuminate\\Database\\Eloquent\\Model;

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
        $throughTrack = $this->hasManyThrough(self::TRACK_MODEL, Playlist::class)
            ->whereNull('archived_at')
            ->first();
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
        $throughTrack->dur
        $tag->nam
        $latestPost->tit
    }
}

class Post extends Model
{
}

class Playlist extends Model
{
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
        positionAfter(source, "$throughTrack->dur"),
        "throughTrack",
        laravelOptions,
      ),
    ).toBe("App\\Models\\Track");
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
    expect(
      phpReceiverExpressionTypeInSource(
        source,
        positionAfter(source, "$comment->commentable->tit"),
        "$comment->commentable",
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
