// @vitest-environment jsdom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";
import type { EditorPosition } from "../domain/languageServerFeatures";
import { phpLaravelFrameworkProvider } from "../domain/phpFrameworkProviders";
import { createPhpFrameworkIntelligence } from "./phpFrameworkIntelligence";
import {
  createPhpFrameworkRuntimeContext,
  type PhpFrameworkRuntimeContext,
} from "./phpFrameworkRuntimeContext";
import {
  usePhpLaravelGateMiddlewareDefinitionNavigation,
  type PhpLaravelGateMiddlewareDefinitionNavigation,
  type PhpLaravelGateMiddlewareDefinitionNavigationDependencies,
} from "./usePhpLaravelGateMiddlewareDefinitionNavigation";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

const ROOT = "/workspace";
const OTHER_ROOT = "/other";
const POSITION: EditorPosition = { column: 1, lineNumber: 1 };
const LARAVEL_RUNTIME = createPhpFrameworkRuntimeContext(
  createPhpFrameworkIntelligence({
    matchedProviderIds: ["laravel"],
    profile: "laravel",
    providers: [phpLaravelFrameworkProvider],
  }),
);
const LARAVEL_PROFILE_WITHOUT_PROVIDER_RUNTIME: PhpFrameworkRuntimeContext = {
  ...LARAVEL_RUNTIME,
  providers: [],
  hasProvider: () => false,
};

function namedTarget(name: string) {
  return {
    name,
    path: `${ROOT}/app/Providers/AuthServiceProvider.php`,
    position: POSITION,
    relativePath: "app/Providers/AuthServiceProvider.php",
  };
}

function makeDeps(
  overrides: Partial<PhpLaravelGateMiddlewareDefinitionNavigationDependencies> = {},
): PhpLaravelGateMiddlewareDefinitionNavigationDependencies {
  return {
    activeDocument: {
      content: "<?php Gate::allows('publish-posts');",
      language: "php",
      name: "PostController.php",
      path: `${ROOT}/app/Http/Controllers/PostController.php`,
      savedContent: "",
    },
    collectAuthorizationAbilityTargets: vi.fn(async () => []),
    collectMiddlewareAliasTargets: vi.fn(async () => []),
    currentWorkspaceRootRef: { current: ROOT },
    frameworkRuntime: LARAVEL_RUNTIME,
    openNavigationTarget: vi.fn(async () => true),
    setMessage: vi.fn(),
    workspaceRoot: ROOT,
    ...overrides,
  };
}

function renderHook(
  deps: PhpLaravelGateMiddlewareDefinitionNavigationDependencies,
) {
  const container = document.createElement("div");
  const root = createRoot(container);
  const captured: {
    api: PhpLaravelGateMiddlewareDefinitionNavigation | null;
  } = {
    api: null,
  };

  function Harness({
    dependencies,
  }: {
    dependencies: PhpLaravelGateMiddlewareDefinitionNavigationDependencies;
  }) {
    captured.api = usePhpLaravelGateMiddlewareDefinitionNavigation(dependencies);
    return null;
  }

  act(() => {
    root.render(<Harness dependencies={deps} />);
  });

  const api = (): PhpLaravelGateMiddlewareDefinitionNavigation => {
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

describe("usePhpLaravelGateMiddlewareDefinitionNavigation", () => {
  it("opens a matching Laravel gate ability target", async () => {
    const abilityTarget = namedTarget("publish-posts");
    const collectAuthorizationAbilityTargets = vi.fn(async () => [
      namedTarget("delete-posts"),
      abilityTarget,
    ]);
    const openNavigationTarget = vi.fn(async () => true);
    const deps = makeDeps({
      collectAuthorizationAbilityTargets,
      openNavigationTarget,
    });
    const harness = renderHook(deps);

    const handled = await harness.api().goToPhpLaravelGateAbilityDefinition({
      ability: "publish-posts",
      kind: "laravelGateAbilityString",
    });

    expect(handled).toBe(true);
    expect(collectAuthorizationAbilityTargets).toHaveBeenCalledWith(
      deps.activeDocument?.content,
      deps.activeDocument?.path,
    );
    expect(openNavigationTarget).toHaveBeenCalledWith(
      abilityTarget.path,
      abilityTarget.position,
      abilityTarget.name,
    );

    harness.unmount();
  });

  it("reports a missing Laravel middleware alias target", async () => {
    const setMessage = vi.fn();
    const deps = makeDeps({
      collectMiddlewareAliasTargets: vi.fn(async () => [namedTarget("auth")]),
      setMessage,
    });
    const harness = renderHook(deps);

    const handled = await harness.api().goToPhpLaravelMiddlewareAliasDefinition({
      alias: "verified",
      kind: "laravelMiddlewareAliasString",
    });

    expect(handled).toBe(false);
    expect(setMessage).toHaveBeenCalledWith(
      "No Laravel middleware alias verified found.",
    );

    harness.unmount();
  });

  it("does not resolve targets when only the legacy Laravel profile flag is active", async () => {
    const collectAuthorizationAbilityTargets = vi.fn(async () => [
      namedTarget("publish-posts"),
    ]);
    const openNavigationTarget = vi.fn(async () => true);
    const setMessage = vi.fn();
    const deps = makeDeps({
      collectAuthorizationAbilityTargets,
      frameworkRuntime: LARAVEL_PROFILE_WITHOUT_PROVIDER_RUNTIME,
      openNavigationTarget,
      setMessage,
    });
    const harness = renderHook(deps);

    const handled = await harness.api().goToPhpLaravelGateAbilityDefinition({
      ability: "publish-posts",
      kind: "laravelGateAbilityString",
    });

    expect(handled).toBe(false);
    expect(collectAuthorizationAbilityTargets).not.toHaveBeenCalled();
    expect(openNavigationTarget).not.toHaveBeenCalled();
    expect(setMessage).not.toHaveBeenCalled();

    harness.unmount();
  });

  it("drops resolved targets when the active workspace changes", async () => {
    const middlewareTargets = deferred<ReturnType<typeof namedTarget>[]>();
    const currentWorkspaceRootRef = { current: ROOT };
    const openNavigationTarget = vi.fn(async () => true);
    const deps = makeDeps({
      collectMiddlewareAliasTargets: vi.fn(() => middlewareTargets.promise),
      currentWorkspaceRootRef,
      openNavigationTarget,
    });
    const harness = renderHook(deps);
    const navigationPromise =
      harness.api().goToPhpLaravelMiddlewareAliasDefinition({
        alias: "auth",
        kind: "laravelMiddlewareAliasString",
      });

    currentWorkspaceRootRef.current = OTHER_ROOT;
    middlewareTargets.resolve([namedTarget("auth")]);

    await expect(navigationPromise).resolves.toBe(false);
    expect(openNavigationTarget).not.toHaveBeenCalled();

    harness.unmount();
  });
});
