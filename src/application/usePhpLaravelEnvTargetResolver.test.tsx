// @vitest-environment jsdom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";
import { phpLaravelFrameworkProvider } from "../domain/phpFrameworkProviders";
import { createPhpFrameworkIntelligence } from "./phpFrameworkIntelligence";
import {
  createPhpFrameworkRuntimeContext,
  type PhpFrameworkRuntimeContext,
} from "./phpFrameworkRuntimeContext";
import {
  usePhpLaravelEnvTargetResolver,
  type PhpLaravelEnvTargetResolver,
  type PhpLaravelEnvTargetResolverDependencies,
} from "./usePhpLaravelEnvTargetResolver";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

const ROOT = "/workspace";
const OTHER_ROOT = "/other";
const LARAVEL_RUNTIME = createPhpFrameworkRuntimeContext(
  createPhpFrameworkIntelligence({
    matchedProviderIds: ["laravel"],
    profile: "laravel",
    providers: [phpLaravelFrameworkProvider],
  }),
);
const GENERIC_RUNTIME = createPhpFrameworkRuntimeContext(
  createPhpFrameworkIntelligence({
    matchedProviderIds: [],
    profile: "generic",
    providers: [],
  }),
);
const LARAVEL_PROFILE_WITHOUT_PROVIDER_RUNTIME: PhpFrameworkRuntimeContext = {
  ...LARAVEL_RUNTIME,
  providers: [],
  hasProvider: () => false,
};
const ENV_CAPABLE_NON_LARAVEL_RUNTIME: PhpFrameworkRuntimeContext = {
  ...GENERIC_RUNTIME,
  supports: (capability) => capability === "env",
};

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (error: unknown) => void;
}

function createDeferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((innerResolve, innerReject) => {
    resolve = innerResolve;
    reject = innerReject;
  });

  return { promise, resolve, reject };
}

function joinWorkspacePath(workspaceRoot: string, relativePath: string): string {
  return `${workspaceRoot.replace(/\/+$/, "")}/${relativePath}`;
}

function makeDeps(
  overrides: Partial<PhpLaravelEnvTargetResolverDependencies> = {},
): PhpLaravelEnvTargetResolverDependencies {
  return {
    currentWorkspaceRootRef: { current: ROOT },
    frameworkRuntime: LARAVEL_RUNTIME,
    joinWorkspacePath,
    readNavigationFileContent: vi.fn(async () => ""),
    workspaceRoot: ROOT,
    ...overrides,
  };
}

function renderHook(deps: PhpLaravelEnvTargetResolverDependencies) {
  const container = document.createElement("div");
  const root = createRoot(container);
  const captured: { resolver: PhpLaravelEnvTargetResolver | null } = {
    resolver: null,
  };

  function Harness({
    dependencies,
  }: {
    dependencies: PhpLaravelEnvTargetResolverDependencies;
  }) {
    captured.resolver = usePhpLaravelEnvTargetResolver(dependencies);
    return null;
  }

  act(() => {
    root.render(<Harness dependencies={deps} />);
  });

  const resolver = (): PhpLaravelEnvTargetResolver => {
    if (!captured.resolver) {
      throw new Error("hook not mounted");
    }

    return captured.resolver;
  };

  return {
    resolver,
    unmount: () => {
      act(() => {
        root.unmount();
      });
    },
  };
}

describe("usePhpLaravelEnvTargetResolver", () => {
  it("returns null without reading when Laravel is inactive or the root is missing", async () => {
    const inactiveRead = vi.fn(async () => "APP_URL=https://local.test");
    const inactive = renderHook(
      makeDeps({
        frameworkRuntime: GENERIC_RUNTIME,
        readNavigationFileContent: inactiveRead,
      }),
    );

    await expect(inactive.resolver()("APP_URL")).resolves.toBeNull();
    expect(inactiveRead).not.toHaveBeenCalled();
    inactive.unmount();

    const noRootRead = vi.fn(async () => "APP_URL=https://local.test");
    const noRoot = renderHook(
      makeDeps({
        readNavigationFileContent: noRootRead,
        workspaceRoot: null,
      }),
    );

    await expect(noRoot.resolver()("APP_URL")).resolves.toBeNull();
    expect(noRootRead).not.toHaveBeenCalled();
    noRoot.unmount();
  });

  it("keeps env-file navigation Laravel-only even when another runtime advertises env support", async () => {
    const readNavigationFileContent = vi.fn(
      async () => "APP_URL=https://local.test",
    );
    const harness = renderHook(
      makeDeps({
        frameworkRuntime: ENV_CAPABLE_NON_LARAVEL_RUNTIME,
        readNavigationFileContent,
      }),
    );

    await expect(harness.resolver()("APP_URL")).resolves.toBeNull();
    expect(readNavigationFileContent).not.toHaveBeenCalled();

    harness.unmount();
  });

  it("does not read env files when only the legacy Laravel profile flag is active", async () => {
    const readNavigationFileContent = vi.fn(
      async () => "APP_URL=https://local.test",
    );
    const harness = renderHook(
      makeDeps({
        frameworkRuntime: LARAVEL_PROFILE_WITHOUT_PROVIDER_RUNTIME,
        readNavigationFileContent,
      }),
    );

    await expect(harness.resolver()("APP_URL")).resolves.toBeNull();
    expect(readNavigationFileContent).not.toHaveBeenCalled();

    harness.unmount();
  });

  it("prefers .env over .env.example when both contain the target", async () => {
    const readNavigationFileContent = vi.fn(async (path: string) => {
      if (path === `${ROOT}/.env`) {
        return "APP_URL=https://env.test\n";
      }

      if (path === `${ROOT}/.env.example`) {
        return "APP_URL=https://example.test\n";
      }

      throw new Error(`Unexpected read: ${path}`);
    });
    const harness = renderHook(
      makeDeps({ readNavigationFileContent }),
    );

    await expect(harness.resolver()("APP_URL")).resolves.toEqual({
      name: "APP_URL",
      path: `${ROOT}/.env`,
      position: { column: 1, lineNumber: 1 },
      relativePath: ".env",
    });
    expect(readNavigationFileContent).toHaveBeenCalledTimes(1);
    expect(readNavigationFileContent).toHaveBeenCalledWith(`${ROOT}/.env`);

    harness.unmount();
  });

  it("falls back to .env.example when .env does not contain the target", async () => {
    const readNavigationFileContent = vi.fn(async (path: string) => {
      if (path === `${ROOT}/.env`) {
        return "APP_NAME=Editor\n";
      }

      if (path === `${ROOT}/.env.example`) {
        return "APP_URL=https://example.test\n";
      }

      throw new Error(`Unexpected read: ${path}`);
    });
    const harness = renderHook(
      makeDeps({ readNavigationFileContent }),
    );

    await expect(harness.resolver()("APP_URL")).resolves.toEqual({
      name: "APP_URL",
      path: `${ROOT}/.env.example`,
      position: { column: 1, lineNumber: 1 },
      relativePath: ".env.example",
    });
    expect(readNavigationFileContent).toHaveBeenCalledTimes(2);
    expect(readNavigationFileContent).toHaveBeenNthCalledWith(1, `${ROOT}/.env`);
    expect(readNavigationFileContent).toHaveBeenNthCalledWith(
      2,
      `${ROOT}/.env.example`,
    );

    harness.unmount();
  });

  it("ignores read errors while the requested root is still active", async () => {
    const readNavigationFileContent = vi.fn(async (path: string) => {
      if (path === `${ROOT}/.env`) {
        throw new Error("missing");
      }

      if (path === `${ROOT}/.env.example`) {
        return "APP_URL=https://example.test\n";
      }

      throw new Error(`Unexpected read: ${path}`);
    });
    const harness = renderHook(
      makeDeps({ readNavigationFileContent }),
    );

    await expect(harness.resolver()("APP_URL")).resolves.toEqual({
      name: "APP_URL",
      path: `${ROOT}/.env.example`,
      position: { column: 1, lineNumber: 1 },
      relativePath: ".env.example",
    });
    expect(readNavigationFileContent).toHaveBeenCalledTimes(2);

    harness.unmount();
  });

  it("drops stale roots before reading", async () => {
    const readNavigationFileContent = vi.fn(
      async () => "APP_URL=https://stale.test\n",
    );
    const harness = renderHook(
      makeDeps({
        currentWorkspaceRootRef: { current: OTHER_ROOT },
        readNavigationFileContent,
      }),
    );

    await expect(harness.resolver()("APP_URL")).resolves.toBeNull();
    expect(readNavigationFileContent).not.toHaveBeenCalled();

    harness.unmount();
  });

  it("drops stale-root results after a read resolves", async () => {
    const deferred = createDeferred<string>();
    const currentWorkspaceRootRef = { current: ROOT };
    const readNavigationFileContent = vi.fn(() => deferred.promise);
    const harness = renderHook(
      makeDeps({
        currentWorkspaceRootRef,
        readNavigationFileContent,
      }),
    );

    const pending = harness.resolver()("APP_URL");

    await Promise.resolve();
    currentWorkspaceRootRef.current = OTHER_ROOT;
    deferred.resolve("APP_URL=https://late.test\n");

    await expect(pending).resolves.toBeNull();
    expect(readNavigationFileContent).toHaveBeenCalledTimes(1);
    expect(readNavigationFileContent).toHaveBeenCalledWith(`${ROOT}/.env`);

    harness.unmount();
  });
});
