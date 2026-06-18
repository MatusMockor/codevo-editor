import { describe, expect, it } from "vitest";
import {
  phpMemberAccessCompletionContextAt,
  phpMixinClassNames,
  phpMethodCompletionsFromSource,
  phpMethodParameters,
  phpMethodSignatureContextAt,
  phpStaticAccessCompletionContextAt,
  phpTraitClassNames,
} from "./phpMethodCompletions";
import {
  phpLaravelDynamicWhereAttributeTargetFromSource,
  phpLaravelDynamicWhereCompletionsFromSource,
  phpLaravelLocalScopeCompletionsFromMethods,
  phpLaravelStaticLocalScopeCompletionsFromMethods,
} from "./phpFrameworkLaravel";

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

describe("phpMethodCompletions", () => {
  it("detects member access completion context", () => {
    const source = `<?php
class Controller
{
    public function store(StoreCommentRequest $request): void
    {
        $request->get
    }
}
`;

    expect(
      phpMemberAccessCompletionContextAt(source, {
        column: 22,
        lineNumber: 6,
      }),
    ).toEqual({
      prefix: "get",
      receiverExpression: "$request",
      variableName: "request",
    });
  });

  it("detects nested member access completion context", () => {
    const source = `<?php
class Controller
{
    public function store(): void
    {
        $this->commentService->cre
    }
}
`;

    expect(
      phpMemberAccessCompletionContextAt(source, {
        column: 35,
        lineNumber: 6,
      }),
    ).toEqual({
      prefix: "cre",
      receiverExpression: "$this->commentService",
      variableName: null,
    });
  });

  it("detects member access completion after fluent calls with arguments", () => {
    const source = `<?php
class Controller
{
    public function index(): void
    {
        $query->whereNull('parent_id')->ord
    }
}
`;

    expect(
      phpMemberAccessCompletionContextAt(source, {
        column: 44,
        lineNumber: 6,
      }),
    ).toEqual({
      prefix: "ord",
      receiverExpression: "$query->whereNull('parent_id')",
      variableName: null,
    });
  });

  it("detects Laravel container receiver completion contexts", () => {
    const sources = [
      {
        expectedReceiver: "app(CommentService::class)",
        source: "<?php\napp(CommentService::class)->cre",
      },
      {
        expectedReceiver: "resolve(CommentService::class)",
        source: "<?php\nresolve(CommentService::class)->cre",
      },
      {
        expectedReceiver: "app()->make(CommentService::class)",
        source: "<?php\napp()->make(CommentService::class)->cre",
      },
      {
        expectedReceiver: "App::make(CommentService::class)",
        source: "<?php\nApp::make(CommentService::class)->cre",
      },
      {
        expectedReceiver: "Container::getInstance()->make(CommentService::class)",
        source:
          "<?php\nContainer::getInstance()->make(CommentService::class)->cre",
      },
    ];

    for (const { expectedReceiver, source } of sources) {
      expect(
        phpMemberAccessCompletionContextAt(
          source,
          positionAfter(source, "->cre"),
        ),
      ).toEqual({
        prefix: "cre",
        receiverExpression: expectedReceiver,
        variableName: null,
      });
    }
  });

  it("detects static and function call receiver completion contexts", () => {
    const source = `<?php
ServiceLocator::get(CommentService::class)->cre
service(CommentService::class)->cre
`;

    expect(
      phpMemberAccessCompletionContextAt(
        source,
        positionAfter(source, "ServiceLocator::get(CommentService::class)->cre"),
      ),
    ).toEqual({
      prefix: "cre",
      receiverExpression: "ServiceLocator::get(CommentService::class)",
      variableName: null,
    });
    expect(
      phpMemberAccessCompletionContextAt(
        source,
        positionAfter(source, "service(CommentService::class)->cre"),
      ),
    ).toEqual({
      prefix: "cre",
      receiverExpression: "service(CommentService::class)",
      variableName: null,
    });
  });

  it("detects static access completion context", () => {
    expect(
      phpStaticAccessCompletionContextAt("<?php\nCommentFactory::ma", {
        column: 19,
        lineNumber: 2,
      }),
    ).toEqual({
      className: "CommentFactory",
      prefix: "ma",
    });
  });

  it("detects method signature context and active argument", () => {
    const source = `<?php
class Controller
{
    public function store(StoreCommentRequest $request): void
    {
        $request->get($key,
    }
}
`;

    expect(
      phpMethodSignatureContextAt(source, {
        column: 28,
        lineNumber: 6,
      }),
    ).toEqual({
      argumentIndex: 1,
      className: null,
      methodName: "get",
      receiverExpression: "$request",
      variableName: "request",
    });
  });

  it("detects Laravel container receiver method signature contexts", () => {
    const source = "<?php\napp(CommentService::class)->create(";

    expect(
      phpMethodSignatureContextAt(
        source,
        positionAfter(source, "app(CommentService::class)->create("),
      ),
    ).toEqual({
      argumentIndex: 0,
      className: null,
      methodName: "create",
      receiverExpression: "app(CommentService::class)",
      variableName: null,
    });
  });

  it("detects static method signature context", () => {
    expect(
      phpMethodSignatureContextAt("<?php\nCommentFactory::make(", {
        column: 23,
        lineNumber: 2,
      }),
    ).toEqual({
      argumentIndex: 0,
      className: "CommentFactory",
      methodName: "make",
      receiverExpression: null,
      variableName: null,
    });
  });

  it("extracts public methods without leaking private helpers", () => {
    const source = `<?php
class Request
{
    public function get(string $key, mixed $default = null): mixed {}
    protected function internal(): void {}
    private function secret(): void {}
}
`;

    expect(phpMethodCompletionsFromSource(source, "Request")).toEqual([
      {
        declaringClassName: "Request",
        name: "get",
        parameters: "string $key, mixed $default = null",
        returnType: "mixed",
      },
    ]);
  });

  it("maps Laravel local scopes to builder-style completions", () => {
    const methods = phpMethodCompletionsFromSource(
      `<?php
use Illuminate\\Database\\Eloquent\\Builder;

class Comment
{
    public function scopePublished(Builder $query, bool $strict = true): Builder {}
    public function scopeRecentlyCreated($query, int $days = 7): void {}
    public static function scopeGlobalOnly($query): void {}
    public function normalMethod(): void {}
}
`,
      "Comment",
    );

    expect(phpLaravelLocalScopeCompletionsFromMethods(methods)).toEqual([
      {
        declaringClassName: "Comment",
        name: "published",
        parameters: "bool $strict = true",
        returnType: "Builder",
      },
      {
        declaringClassName: "Comment",
        name: "recentlyCreated",
        parameters: "int $days = 7",
        returnType: "Illuminate\\Database\\Eloquent\\Builder",
      },
    ]);
  });

  it("maps Laravel local scopes to static model completions", () => {
    const methods = phpMethodCompletionsFromSource(
      `<?php
use Illuminate\\Database\\Eloquent\\Builder;

class Comment
{
    public function scopeWithRelations(Builder $query): Builder {}
}
`,
      "Comment",
    );

    expect(phpLaravelStaticLocalScopeCompletionsFromMethods(methods)).toEqual([
      {
        declaringClassName: "Comment",
        isStatic: true,
        name: "withRelations",
        parameters: "",
        returnType: "Builder",
      },
    ]);
  });

  it("maps Laravel column-like model attributes to dynamic where completions", () => {
    const source = `<?php
use App\\Enums\\CommentType;

class Comment
{
    protected $fillable = [
        'content',
        'parent_id',
    ];

    protected $attributes = [
        'is_visible' => true,
    ];

    protected array $casts = [
        'is_pinned' => 'bool',
        'type' => CommentType::class,
    ];

    protected $appends = [
        'display_name',
    ];

    public function getFullNameAttribute(): string
    {
        return '';
    }
}
`;

    expect(
      phpLaravelDynamicWhereCompletionsFromSource(source, "Comment", {
        isStatic: true,
      }),
    ).toEqual([
      {
        declaringClassName: "Comment",
        isStatic: true,
        name: "whereContent",
        parameters: "$value",
        returnType: "Illuminate\\Database\\Eloquent\\Builder",
      },
      {
        declaringClassName: "Comment",
        isStatic: true,
        name: "whereParentId",
        parameters: "$value",
        returnType: "Illuminate\\Database\\Eloquent\\Builder",
      },
      {
        declaringClassName: "Comment",
        isStatic: true,
        name: "whereIsVisible",
        parameters: "$value",
        returnType: "Illuminate\\Database\\Eloquent\\Builder",
      },
      {
        declaringClassName: "Comment",
        isStatic: true,
        name: "whereIsPinned",
        parameters: "$value",
        returnType: "Illuminate\\Database\\Eloquent\\Builder",
      },
      {
        declaringClassName: "Comment",
        isStatic: true,
        name: "whereType",
        parameters: "$value",
        returnType: "Illuminate\\Database\\Eloquent\\Builder",
      },
    ]);
  });

  it("locates Laravel dynamic where source attributes", () => {
    const source = `<?php
class Comment
{
    protected $fillable = [
        'content',
    ];

    protected $attributes = [
        'parent_id' => null,
    ];

    protected array $casts = [
        'is_pinned' => 'bool',
    ];
}
`;

    expect(
      phpLaravelDynamicWhereAttributeTargetFromSource(source, "whereContent"),
    ).toEqual({
      attributeName: "content",
      position: {
        column: 10,
        lineNumber: 5,
      },
    });
    expect(
      phpLaravelDynamicWhereAttributeTargetFromSource(source, "whereParentId"),
    ).toEqual({
      attributeName: "parent_id",
      position: {
        column: 10,
        lineNumber: 9,
      },
    });
    expect(
      phpLaravelDynamicWhereAttributeTargetFromSource(source, "whereIsPinned"),
    ).toEqual({
      attributeName: "is_pinned",
      position: {
        column: 10,
        lineNumber: 13,
      },
    });
    expect(
      phpLaravelDynamicWhereAttributeTargetFromSource(source, "whereMissing"),
    ).toBeNull();
  });

  it("uses PHPDoc return types when methods do not declare one", () => {
    expect(
      phpMethodCompletionsFromSource(
        "<?php\nclass Factory\n{\n    /** @return Comment */\n    public static function make() {}\n}\n",
        "Factory",
      ),
    ).toEqual([
      {
        declaringClassName: "Factory",
        isStatic: true,
        name: "make",
        parameters: "",
        returnType: "Comment",
      },
    ]);
  });

  it("marks methods returning their class-string template argument", () => {
    const source = `<?php
class Container
{
    /**
     * @template T of object
     * @param class-string<T> $className
     * @return T
     */
    public function get(string $className): object {}
}
`;

    expect(phpMethodCompletionsFromSource(source, "Container")).toEqual([
      {
        classStringTemplate: "T",
        declaringClassName: "Container",
        name: "get",
        parameters: "string $className",
        returnType: "object",
      },
    ]);
  });

  it("keeps more specific generic PHPDoc return types over declared relation types", () => {
    expect(
      phpMethodCompletionsFromSource(
        `<?php
use Illuminate\\Database\\Eloquent\\Relations\\BelongsTo;

class Comment
{
    /** @return BelongsTo<Comment, self> */
    public function parent(): BelongsTo {}
}
`,
        "Comment",
      ),
    ).toEqual([
      {
        declaringClassName: "Comment",
        name: "parent",
        parameters: "",
        returnType: "BelongsTo<Comment, self>",
      },
      {
        declaringClassName: "Comment",
        kind: "property",
        name: "parent",
        parameters: "",
        returnType: "Comment",
      },
    ]);
  });

  it("extracts Laravel relation methods as magic properties", () => {
    expect(
      phpMethodCompletionsFromSource(
        `<?php
use App\\Models\\Attachment;
use App\\Models\\Post;
use Illuminate\\Database\\Eloquent\\Relations\\BelongsTo;
use Illuminate\\Database\\Eloquent\\Relations\\HasMany;
use Illuminate\\Database\\Eloquent\\Relations\\MorphTo;

class Comment
{
    public function post(): BelongsTo
    {
        return $this->belongsTo(Post::class);
    }

    public function attachments(): HasMany
    {
        return $this->hasMany(Attachment::class);
    }

    public function siblings(): HasMany
    {
        return $this->hasMany(self::class);
    }

    public function replies(): HasMany
    {
        return $this->hasMany(__CLASS__, 'parent_id');
    }

    /** @return MorphTo<Post, self> */
    public function commentable(): MorphTo
    {
        return $this->morphTo();
    }
}
`,
        "Comment",
      ),
    ).toEqual([
      {
        declaringClassName: "Comment",
        name: "post",
        parameters: "",
        returnType: "BelongsTo",
      },
      {
        declaringClassName: "Comment",
        name: "attachments",
        parameters: "",
        returnType: "HasMany",
      },
      {
        declaringClassName: "Comment",
        name: "siblings",
        parameters: "",
        returnType: "HasMany",
      },
      {
        declaringClassName: "Comment",
        name: "replies",
        parameters: "",
        returnType: "HasMany",
      },
      {
        declaringClassName: "Comment",
        name: "commentable",
        parameters: "",
        returnType: "MorphTo<Post, self>",
      },
      {
        declaringClassName: "Comment",
        kind: "property",
        name: "post",
        parameters: "",
        returnType: "Post",
      },
      {
        declaringClassName: "Comment",
        kind: "property",
        name: "attachments",
        parameters: "",
        returnType: "Attachment",
      },
      {
        declaringClassName: "Comment",
        kind: "property",
        name: "siblings",
        parameters: "",
        returnType: "Comment",
      },
      {
        declaringClassName: "Comment",
        kind: "property",
        name: "replies",
        parameters: "",
        returnType: "Comment",
      },
      {
        declaringClassName: "Comment",
        kind: "property",
        name: "commentable",
        parameters: "",
        returnType: "Post",
      },
    ]);
  });

  it("extracts PHPDoc magic methods for framework-style OOP APIs", () => {
    expect(
      phpMethodCompletionsFromSource(
        `<?php
/**
 * @method static \\Illuminate\\Database\\Eloquent\\Builder<static> whereNull(string $column, string $boolean = 'and')
 * @method \\App\\Models\\Album publish(bool $quietly = false)
 */
class Album
{
}
`,
        "App\\Models\\Album",
      ),
    ).toEqual([
      {
        declaringClassName: "App\\Models\\Album",
        isStatic: true,
        name: "whereNull",
        parameters: "string $column, string $boolean = 'and'",
        returnType: "\\Illuminate\\Database\\Eloquent\\Builder<static>",
      },
      {
        declaringClassName: "App\\Models\\Album",
        name: "publish",
        parameters: "bool $quietly = false",
        returnType: "\\App\\Models\\Album",
      },
    ]);
  });

  it("uses PHPDoc parameter types when method parameters are untyped", () => {
    expect(
      phpMethodCompletionsFromSource(
        `<?php
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
`,
        "Illuminate\\Http\\Concerns\\InteractsWithInput",
      ),
    ).toEqual([
      {
        declaringClassName: "Illuminate\\Http\\Concerns\\InteractsWithInput",
        name: "input",
        parameters: "string|null $key = null, mixed $default = null",
        returnType: "mixed",
      },
    ]);
  });

  it("extracts public and PHPDoc properties as member completions", () => {
    expect(
      phpMethodCompletionsFromSource(
        `<?php
/**
 * @property string $body
 * @property-read int $externalId
 * @property-read \\Illuminate\\Database\\Eloquent\\Collection<int, Comment> $children
 */
class Comment
{
    public string $status;
    protected string $internal;
    private string $secret;

    public function getBody(): string {}
}
`,
        "Comment",
      ),
    ).toEqual([
      {
        declaringClassName: "Comment",
        name: "getBody",
        parameters: "",
        returnType: "string",
      },
      {
        declaringClassName: "Comment",
        kind: "property",
        name: "body",
        parameters: "",
        returnType: "string",
      },
      {
        declaringClassName: "Comment",
        kind: "property",
        name: "externalId",
        parameters: "",
        returnType: "int",
      },
      {
        declaringClassName: "Comment",
        kind: "property",
        name: "children",
        parameters: "",
        returnType: "\\Illuminate\\Database\\Eloquent\\Collection<int, Comment>",
      },
      {
        declaringClassName: "Comment",
        kind: "property",
        name: "status",
        parameters: "",
        returnType: "string",
      },
    ]);
  });

  it("extracts Laravel relation targets from named relation arguments", () => {
    expect(
      phpMethodCompletionsFromSource(
        `<?php
use App\\Models\\Attachment;
use App\\Models\\Post;
use Illuminate\\Database\\Eloquent\\Relations\\BelongsTo;
use Illuminate\\Database\\Eloquent\\Relations\\HasMany;

class Comment
{
    public function post(): BelongsTo
    {
        return $this->belongsTo(
            related: Post::class,
            foreignKey: 'post_id',
        );
    }

    public function attachments(): HasMany
    {
        return $this->hasMany(
            foreignKey: 'comment_id',
            related: Attachment::class,
        );
    }
}
`,
        "Comment",
      ),
    ).toEqual([
      {
        declaringClassName: "Comment",
        name: "post",
        parameters: "",
        returnType: "BelongsTo",
      },
      {
        declaringClassName: "Comment",
        name: "attachments",
        parameters: "",
        returnType: "HasMany",
      },
      {
        declaringClassName: "Comment",
        kind: "property",
        name: "post",
        parameters: "",
        returnType: "Post",
      },
      {
        declaringClassName: "Comment",
        kind: "property",
        name: "attachments",
        parameters: "",
        returnType: "Attachment",
      },
    ]);
  });

  it("extracts Laravel relation targets from class-string relation arguments", () => {
    expect(
      phpMethodCompletionsFromSource(
        `<?php
use Illuminate\\Database\\Eloquent\\Relations\\BelongsToMany;
use Illuminate\\Database\\Eloquent\\Relations\\MorphToMany;

class User
{
    public function roles(): BelongsToMany
    {
        return $this->belongsToMany('App\\\\Models\\\\Role');
    }

    public function tags(): MorphToMany
    {
        return $this->morphToMany(
            related: '\\\\App\\\\Models\\\\Tag',
            name: 'taggable',
        );
    }
}
`,
        "User",
      ),
    ).toEqual([
      {
        declaringClassName: "User",
        name: "roles",
        parameters: "",
        returnType: "BelongsToMany",
      },
      {
        declaringClassName: "User",
        name: "tags",
        parameters: "",
        returnType: "MorphToMany",
      },
      {
        declaringClassName: "User",
        kind: "property",
        name: "roles",
        parameters: "",
        returnType: "App\\Models\\Role",
      },
      {
        declaringClassName: "User",
        kind: "property",
        name: "tags",
        parameters: "",
        returnType: "App\\Models\\Tag",
      },
    ]);
  });

  it("does not infer non-class string relation arguments as model targets", () => {
    expect(
      phpMethodCompletionsFromSource(
        `<?php
use Illuminate\\Database\\Eloquent\\Relations\\HasMany;

class User
{
    public function comments(): HasMany
    {
        return $this->hasMany('comments');
    }
}
`,
        "User",
      ),
    ).toEqual([
      {
        declaringClassName: "User",
        name: "comments",
        parameters: "",
        returnType: "HasMany",
      },
      {
        declaringClassName: "User",
        kind: "property",
        name: "comments",
        parameters: "",
        returnType: "mixed",
      },
    ]);
  });

  it("extracts Laravel model attributes from fillable and casts", () => {
    expect(
      phpMethodCompletionsFromSource(
        `<?php
use App\\Enums\\CommentType;
use Illuminate\\Database\\Eloquent\\Model;

class Comment extends Model
{
    protected $fillable = [
        'content',
        'parent_id',
    ];

    protected $attributes = [
        'is_visible' => true,
        'attempts' => 0,
        'score_ratio' => 1.5,
        'label' => 'draft',
        'settings' => [],
        'nullable_note' => null,
    ];

    protected array $casts = [
        'is_pinned' => 'bool',
        'meta' => 'array',
        'published_at' => 'datetime',
        'score' => 'integer',
        'price' => 'decimal:2',
        'content' => 'string',
        'type' => CommentType::class,
    ];

    protected function casts(): array
    {
        return [
            'reviewed_at' => 'datetime',
            'review_count' => 'integer',
        ];
    }
}
`,
        "Comment",
      ),
    ).toEqual([
      {
        declaringClassName: "Comment",
        kind: "property",
        name: "content",
        parameters: "",
        returnType: "string",
      },
      {
        declaringClassName: "Comment",
        kind: "property",
        name: "parent_id",
        parameters: "",
        returnType: "mixed",
      },
      {
        declaringClassName: "Comment",
        kind: "property",
        name: "is_visible",
        parameters: "",
        returnType: "bool",
      },
      {
        declaringClassName: "Comment",
        kind: "property",
        name: "attempts",
        parameters: "",
        returnType: "int",
      },
      {
        declaringClassName: "Comment",
        kind: "property",
        name: "score_ratio",
        parameters: "",
        returnType: "float",
      },
      {
        declaringClassName: "Comment",
        kind: "property",
        name: "label",
        parameters: "",
        returnType: "string",
      },
      {
        declaringClassName: "Comment",
        kind: "property",
        name: "settings",
        parameters: "",
        returnType: "array",
      },
      {
        declaringClassName: "Comment",
        kind: "property",
        name: "nullable_note",
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
        name: "meta",
        parameters: "",
        returnType: "array",
      },
      {
        declaringClassName: "Comment",
        kind: "property",
        name: "published_at",
        parameters: "",
        returnType: "\\Illuminate\\Support\\Carbon",
      },
      {
        declaringClassName: "Comment",
        kind: "property",
        name: "score",
        parameters: "",
        returnType: "int",
      },
      {
        declaringClassName: "Comment",
        kind: "property",
        name: "price",
        parameters: "",
        returnType: "string",
      },
      {
        declaringClassName: "Comment",
        kind: "property",
        name: "type",
        parameters: "",
        returnType: "App\\Enums\\CommentType",
      },
      {
        declaringClassName: "Comment",
        kind: "property",
        name: "reviewed_at",
        parameters: "",
        returnType: "\\Illuminate\\Support\\Carbon",
      },
      {
        declaringClassName: "Comment",
        kind: "property",
        name: "review_count",
        parameters: "",
        returnType: "int",
      },
    ]);
  });

  it("keeps Laravel attribute properties distinct from same-named methods", () => {
    expect(
      phpMethodCompletionsFromSource(
        `<?php
use Illuminate\\Database\\Eloquent\\Model;

class Comment extends Model
{
    protected $fillable = [
        'status',
    ];

    protected array $casts = [
        'published_at' => 'datetime',
    ];

    public function status(): string
    {
        return '';
    }
}
`,
        "Comment",
      ),
    ).toEqual([
      {
        declaringClassName: "Comment",
        name: "status",
        parameters: "",
        returnType: "string",
      },
      {
        declaringClassName: "Comment",
        kind: "property",
        name: "status",
        parameters: "",
        returnType: "mixed",
      },
      {
        declaringClassName: "Comment",
        kind: "property",
        name: "published_at",
        parameters: "",
        returnType: "\\Illuminate\\Support\\Carbon",
      },
    ]);
  });

  it("extracts Laravel accessor and appended attributes as properties", () => {
    expect(
      phpMethodCompletionsFromSource(
        `<?php
use Illuminate\\Database\\Eloquent\\Casts\\Attribute;
use Illuminate\\Database\\Eloquent\\Model;

class User extends Model
{
    protected $appends = [
        'display_name',
        'legacy_score',
    ];

    public function getFullNameAttribute(): string
    {
        return '';
    }

    /** @return Attribute<int, never> */
    protected function legacyScore(): Attribute
    {
        return Attribute::make(get: fn () => 10);
    }

    /** @return Attribute<array<string, mixed>, never> */
    protected function options(): Attribute
    {
        return Attribute::make(get: fn () => []);
    }

    protected function profileUrl(): Attribute
    {
        return Attribute::make(get: fn () => '');
    }
}
`,
        "User",
      ),
    ).toEqual([
      {
        declaringClassName: "User",
        name: "getFullNameAttribute",
        parameters: "",
        returnType: "string",
      },
      {
        declaringClassName: "User",
        kind: "property",
        name: "display_name",
        parameters: "",
        returnType: "mixed",
      },
      {
        declaringClassName: "User",
        kind: "property",
        name: "legacy_score",
        parameters: "",
        returnType: "int",
      },
      {
        declaringClassName: "User",
        kind: "property",
        name: "full_name",
        parameters: "",
        returnType: "string",
      },
      {
        declaringClassName: "User",
        kind: "property",
        name: "options",
        parameters: "",
        returnType: "array<string, mixed>",
      },
      {
        declaringClassName: "User",
        kind: "property",
        name: "profile_url",
        parameters: "",
        returnType: "mixed",
      },
    ]);
  });

  it("parses parameter names, types, defaults and optionality", () => {
    expect(
      phpMethodParameters(
        "string $key, mixed $default = null, array $options = ['a,b']",
      ),
    ).toEqual([
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
      {
        defaultValue: "['a,b']",
        name: "$options",
        optional: true,
        raw: "array $options = ['a,b']",
        type: "array",
      },
    ]);
  });

  it("extracts trait names from class bodies", () => {
    expect(
      phpTraitClassNames(`<?php
namespace Illuminate\\Http;

use Illuminate\\Support\\Traits\\Conditionable;

class Request
{
    use Concerns\\InteractsWithInput, Conditionable;
}
`),
    ).toEqual(["Concerns\\InteractsWithInput", "Conditionable"]);
  });

  it("extracts trait names from class-body adaptation blocks", () => {
    expect(
      phpTraitClassNames(`<?php
namespace App\\Models;

use Illuminate\\Database\\Eloquent\\SoftDeletes;

class Comment
{
    use \\App\\Support\\TracksChanges, SoftDeletes {
        TracksChanges::boot insteadof SoftDeletes;
        SoftDeletes::restore as restoreModel;
    }
}
`),
    ).toEqual(["App\\Support\\TracksChanges", "SoftDeletes"]);
  });

  it("extracts PHPDoc mixin class names for magic OOP APIs", () => {
    expect(
      phpMixinClassNames(`<?php
namespace App\\Models;

/**
 * @mixin \\Illuminate\\Database\\Eloquent\\Builder<static>
 * @mixin IdeHelperComment
 */
class Comment
{
}
`),
    ).toEqual([
      "Illuminate\\Database\\Eloquent\\Builder",
      "IdeHelperComment",
    ]);
  });
});
