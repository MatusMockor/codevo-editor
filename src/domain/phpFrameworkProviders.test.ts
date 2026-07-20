import {
  isNettePhpProject,
  phpNetteFrameworkCapabilityDefinitions,
  phpNetteFrameworkProvider,
  NETTE_MAGIC_DIAGNOSTIC_SOURCE,
} from "./phpFrameworkNetteProvider";
import {
  phpLaravelFrameworkCapabilityDefinitions,
  phpLaravelFrameworkProvider,
} from "./phpFrameworkLaravelProvider";
import { describe, expect, expectTypeOf, it } from "vitest";
import {
  createPhpFrameworkProviderCapabilityRegistry,
  definePhpFrameworkCapability,
  definePhpFrameworkActiveDocumentDiagnostics,
  isKnownPhpFrameworkMemberMethod,
  isKnownPhpFrameworkStaticMethod,
  isPhpFrameworkContainerBindingCandidatePath,
  phpFrameworkAuthorizationAbilityDefinitionsFromSource,
  phpFrameworkAuthorizationAbilitySearchQueries,
  phpFrameworkContainerBindingsFromSource,
  phpFrameworkContainerExpressionClassName,
  phpFrameworkSupportsContainerBindingsFromSource,
  phpFrameworkConfigLiteralTarget,
  phpFrameworkDispatchTargetAt,
  phpFrameworkEventListenerMapFromSource,
  phpFrameworkEventServiceProviderClassNames,
  phpFrameworkExplicitRouteModelBindingClassName,
  phpFrameworkMethodCallReturnTypeFromSource,
  phpFrameworkModelNamespacePrefixes,
  phpFrameworkMemberPropertyMagicDiagnostic,
  isPhpFrameworkProviderActive,
  phpFrameworkProviderSignature,
  phpFrameworkMiddlewareAliasDefinitionsFromSource,
  phpFrameworkMiddlewareAliasSearchQueries,
  phpFrameworkPropertyTypeFromSource,
  phpFrameworkQueryCallbackContextForVariable,
  phpFrameworkProvidersForProject,
  phpFrameworkConfigKeysFromSource,
  phpFrameworkConfigReferenceAt,
  phpFrameworkConfigMissingTargetMessage,
  phpFrameworkConfigTargetFromSource,
  phpFrameworkEnvEntriesFromSource,
  phpFrameworkEnvLiteralTarget,
  phpFrameworkEnvMissingTargetMessage,
  phpFrameworkEnvReferenceAt,
  phpFrameworkEnvTargetFromSource,
  phpFrameworkPhpPresenterLinkAt,
  phpFrameworkPhpPresenterLinkCompletionAt,
  phpFrameworkExplicitRouteModelBindingSearchQueries,
  phpFrameworkJsonTranslationKeysFromSource,
  phpFrameworkJsonTranslationTargetFromSource,
  phpFrameworkRouteDefinitionsFromSource,
  phpFrameworkRouteMissingTargetMessage,
  phpFrameworkRouteModelBindingAt,
  phpFrameworkRouteReferenceAt,
  phpFrameworkRouteSearchQueries,
  phpFrameworkScopedStringCompletionAt,
  phpFrameworkScopedStringCompletionContextAt,
  phpFrameworkSupportsLattePresenterLinkIntelligence,
  phpFrameworkSupportsLatteTemplateIntelligence,
  phpFrameworkStringLiteralHelperAt,
  phpFrameworkSupportsAuthorizationAbilities,
  phpFrameworkSupportsConfig,
  phpFrameworkSupportsDispatch,
  phpFrameworkSupportsEnv,
  phpFrameworkSupportsMiddlewareAliases,
  phpFrameworkSupportsNeonConfigIntelligence,
  phpFrameworkSupportsPhpPresenterLinks,
  phpFrameworkSupportsRoutes,
  phpFrameworkSupportsStringLiterals,
  phpFrameworkSuppressesSameSourceMethodReturnFallback,
  phpFrameworkSupportsTargetCollection,
  phpFrameworkSupportsTranslations,
  phpFrameworkSupportsValidation,
  phpFrameworkSupportsViewData,
  phpFrameworkSupportsViewDataComponentFactories,
  phpFrameworkSupportsViews,
  phpFrameworkTemplateNameFromRelativePath,
  phpFrameworkTargetSearchQueries,
  phpFrameworkTranslationLiteralTarget,
  phpFrameworkTranslationMissingTargetMessage,
  phpFrameworkTranslationKeysFromSource,
  phpFrameworkTranslationReferenceAt,
  phpFrameworkTranslationTargetFromSource,
  phpFrameworkValidationRuleCompletions,
  phpFrameworkValidationRuleReferenceAt,
  phpFrameworkViewDataEntryFromSource,
  phpFrameworkViewDataSearchQueries,
  phpFrameworkViewLiteralTarget,
  phpFrameworkViewMissingTargetMessage,
  phpFrameworkViewReferenceAt,
  type PhpFrameworkProvider,
  type PhpFrameworkSourceContext,
} from "./phpFrameworkProviders";

import {
  detectLaravelRouteModelBindingAt,
  explicitLaravelRouteModelBindingClassName,
} from "./laravelRouteModelBinding";
import {
  phpEventServiceProviderClassNames,
  phpLaravelDispatchTargetAt,
  phpLaravelEventListenerMap,
} from "./phpLaravelDispatch";
import { NETTE_VIEW_DATA_SEARCH_QUERIES } from "./netteViewData";
import {
  netteTranslationKeysFromSource,
  netteTranslationTargetFromSource,
} from "./netteTranslations";
import {
  phpLaravelApiResourceCompletionsFromSource,
  phpLaravelMacroCompletionsFromSource,
  phpLaravelModelAttributeCompletionsFromSource,
  phpLaravelMorphMapEntriesFromSource,
  phpLaravelRelationPropertyCompletionsFromSource,
} from "./phpFrameworkLaravel";
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
  phpLaravelEnvEntriesFromSource,
  phpLaravelEnvReferenceContextAt,
  phpLaravelEnvTargetFromSource,
} from "./phpLaravelEnv";
import {
  phpLaravelJsonTranslationKeysFromSource,
  phpLaravelJsonTranslationTargetFromSource,
  phpLaravelTranslationKeysFromSource,
  phpLaravelTranslationReferenceContextAt,
  phpLaravelTranslationTargetFromSource,
} from "./phpLaravelTranslations";
import { phpLaravelGateAbilityDefinitions } from "./phpLaravelAuthorization";
import { phpLaravelMiddlewareAliasDefinitions } from "./phpLaravelMiddleware";
import { phpLaravelViewReferenceContextAt } from "./phpLaravelViews";
import { bladeViewDataEntryFromSource } from "./bladeViewVariables";
import {
  BLADE_DIRECTIVES,
  bladeComponentNavigationCandidateRelativePaths,
  bladeReferenceCandidateWorkspacePaths,
  detectBladeComponentAttributeCompletionAt,
  detectBladeComponentCompletionAt,
  detectBladeDirectiveCompletionAt,
  detectBladeReferenceAt,
  isInsideBladeComment,
} from "./bladeNavigation";
import {
  phpLaravelValidationRuleCompletions,
  phpLaravelValidationRuleStringContextAt,
} from "./phpLaravelValidation";
import { detectLaravelStringLiteralHelper } from "./laravelStringLiteralHelpers";
import {
  resolveLaravelConfigTarget,
  resolveLaravelEnvTarget,
  resolveLaravelTransTarget,
  resolveLaravelViewTarget,
} from "./laravelPathResolution";
import { phpLaravelScopedStringCompletionContextAt } from "./phpLaravelScopedCompletions";
import {
  detectPhpPresenterLinkAt,
  nettePresenterLinkCompletionContextAt,
} from "./latteLinkNavigation";
import type { PhpProjectDescriptor } from "./workspace";

function phpLaravelMemberCompletionsFromSource(
  source: string,
  declaringClassName: string,
  providers: readonly PhpFrameworkProvider[],
  sourceContext?: PhpFrameworkSourceContext,
) {
  if (!providers.includes(phpLaravelFrameworkProvider)) {
    return [];
  }

  return [
    ...phpLaravelMacroCompletionsFromSource(
      source,
      declaringClassName,
      sourceContext?.workspaceSources,
    ),
    ...phpLaravelModelAttributeCompletionsFromSource(
      source,
      declaringClassName,
      sourceContext?.workspaceSources,
    ),
    ...phpLaravelRelationPropertyCompletionsFromSource(
      source,
      declaringClassName,
    ),
    ...phpLaravelApiResourceCompletionsFromSource(source, declaringClassName),
  ];
}

const SHIPPED_FRAMEWORK_PROVIDERS = [
  phpLaravelFrameworkProvider,
  phpNetteFrameworkProvider,
] as const;

describe("phpFrameworkProviders", () => {
  const queryCallbackSource = `<?php
Post::query()->whereHas('comments', function ($query): void {
    $query->where('active', true);
});
`;
  const queryCallbackPosition = positionAfter(
    queryCallbackSource,
    "$query->where",
  );

  it("keeps active-document diagnostics open to future framework languages", () => {
    const symfonyDiagnostics = definePhpFrameworkActiveDocumentDiagnostics([
      {
        kind: "twigTemplateReferences",
        language: "twig",
      },
    ] as const);
    const symfonyProvider: PhpFrameworkProvider = {
      id: "symfony",
      activeDocumentDiagnostics: symfonyDiagnostics,
    };

    expectTypeOf(
      symfonyDiagnostics[0].kind,
    ).toEqualTypeOf<"twigTemplateReferences">();
    expectTypeOf(symfonyDiagnostics[0].language).toEqualTypeOf<"twig">();
    expect(symfonyProvider.activeDocumentDiagnostics).toEqual([
      {
        kind: "twigTemplateReferences",
        language: "twig",
      },
    ]);
    expect(phpLaravelFrameworkProvider.activeDocumentDiagnostics).toEqual([
      {
        kind: "bladeViewReferences",
        language: "blade",
      },
    ]);
    expect(phpNetteFrameworkProvider.activeDocumentDiagnostics).toEqual([
      {
        kind: "latteTemplateReferences",
        language: "latte",
      },
      {
        kind: "lattePresenterLinks",
        language: "latte",
      },
    ]);
  });

  it("dispatches query-callback context only through an active provider capability", () => {
    expect(
      phpFrameworkQueryCallbackContextForVariable(
        queryCallbackSource,
        queryCallbackPosition,
        "query",
        [phpLaravelFrameworkProvider],
      ),
    ).toEqual({
      methodName: "whereHas",
      modelClassName: null,
      receiverExpression: "Post::query()",
      relationName: "comments",
    });

    const inertCustomProvider: PhpFrameworkProvider = { id: "custom" };

    for (const providers of [
      [],
      [phpNetteFrameworkProvider],
      [inertCustomProvider],
    ]) {
      expect(
        phpFrameworkQueryCallbackContextForVariable(
          queryCallbackSource,
          queryCallbackPosition,
          "query",
          providers,
        ),
      ).toBeNull();
    }
  });

  it("uses provider order as first-match precedence for query callbacks", () => {
    const firstMatch = {
      methodName: "customWhere",
      modelClassName: "CustomModel",
      receiverExpression: null,
      relationName: "customRelation",
    };
    const customProvider: PhpFrameworkProvider = {
      id: "custom-query-callbacks",
      semantics: {
        queryCallbackContextForVariable: () => firstMatch,
      },
    };

    expect(
      phpFrameworkQueryCallbackContextForVariable(
        queryCallbackSource,
        queryCallbackPosition,
        "query",
        [customProvider, phpLaravelFrameworkProvider],
      ),
    ).toBe(firstMatch);
  });

  it("dispatches same-source method return fallback suppression by provider", () => {
    const inertCustomProvider: PhpFrameworkProvider = { id: "custom" };

    expect(
      phpFrameworkSuppressesSameSourceMethodReturnFallback("findOrFail", [
        phpLaravelFrameworkProvider,
      ]),
    ).toBe(true);
    expect(
      phpFrameworkSuppressesSameSourceMethodReturnFallback("findOrFail", [
        phpNetteFrameworkProvider,
      ]),
    ).toBe(false);
    expect(
      phpFrameworkSuppressesSameSourceMethodReturnFallback("findOrFail", [
        inertCustomProvider,
      ]),
    ).toBe(false);
    expect(
      phpFrameworkSuppressesSameSourceMethodReturnFallback("findOrFail", []),
    ).toBe(false);
    expect(
      phpFrameworkSuppressesSameSourceMethodReturnFallback("firstOrFail", [
        phpLaravelFrameworkProvider,
      ]),
    ).toBe(false);
  });

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
      phpLaravelMemberCompletionsFromSource(source, "Comment", [
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

    expect(
      phpLaravelMemberCompletionsFromSource(source, "Comment", []),
    ).toEqual([]);
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
      phpFrameworkPropertyTypeFromSource(
        source,
        "type",
        [phpLaravelFrameworkProvider],
        "Comment",
      ),
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
      isKnownPhpFrameworkMemberMethod(
        source,
        "Album::query()",
        "whereNull",
        [],
      ),
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
    ).toBe(
      "Illuminate\\Database\\Eloquent\\Collection<int, App\\Models\\Album>",
    );
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
        phpLaravelMemberCompletionsFromSource(
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
        phpLaravelMemberCompletionsFromSource(
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
      ).toBe("Illuminate\\Http\\Resources\\Json\\AnonymousResourceCollection");
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

  it("supports framework-specific diagnostics without changing the core parser", () => {
    const netteProvider: PhpFrameworkProvider = {
      id: "nette",
      diagnostics: {
        isKnownMemberMethod: ({ methodName }) => methodName === "whereMagic",
        isKnownStaticMethod: ({ methodName }) => methodName === "whereMagic",
      },
    };

    expect(
      isKnownPhpFrameworkStaticMethod("<?php", "Article", "whereMagic", [
        netteProvider,
      ]),
    ).toBe(true);
    expect(
      isKnownPhpFrameworkMemberMethod(
        "<?php",
        "Article::query()",
        "whereMagic",
        [netteProvider],
      ),
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
        SHIPPED_FRAMEWORK_PROVIDERS,
      ),
    ).toEqual([phpLaravelFrameworkProvider]);
    expect(
      phpFrameworkProvidersForProject(
        phpProjectDescriptor({
          packageName: "custom/api",
          packages: [{ name: "laravel/framework" }],
        }),
        SHIPPED_FRAMEWORK_PROVIDERS,
      ),
    ).toEqual([phpLaravelFrameworkProvider]);
    expect(
      phpFrameworkProvidersForProject(
        phpProjectDescriptor({
          packageName: "symfony/app",
          packages: [{ name: "symfony/framework-bundle" }],
        }),
        SHIPPED_FRAMEWORK_PROVIDERS,
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
          (composerPackage) =>
            composerPackage.name === "symfony/framework-bundle",
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
      return phpLaravelMemberCompletionsFromSource(
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
        completions.map((completion) => [
          completion.name,
          completion.returnType,
        ]),
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
        phpLaravelMemberCompletionsFromSource(
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

    it("activates only for Nette projects in an explicitly supplied catalog", () => {
      expect(phpNetteFrameworkProvider.appliesTo?.(netteDescriptor)).toBe(true);
      expect(phpLaravelFrameworkProvider.appliesTo?.(netteDescriptor)).toBe(
        false,
      );
      expect(
        phpFrameworkProvidersForProject(
          netteDescriptor,
          SHIPPED_FRAMEWORK_PROVIDERS,
        ),
      ).toEqual([phpNetteFrameworkProvider]);
    });

    it("stays inert through the dispatchers it does not implement", () => {
      const providers = [phpNetteFrameworkProvider];

      expect(
        phpLaravelMemberCompletionsFromSource("<?php", "Article", providers),
      ).toEqual([]);
      expect(
        isKnownPhpFrameworkStaticMethod(
          "<?php",
          "Article",
          "render",
          providers,
        ),
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

    it("declares Latte expression-data invalidation", () => {
      expect(phpNetteFrameworkProvider.fileChangeInvalidations).toContainEqual({
        kind: "latteExpressionData",
      });
    });
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
          variables: [expect.objectContaining({ name: "$product" })],
        },
      ]);
    });

    it("exposes Nette NEON config intelligence through the provider capability", () => {
      expect(phpFrameworkSupportsNeonConfigIntelligence(providers)).toBe(true);
      expect(phpFrameworkSupportsNeonConfigIntelligence([])).toBe(false);
      expect(
        phpFrameworkSupportsNeonConfigIntelligence([
          phpLaravelFrameworkProvider,
        ]),
      ).toBe(false);
    });

    it("exposes Nette Latte template intelligence through the provider capability", () => {
      expect(phpFrameworkSupportsLatteTemplateIntelligence(providers)).toBe(
        true,
      );
      expect(
        phpFrameworkSupportsLattePresenterLinkIntelligence(providers),
      ).toBe(true);
      expect(phpFrameworkSupportsLatteTemplateIntelligence([])).toBe(false);
      expect(phpFrameworkSupportsLattePresenterLinkIntelligence([])).toBe(
        false,
      );
      expect(
        phpFrameworkSupportsLatteTemplateIntelligence([
          phpLaravelFrameworkProvider,
        ]),
      ).toBe(false);
      expect(
        phpFrameworkSupportsLattePresenterLinkIntelligence([
          phpLaravelFrameworkProvider,
        ]),
      ).toBe(false);
    });

    it("lets custom providers opt into Latte template and presenter-link intelligence independently", () => {
      const templateOnlyProvider: PhpFrameworkProvider = {
        id: "latte-template-only",
        latte: {
          supportsTemplateIntelligence: true,
        },
      };
      const presenterLinkProvider: PhpFrameworkProvider = {
        id: "latte-presenter-links",
        latte: {
          supportsPresenterLinkIntelligence: true,
          supportsTemplateIntelligence: true,
        },
      };
      const noLatteProvider: PhpFrameworkProvider = {
        id: "no-latte",
      };

      expect(
        phpFrameworkSupportsLatteTemplateIntelligence([templateOnlyProvider]),
      ).toBe(true);
      expect(
        phpFrameworkSupportsLattePresenterLinkIntelligence([
          templateOnlyProvider,
        ]),
      ).toBe(false);
      expect(
        phpFrameworkSupportsLatteTemplateIntelligence([presenterLinkProvider]),
      ).toBe(true);
      expect(
        phpFrameworkSupportsLattePresenterLinkIntelligence([
          presenterLinkProvider,
        ]),
      ).toBe(true);
      expect(
        phpFrameworkSupportsLatteTemplateIntelligence([noLatteProvider]),
      ).toBe(false);
      expect(
        phpFrameworkSupportsLattePresenterLinkIntelligence([noLatteProvider]),
      ).toBe(false);
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

    it("downgrades SmartObject @property access through the Nette provider", () => {
      const smartObjectSource = `<?php
use Nette\\SmartObject;

/**
 * @property-read string $label
 */
class ProductPresenter extends Nette\\Application\\UI\\Presenter
{
    use SmartObject;
}
`;

      expect(
        phpFrameworkMemberPropertyMagicDiagnostic(
          smartObjectSource,
          "$this",
          "label",
          providers,
        ),
      ).toEqual({ source: NETTE_MAGIC_DIAGNOSTIC_SOURCE });
      expect(
        phpFrameworkMemberPropertyMagicDiagnostic(
          smartObjectSource,
          "$this",
          "missing",
          providers,
        ),
      ).toBeNull();
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
      expect(phpLaravelFrameworkProvider.diagnostics?.magicSource).toBe(
        "laravel-magic",
      );
    });
  });

  describe("exclusive framework provider resolution", () => {
    it("exposes active framework identity through the capability registry", () => {
      const registry = createPhpFrameworkProviderCapabilityRegistry([
        phpNetteFrameworkProvider,
      ]);

      expect(registry.hasProvider("nette")).toBe(true);
      expect(registry.hasProvider("laravel")).toBe(false);
    });

    it("reports code-action support only for providers shipping the capability", () => {
      expect(
        createPhpFrameworkProviderCapabilityRegistry([
          phpLaravelFrameworkProvider,
        ]).supports("codeActions"),
      ).toBe(true);
      expect(
        createPhpFrameworkProviderCapabilityRegistry([
          phpNetteFrameworkProvider,
        ]).supports("codeActions"),
      ).toBe(true);
      expect(
        createPhpFrameworkProviderCapabilityRegistry([
          { id: "custom" },
        ]).supports("codeActions"),
      ).toBe(false);
    });

    it("accepts adapter-owned capability tokens without changing the facade", () => {
      const symfonyMessenger = definePhpFrameworkCapability<
        PhpFrameworkProvider,
        "symfonyMessenger"
      >("symfonyMessenger", (provider) => provider.id === "symfony");
      const registry = createPhpFrameworkProviderCapabilityRegistry(
        [{ id: "symfony" }],
        [symfonyMessenger],
      );

      expect(registry.supports("symfonyMessenger")).toBe(true);
      expect(registry.supports("futureCapability")).toBe(false);
    });

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
        SHIPPED_FRAMEWORK_PROVIDERS,
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
        SHIPPED_FRAMEWORK_PROVIDERS,
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
        SHIPPED_FRAMEWORK_PROVIDERS,
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
          SHIPPED_FRAMEWORK_PROVIDERS,
        ),
      ).toEqual([]);
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

    it("dispatches Laravel route model binding detection 1:1 through the provider", () => {
      const source = `<?php
use Illuminate\\Support\\Facades\\Route;

Route::get('/users/{user}', fn () => null);
`;
      const offset = source.indexOf("{user}") + 2;
      const direct = detectLaravelRouteModelBindingAt(source, offset);

      expect(direct).not.toBeNull();
      expect(
        phpFrameworkRouteModelBindingAt(source, offset, [
          phpLaravelFrameworkProvider,
        ]),
      ).toEqual(direct);
      expect(
        phpFrameworkRouteModelBindingAt(source, offset, [
          phpNetteFrameworkProvider,
        ]),
      ).toBeNull();
      expect(phpFrameworkRouteModelBindingAt(source, offset, [])).toBeNull();
    });

    it("dispatches Laravel explicit route model bindings and model namespaces through the provider", () => {
      const source = `<?php
use App\\Models\\AdminUser;
use Illuminate\\Support\\Facades\\Route;

Route::model('user', AdminUser::class);
`;
      const direct = explicitLaravelRouteModelBindingClassName(source, "user");
      const php = phpProjectDescriptor({
        psr4Roots: [{ dev: false, namespace: "Domain\\", paths: ["app"] }],
      });

      expect(direct).toBe("AdminUser");
      expect(
        phpFrameworkExplicitRouteModelBindingClassName(source, "user", [
          phpLaravelFrameworkProvider,
        ]),
      ).toBe(direct);
      expect(
        phpFrameworkExplicitRouteModelBindingClassName(source, "user", [
          phpNetteFrameworkProvider,
        ]),
      ).toBeNull();
      expect(
        phpFrameworkModelNamespacePrefixes(php, [phpLaravelFrameworkProvider]),
      ).toEqual(["Domain\\Models\\", "Domain\\", "App\\Models\\", "App\\"]);
      expect(phpFrameworkModelNamespacePrefixes(php, [])).toEqual([]);
    });

    it("exposes explicit route model-binding search anchors through the provider", () => {
      expect(
        phpFrameworkExplicitRouteModelBindingSearchQueries([
          phpLaravelFrameworkProvider,
        ]),
      ).toEqual(["Route::model", "Route::bind"]);
      expect(
        phpFrameworkExplicitRouteModelBindingSearchQueries([
          phpNetteFrameworkProvider,
        ]),
      ).toEqual([]);
      expect(phpFrameworkExplicitRouteModelBindingSearchQueries([])).toEqual(
        [],
      );
    });

    it("exposes the Laravel route search anchors through the provider", () => {
      const queries = phpFrameworkRouteSearchQueries([
        phpLaravelFrameworkProvider,
      ]);

      expect(queries).toContain("->name(");
      expect(queries).toContain("Route::resource");
      expect(queries).toContain("Route::apiResources");
      expect(
        phpFrameworkTargetSearchQueries("routes", [
          phpLaravelFrameworkProvider,
        ]),
      ).toEqual(queries);
      expect(
        phpFrameworkSupportsTargetCollection("routes", [
          phpLaravelFrameworkProvider,
        ]),
      ).toBe(true);
    });

    it("reports dispatch support through the Laravel provider", () => {
      expect(phpFrameworkSupportsDispatch([phpLaravelFrameworkProvider])).toBe(
        true,
      );
      expect(phpFrameworkSupportsDispatch([phpNetteFrameworkProvider])).toBe(
        false,
      );
      expect(phpFrameworkSupportsDispatch([])).toBe(false);
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

    it("summarizes route capabilities through the provider capability registry", () => {
      const laravelRegistry = createPhpFrameworkProviderCapabilityRegistry([
        phpLaravelFrameworkProvider,
      ]);
      const netteRegistry = createPhpFrameworkProviderCapabilityRegistry([
        phpNetteFrameworkProvider,
      ]);

      expect(laravelRegistry.providerSignature).toBe("laravel");
      expect(laravelRegistry.supports("routes")).toBe(true);
      expect(laravelRegistry.supportsTargetCollection("routes")).toBe(true);
      expect(netteRegistry.providerSignature).toBe("nette");
      expect(netteRegistry.supports("routes")).toBe(false);
      expect(netteRegistry.supportsTargetCollection("routes")).toBe(false);
    });

    it("reports container binding source ownership for configured providers", () => {
      const frameworkCapabilityDefinitions = [
        ...phpLaravelFrameworkCapabilityDefinitions,
        ...phpNetteFrameworkCapabilityDefinitions,
      ];
      const laravelRegistry = createPhpFrameworkProviderCapabilityRegistry([
        phpLaravelFrameworkProvider,
      ], frameworkCapabilityDefinitions);
      const netteRegistry = createPhpFrameworkProviderCapabilityRegistry([
        phpNetteFrameworkProvider,
      ], frameworkCapabilityDefinitions);
      const genericRegistry = createPhpFrameworkProviderCapabilityRegistry(
        [],
        frameworkCapabilityDefinitions,
      );

      expect(laravelRegistry.supports("containerBindingsFromSource")).toBe(
        true,
      );
      expect(netteRegistry.supports("containerBindingsFromSource")).toBe(true);
      expect(genericRegistry.supports("containerBindingsFromSource")).toBe(
        false,
      );
      expect(laravelRegistry.supports("eloquentModelSemantics")).toBe(true);
      expect(netteRegistry.supports("eloquentModelSemantics")).toBe(false);
      expect(genericRegistry.supports("eloquentModelSemantics")).toBe(false);
      expect(laravelRegistry.supports("netteDatabaseSemantics")).toBe(false);
      expect(netteRegistry.supports("netteDatabaseSemantics")).toBe(true);
      expect(genericRegistry.supports("netteDatabaseSemantics")).toBe(false);
      expect(
        laravelRegistry.supports("netteRedrawControlSnippetCompletions"),
      ).toBe(false);
      expect(
        netteRegistry.supports("netteRedrawControlSnippetCompletions"),
      ).toBe(true);
      expect(
        genericRegistry.supports("netteRedrawControlSnippetCompletions"),
      ).toBe(false);
      expect(
        phpFrameworkSupportsContainerBindingsFromSource([
          phpLaravelFrameworkProvider,
        ]),
      ).toBe(true);
      expect(
        phpFrameworkSupportsContainerBindingsFromSource([
          phpNetteFrameworkProvider,
        ]),
      ).toBe(true);
      expect(phpFrameworkSupportsContainerBindingsFromSource([])).toBe(false);
      expect(
        isPhpFrameworkContainerBindingCandidatePath(
          "/workspace/app/Providers/AppServiceProvider.php",
          [phpLaravelFrameworkProvider],
        ),
      ).toBe(true);
      expect(
        isPhpFrameworkContainerBindingCandidatePath(
          "/workspace/app/Providers/AppServiceProvider.php",
          [phpNetteFrameworkProvider],
        ),
      ).toBe(false);
      expect(
        isPhpFrameworkContainerBindingCandidatePath(
          "/workspace/config/services.neon",
          [phpNetteFrameworkProvider],
        ),
      ).toBe(true);
      expect(
        isPhpFrameworkContainerBindingCandidatePath(
          "/workspace/app/Services/Unrelated.php",
          [phpLaravelFrameworkProvider],
        ),
      ).toBe(false);
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

    it("keeps an explicit empty target-capability provider set inert", () => {
      expect(
        phpFrameworkRouteReferenceAt(referenceSource, referencePosition, []),
      ).toBeNull();
      expect(
        phpFrameworkRouteDefinitionsFromSource(definitionSource, []),
      ).toEqual([]);
      expect(phpFrameworkRouteSearchQueries([])).toEqual([]);
      expect(phpFrameworkSupportsRoutes([])).toBe(false);
      expect(phpFrameworkTargetSearchQueries("routes", [])).toEqual([]);
      expect(phpFrameworkSupportsTargetCollection("routes", [])).toBe(false);
      expect(phpFrameworkViewDataSearchQueries([])).toEqual([]);
      expect(phpFrameworkSupportsViewData([])).toBe(false);
    });

    it("supports generic target collection descriptors and legacy query fields", () => {
      const descriptorProvider: PhpFrameworkProvider = {
        id: "descriptor",
        targetCollections: [
          { kind: "routes", searchQueries: ["route-anchor"] },
          { kind: "viewData", searchQueries: ["view-anchor"] },
        ],
      };
      const legacyProvider: PhpFrameworkProvider = {
        id: "legacy",
        routes: {
          searchQueries: ["legacy-route-anchor"],
        },
      };

      expect(
        phpFrameworkTargetSearchQueries("routes", [
          descriptorProvider,
          legacyProvider,
        ]),
      ).toEqual(["route-anchor", "legacy-route-anchor"]);
      expect(
        phpFrameworkTargetSearchQueries("viewData", [
          descriptorProvider,
          legacyProvider,
        ]),
      ).toEqual(["view-anchor"]);
      expect(
        phpFrameworkSupportsTargetCollection("routes", [
          descriptorProvider,
          legacyProvider,
        ]),
      ).toBe(true);
      expect(
        phpFrameworkSupportsTargetCollection("viewData", [legacyProvider]),
      ).toBe(false);
    });
  });

  describe("authorization ability capability", () => {
    const source = `<?php

Gate::define('update-post', [PostPolicy::class, 'update']);
Gate::define('delete-post', fn ($user) => $user->isAdmin());
`;

    it("dispatches Laravel Gate ability definitions 1:1 through the provider", () => {
      expect(
        phpFrameworkAuthorizationAbilityDefinitionsFromSource(source, [
          phpLaravelFrameworkProvider,
        ]),
      ).toEqual(phpLaravelGateAbilityDefinitions(source));
    });

    it("exposes authorization ability search anchors through the provider", () => {
      expect(
        phpFrameworkAuthorizationAbilitySearchQueries([
          phpLaravelFrameworkProvider,
        ]),
      ).toEqual(["Gate::define"]);
      expect(
        phpFrameworkAuthorizationAbilitySearchQueries([
          phpNetteFrameworkProvider,
        ]),
      ).toEqual([]);
    });

    it("reports authorization ability support only for providers shipping the capability", () => {
      expect(
        phpFrameworkSupportsAuthorizationAbilities([
          phpLaravelFrameworkProvider,
        ]),
      ).toBe(true);
      expect(
        phpFrameworkSupportsAuthorizationAbilities([phpNetteFrameworkProvider]),
      ).toBe(false);
      expect(phpFrameworkSupportsAuthorizationAbilities([])).toBe(false);
    });

    it("stays a safe no-op without the capability", () => {
      expect(
        phpFrameworkAuthorizationAbilityDefinitionsFromSource(source, [
          phpNetteFrameworkProvider,
        ]),
      ).toEqual([]);
      expect(phpFrameworkAuthorizationAbilitySearchQueries([])).toEqual([]);
    });
  });

  describe("middleware alias capability", () => {
    const source = `<?php

class Kernel {
    protected $middlewareAliases = [
        'auth' => Authenticate::class,
    ];
}
`;

    it("dispatches Laravel middleware alias definitions 1:1 through the provider", () => {
      expect(
        phpFrameworkMiddlewareAliasDefinitionsFromSource(source, [
          phpLaravelFrameworkProvider,
        ]),
      ).toEqual(phpLaravelMiddlewareAliasDefinitions(source));
    });

    it("exposes middleware alias search anchors through the provider", () => {
      expect(
        phpFrameworkMiddlewareAliasSearchQueries([phpLaravelFrameworkProvider]),
      ).toEqual(["middlewareAliases", "routeMiddleware"]);
      expect(
        phpFrameworkMiddlewareAliasSearchQueries([phpNetteFrameworkProvider]),
      ).toEqual([]);
    });

    it("reports middleware alias support only for providers shipping the capability", () => {
      expect(
        phpFrameworkSupportsMiddlewareAliases([phpLaravelFrameworkProvider]),
      ).toBe(true);
      expect(
        phpFrameworkSupportsMiddlewareAliases([phpNetteFrameworkProvider]),
      ).toBe(false);
      expect(phpFrameworkSupportsMiddlewareAliases([])).toBe(false);
    });

    it("stays a safe no-op without the capability", () => {
      expect(
        phpFrameworkMiddlewareAliasDefinitionsFromSource(source, [
          phpNetteFrameworkProvider,
        ]),
      ).toEqual([]);
      expect(phpFrameworkMiddlewareAliasSearchQueries([])).toEqual([]);
    });
  });

  describe("dispatch capability", () => {
    const providers = [phpLaravelFrameworkProvider];
    const dispatchSource = `<?php
use App\\Jobs\\SyncOrder;

dispatch(new SyncOrder());
`;
    const listenerProviderSource = `<?php
namespace App\\Providers;

use App\\Events\\OrderSynced;
use App\\Listeners\\SendOrderSyncedNotification;

class EventServiceProvider
{
    protected $listen = [
        OrderSynced::class => [
            SendOrderSyncedNotification::class,
        ],
    ];
}
`;

    it("dispatches Laravel dispatch targets 1:1 through the provider", () => {
      const offset = dispatchSource.indexOf("SyncOrder())") + 2;
      const direct = phpLaravelDispatchTargetAt(dispatchSource, offset);

      expect(direct).not.toBeNull();
      expect(
        phpFrameworkDispatchTargetAt(dispatchSource, offset, providers),
      ).toEqual(direct);
      expect(
        phpFrameworkDispatchTargetAt(dispatchSource, offset, [
          phpNetteFrameworkProvider,
        ]),
      ).toBeNull();
      expect(
        phpFrameworkDispatchTargetAt(dispatchSource, offset, []),
      ).toBeNull();
    });

    it("dispatches Laravel event listener maps 1:1 through the provider", () => {
      const direct = phpLaravelEventListenerMap(listenerProviderSource);

      expect(direct.size).toBeGreaterThan(0);
      expect(
        phpFrameworkEventListenerMapFromSource(
          listenerProviderSource,
          providers,
        ),
      ).toEqual(direct);
      expect(
        phpFrameworkEventListenerMapFromSource(listenerProviderSource, [
          phpNetteFrameworkProvider,
        ]),
      ).toEqual(new Map());
      expect(
        phpFrameworkEventListenerMapFromSource(listenerProviderSource, []),
      ).toEqual(new Map());
    });

    it("dispatches Laravel event service provider class candidates through the provider", () => {
      const php = phpProjectDescriptor({
        psr4Roots: [{ dev: false, namespace: "Domain\\", paths: ["app"] }],
      });

      expect(
        phpFrameworkEventServiceProviderClassNames(php, providers),
      ).toEqual(phpEventServiceProviderClassNames(php));
      expect(
        phpFrameworkEventServiceProviderClassNames(php, [
          phpNetteFrameworkProvider,
        ]),
      ).toEqual([]);
      expect(phpFrameworkEventServiceProviderClassNames(php, [])).toEqual([]);
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
        phpFrameworkConfigTargetFromSource(
          configFileSource,
          "app",
          "app.name",
          [phpLaravelFrameworkProvider],
        ),
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
        phpFrameworkConfigTargetFromSource(
          configFileSource,
          "app",
          "app.name",
          [phpNetteFrameworkProvider],
        ),
      ).toBeNull();
      // Empty provider set: dispatchers stay inert (no active framework).
      expect(
        phpFrameworkConfigReferenceAt(referenceSource, referencePosition, []),
      ).toBeNull();
      expect(
        phpFrameworkConfigKeysFromSource(configFileSource, "app", []),
      ).toEqual([]);
      expect(
        phpFrameworkConfigTargetFromSource(
          configFileSource,
          "app",
          "app.name",
          [],
        ),
      ).toBeNull();
    });
  });

  describe("env capability", () => {
    const referenceSource = "<?php\n\nreturn env('APP_NAME');\n";
    const referencePosition = { column: 21, lineNumber: 3 };
    const envSource = "APP_ENV=local\nAPP_NAME=Codevo\n";

    it("dispatches Laravel env references 1:1 through the provider", () => {
      const direct = phpLaravelEnvReferenceContextAt(
        referenceSource,
        referencePosition,
      );

      expect(direct).not.toBeNull();
      expect(
        phpFrameworkEnvReferenceAt(referenceSource, referencePosition, [
          phpLaravelFrameworkProvider,
        ]),
      ).toEqual(direct);
    });

    it("dispatches Laravel env entries and targets 1:1 through the provider", () => {
      const directEntries = phpLaravelEnvEntriesFromSource(envSource);
      const directTarget = phpLaravelEnvTargetFromSource(envSource, "APP_ENV");

      expect(directEntries.length).toBeGreaterThan(0);
      expect(directTarget).not.toBeNull();
      expect(
        phpFrameworkEnvEntriesFromSource(envSource, [
          phpLaravelFrameworkProvider,
        ]),
      ).toEqual(directEntries);
      expect(
        phpFrameworkEnvTargetFromSource(envSource, "APP_ENV", [
          phpLaravelFrameworkProvider,
        ]),
      ).toEqual(directTarget);
    });

    it("resolves env targets from provider entries when no target parser is supplied", () => {
      const provider: PhpFrameworkProvider = {
        id: "entries-only-env",
        env: {
          entriesFromSource: ({ source }) =>
            source.split("\n").flatMap((line, lineIndex) =>
              line.startsWith("entry:")
                ? [
                    {
                      name: line.slice("entry:".length),
                      position: { column: 7, lineNumber: lineIndex + 1 },
                    },
                  ]
                : [],
            ),
        },
      };

      expect(
        phpFrameworkEnvTargetFromSource("entry:APP_ENV\n", "APP_ENV", [
          provider,
        ]),
      ).toEqual({
        name: "APP_ENV",
        position: { column: 7, lineNumber: 1 },
      });
    });

    it("reports env support only for providers shipping the capability", () => {
      expect(phpFrameworkSupportsEnv([phpLaravelFrameworkProvider])).toBe(true);
      expect(phpFrameworkSupportsEnv([phpNetteFrameworkProvider])).toBe(false);
      expect(phpFrameworkSupportsEnv([])).toBe(false);
    });

    it("stays a safe no-op for providers without the env capability", () => {
      expect(
        phpFrameworkEnvReferenceAt(referenceSource, referencePosition, [
          phpNetteFrameworkProvider,
        ]),
      ).toBeNull();
      expect(
        phpFrameworkEnvEntriesFromSource(envSource, [
          phpNetteFrameworkProvider,
        ]),
      ).toEqual([]);
      expect(
        phpFrameworkEnvTargetFromSource(envSource, "APP_ENV", [
          phpNetteFrameworkProvider,
        ]),
      ).toBeNull();
      expect(
        phpFrameworkEnvReferenceAt(referenceSource, referencePosition, []),
      ).toBeNull();
      expect(phpFrameworkEnvEntriesFromSource(envSource, [])).toEqual([]);
      expect(
        phpFrameworkEnvTargetFromSource(envSource, "APP_ENV", []),
      ).toBeNull();
    });
  });

  describe("translations capability", () => {
    const referenceSource = "<?php\n\nreturn __('messages.welcome');\n";
    const referencePosition = { column: 18, lineNumber: 3 };
    const langFileSource = "<?php\n\nreturn [\n    'welcome' => 'Hi',\n];\n";
    const jsonLangSource = '{\n  "Welcome": "Vitajte"\n}\n';
    const neonLangSource = "foo: Foo\nnested:\n  bar: Bar\n";

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
      ).toBe(true);
      expect(phpFrameworkSupportsTranslations([])).toBe(false);
    });

    it("dispatches Nette NEON translation keys through the provider", () => {
      const fileName = "app/modules/usersModule/lang/users.cs_CZ.neon";
      const direct = netteTranslationKeysFromSource(neonLangSource, fileName);

      expect(direct.length).toBeGreaterThan(0);
      expect(
        phpFrameworkTranslationKeysFromSource(neonLangSource, fileName, [
          phpNetteFrameworkProvider,
        ]),
      ).toEqual(direct);
    });

    it("dispatches Nette NEON translation targets through the provider", () => {
      const fileName = "app/modules/usersModule/lang/users.cs_CZ.neon";
      const direct = netteTranslationTargetFromSource(
        neonLangSource,
        fileName,
        "users.nested.bar",
      );

      expect(direct).not.toBeNull();
      expect(
        phpFrameworkTranslationTargetFromSource(
          neonLangSource,
          fileName,
          "users.nested.bar",
          [phpNetteFrameworkProvider],
        ),
      ).toEqual(direct);
    });

    it("dispatches Nette PHP translator references through the real provider", () => {
      const source =
        "<?php\nreturn $this->translator->translate('users.component.user_tokens.header');";
      const position = positionAfter(source, "user_tokens");

      expect(
        phpFrameworkTranslationReferenceAt(source, position, [
          phpNetteFrameworkProvider,
        ]),
      ).toEqual({
        call: "translate",
        key: "users.component.user_tokens.header",
        position: positionAfter(source, "translate('"),
        prefix: "users.component.user_tokens",
      });
    });

    it("keeps unsupported JSON translation dispatchers as safe no-ops for Nette", () => {
      expect(
        phpFrameworkTranslationReferenceAt(referenceSource, referencePosition, [
          phpNetteFrameworkProvider,
        ]),
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
    });

    it("stays a safe no-op with an empty provider set", () => {
      // Empty provider set: dispatchers stay inert (no active framework).
      expect(
        phpFrameworkTranslationReferenceAt(
          referenceSource,
          referencePosition,
          [],
        ),
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

    it("dispatches Laravel template names from relative paths through the provider", () => {
      expect(
        phpFrameworkTemplateNameFromRelativePath(
          "resources/views/users/index.blade.php",
          [phpLaravelFrameworkProvider],
        ),
      ).toBe("users.index");
      expect(
        phpFrameworkTemplateNameFromRelativePath(
          "storage/framework/views/a.php",
          [phpLaravelFrameworkProvider],
        ),
      ).toBeNull();
    });

    it("reports view support only for providers shipping the capability", () => {
      expect(phpFrameworkSupportsViews([phpLaravelFrameworkProvider])).toBe(
        true,
      );
      expect(phpFrameworkSupportsViews([phpNetteFrameworkProvider])).toBe(
        false,
      );
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
      expect(
        phpFrameworkTemplateNameFromRelativePath(
          "resources/views/users/index.blade.php",
          [phpNetteFrameworkProvider],
        ),
      ).toBeNull();
      expect(
        phpFrameworkTemplateNameFromRelativePath(
          "resources/views/users/index.blade.php",
          [],
        ),
      ).toBeNull();
    });
  });

  describe("blade capability", () => {
    it("dispatches Blade grammar detection 1:1 through the Laravel provider", () => {
      const blade = phpLaravelFrameworkProvider.blade;

      expect(blade).toBeDefined();
      expect(
        blade?.directiveCompletionAt?.({ offset: 3, source: "@if" }),
      ).toEqual(detectBladeDirectiveCompletionAt("@if", 3));

      const includeSource = "@include('partials.alert')";
      const includeOffset = includeSource.indexOf("partials.alert") + 3;
      expect(
        blade?.referenceAt?.({ offset: includeOffset, source: includeSource }),
      ).toEqual(detectBladeReferenceAt(includeSource, includeOffset));

      const componentSource = "<x-al";
      expect(
        blade?.componentCompletionAt?.({
          offset: componentSource.length,
          source: componentSource,
        }),
      ).toEqual(
        detectBladeComponentCompletionAt(
          componentSource,
          componentSource.length,
        ),
      );

      const attributeSource = "<x-alert ty";
      expect(
        blade?.componentAttributeCompletionAt?.({
          offset: attributeSource.length,
          source: attributeSource,
        }),
      ).toEqual(
        detectBladeComponentAttributeCompletionAt(
          attributeSource,
          attributeSource.length,
        ),
      );

      const commentSource = "{{-- @if --}}";
      expect(
        blade?.isInsideComment?.({
          offset: commentSource.indexOf("@if"),
          source: commentSource,
        }),
      ).toBe(isInsideBladeComment(commentSource, commentSource.indexOf("@if")));
    });

    it("ships Laravel Blade directive names and navigation candidates on the provider", () => {
      const blade = phpLaravelFrameworkProvider.blade;

      expect(blade?.directiveNames).toEqual(BLADE_DIRECTIVES);
      expect(
        blade?.componentNavigationCandidateRelativePaths?.({
          name: "forms.text-input",
        }),
      ).toEqual(
        bladeComponentNavigationCandidateRelativePaths("forms.text-input"),
      );
      expect(
        blade?.referenceCandidateWorkspacePaths?.({
          reference: { kind: "view", name: "users.index" },
          workspaceRoot: "/ws",
        }),
      ).toEqual(
        bladeReferenceCandidateWorkspacePaths("/ws", {
          kind: "view",
          name: "users.index",
        }),
      );
    });

    it("stays undeclared on providers without Blade templating", () => {
      expect(phpNetteFrameworkProvider.blade).toBeUndefined();
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
      expect(
        phpFrameworkTargetSearchQueries("viewData", [
          phpLaravelFrameworkProvider,
        ]),
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
      expect(
        phpFrameworkSupportsTargetCollection("viewData", [
          phpNetteFrameworkProvider,
        ]),
      ).toBe(true);
      expect(phpFrameworkSupportsViewData([capabilitylessProvider])).toBe(
        false,
      );
      expect(phpFrameworkSupportsViewData([])).toBe(false);
    });

    it("reports component-factory view-data support by capability", () => {
      const capabilitylessProvider: PhpFrameworkProvider = {
        id: "nette",
        viewData: {},
      };

      expect(
        phpFrameworkSupportsViewDataComponentFactories([
          phpNetteFrameworkProvider,
        ]),
      ).toBe(true);
      expect(
        phpFrameworkSupportsViewDataComponentFactories([
          capabilitylessProvider,
        ]),
      ).toBe(false);
      expect(phpFrameworkSupportsViewDataComponentFactories([])).toBe(false);
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
      expect(
        phpFrameworkViewDataEntryFromSource(viewDataSource, []),
      ).toBeNull();
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
      expect(
        phpFrameworkSupportsValidation([phpLaravelFrameworkProvider]),
      ).toBe(true);
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
        phpFrameworkValidationRuleCompletions("req", [
          phpNetteFrameworkProvider,
        ]),
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
      const direct = detectLaravelStringLiteralHelper(
        helperSource,
        helperOffset,
      );

      expect(direct).not.toBeNull();
      expect(direct?.helper).toBe("config");
      expect(
        phpFrameworkStringLiteralHelperAt(helperSource, helperOffset, [
          phpLaravelFrameworkProvider,
        ]),
      ).toEqual({ ...direct!, providerId: "laravel" });
    });

    it("dispatches Laravel literal target admissibility 1:1 through the provider", () => {
      const providers = [phpLaravelFrameworkProvider];

      expect(phpFrameworkConfigLiteralTarget("app.name", providers)).toEqual(
        resolveLaravelConfigTarget("app.name"),
      );
      expect(
        phpFrameworkViewLiteralTarget("admin/dashboard", providers),
      ).toEqual(resolveLaravelViewTarget("admin/dashboard"));
      expect(
        phpFrameworkTranslationLiteralTarget("messages.welcome", providers),
      ).toEqual(resolveLaravelTransTarget("messages.welcome"));
      expect(phpFrameworkEnvLiteralTarget("APP_ENV", providers)).toEqual(
        resolveLaravelEnvTarget("APP_ENV"),
      );

      expect(
        phpFrameworkConfigLiteralTarget("../secrets.value", providers),
      ).toBeNull();
      expect(
        phpFrameworkViewLiteralTarget("package::admin.dashboard", providers),
      ).toBeNull();
      expect(
        phpFrameworkTranslationLiteralTarget(
          "package::messages.welcome",
          providers,
        ),
      ).toBeNull();
      expect(phpFrameworkEnvLiteralTarget("APP ENV", providers)).toBeNull();
    });

    it("gets Laravel missing literal target messages from the provider", () => {
      const providers = [phpLaravelFrameworkProvider];

      expect(
        phpFrameworkRouteMissingTargetMessage("dashboard", providers),
      ).toBe("No Laravel route named dashboard found.");
      expect(
        phpFrameworkConfigMissingTargetMessage("app.name", providers),
      ).toBe("No Laravel config key app.name found.");
      expect(phpFrameworkEnvMissingTargetMessage("APP_URL", providers)).toBe(
        "No Laravel env key APP_URL found.",
      );
      expect(
        phpFrameworkTranslationMissingTargetMessage(
          "messages.welcome",
          providers,
        ),
      ).toBe("No Laravel translation key messages.welcome found.");
      expect(
        phpFrameworkViewMissingTargetMessage("dashboard.index", providers),
      ).toBe("No Laravel view named dashboard.index found.");

      expect(
        phpFrameworkRouteMissingTargetMessage("dashboard", [
          phpNetteFrameworkProvider,
        ]),
      ).toBeNull();
    });

    it("reports string-literal support only for providers shipping the capability", () => {
      expect(
        phpFrameworkSupportsStringLiterals([phpLaravelFrameworkProvider]),
      ).toBe(true);
      expect(
        phpFrameworkSupportsStringLiterals([phpNetteFrameworkProvider]),
      ).toBe(true);
      expect(phpFrameworkSupportsStringLiterals([])).toBe(false);
    });

    it("stays a safe no-op for providers without Laravel helper hooks", () => {
      expect(
        phpFrameworkStringLiteralHelperAt(helperSource, helperOffset, [
          phpNetteFrameworkProvider,
        ]),
      ).toBeNull();
      // Empty provider set: dispatchers stay inert (no active framework).
      expect(
        phpFrameworkStringLiteralHelperAt(helperSource, helperOffset, []),
      ).toBeNull();
      expect(
        phpFrameworkConfigLiteralTarget("app.name", [
          phpNetteFrameworkProvider,
        ]),
      ).toBeNull();
      expect(
        phpFrameworkViewLiteralTarget("admin.dashboard", [
          phpNetteFrameworkProvider,
        ]),
      ).toBeNull();
      expect(
        phpFrameworkEnvLiteralTarget("APP_ENV", [phpNetteFrameworkProvider]),
      ).toBeNull();
    });
  });

  describe("PHP completion and link routing capability", () => {
    it("dispatches Laravel scoped PHP string completion contexts through the provider", () => {
      const source = "<?php\n\nGate::allows('upd');\n";
      const position = positionAfter(source, "upd");

      expect(phpLaravelScopedStringCompletionContextAt(source, position)).toBe(
        true,
      );
      expect(
        phpFrameworkScopedStringCompletionContextAt(source, position, [
          phpLaravelFrameworkProvider,
        ]),
      ).toBe(true);
      expect(
        phpFrameworkScopedStringCompletionContextAt(source, position, [
          phpNetteFrameworkProvider,
        ]),
      ).toBe(false);
      expect(
        phpFrameworkScopedStringCompletionContextAt(source, position, []),
      ).toBe(false);
    });

    it("treats provider-owned translation references as scoped completion contexts", () => {
      const source =
        "<?php\n$this->translator->translate('users.component.user_tokens.');";
      const position = positionAfter(source, "user_tokens.");
      const provider: PhpFrameworkProvider = {
        id: "nette",
        translations: {
          completionInsertText: ({ key }) => key,
          keysFromSource: () => [],
          referenceAt: ({
            position: currentPosition,
            source: currentSource,
          }) =>
            currentSource === source && currentPosition === position
              ? {
                  call: "translate",
                  key: "users.component.user_tokens.",
                  position,
                  prefix: "users.component.user_tokens.",
                }
              : null,
          resolveLiteralTarget: () => null,
          targetFromSource: () => null,
        },
      };

      expect(
        phpFrameworkScopedStringCompletionContextAt(source, position, [
          provider,
        ]),
      ).toBe(true);
    });

    it("does not treat unrelated strings as scoped PHP completion contexts", () => {
      const source = "<?php\nreturn 'users.component.user_tokens.header';";
      const position = positionAfter(source, "user_tokens");

      expect(
        phpFrameworkScopedStringCompletionContextAt(source, position, [
          phpNetteFrameworkProvider,
        ]),
      ).toBe(false);
    });

    it("does not treat arbitrary translate methods as scoped PHP completion contexts", () => {
      const source =
        "<?php\nreturn $mailer->translate('users.component.user_tokens.header');";
      const position = positionAfter(source, "user_tokens");

      expect(
        phpFrameworkScopedStringCompletionContextAt(source, position, [
          phpNetteFrameworkProvider,
        ]),
      ).toBe(false);
    });

    it("resolves scoped PHP string completion formatting only from the owning provider", () => {
      const source = "<?php\n\nGate::allows('upd');\n";
      const position = positionAfter(source, "upd");

      expect(
        phpFrameworkScopedStringCompletionAt(source, position, [
          phpLaravelFrameworkProvider,
        ]),
      ).toMatchObject({
        kind: "gateAbility",
        prefix: "upd",
        providerId: "laravel",
      });
      expect(
        phpFrameworkScopedStringCompletionAt(source, position, [
          phpLaravelFrameworkProvider,
        ])?.insertText("update-post"),
      ).toBe("update-post");
      expect(
        phpFrameworkScopedStringCompletionAt(source, position, [
          {
            id: "custom-php",
            php: {
              scopedStringCompletionAt: () => ({
                kind: "gateAbility",
                prefix: "upd",
              }),
            },
          },
        ]),
      ).toBeNull();
    });

    it("dispatches Nette PHP presenter-link navigation through the provider", () => {
      const source = "<?php\n$url = $this->link('Product:show', $id);\n";
      const offset = source.indexOf("Product:show") + "Product".length;
      const direct = detectPhpPresenterLinkAt(source, offset);

      expect(direct).not.toBeNull();
      expect(
        phpFrameworkPhpPresenterLinkAt(source, offset, [
          phpNetteFrameworkProvider,
        ]),
      ).toEqual(direct);
      expect(
        phpFrameworkPhpPresenterLinkAt(source, offset, [
          phpLaravelFrameworkProvider,
        ]),
      ).toBeNull();
      expect(phpFrameworkPhpPresenterLinkAt(source, offset, [])).toBeNull();
    });

    it("dispatches Nette PHP presenter-link completion ranges through the provider", () => {
      const source = "<?php\n$url = $this->link('Pro');\n";
      const offset = source.indexOf("Pro") + "Pro".length;
      const direct = nettePresenterLinkCompletionContextAt(
        source,
        offset,
        "php",
      );

      expect(direct).not.toBeNull();
      expect(
        phpFrameworkPhpPresenterLinkCompletionAt(source, offset, [
          phpNetteFrameworkProvider,
        ]),
      ).toEqual(direct);
      expect(
        phpFrameworkSupportsPhpPresenterLinks([phpNetteFrameworkProvider]),
      ).toBe(true);
      expect(
        phpFrameworkSupportsPhpPresenterLinks([phpLaravelFrameworkProvider]),
      ).toBe(false);
    });

    it("lets custom providers own PHP completion and link routing without Laravel/Nette hooks", () => {
      const customProvider: PhpFrameworkProvider = {
        id: "custom-php",
        php: {
          isScopedStringCompletionContext: ({ position }) =>
            position.lineNumber === 7,
          presenterLinkAt: ({ offset }) => ({
            call: "go",
            target: "Dashboard:default",
            targetEnd: offset + 3,
            targetStart: offset,
          }),
          presenterLinkCompletionAt: ({ offset }) => ({
            prefix: "Dash",
            replaceEnd: offset + 4,
            replaceStart: offset,
          }),
        },
      };

      expect(
        phpFrameworkScopedStringCompletionContextAt(
          "<?php",
          { column: 1, lineNumber: 7 },
          [customProvider],
        ),
      ).toBe(true);
      expect(
        phpFrameworkPhpPresenterLinkAt("<?php", 10, [customProvider]),
      ).toEqual({
        call: "go",
        target: "Dashboard:default",
        targetEnd: 13,
        targetStart: 10,
      });
      expect(
        phpFrameworkPhpPresenterLinkCompletionAt("<?php", 10, [customProvider]),
      ).toEqual({
        prefix: "Dash",
        replaceEnd: 14,
        replaceStart: 10,
      });
    });
  });
});

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
