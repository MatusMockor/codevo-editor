// @vitest-environment jsdom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";
import type { EditorPosition } from "../domain/languageServerFeatures";
import {
  usePhpLaravelLiteralDefinitionNavigation,
  type PhpLaravelLiteralDefinitionNavigation,
  type PhpLaravelLiteralDefinitionNavigationDependencies,
} from "./usePhpLaravelLiteralDefinitionNavigation";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

const ROOT = "/workspace";
const OTHER_ROOT = "/other";
const POSITION: EditorPosition = { column: 1, lineNumber: 1 };

function target<Name extends string>(
  key: Name,
  value: string,
): { path: string; position: EditorPosition; relativePath: string } & Record<
  Name,
  string
> {
  return {
    [key]: value,
    path: `${ROOT}/config/app.php`,
    position: POSITION,
    relativePath: "config/app.php",
  } as {
    path: string;
    position: EditorPosition;
    relativePath: string;
  } & Record<Name, string>;
}

function makeDeps(
  overrides: Partial<PhpLaravelLiteralDefinitionNavigationDependencies> = {},
): PhpLaravelLiteralDefinitionNavigationDependencies {
  return {
    activeDocument: {
      content: "<?php route('dashboard');",
      language: "php",
      name: "web.php",
      path: `${ROOT}/routes/web.php`,
      savedContent: "",
    },
    collectAuthorizationAbilityTargets: vi.fn(async () => []),
    collectMiddlewareAliasTargets: vi.fn(async () => []),
    collectNamedRouteTargets: vi.fn(async () => []),
    currentWorkspaceRootRef: { current: ROOT },
    findAuthGuardTarget: vi.fn(async () => null),
    findBroadcastConnectionTarget: vi.fn(async () => null),
    findCacheStoreTarget: vi.fn(async () => null),
    findConfigTarget: vi.fn(async () => null),
    findDatabaseConnectionTarget: vi.fn(async () => null),
    findLogChannelTarget: vi.fn(async () => null),
    findMailMailerTarget: vi.fn(async () => null),
    findPasswordBrokerTarget: vi.fn(async () => null),
    findPhpLaravelEnvTarget: vi.fn(async () => null),
    findQueueConnectionTarget: vi.fn(async () => null),
    findRedisConnectionTarget: vi.fn(async () => null),
    findStorageDiskTarget: vi.fn(async () => null),
    findTranslationTarget: vi.fn(async () => null),
    findViewTarget: vi.fn(async () => null),
    isLaravelFrameworkActive: true,
    openNavigationTarget: vi.fn(async () => true),
    setMessage: vi.fn(),
    supportsRoutes: true,
    supportsViews: true,
    workspaceRoot: ROOT,
    ...overrides,
  };
}

function renderHook(deps: PhpLaravelLiteralDefinitionNavigationDependencies) {
  const container = document.createElement("div");
  const root = createRoot(container);
  const captured: { api: PhpLaravelLiteralDefinitionNavigation | null } = {
    api: null,
  };

  function Harness({
    dependencies,
  }: {
    dependencies: PhpLaravelLiteralDefinitionNavigationDependencies;
  }) {
    captured.api = usePhpLaravelLiteralDefinitionNavigation(dependencies);
    return null;
  }

  act(() => {
    root.render(<Harness dependencies={deps} />);
  });

  const api = (): PhpLaravelLiteralDefinitionNavigation => {
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

describe("usePhpLaravelLiteralDefinitionNavigation", () => {
  it("opens named route targets from the active document route collection", async () => {
    const routeTarget = {
      name: "dashboard",
      path: `${ROOT}/routes/web.php`,
      position: POSITION,
      relativePath: "routes/web.php",
    };
    const openNavigationTarget = vi.fn(async () => true);
    const deps = makeDeps({
      collectNamedRouteTargets: vi.fn(async () => [routeTarget]),
      openNavigationTarget,
    });
    const harness = renderHook(deps);

    const handled = await harness.api().goToPhpLaravelNamedRouteDefinition({
      kind: "laravelNamedRouteString",
      routeName: "dashboard",
    });

    expect(handled).toBe(true);
    expect(openNavigationTarget).toHaveBeenCalledWith(
      routeTarget.path,
      routeTarget.position,
      routeTarget.name,
    );

    harness.unmount();
  });

  it("reports missing config keys through the shared target resolver", async () => {
    const setMessage = vi.fn();
    const deps = makeDeps({ setMessage });
    const harness = renderHook(deps);

    const handled = await harness.api().goToPhpLaravelConfigDefinition({
      configKey: "app.missing",
      kind: "laravelConfigString",
    });

    expect(handled).toBe(false);
    expect(setMessage).toHaveBeenCalledWith(
      "No Laravel config key app.missing found.",
    );

    harness.unmount();
  });

  it("drops resolved literal targets when the active workspace changes", async () => {
    const envTarget = deferred<ReturnType<typeof target<"name">> | null>();
    const currentWorkspaceRootRef = { current: ROOT };
    const openNavigationTarget = vi.fn(async () => true);
    const deps = makeDeps({
      currentWorkspaceRootRef,
      findPhpLaravelEnvTarget: vi.fn(() => envTarget.promise),
      openNavigationTarget,
    });
    const harness = renderHook(deps);
    const navigationPromise = harness.api().goToPhpLaravelEnvDefinition({
      envName: "APP_URL",
      kind: "laravelEnvString",
    });

    currentWorkspaceRootRef.current = OTHER_ROOT;
    envTarget.resolve(target("name", "APP_URL"));

    await expect(navigationPromise).resolves.toBe(false);
    expect(openNavigationTarget).not.toHaveBeenCalled();

    harness.unmount();
  });
});
