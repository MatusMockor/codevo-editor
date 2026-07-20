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
    frameworkRuntime: {
      hasProvider: () => true,
      supports: (capability) => capability === "eloquentModelSemantics",
    },
    resolvePhpFrameworkBuilderModelType: vi.fn(async () => null),
    ...overrides,
  };
}

describe("phpFrameworkMethodCompletionSemanticsAdapters", () => {
  it.each([
    { activeProviderId: null, label: "generic" },
    { activeProviderId: "nette", label: "Nette" },
    { activeProviderId: "custom", label: "custom" },
    { activeProviderId: "laravel", label: "stale Laravel provider-id" },
  ])("keeps $label providers inert", async ({ activeProviderId }) => {
    const collectPhpFrameworkSyntheticMethodsForClass = vi.fn(async () => [
      method("whereEmail", { kind: "magic-where" }),
    ]);
    const resolvePhpFrameworkBuilderModelType = vi.fn(
      async () => "App\\Models\\Post",
    );
    const frameworkRuntime = {
      hasProvider: vi.fn(
        (providerId: string) => providerId === activeProviderId,
      ),
      supports: vi.fn(() => false),
    };
    const adapter = createPhpFrameworkMethodCompletionSemanticsAdapters(
      makeDeps({
        collectPhpFrameworkSyntheticMethodsForClass,
        frameworkRuntime,
        resolvePhpFrameworkBuilderModelType,
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

    expect(frameworkRuntime.hasProvider).not.toHaveBeenCalled();
    expect(frameworkRuntime.supports).toHaveBeenCalledWith(
      "eloquentModelSemantics",
    );
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
    expect(resolvePhpFrameworkBuilderModelType).not.toHaveBeenCalled();
    expect(collectPhpFrameworkSyntheticMethodsForClass).not.toHaveBeenCalled();
  });

  it.each([
    {
      label: "Laravel provider",
      frameworkRuntime: {
        hasProvider: (providerId: string) => providerId === "laravel",
        supports: (capability: string) =>
          capability === "eloquentModelSemantics",
      },
    },
    {
      label: "custom Eloquent provider",
      frameworkRuntime: {
        hasProvider: (providerId: string) => providerId === "custom",
        supports: (capability: string) =>
          capability === "eloquentModelSemantics",
      },
    },
  ])("returns Laravel method completion semantics for $label", ({
    frameworkRuntime,
  }) => {
    const adapter = createPhpFrameworkMethodCompletionSemanticsAdapters(
      makeDeps({ frameworkRuntime }),
    );

    expect(
      adapter.facadeTargetClassName("Illuminate\\Support\\Facades\\Cache"),
    ).toBe("Illuminate\\Cache\\CacheManager");
  });
});
