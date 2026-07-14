// @vitest-environment jsdom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";
import type { EditorPosition } from "../domain/languageServerFeatures";
import { phpLaravelFrameworkProvider } from "../domain/phpFrameworkProviders";
import {
  usePhpContextualFrameworkLiteralDefinitionNavigation,
  type PhpContextualFrameworkLiteralDefinitionNavigation,
  type PhpContextualFrameworkLiteralDefinitionNavigationDependencies,
} from "./usePhpContextualFrameworkLiteralDefinitionNavigation";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

const ROOT = "/workspace";
const OTHER_ROOT = "/other";
const POSITION: EditorPosition = { column: 1, lineNumber: 1 };

function makeDeps(
  overrides: Partial<PhpContextualFrameworkLiteralDefinitionNavigationDependencies> = {},
): PhpContextualFrameworkLiteralDefinitionNavigationDependencies {
  const source = "<?php config('app.name');";

  return {
    activeDocument: {
      content: source,
      language: "php",
      name: "Controller.php",
      path: `${ROOT}/app/Controller.php`,
      savedContent: "",
    },
    currentWorkspaceRootRef: { current: ROOT },
    frameworkLiteralNavigationDependencies: {
      collectNamedRouteTargets: vi.fn(async () => []),
      findCacheStoreTarget: vi.fn(async () => null),
      findConfigTarget: vi.fn(async () => null),
      findEnvTarget: vi.fn(async () => null),
      findValidationRuleModelTargets: vi.fn(async () => []),
      findTranslationTarget: vi.fn(async () => null),
      findViewTarget: vi.fn(async () => null),
    },
    openNavigationTarget: vi.fn(async () => true),
    providers: [phpLaravelFrameworkProvider],
    setMessage: vi.fn(),
    supportsStringLiterals: true,
    workspaceRoot: ROOT,
    ...overrides,
  };
}

function renderHook(
  deps: PhpContextualFrameworkLiteralDefinitionNavigationDependencies,
) {
  const container = document.createElement("div");
  const root = createRoot(container);
  const captured: {
    api: PhpContextualFrameworkLiteralDefinitionNavigation | null;
  } = {
    api: null,
  };

  function Harness({
    dependencies,
  }: {
    dependencies: PhpContextualFrameworkLiteralDefinitionNavigationDependencies;
  }) {
    captured.api =
      usePhpContextualFrameworkLiteralDefinitionNavigation(dependencies);
    return null;
  }

  act(() => {
    root.render(<Harness dependencies={deps} />);
  });

  const api = (): PhpContextualFrameworkLiteralDefinitionNavigation => {
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

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((innerResolve) => {
    resolve = innerResolve;
  });

  return { promise, resolve };
}

describe("usePhpContextualFrameworkLiteralDefinitionNavigation", () => {
  it("opens provider-backed framework literal targets from context", async () => {
    const cases = [
      {
        expectedLabel: "redis",
        expectedPath: `${ROOT}/config/cache.php`,
        expectedResolver: "findCacheStoreTarget",
        expectedValue: "redis",
        request: {
          kind: "cacheStore",
          storeName: "redis",
        },
        target: {
          storeName: "redis",
          path: `${ROOT}/config/cache.php`,
          position: POSITION,
        },
      },
      {
        expectedLabel: "app.name",
        expectedPath: `${ROOT}/config/app.php`,
        expectedResolver: "findConfigTarget",
        expectedValue: "app.name",
        request: {
          key: "app.name",
          kind: "config",
        },
        target: {
          key: "app.name",
          path: `${ROOT}/config/app.php`,
          position: POSITION,
        },
      },
      {
        expectedLabel: "APP_URL",
        expectedPath: `${ROOT}/.env`,
        expectedResolver: "findEnvTarget",
        expectedValue: "APP_URL",
        request: {
          kind: "env",
          name: "APP_URL",
        },
        target: {
          name: "APP_URL",
          path: `${ROOT}/.env`,
          position: POSITION,
        },
      },
      {
        expectedLabel: "messages.welcome",
        expectedPath: `${ROOT}/lang/en/messages.php`,
        expectedResolver: "findTranslationTarget",
        expectedValue: "messages.welcome",
        request: {
          key: "messages.welcome",
          kind: "translation",
        },
        target: {
          key: "messages.welcome",
          path: `${ROOT}/lang/en/messages.php`,
          position: POSITION,
        },
      },
      {
        expectedLabel: "dashboard.index",
        expectedPath: `${ROOT}/resources/views/dashboard/index.blade.php`,
        expectedResolver: "findViewTarget",
        expectedValue: "dashboard.index",
        request: {
          kind: "view",
          name: "dashboard.index",
        },
        target: {
          name: "dashboard.index",
          path: `${ROOT}/resources/views/dashboard/index.blade.php`,
          position: POSITION,
        },
      },
    ] as const;

    for (const testCase of cases) {
      const openNavigationTarget = vi.fn(async () => true);
      const deps = makeDeps({
        frameworkLiteralNavigationDependencies: {
          collectNamedRouteTargets: vi.fn(async () => []),
          findCacheStoreTarget: vi.fn(async () =>
            testCase.expectedResolver === "findCacheStoreTarget"
              ? testCase.target
              : null,
          ),
          findConfigTarget: vi.fn(async () =>
            testCase.expectedResolver === "findConfigTarget"
              ? testCase.target
              : null,
          ),
          findEnvTarget: vi.fn(async () =>
            testCase.expectedResolver === "findEnvTarget"
              ? testCase.target
              : null,
          ),
          findTranslationTarget: vi.fn(async () =>
            testCase.expectedResolver === "findTranslationTarget"
              ? testCase.target
              : null,
          ),
          findViewTarget: vi.fn(async () =>
            testCase.expectedResolver === "findViewTarget"
              ? testCase.target
              : null,
          ),
        },
        openNavigationTarget,
      });
      const harness = renderHook(deps);

      const handled = await harness
        .api()
        .goToPhpFrameworkLiteralDefinition(testCase.request);

      expect(handled).toBe(true);
      expect(
        deps.frameworkLiteralNavigationDependencies[
          testCase.expectedResolver
        ],
      ).toHaveBeenCalledWith(testCase.expectedValue);
      expect(openNavigationTarget).toHaveBeenCalledWith(
        testCase.expectedPath,
        POSITION,
        testCase.expectedLabel,
      );

      harness.unmount();
    }
  });

  it("opens named routes from context with case-insensitive matching", async () => {
    const source = "<?php to_route('Dashboard');";
    const collectNamedRouteTargets = vi.fn(async () => [
      {
        name: "dashboard",
        path: `${ROOT}/routes/web.php`,
        position: POSITION,
      },
    ]);
    const openNavigationTarget = vi.fn(async () => true);
    const deps = makeDeps({
      activeDocument: {
        content: source,
        language: "php",
        name: "Controller.php",
        path: `${ROOT}/app/Controller.php`,
        savedContent: "",
      },
      frameworkLiteralNavigationDependencies: {
        collectNamedRouteTargets,
        findConfigTarget: vi.fn(async () => null),
        findEnvTarget: vi.fn(async () => null),
        findTranslationTarget: vi.fn(async () => null),
        findViewTarget: vi.fn(async () => null),
      },
      openNavigationTarget,
    });
    const harness = renderHook(deps);

    const handled = await harness.api().goToPhpFrameworkLiteralDefinition({
      kind: "route",
      name: "Dashboard",
    });

    expect(handled).toBe(true);
    expect(collectNamedRouteTargets).toHaveBeenCalledWith(
      source,
      `${ROOT}/app/Controller.php`,
    );
    expect(openNavigationTarget).toHaveBeenCalledWith(
      `${ROOT}/routes/web.php`,
      POSITION,
      "dashboard",
    );

    harness.unmount();
  });

  it("opens validation rule table model targets only with validation-capable providers", async () => {
    const modelTarget = {
      label: "App\\Models\\User",
      path: `${ROOT}/app/Models/User.php`,
      position: POSITION,
    };
    const findValidationRuleModelTargets = vi.fn(async () => [
      modelTarget,
    ]);
    const openNavigationTarget = vi.fn(async () => true);
    const deps = makeDeps({
      frameworkLiteralNavigationDependencies: {
        collectNamedRouteTargets: vi.fn(async () => []),
        findConfigTarget: vi.fn(async () => null),
        findEnvTarget: vi.fn(async () => null),
        findValidationRuleModelTargets,
        findTranslationTarget: vi.fn(async () => null),
        findViewTarget: vi.fn(async () => null),
      },
      openNavigationTarget,
    });
    const harness = renderHook(deps);

    await expect(
      harness.api().goToPhpFrameworkLiteralDefinition({
        kind: "validationTable",
        tableName: "users",
      }),
    ).resolves.toBe(true);
    expect(findValidationRuleModelTargets).toHaveBeenCalledWith(
      "users",
    );
    expect(openNavigationTarget).toHaveBeenCalledWith(
      modelTarget.path,
      POSITION,
      modelTarget.label,
    );

    harness.unmount();

    const genericOpenNavigationTarget = vi.fn(async () => true);
    const genericDeps = makeDeps({
      frameworkLiteralNavigationDependencies:
        deps.frameworkLiteralNavigationDependencies,
      openNavigationTarget: genericOpenNavigationTarget,
      providers: [],
    });
    const genericHarness = renderHook(genericDeps);

    await expect(
      genericHarness.api().goToPhpFrameworkLiteralDefinition({
        kind: "validationTable",
        tableName: "users",
      }),
    ).resolves.toBe(false);
    expect(findValidationRuleModelTargets).toHaveBeenCalledTimes(1);
    expect(genericOpenNavigationTarget).not.toHaveBeenCalled();

    genericHarness.unmount();
  });

  it("does not open validation model targets from another workspace", async () => {
    const openNavigationTarget = vi.fn(async () => true);
    const setMessage = vi.fn();
    const deps = makeDeps({
      frameworkLiteralNavigationDependencies: {
        collectNamedRouteTargets: vi.fn(async () => []),
        findConfigTarget: vi.fn(async () => null),
        findEnvTarget: vi.fn(async () => null),
        findValidationRuleModelTargets: vi.fn(async () => [
          {
            label: "App\\Models\\User",
            path: `${OTHER_ROOT}/app/Models/User.php`,
            position: POSITION,
          },
        ]),
        findTranslationTarget: vi.fn(async () => null),
        findViewTarget: vi.fn(async () => null),
      },
      openNavigationTarget,
      setMessage,
    });
    const harness = renderHook(deps);

    await expect(
      harness.api().goToPhpFrameworkLiteralDefinition({
        kind: "validationTable",
        tableName: "users",
      }),
    ).resolves.toBe(false);
    expect(openNavigationTarget).not.toHaveBeenCalled();
    expect(setMessage).not.toHaveBeenCalled();

    harness.unmount();
  });

  it("returns false before resolving targets when runtime string literals are unsupported", async () => {
    const findConfigTarget = vi.fn(async () => ({
      key: "app.name",
      path: `${ROOT}/config/app.php`,
      position: POSITION,
    }));
    const openNavigationTarget = vi.fn(async () => true);
    const deps = makeDeps({
      frameworkLiteralNavigationDependencies: {
        collectNamedRouteTargets: vi.fn(async () => []),
        findCacheStoreTarget: vi.fn(async () => null),
        findConfigTarget,
        findEnvTarget: vi.fn(async () => null),
        findTranslationTarget: vi.fn(async () => null),
        findViewTarget: vi.fn(async () => null),
      },
      openNavigationTarget,
      supportsStringLiterals: false,
    });
    const harness = renderHook(deps);

    const handled = await harness.api().goToPhpFrameworkLiteralDefinition({
      key: "app.name",
      kind: "config",
    });

    expect(handled).toBe(false);
    expect(findConfigTarget).not.toHaveBeenCalled();
    expect(openNavigationTarget).not.toHaveBeenCalled();

    harness.unmount();
  });

  it("keeps Laravel contextual resolvers inert without the Laravel provider", async () => {
    const findConfigTarget = vi.fn(async () => ({
      key: "app.name",
      path: `${ROOT}/config/app.php`,
      position: POSITION,
    }));
    const openNavigationTarget = vi.fn(async () => true);
    const setMessage = vi.fn();
    const deps = makeDeps({
      frameworkLiteralNavigationDependencies: {
        collectNamedRouteTargets: vi.fn(async () => []),
        findCacheStoreTarget: vi.fn(async () => null),
        findConfigTarget,
        findEnvTarget: vi.fn(async () => null),
        findTranslationTarget: vi.fn(async () => null),
        findViewTarget: vi.fn(async () => null),
      },
      openNavigationTarget,
      providers: [{ id: "custom" }],
      setMessage,
    });
    const harness = renderHook(deps);

    await expect(
      harness.api().goToPhpFrameworkLiteralDefinition({
        key: "app.name",
        kind: "config",
      }),
    ).resolves.toBe(false);

    expect(findConfigTarget).not.toHaveBeenCalled();
    expect(openNavigationTarget).not.toHaveBeenCalled();
    expect(setMessage).not.toHaveBeenCalled();

    harness.unmount();
  });

  it("preserves missing Laravel literal messages", async () => {
    const cases = [
      {
        expectedMessage: "No Laravel route named missing.route found.",
        request: {
          kind: "route",
          name: "missing.route",
        },
        source: "<?php route('missing.route');",
      },
      {
        expectedMessage: "No Laravel cache store missing found.",
        request: {
          kind: "cacheStore",
          storeName: "missing",
        },
        source: "<?php Cache::store('missing');",
      },
      {
        expectedMessage: "No Laravel config key app.missing found.",
        request: {
          key: "app.missing",
          kind: "config",
        },
        source: "<?php config('app.missing');",
      },
      {
        expectedMessage: "No Laravel env key APP_MISSING found.",
        request: {
          kind: "env",
          name: "APP_MISSING",
        },
        source: "<?php env('APP_MISSING');",
      },
      {
        expectedMessage: "No Laravel translation key messages.missing found.",
        request: {
          key: "messages.missing",
          kind: "translation",
        },
        source: "<?php __('messages.missing');",
      },
      {
        expectedMessage: "No Laravel view named missing.view found.",
        request: {
          kind: "view",
          name: "missing.view",
        },
        source: "<?php view('missing.view');",
      },
    ] as const;

    for (const testCase of cases) {
      const setMessage = vi.fn();
      const deps = makeDeps({
        activeDocument: {
          content: testCase.source,
          language: "php",
          name: "Controller.php",
          path: `${ROOT}/app/Controller.php`,
          savedContent: "",
        },
        setMessage,
      });
      const harness = renderHook(deps);

      const handled = await harness
        .api()
        .goToPhpFrameworkLiteralDefinition(testCase.request);

      expect(handled).toBe(false);
      expect(setMessage).toHaveBeenCalledWith(testCase.expectedMessage);

      harness.unmount();
    }
  });

  it("drops resolved literal targets when the active workspace changes", async () => {
    const source = "<?php route('dashboard');";
    const routeTargets = deferred<
      readonly [{ name: string; path: string; position: EditorPosition }]
    >();
    const currentWorkspaceRootRef = { current: ROOT };
    const openNavigationTarget = vi.fn(async () => true);
    const setMessage = vi.fn();
    const deps = makeDeps({
      activeDocument: {
        content: source,
        language: "php",
        name: "Controller.php",
        path: `${ROOT}/app/Controller.php`,
        savedContent: "",
      },
      currentWorkspaceRootRef,
      frameworkLiteralNavigationDependencies: {
        collectNamedRouteTargets: vi.fn(() => routeTargets.promise),
        findConfigTarget: vi.fn(async () => null),
        findEnvTarget: vi.fn(async () => null),
        findTranslationTarget: vi.fn(async () => null),
        findViewTarget: vi.fn(async () => null),
      },
      openNavigationTarget,
      setMessage,
    });
    const harness = renderHook(deps);
    const navigationPromise = harness.api().goToPhpFrameworkLiteralDefinition({
      kind: "route",
      name: "dashboard",
    });

    currentWorkspaceRootRef.current = OTHER_ROOT;
    routeTargets.resolve([
      {
        name: "dashboard",
        path: `${ROOT}/routes/web.php`,
        position: POSITION,
      },
    ]);

    await expect(navigationPromise).resolves.toBe(false);
    expect(openNavigationTarget).not.toHaveBeenCalled();
    expect(setMessage).not.toHaveBeenCalled();

    harness.unmount();
  });
});
