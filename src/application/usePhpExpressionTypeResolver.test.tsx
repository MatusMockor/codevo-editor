// @vitest-environment jsdom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { EditorPosition } from "../domain/languageServerFeatures";
import { phpLaravelFrameworkProvider } from "../domain/phpFrameworkProviders";
import { createPhpFrameworkIntelligence } from "./phpFrameworkIntelligence";
import { createPhpFrameworkRuntimeContext } from "./phpFrameworkRuntimeContext";
import {
  usePhpExpressionTypeResolver,
  type UsePhpExpressionTypeResolverOptions,
} from "./usePhpExpressionTypeResolver";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

type HookApi = ReturnType<typeof usePhpExpressionTypeResolver>;
type HookOptions = UsePhpExpressionTypeResolverOptions;

const hookCleanups = new Set<() => void>();

afterEach(() => {
  for (const cleanup of [...hookCleanups]) {
    cleanup();
  }
});

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

function resolveClassReference(_source: string, className: string | null) {
  const normalized = className?.trim().replace(/^\\+/, "") ?? "";

  if (normalized === "Post") {
    return "App\\Models\\Post";
  }

  if (normalized === "DB") {
    return "Illuminate\\Support\\Facades\\DB";
  }

  return normalized || null;
}

function makeOptions(overrides: Partial<HookOptions> = {}): HookOptions {
  return {
    activePhpFrameworkProviders: [phpLaravelFrameworkProvider],
    collectPhpMethodsForClass: vi.fn(async () => []),
    frameworkRuntime: LARAVEL_RUNTIME,
    isLaravelFrameworkActive: false,
    phpClassHasLaravelDynamicWhere: vi.fn(async () => false),
    phpClassHasLaravelLocalScope: vi.fn(async () => false),
    resolvePhpClassPropertyOrRelationType: vi.fn(async () => null),
    resolvePhpClassReference: resolveClassReference,
    resolvePhpEloquentBuilderModelType: vi.fn(async () => null),
    resolvePhpFrameworkBoundConcrete: vi.fn(async () => null),
    resolvePhpFrameworkReturnTypeReference: resolveClassReference,
    resolvePhpLaravelCollectionModelType: vi.fn(async () => null),
    resolvePhpMethodReturnType: vi.fn(async () => null),
    resolvePhpSemanticTypeReference: resolveClassReference,
    ...overrides,
  };
}

function renderHook(options: HookOptions) {
  const container = document.createElement("div");
  const root = createRoot(container);
  const captured: { api: HookApi | null } = { api: null };

  function Harness({ hookOptions }: { hookOptions: HookOptions }) {
    captured.api = usePhpExpressionTypeResolver(hookOptions);
    return null;
  }

  const render = (hookOptions: HookOptions) => {
    act(() => {
      root.render(<Harness hookOptions={hookOptions} />);
    });
  };

  let mounted = true;
  const unmount = () => {
    if (!mounted) {
      return;
    }

    mounted = false;
    hookCleanups.delete(unmount);
    act(() => {
      root.unmount();
    });
  };

  hookCleanups.add(unmount);
  render(options);

  return {
    api: () => {
      if (!captured.api) {
        throw new Error("hook not mounted");
      }

      return captured.api;
    },
    rerender: render,
    unmount,
  };
}

function positionAfter(source: string, needle: string): EditorPosition {
  const offset = source.indexOf(needle);

  if (offset < 0) {
    throw new Error(`Missing marker ${needle}`);
  }

  const before = source.slice(0, offset + needle.length);
  const lines = before.split("\n");

  return {
    column: lines[lines.length - 1]?.length ?? 0,
    lineNumber: lines.length,
  };
}

const SOURCE = `<?php
/** @var App\\Models\\Post $model */
/** @var Illuminate\\Database\\Eloquent\\Builder $builder */
/** @var Illuminate\\Database\\Eloquent\\Collection $collection */
/** @var Illuminate\\Database\\DatabaseManager $connection */
$probe;
`;
const POSITION = positionAfter(SOURCE, "$probe");

describe("usePhpExpressionTypeResolver", () => {
  it("resolves model factories and builder fluent methods to Builder", async () => {
    const calls: Array<[string, string, number | undefined]> = [];
    const resolvePhpEloquentBuilderModelType = vi.fn(
      async (_source, _position, expression, depth) => {
        calls.push(["builder-model", expression, depth]);
        return "App\\Models\\Post";
      },
    );
    const options = makeOptions({ resolvePhpEloquentBuilderModelType });
    const harness = renderHook(options);

    await expect(
      harness
        .api()
        .resolvePhpExpressionType(SOURCE, POSITION, "$unknown->newQuery()"),
    ).resolves.toBe("Illuminate\\Database\\Eloquent\\Builder");
    await expect(
      harness
        .api()
        .resolvePhpExpressionType(
          SOURCE,
          POSITION,
          "$unknownBuilder->where('id', 1)",
        ),
    ).resolves.toBe("Illuminate\\Database\\Eloquent\\Builder");

    expect(calls).toContainEqual([
      "builder-model",
      "$unknown->newQuery()",
      1,
    ]);
    expect(calls).toContainEqual(["builder-model", "$unknownBuilder", 1]);
    expect(options.resolvePhpMethodReturnType).not.toHaveBeenCalled();
    harness.unmount();
  });

  it("resolves builder terminal and collection methods from the builder model", async () => {
    const resolvePhpEloquentBuilderModelType = vi.fn(
      async () => "App\\Models\\Post",
    );
    const harness = renderHook(
      makeOptions({ resolvePhpEloquentBuilderModelType }),
    );

    await expect(
      harness
        .api()
        .resolvePhpExpressionType(SOURCE, POSITION, "$builder->first()"),
    ).resolves.toBe("App\\Models\\Post");
    await expect(
      harness
        .api()
        .resolvePhpExpressionType(SOURCE, POSITION, "$builder->get()"),
    ).resolves.toBe("Illuminate\\Database\\Eloquent\\Collection");

    expect(resolvePhpEloquentBuilderModelType).toHaveBeenCalledWith(
      SOURCE,
      POSITION,
      "$builder",
      1,
    );
    harness.unmount();
  });

  it("keeps collection chains as Eloquent collections", async () => {
    const resolvePhpLaravelCollectionModelType = vi.fn(
      async () => "App\\Models\\Post",
    );
    const harness = renderHook(
      makeOptions({ resolvePhpLaravelCollectionModelType }),
    );

    await expect(
      harness
        .api()
        .resolvePhpExpressionType(SOURCE, POSITION, "$collection->filter()"),
    ).resolves.toBe("Illuminate\\Database\\Eloquent\\Collection");
    expect(resolvePhpLaravelCollectionModelType).toHaveBeenCalledWith(
      SOURCE,
      POSITION,
      "$collection",
      1,
    );
    harness.unmount();
  });

  it("falls back to the collection model for a plain collection terminal", async () => {
    const resolvePhpLaravelCollectionModelType = vi.fn(
      async () => "App\\Models\\Post",
    );
    const resolvePhpEloquentBuilderModelType = vi.fn(
      async () => "App\\Models\\Fallback",
    );
    const harness = renderHook(
      makeOptions({
        resolvePhpEloquentBuilderModelType,
        resolvePhpLaravelCollectionModelType,
      }),
    );

    await expect(
      harness
        .api()
        .resolvePhpExpressionType(SOURCE, POSITION, "$collection->first()"),
    ).resolves.toBe("App\\Models\\Post");
    expect(resolvePhpLaravelCollectionModelType).toHaveBeenCalledWith(
      SOURCE,
      POSITION,
      "$collection",
      1,
    );
    expect(resolvePhpEloquentBuilderModelType).not.toHaveBeenCalled();
    harness.unmount();
  });

  it.each([
    ["property", "$model->comments->first()", "comments"],
    ["method", "$model->comments()->get()->first()", "comments"],
  ])(
    "prefers a %s relation chain over collection and builder fallbacks",
    async (_kind, expression, relationName) => {
      const calls: string[] = [];
      const resolvePhpClassPropertyOrRelationType = vi.fn(
        async (className, propertyName, includeCollectionRelations) => {
          calls.push("relation");
          expect([className, propertyName, includeCollectionRelations]).toEqual([
            "App\\Models\\Post",
            relationName,
            true,
          ]);
          return "App\\Models\\Comment";
        },
      );
      const resolvePhpLaravelCollectionModelType = vi.fn(async () => {
        calls.push("collection");
        return null;
      });
      const resolvePhpEloquentBuilderModelType = vi.fn(async () => {
        calls.push("builder");
        return "App\\Models\\Fallback";
      });
      const harness = renderHook(
        makeOptions({
          resolvePhpClassPropertyOrRelationType,
          resolvePhpEloquentBuilderModelType,
          resolvePhpLaravelCollectionModelType,
        }),
      );

      await expect(
        harness.api().resolvePhpExpressionType(SOURCE, POSITION, expression),
      ).resolves.toBe("App\\Models\\Comment");
      expect(calls).toEqual(
        expression.includes("comments()")
          ? ["collection", "relation"]
          : ["relation"],
      );
      harness.unmount();
    },
  );

  it("resolves DB instances and facade table/where chains to Query Builder", async () => {
    const options = makeOptions();
    const harness = renderHook(options);

    await expect(
      harness
        .api()
        .resolvePhpExpressionType(SOURCE, POSITION, "$connection->table('posts')"),
    ).resolves.toBe("Illuminate\\Database\\Query\\Builder");
    await expect(
      harness.api().resolvePhpExpressionType(
        SOURCE,
        POSITION,
        "DB::table('posts')->where('active', true)",
      ),
    ).resolves.toBe("Illuminate\\Database\\Query\\Builder");

    expect(options.resolvePhpMethodReturnType).not.toHaveBeenCalled();
    harness.unmount();
  });

  it("returns the receiver model for fluent model load methods", async () => {
    const options = makeOptions();
    const harness = renderHook(options);

    await expect(
      harness
        .api()
        .resolvePhpExpressionType(SOURCE, POSITION, "$model->load('comments')"),
    ).resolves.toBe("App\\Models\\Post");
    expect(options.resolvePhpMethodReturnType).not.toHaveBeenCalled();
    harness.unmount();
  });

  it("resolves static and chained local scopes before dynamic where", async () => {
    const calls: string[] = [];
    const phpClassHasLaravelLocalScope = vi.fn(
      async (_className, methodName) => {
        calls.push(`scope:${methodName}`);
        return methodName === "published";
      },
    );
    const phpClassHasLaravelDynamicWhere = vi.fn(
      async (_className, methodName) => {
        calls.push(`dynamic:${methodName}`);
        return methodName === "whereTitle";
      },
    );
    const resolvePhpEloquentBuilderModelType = vi.fn(
      async () => "App\\Models\\Post",
    );
    const harness = renderHook(
      makeOptions({
        phpClassHasLaravelDynamicWhere,
        phpClassHasLaravelLocalScope,
        resolvePhpEloquentBuilderModelType,
      }),
    );

    await expect(
      harness
        .api()
        .resolvePhpExpressionType(SOURCE, POSITION, "Post::published()"),
    ).resolves.toBe("Illuminate\\Database\\Eloquent\\Builder");
    await expect(
      harness.api().resolvePhpExpressionType(
        SOURCE,
        POSITION,
        "Post::query()->published()",
      ),
    ).resolves.toBe("Illuminate\\Database\\Eloquent\\Builder");
    await expect(
      harness
        .api()
        .resolvePhpExpressionType(SOURCE, POSITION, "Post::whereTitle('x')"),
    ).resolves.toBe("Illuminate\\Database\\Eloquent\\Builder");

    expect(calls).toContain("scope:published");
    expect(calls).toContain("scope:whereTitle");
    expect(calls).toContain("dynamic:whereTitle");
    expect(calls).not.toContain("dynamic:published");
    const localScopeCallOrder = phpClassHasLaravelLocalScope.mock.invocationCallOrder;
    const dynamicWhereCallOrder =
      phpClassHasLaravelDynamicWhere.mock.invocationCallOrder;
    expect(
      localScopeCallOrder[localScopeCallOrder.length - 1] ?? Infinity,
    ).toBeLessThan(
      dynamicWhereCallOrder[dynamicWhereCallOrder.length - 1] ?? 0,
    );
    harness.unmount();
  });

  it("resolves a chained dynamic where terminal to its builder model", async () => {
    const resolvePhpLaravelCollectionModelType = vi.fn(async () => null);
    const resolvePhpEloquentBuilderModelType = vi.fn(
      async () => "App\\Models\\Post",
    );
    const harness = renderHook(
      makeOptions({
        resolvePhpEloquentBuilderModelType,
        resolvePhpLaravelCollectionModelType,
      }),
    );

    await expect(
      harness.api().resolvePhpExpressionType(
        SOURCE,
        POSITION,
        "Post::whereTitle('published')->first()",
      ),
    ).resolves.toBe("App\\Models\\Post");
    expect(resolvePhpEloquentBuilderModelType).toHaveBeenCalledWith(
      SOURCE,
      POSITION,
      "Post::whereTitle('published')",
      1,
    );
    harness.unmount();
  });

  it("resolves query callback variables to Builder with incremented depth", async () => {
    const source = `<?php
Post::query()->whereHas('comments', function ($query): void {
    $query->where('active', true);
});
`;
    const position = positionAfter(source, "$query->where");
    const resolvePhpEloquentBuilderModelType = vi.fn(
      async () => "App\\Models\\Comment",
    );
    const harness = renderHook(
      makeOptions({ resolvePhpEloquentBuilderModelType }),
    );

    await expect(
      harness.api().resolvePhpExpressionType(source, position, "$query"),
    ).resolves.toBe("Illuminate\\Database\\Eloquent\\Builder");
    expect(resolvePhpEloquentBuilderModelType).toHaveBeenCalledWith(
      source,
      position,
      "$query",
      1,
    );
    harness.unmount();
  });

  it("recurses through assignments", async () => {
    const source = `<?php
$original = new Post();
$alias = $original;
$alias;
`;
    const position = positionAfter(source, "$alias;");
    const harness = renderHook(makeOptions());

    await expect(
      harness.api().resolvePhpExpressionType(source, position, "$alias"),
    ).resolves.toBe("App\\Models\\Post");
    harness.unmount();
  });

  it("exhausts a recursive assignment cycle beyond the allowed boundary", async () => {
    const source = `<?php
$loop = $loop;
$loop->probe;
`;
    const position = positionAfter(source, "$loop->probe");
    const resolvePhpFrameworkReturnTypeReference = vi.fn(
      resolveClassReference,
    );
    const options = makeOptions({ resolvePhpFrameworkReturnTypeReference });
    const harness = renderHook(options);

    await expect(
      harness
        .api()
        .resolvePhpExpressionType(source, position, "$loop", 8),
    ).resolves.toBeNull();
    expect(options.resolvePhpEloquentBuilderModelType).not.toHaveBeenCalled();
    expect(resolvePhpFrameworkReturnTypeReference).toHaveBeenCalledTimes(1);
    expect(options.resolvePhpMethodReturnType).not.toHaveBeenCalled();
    harness.unmount();
  });

  it("disables Laravel predicates under an explicit generic runtime", async () => {
    const phpClassHasLaravelLocalScope = vi.fn(async () => true);
    const phpClassHasLaravelDynamicWhere = vi.fn(async () => true);
    const resolvePhpEloquentBuilderModelType = vi.fn(
      async () => "App\\Models\\Post",
    );
    const harness = renderHook(
      makeOptions({
        frameworkRuntime: GENERIC_RUNTIME,
        isLaravelFrameworkActive: true,
        phpClassHasLaravelDynamicWhere,
        phpClassHasLaravelLocalScope,
        resolvePhpEloquentBuilderModelType,
      }),
    );

    await expect(
      harness
        .api()
        .resolvePhpExpressionType(SOURCE, POSITION, "Post::published()"),
    ).resolves.toBeNull();
    await expect(
      harness
        .api()
        .resolvePhpExpressionType(SOURCE, POSITION, "DB::table('posts')"),
    ).resolves.toBeNull();
    await expect(
      harness
        .api()
        .resolvePhpExpressionType(SOURCE, POSITION, "$model->load('comments')"),
    ).resolves.toBeNull();
    expect(phpClassHasLaravelLocalScope).not.toHaveBeenCalled();
    expect(phpClassHasLaravelDynamicWhere).not.toHaveBeenCalled();
    expect(resolvePhpEloquentBuilderModelType).not.toHaveBeenCalled();
    harness.unmount();
  });

  it("uses the legacy flag only when runtime is absent", async () => {
    const legacyEnabled = renderHook(
      makeOptions({
        frameworkRuntime: undefined,
        isLaravelFrameworkActive: true,
        resolvePhpEloquentBuilderModelType: vi.fn(
          async () => "App\\Models\\Post",
        ),
      }),
    );
    const legacyDisabledPredicate = vi.fn(async () => true);
    const legacyDisabled = renderHook(
      makeOptions({
        frameworkRuntime: undefined,
        isLaravelFrameworkActive: false,
        phpClassHasLaravelLocalScope: legacyDisabledPredicate,
      }),
    );

    await expect(
      legacyEnabled
        .api()
        .resolvePhpExpressionType(SOURCE, POSITION, "$builder->first()"),
    ).resolves.toBe("App\\Models\\Post");
    await expect(
      legacyDisabled
        .api()
        .resolvePhpExpressionType(SOURCE, POSITION, "Post::published()"),
    ).resolves.toBeNull();
    expect(legacyDisabledPredicate).not.toHaveBeenCalled();
    legacyEnabled.unmount();
    legacyDisabled.unmount();
  });

  it("keeps Laravel runtime authoritative when the legacy flag is false", async () => {
    const phpClassHasLaravelLocalScope = vi.fn(async () => true);
    const harness = renderHook(
      makeOptions({
        frameworkRuntime: LARAVEL_RUNTIME,
        isLaravelFrameworkActive: false,
        phpClassHasLaravelLocalScope,
      }),
    );

    await expect(
      harness
        .api()
        .resolvePhpExpressionType(SOURCE, POSITION, "Post::published()"),
    ).resolves.toBe("Illuminate\\Database\\Eloquent\\Builder");
    expect(phpClassHasLaravelLocalScope).toHaveBeenCalledWith(
      "App\\Models\\Post",
      "published",
    );
    harness.unmount();
  });

  it("uses the latest Laravel dependencies after Laravel-generic-Laravel rerenders", async () => {
    const firstResolver = vi.fn(async () => "App\\Models\\First");
    const genericResolver = vi.fn(async () => "App\\Models\\Generic");
    const latestResolver = vi.fn(async () => "App\\Models\\Latest");
    const harness = renderHook(
      makeOptions({ resolvePhpEloquentBuilderModelType: firstResolver }),
    );

    await expect(
      harness
        .api()
        .resolvePhpExpressionType(SOURCE, POSITION, "$builder->first()"),
    ).resolves.toBe("App\\Models\\First");

    harness.rerender(
      makeOptions({
        frameworkRuntime: GENERIC_RUNTIME,
        isLaravelFrameworkActive: true,
        resolvePhpEloquentBuilderModelType: genericResolver,
      }),
    );
    await expect(
      harness
        .api()
        .resolvePhpExpressionType(SOURCE, POSITION, "$builder->first()"),
    ).resolves.toBeNull();

    harness.rerender(
      makeOptions({ resolvePhpEloquentBuilderModelType: latestResolver }),
    );
    await expect(
      harness
        .api()
        .resolvePhpExpressionType(SOURCE, POSITION, "$builder->first()"),
    ).resolves.toBe("App\\Models\\Latest");

    expect(firstResolver).toHaveBeenCalled();
    expect(genericResolver).not.toHaveBeenCalled();
    expect(latestResolver).toHaveBeenCalled();
    harness.unmount();
  });

  it("memoizes a method receiver across strategy and fallback checks", async () => {
    const source = `<?php
/** @var App\\Services\\Reporter $reporter */
$reporter->table('events');
`;
    const position = positionAfter(source, "$reporter->table");
    const resolvePhpSemanticTypeReference = vi.fn(resolveClassReference);
    const resolvePhpMethodReturnType = vi.fn(async () => "App\\DTO\\Report");
    const harness = renderHook(
      makeOptions({
        resolvePhpMethodReturnType,
        resolvePhpSemanticTypeReference,
      }),
    );

    await expect(
      harness
        .api()
        .resolvePhpExpressionType(source, position, "$reporter->table('events')"),
    ).resolves.toBe("App\\DTO\\Report");
    expect(resolvePhpSemanticTypeReference).toHaveBeenCalledTimes(1);
    expect(resolvePhpMethodReturnType).toHaveBeenCalledWith(
      "App\\Services\\Reporter",
      "table",
    );
    harness.unmount();
  });
});
