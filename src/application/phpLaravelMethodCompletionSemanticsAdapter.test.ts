import { describe, expect, it, vi } from "vitest";
import type { PhpMethodCompletion } from "../domain/phpMethodCompletions";
import {
  createPhpLaravelMethodCompletionSemanticsAdapter,
  type PhpLaravelMethodCompletionSemanticsAdapterDependencies,
} from "./phpLaravelMethodCompletionSemanticsAdapter";

function method(
  name: string,
  overrides: Partial<PhpMethodCompletion> = {},
): PhpMethodCompletion {
  return {
    declaringClassName: "App\\Models\\Post",
    name,
    parameters: "",
    returnType: "void",
    visibility: "public",
    ...overrides,
  };
}

function makeDeps(
  overrides: Partial<PhpLaravelMethodCompletionSemanticsAdapterDependencies> = {},
): PhpLaravelMethodCompletionSemanticsAdapterDependencies {
  return {
    collectPhpLaravelDynamicWhereMethodsForClass: vi.fn(async () => []),
    resolvePhpEloquentBuilderModelType: vi.fn(async () => null),
    ...overrides,
  };
}

describe("phpLaravelMethodCompletionSemanticsAdapter", () => {
  it("maps Laravel facade completions to facade targets", () => {
    const adapter = createPhpLaravelMethodCompletionSemanticsAdapter(makeDeps());

    expect(
      adapter.facadeTargetClassName("\\Illuminate\\Support\\Facades\\Cache"),
    ).toBe("Illuminate\\Cache\\CacheManager");
    expect(adapter.facadeTargetClassName("App\\Support\\Cache")).toBeNull();
  });

  it("adds local scopes and dynamic where methods for builder receivers", async () => {
    const collectPhpMethodsForClass = vi.fn(async () => [
      method("scopePublished", {
        parameters: "$query, bool $strict = true",
        returnType: "Illuminate\\Database\\Eloquent\\Builder",
      }),
      method("title", { kind: "property" }),
    ]);
    const collectPhpLaravelDynamicWhereMethodsForClass = vi.fn(async () => [
      method("whereEmail", { kind: "magic-where" }),
    ]);
    const adapter = createPhpLaravelMethodCompletionSemanticsAdapter(
      makeDeps({
        collectPhpLaravelDynamicWhereMethodsForClass,
        resolvePhpEloquentBuilderModelType: vi.fn(
          async () => "App\\Models\\Post",
        ),
      }),
    );

    const groups = await adapter.receiverCompletionGroups({
      collectPhpMethodsForClass,
      position: { column: 10, lineNumber: 2 },
      receiverExpression: "$query",
      receiverMethods: [
        method("where", {
          declaringClassName: "Illuminate\\Database\\Eloquent\\Builder",
        }),
      ],
      resolvedReceiverType: "Illuminate\\Database\\Eloquent\\Builder",
      source: "<?php\n$query->",
    });

    expect(groups.baseMethods.map((completion) => completion.name)).toEqual([
      "where",
    ]);
    expect(groups.localScopeMethods).toEqual([
      method("published", {
        kind: "scope",
        parameters: "bool $strict = true",
        returnType: "Illuminate\\Database\\Eloquent\\Builder",
      }),
    ]);
    expect(groups.dynamicWhereMethods).toEqual([
      method("whereEmail", { kind: "magic-where" }),
    ]);
    expect(collectPhpMethodsForClass).toHaveBeenCalledWith(
      "App\\Models\\Post",
    );
    expect(collectPhpLaravelDynamicWhereMethodsForClass).toHaveBeenCalledWith(
      "App\\Models\\Post",
    );
  });

  it("replaces receiver local scope source methods on model receivers", async () => {
    const adapter = createPhpLaravelMethodCompletionSemanticsAdapter(makeDeps());

    const groups = await adapter.receiverCompletionGroups({
      collectPhpMethodsForClass: vi.fn(async () => []),
      position: { column: 9, lineNumber: 2 },
      receiverExpression: "$post",
      receiverMethods: [
        method("scopePublished", { parameters: "$query" }),
        method("published", { kind: "scope" }),
        method("save"),
        method("title", { kind: "property" }),
      ],
      resolvedReceiverType: "App\\Models\\Post",
      source: "<?php\n$post->",
    });

    expect(groups.baseMethods.map((completion) => completion.name)).toEqual([
      "save",
      "title",
    ]);
    expect(groups.localScopeMethods.map((completion) => completion.name)).toEqual([
      "published",
    ]);
    expect(groups.dynamicWhereMethods).toEqual([]);
  });

  it("adds static model members, local scopes, and dynamic where methods", async () => {
    const collectPhpLaravelDynamicWhereMethodsForClass = vi.fn(async () => [
      method("whereTitle", { isStatic: true, kind: "magic-where" }),
    ]);
    const adapter = createPhpLaravelMethodCompletionSemanticsAdapter(
      makeDeps({ collectPhpLaravelDynamicWhereMethodsForClass }),
    );

    const groups = await adapter.staticCompletionGroups({
      className: "App\\Models\\Post",
      methods: [
        method("factory", { isStatic: true }),
        method("scopePublished", {
          parameters: "$query",
          returnType: "Illuminate\\Database\\Eloquent\\Builder",
        }),
        method("title", { kind: "property" }),
        method("save"),
      ],
      source: "<?php\nPost::",
    });

    expect(groups.baseMethods.map((completion) => completion.name)).toEqual([
      "factory",
      "title",
    ]);
    expect(groups.localScopeMethods).toEqual([
      method("published", {
        isStatic: true,
        kind: "scope",
        returnType: "Illuminate\\Database\\Eloquent\\Builder",
      }),
    ]);
    expect(groups.dynamicWhereMethods).toEqual([
      method("whereTitle", { isStatic: true, kind: "magic-where" }),
    ]);
    expect(collectPhpLaravelDynamicWhereMethodsForClass).toHaveBeenCalledWith(
      "App\\Models\\Post",
      { isStatic: true },
    );
  });
});
