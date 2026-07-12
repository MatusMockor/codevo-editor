// @vitest-environment jsdom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";
import { phpLaravelFrameworkProvider } from "../domain/phpFrameworkProviders";
import type { PhpMethodCompletion } from "../domain/phpMethodCompletions";
import { createPhpFrameworkIntelligence } from "./phpFrameworkIntelligence";
import { createPhpFrameworkRuntimeContext } from "./phpFrameworkRuntimeContext";
import {
  usePhpMethodCompletionResolvers,
  type PhpMethodCompletionResolverDependencies,
  type PhpMethodCompletionResolvers,
} from "./usePhpMethodCompletionResolvers";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

const LARAVEL_RUNTIME = createPhpFrameworkRuntimeContext(
  createPhpFrameworkIntelligence({
    matchedProviderIds: ["laravel"],
    profile: "laravel",
    providers: [phpLaravelFrameworkProvider],
  }),
);
const GENERIC_RUNTIME = createPhpFrameworkRuntimeContext(
  createPhpFrameworkIntelligence({
    matchedProviderIds: [],
    profile: "generic",
    providers: [],
  }),
);

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
  overrides: Partial<PhpMethodCompletionResolverDependencies> = {},
): PhpMethodCompletionResolverDependencies {
  return {
    activePhpFrameworkProviders: [],
    collectPhpLaravelDynamicWhereMethodsForClass: vi.fn(async () => []),
    collectPhpMethodsForClass: vi.fn(async () => []),
    currentPhpFrameworkSourceContext: () => ({ workspaceSources: [] }),
    frameworkRuntime: LARAVEL_RUNTIME,
    isLaravelFrameworkActive: true,
    phpNormalizedReceiverExpressionIsThis: (receiverExpression) =>
      receiverExpression.trim() === "$this",
    resolvePhpClassReference: (_source, className) => className,
    resolvePhpEloquentBuilderModelType: vi.fn(async () => null),
    resolvePhpExpressionType: vi.fn(async () => null),
    ...overrides,
  };
}

function renderHook(deps: PhpMethodCompletionResolverDependencies) {
  const container = document.createElement("div");
  const root = createRoot(container);
  const captured: { api: PhpMethodCompletionResolvers | null } = {
    api: null,
  };

  function Harness({
    dependencies,
  }: {
    dependencies: PhpMethodCompletionResolverDependencies;
  }) {
    captured.api = usePhpMethodCompletionResolvers(dependencies);
    return null;
  }

  act(() => {
    root.render(<Harness dependencies={deps} />);
  });

  const api = (): PhpMethodCompletionResolvers => {
    if (!captured.api) {
      throw new Error("hook not mounted");
    }

    return captured.api;
  };

  return {
    api,
    unmount: () => {
      act(() => {
        root.unmount();
      });
    },
  };
}

describe("usePhpMethodCompletionResolvers", () => {
  it("keeps generic runtime inert even when legacy Laravel fallback is true", async () => {
    const source = "<?php\n$post->";
    const collectPhpLaravelDynamicWhereMethodsForClass = vi.fn(async () => [
      method("whereEmail", { kind: "magic-where" }),
    ]);
    const collectPhpMethodsForClass = vi.fn(async () => [
      method("scopePublished", { parameters: "$query" }),
      method("published", { kind: "scope" }),
      method("save"),
    ]);
    const resolvePhpEloquentBuilderModelType = vi.fn(
      async () => "App\\Models\\Post",
    );
    const deps = makeDeps({
      collectPhpLaravelDynamicWhereMethodsForClass,
      collectPhpMethodsForClass,
      frameworkRuntime: GENERIC_RUNTIME,
      isLaravelFrameworkActive: true,
      resolvePhpEloquentBuilderModelType,
      resolvePhpExpressionType: vi.fn(async () => "App\\Models\\Post"),
    });
    const harness = renderHook(deps);

    const receiverCompletions = await harness
      .api()
      .resolvePhpReceiverMethodCompletions(
        source,
        { column: source.length + 1, lineNumber: 2 },
        "$post",
      );
    const staticCompletions = await harness
      .api()
      .resolvePhpStaticMethodCompletions(
        "<?php\nuse Illuminate\\Support\\Facades\\Cache;",
        "Illuminate\\Support\\Facades\\Cache",
      );

    expect(receiverCompletions.map((completion) => completion.name)).toEqual([
      "scopePublished",
      "save",
    ]);
    expect(staticCompletions).toEqual([]);
    expect(resolvePhpEloquentBuilderModelType).not.toHaveBeenCalled();
    expect(collectPhpLaravelDynamicWhereMethodsForClass).not.toHaveBeenCalled();
    expect(collectPhpMethodsForClass).toHaveBeenCalledWith(
      "App\\Models\\Post",
    );
    expect(collectPhpMethodsForClass).toHaveBeenCalledWith(
      "Illuminate\\Support\\Facades\\Cache",
    );

    harness.unmount();
  });

  it("keeps Laravel builder receivers wired to local scopes and dynamic where methods", async () => {
    const source = "<?php\n$query->";
    const collectPhpMethodsForClass = vi.fn(async (className: string) => {
      if (className === "Illuminate\\Database\\Eloquent\\Builder") {
        return [method("where", { declaringClassName: className })];
      }

      return [
        method("scopePublished", {
          declaringClassName: className,
          parameters: "$query, bool $strict = true",
          returnType: "Illuminate\\Database\\Eloquent\\Builder",
        }),
        method("title", { declaringClassName: className, kind: "property" }),
      ];
    });
    const deps = makeDeps({
      collectPhpLaravelDynamicWhereMethodsForClass: vi.fn(async () => [
        method("whereEmail", { kind: "magic-where" }),
        method("whereEmail", {
          declaringClassName: "App\\Models\\Duplicate",
          kind: "magic-where",
        }),
      ]),
      collectPhpMethodsForClass,
      resolvePhpEloquentBuilderModelType: vi.fn(
        async () => "App\\Models\\Post",
      ),
      resolvePhpExpressionType: vi.fn(
        async () => "Illuminate\\Database\\Eloquent\\Builder",
      ),
    });
    const harness = renderHook(deps);

    const completions = await harness
      .api()
      .resolvePhpReceiverMethodCompletions(
        source,
        { column: source.length + 1, lineNumber: 2 },
        "$query",
      );

    expect(completions.map((completion) => completion.name)).toEqual([
      "where",
      "published",
      "whereEmail",
    ]);
    expect(
      completions.find((completion) => completion.name === "whereEmail")
        ?.declaringClassName,
    ).toBe("App\\Models\\Post");
    expect(collectPhpMethodsForClass).toHaveBeenCalledWith(
      "Illuminate\\Database\\Eloquent\\Builder",
    );
    expect(collectPhpMethodsForClass).toHaveBeenCalledWith(
      "App\\Models\\Post",
    );

    harness.unmount();
  });

  it("keeps Laravel static model completions wired to scopes and dynamic where methods", async () => {
    const source = "<?php\nuse App\\Models\\Post;\nPost::";
    const deps = makeDeps({
      collectPhpLaravelDynamicWhereMethodsForClass: vi.fn(async () => [
        method("whereTitle", { isStatic: true, kind: "magic-where" }),
      ]),
      collectPhpMethodsForClass: vi.fn(async () => [
        method("factory", { isStatic: true }),
        method("scopePublished", {
          parameters: "$query",
          returnType: "Illuminate\\Database\\Eloquent\\Builder",
        }),
        method("title", { kind: "property" }),
        method("save"),
      ]),
      resolvePhpClassReference: vi.fn(() => "App\\Models\\Post"),
    });
    const harness = renderHook(deps);

    const completions = await harness
      .api()
      .resolvePhpStaticMethodCompletions(source, "Post");

    expect(completions.map((completion) => completion.name)).toEqual([
      "factory",
      "title",
      "published",
      "whereTitle",
    ]);
    expect(deps.collectPhpLaravelDynamicWhereMethodsForClass).toHaveBeenCalledWith(
      "App\\Models\\Post",
      { isStatic: true },
    );

    harness.unmount();
  });

  it("keeps Laravel facade completions mapped to the facade target", async () => {
    const source = "<?php\nuse Illuminate\\Support\\Facades\\Cache;\nCache::";
    const collectPhpMethodsForClass = vi.fn(async () => [
      method("remember", {
        declaringClassName: "Illuminate\\Cache\\CacheManager",
      }),
    ]);
    const deps = makeDeps({
      collectPhpMethodsForClass,
      resolvePhpClassReference: vi.fn(
        () => "Illuminate\\Support\\Facades\\Cache",
      ),
    });
    const harness = renderHook(deps);

    const completions = await harness
      .api()
      .resolvePhpStaticMethodCompletions(source, "Cache");

    expect(completions.map((completion) => completion.name)).toEqual([
      "remember",
    ]);
    expect(collectPhpMethodsForClass).toHaveBeenCalledWith(
      "Illuminate\\Cache\\CacheManager",
    );

    harness.unmount();
  });
});
