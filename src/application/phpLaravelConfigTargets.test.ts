import { describe, expect, it, vi } from "vitest";
import {
  phpFrameworkConfigKeysFromSource,
  phpLaravelFrameworkProvider,
} from "../domain/phpFrameworkProviders";
import type { PhpLaravelConfigTarget } from "../domain/phpLaravelConfig";
import type { FileEntry, TextSearchResult } from "../domain/workspace";
import {
  createPhpLaravelConfigTargetResolver,
  type PhpLaravelConfigTargetResolver,
  type PhpLaravelConfigTargetResolverDeps,
} from "./phpLaravelConfigTargets";
import { createPhpFrameworkIntelligence } from "./phpFrameworkIntelligence";
import { createPhpFrameworkRuntimeContext } from "./phpFrameworkRuntimeContext";

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

function fileEntry(path: string): FileEntry {
  const name = path.slice(path.lastIndexOf("/") + 1);
  return { name, path, kind: "file" };
}

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
  resolver: PhpLaravelConfigTargetResolver;
  ref: { current: string | null };
  readNavigationFileContent: ReturnType<typeof vi.fn>;
  readWorkspaceDirectory: ReturnType<typeof vi.fn>;
  readCachedConfigTargets: ReturnType<typeof vi.fn>;
  writeCachedConfigTargets: ReturnType<typeof vi.fn>;
}

function createHarness(
  overrides: Partial<
    Omit<PhpLaravelConfigTargetResolverDeps, "workspaceTargetCollectorDeps">
  > & {
    readWorkspaceDirectory?: (path: string) => Promise<FileEntry[]>;
  } = {},
): Harness {
  const ref = (overrides.currentWorkspaceRootRef as
    | { current: string | null }
    | undefined) ?? { current: ROOT };
  const readNavigationFileContent = vi.fn(
    overrides.readNavigationFileContent ?? (async () => ""),
  );
  const readWorkspaceDirectory = vi.fn(
    overrides.readWorkspaceDirectory ?? (async () => [] as FileEntry[]),
  );
  const readCachedConfigTargets = vi.fn(
    overrides.readCachedConfigTargets ??
      (() => null as PhpLaravelConfigTarget[] | null),
  );
  const writeCachedConfigTargets = vi.fn(
    overrides.writeCachedConfigTargets ?? (() => undefined),
  );

  const deps: PhpLaravelConfigTargetResolverDeps = {
    currentWorkspaceRootRef: ref,
    workspaceRoot: overrides.workspaceRoot ?? ROOT,
    frameworkRuntime: overrides.frameworkRuntime ?? LARAVEL_RUNTIME,
    workspaceTargetCollectorDeps: {
      currentWorkspaceRootRef: ref,
      textSearch: { searchText: vi.fn(async () => [] as TextSearchResult[]) },
      readFileContent: readNavigationFileContent,
      readWorkspaceDirectory,
      relativeWorkspacePath,
      joinWorkspacePath: overrides.joinWorkspacePath ?? joinWorkspacePath,
      isPhpPath,
    },
    readNavigationFileContent,
    joinWorkspacePath: overrides.joinWorkspacePath ?? joinWorkspacePath,
    readCachedConfigTargets,
    writeCachedConfigTargets,
  };

  deps.workspaceTargetCollectorDeps = {
    ...deps.workspaceTargetCollectorDeps,
    currentWorkspaceRootRef: deps.currentWorkspaceRootRef,
    readFileContent: deps.readNavigationFileContent,
    readWorkspaceDirectory,
  };

  return {
    resolver: createPhpLaravelConfigTargetResolver(deps),
    ref,
    readNavigationFileContent,
    readWorkspaceDirectory,
    readCachedConfigTargets,
    writeCachedConfigTargets,
  };
}

describe("createPhpLaravelConfigTargetResolver", () => {
  it("collects file and parsed config targets, preserves unreadable file targets, sorts, and caches", async () => {
    const configRoot = `${ROOT}/config`;
    const appSource = `<?php\n\nreturn [\n    'name' => 'Codevo',\n    'timezone' => 'UTC',\n];\n`;
    const cache = new Map<string, PhpLaravelConfigTarget[]>();
    const harness = createHarness({
      readWorkspaceDirectory: async (path: string) =>
        path === configRoot
          ? [
              fileEntry(`${configRoot}/app.php`),
              fileEntry(`${configRoot}/broken.php`),
              fileEntry(`${configRoot}/ignored.txt`),
            ]
          : [],
      readNavigationFileContent: vi.fn(async (path: string) => {
        if (path === `${configRoot}/app.php`) {
          return appSource;
        }

        throw new Error(`read failed: ${path}`);
      }) as never,
      readCachedConfigTargets: vi.fn((root: string) => cache.get(root) ?? null) as never,
      writeCachedConfigTargets: vi.fn(
        (root: string, targets: PhpLaravelConfigTarget[]) => {
          cache.set(root, targets);
        },
      ) as never,
    });

    const targets = await harness.resolver.collect();
    const keys = targets.map((target) => target.key);

    expect(harness.readNavigationFileContent).not.toHaveBeenCalledWith(
      `${configRoot}/ignored.txt`,
    );
    expect(keys).toContain("app");
    expect(keys).toContain("broken");
    for (const target of phpFrameworkConfigKeysFromSource(
      appSource,
      "app",
      PROVIDERS,
    )) {
      expect(keys).toContain(target.key);
    }
    expect(keys).toEqual([...keys].sort((left, right) => left.localeCompare(right)));
    expect(harness.readCachedConfigTargets).toHaveBeenCalledWith(ROOT);
    expect(harness.writeCachedConfigTargets).toHaveBeenCalledWith(ROOT, targets);

    const scansAfterFirstCollect = harness.readWorkspaceDirectory.mock.calls.length;
    await harness.resolver.collect();

    expect(harness.readWorkspaceDirectory.mock.calls.length).toBe(
      scansAfterFirstCollect,
    );
  });

  it("returns empty results without reading or caching when config is unsupported", async () => {
    const harness = createHarness({
      frameworkRuntime: GENERIC_RUNTIME,
    });

    await expect(harness.resolver.collect()).resolves.toEqual([]);
    await expect(harness.resolver.find("app.name")).resolves.toBeNull();

    expect(harness.readWorkspaceDirectory).not.toHaveBeenCalled();
    expect(harness.readNavigationFileContent).not.toHaveBeenCalled();
    expect(harness.readCachedConfigTargets).not.toHaveBeenCalled();
    expect(harness.writeCachedConfigTargets).not.toHaveBeenCalled();
  });

  it("rescans after a config directory read failure instead of caching the empty result", async () => {
    const harness = createHarness({
      readWorkspaceDirectory: async () => {
        throw new Error("missing config directory");
      },
    });

    await expect(harness.resolver.collect()).resolves.toEqual([]);
    await expect(harness.resolver.collect()).resolves.toEqual([]);

    expect(harness.readWorkspaceDirectory).toHaveBeenCalledTimes(2);
    expect(harness.writeCachedConfigTargets).not.toHaveBeenCalled();
  });

  it("drops collected targets and skips cache writes when the workspace root changes mid-scan", async () => {
    const deferred = createDeferred<FileEntry[]>();
    const harness = createHarness({
      readWorkspaceDirectory: async () => deferred.promise,
    });

    const pending = harness.resolver.collect();

    harness.ref.current = OTHER_ROOT;
    deferred.resolve([fileEntry(`${ROOT}/config/app.php`)]);

    await expect(pending).resolves.toEqual([]);
    expect(harness.writeCachedConfigTargets).not.toHaveBeenCalled();
  });

  it("finds parsed config targets by reading the candidate config file", async () => {
    const appSource = `<?php\n\nreturn [\n    'name' => 'Codevo',\n];\n`;
    const harness = createHarness({
      readNavigationFileContent: async (path: string) => {
        if (path === `${ROOT}/config/app.php`) {
          return appSource;
        }

        throw new Error(`unexpected read: ${path}`);
      },
    });

    await expect(harness.resolver.find("app.name")).resolves.toEqual({
      key: "app.name",
      path: `${ROOT}/config/app.php`,
      position: { column: 6, lineNumber: 4 },
      relativePath: "config/app.php",
    });
  });

  it("returns null for invalid keys without reading files", async () => {
    const harness = createHarness();

    await expect(harness.resolver.find("invalid key")).resolves.toBeNull();

    expect(harness.readNavigationFileContent).not.toHaveBeenCalled();
  });

  it("drops found targets when the workspace root changes during a read", async () => {
    const deferred = createDeferred<string>();
    const harness = createHarness({
      readNavigationFileContent: async () => deferred.promise,
    });

    const pending = harness.resolver.find("app.name");

    harness.ref.current = OTHER_ROOT;
    deferred.resolve(`<?php\nreturn ['name' => 'Codevo'];\n`);

    await expect(pending).resolves.toBeNull();
  });

  it("keeps cached config targets isolated per workspace root", async () => {
    const cache = new Map<string, PhpLaravelConfigTarget[]>();
    const readWorkspaceDirectory = vi.fn(async (path: string) => {
      if (path === `${ROOT}/config`) {
        return [fileEntry(`${ROOT}/config/app.php`)];
      }

      if (path === `${OTHER_ROOT}/config`) {
        return [fileEntry(`${OTHER_ROOT}/config/app.php`)];
      }

      return [];
    });
    const readNavigationFileContent = vi.fn(async (path: string) => {
      if (path === `${ROOT}/config/app.php`) {
        return `<?php\nreturn ['name' => 'One'];\n`;
      }

      if (path === `${OTHER_ROOT}/config/app.php`) {
        return `<?php\nreturn ['timezone' => 'UTC'];\n`;
      }

      throw new Error(`unexpected read: ${path}`);
    });
    const ref = { current: ROOT };
    const first = createHarness({
      currentWorkspaceRootRef: ref,
      readWorkspaceDirectory,
      readNavigationFileContent,
      readCachedConfigTargets: (root) => cache.get(root) ?? null,
      writeCachedConfigTargets: (root, targets) => {
        cache.set(root, targets);
      },
    });

    const rootTargets = await first.resolver.collect();

    ref.current = OTHER_ROOT;
    const second = createHarness({
      currentWorkspaceRootRef: ref,
      workspaceRoot: OTHER_ROOT,
      readWorkspaceDirectory,
      readNavigationFileContent,
      readCachedConfigTargets: (root) => cache.get(root) ?? null,
      writeCachedConfigTargets: (root, targets) => {
        cache.set(root, targets);
      },
    });

    const otherTargets = await second.resolver.collect();

    expect(rootTargets.map((target) => target.key)).toEqual(["app", "app.name"]);
    expect(otherTargets.map((target) => target.key)).toEqual([
      "app",
      "app.timezone",
    ]);
    expect(cache.get(ROOT)?.map((target) => target.key)).toEqual([
      "app",
      "app.name",
    ]);
    expect(cache.get(OTHER_ROOT)?.map((target) => target.key)).toEqual([
      "app",
      "app.timezone",
    ]);
  });
});
