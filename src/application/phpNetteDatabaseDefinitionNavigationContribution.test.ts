import { describe, expect, it, vi } from "vitest";
import { createPhpFrameworkDefinitionNavigationRegistry } from "./phpFrameworkDefinitionNavigationContributions";
import { createPhpNetteDatabaseDefinitionNavigationContribution } from "./phpNetteDatabaseDefinitionNavigationContribution";

function activation(isCurrent: () => boolean = () => true, ownerKey = "owner") {
  return {
    generation: 1,
    isCurrent,
    ownerKey,
    rootPath: "/workspace",
  };
}

describe("phpNetteDatabaseDefinitionNavigationContribution", () => {
  it.each([
    ["Laravel", "laravel"],
    ["generic PHP", null],
  ])("does not activate for %s", async (_label, activeProviderId) => {
    const resolvePhpExpressionType = vi.fn(
      async () => "Generated\\ActiveRow\\UsersActiveRow",
    );
    const registry = createPhpFrameworkDefinitionNavigationRegistry({
      activation: activation(),
      frameworkRuntime: {
        hasProvider: (providerId) => providerId === activeProviderId,
        supports: () => false,
      },
      contributions: [
        createPhpNetteDatabaseDefinitionNavigationContribution({
          openPhpClassTarget: vi.fn(async () => true),
          readNavigationFileContent: vi.fn(async () => ""),
          resolvePhpClassSourcePaths: vi.fn(async () => []),
          resolvePhpExpressionType,
        }),
      ],
    });
    const source = "$user->related('orders.user_id')";

    await expect(
      registry.provideDefinition(source, source.indexOf("orders") + 2),
    ).resolves.toBe(false);
    expect(resolvePhpExpressionType).not.toHaveBeenCalled();
  });

  it("preserves the workspace activity guard while resolving", async () => {
    let active = true;
    const openPhpClassTarget = vi.fn(async () => true);
    const registry = createPhpFrameworkDefinitionNavigationRegistry({
      activation: activation(() => active),
      frameworkRuntime: {
        hasProvider: (providerId) => providerId === "nette",
        supports: (capability) => capability === "netteDatabaseSemantics",
      },
      contributions: [
        createPhpNetteDatabaseDefinitionNavigationContribution({
          openPhpClassTarget,
          readNavigationFileContent: vi.fn(async () => ""),
          resolvePhpClassSourcePaths: vi.fn(async () => []),
          resolvePhpExpressionType: vi.fn(async () => {
            active = false;
            return "Generated\\ActiveRow\\UsersActiveRow";
          }),
        }),
      ],
    });
    const source = "$user->related('orders.user_id')";

    await expect(
      registry.provideDefinition(source, source.indexOf("orders") + 2),
    ).resolves.toBe(false);
    expect(openPhpClassTarget).not.toHaveBeenCalled();
  });

  it("does not commit navigation after the same workspace root is reopened", async () => {
    let generation = 1;
    const resolvedType = deferred<string | null>();
    const openPhpClassTarget = vi.fn(async () => true);
    const registry = createPhpFrameworkDefinitionNavigationRegistry({
      activation: activation(() => generation === 1),
      frameworkRuntime: {
        hasProvider: (providerId) => providerId === "nette",
        supports: (capability) => capability === "netteDatabaseSemantics",
      },
      contributions: [
        createPhpNetteDatabaseDefinitionNavigationContribution({
          openPhpClassTarget,
          readNavigationFileContent: vi.fn(async () => ""),
          resolvePhpClassSourcePaths: vi.fn(async () => []),
          resolvePhpExpressionType: vi.fn(() => resolvedType.promise),
        }),
      ],
    });
    const source = "$user->related('orders.user_id')";
    const pending = registry.provideDefinition(
      source,
      source.indexOf("orders") + 2,
    );

    generation = 2;
    resolvedType.resolve("Generated\\ActiveRow\\UsersActiveRow");

    await expect(pending).resolves.toBe(false);
    expect(openPhpClassTarget).not.toHaveBeenCalled();
  });

  it("reuses one database resolver per provider and isolates workspace providers", async () => {
    const targetType = "Generated\\Selection\\OrdersSelection";
    const createDatabaseTypeResolver = vi.fn(() => ({
      resolveClassTypes: vi.fn(async () => null),
      resolveTableType: vi.fn(async () => targetType),
    }));
    const contribution = createPhpNetteDatabaseDefinitionNavigationContribution(
      {
        createDatabaseTypeResolver,
        openPhpClassTarget: vi.fn(async () => true),
        readNavigationFileContent: vi.fn(async () => ""),
        resolvePhpClassSourcePaths: vi.fn(async () => []),
        resolvePhpExpressionType: vi.fn(
          async () => "Generated\\ActiveRow\\UsersActiveRow",
        ),
      },
    );
    const createRegistry = (ownerKey: string) =>
      createPhpFrameworkDefinitionNavigationRegistry({
        activation: activation(() => true, ownerKey),
        frameworkRuntime: {
          hasProvider: (providerId) => providerId === "nette",
          supports: (capability) => capability === "netteDatabaseSemantics",
        },
        contributions: [contribution],
      });
    const source = "$user->related('orders.user_id')";
    const offset = source.indexOf("orders") + 2;
    const firstWorkspace = createRegistry("owner-a");

    await expect(
      firstWorkspace.provideDefinition(source, offset),
    ).resolves.toBe(true);
    await expect(
      firstWorkspace.provideDefinition(source, offset),
    ).resolves.toBe(true);
    expect(createDatabaseTypeResolver).toHaveBeenCalledOnce();

    const secondWorkspace = createRegistry("owner-b");
    await expect(
      secondWorkspace.provideDefinition(source, offset),
    ).resolves.toBe(true);
    expect(createDatabaseTypeResolver).toHaveBeenCalledTimes(2);
  });

  it("drops its workspace-scoped resolver after provider abort", async () => {
    const clear = vi.fn();
    const createDatabaseTypeResolver = vi.fn(() => ({
      clear,
      resolveClassTypes: vi.fn(async () => null),
      resolveTableType: vi.fn(
        async () => "Generated\\Selection\\OrdersSelection",
      ),
    }));
    const contribution = createPhpNetteDatabaseDefinitionNavigationContribution(
      {
        createDatabaseTypeResolver,
        openPhpClassTarget: vi.fn(async () => true),
        readNavigationFileContent: vi.fn(async () => ""),
        resolvePhpClassSourcePaths: vi.fn(async () => []),
        resolvePhpExpressionType: vi.fn(
          async () => "Generated\\ActiveRow\\UsersActiveRow",
        ),
      },
    );
    const scope = executionScope();
    const provider = contribution.createProvider();
    const source = "$user->related('orders.user_id')";

    await expect(
      provider.provideDefinition(
        source,
        source.indexOf("orders") + 2,
        undefined,
        scope,
      ),
    ).resolves.toBe(true);
    provider.abort?.();

    await expect(
      provider.provideDefinition(
        source,
        source.indexOf("orders") + 2,
        undefined,
        scope,
      ),
    ).resolves.toBe(false);
    expect(createDatabaseTypeResolver).toHaveBeenCalledOnce();
    expect(createDatabaseTypeResolver).toHaveBeenCalledWith(
      expect.objectContaining({ cachePolicy: "generation" }),
    );
    expect(clear).toHaveBeenCalledOnce();
  });

  it("passes the activation signal to cooperative I/O and rejects a stale result", async () => {
    const readResult = deferred<string>();
    const readNavigationFileContent = vi.fn(
      (_path: string, _signal?: AbortSignal) => readResult.promise,
    );
    const resolvePhpClassSourcePaths = vi.fn(
      async (_className: string, _signal?: AbortSignal) => ["/row.php"],
    );
    const createDatabaseTypeResolver = vi.fn((dependencies) => ({
      resolveClassTypes: vi.fn(async () => null),
      resolveTableType: vi.fn(async () => {
        await dependencies.resolveClassSourcePaths("Generated\\Row");
        await dependencies.readClassSource("/row.php", "Generated\\Row");
        return "Generated\\Selection\\OrdersSelection";
      }),
    }));
    const registry = createPhpFrameworkDefinitionNavigationRegistry({
      activation: activation(),
      frameworkRuntime: {
        hasProvider: (providerId) => providerId === "nette",
        supports: (capability) => capability === "netteDatabaseSemantics",
      },
      contributions: [
        createPhpNetteDatabaseDefinitionNavigationContribution({
          createDatabaseTypeResolver,
          openPhpClassTarget: vi.fn(async () => true),
          readNavigationFileContent,
          resolvePhpClassSourcePaths,
          resolvePhpExpressionType: vi.fn(
            async () => "Generated\\ActiveRow\\UsersActiveRow",
          ),
        }),
      ],
    });
    const source = "$user->related('orders.user_id')";
    const pending = registry.provideDefinition(
      source,
      source.indexOf("orders") + 2,
    );

    await vi.waitFor(() => {
      expect(readNavigationFileContent).toHaveBeenCalledOnce();
    });
    const signal = readNavigationFileContent.mock.calls[0]?.[1];
    expect(resolvePhpClassSourcePaths).toHaveBeenCalledWith(
      "Generated\\Row",
      signal,
    );
    expect(signal).toBeInstanceOf(AbortSignal);

    registry.abort?.();
    readResult.resolve("<?php");

    await expect(pending).resolves.toBe(false);
    expect(signal?.aborted).toBe(true);
  });
});

function executionScope() {
  const signal = new AbortController().signal;

  return {
    ...activation(),
    signal,
    canCommit: () => !signal.aborted,
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((innerResolve) => {
    resolve = innerResolve;
  });

  return { promise, resolve };
}
