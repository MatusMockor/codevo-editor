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
    goToPhpLaravelAuthGuardDefinition: falseHandler,
    goToPhpLaravelBroadcastConnectionDefinition: falseHandler,
    goToPhpLaravelCacheStoreDefinition: falseHandler,
    goToPhpLaravelDatabaseConnectionDefinition: falseHandler,
    goToPhpLaravelGateAbilityDefinition: falseHandler,
    goToPhpLaravelLogChannelDefinition: falseHandler,
    goToPhpLaravelMailMailerDefinition: falseHandler,
    goToPhpLaravelMiddlewareAliasDefinition: falseHandler,
    goToPhpLaravelPasswordBrokerDefinition: falseHandler,
    goToPhpLaravelQueueConnectionDefinition: falseHandler,
    goToPhpLaravelRedisConnectionDefinition: falseHandler,
    goToPhpLaravelRelationStringDefinition: falseHandler,
    goToPhpLaravelStorageDiskDefinition: falseHandler,
    openDirectPhpMethodTarget: vi.fn(async () => false),
    ...overrides,
  };
}

describe("phpLaravelIdentifierDefinitionNavigationAdapter", () => {
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
      { connectionName: "mysql", kind: "laravelDatabaseConnectionString" },
      "goToPhpLaravelDatabaseConnectionDefinition",
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
      { kind: "laravelConfigString", configKey: "app.name" },
      {
        key: "app.name",
        kind: "config",
        missingMessage: "No Laravel config key app.name found.",
      },
    ],
    [
      { kind: "laravelEnvString", envName: "APP_URL" },
      {
        kind: "env",
        missingMessage: "No Laravel env key APP_URL found.",
        name: "APP_URL",
      },
    ],
    [
      { kind: "laravelNamedRouteString", routeName: "dashboard" },
      {
        kind: "route",
        missingMessage: "No Laravel route named dashboard found.",
        name: "dashboard",
      },
    ],
    [
      { kind: "laravelTranslationString", translationKey: "messages.welcome" },
      {
        key: "messages.welcome",
        kind: "translation",
        missingMessage:
          "No Laravel translation key messages.welcome found.",
      },
    ],
    [
      { kind: "laravelViewString", viewName: "dashboard.index" },
      {
        kind: "view",
        missingMessage: "No Laravel view named dashboard.index found.",
        name: "dashboard.index",
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
