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
  isLaravelDynamicWhereMethodForSource,
  isLaravelEloquentBuilderMethodName,
  isLaravelEloquentBuilderFluentMethod,
  isLaravelEloquentStaticBuilderMethod,
  isLaravelEloquentBuilderTerminalModelMethod,
  phpLaravelDynamicWhereAttributeTargetFromSource,
  phpLaravelDynamicWhereCompletionsFromSource,
  phpLaravelLocalScopeCompletionsFromMethods,
  phpLaravelMethodCallReturnTypeFromSource,
  phpLaravelModelAccessorTargetFromSource,
  phpLaravelModelAttributeTargetFromSource,
  phpLaravelRelationPropertyCompletionsFromSource,
  phpLaravelStaticLocalScopeCompletionsFromMethods,
} from "./phpFrameworkLaravel";
import { phpLaravelFrameworkProvider } from "./phpFrameworkProviders";

const laravelCompletionOptions = {
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

describe("phpMethodCompletions", () => {
  it("treats common Eloquent finder methods as terminal model methods", () => {
    expect(isLaravelEloquentBuilderTerminalModelMethod("createOrFirst")).toBe(
      true,
    );
    expect(isLaravelEloquentBuilderTerminalModelMethod("createOrRestore")).toBe(
      true,
    );
    expect(isLaravelEloquentBuilderTerminalModelMethod("createQuietly")).toBe(
      true,
    );
    expect(isLaravelEloquentBuilderTerminalModelMethod("findOr")).toBe(true);
    expect(isLaravelEloquentBuilderTerminalModelMethod("findOrNew")).toBe(true);
    expect(isLaravelEloquentBuilderTerminalModelMethod("findSole")).toBe(true);
    expect(isLaravelEloquentBuilderTerminalModelMethod("firstWhere")).toBe(true);
    expect(isLaravelEloquentBuilderTerminalModelMethod("firstOrNew")).toBe(true);
    expect(isLaravelEloquentBuilderTerminalModelMethod("forceCreate")).toBe(
      true,
    );
    expect(isLaravelEloquentBuilderTerminalModelMethod("forceCreateQuietly")).toBe(
      true,
    );
    expect(isLaravelEloquentBuilderTerminalModelMethod("getModel")).toBe(true);
    expect(isLaravelEloquentBuilderTerminalModelMethod("incrementOrCreate")).toBe(
      true,
    );
    expect(isLaravelEloquentBuilderTerminalModelMethod("make")).toBe(true);
    expect(isLaravelEloquentBuilderTerminalModelMethod("newModelInstance")).toBe(
      true,
    );
    expect(isLaravelEloquentBuilderTerminalModelMethod("restoreOrCreate")).toBe(
      true,
    );
    expect(isLaravelEloquentBuilderMethodName("createOrFirst")).toBe(true);
    expect(isLaravelEloquentBuilderMethodName("createOrRestore")).toBe(true);
    expect(isLaravelEloquentBuilderMethodName("createQuietly")).toBe(true);
    expect(isLaravelEloquentBuilderMethodName("findOr")).toBe(true);
    expect(isLaravelEloquentBuilderMethodName("findOrNew")).toBe(true);
    expect(isLaravelEloquentBuilderMethodName("findSole")).toBe(true);
    expect(isLaravelEloquentBuilderMethodName("firstWhere")).toBe(true);
    expect(isLaravelEloquentBuilderMethodName("firstOrNew")).toBe(true);
    expect(isLaravelEloquentBuilderMethodName("forceCreate")).toBe(true);
    expect(isLaravelEloquentBuilderMethodName("forceCreateQuietly")).toBe(true);
    expect(isLaravelEloquentBuilderMethodName("getModel")).toBe(true);
    expect(isLaravelEloquentBuilderMethodName("incrementOrCreate")).toBe(true);
    expect(isLaravelEloquentBuilderMethodName("make")).toBe(true);
    expect(isLaravelEloquentBuilderMethodName("newModelInstance")).toBe(true);
    expect(isLaravelEloquentBuilderMethodName("restoreOrCreate")).toBe(true);
  });

  it("treats local scopes as model-specific Laravel magic, not global builder methods", () => {
    expect(isLaravelEloquentStaticBuilderMethod("withRelations")).toBe(false);
    expect(isLaravelEloquentBuilderFluentMethod("withRelations")).toBe(false);
    expect(isLaravelEloquentBuilderMethodName("withRelations")).toBe(false);
    expect(isLaravelEloquentStaticBuilderMethod("withTrashed")).toBe(true);
    expect(isLaravelEloquentBuilderFluentMethod("withTrashed")).toBe(true);
    expect(isLaravelEloquentBuilderMethodName("withTrashed")).toBe(true);
    expect(isLaravelEloquentStaticBuilderMethod("whereHasMorph")).toBe(true);
    expect(isLaravelEloquentBuilderFluentMethod("whereHasMorph")).toBe(true);
    expect(isLaravelEloquentBuilderMethodName("whereHasMorph")).toBe(true);
    expect(isLaravelEloquentBuilderFluentMethod("whereMorphedTo")).toBe(true);
    expect(isLaravelEloquentBuilderFluentMethod("doesntHaveMorph")).toBe(true);
    expect(isLaravelEloquentStaticBuilderMethod("withWhereHas")).toBe(true);
    expect(isLaravelEloquentBuilderFluentMethod("withWhereHas")).toBe(true);
    expect(isLaravelEloquentBuilderMethodName("withWhereHas")).toBe(true);
    for (const methodName of ["value", "soleValue", "valueOrFail"]) {
      expect(isLaravelEloquentStaticBuilderMethod(methodName)).toBe(true);
      expect(isLaravelEloquentBuilderFluentMethod(methodName)).toBe(true);
      expect(isLaravelEloquentBuilderMethodName(methodName)).toBe(true);
    }
    for (const methodName of [
      "afterQuery",
      "applyAfterQueryCallbacks",
      "applyScopes",
      "chunkById",
      "chunkByIdDesc",
      "chunkMap",
      "clone",
      "cursorPaginate",
      "delete",
      "decrement",
      "decrementEach",
      "eagerLoadRelations",
      "each",
      "eachById",
      "except",
      "fillAndInsert",
      "fillAndInsertGetId",
      "fillAndInsertOrIgnore",
      "fillForInsert",
      "getEagerLoads",
      "getGlobalMacro",
      "getLimit",
      "getMacro",
      "getModels",
      "getOffset",
      "getQuery",
      "getRelation",
      "hasGlobalMacro",
      "hasMacro",
      "hasNamedScope",
      "increment",
      "incrementEach",
      "onClone",
      "onDelete",
      "orderedChunkById",
      "orWhereAttachedTo",
      "orWhereDoesntHaveRelation",
      "orWhereMorphDoesntHaveRelation",
      "paginateUsingCursor",
      "qualifyColumn",
      "qualifyColumns",
      "scopes",
      "setEagerLoads",
      "setQuery",
      "toBase",
      "touch",
      "update",
      "upsert",
      "withAttributes",
      "withCasts",
      "withGlobalScope",
      "withOnly",
      "withSavepointIfNeeded",
      "withWhereRelation",
      "whereAttachedTo",
      "whereDoesntHaveRelation",
      "whereMorphDoesntHaveRelation",
      "withoutEagerLoad",
      "withoutEagerLoads",
      "withoutGlobalScope",
      "withoutGlobalScopes",
      "withoutGlobalScopesExcept",
    ]) {
      expect(isLaravelEloquentStaticBuilderMethod(methodName)).toBe(true);
      expect(isLaravelEloquentBuilderFluentMethod(methodName)).toBe(true);
      expect(isLaravelEloquentBuilderMethodName(methodName)).toBe(true);
    }
    for (const aggregateMethod of [
      "withAggregate",
      "withAvg",
      "withMax",
      "withMin",
      "withSum",
    ]) {
      expect(isLaravelEloquentStaticBuilderMethod(aggregateMethod)).toBe(true);
      expect(isLaravelEloquentBuilderFluentMethod(aggregateMethod)).toBe(true);
      expect(isLaravelEloquentBuilderMethodName(aggregateMethod)).toBe(true);
    }
  });

  it("infers Laravel builder return types without global local-scope leakage", () => {
    const source = `<?php
namespace App\\Models;

use Illuminate\\Database\\Eloquent\\Builder;
use Illuminate\\Database\\Eloquent\\Attributes\\Scope;
use Illuminate\\Database\\Eloquent\\Model;

class Album extends Model
{
    protected $fillable = [
        'content',
    ];

    protected array $casts = [
        'type' => 'string',
    ];

    public function scopeWithRelations(Builder $query): Builder
    {
        return $query;
    }

    #[Scope]
    protected function popular(Builder $query, bool $strict = true): void
    {
    }
}
`;

    expect(
      phpLaravelMethodCallReturnTypeFromSource(
        source,
        "query",
        "Album",
        "Album::query()",
      ),
    ).toBe("Illuminate\\Database\\Eloquent\\Builder<App\\Models\\Album>");
    expect(
      phpLaravelMethodCallReturnTypeFromSource(
        source,
        "get",
        "Illuminate\\Database\\Eloquent\\Builder<App\\Models\\Album>",
        null,
      ),
    ).toBe("Illuminate\\Database\\Eloquent\\Collection<int, App\\Models\\Album>");
    expect(
      phpLaravelMethodCallReturnTypeFromSource(
        source,
        "all",
        "Album",
        "Album::all()",
      ),
    ).toBe("Illuminate\\Database\\Eloquent\\Collection<int, App\\Models\\Album>");
    expect(
      phpLaravelMethodCallReturnTypeFromSource(
        source,
        "cursor",
        "Album",
        "Album::cursor()",
      ),
    ).toBe("Illuminate\\Support\\LazyCollection<int, App\\Models\\Album>");
    for (const methodName of [
      "lazy",
      "lazyById",
      "lazyByIdDesc",
      "orderedLazyById",
    ]) {
      expect(
        phpLaravelMethodCallReturnTypeFromSource(
          source,
          methodName,
          "Illuminate\\Database\\Eloquent\\Builder<App\\Models\\Album>",
          null,
        ),
      ).toBe("Illuminate\\Support\\LazyCollection<int, App\\Models\\Album>");
    }
    expect(
      phpLaravelMethodCallReturnTypeFromSource(
        source,
        "filter",
        "Illuminate\\Database\\Eloquent\\Collection<int, App\\Models\\Album>",
        null,
      ),
    ).toBe("Illuminate\\Database\\Eloquent\\Collection<int, App\\Models\\Album>");
    for (const methodName of [
      "load",
      "loadAggregate",
      "loadAvg",
      "loadCount",
      "loadExists",
      "loadMax",
      "loadMin",
      "loadMissing",
      "loadMorph",
      "loadMorphCount",
      "loadSum",
    ]) {
      expect(
        phpLaravelMethodCallReturnTypeFromSource(
          source,
          methodName,
          "Illuminate\\Database\\Eloquent\\Collection<int, App\\Models\\Album>",
          null,
        ),
      ).toBe("Illuminate\\Database\\Eloquent\\Collection<int, App\\Models\\Album>");
    }
    expect(
      phpLaravelMethodCallReturnTypeFromSource(
        source,
        "first",
        "Illuminate\\Database\\Eloquent\\Collection<int, App\\Models\\Album>",
        null,
      ),
    ).toBe("App\\Models\\Album");
    expect(
      phpLaravelMethodCallReturnTypeFromSource(
        source,
        "findOr",
        "Album",
        "Album::findOr(1, fn () => null)",
      ),
    ).toBe("App\\Models\\Album");
    expect(
      phpLaravelMethodCallReturnTypeFromSource(
        source,
        "findMany",
        "Album",
        "Album::findMany([1, 2])",
      ),
    ).toBe("Illuminate\\Database\\Eloquent\\Collection<int, App\\Models\\Album>");
    for (const methodName of ["fromQuery", "hydrate"]) {
      expect(
        phpLaravelMethodCallReturnTypeFromSource(
          source,
          methodName,
          "Album",
          null,
        ),
      ).toBe("Illuminate\\Database\\Eloquent\\Collection<int, App\\Models\\Album>");
    }
    expect(
      phpLaravelMethodCallReturnTypeFromSource(
        source,
        "findOrNew",
        "Album",
        "Album::findOrNew(1)",
      ),
    ).toBe("App\\Models\\Album");
    for (const methodName of [
      "createOrFirst",
      "createOrRestore",
      "createQuietly",
      "findSole",
      "forceCreate",
      "forceCreateQuietly",
      "getModel",
      "incrementOrCreate",
      "make",
      "newModelInstance",
      "restoreOrCreate",
    ]) {
      expect(
        phpLaravelMethodCallReturnTypeFromSource(
          source,
          methodName,
          "Illuminate\\Database\\Eloquent\\Builder<App\\Models\\Album>",
          null,
        ),
      ).toBe("App\\Models\\Album");
    }
    for (const methodName of [
      "loadAggregate",
      "loadAvg",
      "loadExists",
      "loadMax",
      "loadMin",
      "loadMorphAggregate",
      "loadMorphAvg",
      "loadMorphCount",
      "loadMorphMax",
      "loadMorphMin",
      "loadMorphSum",
      "loadSum",
    ]) {
      expect(
        phpLaravelMethodCallReturnTypeFromSource(
          source,
          methodName,
          "App\\Models\\Album",
          null,
        ),
      ).toBe("App\\Models\\Album");
    }
    expect(
      phpLaravelMethodCallReturnTypeFromSource(
        source,
        "withRelations",
        "Illuminate\\Database\\Eloquent\\Builder<App\\Models\\Album>",
        "Album::query()",
      ),
    ).toBe("Illuminate\\Database\\Eloquent\\Builder<App\\Models\\Album>");
    expect(
      phpLaravelMethodCallReturnTypeFromSource(
        source,
        "popular",
        "Illuminate\\Database\\Eloquent\\Builder<App\\Models\\Album>",
        null,
      ),
    ).toBe("Illuminate\\Database\\Eloquent\\Builder<App\\Models\\Album>");
    expect(
      phpLaravelMethodCallReturnTypeFromSource(
        source,
        "whereContentAndType",
        "Album",
        "Album::whereContentAndType('draft', 'post')",
      ),
    ).toBe("Illuminate\\Database\\Eloquent\\Builder<App\\Models\\Album>");
    expect(
      phpLaravelMethodCallReturnTypeFromSource(
        source,
        "orWhereContent",
        "Illuminate\\Database\\Eloquent\\Builder<App\\Models\\Album>",
        null,
      ),
    ).toBe("Illuminate\\Database\\Eloquent\\Builder<App\\Models\\Album>");
    for (const methodName of [
      "afterQuery",
      "applyScopes",
      "clone",
      "except",
      "onClone",
      "scopes",
      "setEagerLoads",
      "setQuery",
      "whereHasMorph",
      "orWhereHasMorph",
      "whereMorphedTo",
      "whereNotMorphedTo",
      "whereMorphRelation",
      "whereDoesntHaveRelation",
      "orWhereDoesntHaveRelation",
      "whereMorphDoesntHaveRelation",
      "orWhereMorphDoesntHaveRelation",
      "whereAttachedTo",
      "orWhereAttachedTo",
      "doesntHaveMorph",
      "withAttributes",
      "withCasts",
      "withWhereHas",
      "withWhereRelation",
      "withAggregate",
      "withAvg",
      "withGlobalScope",
      "withMax",
      "withMin",
      "withOnly",
      "withSum",
      "withoutEagerLoad",
      "withoutEagerLoads",
      "withoutGlobalScope",
      "withoutGlobalScopes",
      "withoutGlobalScopesExcept",
    ]) {
      expect(
        phpLaravelMethodCallReturnTypeFromSource(
          source,
          methodName,
          "Illuminate\\Database\\Eloquent\\Builder<App\\Models\\Album>",
          null,
        ),
      ).toBe("Illuminate\\Database\\Eloquent\\Builder<App\\Models\\Album>");
    }
    expect(
      phpLaravelMethodCallReturnTypeFromSource(
        source,
        "withRelations",
        "Illuminate\\Database\\Eloquent\\Builder<App\\Models\\Track>",
        null,
      ),
    ).toBeNull();
    for (const methodName of [
      "count",
      "chunkById",
      "chunkByIdDesc",
      "chunkMap",
      "cursorPaginate",
      "delete",
      "decrement",
      "decrementEach",
      "eagerLoadRelations",
      "each",
      "eachById",
      "applyAfterQueryCallbacks",
      "fillAndInsert",
      "fillAndInsertGetId",
      "fillAndInsertOrIgnore",
      "fillForInsert",
      "getEagerLoads",
      "getGlobalMacro",
      "getLimit",
      "getMacro",
      "getModels",
      "getOffset",
      "getQuery",
      "getRelation",
      "hasGlobalMacro",
      "hasMacro",
      "hasNamedScope",
      "increment",
      "incrementEach",
      "onDelete",
      "orderedChunkById",
      "paginateUsingCursor",
      "qualifyColumn",
      "qualifyColumns",
      "toBase",
      "touch",
      "update",
      "upsert",
      "value",
      "soleValue",
      "valueOrFail",
      "withSavepointIfNeeded",
    ]) {
      expect(
        phpLaravelMethodCallReturnTypeFromSource(
          source,
          methodName,
          "Illuminate\\Database\\Eloquent\\Builder<App\\Models\\Album>",
          null,
        ),
      ).toBeNull();
    }
  });

  it("infers Laravel repository builder generics from repository naming conventions", () => {
    const source = `<?php
namespace App\\Repositories;

use Illuminate\\Database\\Eloquent\\Builder;

class AlbumRepository
{
    public function query(): Builder
    {
    }
}
`;

    expect(
      phpLaravelMethodCallReturnTypeFromSource(
        source,
        "query",
        "AlbumRepository",
        "$this->query()",
      ),
    ).toBe("Illuminate\\Database\\Eloquent\\Builder<App\\Models\\Album>");
  });

  it("infers Laravel repository collection generics from repository naming conventions", () => {
    const source = `<?php
namespace App\\Repositories;

use Illuminate\\Database\\Eloquent\\Collection;

class AlbumRepository
{
    public function matching(): Collection
    {
    }
}
`;

    expect(
      phpLaravelMethodCallReturnTypeFromSource(
        source,
        "matching",
        "AlbumRepository",
        "$this->matching()",
      ),
    ).toBe("Illuminate\\Database\\Eloquent\\Collection<int, App\\Models\\Album>");
    expect(
      phpLaravelMethodCallReturnTypeFromSource(
        source,
        "first",
        "Illuminate\\Database\\Eloquent\\Collection<int, App\\Models\\Album>",
        null,
      ),
    ).toBe("App\\Models\\Album");
  });

  it("infers Laravel relation factory and relation chain return types", () => {
    const source = `<?php
namespace App\\Models;

use Illuminate\\Database\\Eloquent\\Model;

class Comment extends Model
{
    public function relations(): void
    {
        $related = Post::class;

        $this->belongsTo($related);
    }
}

class Post extends Model
{
}
`;

    expect(
      phpLaravelMethodCallReturnTypeFromSource(
        source,
        "hasMany",
        "App\\Models\\Comment",
        "$this",
        "$this->hasMany(Post::class)",
      ),
    ).toBe(
      "Illuminate\\Database\\Eloquent\\Relations\\HasMany<App\\Models\\Post>",
    );
    expect(
      phpLaravelMethodCallReturnTypeFromSource(
        source,
        "belongsTo",
        "App\\Models\\Comment",
        "$this",
        "$this->belongsTo($related)",
      ),
    ).toBe(
      "Illuminate\\Database\\Eloquent\\Relations\\BelongsTo<App\\Models\\Post>",
    );
    expect(
      phpLaravelMethodCallReturnTypeFromSource(
        source,
        "withDefault",
        "Illuminate\\Database\\Eloquent\\Relations\\BelongsTo<App\\Models\\Post>",
        "$this->belongsTo(Post::class)",
      ),
    ).toBe(
      "Illuminate\\Database\\Eloquent\\Relations\\BelongsTo<App\\Models\\Post>",
    );
    for (const methodName of ["withTrashed", "withoutTrashed", "onlyTrashed"]) {
      expect(
        phpLaravelMethodCallReturnTypeFromSource(
          source,
          methodName,
          "Illuminate\\Database\\Eloquent\\Relations\\BelongsTo<App\\Models\\Post>",
          "$this->belongsTo(Post::class)",
        ),
      ).toBe(
        "Illuminate\\Database\\Eloquent\\Relations\\BelongsTo<App\\Models\\Post>",
      );
    }
    expect(
      phpLaravelMethodCallReturnTypeFromSource(
        source,
        "morphMany",
        "App\\Models\\Comment",
        "$this",
        "$this->morphMany(Post::class, 'commentable')",
      ),
    ).toBe(
      "Illuminate\\Database\\Eloquent\\Relations\\MorphMany<App\\Models\\Post>",
    );
    expect(
      phpLaravelMethodCallReturnTypeFromSource(
        source,
        "hasOne",
        "App\\Models\\Comment",
        "$this",
        "$this->hasOne(self::class)",
      ),
    ).toBe(
      "Illuminate\\Database\\Eloquent\\Relations\\HasOne<App\\Models\\Comment>",
    );
    expect(
      phpLaravelMethodCallReturnTypeFromSource(
        source,
        "first",
        "Illuminate\\Database\\Eloquent\\Relations\\HasMany<App\\Models\\Post>",
        "$this->hasMany(Post::class)",
      ),
    ).toBe("App\\Models\\Post");
    expect(
      phpLaravelMethodCallReturnTypeFromSource(
        source,
        "get",
        "Illuminate\\Database\\Eloquent\\Relations\\HasMany<App\\Models\\Post>",
        "$this->hasMany(Post::class)",
      ),
    ).toBe("Illuminate\\Database\\Eloquent\\Collection<int, App\\Models\\Post>");
    expect(
      phpLaravelMethodCallReturnTypeFromSource(
        source,
        "whereNull",
        "Illuminate\\Database\\Eloquent\\Relations\\HasMany<App\\Models\\Post>",
        "$this->hasMany(Post::class)",
      ),
    ).toBe("Illuminate\\Database\\Eloquent\\Builder<App\\Models\\Post>");
  });

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

  it("detects nullsafe member access completion context", () => {
    const source = `<?php
class Controller
{
    public function store(): void
    {
        $user?->profile?->getName
    }
}
`;

    expect(
      phpMemberAccessCompletionContextAt(
        source,
        positionAfter(source, "?->getName"),
      ),
    ).toEqual({
      prefix: "getName",
      receiverExpression: "$user?->profile",
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

  it("detects member access completion after multiline fluent calls", () => {
    const source = `<?php
class Controller
{
    public function index(): void
    {
        Album::query()
            ->published()
            ->ord
    }
}
`;

    expect(
      phpMemberAccessCompletionContextAt(
        source,
        positionAfter(source, "->ord"),
      ),
    ).toEqual({
      prefix: "ord",
      receiverExpression: "Album::query()->published()",
      variableName: null,
    });
  });

  it("does not read member access completion past the previous statement", () => {
    const source = `<?php
Album::query()
    ->published();

    ->ord
`;

    expect(
      phpMemberAccessCompletionContextAt(
        source,
        positionAfter(source, "->ord"),
      ),
    ).toBeNull();
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

  it("detects multiline static access completion context", () => {
    const source = `<?php
return
    Album::pub
`;

    expect(
      phpStaticAccessCompletionContextAt(source, positionAfter(source, "::pub")),
    ).toEqual({
      className: "Album",
      prefix: "pub",
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

  it("detects nullsafe method signature context", () => {
    const source = "<?php\n$user?->setName(";

    expect(
      phpMethodSignatureContextAt(source, positionAfter(source, "?->setName(")),
    ).toEqual({
      argumentIndex: 0,
      className: null,
      methodName: "setName",
      receiverExpression: "$user",
      variableName: "user",
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

  it("detects multiline fluent method signature contexts", () => {
    const source = `<?php
Album::query()
    ->published()
    ->orderBy(
        $column,
`;

    expect(
      phpMethodSignatureContextAt(source, positionAfter(source, "$column,")),
    ).toEqual({
      argumentIndex: 1,
      className: null,
      methodName: "orderBy",
      receiverExpression: "Album::query()->published()",
      variableName: null,
    });
  });

  it("uses the nearest open static call for multiline signature contexts", () => {
    const source = `<?php
Album::withRelations(
Album::pub
Album::published(
`;

    expect(
      phpMethodSignatureContextAt(
        source,
        positionAfter(source, "Album::published("),
      ),
    ).toEqual({
      argumentIndex: 0,
      className: "Album",
      methodName: "published",
      receiverExpression: null,
      variableName: null,
    });
  });

  it("uses an inner static call over an outer member call for signatures", () => {
    const source = `<?php
$query->where(
    Album::published(
`;

    expect(
      phpMethodSignatureContextAt(
        source,
        positionAfter(source, "Album::published("),
      ),
    ).toEqual({
      argumentIndex: 0,
      className: "Album",
      methodName: "published",
      receiverExpression: null,
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
use Illuminate\\Database\\Eloquent\\Attributes\\Scope;

class Comment
{
    public function scopePublished(Builder $query, bool $strict = true): Builder {}
    public function scopeRecentlyCreated($query, int $days = 7): void {}
    #[Scope]
    protected function popular(Builder $query, bool $featured = false): void {}
    protected function internalScopeCandidate(Builder $query): void {}
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
      {
        declaringClassName: "Comment",
        name: "popular",
        parameters: "bool $featured = false",
        returnType: "Illuminate\\Database\\Eloquent\\Builder",
      },
    ]);
    expect(methods.some((method) => method.name === "popular")).toBe(true);
    expect(
      methods.some((method) => method.name === "internalScopeCandidate"),
    ).toBe(false);
  });

  it("maps Laravel local scopes to static model completions", () => {
    const methods = phpMethodCompletionsFromSource(
      `<?php
use Illuminate\\Database\\Eloquent\\Builder;
use Illuminate\\Database\\Eloquent\\Attributes\\Scope;

class Comment
{
    public function scopeWithRelations(Builder $query): Builder {}
    #[Scope]
    protected function popular(Builder $query): void {}
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
      {
        declaringClassName: "Comment",
        isStatic: true,
        name: "popular",
        parameters: "",
        returnType: "Illuminate\\Database\\Eloquent\\Builder",
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

  it("locates Laravel model source attributes", () => {
    const source = `<?php
class Comment
{
    protected $fillable = [
        'content',
    ];

    protected array $casts = [
        'is_pinned' => 'bool',
    ];

    protected $appends = [
        'display_name',
    ];
}
`;

    expect(phpLaravelModelAttributeTargetFromSource(source, "content")).toEqual({
      attributeName: "content",
      position: {
        column: 10,
        lineNumber: 5,
      },
    });
    expect(phpLaravelModelAttributeTargetFromSource(source, "is_pinned")).toEqual({
      attributeName: "is_pinned",
      position: {
        column: 10,
        lineNumber: 9,
      },
    });
    expect(
      phpLaravelModelAttributeTargetFromSource(source, "display_name"),
    ).toEqual({
      attributeName: "display_name",
      position: {
        column: 10,
        lineNumber: 13,
      },
    });
    expect(phpLaravelModelAttributeTargetFromSource(source, "missing")).toBeNull();
  });

  it("locates Laravel accessor source attributes", () => {
    const source = `<?php
use Illuminate\\Database\\Eloquent\\Casts\\Attribute;

class Comment
{
    public function getFullNameAttribute(): string
    {
        return '';
    }

    protected function displayName(): Attribute
    {
        return Attribute::make(get: fn () => '');
    }
}
`;

    expect(
      phpLaravelModelAccessorTargetFromSource(source, "full_name"),
    ).toEqual({
      attributeName: "full_name",
      position: {
        column: 21,
        lineNumber: 6,
      },
    });
    expect(
      phpLaravelModelAccessorTargetFromSource(source, "display_name"),
    ).toEqual({
      attributeName: "display_name",
      position: {
        column: 24,
        lineNumber: 11,
      },
    });
    expect(
      phpLaravelModelAccessorTargetFromSource(source, "missing"),
    ).toBeNull();
  });

  it("recognizes compound and orWhere Laravel dynamic where attributes", () => {
    const source = `<?php
class Comment
{
    protected $fillable = [
        'content',
    ];

    protected array $casts = [
        'type' => 'string',
    ];
}
`;

    expect(isLaravelDynamicWhereMethodForSource(source, "whereContentAndType")).toBe(
      true,
    );
    expect(isLaravelDynamicWhereMethodForSource(source, "orWhereContent")).toBe(
      true,
    );
    expect(
      phpLaravelDynamicWhereAttributeTargetFromSource(
        source,
        "whereContentAndType",
      ),
    ).toEqual({
      attributeName: "content",
      position: {
        column: 10,
        lineNumber: 5,
      },
    });
    expect(
      phpLaravelDynamicWhereAttributeTargetFromSource(source, "orWhereContent"),
    ).toEqual({
      attributeName: "content",
      position: {
        column: 10,
        lineNumber: 5,
      },
    });
    expect(
      phpLaravelDynamicWhereAttributeTargetFromSource(
        source,
        "whereContentAndMissing",
      ),
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
        laravelCompletionOptions,
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
use App\\Models\\User;
use App\\Models\\Video;
use Illuminate\\Database\\Eloquent\\Relations\\BelongsTo;
use Illuminate\\Database\\Eloquent\\Relations\\HasMany;
use Illuminate\\Database\\Eloquent\\Relations\\HasManyThrough;
use Illuminate\\Database\\Eloquent\\Relations\\HasOneThrough;
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

    /** @return HasManyThrough<Post, User> */
    public function distantPosts(): HasManyThrough
    {
        return $this->hasManyThrough($related, $through);
    }

    /** @return HasOneThrough<Post|Video, User> */
    public function ambiguousMedia(): HasOneThrough
    {
        return $this->hasOneThrough($related, $through);
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

    /** @return MorphTo<Post|Video, self> */
    public function attachable(): MorphTo
    {
        return $this->morphTo();
    }
}
`,
        "Comment",
        laravelCompletionOptions,
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
        name: "distantPosts",
        parameters: "",
        returnType: "HasManyThrough<Post, User>",
      },
      {
        declaringClassName: "Comment",
        name: "ambiguousMedia",
        parameters: "",
        returnType: "HasOneThrough<Post|Video, User>",
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
        name: "attachable",
        parameters: "",
        returnType: "MorphTo<Post|Video, self>",
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
        name: "distantPosts",
        parameters: "",
        returnType: "Post",
      },
      {
        declaringClassName: "Comment",
        kind: "property",
        name: "ambiguousMedia",
        parameters: "",
        returnType: "mixed",
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
      {
        declaringClassName: "Comment",
        kind: "property",
        name: "attachable",
        parameters: "",
        returnType: "mixed",
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
        laravelCompletionOptions,
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
        laravelCompletionOptions,
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

  it("extracts Laravel relation targets from local class-string variables", () => {
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
        $related = Post::class;

        return $this->belongsTo($related);
    }

    public function attachments(): HasMany
    {
        $related = Attachment::class;

        return $this->hasMany(
            related: $related,
            foreignKey: 'comment_id',
        );
    }
}
`,
        "Comment",
        laravelCompletionOptions,
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

  it("extracts Laravel dynamic relation targets from resolveRelationUsing callbacks", () => {
    expect(
      phpMethodCompletionsFromSource(
        `<?php
use App\\Models\\Attachment;
use App\\Models\\Post;
use Illuminate\\Database\\Eloquent\\Model;
use Illuminate\\Database\\Eloquent\\Relations\\Relation;

class Comment extends Model
{
}

class Reaction extends Model
{
}

class Owner extends Model
{
}

Comment::resolveRelationUsing('post', function (Comment $comment) {
    return $comment->belongsTo(Post::class);
});

Comment::resolveRelationUsing(
    name: 'attachments',
    callback: static fn (Comment $comment) => $comment->hasMany(Attachment::class),
);

Comment::resolveRelationUsing('legacyComments', function (Comment $comment) {
    return $comment->hasMany('legacy_comments');
});

\\Comment::resolveRelationUsing('owner', fn (Comment $comment) => $comment->belongsTo(Owner::class));

Relation::morphMap([
    'post' => Post::class,
]);

Comment::resolveRelationUsing('commentable', fn (Comment $comment) => $comment->morphTo());

Reaction::resolveRelationUsing('comment', fn (Reaction $reaction) => $reaction->belongsTo(Comment::class));

Comment::resolveRelationUsing('notRelation', fn () => 'not a relation');
`,
        "Comment",
        laravelCompletionOptions,
      ),
    ).toEqual([
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
        name: "legacyComments",
        parameters: "",
        returnType: "mixed",
      },
      {
        declaringClassName: "Comment",
        kind: "property",
        name: "owner",
        parameters: "",
        returnType: "Owner",
      },
      {
        declaringClassName: "Comment",
        kind: "property",
        name: "commentable",
        parameters: "",
        returnType: "App\\Models\\Post",
      },
    ]);
  });

  it("extracts Laravel fluent through targets from resolveRelationUsing callbacks", () => {
    const source = `<?php
use Illuminate\\Database\\Eloquent\\Relations\\BelongsTo;
use Illuminate\\Database\\Eloquent\\Relations\\HasMany;

class Comment
{
    public function cars(): HasMany
    {
        return $this->hasMany(Car::class);
    }
}

class Car
{
    public function owner(): BelongsTo
    {
        return $this->belongsTo(Owner::class);
    }

    public function mechanics(): HasMany
    {
        return $this->hasMany(Mechanic::class);
    }
}

class Owner
{
}

class Mechanic
{
}

Comment::resolveRelationUsing(
    'carOwner',
    fn (Comment $comment) => $comment->through('cars')->has('owner'),
);

Comment::resolveRelationUsing(
    'carMechanics',
    fn (Comment $comment) => $comment->throughCars()->hasMechanics(),
);
`;
    const commentSource = source.slice(
      source.indexOf("class Comment"),
      source.indexOf("class Car"),
    );

    expect(
      phpLaravelRelationPropertyCompletionsFromSource(
        commentSource,
        "Comment",
        source,
      ),
    ).toEqual([
      {
        declaringClassName: "Comment",
        kind: "property",
        name: "cars",
        parameters: "",
        returnType: "Car",
      },
      {
        declaringClassName: "Comment",
        kind: "property",
        name: "carOwner",
        parameters: "",
        returnType: "Owner",
      },
      {
        declaringClassName: "Comment",
        kind: "property",
        name: "carMechanics",
        parameters: "",
        returnType: "Mechanic",
      },
    ]);
  });

  it("extracts Laravel fluent through relation targets from relation strings and dynamic names", () => {
    const source = `<?php
use Illuminate\\Database\\Eloquent\\Relations\\BelongsTo;
use Illuminate\\Database\\Eloquent\\Relations\\HasMany;
use Illuminate\\Database\\Eloquent\\Relations\\HasManyThrough;
use Illuminate\\Database\\Eloquent\\Relations\\HasOneThrough;

class Comment
{
    public function cars(): HasMany
    {
        return $this->hasMany(Car::class);
    }

    public function carOwner(): HasOneThrough
    {
        return $this->through('cars')->has('owner');
    }

    public function carMechanics(): HasManyThrough
    {
        return $this
            ->through("cars")
            ->has("mechanics");
    }

    public function dynamicCarOwner(): HasOneThrough
    {
        return $this->throughCars()->hasOwner();
    }

    public function dynamicCarMechanics(): HasManyThrough
    {
        return $this
            ->throughCars()
            ->hasMechanics();
    }

    public function unknownThrough(): HasOneThrough
    {
        return $this->through($cars)->has('owner');
    }
}

class Car
{
    public function owner(): BelongsTo
    {
        return $this->belongsTo(Owner::class);
    }

    public function mechanics(): HasMany
    {
        return $this->hasMany(Mechanic::class);
    }
}

class Owner
{
}

class Mechanic
{
}
`;
    const commentSource = source.slice(
      source.indexOf("class Comment"),
      source.indexOf("class Car"),
    );

    expect(
      phpLaravelRelationPropertyCompletionsFromSource(
        commentSource,
        "Comment",
        source,
      ),
    ).toEqual([
      {
        declaringClassName: "Comment",
        kind: "property",
        name: "cars",
        parameters: "",
        returnType: "Car",
      },
      {
        declaringClassName: "Comment",
        kind: "property",
        name: "carOwner",
        parameters: "",
        returnType: "Owner",
      },
      {
        declaringClassName: "Comment",
        kind: "property",
        name: "carMechanics",
        parameters: "",
        returnType: "Mechanic",
      },
      {
        declaringClassName: "Comment",
        kind: "property",
        name: "dynamicCarOwner",
        parameters: "",
        returnType: "Owner",
      },
      {
        declaringClassName: "Comment",
        kind: "property",
        name: "dynamicCarMechanics",
        parameters: "",
        returnType: "Mechanic",
      },
      {
        declaringClassName: "Comment",
        kind: "property",
        name: "unknownThrough",
        parameters: "",
        returnType: "mixed",
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
        laravelCompletionOptions,
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
        laravelCompletionOptions,
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

  it("extracts Laravel model attributes from local string constants in metadata", () => {
    const source = `<?php
namespace App\\Models;

use Illuminate\\Database\\Eloquent\\Model;

class Comment extends Model
{
    public const ATTR_CONTENT = 'content';
    private const ATTR_PARENT_ID = 'parent_id';
    private const ATTR_IS_VISIBLE = 'is_visible';
    private const ATTR_IS_PINNED = 'is_pinned';
    private const ATTR_META = 'meta';
    private const ATTR_DISPLAY_NAME = 'display_name';
    private const ATTR_ALIAS = self::ATTR_CONTENT;

    protected $fillable = [
        self::ATTR_CONTENT,
        Comment::ATTR_PARENT_ID,
        self::ATTR_ALIAS,
    ];

    protected $attributes = [
        self::ATTR_IS_VISIBLE => true,
    ];

    protected array $casts = [
        self::ATTR_IS_PINNED => 'bool',
        static::ATTR_META => 'array',
    ];

    protected $appends = [
        self::ATTR_DISPLAY_NAME,
    ];
}
`;

    expect(
      phpMethodCompletionsFromSource(source, "Comment", laravelCompletionOptions),
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
        name: "display_name",
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
    ]);

    expect(
      phpLaravelDynamicWhereCompletionsFromSource(source, "Comment", {
        isStatic: true,
      }).map((completion) => completion.name),
    ).toEqual([
      "whereContent",
      "whereParentId",
      "whereIsVisible",
      "whereIsPinned",
      "whereMeta",
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
        laravelCompletionOptions,
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

  it("can parse plain PHP members without framework providers", () => {
    expect(
      phpMethodCompletionsFromSource(
        `<?php
use Illuminate\\Database\\Eloquent\\Model;

class Comment extends Model
{
    protected $fillable = [
        'content',
    ];

    public function content(): string
    {
        return '';
    }
}
`,
        "Comment",
        { frameworkProviders: [] },
      ),
    ).toEqual([
      {
        declaringClassName: "Comment",
        name: "content",
        parameters: "",
        returnType: "string",
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

    protected function avatar(): Attribute
    {
        return Attribute::make(get: static fn () => new ProfileAvatar('default'));
    }
}
`,
        "User",
        laravelCompletionOptions,
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
        returnType: "string",
      },
      {
        declaringClassName: "User",
        kind: "property",
        name: "avatar",
        parameters: "",
        returnType: "ProfileAvatar",
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
