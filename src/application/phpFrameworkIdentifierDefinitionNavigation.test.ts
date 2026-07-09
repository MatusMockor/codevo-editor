import { describe, expect, it, vi } from "vitest";
import type { EditorDocument } from "../domain/workspace";
import type { PhpIdentifierContext } from "../domain/phpNavigation";
import {
  goToPhpFrameworkIdentifierDefinition,
  isPhpFrameworkIdentifierContext,
  type PhpFrameworkIdentifierDefinitionNavigationDependencies,
} from "./phpFrameworkIdentifierDefinitionNavigation";

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
  overrides: Partial<PhpFrameworkIdentifierDefinitionNavigationDependencies> = {},
): PhpFrameworkIdentifierDefinitionNavigationDependencies {
  const falseHandler = vi.fn(async () => false);

  return {
    activeDocument,
    goToPhpLaravelAuthGuardDefinition: falseHandler,
    goToPhpLaravelBroadcastConnectionDefinition: falseHandler,
    goToPhpLaravelCacheStoreDefinition: falseHandler,
    goToPhpLaravelConfigDefinition: falseHandler,
    goToPhpLaravelDatabaseConnectionDefinition: falseHandler,
    goToPhpLaravelEnvDefinition: falseHandler,
    goToPhpLaravelGateAbilityDefinition: falseHandler,
    goToPhpLaravelLogChannelDefinition: falseHandler,
    goToPhpLaravelMailMailerDefinition: falseHandler,
    goToPhpLaravelMiddlewareAliasDefinition: falseHandler,
    goToPhpLaravelNamedRouteDefinition: falseHandler,
    goToPhpLaravelPasswordBrokerDefinition: falseHandler,
    goToPhpLaravelQueueConnectionDefinition: falseHandler,
    goToPhpLaravelRedisConnectionDefinition: falseHandler,
    goToPhpLaravelRelationStringDefinition: falseHandler,
    goToPhpLaravelStorageDiskDefinition: falseHandler,
    goToPhpLaravelTranslationDefinition: falseHandler,
    goToPhpLaravelViewDefinition: falseHandler,
    openDirectPhpMethodTarget: vi.fn(async () => false),
    ...overrides,
  };
}

describe("phpFrameworkIdentifierDefinitionNavigation", () => {
  it.each([
    [
      { guardName: "web", kind: "laravelAuthGuardString" },
      "goToPhpLaravelAuthGuardDefinition",
    ],
    [
      { connectionName: "reverb", kind: "laravelBroadcastConnectionString" },
      "goToPhpLaravelBroadcastConnectionDefinition",
    ],
    [
      { kind: "laravelCacheStoreString", storeName: "redis" },
      "goToPhpLaravelCacheStoreDefinition",
    ],
    [
      { configKey: "app.name", kind: "laravelConfigString" },
      "goToPhpLaravelConfigDefinition",
    ],
    [
      { connectionName: "mysql", kind: "laravelDatabaseConnectionString" },
      "goToPhpLaravelDatabaseConnectionDefinition",
    ],
    [
      { envName: "APP_URL", kind: "laravelEnvString" },
      "goToPhpLaravelEnvDefinition",
    ],
    [
      { ability: "update-post", kind: "laravelGateAbilityString" },
      "goToPhpLaravelGateAbilityDefinition",
    ],
    [
      { channelName: "stack", kind: "laravelLogChannelString" },
      "goToPhpLaravelLogChannelDefinition",
    ],
    [
      { kind: "laravelMailMailerString", mailerName: "smtp" },
      "goToPhpLaravelMailMailerDefinition",
    ],
    [
      { alias: "auth", kind: "laravelMiddlewareAliasString" },
      "goToPhpLaravelMiddlewareAliasDefinition",
    ],
    [
      { kind: "laravelNamedRouteString", routeName: "dashboard" },
      "goToPhpLaravelNamedRouteDefinition",
    ],
    [
      { brokerName: "users", kind: "laravelPasswordBrokerString" },
      "goToPhpLaravelPasswordBrokerDefinition",
    ],
    [
      { connectionName: "redis", kind: "laravelQueueConnectionString" },
      "goToPhpLaravelQueueConnectionDefinition",
    ],
    [
      { connectionName: "cache", kind: "laravelRedisConnectionString" },
      "goToPhpLaravelRedisConnectionDefinition",
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
    [
      { diskName: "public", kind: "laravelStorageDiskString" },
      "goToPhpLaravelStorageDiskDefinition",
    ],
    [
      { kind: "laravelTranslationString", translationKey: "messages.welcome" },
      "goToPhpLaravelTranslationDefinition",
    ],
    [
      { kind: "laravelViewString", viewName: "dashboard.index" },
      "goToPhpLaravelViewDefinition",
    ],
  ] as const)("dispatches %s to %s", async (context, handlerName) => {
    const handler = vi.fn(async () => true);
    const deps = makeDeps({ [handlerName]: handler });

    await expect(
      goToPhpFrameworkIdentifierDefinition(context, deps),
    ).resolves.toBe(true);

    expect(handler).toHaveBeenCalledWith(context);
  });

  it("opens Laravel route action methods through the direct PHP method target", async () => {
    const openDirectPhpMethodTarget = vi.fn(async () => true);
    const openPhpClassTarget = vi.fn(async () => true);
    const context: PhpIdentifierContext = {
      className: "DashboardController",
      kind: "laravelRouteActionMethod",
      methodName: "index",
    };

    const handled = await goToPhpFrameworkIdentifierDefinition(
      context,
      makeDeps({ openDirectPhpMethodTarget, openPhpClassTarget }),
    );

    expect(handled).toBe(true);
    expect(openDirectPhpMethodTarget).toHaveBeenCalledWith(
      "App\\Http\\Controllers\\DashboardController",
      "index",
    );
    expect(openPhpClassTarget).not.toHaveBeenCalled();
  });

  it("falls back to the route action class when a class target opener is provided", async () => {
    const openDirectPhpMethodTarget = vi.fn(async () => false);
    const openPhpClassTarget = vi.fn(async () => true);
    const context: PhpIdentifierContext = {
      className: "DashboardController",
      kind: "laravelRouteActionMethod",
      methodName: "missing",
    };

    const handled = await goToPhpFrameworkIdentifierDefinition(
      context,
      makeDeps({ openDirectPhpMethodTarget, openPhpClassTarget }),
    );

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

  it("keeps route action methods direct-only without a class target opener", async () => {
    const openDirectPhpMethodTarget = vi.fn(async () => false);
    const context: PhpIdentifierContext = {
      className: "DashboardController",
      kind: "laravelRouteActionMethod",
      methodName: "missing",
    };

    const handled = await goToPhpFrameworkIdentifierDefinition(
      context,
      makeDeps({ openDirectPhpMethodTarget }),
    );

    expect(handled).toBe(false);
    expect(openDirectPhpMethodTarget).toHaveBeenCalledWith(
      "App\\Http\\Controllers\\DashboardController",
      "missing",
    );
  });

  it("recognizes only framework identifier contexts", () => {
    expect(
      isPhpFrameworkIdentifierContext({
        kind: "laravelNamedRouteString",
        routeName: "dashboard",
      }),
    ).toBe(true);
    expect(
      isPhpFrameworkIdentifierContext({
        kind: "classIdentifier",
        name: "Post",
      }),
    ).toBe(false);
  });
});
