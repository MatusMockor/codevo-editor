import { describe, expect, it } from "vitest";
import {
  isKnownPhpFrameworkMemberMethod,
  isKnownPhpFrameworkStaticMethod,
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
