import { describe, expect, it, vi } from "vitest";
import {
  phpLaravelFrameworkProvider,
  phpNetteFrameworkProvider,
  phpFrameworkProvidersForProject,
  type PhpFrameworkProvider,
} from "../domain/phpFrameworkProviders";
import {
  activePhpFrameworkLiteralDefinitionResolverEntries,
  resolvePhpFrameworkContextualLiteralDefinitionTarget,
} from "./phpFrameworkLiteralDefinitionResolverRegistry";
import { resolvePhpFrameworkLiteralNavigationTarget } from "./phpFrameworkLiteralNavigation";
import type { PhpFrameworkLiteralNavigationDependencies } from "./phpFrameworkLiteralNavigation";
import type { PhpProjectDescriptor } from "../domain/workspace";

const position = { column: 24, lineNumber: 3 };
const targetPosition = { column: 6, lineNumber: 4 };

function dependencies(
  overrides: Partial<PhpFrameworkLiteralNavigationDependencies> = {},
): PhpFrameworkLiteralNavigationDependencies {
  return {
    collectNamedRouteTargets: vi.fn(async () => []),
    findConfigTarget: vi.fn(async () => null),
    findEnvTarget: vi.fn(async () => null),
    findInertiaComponentTarget: vi.fn(async () => null),
    findTranslationTarget: vi.fn(async () => null),
    findViewTarget: vi.fn(async () => null),
    ...overrides,
  };
}

describe("resolvePhpFrameworkLiteralNavigationTarget", () => {
  it("activates ordered Laravel resolver entries only for Laravel", () => {
    expect(
      activePhpFrameworkLiteralDefinitionResolverEntries(
        [phpLaravelFrameworkProvider],
      ).map((resolver) => resolver.id),
    ).toEqual([
      "laravel.inertia-reference",
      "laravel.view-reference",
      "laravel.config",
      "laravel.view",
      "framework.translation",
      "laravel.env",
      "laravel.route",
      "laravel.auth-guard",
      "laravel.broadcast-connection",
      "laravel.cache-store",
      "laravel.database-connection",
      "laravel.log-channel",
      "laravel.mail-mailer",
      "laravel.password-broker",
      "laravel.queue-connection",
      "laravel.redis-connection",
      "laravel.storage-disk",
      "laravel.validation-table",
    ]);
    expect(
      activePhpFrameworkLiteralDefinitionResolverEntries([
        phpNetteFrameworkProvider,
      ]).map((resolver) => resolver.id),
    ).toEqual(["framework.translation", "nette.ajax-snippet"]);
    expect(
      activePhpFrameworkLiteralDefinitionResolverEntries([{ id: "custom" }]),
    ).toEqual([]);
  });

  it("resolves a Nette redrawControl literal to a colocated Latte snippet", async () => {
    const source = "<?php\n$this->redrawControl('mailLogslisting');";
    const deps = dependencies({
      findNetteRedrawControlSnippetTarget: vi.fn(async () => ({
        name: "mailLogslisting",
        path: "/workspace/app/Components/MailLogs/mail_logs.latte",
        position: targetPosition,
      })),
    });

    await expect(
      resolvePhpFrameworkLiteralNavigationTarget(
        {
          activeDocument: {
            content: source,
            path: "/workspace/app/Components/MailLogs/MailLogs.php",
          },
          offset: source.indexOf("Logs"),
          position: positionAfter(source, "Logs"),
          providers: [phpNetteFrameworkProvider],
          source,
          supportsStringLiterals: true,
        },
        deps,
      ),
    ).resolves.toEqual({
      kind: "nette.ajax-snippet",
      label: "mailLogslisting",
      path: "/workspace/app/Components/MailLogs/mail_logs.latte",
      position: targetPosition,
    });
    expect(deps.findNetteRedrawControlSnippetTarget).toHaveBeenCalledWith(
      "/workspace/app/Components/MailLogs/MailLogs.php",
      "mailLogslisting",
    );
    expect(deps.findTranslationTarget).not.toHaveBeenCalled();
  });

  it("stops at a matched view reference before generic helper resolution", async () => {
    const provider: PhpFrameworkProvider = {
      id: "laravel",
      config: {
        resolveLiteralTarget: () => ({}),
      },
      stringLiterals: {
        helperAt: vi.fn(() => ({
          helper: "config",
          literal: "app.name",
          literalEnd: 24,
          literalStart: 16,
        }) as const),
      },
      templating: {
        referenceAt: () => ({
          call: "view",
          name: "dashboard",
          position,
          prefix: "dashboard",
        }),
      },
    };
    const deps = dependencies();

    await expect(
      resolvePhpFrameworkLiteralNavigationTarget(
        {
          activeDocument: null,
          offset: 18,
          position,
          providers: [provider],
          source: "<?php view('dashboard');",
          supportsStringLiterals: true,
        },
        deps,
      ),
    ).resolves.toBeNull();

    expect(deps.findViewTarget).toHaveBeenCalledWith("dashboard");
    expect(provider.stringLiterals?.helperAt).not.toHaveBeenCalled();
    expect(deps.findConfigTarget).not.toHaveBeenCalled();
  });

  it("resolves an Inertia component literal through the provider branch", async () => {
    const providers = phpFrameworkProvidersForProject(phpProjectDescriptor({
      packageName: "laravel/laravel",
      packages: [{ name: "inertiajs/inertia-laravel" }],
    }));
    const deps = dependencies({
      findInertiaComponentTarget: vi.fn(async () => ({
        name: "Users/Index",
        path: "/workspace/resources/js/Pages/Users/Index.vue",
        position: { column: 1, lineNumber: 1 },
      })),
    });
    const source = "<?php\nreturn Inertia::render('Users/Index');";

    await expect(
      resolvePhpFrameworkLiteralNavigationTarget(
        {
          activeDocument: null,
          offset: source.indexOf("Users/Index") + 2,
          position: { column: 27, lineNumber: 2 },
          providers,
          source,
          supportsStringLiterals: true,
        },
        deps,
      ),
    ).resolves.toEqual({
      kind: "inertia",
      label: "Users/Index",
      path: "/workspace/resources/js/Pages/Users/Index.vue",
      position: { column: 1, lineNumber: 1 },
    });

    expect(deps.findInertiaComponentTarget).toHaveBeenCalledWith("Users/Index");
    expect(deps.findViewTarget).not.toHaveBeenCalled();
  });

  it("returns null when runtime capabilities do not support framework literals", async () => {
    const deps = dependencies({
      findConfigTarget: vi.fn(async () => ({
        key: "app.name",
        path: "/workspace/config/app.php",
        position: targetPosition,
      })),
    });
    const provider: PhpFrameworkProvider = {
      id: "custom",
      stringLiterals: {
        helperAt: vi.fn(() => ({
          helper: "config",
          literal: "app.name",
          literalEnd: 24,
          literalStart: 16,
        }) as const),
      },
    };

    await expect(
      resolvePhpFrameworkLiteralNavigationTarget(
        {
          activeDocument: null,
          offset: "<?php\nconfig('app.name');".indexOf("app.name") + 1,
          position,
          providers: [provider],
          source: "<?php\nconfig('app.name');",
          supportsStringLiterals: false,
        },
        deps,
      ),
    ).resolves.toBeNull();

    expect(provider.stringLiterals?.helperAt).not.toHaveBeenCalled();
    expect(deps.findConfigTarget).not.toHaveBeenCalled();
  });

  it("resolves a Laravel config helper literal through typed dependencies", async () => {
    const deps = dependencies({
      findConfigTarget: vi.fn(async () => ({
        key: "app.name",
        path: "/workspace/config/app.php",
        position: targetPosition,
      })),
    });
    const source = "<?php\nreturn config('app.name');";

    await expect(
      resolvePhpFrameworkLiteralNavigationTarget(
        {
          activeDocument: null,
          offset: source.indexOf("app.name") + 1,
          position,
          providers: [phpLaravelFrameworkProvider],
          source,
          supportsStringLiterals: true,
        },
        deps,
      ),
    ).resolves.toEqual({
      kind: "config",
      label: "app.name",
      path: "/workspace/config/app.php",
      position: targetPosition,
    });

    expect(deps.findConfigTarget).toHaveBeenCalledWith("app.name");
  });

  it("resolves provider-owned translation method literals without Laravel helper matching", async () => {
    const deps = dependencies({
      findTranslationTarget: vi.fn(async () => ({
        key: "users.component.user_tokens.header",
        path: "/workspace/app/modules/usersModule/lang/users.cs_CZ.neon",
        position: targetPosition,
      })),
    });
    const source =
      "<?php\nreturn $this->translator->translate('users.component.user_tokens.header');";
    const cursorPosition = positionAfter(source, "user_tokens");

    await expect(
      resolvePhpFrameworkLiteralNavigationTarget(
        {
          activeDocument: null,
          offset: source.indexOf("user_tokens") + 1,
          position: cursorPosition,
          providers: [phpNetteFrameworkProvider],
          source,
          supportsStringLiterals: true,
        },
        deps,
      ),
    ).resolves.toEqual({
      kind: "translation",
      label: "users.component.user_tokens.header",
      path: "/workspace/app/modules/usersModule/lang/users.cs_CZ.neon",
      position: targetPosition,
    });

    expect(deps.findTranslationTarget).toHaveBeenCalledWith(
      "users.component.user_tokens.header",
    );
  });

  it("uses a supplied helper match without rescanning the source", async () => {
    const helperAt = vi.fn(() => null);
    const provider: PhpFrameworkProvider = {
      ...phpLaravelFrameworkProvider,
      stringLiterals: {
        ...phpLaravelFrameworkProvider.stringLiterals,
        helperAt,
      },
    };
    const deps = dependencies({
      findConfigTarget: vi.fn(async () => ({
        key: "app.name",
        path: "/workspace/config/app.php",
        position: targetPosition,
      })),
    });
    const source = "{{ config('app.name') }}";

    await expect(
      resolvePhpFrameworkLiteralNavigationTarget(
        {
          activeDocument: null,
          directHelperMatch: {
            helper: "config",
            literal: "app.name",
            literalEnd: source.indexOf("app.name") + "app.name".length,
            literalStart: source.indexOf("app.name"),
            providerId: "laravel",
          },
          offset: source.indexOf("app.name") + 1,
          position,
          providers: [provider],
          source,
          supportsStringLiterals: true,
        },
        deps,
      ),
    ).resolves.toEqual({
      kind: "config",
      label: "app.name",
      path: "/workspace/config/app.php",
      position: targetPosition,
    });

    expect(helperAt).not.toHaveBeenCalled();
    expect(deps.findConfigTarget).toHaveBeenCalledWith("app.name");
  });

  it("rejects unresolvable Laravel config literals before scanning targets", async () => {
    const deps = dependencies({
      findConfigTarget: vi.fn(async () => ({
        key: "../secrets.value",
        path: "/workspace/config/app.php",
        position: targetPosition,
      })),
    });
    const source = "<?php\nreturn config('../secrets.value');";

    await expect(
      resolvePhpFrameworkLiteralNavigationTarget(
        {
          activeDocument: null,
          offset: source.indexOf("../secrets.value") + 1,
          position,
          providers: [phpLaravelFrameworkProvider],
          source,
          supportsStringLiterals: true,
        },
        deps,
      ),
    ).resolves.toBeNull();

    expect(deps.findConfigTarget).not.toHaveBeenCalled();
  });

  it("requires the active provider to admit config helper literals", async () => {
    const provider: PhpFrameworkProvider = {
      id: "custom",
      stringLiterals: {
        helperAt: () => ({
          helper: "config",
          literal: "app.name",
          literalEnd: 24,
          literalStart: 16,
        }),
      },
    };
    const deps = dependencies({
      findConfigTarget: vi.fn(async () => ({
        key: "app.name",
        path: "/workspace/config/app.php",
        position: targetPosition,
      })),
    });
    const source = "<?php\nreturn config('app.name');";

    await expect(
      resolvePhpFrameworkLiteralNavigationTarget(
        {
          activeDocument: null,
          offset: source.indexOf("app.name") + 1,
          position,
          providers: [provider],
          source,
          supportsStringLiterals: true,
        },
        deps,
      ),
    ).resolves.toBeNull();

    expect(deps.findConfigTarget).not.toHaveBeenCalled();
  });

  it("resolves Laravel route helper literals case-insensitively from the active document", async () => {
    const deps = dependencies({
      collectNamedRouteTargets: vi.fn(async () => [
        {
          name: "Admin.Dashboard",
          path: "/workspace/routes/web.php",
          position: targetPosition,
        },
      ]),
    });
    const source = "<?php\nreturn route('admin.dashboard');";

    await expect(
      resolvePhpFrameworkLiteralNavigationTarget(
        {
          activeDocument: {
            content: source,
            path: "/workspace/app/Http/Controllers/DashboardController.php",
          },
          offset: source.indexOf("admin.dashboard") + 1,
          position,
          providers: [phpLaravelFrameworkProvider],
          source,
          supportsStringLiterals: true,
        },
        deps,
      ),
    ).resolves.toEqual({
      kind: "route",
      label: "Admin.Dashboard",
      path: "/workspace/routes/web.php",
      position: targetPosition,
    });

    expect(deps.collectNamedRouteTargets).toHaveBeenCalledWith(
      source,
      "/workspace/app/Http/Controllers/DashboardController.php",
    );
  });

  it("resolves Laravel config-derived literal families through contextual registry entries", async () => {
    const cases = [
      {
        expectedResolver: "findAuthGuardTarget",
        expectedValue: "web",
        request: { guardName: "web", kind: "authGuard" },
        target: { guardName: "web" },
      },
      {
        expectedResolver: "findBroadcastConnectionTarget",
        expectedValue: "pusher",
        request: {
          connectionName: "pusher",
          kind: "broadcastConnection",
        },
        target: { connectionName: "pusher" },
      },
      {
        expectedResolver: "findCacheStoreTarget",
        expectedValue: "redis",
        request: { kind: "cacheStore", storeName: "redis" },
        target: { storeName: "redis" },
      },
      {
        expectedResolver: "findDatabaseConnectionTarget",
        expectedValue: "mysql",
        request: {
          connectionName: "mysql",
          kind: "databaseConnection",
        },
        target: { connectionName: "mysql" },
      },
      {
        expectedResolver: "findLogChannelTarget",
        expectedValue: "stack",
        request: { channelName: "stack", kind: "logChannel" },
        target: { channelName: "stack" },
      },
      {
        expectedResolver: "findMailMailerTarget",
        expectedValue: "smtp",
        request: { kind: "mailMailer", mailerName: "smtp" },
        target: { mailerName: "smtp" },
      },
      {
        expectedResolver: "findPasswordBrokerTarget",
        expectedValue: "users",
        request: { brokerName: "users", kind: "passwordBroker" },
        target: { brokerName: "users" },
      },
      {
        expectedResolver: "findQueueConnectionTarget",
        expectedValue: "database",
        request: {
          connectionName: "database",
          kind: "queueConnection",
        },
        target: { connectionName: "database" },
      },
      {
        expectedResolver: "findRedisConnectionTarget",
        expectedValue: "cache",
        request: {
          connectionName: "cache",
          kind: "redisConnection",
        },
        target: { connectionName: "cache" },
      },
      {
        expectedResolver: "findStorageDiskTarget",
        expectedValue: "local",
        request: { diskName: "local", kind: "storageDisk" },
        target: { diskName: "local" },
      },
    ] as const;

    for (const testCase of cases) {
      const deps = dependencies({
        [testCase.expectedResolver]: vi.fn(async (name: string) => ({
          ...testCase.target,
          path: `/workspace/config/${name}.php`,
          position: targetPosition,
        })),
      });

      await expect(
        resolvePhpFrameworkContextualLiteralDefinitionTarget(
          testCase.request,
          {
            content: "<?php",
            path: "/workspace/app/Http/Controllers/DashboardController.php",
          },
          [phpLaravelFrameworkProvider],
          deps,
        ),
      ).resolves.toEqual({
        kind: testCase.request.kind,
        label: testCase.expectedValue,
        path: `/workspace/config/${testCase.expectedValue}.php`,
        position: targetPosition,
      });
      expect(deps[testCase.expectedResolver]).toHaveBeenCalledWith(
        testCase.expectedValue,
      );

      await expect(
        resolvePhpFrameworkContextualLiteralDefinitionTarget(
          testCase.request,
          {
            content: "<?php",
            path: "/workspace/app/Http/Controllers/DashboardController.php",
          },
          [{ id: "custom" }],
          deps,
        ),
      ).resolves.toBeUndefined();
      expect(deps[testCase.expectedResolver]).toHaveBeenCalledTimes(1);
    }
  });
});

function phpProjectDescriptor(
  overrides: Omit<Partial<PhpProjectDescriptor>, "packages"> & {
    packages?: Array<{ name: string }>;
  },
): PhpProjectDescriptor {
  const { packages = [], ...descriptorOverrides } = overrides;

  return {
    classmapRoots: [],
    hasComposer: true,
    packageName: null,
    packages: packages.map((composerPackage) => ({
      classmapRoots: [],
      dev: false,
      installPath: null,
      name: composerPackage.name,
      packageType: null,
      psr4Roots: [],
      version: null,
    })),
    phpPlatformVersion: null,
    phpVersionConstraint: null,
    psr4Roots: [],
    ...descriptorOverrides,
  };
}

function positionAfter(source: string, needle: string) {
  const offset = source.indexOf(needle);

  if (offset < 0) {
    throw new Error(`Missing test needle: ${needle}`);
  }

  const before = source.slice(0, offset + needle.length);
  const lines = before.split("\n");
  const lastLine = lines[lines.length - 1] ?? "";

  return {
    column: lastLine.length + 1,
    lineNumber: lines.length,
  };
}
