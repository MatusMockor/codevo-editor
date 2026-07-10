import { describe, expect, it, vi } from "vitest";
import {
  phpLaravelRelationPropertyCompletionsFromSource,
} from "../domain/phpFrameworkLaravel";
import {
  createPhpLaravelClassMemberCollectionProviderAdapter,
} from "./phpLaravelClassMemberCollectionProviderAdapter";

vi.mock("../domain/phpFrameworkLaravel", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../domain/phpFrameworkLaravel")>();

  return {
    ...actual,
    phpLaravelRelationPropertyCompletionsFromSource: vi.fn(
      actual.phpLaravelRelationPropertyCompletionsFromSource,
    ),
  };
});

describe("phpLaravelClassMemberCollectionProviderAdapter", () => {
  it("extracts dynamic where completions with the requested static flag", () => {
    const adapter = createPhpLaravelClassMemberCollectionProviderAdapter({
      resolvePhpDeclaredType: vi.fn(() => null),
    });
    const source = [
      "<?php",
      "namespace App\\Models;",
      "class User",
      "{",
      "    protected $fillable = ['email'];",
      "}",
    ].join("\n");

    expect(
      adapter.dynamicWhereMethods({
        className: "App\\Models\\User",
        options: { isStatic: true },
        source,
      }),
    ).toContainEqual(
      expect.objectContaining({
        isStatic: true,
        kind: "magic-where",
        name: "whereEmail",
      }),
    );
  });

  it("extracts relations and normalizes their return types", () => {
    const resolvePhpDeclaredType = vi.fn(
      (_source: string, typeName: string | null) =>
        typeName === "Post" ? "App\\Models\\Post" : null,
    );
    const adapter = createPhpLaravelClassMemberCollectionProviderAdapter({
      resolvePhpDeclaredType,
    });
    const source = [
      "<?php",
      "namespace App\\Models;",
      "use Illuminate\\Database\\Eloquent\\Relations\\HasMany;",
      "class User",
      "{",
      "    public function posts(): HasMany",
      "    {",
      "        return $this->hasMany(Post::class);",
      "    }",
      "}",
    ].join("\n");

    expect(
      adapter.relationCompletions({
        className: "App\\Models\\User",
        source,
      }),
    ).toContainEqual(
      expect.objectContaining({
        kind: "property",
        name: "posts",
        returnType: "App\\Models\\Post",
      }),
    );
    expect(resolvePhpDeclaredType).toHaveBeenCalledWith(source, "Post");
  });

  it.each([
    ["already-qualified class", "?\\App\\Models\\Post", "App\\Models\\Post"],
    ["builtin", "string", "string"],
    ["nullable builtin", "?bool", "bool"],
    ["null builtin", "null", "null"],
  ])("normalizes %s return types", (_label, returnType, expected) => {
    vi.mocked(
      phpLaravelRelationPropertyCompletionsFromSource,
    ).mockReturnValueOnce([
      {
        declaringClassName: "App\\Models\\User",
        kind: "property",
        name: "posts",
        parameters: "",
        returnType,
      },
    ]);
    const resolvePhpDeclaredType = vi.fn(() => "unexpected");
    const adapter = createPhpLaravelClassMemberCollectionProviderAdapter({
      resolvePhpDeclaredType,
    });

    expect(
      adapter.relationCompletions({
        className: "App\\Models\\User",
        source: "<?php",
      })[0]?.returnType,
    ).toBe(expected);
    expect(resolvePhpDeclaredType).not.toHaveBeenCalled();
  });

  it("preserves an unresolvable class return type", () => {
    vi.mocked(
      phpLaravelRelationPropertyCompletionsFromSource,
    ).mockReturnValueOnce([
      {
        declaringClassName: "App\\Models\\User",
        kind: "property",
        name: "posts",
        parameters: "",
        returnType: "Post",
      },
    ]);
    const resolvePhpDeclaredType = vi.fn(() => null);
    const adapter = createPhpLaravelClassMemberCollectionProviderAdapter({
      resolvePhpDeclaredType,
    });

    expect(
      adapter.relationCompletions({
        className: "App\\Models\\User",
        source: "<?php",
      })[0]?.returnType,
    ).toBe("Post");
    expect(resolvePhpDeclaredType).toHaveBeenCalledWith("<?php", "Post");
  });
});
