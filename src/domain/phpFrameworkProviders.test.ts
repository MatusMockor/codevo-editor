import { describe, expect, it } from "vitest";
import {
  isKnownPhpFrameworkMemberMethod,
  isKnownPhpFrameworkStaticMethod,
  phpFrameworkContainerExpressionClassName,
  phpFrameworkMethodCallReturnTypeFromSource,
  phpFrameworkProviderSignature,
  phpFrameworkMemberCompletionsFromSource,
  phpFrameworkPropertyTypeFromSource,
  phpFrameworkProvidersForProject,
  phpLaravelFrameworkProvider,
  type PhpFrameworkProvider,
} from "./phpFrameworkProviders";
import { phpLaravelMorphMapEntriesFromSource } from "./phpFrameworkLaravel";
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
      isKnownPhpFrameworkStaticMethod(source, "Album", "withRelations", [
        phpLaravelFrameworkProvider,
      ]),
    ).toBe(false);
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
      isKnownPhpFrameworkMemberMethod(source, "Album::query()", "withRelations", [
        phpLaravelFrameworkProvider,
      ]),
    ).toBe(false);
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
