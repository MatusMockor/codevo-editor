import { describe, expect, it } from "vitest";
import { createPhpMemberCompletionCollector } from "./phpMemberCompletionContribution";
import { phpLaravelMemberCompletionContribution } from "./phpLaravelMemberCompletionContribution";

describe("phpLaravelMemberCompletionContribution", () => {
  it("collects model attributes, relations and API resource members", () => {
    const source = `<?php
use Illuminate\\Database\\Eloquent\\Relations\\BelongsTo;
use Illuminate\\Http\\Resources\\Json\\JsonResource;
class Post extends JsonResource
{
    protected $fillable = ['title'];
    protected array $casts = ['published' => 'bool'];
    public function author(): BelongsTo {}
}`;
    const names = phpLaravelMemberCompletionContribution
      .collect({
        declaringClassName: "App\\Models\\Post",
        source,
        workspaceSources: [],
      })
      .map(({ name }) => name);

    expect(names).toContain("title");
    expect(names).toContain("published");
    expect(names).toContain("author");
    expect(names).toContain("response");
  });

  it("collects macros declared in workspace provider sources", () => {
    const providerSource = `<?php
use Illuminate\\Database\\Eloquent\\Builder;
Builder::macro('withRelations', function (array $relations = []): Builder {});`;
    const completions = phpLaravelMemberCompletionContribution.collect({
      declaringClassName: "Illuminate\\Database\\Eloquent\\Builder",
      source: "<?php",
      workspaceSources: [providerSource],
    });

    expect(completions).toEqual([
      expect.objectContaining({
        name: "withRelations",
        parameters: "array $relations = []",
      }),
    ]);
  });

  it("owns protected Laravel Scope attribute promotion outside PHP core", () => {
    const source = `<?php
use Illuminate\\Database\\Eloquent\\Attributes\\Scope;
use Illuminate\\Database\\Eloquent\\Builder;

class Post
{
    #[Scope]
    protected function published(Builder $query, bool $strict = true): void {}

    #[Scope]
    private function hidden(Builder $query): void {}

    #[Scope]
    protected static function invalidStatic(Builder $query): void {}
}`;

    expect(
      phpLaravelMemberCompletionContribution.collect({
        declaringClassName: "App\\Models\\Post",
        source,
        workspaceSources: [],
      }),
    ).toContainEqual({
      declaringClassName: "App\\Models\\Post",
      kind: "scope",
      name: "published",
      parameters: "bool $strict = true",
      returnType: "Illuminate\\Database\\Eloquent\\Builder",
      visibility: "protected",
    });
    expect(
      phpLaravelMemberCompletionContribution
        .collect({
          declaringClassName: "App\\Models\\Post",
          source,
          workspaceSources: [],
        })
        .map(({ name }) => name),
    ).not.toEqual(expect.arrayContaining(["hidden", "invalidStatic"]));
  });

  it("replaces the matching generic method with one attributed scope completion", () => {
    const source = `<?php
use Illuminate\\Database\\Eloquent\\Attributes\\Scope;
use Illuminate\\Database\\Eloquent\\Builder;

class Post
{
    #[Scope]
    protected function published(Builder $query, bool $strict = true): void {}
}`;
    const completions = createPhpMemberCompletionCollector([
      phpLaravelMemberCompletionContribution,
    ]).collect(source, "App\\Models\\Post", {
      includeNonPublicMembers: true,
    });
    const published = completions.filter(({ name }) => name === "published");

    expect(published).toEqual([
      expect.objectContaining({
        kind: "scope",
        parameters: "bool $strict = true",
        returnType: "Illuminate\\Database\\Eloquent\\Builder",
      }),
    ]);
  });

  it("does not replace a property sharing the attributed scope name", () => {
    const source = `<?php
use Illuminate\\Database\\Eloquent\\Attributes\\Scope;
use Illuminate\\Database\\Eloquent\\Builder;

class Post
{
    public string $published;

    #[Scope]
    protected function published(Builder $query, bool $strict = true): void {}
}`;
    const published = createPhpMemberCompletionCollector([
      phpLaravelMemberCompletionContribution,
    ])
      .collect(source, "App\\Models\\Post", {
        includeNonPublicMembers: true,
      })
      .filter(({ name }) => name === "published");

    expect(published).toEqual([
      expect.objectContaining({
        kind: "scope",
        parameters: "bool $strict = true",
      }),
      expect.objectContaining({ kind: "property" }),
    ]);
  });
});
