import { describe, expect, it, vi } from "vitest";
import {
  createPhpLaravelDiagnosticContextStrategyAdapter,
  type PhpLaravelDiagnosticContextStrategyAdapterDependencies,
} from "./phpLaravelDiagnosticContextStrategyAdapter";

function makeDeps(
  overrides: Partial<PhpLaravelDiagnosticContextStrategyAdapterDependencies> = {},
): PhpLaravelDiagnosticContextStrategyAdapterDependencies {
  return {
    ensurePhpFrameworkSourceCollectionsLoaded: vi.fn(async () => undefined),
    phpClassHasLaravelDynamicWhere: vi.fn(async () => false),
    phpClassHasLaravelLocalScope: vi.fn(async () => false),
    resolvePhpEloquentBuilderModelType: vi.fn(async () => null),
    ...overrides,
  };
}

describe("phpLaravelDiagnosticContextStrategyAdapter", () => {
  it("matches member methods through Laravel local scopes", async () => {
    const phpClassHasLaravelLocalScope = vi.fn(async () => true);
    const deps = makeDeps({
      phpClassHasLaravelLocalScope,
      resolvePhpEloquentBuilderModelType: vi.fn(
        async () => "App\\Models\\Post",
      ),
    });
    const adapter = createPhpLaravelDiagnosticContextStrategyAdapter(deps);

    await expect(
      adapter.memberMethodExists({
        methodName: "published",
        position: { column: 22, lineNumber: 2 },
        receiverExpression: "Post::query()",
        source: "<?php\nPost::query()->published();",
      }),
    ).resolves.toBe(true);
    expect(phpClassHasLaravelLocalScope).toHaveBeenCalledWith(
      "App\\Models\\Post",
      "published",
    );
    expect(deps.phpClassHasLaravelDynamicWhere).toHaveBeenCalledWith(
      "App\\Models\\Post",
      "published",
    );
  });

  it("matches member methods through Laravel dynamic where methods", async () => {
    const deps = makeDeps({
      phpClassHasLaravelDynamicWhere: vi.fn(async () => true),
      resolvePhpEloquentBuilderModelType: vi.fn(
        async () => "App\\Models\\User",
      ),
    });
    const adapter = createPhpLaravelDiagnosticContextStrategyAdapter(deps);

    await expect(
      adapter.memberMethodExists({
        methodName: "whereEmail",
        position: { column: 20, lineNumber: 2 },
        receiverExpression: "User::query()",
        source: "<?php\nUser::query()->whereEmail();",
      }),
    ).resolves.toBe(true);
    expect(deps.phpClassHasLaravelLocalScope).toHaveBeenCalledWith(
      "App\\Models\\User",
      "whereEmail",
    );
    expect(deps.phpClassHasLaravelDynamicWhere).toHaveBeenCalledWith(
      "App\\Models\\User",
      "whereEmail",
    );
  });

  it("does not call Laravel predicates when member builder model resolution misses", async () => {
    const deps = makeDeps({
      resolvePhpEloquentBuilderModelType: vi.fn(async () => null),
    });
    const adapter = createPhpLaravelDiagnosticContextStrategyAdapter(deps);

    await expect(
      adapter.memberMethodExists({
        methodName: "published",
        position: { column: 22, lineNumber: 2 },
        receiverExpression: "$query",
        source: "<?php\n$query->published();",
      }),
    ).resolves.toBe(false);
    expect(deps.phpClassHasLaravelLocalScope).not.toHaveBeenCalled();
    expect(deps.phpClassHasLaravelDynamicWhere).not.toHaveBeenCalled();
  });

  it("matches static methods through local scopes and dynamic where methods", async () => {
    const scopeAdapter = createPhpLaravelDiagnosticContextStrategyAdapter(
      makeDeps({
        phpClassHasLaravelLocalScope: vi.fn(async () => true),
      }),
    );
    const dynamicWhereAdapter = createPhpLaravelDiagnosticContextStrategyAdapter(
      makeDeps({
        phpClassHasLaravelDynamicWhere: vi.fn(async () => true),
      }),
    );

    await expect(
      scopeAdapter.staticMethodExists({
        className: "App\\Models\\Post",
        methodName: "published",
      }),
    ).resolves.toBe(true);
    await expect(
      dynamicWhereAdapter.staticMethodExists({
        className: "App\\Models\\User",
        methodName: "whereEmail",
      }),
    ).resolves.toBe(true);
  });

  it("does not await framework source collection loading", () => {
    const pendingLoad = new Promise<void>(() => undefined);
    const ensurePhpFrameworkSourceCollectionsLoaded = vi.fn(
      () => pendingLoad,
    );
    const adapter = createPhpLaravelDiagnosticContextStrategyAdapter(
      makeDeps({ ensurePhpFrameworkSourceCollectionsLoaded }),
    );

    expect(
      adapter.ensureFrameworkSourceCollectionsLoaded("/workspace"),
    ).toBeUndefined();
    expect(ensurePhpFrameworkSourceCollectionsLoaded).toHaveBeenCalledWith(
      "/workspace",
    );
  });
});
