import { describe, expect, it, vi } from "vitest";
import type { PhpMethodCompletion } from "../domain/phpMethodCompletions";
import {
  createPhpFrameworkMethodCompletionSemanticsAdapters,
  type PhpFrameworkMethodCompletionSemanticsAdapterDependencies,
} from "./phpFrameworkMethodCompletionSemanticsAdapters";

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
  overrides: Partial<PhpFrameworkMethodCompletionSemanticsAdapterDependencies> = {},
): PhpFrameworkMethodCompletionSemanticsAdapterDependencies {
  return {
    collectPhpFrameworkSyntheticMethodsForClass: vi.fn(async () => []),
    frameworkRuntime: { hasProvider: () => true },
    resolvePhpEloquentBuilderModelType: vi.fn(async () => null),
    ...overrides,
  };
}

describe("phpFrameworkMethodCompletionSemanticsAdapters", () => {
  it.each([
    { activeProviderId: null, label: "generic" },
    { activeProviderId: "nette", label: "Nette" },
    { activeProviderId: "custom", label: "custom" },
  ])("keeps $label providers inert", async ({ activeProviderId }) => {
    const collectPhpFrameworkSyntheticMethodsForClass = vi.fn(async () => [
      method("whereEmail", { kind: "magic-where" }),
    ]);
    const resolvePhpEloquentBuilderModelType = vi.fn(
      async () => "App\\Models\\Post",
    );
    const frameworkRuntime = {
      hasProvider: vi.fn(
        (providerId: string) => providerId === activeProviderId,
      ),
      isLaravel: true,
    };
    const adapter = createPhpFrameworkMethodCompletionSemanticsAdapters(
      makeDeps({
        collectPhpFrameworkSyntheticMethodsForClass,
        frameworkRuntime,
        resolvePhpEloquentBuilderModelType,
      }),
    );

    const receiverGroups = await adapter.receiverCompletionGroups({
      collectPhpMethodsForClass: vi.fn(async () => []),
      position: { column: 8, lineNumber: 2 },
      receiverExpression: "$post",
      receiverMethods: [
        method("scopePublished", { parameters: "$query" }),
        method("published", { kind: "scope" }),
        method("save"),
      ],
      resolvedReceiverType: "App\\Models\\Post",
      source: "<?php\n$post->",
    });
    const staticGroups = await adapter.staticCompletionGroups({
      className: "App\\Models\\Post",
      methods: [
        method("factory", { isStatic: true }),
        method("save"),
      ],
      source: "<?php\nPost::",
    });

    expect(frameworkRuntime.hasProvider).toHaveBeenCalledWith("laravel");
    expect(adapter.facadeTargetClassName("Illuminate\\Support\\Facades\\Cache")).toBeNull();
    expect(receiverGroups).toEqual({
      baseMethods: [
        method("scopePublished", { parameters: "$query" }),
        method("save"),
      ],
      dynamicWhereMethods: [],
      localScopeMethods: [],
    });
    expect(staticGroups).toEqual({
      baseMethods: [method("factory", { isStatic: true })],
      dynamicWhereMethods: [],
      localScopeMethods: [],
    });
    expect(resolvePhpEloquentBuilderModelType).not.toHaveBeenCalled();
    expect(collectPhpFrameworkSyntheticMethodsForClass).not.toHaveBeenCalled();
  });

  it("returns Laravel method completion semantics when the Laravel provider is active", () => {
    const adapter = createPhpFrameworkMethodCompletionSemanticsAdapters(
      makeDeps({
        frameworkRuntime: { hasProvider: (providerId) => providerId === "laravel" },
      }),
    );

    expect(
      adapter.facadeTargetClassName("Illuminate\\Support\\Facades\\Cache"),
    ).toBe("Illuminate\\Cache\\CacheManager");
  });
});
