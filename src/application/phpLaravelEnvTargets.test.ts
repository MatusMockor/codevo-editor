import { describe, expect, it, vi } from "vitest";
import { phpLaravelFrameworkProvider } from "../domain/phpFrameworkProviders";
import { phpLaravelEnvEntriesFromSource } from "../domain/phpLaravelEnv";
import type { FileEntry, TextSearchResult } from "../domain/workspace";
import {
  createPhpLaravelEnvTargetResolver,
  type PhpLaravelEnvTargetResolver,
  type PhpLaravelEnvTargetResolverDeps,
} from "./phpLaravelEnvTargets";
import { createPhpFrameworkIntelligence } from "./phpFrameworkIntelligence";
import {
  createPhpFrameworkRuntimeContext,
  type PhpFrameworkRuntimeContext,
} from "./phpFrameworkRuntimeContext";

const ROOT = "/workspace";
const OTHER_ROOT = "/other-workspace";
const PROVIDERS = [phpLaravelFrameworkProvider];
const LARAVEL_RUNTIME = createPhpFrameworkRuntimeContext(
  createPhpFrameworkIntelligence({
    matchedProviderIds: ["laravel"],
    profile: "laravel",
    providers: PROVIDERS,
  }),
);
const GENERIC_RUNTIME = createPhpFrameworkRuntimeContext(
  createPhpFrameworkIntelligence({
    matchedProviderIds: [],
    profile: "generic",
    providers: [],
  }),
);
const ENV_CAPABLE_NON_LARAVEL_RUNTIME: PhpFrameworkRuntimeContext = {
  ...GENERIC_RUNTIME,
  supports: (capability) => capability === "env",
};
const LARAVEL_PROFILE_WITHOUT_PROVIDER_RUNTIME: PhpFrameworkRuntimeContext = {
  ...LARAVEL_RUNTIME,
  providers: [],
  hasProvider: () => false,
};

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
}

function createDeferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });

  return { promise, resolve };
}

function relativeWorkspacePath(workspaceRoot: string, path: string): string {
  const normalizedRoot = workspaceRoot.replace(/\/+$/, "");

  if (path.startsWith(`${normalizedRoot}/`)) {
    return path.slice(normalizedRoot.length + 1);
  }

  return path;
}

function joinWorkspacePath(workspaceRoot: string, relativePath: string): string {
  return `${workspaceRoot.replace(/\/+$/, "")}/${relativePath}`;
}

function isPhpPath(path: string): boolean {
  return path.toLowerCase().endsWith(".php");
}

interface Harness {
  resolver: PhpLaravelEnvTargetResolver;
  ref: { current: string | null };
  readNavigationFileContent: ReturnType<typeof vi.fn>;
}

function createHarness(
  overrides: Partial<
    Omit<PhpLaravelEnvTargetResolverDeps, "workspaceTargetCollectorDeps">
  > & {
    readNavigationFileContent?: (path: string) => Promise<string>;
  } = {},
): Harness {
  const ref = { current: ROOT };
  const readNavigationFileContent = vi.fn(
    overrides.readNavigationFileContent ?? (async () => ""),
  );

  const deps: PhpLaravelEnvTargetResolverDeps = {
    workspaceRoot:
      "workspaceRoot" in overrides ? (overrides.workspaceRoot ?? null) : ROOT,
    frameworkRuntime: overrides.frameworkRuntime ?? LARAVEL_RUNTIME,
    workspaceTargetCollectorDeps: {
      currentWorkspaceRootRef: ref,
      textSearch: { searchText: vi.fn(async () => [] as TextSearchResult[]) },
      readFileContent: readNavigationFileContent,
      readWorkspaceDirectory: vi.fn(async () => [] as FileEntry[]),
      relativeWorkspacePath,
      joinWorkspacePath,
      isPhpPath,
    },
  };

  return {
    resolver: createPhpLaravelEnvTargetResolver(deps),
    ref,
    readNavigationFileContent,
  };
}

describe("createPhpLaravelEnvTargetResolver", () => {
  it("collects env targets from the first readable dotenv file", async () => {
    const envSource = `APP_NAME=Editor\nAPP_ENV=local\nexport QUEUE_CONNECTION=sync\n`;
    const harness = createHarness({
      readNavigationFileContent: async (path: string) => {
        if (path === `${ROOT}/.env`) {
          return envSource;
        }

        throw new Error(`unexpected read: ${path}`);
      },
    });

    const targets = await harness.resolver.collect();
    const expected = phpLaravelEnvEntriesFromSource(envSource).map((entry) => ({
      ...entry,
      path: `${ROOT}/.env`,
      relativePath: ".env",
    }));

    expect(targets).toEqual(expected);
    expect(harness.readNavigationFileContent).toHaveBeenCalledTimes(1);
    expect(harness.readNavigationFileContent).toHaveBeenCalledWith(`${ROOT}/.env`);
  });

  it("falls back to .env.example when .env is unreadable", async () => {
    const exampleSource = "APP_URL=https://example.test\n";
    const harness = createHarness({
      readNavigationFileContent: async (path: string) => {
        if (path === `${ROOT}/.env`) {
          throw new Error("missing env");
        }

        if (path === `${ROOT}/.env.example`) {
          return exampleSource;
        }

        throw new Error(`unexpected read: ${path}`);
      },
    });

    await expect(harness.resolver.collect()).resolves.toEqual([
      {
        name: "APP_URL",
        path: `${ROOT}/.env.example`,
        position: { column: 1, lineNumber: 1 },
        relativePath: ".env.example",
      },
    ]);
    expect(harness.readNavigationFileContent).toHaveBeenNthCalledWith(
      1,
      `${ROOT}/.env`,
    );
    expect(harness.readNavigationFileContent).toHaveBeenNthCalledWith(
      2,
      `${ROOT}/.env.example`,
    );
  });

  it("returns empty results without reading when env targets are unsupported or the root is missing", async () => {
    const unsupported = createHarness({
      frameworkRuntime: GENERIC_RUNTIME,
      readNavigationFileContent: async () => "APP_URL=https://local.test",
    });

    await expect(unsupported.resolver.collect()).resolves.toEqual([]);
    expect(unsupported.readNavigationFileContent).not.toHaveBeenCalled();

    const noRoot = createHarness({
      workspaceRoot: null,
      readNavigationFileContent: async () => "APP_URL=https://local.test",
    });

    await expect(noRoot.resolver.collect()).resolves.toEqual([]);
    expect(noRoot.readNavigationFileContent).not.toHaveBeenCalled();
  });

  it("drops collected targets when the workspace root changes during a read", async () => {
    const deferred = createDeferred<string>();
    const harness = createHarness({
      readNavigationFileContent: async () => deferred.promise,
    });

    const pending = harness.resolver.collect();

    harness.ref.current = OTHER_ROOT;
    deferred.resolve("APP_URL=https://late.test\n");

    await expect(pending).resolves.toEqual([]);
  });

  it("keeps env collection uncached", async () => {
    const harness = createHarness({
      readNavigationFileContent: async () => "APP_URL=https://local.test\n",
    });

    await harness.resolver.collect();
    await harness.resolver.collect();

    expect(harness.readNavigationFileContent).toHaveBeenCalledTimes(2);
  });

  it("finds env targets in .env before .env.example", async () => {
    const harness = createHarness({
      readNavigationFileContent: async (path: string) => {
        if (path === `${ROOT}/.env`) {
          return "APP_URL=https://env.test\n";
        }

        if (path === `${ROOT}/.env.example`) {
          return "APP_URL=https://example.test\n";
        }

        throw new Error(`unexpected read: ${path}`);
      },
    });

    await expect(harness.resolver.find("APP_URL")).resolves.toEqual({
      name: "APP_URL",
      path: `${ROOT}/.env`,
      position: { column: 1, lineNumber: 1 },
      relativePath: ".env",
    });
    expect(harness.readNavigationFileContent).toHaveBeenCalledTimes(1);
    expect(harness.readNavigationFileContent).toHaveBeenCalledWith(`${ROOT}/.env`);
  });

  it("falls back to .env.example when .env does not contain the target", async () => {
    const harness = createHarness({
      readNavigationFileContent: async (path: string) => {
        if (path === `${ROOT}/.env`) {
          return "APP_NAME=Editor\n";
        }

        if (path === `${ROOT}/.env.example`) {
          return "APP_URL=https://example.test\n";
        }

        throw new Error(`unexpected read: ${path}`);
      },
    });

    await expect(harness.resolver.find("APP_URL")).resolves.toEqual({
      name: "APP_URL",
      path: `${ROOT}/.env.example`,
      position: { column: 1, lineNumber: 1 },
      relativePath: ".env.example",
    });
    expect(harness.readNavigationFileContent).toHaveBeenNthCalledWith(
      1,
      `${ROOT}/.env`,
    );
    expect(harness.readNavigationFileContent).toHaveBeenNthCalledWith(
      2,
      `${ROOT}/.env.example`,
    );
  });

  it("ignores read errors while the requested root is still active", async () => {
    const harness = createHarness({
      readNavigationFileContent: async (path: string) => {
        if (path === `${ROOT}/.env`) {
          throw new Error("missing env");
        }

        if (path === `${ROOT}/.env.example`) {
          return "APP_URL=https://example.test\n";
        }

        throw new Error(`unexpected read: ${path}`);
      },
    });

    await expect(harness.resolver.find("APP_URL")).resolves.toEqual({
      name: "APP_URL",
      path: `${ROOT}/.env.example`,
      position: { column: 1, lineNumber: 1 },
      relativePath: ".env.example",
    });
    expect(harness.readNavigationFileContent).toHaveBeenCalledTimes(2);
  });

  it("does not read env files unless Laravel owns the active adapter", async () => {
    const envCapable = createHarness({
      frameworkRuntime: ENV_CAPABLE_NON_LARAVEL_RUNTIME,
      readNavigationFileContent: async () => "APP_URL=https://local.test",
    });

    await expect(envCapable.resolver.find("APP_URL")).resolves.toBeNull();
    expect(envCapable.readNavigationFileContent).not.toHaveBeenCalled();

    const laravelProfileOnly = createHarness({
      frameworkRuntime: LARAVEL_PROFILE_WITHOUT_PROVIDER_RUNTIME,
      readNavigationFileContent: async () => "APP_URL=https://local.test",
    });

    await expect(laravelProfileOnly.resolver.find("APP_URL")).resolves.toBeNull();
    expect(laravelProfileOnly.readNavigationFileContent).not.toHaveBeenCalled();
  });

  it("drops stale roots before reading env targets", async () => {
    const harness = createHarness({
      readNavigationFileContent: async () => "APP_URL=https://stale.test\n",
    });

    harness.ref.current = OTHER_ROOT;

    await expect(harness.resolver.find("APP_URL")).resolves.toBeNull();
    expect(harness.readNavigationFileContent).not.toHaveBeenCalled();
  });

  it("drops stale-root env target results after a read resolves", async () => {
    const deferred = createDeferred<string>();
    const harness = createHarness({
      readNavigationFileContent: async () => deferred.promise,
    });

    const pending = harness.resolver.find("APP_URL");

    harness.ref.current = OTHER_ROOT;
    deferred.resolve("APP_URL=https://late.test\n");

    await expect(pending).resolves.toBeNull();
    expect(harness.readNavigationFileContent).toHaveBeenCalledTimes(1);
    expect(harness.readNavigationFileContent).toHaveBeenCalledWith(`${ROOT}/.env`);
  });
});
