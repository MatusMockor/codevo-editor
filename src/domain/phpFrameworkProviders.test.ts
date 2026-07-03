import { describe, expect, it } from "vitest";
import {
  frameworkProfileForProject,
  isKnownPhpFrameworkMemberMethod,
  isKnownPhpFrameworkStaticMethod,
  isNettePhpProject,
  phpFrameworkContainerBindingsFromSource,
  phpFrameworkContainerExpressionClassName,
  phpFrameworkMethodCallReturnTypeFromSource,
  isPhpFrameworkProviderActive,
  phpFrameworkProviderRegistry,
  phpFrameworkProviderSignature,
  phpFrameworkMemberCompletionsFromSource,
  phpFrameworkPropertyTypeFromSource,
  phpFrameworkProvidersForProject,
  phpFrameworkConfigKeysFromSource,
  phpFrameworkConfigReferenceAt,
  phpFrameworkConfigTargetFromSource,
  phpFrameworkJsonTranslationKeysFromSource,
  phpFrameworkJsonTranslationTargetFromSource,
  phpFrameworkRouteDefinitionsFromSource,
  phpFrameworkRouteReferenceAt,
  phpFrameworkRouteSearchQueries,
  phpFrameworkStringLiteralHelperAt,
  phpFrameworkSupportsConfig,
  phpFrameworkSupportsRoutes,
  phpFrameworkSupportsStringLiterals,
  phpFrameworkSupportsTranslations,
  phpFrameworkSupportsValidation,
  phpFrameworkSupportsViewData,
  phpFrameworkSupportsViews,
  phpFrameworkTranslationKeysFromSource,
  phpFrameworkTranslationReferenceAt,
  phpFrameworkTranslationTargetFromSource,
  phpFrameworkValidationRuleCompletions,
  phpFrameworkValidationRuleReferenceAt,
  phpFrameworkViewDataEntryFromSource,
  phpFrameworkViewDataSearchQueries,
  phpFrameworkViewReferenceAt,
  phpLaravelFrameworkProvider,
  phpNetteFrameworkProvider,
  NETTE_MAGIC_DIAGNOSTIC_SOURCE,
  resolvePhpFrameworkProfile,
  type PhpFrameworkProvider,
} from "./phpFrameworkProviders";
import { NETTE_VIEW_DATA_SEARCH_QUERIES } from "./netteViewData";
import { phpLaravelMorphMapEntriesFromSource } from "./phpFrameworkLaravel";
import {
  phpLaravelNamedRouteDefinitions,
  phpLaravelNamedRouteReferenceContextAt,
} from "./phpLaravelRoutes";
import {
  phpLaravelConfigKeysFromSource,
  phpLaravelConfigReferenceContextAt,
  phpLaravelConfigTargetFromSource,
} from "./phpLaravelConfig";
import {
  phpLaravelJsonTranslationKeysFromSource,
  phpLaravelJsonTranslationTargetFromSource,
  phpLaravelTranslationKeysFromSource,
  phpLaravelTranslationReferenceContextAt,
  phpLaravelTranslationTargetFromSource,
} from "./phpLaravelTranslations";
import { phpLaravelViewReferenceContextAt } from "./phpLaravelViews";
import { bladeViewDataEntryFromSource } from "./bladeViewVariables";
import {
  phpLaravelValidationRuleCompletions,
  phpLaravelValidationRuleStringContextAt,
} from "./phpLaravelValidation";
import { detectLaravelStringLiteralHelper } from "./laravelStringLiteralHelpers";
import type { PhpProjectDescriptor } from "./workspace";

describe("phpFrameworkProviders", () => {
  it("resolves container resolution expressions through the framework seam", () => {
    const providers = [phpLaravelFrameworkProvider];

    expect(
      phpFrameworkContainerExpressionClassName(
        "app(CommentRepository::class)",
        providers,
      ),
    ).toBe("CommentRepository");
    expect(
      phpFrameworkContainerExpressionClassName(
        "app()->make(CommentRepository::class)",
        providers,
      ),
    ).toBe("CommentRepository");
    expect(
      phpFrameworkContainerExpressionClassName(
        "app()->makeWith(CommentRepository::class, [])",
        providers,
      ),
    ).toBe("CommentRepository");
    // Outer-operation guard: a trailing call means the type is that call's return.
    expect(
      phpFrameworkContainerExpressionClassName(
        "app()->make(CommentRepository::class)->paginate()",
        providers,
      ),
    ).toBeNull();
    // Gated: without an active framework provider there is no container magic.
    expect(
      phpFrameworkContainerExpressionClassName(
        "app()->make(CommentRepository::class)",
        [],
      ),
    ).toBeNull();
  });

  it("exposes Laravel model attributes and relations through the framework seam", () => {
    const source = `<?php
use Illuminate\\Database\\Eloquent\\Model;

class Comment extends Model
{
    private const POST_MODEL = Post::class;

    protected $fillable = [
        'content',
    ];

    protected array $casts = [
        'is_pinned' => 'bool',
    ];

    public function parent(): BelongsTo
    {
        return $this->belongsTo(Comment::class);
    }

    public function featuredPosts(): HasMany
    {
        return $this->hasMany(self::POST_MODEL);
    }
}

class Post extends Model
{
}
`;

    expect(
      phpFrameworkMemberCompletionsFromSource(source, "Comment", [
        phpLaravelFrameworkProvider,
      ]),
    ).toEqual([
      {
        declaringClassName: "Comment",
        kind: "property",
        name: "content",
        parameters: "",
        returnType: "mixed",
      },
      {
        declaringClassName: "Comment",
        kind: "property",
        name: "is_pinned",
        parameters: "",
        returnType: "bool",
      },
      {
        declaringClassName: "Comment",
        kind: "property",
        name: "parent",
        parameters: "",
        returnType: "Comment",
      },
      {
        declaringClassName: "Comment",
        kind: "property",
        name: "featuredPosts",
        parameters: "",
        returnType: "Post",
      },
    ]);
  });

  it("does not expose Laravel model attributes without the Laravel provider", () => {
    const source = `<?php
use Illuminate\\Database\\Eloquent\\Model;

class Comment extends Model
{
    protected $fillable = [
        'content',
    ];
}
`;

    expect(phpFrameworkMemberCompletionsFromSource(source, "Comment", [])).toEqual(
      [],
    );
  });

  it("routes Laravel model attribute types from constant metadata through the framework seam", () => {
    const source = `<?php
namespace App\\Models;

use App\\Enums\\CommentType;
use Illuminate\\Database\\Eloquent\\Model;

class Comment extends Model
{
    private const ATTR_TYPE = 'type';

    protected array $casts = [
        self::ATTR_TYPE => CommentType::class,
    ];
}
`;

    expect(
      phpFrameworkPropertyTypeFromSource(source, "type", [
        phpLaravelFrameworkProvider,
      ], "Comment"),
    ).toBe("App\\Enums\\CommentType");
    expect(
      phpFrameworkPropertyTypeFromSource(source, "type", [], "Comment"),
    ).toBeNull();
  });

  it("recognizes only global Laravel static builder methods through the Laravel provider", () => {
    const source = `<?php
use App\\Models\\Album;
`;

    expect(
      isKnownPhpFrameworkStaticMethod(source, "Album", "whereNull", [
        phpLaravelFrameworkProvider,
      ]),
    ).toBe(true);
    expect(
      isKnownPhpFrameworkStaticMethod(source, "Album", "whereNull", []),
    ).toBe(false);
    expect(
      isKnownPhpFrameworkStaticMethod(
        `<?php
use App\\Services\\FooService;
`,
        "FooService",
        "whereNull",
        [phpLaravelFrameworkProvider],
      ),
    ).toBe(false);
    expect(
      isKnownPhpFrameworkStaticMethod(source, "Album", "withCount", [
        phpLaravelFrameworkProvider,
      ]),
    ).toBe(true);
  });

  it("recognizes global Laravel builder member methods through the Laravel provider", () => {
    const source = `<?php
namespace App\\Models;

use Illuminate\\Database\\Eloquent\\Model;

class Album extends Model
{
}
`;

    expect(
      isKnownPhpFrameworkMemberMethod(source, "Album::query()", "whereNull", [
        phpLaravelFrameworkProvider,
      ]),
    ).toBe(true);
    expect(
      isKnownPhpFrameworkMemberMethod(source, "Album::query()", "whereNull", []),
    ).toBe(false);
    expect(
      isKnownPhpFrameworkMemberMethod(source, "Album::query()", "withCount", [
        phpLaravelFrameworkProvider,
      ]),
    ).toBe(true);
  });

  it("routes same-source Laravel builder macros through the Laravel provider", () => {
    const source = `<?php
namespace App\\Models;

use Illuminate\\Database\\Eloquent\\Builder;
use Illuminate\\Database\\Eloquent\\Model;

class Post extends Model
{
}

Builder::macro('published', function (): Builder {
    return $this->whereNotNull('published_at');
});

$query = Post::query();
`;

    expect(
      isKnownPhpFrameworkStaticMethod(source, "Post", "published", [
        phpLaravelFrameworkProvider,
      ]),
    ).toBe(true);
    expect(
      isKnownPhpFrameworkMemberMethod(source, "Post::query()", "published", [
        phpLaravelFrameworkProvider,
      ]),
    ).toBe(true);
    expect(
      isKnownPhpFrameworkMemberMethod(source, "$query", "published", [
        phpLaravelFrameworkProvider,
      ]),
    ).toBe(true);
    expect(
      isKnownPhpFrameworkMemberMethod(source, "Post::query()", "missingMacro", [
        phpLaravelFrameworkProvider,
      ]),
    ).toBe(false);
    expect(
      phpFrameworkMethodCallReturnTypeFromSource(
        source,
        "published",
        "Illuminate\\Database\\Eloquent\\Builder<App\\Models\\Post>",
        "$query",
        [phpLaravelFrameworkProvider],
      ),
    ).toBe("Illuminate\\Database\\Eloquent\\Builder<App\\Models\\Post>");
    expect(
      phpFrameworkMethodCallReturnTypeFromSource(
        source,
        "published",
        "Illuminate\\Database\\Eloquent\\Builder<App\\Models\\Post>",
        "$query",
        [],
      ),
    ).toBeNull();
  });

  it("routes same-source Laravel local scopes through the Laravel provider", () => {
    const source = `<?php
namespace App\\Models;

use Illuminate\\Database\\Eloquent\\Attributes\\Scope;
use Illuminate\\Database\\Eloquent\\Builder;
use Illuminate\\Database\\Eloquent\\Model;

class Post extends Model
{
    public function scopePublished(Builder $query): void
    {
        $query->whereNotNull('published_at');
    }

    #[Scope]
    protected function popular(Builder $query): void
    {
        $query->where('views', '>', 100);
    }
}

class Report
{
}

$query = Post::query();
`;

    expect(
      isKnownPhpFrameworkStaticMethod(source, "Post", "published", [
        phpLaravelFrameworkProvider,
      ]),
    ).toBe(true);
    expect(
      isKnownPhpFrameworkMemberMethod(source, "Post::query()", "published", [
        phpLaravelFrameworkProvider,
      ]),
    ).toBe(true);
    expect(
      isKnownPhpFrameworkMemberMethod(source, "$query", "published", [
        phpLaravelFrameworkProvider,
      ]),
    ).toBe(true);
    expect(
      isKnownPhpFrameworkStaticMethod(source, "Post", "popular", [
        phpLaravelFrameworkProvider,
      ]),
    ).toBe(true);
    expect(
      isKnownPhpFrameworkStaticMethod(source, "Post", "missingScope", [
        phpLaravelFrameworkProvider,
      ]),
    ).toBe(false);
    expect(
      isKnownPhpFrameworkMemberMethod(source, "Post::query()", "missingScope", [
        phpLaravelFrameworkProvider,
      ]),
    ).toBe(false);
    expect(
      isKnownPhpFrameworkStaticMethod(source, "Report", "published", [
        phpLaravelFrameworkProvider,
      ]),
    ).toBe(false);
  });

  it("routes Laravel Eloquent collection return types through provider semantics", () => {
    const source = `<?php
namespace App\\Models;

use Illuminate\\Database\\Eloquent\\Model;

class Album extends Model
{
}
`;

    expect(
      phpFrameworkMethodCallReturnTypeFromSource(
        source,
        "all",
        "Album",
        "Album::all()",
        [phpLaravelFrameworkProvider],
      ),
    ).toBe("Illuminate\\Database\\Eloquent\\Collection<int, App\\Models\\Album>");
    expect(
      phpFrameworkMethodCallReturnTypeFromSource(
        source,
        "all",
        "Album",
        "Album::all()",
        [],
      ),
    ).toBeNull();
  });

  describe("API resource -> response chain", () => {
    // Real shape from kontentino/api Http\Resources + controllers:
    //   a JsonResource subclass returned from a controller, then chained to a
    //   JSON response via ->response()/->toResponse()/->additional()/::collection().
    const resourceSource = `<?php
namespace App\\Http\\Resources;

use App\\Models\\User;
use Illuminate\\Http\\Request;
use Illuminate\\Http\\Resources\\Json\\JsonResource;
use Illuminate\\Http\\Resources\\Json\\ResourceCollection;

class UserResource extends JsonResource
{
    public function toArray(Request $request): array
    {
        return ['id' => $this->id];
    }
}

class UserCollection extends ResourceCollection
{
}

class PlainService
{
}
`;

    it("resolves ::make() on a resource to the resource type", () => {
      expect(
        phpFrameworkMethodCallReturnTypeFromSource(
          resourceSource,
          "make",
          "App\\Http\\Resources\\UserResource",
          "UserResource",
          [phpLaravelFrameworkProvider],
          "UserResource::make($user)",
        ),
      ).toBe("App\\Http\\Resources\\UserResource");
    });

    it("adds resource member and static completions only for API resources", () => {
      expect(
        phpFrameworkMemberCompletionsFromSource(
          resourceSource,
          "App\\Http\\Resources\\UserResource",
          [phpLaravelFrameworkProvider],
        ),
      ).toEqual(
        expect.arrayContaining([
          {
            declaringClassName: "App\\Http\\Resources\\UserResource",
            kind: "resource",
            name: "response",
            parameters: "$request = null",
            returnType: "Illuminate\\Http\\JsonResponse",
          },
          {
            declaringClassName: "App\\Http\\Resources\\UserResource",
            kind: "resource",
            name: "additional",
            parameters: "array $data",
            returnType: "App\\Http\\Resources\\UserResource",
          },
          {
            declaringClassName: "App\\Http\\Resources\\UserResource",
            isStatic: true,
            kind: "resource",
            name: "make",
            parameters: "$resource",
            returnType: "App\\Http\\Resources\\UserResource",
          },
        ]),
      );
      expect(
        phpFrameworkMemberCompletionsFromSource(
          resourceSource,
          "App\\Http\\Resources\\PlainService",
          [phpLaravelFrameworkProvider],
        ).filter((completion) => completion.kind === "resource"),
      ).toEqual([]);
    });

    it("recognizes resource magic methods for diagnostics without broadening plain classes", () => {
      expect(
        isKnownPhpFrameworkMemberMethod(
          resourceSource,
          "(new UserResource($user))",
          "response",
          [phpLaravelFrameworkProvider],
          undefined,
          "App\\Http\\Resources\\UserResource",
        ),
      ).toBe(true);
      expect(
        isKnownPhpFrameworkMemberMethod(
          resourceSource,
          "(new UserResource($user))->additional(['meta' => true])",
          "response",
          [phpLaravelFrameworkProvider],
        ),
      ).toBe(true);
      expect(
        isKnownPhpFrameworkMemberMethod(
          resourceSource,
          "$resource",
          "additional",
          [phpLaravelFrameworkProvider],
          undefined,
          "App\\Http\\Resources\\UserResource",
        ),
      ).toBe(true);
      expect(
        isKnownPhpFrameworkStaticMethod(
          resourceSource,
          "App\\Http\\Resources\\UserResource",
          "collection",
          [phpLaravelFrameworkProvider],
        ),
      ).toBe(true);
      expect(
        isKnownPhpFrameworkMemberMethod(
          resourceSource,
          "$service",
          "response",
          [phpLaravelFrameworkProvider],
          undefined,
          "App\\Http\\Resources\\PlainService",
        ),
      ).toBe(false);
      expect(
        isKnownPhpFrameworkStaticMethod(
          resourceSource,
          "App\\Http\\Resources\\PlainService",
          "make",
          [phpLaravelFrameworkProvider],
        ),
      ).toBe(false);
    });

    it("resolves ::collection() on a resource to an anonymous resource collection", () => {
      expect(
        phpFrameworkMethodCallReturnTypeFromSource(
          resourceSource,
          "collection",
          "App\\Http\\Resources\\UserResource",
          "UserResource",
          [phpLaravelFrameworkProvider],
          "UserResource::collection($users)",
        ),
      ).toBe(
        "Illuminate\\Http\\Resources\\Json\\AnonymousResourceCollection",
      );
    });

    it("keeps the resource type across fluent additional()/withResponse()", () => {
      expect(
        phpFrameworkMethodCallReturnTypeFromSource(
          resourceSource,
          "additional",
          "App\\Http\\Resources\\UserResource",
          "$resource",
          [phpLaravelFrameworkProvider],
          "$resource->additional(['meta' => 1])",
        ),
      ).toBe("App\\Http\\Resources\\UserResource");
    });

    it("resolves ->response() on a resource to a JsonResponse", () => {
      expect(
        phpFrameworkMethodCallReturnTypeFromSource(
          resourceSource,
          "response",
          "App\\Http\\Resources\\UserResource",
          "$resource",
          [phpLaravelFrameworkProvider],
          "$resource->response()",
        ),
      ).toBe("Illuminate\\Http\\JsonResponse");
    });

    it("resolves ->toResponse($request) on a resource to a JsonResponse", () => {
      expect(
        phpFrameworkMethodCallReturnTypeFromSource(
          resourceSource,
          "toResponse",
          "App\\Http\\Resources\\UserResource",
          "$resource",
          [phpLaravelFrameworkProvider],
          "$resource->toResponse($request)",
        ),
      ).toBe("Illuminate\\Http\\JsonResponse");
    });

    it("resolves the response chain for ResourceCollection subclasses too", () => {
      expect(
        phpFrameworkMethodCallReturnTypeFromSource(
          resourceSource,
          "toResponse",
          "App\\Http\\Resources\\UserCollection",
          "$collection",
          [phpLaravelFrameworkProvider],
          "$collection->toResponse($request)",
        ),
      ).toBe("Illuminate\\Http\\JsonResponse");
    });

    it("does not invent a response type for non-resource classes (false positive guard)", () => {
      expect(
        phpFrameworkMethodCallReturnTypeFromSource(
          resourceSource,
          "response",
          "App\\Http\\Resources\\PlainService",
          "$service",
          [phpLaravelFrameworkProvider],
          "$service->response()",
        ),
      ).toBeNull();
      expect(
        phpFrameworkMethodCallReturnTypeFromSource(
          resourceSource,
          "toResponse",
          "App\\Http\\Resources\\PlainService",
          "$service",
          [phpLaravelFrameworkProvider],
          "$service->toResponse($request)",
        ),
      ).toBeNull();
    });

    it("is gated behind an active framework provider", () => {
      expect(
        phpFrameworkMethodCallReturnTypeFromSource(
          resourceSource,
          "toResponse",
          "App\\Http\\Resources\\UserResource",
          "$resource",
          [],
          "$resource->toResponse($request)",
        ),
      ).toBeNull();
    });
  });

  it("routes Laravel relation return types only through the Laravel provider", () => {
    const source = `<?php
namespace App\\Models;

use App\\Models\\{Post, Comment as CommentAlias};
use Illuminate\\Database\\Eloquent\\Model;
use Illuminate\\Database\\Eloquent\\Relations\\MorphTo;

class CommentAlias extends Model
{
    /** @return MorphTo<Post, self> */
    public function commentable(): MorphTo
    {
        return $this->morphTo();
    }
}

class Post extends Model
{
}
`;

    expect(
      phpFrameworkMethodCallReturnTypeFromSource(
        source,
        "hasMany",
        "App\\Models\\Comment",
        "$this",
        [phpLaravelFrameworkProvider],
        "$this->hasMany(Post::class)",
      ),
    ).toBe(
      "Illuminate\\Database\\Eloquent\\Relations\\HasMany<App\\Models\\Post>",
    );
    expect(
      phpFrameworkMethodCallReturnTypeFromSource(
        source,
        "first",
        "Illuminate\\Database\\Eloquent\\Relations\\HasMany<App\\Models\\Post>",
        "$this->hasMany(Post::class)",
        [phpLaravelFrameworkProvider],
        "$this->hasMany(Post::class)->first()",
      ),
    ).toBe("App\\Models\\Post");
    expect(
      phpFrameworkMethodCallReturnTypeFromSource(
        source,
        "morphTo",
        "App\\Models\\Comment",
        "$this",
        [phpLaravelFrameworkProvider],
        "$this->morphTo()",
      ),
    ).toBe(
      "Illuminate\\Database\\Eloquent\\Relations\\MorphTo<App\\Models\\Post>",
    );
    expect(
      phpFrameworkMethodCallReturnTypeFromSource(
        source,
        "first",
        "Illuminate\\Database\\Eloquent\\Relations\\MorphTo<App\\Models\\Post>",
        "$this->morphTo()",
        [phpLaravelFrameworkProvider],
        "$this->morphTo()->first()",
      ),
    ).toBe("App\\Models\\Post");
    expect(
      phpFrameworkMethodCallReturnTypeFromSource(
        source,
        "hasMany",
        "App\\Models\\Comment",
        "$this",
        [],
        "$this->hasMany(Post::class)",
      ),
    ).toBeNull();
    expect(
      phpFrameworkMethodCallReturnTypeFromSource(
        source,
        "first",
        "Illuminate\\Database\\Eloquent\\Relations\\HasMany<App\\Models\\Post>",
        "$this->hasMany(Post::class)",
        [],
        "$this->hasMany(Post::class)->first()",
      ),
    ).toBeNull();
  });

  it("extracts Laravel morph map aliases to model classes", () => {
    const source = `<?php
namespace App\\Providers;

use App\\Models\\Post;
use Illuminate\\Database\\Eloquent\\Relations\\Relation;

class AppServiceProvider
{
    public function boot(): void
    {
        Relation::morphMap([
            'post' => Post::class,
        ]);

        Relation::enforceMorphMap(map: [
            'video' => \\App\\Models\\Video::class,
        ]);
    }
}
`;

    expect(phpLaravelMorphMapEntriesFromSource(source)).toEqual([
      {
        alias: "post",
        modelClassName: "App\\Models\\Post",
      },
      {
        alias: "video",
        modelClassName: "App\\Models\\Video",
      },
    ]);
  });

  it("uses Laravel morph maps for morphTo return types only when unambiguous", () => {
    const source = `<?php
namespace App\\Models;

use Illuminate\\Database\\Eloquent\\Model;
use Illuminate\\Database\\Eloquent\\Relations\\Relation;

Relation::morphMap([
    'post' => Post::class,
]);

class Comment extends Model
{
    public function commentable()
    {
        return $this->morphTo();
    }
}

class Post extends Model
{
}
`;
    const ambiguousSource = source.replace(
      "'post' => Post::class,",
      "'post' => Post::class,\n    'video' => Video::class,",
    );

    expect(
      phpFrameworkMethodCallReturnTypeFromSource(
        source,
        "morphTo",
        "App\\Models\\Comment",
        "$this",
        [phpLaravelFrameworkProvider],
        "$this->morphTo()",
      ),
    ).toBe(
      "Illuminate\\Database\\Eloquent\\Relations\\MorphTo<App\\Models\\Post>",
    );
    expect(
      phpFrameworkMethodCallReturnTypeFromSource(
        ambiguousSource,
        "morphTo",
        "App\\Models\\Comment",
        "$this",
        [phpLaravelFrameworkProvider],
        "$this->morphTo()",
      ),
    ).toBeNull();
  });

  it("supports framework-specific providers without changing the core parser", () => {
    const netteProvider: PhpFrameworkProvider = {
      id: "nette",
      completions: {
        memberCompletionsFromSource: ({ declaringClassName }) => [
          {
            declaringClassName,
            kind: "property",
            name: "presenter",
            parameters: "",
            returnType: "Nette\\Application\\UI\\Presenter",
          },
        ],
      },
      diagnostics: {
        isKnownMemberMethod: ({ methodName }) => methodName === "whereMagic",
        isKnownStaticMethod: ({ methodName }) => methodName === "whereMagic",
      },
    };

    expect(
      phpFrameworkMemberCompletionsFromSource("<?php", "Article", [
        netteProvider,
      ]),
    ).toEqual([
      {
        declaringClassName: "Article",
        kind: "property",
        name: "presenter",
        parameters: "",
        returnType: "Nette\\Application\\UI\\Presenter",
      },
    ]);
    expect(
      isKnownPhpFrameworkStaticMethod("<?php", "Article", "whereMagic", [
        netteProvider,
      ]),
    ).toBe(true);
    expect(
      isKnownPhpFrameworkMemberMethod("<?php", "Article::query()", "whereMagic", [
        netteProvider,
      ]),
    ).toBe(true);
    expect(
      isKnownPhpFrameworkStaticMethod("<?php", "Article", "whereMissing", [
        netteProvider,
      ]),
    ).toBe(false);
  });

  it("activates Laravel provider only for Laravel Composer projects", () => {
    expect(
      phpFrameworkProvidersForProject(
        phpProjectDescriptor({
          packageName: "laravel/laravel",
          packages: [],
        }),
      ),
    ).toEqual([phpLaravelFrameworkProvider]);
    expect(
      phpFrameworkProvidersForProject(
        phpProjectDescriptor({
          packageName: "custom/api",
          packages: [{ name: "laravel/framework" }],
        }),
      ),
    ).toEqual([phpLaravelFrameworkProvider]);
    expect(
      phpFrameworkProvidersForProject(
        phpProjectDescriptor({
          packageName: "symfony/app",
          packages: [{ name: "symfony/framework-bundle" }],
        }),
      ),
    ).toEqual([]);
  });

  it("activates each registered provider through its own detection", () => {
    // Plugin registry: detection lives on the provider (`appliesTo`), so adding a
    // framework is registering a provider - no edits to the dispatcher.
    const symfonyProvider: PhpFrameworkProvider = {
      id: "symfony",
      appliesTo: (php) =>
        php.packages.some(
          (composerPackage) => composerPackage.name === "symfony/framework-bundle",
        ),
    };
    const registry = [phpLaravelFrameworkProvider, symfonyProvider];

    expect(
      phpFrameworkProvidersForProject(
        phpProjectDescriptor({
          packageName: "symfony/app",
          packages: [{ name: "symfony/framework-bundle" }],
        }),
        registry,
      ),
    ).toEqual([symfonyProvider]);
    expect(
      phpFrameworkProvidersForProject(
        phpProjectDescriptor({
          packageName: "laravel/laravel",
          packages: [],
        }),
        registry,
      ),
    ).toEqual([phpLaravelFrameworkProvider]);
    // A project that matches neither provider activates nothing.
    expect(
      phpFrameworkProvidersForProject(
        phpProjectDescriptor({
          packageName: "vendor/plain",
          packages: [],
        }),
        registry,
      ),
    ).toEqual([]);
  });

  it("exposes the Laravel provider through the default registry", () => {
    expect(phpFrameworkProviderRegistry).toContain(phpLaravelFrameworkProvider);
  });

  it("carries Laravel project detection on the provider itself", () => {
    expect(
      phpLaravelFrameworkProvider.appliesTo?.(
        phpProjectDescriptor({
          packageName: "laravel/laravel",
          packages: [],
        }),
      ),
    ).toBe(true);
    expect(
      phpLaravelFrameworkProvider.appliesTo?.(
        phpProjectDescriptor({
          packageName: "symfony/app",
          packages: [{ name: "symfony/framework-bundle" }],
        }),
      ),
    ).toBe(false);
  });

  it("builds stable provider signatures for member caches", () => {
    expect(phpFrameworkProviderSignature([])).toBe("");
    expect(phpFrameworkProviderSignature([phpLaravelFrameworkProvider])).toBe(
      "laravel",
    );
  });

  describe("model attributes from migration workspace sources", () => {
    // Real shapes captured from kontentino/api:
    //   app/Kontentino/src/AiHub/Models/AiUsage.php
    //   database/migrations/2026_05_04_150000_create_ai_usages_table.php
    const aiUsageModel = `<?php
namespace Kontentino\\AiHub\\Models;

use Kontentino\\Eloquent\\AdminModel;

class AiUsage extends AdminModel
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
    const aiUsagesMigration = `<?php

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
            $table->integer('usage_count')->default(0);
            $table->timestamps();
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('ai_usages');
    }
};
`;

    function completionsFor(workspaceSources?: readonly string[]) {
      return phpFrameworkMemberCompletionsFromSource(
        aiUsageModel,
        "Kontentino\\AiHub\\Models\\AiUsage",
        [phpLaravelFrameworkProvider],
        workspaceSources ? { workspaceSources } : undefined,
      );
    }

    it("merges DB columns parsed from migrations into model attribute completions", () => {
      const completions = completionsFor([aiUsagesMigration]);
      const names = completions.map((completion) => completion.name);

      // fillable + casts are preserved.
      expect(names).toEqual(
        expect.arrayContaining([
          "user_id",
          "account_id",
          "usage_date",
          "usage_count",
        ]),
      );
      // Columns that only exist in the migration (never in $fillable):
      // primary key + timestamps().
      expect(names).toEqual(
        expect.arrayContaining(["id", "created_at", "updated_at"]),
      );

      const byName = new Map(
        completions.map((completion) => [completion.name, completion.returnType]),
      );
      expect(byName.get("id")).toBe("int");
      expect(byName.get("created_at")).toBe("\\Illuminate\\Support\\Carbon");
      expect(byName.get("updated_at")).toBe("\\Illuminate\\Support\\Carbon");
      // Both the cast and the migration agree on int here; the divergent-type
      // case below proves the cast actually wins.
      expect(byName.get("account_id")).toBe("int");
    });

    it("lets an explicit $casts type win over the raw migration column type", () => {
      // Migration declares `integer('account_id')` but the model casts it to a
      // string - the cast must take precedence over the migration column type.
      const modelWithDivergentCast = aiUsageModel.replace(
        "'account_id' => 'integer',",
        "'account_id' => 'string',",
      );
      const byName = new Map(
        phpFrameworkMemberCompletionsFromSource(
          modelWithDivergentCast,
          "Kontentino\\AiHub\\Models\\AiUsage",
          [phpLaravelFrameworkProvider],
          { workspaceSources: [aiUsagesMigration] },
        ).map((completion) => [completion.name, completion.returnType]),
      );

      expect(byName.get("account_id")).toBe("string");
      // The migration still contributes its DB-only column alongside the cast.
      expect(byName.get("created_at")).toBe("\\Illuminate\\Support\\Carbon");
    });

    it("falls back to fillable/casts when no migration sources are supplied", () => {
      const names = completionsFor().map((completion) => completion.name);

      expect(names).toEqual(
        expect.arrayContaining(["user_id", "account_id", "usage_count"]),
      );
      expect(names).not.toContain("created_at");
      expect(names).not.toContain("id");
    });

    it("ignores migrations whose table does not match the model (conservative)", () => {
      const unrelatedMigration = aiUsagesMigration.replace(
        /ai_usages/g,
        "other_table",
      );
      const names = completionsFor([unrelatedMigration]).map(
        (completion) => completion.name,
      );

      expect(names).not.toContain("created_at");
      expect(names).not.toContain("id");
      // Existing fillable/casts attributes remain intact.
      expect(names).toEqual(expect.arrayContaining(["user_id", "account_id"]));
    });
  });

  describe("frameworkProfileForProject", () => {
    it("detects Laravel projects from the composer signal", () => {
      expect(
        frameworkProfileForProject(
          phpProjectDescriptor({ packageName: "laravel/laravel", packages: [] }),
        ),
      ).toBe("laravel");
      expect(
        frameworkProfileForProject(
          phpProjectDescriptor({
            packageName: "custom/api",
            packages: [{ name: "laravel/framework" }],
          }),
        ),
      ).toBe("laravel");
    });

    it("detects Nette projects from nette/application or latte/latte", () => {
      expect(
        frameworkProfileForProject(
          phpProjectDescriptor({
            packageName: "nette/web-project",
            packages: [{ name: "nette/application" }],
          }),
        ),
      ).toBe("nette");
      expect(
        frameworkProfileForProject(
          phpProjectDescriptor({
            packageName: "acme/site",
            packages: [{ name: "latte/latte" }],
          }),
        ),
      ).toBe("nette");
    });

    it("falls back to generic for unknown frameworks and empty input", () => {
      expect(
        frameworkProfileForProject(
          phpProjectDescriptor({
            packageName: "symfony/app",
            packages: [{ name: "symfony/framework-bundle" }],
          }),
        ),
      ).toBe("generic");
      expect(frameworkProfileForProject(null)).toBe("generic");
      expect(frameworkProfileForProject(undefined)).toBe("generic");
    });

    it("resolves the ambiguous both-frameworks edge to Laravel deterministically", () => {
      // A project that declares both signals is rare, but the profile must be a
      // single, deterministic value. Laravel wins because it is first in order.
      expect(
        frameworkProfileForProject(
          phpProjectDescriptor({
            packageName: "custom/app",
            packages: [
              { name: "laravel/framework" },
              { name: "nette/application" },
            ],
          }),
        ),
      ).toBe("laravel");
    });
  });

  describe("isNettePhpProject", () => {
    it("is true for nette/application and latte/latte, false otherwise", () => {
      expect(
        isNettePhpProject(
          phpProjectDescriptor({ packages: [{ name: "nette/application" }] }),
        ),
      ).toBe(true);
      expect(
        isNettePhpProject(
          phpProjectDescriptor({ packages: [{ name: "latte/latte" }] }),
        ),
      ).toBe(true);
      expect(
        isNettePhpProject(
          phpProjectDescriptor({
            packageName: "laravel/laravel",
            packages: [{ name: "laravel/framework" }],
          }),
        ),
      ).toBe(false);
      expect(isNettePhpProject(phpProjectDescriptor({ packages: [] }))).toBe(
        false,
      );
    });
  });

  describe("phpNetteFrameworkProvider skeleton", () => {
    const netteDescriptor = phpProjectDescriptor({
      packageName: "nette/web-project",
      packages: [{ name: "nette/application" }],
    });

    it("is registered and activates only for Nette projects (exclusive with Laravel)", () => {
      expect(phpFrameworkProviderRegistry).toContain(phpNetteFrameworkProvider);
      expect(phpNetteFrameworkProvider.appliesTo?.(netteDescriptor)).toBe(true);
      expect(phpLaravelFrameworkProvider.appliesTo?.(netteDescriptor)).toBe(
        false,
      );
      expect(phpFrameworkProvidersForProject(netteDescriptor)).toEqual([
        phpNetteFrameworkProvider,
      ]);
    });

    it("stays inert through the dispatchers it does not implement", () => {
      const providers = [phpNetteFrameworkProvider];

      expect(
        phpFrameworkMemberCompletionsFromSource("<?php", "Article", providers),
      ).toEqual([]);
      expect(
        isKnownPhpFrameworkStaticMethod("<?php", "Article", "render", providers),
      ).toBe(false);
      // No presenter/control context in a bare source, so magic suppression is
      // conservatively off (never a false positive).
      expect(
        isKnownPhpFrameworkMemberMethod("<?php", "$this", "render", providers),
      ).toBe(false);
      expect(
        phpFrameworkPropertyTypeFromSource("<?php", "template", providers),
      ).toBeNull();
      expect(
        phpFrameworkMethodCallReturnTypeFromSource(
          "<?php",
          "render",
          null,
          "$this",
          providers,
        ),
      ).toBeNull();
      expect(
        phpFrameworkContainerExpressionClassName("$this->template", providers),
      ).toBeNull();
      expect(
        phpFrameworkContainerBindingsFromSource("<?php", providers),
      ).toEqual([]);
    });
  });

  describe("phpNetteFrameworkProvider wired capabilities (S5/S6)", () => {
    const providers = [phpNetteFrameworkProvider];
    const presenterSource = `<?php
class ProductPresenter extends Nette\\Application\\UI\\Presenter
{
    public function renderShow(): void
    {
        /** @var \\App\\Model\\Product $product */
        $product = $this->products->get(1);
        $this->template->product = $product;
    }
}
`;

    it("exposes the Nette view-data capability through the dispatch (1:1 with the extractor)", () => {
      expect(phpFrameworkSupportsViewData(providers)).toBe(true);
      expect(phpFrameworkViewDataSearchQueries(providers)).toEqual(
        NETTE_VIEW_DATA_SEARCH_QUERIES,
      );

      const entry = phpFrameworkViewDataEntryFromSource(
        presenterSource,
        providers,
      );

      expect(entry?.bindings).toEqual([
        {
          viewName: "Product:show",
          variables: [
            expect.objectContaining({ name: "$product" }),
          ],
        },
      ]);
    });

    it("downgrades a call on $this->template to a nette-magic hint (methods only)", () => {
      const magicSource = `<?php
class ProductPresenter extends Nette\\Application\\UI\\Presenter
{
    public function renderShow(): void
    {
        $this->template->renderInvoice();
    }
}
`;

      expect(
        isKnownPhpFrameworkMemberMethod(
          magicSource,
          "$this->template",
          "renderInvoice",
          providers,
        ),
      ).toBe(true);
      expect(phpNetteFrameworkProvider.diagnostics?.magicSource).toBe(
        NETTE_MAGIC_DIAGNOSTIC_SOURCE,
      );
      // Nette has no static magic to suppress.
      expect(
        isKnownPhpFrameworkStaticMethod(
          magicSource,
          "Product",
          "renderInvoice",
          providers,
        ),
      ).toBe(false);
    });

    it("leaves Laravel dispatch untouched (exclusive resolution, no blend)", () => {
      const laravelOnly = [phpLaravelFrameworkProvider];

      expect(phpFrameworkViewDataSearchQueries(laravelOnly)).not.toEqual(
        NETTE_VIEW_DATA_SEARCH_QUERIES,
      );
      // A Nette presenter idiom is NOT recognised as Laravel magic.
      expect(
        isKnownPhpFrameworkMemberMethod(
          presenterSource,
          "$this->template",
          "product",
          laravelOnly,
        ),
      ).toBe(false);
      expect(phpLaravelFrameworkProvider.diagnostics?.magicSource).toBeUndefined();
    });
  });

  describe("exclusive framework provider resolution", () => {
    it("activates only the highest-priority provider when several frameworks match", () => {
      // PhpProjectDescriptor.packages carries require + require-dev + the whole
      // composer.lock / installed.json (transitive) tree, so a Laravel app that
      // also drags latte/latte in deep is common, not an edge. The active
      // provider set must stay exclusive - Laravel wins by registry order and
      // Nette is never co-active, so no dispatcher can blend both frameworks.
      const providers = phpFrameworkProvidersForProject(
        phpProjectDescriptor({
          packageName: "custom/app",
          packages: [
            { name: "laravel/framework" },
            { name: "nette/application" },
          ],
        }),
      );

      expect(providers).toEqual([phpLaravelFrameworkProvider]);
      expect(isPhpFrameworkProviderActive(providers, "nette")).toBe(false);
      expect(isPhpFrameworkProviderActive(providers, "laravel")).toBe(true);
    });

    it("resolves a Laravel project carrying transitive latte/latte to Laravel only", () => {
      const providers = phpFrameworkProvidersForProject(
        phpProjectDescriptor({
          packageName: "laravel/laravel",
          packages: [{ name: "latte/latte" }],
        }),
      );

      expect(providers).toEqual([phpLaravelFrameworkProvider]);
      expect(isPhpFrameworkProviderActive(providers, "nette")).toBe(false);
    });

    it("activates only the Nette provider for a clean Nette project", () => {
      const providers = phpFrameworkProvidersForProject(
        phpProjectDescriptor({
          packageName: "nette/web-project",
          packages: [{ name: "nette/application" }],
        }),
      );

      expect(providers).toEqual([phpNetteFrameworkProvider]);
      expect(isPhpFrameworkProviderActive(providers, "laravel")).toBe(false);
    });

    it("activates nothing for a generic PHP project", () => {
      expect(
        phpFrameworkProvidersForProject(
          phpProjectDescriptor({
            packageName: "vendor/plain",
            packages: [{ name: "symfony/framework-bundle" }],
          }),
        ),
      ).toEqual([]);
    });

    it("derives the profile and provider set from one detection pass", () => {
      const php = phpProjectDescriptor({
        packageName: "custom/app",
        packages: [
          { name: "laravel/framework" },
          { name: "nette/application" },
        ],
      });
      const resolution = resolvePhpFrameworkProfile(php);

      // Single winner + laravel profile, but both matches surface for the edge log.
      expect(resolution.providers).toEqual([phpLaravelFrameworkProvider]);
      expect(resolution.profile).toBe("laravel");
      expect(resolution.matchedProviderIds).toEqual(["laravel", "nette"]);
      // The public helpers agree with the resolution (single source of truth).
      expect(phpFrameworkProvidersForProject(php)).toEqual(resolution.providers);
      expect(frameworkProfileForProject(php)).toBe(resolution.profile);
    });

    it("reports a single match for single-framework projects (no edge log)", () => {
      expect(
        resolvePhpFrameworkProfile(
          phpProjectDescriptor({
            packageName: "nette/web-project",
            packages: [{ name: "latte/latte" }],
          }),
        ).matchedProviderIds,
      ).toEqual(["nette"]);
    });
  });

  describe("routes capability", () => {
    const referenceSource = "<?php\nroute('comments.show');\n";
    const referencePosition = { column: 12, lineNumber: 2 };
    const definitionSource =
      "<?php\nRoute::get('/comments')->name('comments.definition');\n";

    it("dispatches Laravel route references 1:1 through the provider", () => {
      const direct = phpLaravelNamedRouteReferenceContextAt(
        referenceSource,
        referencePosition,
      );

      expect(direct).not.toBeNull();
      expect(
        phpFrameworkRouteReferenceAt(referenceSource, referencePosition, [
          phpLaravelFrameworkProvider,
        ]),
      ).toEqual(direct);
    });

    it("dispatches Laravel route definitions 1:1 through the provider", () => {
      const direct = phpLaravelNamedRouteDefinitions(definitionSource);

      expect(direct.length).toBeGreaterThan(0);
      expect(
        phpFrameworkRouteDefinitionsFromSource(definitionSource, [
          phpLaravelFrameworkProvider,
        ]),
      ).toEqual(direct);
    });

    it("exposes the Laravel route search anchors through the provider", () => {
      const queries = phpFrameworkRouteSearchQueries([
        phpLaravelFrameworkProvider,
      ]);

      expect(queries).toContain("->name(");
      expect(queries).toContain("Route::resource");
      expect(queries).toContain("Route::apiResources");
    });

    it("reports route support only for providers shipping the capability", () => {
      expect(phpFrameworkSupportsRoutes([phpLaravelFrameworkProvider])).toBe(
        true,
      );
      expect(phpFrameworkSupportsRoutes([phpNetteFrameworkProvider])).toBe(
        false,
      );
      expect(phpFrameworkSupportsRoutes([])).toBe(false);
    });

    it("stays a safe no-op for providers without the routes capability", () => {
      expect(
        phpFrameworkRouteReferenceAt(referenceSource, referencePosition, [
          phpNetteFrameworkProvider,
        ]),
      ).toBeNull();
      expect(
        phpFrameworkRouteDefinitionsFromSource(definitionSource, [
          phpNetteFrameworkProvider,
        ]),
      ).toEqual([]);
      expect(
        phpFrameworkRouteSearchQueries([phpNetteFrameworkProvider]),
      ).toEqual([]);
      // Empty provider set: dispatchers stay inert (no active framework).
      expect(
        phpFrameworkRouteReferenceAt(referenceSource, referencePosition, []),
      ).toBeNull();
      expect(
        phpFrameworkRouteDefinitionsFromSource(definitionSource, []),
      ).toEqual([]);
      expect(phpFrameworkRouteSearchQueries([])).toEqual([]);
    });
  });

  describe("config capability", () => {
    const referenceSource = "<?php\n\nreturn config('app.name');\n";
    const referencePosition = { column: 22, lineNumber: 3 };
    const configFileSource = "<?php\n\nreturn [\n    'name' => 'Codevo',\n];\n";

    it("dispatches Laravel config references 1:1 through the provider", () => {
      const direct = phpLaravelConfigReferenceContextAt(
        referenceSource,
        referencePosition,
      );

      expect(direct).not.toBeNull();
      expect(
        phpFrameworkConfigReferenceAt(referenceSource, referencePosition, [
          phpLaravelFrameworkProvider,
        ]),
      ).toEqual(direct);
    });

    it("dispatches Laravel config keys 1:1 through the provider", () => {
      const direct = phpLaravelConfigKeysFromSource(configFileSource, "app");

      expect(direct.length).toBeGreaterThan(0);
      expect(
        phpFrameworkConfigKeysFromSource(configFileSource, "app", [
          phpLaravelFrameworkProvider,
        ]),
      ).toEqual(direct);
    });

    it("dispatches Laravel config targets 1:1 through the provider", () => {
      const direct = phpLaravelConfigTargetFromSource(
        configFileSource,
        "app",
        "app.name",
      );

      expect(direct).not.toBeNull();
      expect(
        phpFrameworkConfigTargetFromSource(configFileSource, "app", "app.name", [
          phpLaravelFrameworkProvider,
        ]),
      ).toEqual(direct);
    });

    it("reports config support only for providers shipping the capability", () => {
      expect(phpFrameworkSupportsConfig([phpLaravelFrameworkProvider])).toBe(
        true,
      );
      expect(phpFrameworkSupportsConfig([phpNetteFrameworkProvider])).toBe(
        false,
      );
      expect(phpFrameworkSupportsConfig([])).toBe(false);
    });

    it("stays a safe no-op for providers without the config capability", () => {
      expect(
        phpFrameworkConfigReferenceAt(referenceSource, referencePosition, [
          phpNetteFrameworkProvider,
        ]),
      ).toBeNull();
      expect(
        phpFrameworkConfigKeysFromSource(configFileSource, "app", [
          phpNetteFrameworkProvider,
        ]),
      ).toEqual([]);
      expect(
        phpFrameworkConfigTargetFromSource(configFileSource, "app", "app.name", [
          phpNetteFrameworkProvider,
        ]),
      ).toBeNull();
      // Empty provider set: dispatchers stay inert (no active framework).
      expect(
        phpFrameworkConfigReferenceAt(referenceSource, referencePosition, []),
      ).toBeNull();
      expect(
        phpFrameworkConfigKeysFromSource(configFileSource, "app", []),
      ).toEqual([]);
      expect(
        phpFrameworkConfigTargetFromSource(configFileSource, "app", "app.name", []),
      ).toBeNull();
    });
  });

  describe("translations capability", () => {
    const referenceSource = "<?php\n\nreturn __('messages.welcome');\n";
    const referencePosition = { column: 18, lineNumber: 3 };
    const langFileSource = "<?php\n\nreturn [\n    'welcome' => 'Hi',\n];\n";
    const jsonLangSource = '{\n  "Welcome": "Vitajte"\n}\n';

    it("dispatches Laravel translation references 1:1 through the provider", () => {
      const direct = phpLaravelTranslationReferenceContextAt(
        referenceSource,
        referencePosition,
      );

      expect(direct).not.toBeNull();
      expect(
        phpFrameworkTranslationReferenceAt(referenceSource, referencePosition, [
          phpLaravelFrameworkProvider,
        ]),
      ).toEqual(direct);
    });

    it("dispatches Laravel translation keys 1:1 through the provider", () => {
      const direct = phpLaravelTranslationKeysFromSource(
        langFileSource,
        "messages",
      );

      expect(direct.length).toBeGreaterThan(0);
      expect(
        phpFrameworkTranslationKeysFromSource(langFileSource, "messages", [
          phpLaravelFrameworkProvider,
        ]),
      ).toEqual(direct);
    });

    it("dispatches Laravel translation targets 1:1 through the provider", () => {
      const direct = phpLaravelTranslationTargetFromSource(
        langFileSource,
        "messages",
        "messages.welcome",
      );

      expect(direct).not.toBeNull();
      expect(
        phpFrameworkTranslationTargetFromSource(
          langFileSource,
          "messages",
          "messages.welcome",
          [phpLaravelFrameworkProvider],
        ),
      ).toEqual(direct);
    });

    it("dispatches Laravel JSON translation keys 1:1 through the provider", () => {
      const direct = phpLaravelJsonTranslationKeysFromSource(jsonLangSource);

      expect(direct.length).toBeGreaterThan(0);
      expect(
        phpFrameworkJsonTranslationKeysFromSource(jsonLangSource, [
          phpLaravelFrameworkProvider,
        ]),
      ).toEqual(direct);
    });

    it("dispatches Laravel JSON translation targets 1:1 through the provider", () => {
      const direct = phpLaravelJsonTranslationTargetFromSource(
        jsonLangSource,
        "Welcome",
      );

      expect(direct).not.toBeNull();
      expect(
        phpFrameworkJsonTranslationTargetFromSource(jsonLangSource, "Welcome", [
          phpLaravelFrameworkProvider,
        ]),
      ).toEqual(direct);
    });

    it("reports translation support only for providers shipping the capability", () => {
      expect(
        phpFrameworkSupportsTranslations([phpLaravelFrameworkProvider]),
      ).toBe(true);
      expect(
        phpFrameworkSupportsTranslations([phpNetteFrameworkProvider]),
      ).toBe(false);
      expect(phpFrameworkSupportsTranslations([])).toBe(false);
    });

    it("stays a safe no-op for providers without the translations capability", () => {
      expect(
        phpFrameworkTranslationReferenceAt(referenceSource, referencePosition, [
          phpNetteFrameworkProvider,
        ]),
      ).toBeNull();
      expect(
        phpFrameworkTranslationKeysFromSource(langFileSource, "messages", [
          phpNetteFrameworkProvider,
        ]),
      ).toEqual([]);
      expect(
        phpFrameworkTranslationTargetFromSource(
          langFileSource,
          "messages",
          "messages.welcome",
          [phpNetteFrameworkProvider],
        ),
      ).toBeNull();
      expect(
        phpFrameworkJsonTranslationKeysFromSource(jsonLangSource, [
          phpNetteFrameworkProvider,
        ]),
      ).toEqual([]);
      expect(
        phpFrameworkJsonTranslationTargetFromSource(jsonLangSource, "Welcome", [
          phpNetteFrameworkProvider,
        ]),
      ).toBeNull();
      // Empty provider set: dispatchers stay inert (no active framework).
      expect(
        phpFrameworkTranslationReferenceAt(referenceSource, referencePosition, []),
      ).toBeNull();
      expect(
        phpFrameworkTranslationKeysFromSource(langFileSource, "messages", []),
      ).toEqual([]);
      expect(
        phpFrameworkJsonTranslationKeysFromSource(jsonLangSource, []),
      ).toEqual([]);
    });
  });

  describe("templating capability", () => {
    const referenceSource = "<?php\n\nreturn view('users.index');\n";
    const referencePosition = { column: 16, lineNumber: 3 };

    it("dispatches Laravel view references 1:1 through the provider", () => {
      const direct = phpLaravelViewReferenceContextAt(
        referenceSource,
        referencePosition,
      );

      expect(direct).not.toBeNull();
      expect(
        phpFrameworkViewReferenceAt(referenceSource, referencePosition, [
          phpLaravelFrameworkProvider,
        ]),
      ).toEqual(direct);
    });

    it("reports view support only for providers shipping the capability", () => {
      expect(phpFrameworkSupportsViews([phpLaravelFrameworkProvider])).toBe(
        true,
      );
      expect(phpFrameworkSupportsViews([phpNetteFrameworkProvider])).toBe(false);
      expect(phpFrameworkSupportsViews([])).toBe(false);
    });

    it("stays a safe no-op for providers without the templating capability", () => {
      expect(
        phpFrameworkViewReferenceAt(referenceSource, referencePosition, [
          phpNetteFrameworkProvider,
        ]),
      ).toBeNull();
      // Empty provider set: dispatchers stay inert (no active framework).
      expect(
        phpFrameworkViewReferenceAt(referenceSource, referencePosition, []),
      ).toBeNull();
    });
  });

  describe("viewData capability", () => {
    const viewDataSource =
      "<?php\n\nreturn view('users.index', ['user' => $user]);\n";

    it("dispatches Laravel view-data entries 1:1 through the provider", () => {
      const direct = bladeViewDataEntryFromSource(viewDataSource);

      expect(direct.bindings.length).toBeGreaterThan(0);
      expect(
        phpFrameworkViewDataEntryFromSource(viewDataSource, [
          phpLaravelFrameworkProvider,
        ]),
      ).toEqual(direct);
    });

    it("exposes the Laravel view-data search anchors byte-for-byte", () => {
      expect(
        phpFrameworkViewDataSearchQueries([phpLaravelFrameworkProvider]),
      ).toEqual(["view(", "View::make", "->with(", "compact("]);
    });

    it("reports view-data support only for providers shipping the capability", () => {
      const capabilitylessProvider: PhpFrameworkProvider = { id: "bare" };

      expect(phpFrameworkSupportsViewData([phpLaravelFrameworkProvider])).toBe(
        true,
      );
      expect(phpFrameworkSupportsViewData([phpNetteFrameworkProvider])).toBe(
        true,
      );
      expect(phpFrameworkSupportsViewData([capabilitylessProvider])).toBe(false);
      expect(phpFrameworkSupportsViewData([])).toBe(false);
    });

    it("stays a safe no-op for providers without the viewData capability", () => {
      const capabilitylessProvider: PhpFrameworkProvider = { id: "bare" };

      expect(
        phpFrameworkViewDataEntryFromSource(viewDataSource, [
          capabilitylessProvider,
        ]),
      ).toBeNull();
      expect(
        phpFrameworkViewDataSearchQueries([capabilitylessProvider]),
      ).toEqual([]);
      // Empty provider set: dispatchers stay inert (no active framework).
      expect(phpFrameworkViewDataEntryFromSource(viewDataSource, [])).toBeNull();
      expect(phpFrameworkViewDataSearchQueries([])).toEqual([]);
    });
  });

  describe("validation capability", () => {
    const referenceSource =
      "<?php\n\nValidator::make($data, ['name' => 'req']);\n";
    const referencePosition = { column: 37, lineNumber: 3 };

    it("dispatches Laravel validation-rule references 1:1 through the provider", () => {
      const direct = phpLaravelValidationRuleStringContextAt(
        referenceSource,
        referencePosition,
      );

      expect(direct).not.toBeNull();
      expect(
        phpFrameworkValidationRuleReferenceAt(
          referenceSource,
          referencePosition,
          [phpLaravelFrameworkProvider],
        ),
      ).toEqual(direct);
    });

    it("dispatches Laravel validation-rule completions 1:1 through the provider", () => {
      const direct = phpLaravelValidationRuleCompletions("req");

      expect(direct.length).toBeGreaterThan(0);
      expect(
        phpFrameworkValidationRuleCompletions("req", [
          phpLaravelFrameworkProvider,
        ]),
      ).toEqual(direct);
    });

    it("reports validation support only for providers shipping the capability", () => {
      expect(phpFrameworkSupportsValidation([phpLaravelFrameworkProvider])).toBe(
        true,
      );
      expect(phpFrameworkSupportsValidation([phpNetteFrameworkProvider])).toBe(
        false,
      );
      expect(phpFrameworkSupportsValidation([])).toBe(false);
    });

    it("stays a safe no-op for providers without the validation capability", () => {
      expect(
        phpFrameworkValidationRuleReferenceAt(
          referenceSource,
          referencePosition,
          [phpNetteFrameworkProvider],
        ),
      ).toBeNull();
      expect(
        phpFrameworkValidationRuleCompletions("req", [phpNetteFrameworkProvider]),
      ).toEqual([]);
      // Empty provider set: dispatchers stay inert (no active framework).
      expect(
        phpFrameworkValidationRuleReferenceAt(
          referenceSource,
          referencePosition,
          [],
        ),
      ).toBeNull();
      expect(phpFrameworkValidationRuleCompletions("req", [])).toEqual([]);
    });
  });

  describe("stringLiterals capability", () => {
    const helperSource = "<?php\n\nreturn config('app.name');\n";
    const helperOffset = 25;

    it("dispatches Laravel string-literal helpers 1:1 through the provider", () => {
      const direct = detectLaravelStringLiteralHelper(helperSource, helperOffset);

      expect(direct).not.toBeNull();
      expect(direct?.helper).toBe("config");
      expect(
        phpFrameworkStringLiteralHelperAt(helperSource, helperOffset, [
          phpLaravelFrameworkProvider,
        ]),
      ).toEqual(direct);
    });

    it("reports string-literal support only for providers shipping the capability", () => {
      expect(
        phpFrameworkSupportsStringLiterals([phpLaravelFrameworkProvider]),
      ).toBe(true);
      expect(
        phpFrameworkSupportsStringLiterals([phpNetteFrameworkProvider]),
      ).toBe(false);
      expect(phpFrameworkSupportsStringLiterals([])).toBe(false);
    });

    it("stays a safe no-op for providers without the stringLiterals capability", () => {
      expect(
        phpFrameworkStringLiteralHelperAt(helperSource, helperOffset, [
          phpNetteFrameworkProvider,
        ]),
      ).toBeNull();
      // Empty provider set: dispatchers stay inert (no active framework).
      expect(
        phpFrameworkStringLiteralHelperAt(helperSource, helperOffset, []),
      ).toBeNull();
    });
  });
});

function phpProjectDescriptor(
  overrides: Omit<Partial<PhpProjectDescriptor>, "packages"> & {
    packages?: Array<{ name: string }>;
  } = {},
): PhpProjectDescriptor {
  const { packages = [], ...descriptorOverrides } = overrides;

  return {
    classmapRoots: [],
    hasComposer: true,
    packageName: null,
    packages: packages.map((composerPackage) => ({
      classmapRoots: [],
      dev: false,
      installPath: null,
      name: composerPackage.name,
      packageType: null,
      psr4Roots: [],
      version: null,
    })),
    phpPlatformVersion: null,
    phpVersionConstraint: null,
    psr4Roots: [],
    ...descriptorOverrides,
  };
}
