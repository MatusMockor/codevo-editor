import { describe, expect, it, vi } from "vitest";
import type { PhpIdentifierContext } from "../domain/phpNavigation";
import type { EditorDocument } from "../domain/workspace";
import {
  createPhpLaravelIdentifierDefinitionNavigationAdapter,
  type PhpLaravelIdentifierDefinitionNavigationAdapterDependencies,
} from "./phpLaravelIdentifierDefinitionNavigationAdapter";

const ROOT = "/workspace";

const activeDocument: EditorDocument = {
  content: `<?php
use App\\Http\\Controllers\\DashboardController;

Route::get('/dashboard', [DashboardController::class, 'index']);
`,
  language: "php",
  name: "web.php",
  path: `${ROOT}/routes/web.php`,
  savedContent: "",
};

function makeDeps(
  overrides: Partial<PhpLaravelIdentifierDefinitionNavigationAdapterDependencies> = {},
): PhpLaravelIdentifierDefinitionNavigationAdapterDependencies {
  const falseHandler = vi.fn(async () => false);

  return {
    activeDocument,
    goToPhpFrameworkLiteralDefinition: falseHandler,
    goToPhpFrameworkAuthorizationAbilityDefinition: falseHandler,
    goToPhpFrameworkMiddlewareAliasDefinition: falseHandler,
    goToPhpLaravelRelationStringDefinition: falseHandler,
    openDirectPhpMethodTarget: vi.fn(async () => false),
    ...overrides,
  };
}

describe("phpLaravelIdentifierDefinitionNavigationAdapter", () => {
  it.each([
    [
      { ability: "update-post", kind: "laravelGateAbilityString" },
      "goToPhpFrameworkAuthorizationAbilityDefinition",
    ],
    [
      { alias: "auth", kind: "laravelMiddlewareAliasString" },
      "goToPhpFrameworkMiddlewareAliasDefinition",
    ],
    [
      {
        className: "App\\Models\\Post",
        kind: "laravelRelationString",
        methodName: "with",
        receiverExpression: null,
        relationName: "comments",
      },
      "goToPhpLaravelRelationStringDefinition",
    ],
  ] as const)("dispatches %s to %s", async (context, handlerName) => {
    const handler = vi.fn(async () => true);
    const adapter = createPhpLaravelIdentifierDefinitionNavigationAdapter(
      makeDeps({ [handlerName]: handler }),
    );

    await expect(adapter.goToDefinition(context)).resolves.toBe(true);
    expect(handler).toHaveBeenCalledWith(context);
  });

  it.each([
    [
      { guardName: "web", kind: "laravelAuthGuardString" },
      {
        guardName: "web",
        kind: "authGuard",
      },
    ],
    [
      { connectionName: "reverb", kind: "laravelBroadcastConnectionString" },
      {
        connectionName: "reverb",
        kind: "broadcastConnection",
      },
    ],
    [
      { kind: "laravelCacheStoreString", storeName: "redis" },
      {
        kind: "cacheStore",
        storeName: "redis",
      },
    ],
    [
      { connectionName: "mysql", kind: "laravelDatabaseConnectionString" },
      {
        connectionName: "mysql",
        kind: "databaseConnection",
      },
    ],
    [
      { kind: "laravelConfigString", configKey: "app.name" },
      {
        key: "app.name",
        kind: "config",
      },
    ],
    [
      { kind: "laravelEnvString", envName: "APP_URL" },
      {
        kind: "env",
        name: "APP_URL",
      },
    ],
    [
      { channelName: "stack", kind: "laravelLogChannelString" },
      {
        channelName: "stack",
        kind: "logChannel",
      },
    ],
    [
      { kind: "laravelMailMailerString", mailerName: "smtp" },
      {
        kind: "mailMailer",
        mailerName: "smtp",
      },
    ],
    [
      { kind: "laravelNamedRouteString", routeName: "dashboard" },
      {
        kind: "route",
        name: "dashboard",
      },
    ],
    [
      { brokerName: "users", kind: "laravelPasswordBrokerString" },
      {
        brokerName: "users",
        kind: "passwordBroker",
      },
    ],
    [
      { connectionName: "redis", kind: "laravelQueueConnectionString" },
      {
        connectionName: "redis",
        kind: "queueConnection",
      },
    ],
    [
      { connectionName: "cache", kind: "laravelRedisConnectionString" },
      {
        connectionName: "cache",
        kind: "redisConnection",
      },
    ],
    [
      { kind: "laravelTranslationString", translationKey: "messages.welcome" },
      {
        key: "messages.welcome",
        kind: "translation",
      },
    ],
    [
      { kind: "laravelViewString", viewName: "dashboard.index" },
      {
        kind: "view",
        name: "dashboard.index",
      },
    ],
    [
      { diskName: "public", kind: "laravelStorageDiskString" },
      {
        diskName: "public",
        kind: "storageDisk",
      },
    ],
  ] as const)("maps %s to a generic literal request", async (context, request) => {
    const goToPhpFrameworkLiteralDefinition = vi.fn(async () => true);
    const adapter = createPhpLaravelIdentifierDefinitionNavigationAdapter(
      makeDeps({ goToPhpFrameworkLiteralDefinition }),
    );

    await expect(adapter.goToDefinition(context)).resolves.toBe(true);
    expect(goToPhpFrameworkLiteralDefinition).toHaveBeenCalledWith(request);
  });

  it("opens Laravel route action methods through the direct PHP method target", async () => {
    const openDirectPhpMethodTarget = vi.fn(async () => true);
    const openPhpClassTarget = vi.fn(async () => true);
    const context: PhpIdentifierContext = {
      className: "DashboardController",
      kind: "laravelRouteActionMethod",
      methodName: "index",
    };
    const adapter = createPhpLaravelIdentifierDefinitionNavigationAdapter(
      makeDeps({ openDirectPhpMethodTarget, openPhpClassTarget }),
    );

    const handled = await adapter.goToDefinition(context);

    expect(handled).toBe(true);
    expect(openDirectPhpMethodTarget).toHaveBeenCalledWith(
      "App\\Http\\Controllers\\DashboardController",
      "index",
    );
    expect(openPhpClassTarget).not.toHaveBeenCalled();
  });

  it("opens fully qualified string @ route action methods without a matching import", async () => {
    const openDirectPhpMethodTarget = vi.fn(async () => true);
    const context: PhpIdentifierContext = {
      className: "\\App\\Http\\Controllers\\ReportController",
      kind: "laravelRouteActionMethod",
      methodName: "export",
    };
    const adapter = createPhpLaravelIdentifierDefinitionNavigationAdapter(
      makeDeps({ openDirectPhpMethodTarget }),
    );

    await expect(adapter.goToDefinition(context)).resolves.toBe(true);
    expect(openDirectPhpMethodTarget).toHaveBeenCalledWith(
      "App\\Http\\Controllers\\ReportController",
      "export",
    );
  });

  it("falls back to the route action class when a class target opener is provided", async () => {
    const openDirectPhpMethodTarget = vi.fn(async () => false);
    const openPhpClassTarget = vi.fn(async () => true);
    const context: PhpIdentifierContext = {
      className: "DashboardController",
      kind: "laravelRouteActionMethod",
      methodName: "missing",
    };
    const adapter = createPhpLaravelIdentifierDefinitionNavigationAdapter(
      makeDeps({ openDirectPhpMethodTarget, openPhpClassTarget }),
    );

    const handled = await adapter.goToDefinition(context);

    expect(handled).toBe(true);
    expect(openDirectPhpMethodTarget).toHaveBeenCalledWith(
      "App\\Http\\Controllers\\DashboardController",
      "missing",
    );
    expect(openPhpClassTarget).toHaveBeenCalledWith(
      "App\\Http\\Controllers\\DashboardController",
      "DashboardController",
    );
  });

  it("does not open the route action class after the request becomes stale", async () => {
    let requestActive = true;
    const request = { canNavigate: () => requestActive };
    const openDirectPhpMethodTarget = vi.fn(async () => {
      requestActive = false;
      return false;
    });
    const openPhpClassTarget = vi.fn(async () => true);
    const adapter = createPhpLaravelIdentifierDefinitionNavigationAdapter(
      makeDeps({ openDirectPhpMethodTarget, openPhpClassTarget }),
    );

    await expect(
      adapter.goToDefinition(
        {
          className: "DashboardController",
          kind: "laravelRouteActionMethod",
          methodName: "missing",
        },
        request,
      ),
    ).resolves.toBe(false);

    expect(openDirectPhpMethodTarget).toHaveBeenCalledWith(
      "App\\Http\\Controllers\\DashboardController",
      "missing",
      request,
    );
    expect(openPhpClassTarget).not.toHaveBeenCalled();
  });

  it("passes an active request to literal definition navigation", async () => {
    const request = { canNavigate: vi.fn(() => true) };
    const goToPhpFrameworkLiteralDefinition = vi.fn(async () => true);
    const adapter = createPhpLaravelIdentifierDefinitionNavigationAdapter(
      makeDeps({ goToPhpFrameworkLiteralDefinition }),
    );

    await expect(
      adapter.goToDefinition(
        { kind: "laravelNamedRouteString", routeName: "dashboard" },
        request,
      ),
    ).resolves.toBe(true);

    expect(goToPhpFrameworkLiteralDefinition).toHaveBeenCalledWith(
      { kind: "route", name: "dashboard" },
      request,
    );
  });

  it("does not invoke definition helpers for a stale request", async () => {
    const goToPhpFrameworkLiteralDefinition = vi.fn(async () => true);
    const adapter = createPhpLaravelIdentifierDefinitionNavigationAdapter(
      makeDeps({ goToPhpFrameworkLiteralDefinition }),
    );

    await expect(
      adapter.goToDefinition(
        { kind: "laravelNamedRouteString", routeName: "dashboard" },
        { canNavigate: () => false },
      ),
    ).resolves.toBe(false);

    expect(goToPhpFrameworkLiteralDefinition).not.toHaveBeenCalled();
  });

  it("keeps route action methods direct-only without a class target opener", async () => {
    const openDirectPhpMethodTarget = vi.fn(async () => false);
    const context: PhpIdentifierContext = {
      className: "DashboardController",
      kind: "laravelRouteActionMethod",
      methodName: "missing",
    };
    const adapter = createPhpLaravelIdentifierDefinitionNavigationAdapter(
      makeDeps({ openDirectPhpMethodTarget }),
    );

    const handled = await adapter.goToDefinition(context);

    expect(handled).toBe(false);
    expect(openDirectPhpMethodTarget).toHaveBeenCalledWith(
      "App\\Http\\Controllers\\DashboardController",
      "missing",
    );
  });

  it("ignores non-Laravel identifier contexts", async () => {
    const adapter = createPhpLaravelIdentifierDefinitionNavigationAdapter(
      makeDeps(),
    );

    await expect(
      adapter.goToDefinition({
        kind: "classIdentifier",
        name: "Post",
      }),
    ).resolves.toBe(false);
  });
});
