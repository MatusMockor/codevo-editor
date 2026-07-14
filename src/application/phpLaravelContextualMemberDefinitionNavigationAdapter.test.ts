import { describe, expect, it, vi } from "vitest";
import {
  createPhpLaravelContextualMemberDefinitionNavigationAdapter,
  createPhpLaravelContextualMemberDefinitionNavigationContribution,
  type PhpLaravelContextualMemberDefinitionNavigationAdapterDependencies,
} from "./phpLaravelContextualMemberDefinitionNavigationAdapter";

const POSITION = { column: 18, lineNumber: 3 };

function makeDeps(
  overrides: Partial<PhpLaravelContextualMemberDefinitionNavigationAdapterDependencies> = {},
): PhpLaravelContextualMemberDefinitionNavigationAdapterDependencies {
  return {
    openDirectPhpMethodTarget: vi.fn(async () => true),
    openPhpLaravelDynamicWhereTarget: vi.fn(async () => false),
    resolvePhpEloquentBuilderModelType: vi.fn(async () => null),
    resolvePhpExpressionType: vi.fn(async () => null),
    resolvePhpLaravelRelationPathOwnerType: vi.fn(
      async (ownerType: string) => ownerType,
    ),
    ...overrides,
  };
}

function relationContext(
  overrides: Partial<{
    className: string | null;
    previousRelationNames: string[];
    receiverExpression: string | null;
    relationName: string;
  }> = {},
) {
  return {
    className: null,
    kind: "laravelRelationString" as const,
    methodName: "with",
    receiverExpression: null,
    relationName: "author",
    ...overrides,
  };
}

describe("phpLaravelContextualMemberDefinitionNavigationAdapter", () => {
  it("creates a Laravel provider contribution for contextual member navigation", () => {
    const openPhpLaravelDynamicWhereTarget = vi.fn(async () => true);
    const contribution =
      createPhpLaravelContextualMemberDefinitionNavigationContribution(
        makeDeps({ openPhpLaravelDynamicWhereTarget }),
      );

    expect(contribution.providerId).toBe("laravel");
    expect(contribution.createAdapter().supportsBuilderModelNavigation()).toBe(
      true,
    );
  });

  it("keeps synchronous Laravel member semantics", () => {
    const adapter =
      createPhpLaravelContextualMemberDefinitionNavigationAdapter(makeDeps());

    expect(adapter.supportsBuilderModelNavigation()).toBe(true);
    expect(
      adapter.requestMethodDefinitionHint(
        "App\\Http\\Requests\\StorePostRequest",
        "input",
      ),
    ).toEqual({
      className: "Illuminate\\Http\\Concerns\\InteractsWithInput",
      methodName: "input",
    });
    expect(adapter.localScopeMethodName("published")).toBe("scopePublished");
    expect(adapter.localScopeMethodName("not-valid")).toBeNull();
    expect(adapter.staticBuilderTargetClassName("where")).toBe(
      "Illuminate\\Database\\Eloquent\\Builder",
    );
    expect(adapter.staticBuilderTargetClassName("domainMethod")).toBeNull();
  });

  it("delegates dynamic where opening with the class and method", async () => {
    const openPhpLaravelDynamicWhereTarget = vi.fn(async () => true);
    const adapter = createPhpLaravelContextualMemberDefinitionNavigationAdapter(
      makeDeps({ openPhpLaravelDynamicWhereTarget }),
    );

    await expect(
      adapter.dynamicWhereDefinition({
        className: "App\\Models\\Post",
        isRequestStillCurrent: () => true,
        methodName: "whereTitle",
      }),
    ).resolves.toEqual({ opened: true });
    expect(openPhpLaravelDynamicWhereTarget).toHaveBeenCalledWith(
      "App\\Models\\Post",
      "whereTitle",
    );
  });

  it("drops stale dynamic where results after the opener", async () => {
    const openPhpLaravelDynamicWhereTarget = vi.fn(async () => true);
    let currencyChecks = 0;
    const adapter = createPhpLaravelContextualMemberDefinitionNavigationAdapter(
      makeDeps({ openPhpLaravelDynamicWhereTarget }),
    );

    await expect(
      adapter.dynamicWhereDefinition({
        className: "App\\Models\\Post",
        isRequestStillCurrent: () => ++currencyChecks < 2,
        methodName: "whereTitle",
      }),
    ).resolves.toEqual({ opened: false });
    expect(openPhpLaravelDynamicWhereTarget).toHaveBeenCalledOnce();
  });

  it.each([
    {
      expectedOwner: "App\\Models\\Post",
      name: "static class",
      source: "<?php\nnamespace App\\Models;\nPost::with('author');",
      context: relationContext({ className: "Post" }),
      setup: {},
    },
    {
      expectedOwner: "App\\Models\\BuilderPost",
      name: "builder model",
      source: "<?php $query->with('author');",
      context: relationContext({ receiverExpression: "$query" }),
      setup: {
        resolvePhpEloquentBuilderModelType: vi.fn(
          async () => "App\\Models\\BuilderPost",
        ),
      },
    },
    {
      expectedOwner: "App\\Models\\ExpressionPost",
      name: "expression fallback",
      source: "<?php $post->load('author');",
      context: relationContext({ receiverExpression: "$post" }),
      setup: {
        resolvePhpExpressionType: vi.fn(
          async () => "App\\Models\\ExpressionPost",
        ),
      },
    },
  ])(
    "opens a relation method through the $name owner",
    async ({ context, expectedOwner, setup, source }) => {
      const openDirectPhpMethodTarget = vi.fn(async () => true);
      const resolvePhpLaravelRelationPathOwnerType = vi.fn(
        async (ownerType: string) => ownerType,
      );
      const deps = makeDeps({
        openDirectPhpMethodTarget,
        resolvePhpLaravelRelationPathOwnerType,
        ...setup,
      });
      const adapter =
        createPhpLaravelContextualMemberDefinitionNavigationAdapter(deps);

      await expect(
        adapter.relationStringDefinition({
          context,
          isRequestStillCurrent: () => true,
          position: POSITION,
          source,
        }),
      ).resolves.toEqual({ opened: true });
      expect(resolvePhpLaravelRelationPathOwnerType).toHaveBeenCalledWith(
        expectedOwner,
        [],
      );
      expect(openDirectPhpMethodTarget).toHaveBeenCalledWith(
        expectedOwner,
        "author",
      );

      if (context.receiverExpression) {
        expect(deps.resolvePhpEloquentBuilderModelType).toHaveBeenCalledWith(
          source,
          POSITION,
          context.receiverExpression,
        );
      }

      if (expectedOwner === "App\\Models\\ExpressionPost") {
        expect(deps.resolvePhpExpressionType).toHaveBeenCalledWith(
          source,
          POSITION,
          context.receiverExpression,
        );
        return;
      }

      expect(deps.resolvePhpExpressionType).not.toHaveBeenCalled();
    },
  );

  it("passes nested previous relation names to owner resolution", async () => {
    const resolvePhpLaravelRelationPathOwnerType = vi.fn(
      async () => "App\\Models\\Comment",
    );
    const openDirectPhpMethodTarget = vi.fn(async () => true);
    const adapter = createPhpLaravelContextualMemberDefinitionNavigationAdapter(
      makeDeps({
        openDirectPhpMethodTarget,
        resolvePhpLaravelRelationPathOwnerType,
      }),
    );

    await adapter.relationStringDefinition({
      context: relationContext({
        className: "App\\Models\\Post",
        previousRelationNames: ["comments", "replies"],
        relationName: "author",
      }),
      isRequestStillCurrent: () => true,
      position: POSITION,
      source: "<?php App\\Models\\Post::with('comments.replies.author');",
    });

    expect(resolvePhpLaravelRelationPathOwnerType).toHaveBeenCalledWith(
      "App\\Models\\Post",
      ["comments", "replies"],
    );
    expect(openDirectPhpMethodTarget).toHaveBeenCalledWith(
      "App\\Models\\Comment",
      "author",
    );
  });

  it("returns focused failures for unresolved owners and missing methods", async () => {
    const unresolvedAdapter =
      createPhpLaravelContextualMemberDefinitionNavigationAdapter(
        makeDeps({
          resolvePhpLaravelRelationPathOwnerType: vi.fn(async () => null),
        }),
      );
    const missingMethodAdapter =
      createPhpLaravelContextualMemberDefinitionNavigationAdapter(
        makeDeps({ openDirectPhpMethodTarget: vi.fn(async () => false) }),
      );
    const request = {
      context: relationContext({ className: "App\\Models\\Post" }),
      isRequestStillCurrent: () => true,
      position: POSITION,
      source: "<?php App\\Models\\Post::with('author');",
    };

    await expect(
      unresolvedAdapter.relationStringDefinition(request),
    ).resolves.toEqual({
      failureMessage: "No typed target found for relation author.",
      opened: false,
    });
    await expect(
      missingMethodAdapter.relationStringDefinition(request),
    ).resolves.toEqual({
      failureMessage:
        "No relation method found for App\\Models\\Post::author().",
      opened: false,
    });
  });

  it.each([
    { staleCheck: 2, stoppedBefore: "expression fallback" },
    { staleCheck: 3, stoppedBefore: "relation owner" },
    { staleCheck: 4, stoppedBefore: "method opener" },
    { staleCheck: 5, stoppedBefore: "opener result" },
  ])(
    "returns no failure when stale before $stoppedBefore",
    async ({ staleCheck }) => {
      let currencyChecks = 0;
      const deps = makeDeps({
        openDirectPhpMethodTarget: vi.fn(async () => false),
        resolvePhpEloquentBuilderModelType: vi.fn(async () => null),
        resolvePhpExpressionType: vi.fn(async () => "App\\Models\\Post"),
        resolvePhpLaravelRelationPathOwnerType: vi.fn(
          async () => "App\\Models\\Post",
        ),
      });
      const adapter =
        createPhpLaravelContextualMemberDefinitionNavigationAdapter(deps);

      await expect(
        adapter.relationStringDefinition({
          context: relationContext({ receiverExpression: "$post" }),
          isRequestStillCurrent: () => ++currencyChecks !== staleCheck,
          position: POSITION,
          source: "<?php $post->load('author');",
        }),
      ).resolves.toEqual({ opened: false });

      expect(deps.resolvePhpExpressionType).toHaveBeenCalledTimes(
        staleCheck >= 3 ? 1 : 0,
      );
      expect(deps.resolvePhpLaravelRelationPathOwnerType).toHaveBeenCalledTimes(
        staleCheck >= 4 ? 1 : 0,
      );
      expect(deps.openDirectPhpMethodTarget).toHaveBeenCalledTimes(
        staleCheck >= 5 ? 1 : 0,
      );
    },
  );
});
