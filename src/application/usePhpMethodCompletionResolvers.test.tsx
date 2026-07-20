import { phpLaravelFrameworkProvider } from "../domain/phpFrameworkLaravelProvider";
// @vitest-environment jsdom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";

import type { PhpMethodCompletion } from "../domain/phpMethodCompletions";
import { createPhpFrameworkIntelligence } from "./phpFrameworkIntelligence";
import { createPhpFrameworkRuntimeContext } from "./phpFrameworkRuntimeContext";
import {
  mergePhpMethodCompletions,
  mergePhpTraitAndHostMethodCompletions,
  usePhpMethodCompletionResolvers,
  type PhpMethodCompletionResolverDependencies,
  type PhpMethodCompletionResolvers,
} from "./usePhpMethodCompletionResolvers";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

describe("mergePhpMethodCompletions", () => {
  it("preserves semantic variants and collapses exact duplicates", () => {
    const instanceMethod = method("resolve", { parameters: "int $id" });
    const staticMethod = method("resolve", {
      isStatic: true,
      parameters: "int $id",
    });
    const property = method("resolve", {
      kind: "property",
      parameters: "",
    });
    const stringOverload = method("resolve", {
      parameters: "string $id",
    });

    expect(
      mergePhpMethodCompletions(
        [instanceMethod, staticMethod, property, stringOverload],
        [
          { ...instanceMethod },
          method("resolve", { parameters: "  int   $id  " }),
        ],
      ),
    ).toEqual([instanceMethod, staticMethod, property, stringOverload]);
  });

  it("keeps a real method alongside a same-signature derived scope", () => {
    const plainMethod = method("owner");
    const property = method("owner", { kind: "property" });
    const scope = method("owner", {
      detail: "Laravel scope",
      kind: "scope",
    });

    expect(
      mergePhpMethodCompletions(
        [plainMethod, property],
        [scope, { ...scope }],
      ),
    ).toEqual([plainMethod, property, scope]);
  });
});

describe("mergePhpTraitAndHostMethodCompletions", () => {
  it("merges trait-local members with the intersection of host members", () => {
    expect(
      mergePhpTraitAndHostMethodCompletions(
        [method("moveUp")],
        [
          [method("getTable", { returnType: "Selection" }), method("onlyPost")],
          [method("getTable", { returnType: "Selection" }), method("onlyUser")],
        ],
      ).map(({ name, returnType }) => ({ name, returnType })),
    ).toEqual([
      { name: "moveUp", returnType: "void" },
      { name: "getTable", returnType: "Selection" },
    ]);
  });

  it("drops conflicting return types from shared host members", () => {
    expect(
      mergePhpTraitAndHostMethodCompletions(
        [method("resolve", { returnType: "TraitResult" })],
        [
          [method("resolve", { returnType: "Post" })],
          [method("resolve", { returnType: "User" })],
        ],
      ),
    ).toEqual([method("resolve", { returnType: null })]);
  });

  it("keeps identical effective host override return types", () => {
    expect(
      mergePhpTraitAndHostMethodCompletions(
        [method("resolve", { returnType: "TraitResult" })],
        [
          [method("resolve", { returnType: "HostResult" })],
          [method("resolve", { returnType: "HostResult" })],
        ],
      ),
    ).toEqual([method("resolve", { returnType: "HostResult" })]);
  });

  it("keeps a trait-local member when hosts do not override it", () => {
    expect(
      mergePhpTraitAndHostMethodCompletions(
        [method("moveUp", { returnType: "bool" })],
        [[], []],
      ),
    ).toEqual([method("moveUp", { returnType: "bool" })]);
  });

  it("keeps same-name static and instance host completions distinct", () => {
    const instanceMember = method("resolve");
    const staticMember = method("resolve", { isStatic: true });

    expect(
      mergePhpTraitAndHostMethodCompletions([], [
        [instanceMember, staticMember],
        [instanceMember, staticMember],
      ]),
    ).toEqual([instanceMember, staticMember]);
  });

  it("keeps same-name property and method host completions distinct", () => {
    const methodMember = method("status");
    const propertyMember = method("status", { kind: "property" });

    expect(
      mergePhpTraitAndHostMethodCompletions([], [
        [methodMember, propertyMember],
        [methodMember, propertyMember],
      ]),
    ).toEqual([methodMember, propertyMember]);
  });

  it("reconciles an identity-equivalent host method to one derived scope", () => {
    const plainMethod = method("published");
    const scope = method("published", { kind: "scope" });

    expect(
      mergePhpTraitAndHostMethodCompletions(
        [plainMethod, scope, { ...scope }],
        [],
      ),
    ).toEqual([scope]);
  });
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
    collectPhpFrameworkSyntheticMethodsForClass: vi.fn(async () => []),
    collectPhpMethodsForClass: vi.fn(async () => []),
    currentPhpFrameworkSourceContext: () => ({ workspaceSources: [] }),
    frameworkRuntime: LARAVEL_RUNTIME,
    phpNormalizedReceiverExpressionIsThis: (receiverExpression) =>
      receiverExpression.trim() === "$this",
    resolvePhpClassReference: (_source, className) => className,
    resolvePhpFrameworkBuilderModelType: vi.fn(async () => null),
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

function positionAfter(source: string, needle: string) {
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

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((innerResolve) => {
    resolve = innerResolve;
  });

  return { promise, resolve };
}

describe("usePhpMethodCompletionResolvers", () => {
  it("returns one framework-owned Scope completion from a trait source", async () => {
    const source = `<?php
namespace App\\Traits;

use Illuminate\\Database\\Eloquent\\Attributes\\Scope;
use Illuminate\\Database\\Eloquent\\Builder;

trait PublishedScope
{
    #[Scope]
    protected function published(Builder $query, bool $strict = true): void {}

    public function apply(): void { $this->; }
}`;
    const harness = renderHook(makeDeps());

    const completions = await harness
      .api()
      .resolvePhpReceiverMethodCompletions(
        source,
        positionAfter(source, "$this->"),
        "$this",
        {
          contextualThisClassName: null,
          declaringClassName: "App\\Traits\\PublishedScope",
          memberSource: source,
          traitMemberSource: source,
        },
      );
    const published = completions.filter(({ name }) => name === "published");

    expect(published).toEqual([
      expect.objectContaining({
        kind: "scope",
        parameters: "bool $strict = true",
      }),
    ]);
    harness.unmount();
  });

  it("returns one framework-owned Scope completion from a same-source host", async () => {
    const traitSource = `<?php
trait UsesPost { public function apply(): void { $this->; } }`;
    const hostSource = `<?php
use Illuminate\\Database\\Eloquent\\Attributes\\Scope;
use Illuminate\\Database\\Eloquent\\Builder;

class Post
{
    use UsesPost;

    #[Scope]
    protected function published(Builder $query): void {}
}`;
    const harness = renderHook(makeDeps());

    const completions = await harness
      .api()
      .resolvePhpReceiverMethodCompletions(
        traitSource,
        positionAfter(traitSource, "$this->"),
        "$this",
        {
          contextualThisClassName: "App\\Models\\Post",
          declaringClassName: "App\\Traits\\UsesPost",
          memberSource: traitSource,
          sameSourceHost: {
            className: "App\\Models\\Post",
            memberSource: hostSource,
          },
          traitMemberSource: traitSource,
        },
      );
    const published = completions.filter(({ name }) => name === "published");

    expect(published).toEqual([
      expect.objectContaining({ kind: "scope", parameters: "" }),
    ]);
    harness.unmount();
  });

  it("preserves overload signatures while collapsing a same-source Scope duplicate", async () => {
    const traitSource = `<?php
trait UsesPost { public function apply(): void { $this->; } }`;
    const hostSource = `<?php class Post { use UsesPost; }`;
    const memberCompletionCollector = {
      collect: vi.fn((source: string) => {
        if (source === traitSource) {
          return [method("find", { parameters: "int $id" })];
        }

        return [
          method("find", { parameters: "string $slug" }),
          method("published", { parameters: "bool $strict = true" }),
          method("published", {
            detail: "Laravel scope",
            kind: "scope",
            parameters: "bool   $strict = true",
          }),
        ];
      }),
    };
    const harness = renderHook(makeDeps({ memberCompletionCollector }));

    const completions = await harness
      .api()
      .resolvePhpReceiverMethodCompletions(
        traitSource,
        positionAfter(traitSource, "$this->"),
        "$this",
        {
          contextualThisClassName: "App\\Models\\Post",
          declaringClassName: "App\\Traits\\UsesPost",
          memberSource: traitSource,
          sameSourceHost: {
            className: "App\\Models\\Post",
            memberSource: hostSource,
          },
          traitMemberSource: traitSource,
        },
      );

    expect(
      completions.map(({ detail, kind, name, parameters }) => ({
        detail,
        kind,
        name,
        parameters,
      })),
    ).toEqual([
      {
        detail: undefined,
        kind: undefined,
        name: "find",
        parameters: "int $id",
      },
      {
        detail: undefined,
        kind: undefined,
        name: "find",
        parameters: "string $slug",
      },
      {
        detail: "Laravel scope",
        kind: "scope",
        name: "published",
        parameters: "bool   $strict = true",
      },
    ]);
    harness.unmount();
  });

  it("drops stale trait host completions after member collection", async () => {
    const source = `<?php
namespace App\\Traits;
trait SortableTrait { public function moveUp(): void { $this->get; } }
`;
    const collectedMembers = deferred<PhpMethodCompletion[]>();
    const collectPhpMethodsForClass = vi.fn(() => collectedMembers.promise);
    let isCurrent = true;
    const harness = renderHook(makeDeps({ collectPhpMethodsForClass }));
    const completions = harness.api().resolvePhpReceiverMethodCompletions(
      source,
      positionAfter(source, "$this->get"),
      "$this",
      {
        contextualThisClassName: null,
        declaringClassName: "App\\Traits\\SortableTrait",
        hostClassNames: ["App\\Repositories\\ArticleRepository"],
        memberSource: source,
      },
      () => isCurrent,
    );

    await vi.waitFor(() => {
      expect(collectPhpMethodsForClass).toHaveBeenCalledWith(
        "App\\Repositories\\ArticleRepository",
        { includeNonPublicMembers: true },
      );
    });
    isCurrent = false;
    collectedMembers.resolve([method("getTable")]);

    await expect(completions).resolves.toEqual([]);
    harness.unmount();
  });

  it("uses runtime Laravel state for the Laravel gate", async () => {
    const source = "<?php\n$post->";
    const collectPhpFrameworkSyntheticMethodsForClass = vi.fn(async () => [
      method("whereEmail", { kind: "magic-where" }),
    ]);
    const collectPhpMethodsForClass = vi.fn(async () => [
      method("scopePublished", { parameters: "$query" }),
      method("published", { kind: "scope" }),
      method("save"),
    ]);
    const resolvePhpFrameworkBuilderModelType = vi.fn(
      async () => "App\\Models\\Post",
    );
    const deps = makeDeps({
      collectPhpFrameworkSyntheticMethodsForClass,
      collectPhpMethodsForClass,
      frameworkRuntime: GENERIC_RUNTIME,
      resolvePhpFrameworkBuilderModelType,
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
    expect(resolvePhpFrameworkBuilderModelType).not.toHaveBeenCalled();
    expect(collectPhpFrameworkSyntheticMethodsForClass).not.toHaveBeenCalled();
    expect(collectPhpMethodsForClass).toHaveBeenCalledWith("App\\Models\\Post");
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
      collectPhpFrameworkSyntheticMethodsForClass: vi.fn(async () => [
        method("whereEmail", { kind: "magic-where" }),
        method("whereEmail", {
          declaringClassName: "App\\Models\\Duplicate",
          kind: "magic-where",
        }),
      ]),
      collectPhpMethodsForClass,
      resolvePhpFrameworkBuilderModelType: vi.fn(
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
    expect(collectPhpMethodsForClass).toHaveBeenCalledWith("App\\Models\\Post");

    harness.unmount();
  });

  it("uses collected concrete-only members for interface receiver completions", async () => {
    const source = `<?php
namespace App\\Repository;

use App\\Contracts\\StorageInterface;

class ReportRepository
{
    public function __construct(private StorageInterface $storage)
    {
    }

    public function run(): void
    {
        $this->storage->
    }
}
`;
    const collectPhpMethodsForClass = vi.fn(async (className: string) => {
      if (className === "App\\Contracts\\StorageInterface") {
        return [
          method("touch", {
            declaringClassName: "App\\Contracts\\StorageInterface",
          }),
          method("score", { declaringClassName: "App\\Storage\\RedisStorage" }),
        ];
      }

      return [];
    });
    const deps = makeDeps({
      collectPhpMethodsForClass,
      frameworkRuntime: GENERIC_RUNTIME,
      resolvePhpExpressionType: vi.fn(
        async () => "App\\Contracts\\StorageInterface",
      ),
    });
    const harness = renderHook(deps);

    const completions = await harness
      .api()
      .resolvePhpReceiverMethodCompletions(
        source,
        positionAfter(source, "$this->storage->"),
        "$this->storage",
      );

    expect(completions.map((completion) => completion.name)).toEqual([
      "touch",
      "score",
    ]);
    expect(collectPhpMethodsForClass).toHaveBeenCalledWith(
      "App\\Contracts\\StorageInterface",
    );

    harness.unmount();
  });

  it.each(["GeneratedActiveRow|null", "GeneratedActiveRow|false|null"])(
    "collects members for the sole object in %s",
    async (resolvedType) => {
      const source = "<?php\n$row->";
      const collectPhpMethodsForClass = vi.fn(async () => [method("update")]);
      const deps = makeDeps({
        collectPhpMethodsForClass,
        frameworkRuntime: GENERIC_RUNTIME,
        resolvePhpExpressionType: vi.fn(async () => resolvedType),
      });
      const harness = renderHook(deps);

      const completions = await harness
        .api()
        .resolvePhpReceiverMethodCompletions(
          source,
          { column: source.length + 1, lineNumber: 2 },
          "$row",
        );

      expect(completions.map((completion) => completion.name)).toEqual([
        "update",
      ]);
      expect(collectPhpMethodsForClass).toHaveBeenCalledOnce();
      expect(collectPhpMethodsForClass).toHaveBeenCalledWith(
        "GeneratedActiveRow",
      );

      harness.unmount();
    },
  );

  it.each([
    "GeneratedActiveRow|GeneratedSelection|null",
    "Collection<GeneratedActiveRow>|Fallback|null",
    "callable(GeneratedActiveRow|GeneratedSelection): Result|Fallback|null",
  ])(
    "abstains from ambiguous or unsupported carrier %s",
    async (resolvedType) => {
      const collectPhpMethodsForClass = vi.fn(async () => [method("update")]);
      const deps = makeDeps({
        collectPhpMethodsForClass,
        frameworkRuntime: GENERIC_RUNTIME,
        resolvePhpExpressionType: vi.fn(async () => resolvedType),
      });
      const harness = renderHook(deps);

      const completions = await harness
        .api()
        .resolvePhpReceiverMethodCompletions(
          "<?php\n$value->",
          { column: 9, lineNumber: 2 },
          "$value",
        );

      expect(completions).toEqual([]);
      expect(collectPhpMethodsForClass).not.toHaveBeenCalled();

      harness.unmount();
    },
  );

  it("preserves Laravel builder recovery when no base object type resolves", async () => {
    const source = "<?php\n$query->";
    const collectPhpMethodsForClass = vi.fn(async (className: string) => [
      method("scopePublished", {
        declaringClassName: className,
        parameters: "$query",
      }),
    ]);
    const deps = makeDeps({
      collectPhpMethodsForClass,
      resolvePhpExpressionType: vi.fn(async () => null),
      resolvePhpFrameworkBuilderModelType: vi.fn(
        async () => "App\\Models\\Post",
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
      "published",
    ]);
    expect(collectPhpMethodsForClass).toHaveBeenCalledOnce();
    expect(collectPhpMethodsForClass).toHaveBeenCalledWith("App\\Models\\Post");

    harness.unmount();
  });

  it("keeps union member collection isolated per resolver instance", async () => {
    const source = "<?php\n$row->";
    const firstCollector = vi.fn(async () => [method("firstProjectMethod")]);
    const secondCollector = vi.fn(async () => [method("secondProjectMethod")]);
    const receiverType = "GeneratedActiveRow|null";
    const firstHarness = renderHook(
      makeDeps({
        collectPhpMethodsForClass: firstCollector,
        frameworkRuntime: GENERIC_RUNTIME,
        resolvePhpExpressionType: vi.fn(async () => receiverType),
      }),
    );
    const secondHarness = renderHook(
      makeDeps({
        collectPhpMethodsForClass: secondCollector,
        frameworkRuntime: GENERIC_RUNTIME,
        resolvePhpExpressionType: vi.fn(async () => receiverType),
      }),
    );

    const firstCompletions = await firstHarness
      .api()
      .resolvePhpReceiverMethodCompletions(
        source,
        { column: source.length + 1, lineNumber: 2 },
        "$row",
      );
    const secondCompletions = await secondHarness
      .api()
      .resolvePhpReceiverMethodCompletions(
        source,
        { column: source.length + 1, lineNumber: 2 },
        "$row",
      );

    expect(firstCompletions.map((completion) => completion.name)).toEqual([
      "firstProjectMethod",
    ]);
    expect(secondCompletions.map((completion) => completion.name)).toEqual([
      "secondProjectMethod",
    ]);
    expect(firstCollector).toHaveBeenCalledWith("GeneratedActiveRow");
    expect(secondCollector).toHaveBeenCalledWith("GeneratedActiveRow");

    firstHarness.unmount();
    secondHarness.unmount();
  });

  it("keeps Laravel static model completions wired to scopes and dynamic where methods", async () => {
    const source = "<?php\nuse App\\Models\\Post;\nPost::";
    const deps = makeDeps({
      collectPhpFrameworkSyntheticMethodsForClass: vi.fn(async () => [
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
    expect(
      deps.collectPhpFrameworkSyntheticMethodsForClass,
    ).toHaveBeenCalledWith("App\\Models\\Post", { isStatic: true });

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
