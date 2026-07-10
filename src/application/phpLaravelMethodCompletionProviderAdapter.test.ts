import { describe, expect, it, vi } from "vitest";
import type { PhpMethodCompletion } from "../domain/phpMethodCompletions";
import {
  createPhpLaravelMethodCompletionProviderAdapter,
  type PhpLaravelMethodCompletionProviderAdapterDependencies,
} from "./phpLaravelMethodCompletionProviderAdapter";

function method(
  name: string,
  overrides: Partial<PhpMethodCompletion> = {},
): PhpMethodCompletion {
  return {
    declaringClassName: "App\\Http\\Controllers\\PostController",
    name,
    parameters: "",
    returnType: "void",
    visibility: "public",
    ...overrides,
  };
}

function makeDeps(
  overrides: Partial<PhpLaravelMethodCompletionProviderAdapterDependencies> = {},
): PhpLaravelMethodCompletionProviderAdapterDependencies {
  return {
    collectPhpLaravelRelationCompletionsForClass: vi.fn(async () => []),
    collectPhpMethodsForClass: vi.fn(async () => []),
    ensurePhpFrameworkSourceCollectionsLoaded: vi.fn(async () => undefined),
    resolvePhpClassReference: vi.fn(
      (_source, className) => `App\\Http\\Controllers\\${className}`,
    ),
    resolvePhpEloquentBuilderModelType: vi.fn(async () => null),
    resolvePhpExpressionType: vi.fn(async () => null),
    resolvePhpLaravelRelationPathOwnerType: vi.fn(async () => null),
    ...overrides,
  };
}

function positionAfter(source: string, needle: string) {
  const offset = source.indexOf(needle);

  if (offset < 0) {
    throw new Error(`Missing test needle: ${needle}`);
  }

  const before = source.slice(0, offset + needle.length);
  const lines = before.split("\n");

  return {
    column: (lines[lines.length - 1]?.length ?? 0) + 1,
    lineNumber: lines.length,
  };
}

describe("phpLaravelMethodCompletionProviderAdapter", () => {
  it("returns null when a request is not a Laravel route action or relation string", async () => {
    const adapter = createPhpLaravelMethodCompletionProviderAdapter(makeDeps());
    const request = {
      isRequestStillCurrent: () => true,
      position: { column: 6, lineNumber: 2 },
      source: "<?php\n$post->save()",
    };

    await expect(adapter.routeActionCompletions(request)).resolves.toBeNull();
    await expect(adapter.relationStringCompletions(request)).resolves.toBeNull();
  });

  it("filters, sorts, limits, and stabilizes route-action method metadata", async () => {
    const source = `<?php
use App\\Http\\Controllers\\PostController;

Route::get('/posts', [PostController::class, 'in']);
`;
    const matchingMethods = Array.from({ length: 85 }, (_, index) =>
      method(`in${String(index).padStart(2, "0")}`),
    );
    const adapter = createPhpLaravelMethodCompletionProviderAdapter(
      makeDeps({
        collectPhpMethodsForClass: vi.fn(async () => [
          method("inspect"),
          method("in"),
          ...matchingMethods,
          method("internal", { visibility: "protected" }),
          method("instance", { isStatic: true }),
          method("items", { kind: "property" }),
        ]),
      }),
    );

    const completions = await adapter.routeActionCompletions({
      isRequestStillCurrent: () => true,
      position: positionAfter(source, "'in"),
      source,
    });

    expect(completions).toHaveLength(80);
    expect(completions?.slice(0, 3).map(({ name }) => name)).toEqual([
      "in",
      "in00",
      "in01",
    ]);
    expect(completions?.some(({ name }) => name === "internal")).toBe(false);
    expect(completions?.some(({ name }) => name === "instance")).toBe(false);
    expect(completions?.some(({ name }) => name === "items")).toBe(false);
    expect(Object.keys(completions?.[0] ?? {})).not.toContain("visibility");
    expect(completions?.[0]?.visibility).toBe("public");
  });

  it("returns handled-empty route actions that become stale after collection", async () => {
    const source = "<?php\nRoute::get('/posts', [PostController::class, 'in']);";
    const adapter = createPhpLaravelMethodCompletionProviderAdapter(
      makeDeps({
        collectPhpMethodsForClass: vi.fn(async () => [method("index")]),
      }),
    );

    await expect(
      adapter.routeActionCompletions({
        isRequestStillCurrent: () => false,
        position: positionAfter(source, "'in"),
        source,
      }),
    ).resolves.toEqual([]);
  });

  it("resolves and filters relation strings from the exact owner path", async () => {
    const source = "<?php\nPost::with('comments.aut')->first();";
    const resolvePhpLaravelRelationPathOwnerType = vi.fn(
      async () => "App\\Models\\Comment",
    );
    const adapter = createPhpLaravelMethodCompletionProviderAdapter(
      makeDeps({
        collectPhpLaravelRelationCompletionsForClass: vi.fn(async () => [
          method("author"),
          method("attachments"),
        ]),
        resolvePhpClassReference: vi.fn(() => "App\\Models\\Post"),
        resolvePhpLaravelRelationPathOwnerType,
      }),
    );

    const completions = await adapter.relationStringCompletions({
      isRequestStillCurrent: () => true,
      position: positionAfter(source, "comments.aut"),
      source,
    });

    expect(completions?.map(({ name }) => name)).toEqual(["author"]);
    expect(resolvePhpLaravelRelationPathOwnerType).toHaveBeenCalledWith(
      "App\\Models\\Post",
      ["comments"],
    );
  });

  it("sorts and limits relation string completions to 80", async () => {
    const source = "<?php\nPost::with('re')->first();";
    const relations = Array.from({ length: 85 }, (_, index) =>
      method(`relation${String(index).padStart(2, "0")}`),
    );
    const adapter = createPhpLaravelMethodCompletionProviderAdapter(
      makeDeps({
        collectPhpLaravelRelationCompletionsForClass: vi.fn(async () => [
          method("re"),
          ...relations,
        ]),
        resolvePhpClassReference: vi.fn(() => "App\\Models\\Post"),
        resolvePhpLaravelRelationPathOwnerType: vi.fn(
          async () => "App\\Models\\Post",
        ),
      }),
    );

    const completions = await adapter.relationStringCompletions({
      isRequestStillCurrent: () => true,
      position: positionAfter(source, "with('re"),
      source,
    });

    expect(completions).toHaveLength(80);
    expect(completions?.slice(0, 3).map(({ name }) => name)).toEqual([
      "re",
      "relation00",
      "relation01",
    ]);
  });

  it.each([
    ["builder model resolution", 1],
    ["receiver type resolution", 2],
    ["relation owner resolution", 3],
    ["relation collection", 4],
  ])("checks request currency after %s", async (_stage, staleCheck) => {
    const source = "<?php\n$post->load('comments.aut');";
    const collectPhpLaravelRelationCompletionsForClass = vi.fn(async () => [
      method("author"),
    ]);
    const resolvePhpLaravelRelationPathOwnerType = vi.fn(
      async () => "App\\Models\\Comment",
    );
    const adapter = createPhpLaravelMethodCompletionProviderAdapter(
      makeDeps({
        collectPhpLaravelRelationCompletionsForClass,
        resolvePhpExpressionType: vi.fn(async () => "App\\Models\\Post"),
        resolvePhpLaravelRelationPathOwnerType,
      }),
    );
    let checks = 0;

    await expect(
      adapter.relationStringCompletions({
        isRequestStillCurrent: () => ++checks !== staleCheck,
        position: positionAfter(source, "comments.aut"),
        source,
      }),
    ).resolves.toEqual([]);

    expect(checks).toBe(staleCheck);
    if (staleCheck < 3) {
      expect(resolvePhpLaravelRelationPathOwnerType).not.toHaveBeenCalled();
    }
    if (staleCheck < 4) {
      expect(collectPhpLaravelRelationCompletionsForClass).not.toHaveBeenCalled();
    }
  });

  it("starts access collection warmup synchronously without awaiting it", () => {
    const pendingWarmup = new Promise<void>(() => undefined);
    const ensurePhpFrameworkSourceCollectionsLoaded = vi.fn(
      () => pendingWarmup,
    );
    const adapter = createPhpLaravelMethodCompletionProviderAdapter(
      makeDeps({ ensurePhpFrameworkSourceCollectionsLoaded }),
    );

    const result = adapter.ensureSourceCollectionsLoadedForAccess({
      accessContext: {
        prefix: "lo",
        receiverExpression: "$post",
        variableName: "$post",
      },
      rootPath: "/workspace-a",
      staticAccessContext: null,
    });

    expect(ensurePhpFrameworkSourceCollectionsLoaded).toHaveBeenCalledWith(
      "/workspace-a",
    );
    expect(result).toBeUndefined();
  });
});
