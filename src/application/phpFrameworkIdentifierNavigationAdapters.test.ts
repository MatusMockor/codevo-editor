import { describe, expect, it, vi } from "vitest";
import type { PhpIdentifierContext } from "../domain/phpNavigation";
import type { EditorDocument } from "../domain/workspace";
import {
  createPhpFrameworkIdentifierNavigationAdapters,
  type PhpFrameworkIdentifierNavigationAdapterDependencies,
} from "./phpFrameworkIdentifierNavigationAdapters";

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

const routeActionContext: PhpIdentifierContext = {
  className: "DashboardController",
  kind: "laravelRouteActionMethod",
  methodName: "missing",
};

function makeDeps(
  overrides: Partial<PhpFrameworkIdentifierNavigationAdapterDependencies> = {},
): PhpFrameworkIdentifierNavigationAdapterDependencies {
  const falseHandler = vi.fn(async () => false);

  return {
    activeDocument,
    frameworkRuntime: { hasProvider: () => true },
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

describe("phpFrameworkIdentifierNavigationAdapters", () => {
  it("returns no adapters without the Laravel provider", () => {
    const adapters = createPhpFrameworkIdentifierNavigationAdapters(
      makeDeps({
        frameworkRuntime: { hasProvider: () => false },
      }),
    );

    expect(adapters.adapters).toHaveLength(0);
    expect(adapters.contextualAdapters).toHaveLength(0);
  });

  it("creates a direct Laravel adapter without route action class fallback", async () => {
    const openDirectPhpMethodTarget = vi.fn(async () => false);
    const openPhpClassTarget = vi.fn(async () => true);
    const adapters = createPhpFrameworkIdentifierNavigationAdapters(
      makeDeps({
        openDirectPhpMethodTarget,
        openPhpClassTarget,
      }),
    );

    await expect(
      adapters.adapters[0].goToDefinition(routeActionContext),
    ).resolves.toBe(false);
    expect(openDirectPhpMethodTarget).toHaveBeenCalledWith(
      "App\\Http\\Controllers\\DashboardController",
      "missing",
    );
    expect(openPhpClassTarget).not.toHaveBeenCalled();
  });

  it("creates a contextual Laravel adapter with route action class fallback", async () => {
    const openDirectPhpMethodTarget = vi.fn(async () => false);
    const openPhpClassTarget = vi.fn(async () => true);
    const adapters = createPhpFrameworkIdentifierNavigationAdapters(
      makeDeps({
        openDirectPhpMethodTarget,
        openPhpClassTarget,
      }),
    );

    await expect(
      adapters.contextualAdapters[0].goToDefinition(routeActionContext),
    ).resolves.toBe(true);
    expect(openDirectPhpMethodTarget).toHaveBeenCalledWith(
      "App\\Http\\Controllers\\DashboardController",
      "missing",
    );
    expect(openPhpClassTarget).toHaveBeenCalledWith(
      "App\\Http\\Controllers\\DashboardController",
      "DashboardController",
    );
  });
});
