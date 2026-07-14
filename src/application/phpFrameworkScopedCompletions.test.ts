import { describe, expect, it, vi } from "vitest";
import {
  phpLaravelFrameworkProvider,
  phpNetteFrameworkProvider,
  type PhpFrameworkProvider,
} from "../domain/phpFrameworkProviders";
import { createPhpFrameworkIntelligence } from "./phpFrameworkIntelligence";
import { createPhpFrameworkRuntimeContext } from "./phpFrameworkRuntimeContext";
import {
  resolvePhpFrameworkScopedCompletions,
  type PhpFrameworkScopedCompletionDependencies,
} from "./phpFrameworkScopedCompletions";

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
const NETTE_RUNTIME = createPhpFrameworkRuntimeContext(
  createPhpFrameworkIntelligence({
    matchedProviderIds: ["nette"],
    profile: "nette",
    providers: [phpNetteFrameworkProvider],
  }),
);
const STALE_LARAVEL_PROFILE_RUNTIME = createPhpFrameworkRuntimeContext(
  createPhpFrameworkIntelligence({
    matchedProviderIds: [],
    profile: "laravel",
    providers: [],
  }),
);
const PLAIN_COMPLETION_BEHAVIOR = {
  insertTextMode: "plain",
  triggerParameterHints: false,
} as const;

function dependencies(
  overrides: Partial<PhpFrameworkScopedCompletionDependencies> = {},
): PhpFrameworkScopedCompletionDependencies {
  return {
    collectAuthGuardTargets: vi.fn(async () => []),
    collectBroadcastConnectionTargets: vi.fn(async () => []),
    collectCacheStoreTargets: vi.fn(async () => []),
    collectDatabaseConnectionTargets: vi.fn(async () => []),
    collectGateAbilityTargets: vi.fn(async () => []),
    collectLogChannelTargets: vi.fn(async () => []),
    collectMailMailerTargets: vi.fn(async () => []),
    collectMiddlewareAliasTargets: vi.fn(async () => []),
    collectPasswordBrokerTargets: vi.fn(async () => []),
    collectQueueConnectionTargets: vi.fn(async () => []),
    collectRedisConnectionTargets: vi.fn(async () => []),
    collectStorageDiskTargets: vi.fn(async () => []),
    isRequestStillCurrent: vi.fn(() => true),
    ...overrides,
  };
}

describe("resolvePhpFrameworkScopedCompletions", () => {
  it("returns null and does not collect when runtime has no Laravel provider", async () => {
    const deps = dependencies({
      collectAuthGuardTargets: vi.fn(async () => [
        {
          guardName: "admin",
          key: "auth.guards.admin",
          path: "/workspace/config/auth.php",
          position: { column: 1, lineNumber: 1 },
          relativePath: "config/auth.php",
        },
      ]),
    });
    const source = "<?php\nreturn Auth::guard('ad');";

    await expect(
      resolvePhpFrameworkScopedCompletions(
        {
          activeDocument: {
            path: "/workspace/app/Http/Controllers/HomeController.php",
          },
          frameworkRuntime: GENERIC_RUNTIME,
          position: positionAfter(source, "ad"),
          source,
        },
        deps,
      ),
    ).resolves.toBeNull();

    expect(deps.collectAuthGuardTargets).not.toHaveBeenCalled();
  });

  it("does not activate Laravel completions for Nette runtime", async () => {
    const deps = dependencies({
      collectAuthGuardTargets: vi.fn(async () => [
        {
          guardName: "admin",
          key: "auth.guards.admin",
          path: "/workspace/config/auth.php",
          position: { column: 1, lineNumber: 1 },
          relativePath: "config/auth.php",
        },
      ]),
    });
    const source = "<?php\nreturn Auth::guard('ad');";

    await expect(
      resolvePhpFrameworkScopedCompletions(
        {
          activeDocument: {
            path: "/workspace/app/Http/Controllers/HomeController.php",
          },
          frameworkRuntime: NETTE_RUNTIME,
          position: positionAfter(source, "ad"),
          source,
        },
        deps,
      ),
    ).resolves.toBeNull();

    expect(deps.collectAuthGuardTargets).not.toHaveBeenCalled();
  });

  it("uses provider identity instead of stale Laravel profile state", async () => {
    const deps = dependencies({
      collectAuthGuardTargets: vi.fn(async () => [
        {
          guardName: "admin",
          key: "auth.guards.admin",
          path: "/workspace/config/auth.php",
          position: { column: 1, lineNumber: 1 },
          relativePath: "config/auth.php",
        },
      ]),
    });
    const source = "<?php\nreturn Auth::guard('ad');";

    await expect(
      resolvePhpFrameworkScopedCompletions(
        {
          activeDocument: {
            path: "/workspace/app/Http/Controllers/HomeController.php",
          },
          frameworkRuntime: STALE_LARAVEL_PROFILE_RUNTIME,
          position: positionAfter(source, "ad"),
          source,
        },
        deps,
      ),
    ).resolves.toBeNull();

    expect(deps.collectAuthGuardTargets).not.toHaveBeenCalled();
  });

  it("ignores leaked legacy Laravel booleans when runtime is generic", async () => {
    const deps = dependencies({
      collectAuthGuardTargets: vi.fn(async () => [
        {
          guardName: "admin",
          key: "auth.guards.admin",
          path: "/workspace/config/auth.php",
          position: { column: 1, lineNumber: 1 },
          relativePath: "config/auth.php",
        },
      ]),
    });
    const source = "<?php\nreturn Auth::guard('ad');";
    const requestWithLegacyLeak = {
      activeDocument: {
        path: "/workspace/app/Http/Controllers/HomeController.php",
      },
      frameworkRuntime: GENERIC_RUNTIME,
      isLaravelFrameworkActive: true,
      position: positionAfter(source, "ad"),
      source,
    };

    await expect(
      resolvePhpFrameworkScopedCompletions(requestWithLegacyLeak, deps),
    ).resolves.toBeNull();

    expect(deps.collectAuthGuardTargets).not.toHaveBeenCalled();
  });

  it("does not synthesize Laravel scoped items for custom providers without formatter hooks", async () => {
    const customRuntime = runtimeForCustomProvider({
      id: "custom",
      php: {
        scopedStringCompletionAt: () => ({
          kind: "authGuard",
          prefix: "ad",
        }),
      },
    });
    const deps = dependencies({
      collectAuthGuardTargets: vi.fn(async () => [
        {
          guardName: "admin",
          key: "auth.guards.admin",
          path: "/workspace/config/auth.php",
          position: { column: 12, lineNumber: 4 },
          relativePath: "config/auth.php",
        },
      ]),
    });
    const source = "<?php\nreturn custom_guard('ad');";

    await expect(
      resolvePhpFrameworkScopedCompletions(
        {
          activeDocument: {
            path: "/workspace/app/Http/Controllers/HomeController.php",
          },
          frameworkRuntime: customRuntime,
          position: positionAfter(source, "ad"),
          source,
        },
        deps,
      ),
    ).resolves.toBeNull();

    expect(deps.collectAuthGuardTargets).not.toHaveBeenCalled();
  });

  it("does not route custom scoped providers into Laravel collectors", async () => {
    const customRuntime = runtimeForCustomProvider({
      id: "custom",
      php: {
        scopedStringCompletionAt: () => ({
          kind: "authGuard",
          prefix: "ad",
        }),
        scopedStringCompletionInsertText: ({ name }) => `custom:${name}`,
      },
    });
    const deps = dependencies({
      collectAuthGuardTargets: vi.fn(async () => [
        {
          guardName: "admin",
          key: "auth.guards.admin",
          path: "/workspace/config/auth.php",
          position: { column: 12, lineNumber: 4 },
          relativePath: "config/auth.php",
        },
      ]),
    });
    const source = "<?php\nreturn custom_guard('ad');";

    await expect(
      resolvePhpFrameworkScopedCompletions(
        {
          activeDocument: {
            path: "/workspace/app/Http/Controllers/HomeController.php",
          },
          frameworkRuntime: customRuntime,
          position: positionAfter(source, "ad"),
          source,
        },
        deps,
      ),
    ).resolves.toBeNull();

    expect(deps.collectAuthGuardTargets).not.toHaveBeenCalled();
  });

  it("completes middleware aliases with file fallback metadata", async () => {
    const deps = dependencies({
      collectMiddlewareAliasTargets: vi.fn(async () => [
        {
          name: "verified",
          path: "/workspace/app/Http/Kernel.php",
          position: { column: 10, lineNumber: 20 },
          relativePath: null,
        },
        {
          name: "auth",
          path: "/workspace/app/Http/Kernel.php",
          position: { column: 10, lineNumber: 21 },
          relativePath: "app/Http/Kernel.php",
        },
      ]),
    });
    const source = "<?php\nRoute::middleware('ver');";

    await expect(
      resolvePhpFrameworkScopedCompletions(
        request(source, "ver"),
        deps,
      ),
    ).resolves.toEqual([
      {
        completionBehavior: PLAIN_COMPLETION_BEHAVIOR,
        declaringClassName: "Kernel.php",
        insertText: "verified",
        kind: "config",
        name: "verified",
        parameters: "",
        returnType: null,
      },
    ]);

    expect(deps.collectMiddlewareAliasTargets).toHaveBeenCalledWith(
      source,
      "/workspace/app/Http/Controllers/HomeController.php",
    );
  });

  it("does not complete middleware aliases after parameters", async () => {
    const deps = dependencies({
      collectMiddlewareAliasTargets: vi.fn(async () => [
        {
          name: "verified",
          path: "/workspace/app/Http/Kernel.php",
          position: { column: 10, lineNumber: 20 },
          relativePath: "app/Http/Kernel.php",
        },
      ]),
    });
    const source = "<?php\nRoute::middleware('verified:param');";

    await expect(
      resolvePhpFrameworkScopedCompletions(
        request(source, "param"),
        deps,
      ),
    ).resolves.toBeNull();

    expect(deps.collectMiddlewareAliasTargets).not.toHaveBeenCalled();
  });

  it("completes auth guards", async () => {
    const deps = dependencies({
      collectAuthGuardTargets: vi.fn(async () => [
        {
          guardName: "admin",
          key: "auth.guards.admin",
          path: "/workspace/config/auth.php",
          position: { column: 12, lineNumber: 4 },
          relativePath: "config/auth.php",
        },
        {
          guardName: "web",
          key: "auth.guards.web",
          path: "/workspace/config/auth.php",
          position: { column: 12, lineNumber: 8 },
          relativePath: "config/auth.php",
        },
      ]),
    });
    const source = "<?php\nreturn Auth::guard('ad');";

    await expect(
      resolvePhpFrameworkScopedCompletions(
        request(source, "ad"),
        deps,
      ),
    ).resolves.toEqual([
      {
        completionBehavior: PLAIN_COMPLETION_BEHAVIOR,
        declaringClassName: "config/auth.php",
        insertText: "admin",
        kind: "config",
        name: "admin",
        parameters: "",
        returnType: null,
      },
    ]);
  });

  it("completes cache stores", async () => {
    const deps = dependencies({
      collectCacheStoreTargets: vi.fn(async () => [
        {
          key: "cache.stores.redis",
          path: "/workspace/config/cache.php",
          position: { column: 12, lineNumber: 10 },
          relativePath: "config/cache.php",
          storeName: "redis",
        },
      ]),
    });
    const source = "<?php\nreturn Cache::store('red');";

    await expect(
      resolvePhpFrameworkScopedCompletions(
        request(source, "red"),
        deps,
      ),
    ).resolves.toEqual([
      {
        completionBehavior: PLAIN_COMPLETION_BEHAVIOR,
        declaringClassName: "config/cache.php",
        insertText: "redis",
        kind: "config",
        name: "redis",
        parameters: "",
        returnType: null,
      },
    ]);
  });

  it("completes database connections", async () => {
    const deps = dependencies({
      collectDatabaseConnectionTargets: vi.fn(async () => [
        {
          connectionName: "mysql",
          key: "database.connections.mysql",
          path: "/workspace/config/database.php",
          position: { column: 12, lineNumber: 20 },
          relativePath: "config/database.php",
        },
        {
          connectionName: "sqlite",
          key: "database.connections.sqlite",
          path: "/workspace/config/database.php",
          position: { column: 12, lineNumber: 30 },
          relativePath: "config/database.php",
        },
      ]),
    });
    const source = "<?php\nreturn DB::connection('my');";

    await expect(
      resolvePhpFrameworkScopedCompletions(
        request(source, "my"),
        deps,
      ),
    ).resolves.toEqual([
      {
        completionBehavior: PLAIN_COMPLETION_BEHAVIOR,
        declaringClassName: "config/database.php",
        insertText: "mysql",
        kind: "config",
        name: "mysql",
        parameters: "",
        returnType: null,
      },
    ]);
  });

  it("returns an empty result for stale requests after collecting", async () => {
    const deps = dependencies({
      collectCacheStoreTargets: vi.fn(async () => [
        {
          key: "cache.stores.redis",
          path: "/workspace/config/cache.php",
          position: { column: 12, lineNumber: 10 },
          relativePath: "config/cache.php",
          storeName: "redis",
        },
      ]),
      isRequestStillCurrent: vi.fn(() => false),
    });
    const source = "<?php\nreturn Cache::store('red');";

    await expect(
      resolvePhpFrameworkScopedCompletions(
        request(source, "red"),
        deps,
      ),
    ).resolves.toEqual([]);
  });
});

function request(source: string, token: string) {
  return {
    activeDocument: {
      path: "/workspace/app/Http/Controllers/HomeController.php",
    },
    frameworkRuntime: LARAVEL_RUNTIME,
    position: positionAfter(source, token),
    source,
  };
}

function runtimeForCustomProvider(provider: PhpFrameworkProvider) {
  return createPhpFrameworkRuntimeContext(
    createPhpFrameworkIntelligence({
      matchedProviderIds: [provider.id],
      profile: "generic",
      providers: [provider],
    }),
  );
}

function positionAfter(source: string, token: string) {
  const offset = source.indexOf(token);

  if (offset < 0) {
    throw new Error(`Token not found: ${token}`);
  }

  let lineNumber = 1;
  let column = 1;

  for (let index = 0; index < offset + token.length; index += 1) {
    if (source[index] === "\n") {
      lineNumber += 1;
      column = 1;
      continue;
    }

    column += 1;
  }

  return { column, lineNumber };
}
