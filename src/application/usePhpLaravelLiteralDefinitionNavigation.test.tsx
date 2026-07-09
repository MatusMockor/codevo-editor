// @vitest-environment jsdom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";
import type { EditorPosition } from "../domain/languageServerFeatures";
import { phpLaravelFrameworkProvider } from "../domain/phpFrameworkProviders";
import { createPhpFrameworkIntelligence } from "./phpFrameworkIntelligence";
import { createPhpFrameworkRuntimeContext } from "./phpFrameworkRuntimeContext";
import {
  usePhpLaravelLiteralDefinitionNavigation,
  type PhpLaravelLiteralDefinitionNavigation,
  type PhpLaravelLiteralDefinitionNavigationDependencies,
} from "./usePhpLaravelLiteralDefinitionNavigation";

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

function target<Name extends string>(
  key: Name,
  value: string,
): {
  key: string;
  path: string;
  position: EditorPosition;
  relativePath: string;
} & Record<Name, string> {
  return {
    [key]: value,
    key: value,
    path: `${ROOT}/config/app.php`,
    position: POSITION,
    relativePath: "config/app.php",
  } as {
    key: string;
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
    currentWorkspaceRootRef: { current: ROOT },
    findAuthGuardTarget: vi.fn(async () => null),
    findBroadcastConnectionTarget: vi.fn(async () => null),
    findCacheStoreTarget: vi.fn(async () => null),
    findDatabaseConnectionTarget: vi.fn(async () => null),
    findLogChannelTarget: vi.fn(async () => null),
    findMailMailerTarget: vi.fn(async () => null),
    findPasswordBrokerTarget: vi.fn(async () => null),
    findQueueConnectionTarget: vi.fn(async () => null),
    findRedisConnectionTarget: vi.fn(async () => null),
    findStorageDiskTarget: vi.fn(async () => null),
    frameworkRuntime: LARAVEL_RUNTIME,
    openNavigationTarget: vi.fn(async () => true),
    setMessage: vi.fn(),
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
  it("opens Laravel-owned literal targets through the shared target resolver", async () => {
    const guardTarget = target("guardName", "web");
    const openNavigationTarget = vi.fn(async () => true);
    const deps = makeDeps({
      findAuthGuardTarget: vi.fn(async () => guardTarget),
      openNavigationTarget,
    });
    const harness = renderHook(deps);

    const handled = await harness.api().goToPhpLaravelAuthGuardDefinition({
      guardName: "web",
      kind: "laravelAuthGuardString",
    });

    expect(handled).toBe(true);
    expect(openNavigationTarget).toHaveBeenCalledWith(
      guardTarget.path,
      guardTarget.position,
      guardTarget.guardName,
    );

    harness.unmount();
  });

  it("reports missing Laravel-owned literal targets through the shared target resolver", async () => {
    const setMessage = vi.fn();
    const deps = makeDeps({ setMessage });
    const harness = renderHook(deps);

    const handled = await harness.api().goToPhpLaravelCacheStoreDefinition({
      kind: "laravelCacheStoreString",
      storeName: "missing",
    });

    expect(handled).toBe(false);
    expect(setMessage).toHaveBeenCalledWith(
      "No Laravel cache store missing found.",
    );

    harness.unmount();
  });

  it("drops resolved Laravel-owned literal targets when the active workspace changes", async () => {
    const authGuardTarget = deferred<
      ReturnType<typeof target<"guardName">> | null
    >();
    const currentWorkspaceRootRef = { current: ROOT };
    const openNavigationTarget = vi.fn(async () => true);
    const deps = makeDeps({
      currentWorkspaceRootRef,
      findAuthGuardTarget: vi.fn(() => authGuardTarget.promise),
      openNavigationTarget,
    });
    const harness = renderHook(deps);
    const navigationPromise = harness.api().goToPhpLaravelAuthGuardDefinition({
      guardName: "web",
      kind: "laravelAuthGuardString",
    });

    currentWorkspaceRootRef.current = OTHER_ROOT;
    authGuardTarget.resolve(target("guardName", "web"));

    await expect(navigationPromise).resolves.toBe(false);
    expect(openNavigationTarget).not.toHaveBeenCalled();

    harness.unmount();
  });
});
