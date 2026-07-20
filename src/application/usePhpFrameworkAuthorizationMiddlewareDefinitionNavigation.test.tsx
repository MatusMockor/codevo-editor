import { phpLaravelFrameworkProvider } from "../domain/phpFrameworkLaravelProvider";
// @vitest-environment jsdom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";
import type { EditorPosition } from "../domain/languageServerFeatures";
import {
  type PhpFrameworkProvider,
} from "../domain/phpFrameworkProviders";
import { createPhpFrameworkIntelligence } from "./phpFrameworkIntelligence";
import {
  createPhpFrameworkRuntimeContext,
  type PhpFrameworkRuntimeContext,
} from "./phpFrameworkRuntimeContext";
import {
  usePhpFrameworkAuthorizationMiddlewareDefinitionNavigation,
  type PhpFrameworkAuthorizationMiddlewareDefinitionNavigation,
  type PhpFrameworkAuthorizationMiddlewareDefinitionNavigationDependencies,
} from "./usePhpFrameworkAuthorizationMiddlewareDefinitionNavigation";

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
const STALE_LARAVEL_CAPABILITY_RUNTIME: PhpFrameworkRuntimeContext = {
  ...LARAVEL_RUNTIME,
  providers: [],
  hasProvider: () => false,
};
const AUTHORIZATION_ONLY_PROVIDER: PhpFrameworkProvider = {
  id: "authorization-only",
  authorizationAbilities: {},
};
const MIDDLEWARE_ONLY_PROVIDER: PhpFrameworkProvider = {
  id: "middleware-only",
  middlewareAliases: {},
};
const AUTHORIZATION_ONLY_RUNTIME: PhpFrameworkRuntimeContext = {
  ...LARAVEL_RUNTIME,
  providers: [AUTHORIZATION_ONLY_PROVIDER],
  profile: "generic",
  hasProvider: (providerId) => providerId === AUTHORIZATION_ONLY_PROVIDER.id,
  supports: (capability) => capability === "authorizationAbilities",
  supportsTargetCollection: () => false,
};
const MIDDLEWARE_ONLY_RUNTIME: PhpFrameworkRuntimeContext = {
  ...LARAVEL_RUNTIME,
  providers: [MIDDLEWARE_ONLY_PROVIDER],
  profile: "generic",
  hasProvider: (providerId) => providerId === MIDDLEWARE_ONLY_PROVIDER.id,
  supports: (capability) => capability === "middlewareAliases",
  supportsTargetCollection: () => false,
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
  overrides: Partial<PhpFrameworkAuthorizationMiddlewareDefinitionNavigationDependencies> = {},
): PhpFrameworkAuthorizationMiddlewareDefinitionNavigationDependencies {
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
  deps: PhpFrameworkAuthorizationMiddlewareDefinitionNavigationDependencies,
) {
  const container = document.createElement("div");
  const root = createRoot(container);
  const captured: {
    api: PhpFrameworkAuthorizationMiddlewareDefinitionNavigation | null;
  } = {
    api: null,
  };

  function Harness({
    dependencies,
  }: {
    dependencies: PhpFrameworkAuthorizationMiddlewareDefinitionNavigationDependencies;
  }) {
    captured.api =
      usePhpFrameworkAuthorizationMiddlewareDefinitionNavigation(dependencies);
    return null;
  }

  act(() => {
    root.render(<Harness dependencies={deps} />);
  });

  const api = (): PhpFrameworkAuthorizationMiddlewareDefinitionNavigation => {
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

describe("usePhpFrameworkAuthorizationMiddlewareDefinitionNavigation", () => {
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

    const handled = await harness
      .api()
      .goToPhpFrameworkAuthorizationAbilityDefinition({
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
      { shouldCommit: expect.any(Function) },
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

    const handled = await harness
      .api()
      .goToPhpFrameworkMiddlewareAliasDefinition({
        alias: "verified",
        kind: "laravelMiddlewareAliasString",
      });

    expect(handled).toBe(false);
    expect(setMessage).toHaveBeenCalledWith(
      "No Laravel middleware alias verified found.",
    );

    harness.unmount();
  });

  it("opens gate ability targets for a non-Laravel authorization provider", async () => {
    const abilityTarget = namedTarget("publish-posts");
    const collectAuthorizationAbilityTargets = vi.fn(async () => [
      abilityTarget,
    ]);
    const openNavigationTarget = vi.fn(async () => true);
    const deps = makeDeps({
      collectAuthorizationAbilityTargets,
      frameworkRuntime: AUTHORIZATION_ONLY_RUNTIME,
      openNavigationTarget,
    });
    const harness = renderHook(deps);

    const handled = await harness
      .api()
      .goToPhpFrameworkAuthorizationAbilityDefinition({
        ability: "publish-posts",
        kind: "laravelGateAbilityString",
      });

    expect(handled).toBe(true);
    expect(collectAuthorizationAbilityTargets).toHaveBeenCalledOnce();
    expect(openNavigationTarget).toHaveBeenCalledWith(
      abilityTarget.path,
      abilityTarget.position,
      abilityTarget.name,
      { shouldCommit: expect.any(Function) },
    );

    harness.unmount();
  });

  it("opens middleware alias targets for a non-Laravel middleware provider", async () => {
    const aliasTarget = namedTarget("auth");
    const collectMiddlewareAliasTargets = vi.fn(async () => [aliasTarget]);
    const openNavigationTarget = vi.fn(async () => true);
    const deps = makeDeps({
      collectMiddlewareAliasTargets,
      frameworkRuntime: MIDDLEWARE_ONLY_RUNTIME,
      openNavigationTarget,
    });
    const harness = renderHook(deps);

    const handled = await harness
      .api()
      .goToPhpFrameworkMiddlewareAliasDefinition({
        alias: "auth",
        kind: "laravelMiddlewareAliasString",
      });

    expect(handled).toBe(true);
    expect(collectMiddlewareAliasTargets).toHaveBeenCalledOnce();
    expect(openNavigationTarget).toHaveBeenCalledWith(
      aliasTarget.path,
      aliasTarget.position,
      aliasTarget.name,
      { shouldCommit: expect.any(Function) },
    );

    harness.unmount();
  });

  it("does not resolve middleware aliases for an authorization-only provider", async () => {
    const collectMiddlewareAliasTargets = vi.fn(async () => [
      namedTarget("auth"),
    ]);
    const openNavigationTarget = vi.fn(async () => true);
    const deps = makeDeps({
      collectMiddlewareAliasTargets,
      frameworkRuntime: AUTHORIZATION_ONLY_RUNTIME,
      openNavigationTarget,
    });
    const harness = renderHook(deps);

    const handled = await harness
      .api()
      .goToPhpFrameworkMiddlewareAliasDefinition({
        alias: "auth",
        kind: "laravelMiddlewareAliasString",
      });

    expect(handled).toBe(false);
    expect(collectMiddlewareAliasTargets).not.toHaveBeenCalled();
    expect(openNavigationTarget).not.toHaveBeenCalled();

    harness.unmount();
  });

  it("does not resolve targets when only stale Laravel capability metadata is active", async () => {
    const collectAuthorizationAbilityTargets = vi.fn(async () => [
      namedTarget("publish-posts"),
    ]);
    const openNavigationTarget = vi.fn(async () => true);
    const setMessage = vi.fn();
    const deps = makeDeps({
      collectAuthorizationAbilityTargets,
      frameworkRuntime: STALE_LARAVEL_CAPABILITY_RUNTIME,
      openNavigationTarget,
      setMessage,
    });
    const harness = renderHook(deps);

    const handled = await harness
      .api()
      .goToPhpFrameworkAuthorizationAbilityDefinition({
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
    const navigationPromise = harness
      .api()
      .goToPhpFrameworkMiddlewareAliasDefinition({
        alias: "auth",
        kind: "laravelMiddlewareAliasString",
      });

    currentWorkspaceRootRef.current = OTHER_ROOT;
    middlewareTargets.resolve([namedTarget("auth")]);

    await expect(navigationPromise).resolves.toBe(false);
    expect(openNavigationTarget).not.toHaveBeenCalled();

    harness.unmount();
  });

  it("drops same-root owner results before opening or reporting missing aliases", async () => {
    const middlewareTargets = deferred<ReturnType<typeof namedTarget>[]>();
    let requestActive = true;
    const openNavigationTarget = vi.fn(async () => true);
    const setMessage = vi.fn();
    const deps = makeDeps({
      collectMiddlewareAliasTargets: vi.fn(() => middlewareTargets.promise),
      openNavigationTarget,
      setMessage,
    });
    const harness = renderHook(deps);
    const navigationPromise = harness
      .api()
      .goToPhpFrameworkMiddlewareAliasDefinition(
        { alias: "missing", kind: "laravelMiddlewareAliasString" },
        { canNavigate: () => requestActive },
      );

    requestActive = false;
    middlewareTargets.resolve([]);

    await expect(navigationPromise).resolves.toBe(false);
    expect(openNavigationTarget).not.toHaveBeenCalled();
    expect(setMessage).not.toHaveBeenCalled();

    harness.unmount();
  });

  it("passes the owner fence into framework target opening", async () => {
    let requestActive = true;
    const openNavigationTarget = vi.fn(
      async (
        _path: string,
        _position: EditorPosition,
        _label: string,
        options?: { shouldCommit?: () => boolean },
      ) => {
        requestActive = false;
        expect(options?.shouldCommit?.()).toBe(false);
        return true;
      },
    );
    const deps = makeDeps({
      collectAuthorizationAbilityTargets: vi.fn(async () => [
        namedTarget("publish-posts"),
      ]),
      openNavigationTarget,
    });
    const harness = renderHook(deps);

    await expect(
      harness
        .api()
        .goToPhpFrameworkAuthorizationAbilityDefinition(
          { ability: "publish-posts", kind: "laravelGateAbilityString" },
          { canNavigate: () => requestActive },
        ),
    ).resolves.toBe(false);
    expect(openNavigationTarget).toHaveBeenCalledOnce();

    harness.unmount();
  });
});
