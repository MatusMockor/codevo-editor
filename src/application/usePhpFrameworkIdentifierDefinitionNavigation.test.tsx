// @vitest-environment jsdom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";
import {
  usePhpFrameworkIdentifierDefinitionNavigation,
  type PhpFrameworkIdentifierDefinitionNavigation,
  type PhpFrameworkIdentifierDefinitionNavigationDependencies,
} from "./usePhpFrameworkIdentifierDefinitionNavigation";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

const ROOT = "/workspace";
const SOURCE = `<?php
use App\\Http\\Controllers\\ReportController;

Route::get('/reports', [ReportController::class, 'store']);`;

function makeDeps(
  overrides: Partial<PhpFrameworkIdentifierDefinitionNavigationDependencies> = {},
): PhpFrameworkIdentifierDefinitionNavigationDependencies {
  const falseHandler = vi.fn(async () => false);

  return {
    activeDocument: {
      content: SOURCE,
      language: "php",
      name: "web.php",
      path: `${ROOT}/routes/web.php`,
      savedContent: "",
    },
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
    openPhpClassTarget: vi.fn(async () => false),
    ...overrides,
  };
}

function renderHook(
  deps: PhpFrameworkIdentifierDefinitionNavigationDependencies,
) {
  const container = document.createElement("div");
  const root = createRoot(container);
  const captured: {
    api: PhpFrameworkIdentifierDefinitionNavigation | null;
  } = {
    api: null,
  };

  function Harness({
    dependencies,
  }: {
    dependencies: PhpFrameworkIdentifierDefinitionNavigationDependencies;
  }) {
    captured.api = usePhpFrameworkIdentifierDefinitionNavigation(dependencies);
    return null;
  }

  act(() => {
    root.render(<Harness dependencies={deps} />);
  });

  const api = (): PhpFrameworkIdentifierDefinitionNavigation => {
    if (!captured.api) {
      throw new Error("hook not mounted");
    }

    return captured.api;
  };

  return {
    api,
    unmount: () => {
      act(() => {
        root.unmount();
      });
    },
  };
}

describe("usePhpFrameworkIdentifierDefinitionNavigation", () => {
  it("keeps indexed route action method navigation direct-only", async () => {
    const openDirectPhpMethodTarget = vi.fn(async () => true);
    const openPhpClassTarget = vi.fn(async () => true);
    const deps = makeDeps({
      openDirectPhpMethodTarget,
      openPhpClassTarget,
    });
    const harness = renderHook(deps);

    const handled = await harness
      .api()
      .goToPhpFrameworkIdentifierDefinition({
        className: "ReportController",
        kind: "laravelRouteActionMethod",
        methodName: "store",
      });

    expect(handled).toBe(true);
    expect(openDirectPhpMethodTarget).toHaveBeenCalledWith(
      "App\\Http\\Controllers\\ReportController",
      "store",
    );
    expect(openPhpClassTarget).not.toHaveBeenCalled();

    harness.unmount();
  });

  it("lets contextual route action method navigation fall back to the class", async () => {
    const openDirectPhpMethodTarget = vi.fn(async () => false);
    const openPhpClassTarget = vi.fn(async () => true);
    const deps = makeDeps({
      openDirectPhpMethodTarget,
      openPhpClassTarget,
    });
    const harness = renderHook(deps);

    const handled = await harness
      .api()
      .goToContextualPhpFrameworkIdentifierDefinition({
        className: "ReportController",
        kind: "laravelRouteActionMethod",
        methodName: "store",
      });

    expect(handled).toBe(true);
    expect(openDirectPhpMethodTarget).toHaveBeenCalledWith(
      "App\\Http\\Controllers\\ReportController",
      "store",
    );
    expect(openPhpClassTarget).toHaveBeenCalledWith(
      "App\\Http\\Controllers\\ReportController",
      "ReportController",
    );

    harness.unmount();
  });
});
