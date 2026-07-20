import { phpLaravelFrameworkProvider } from "../domain/phpFrameworkLaravelProvider";
import { describe, expect, it, vi } from "vitest";

import type { PhpLaravelViewTarget } from "../domain/phpLaravelViews";
import type { FileEntry, TextSearchResult } from "../domain/workspace";
import {
  createPhpLaravelViewTargetResolver,
  type PhpLaravelViewTargetResolver,
  type PhpLaravelViewTargetResolverDeps,
} from "./phpLaravelViewTargets";
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

function directoryEntry(path: string): FileEntry {
  const name = path.slice(path.lastIndexOf("/") + 1);
  return { name, path, kind: "directory" };
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
  resolver: PhpLaravelViewTargetResolver;
  ref: { current: string | null };
  readNavigationFileContent: ReturnType<typeof vi.fn>;
  readWorkspaceDirectory: ReturnType<typeof vi.fn>;
  readCachedViewTargets: ReturnType<typeof vi.fn>;
  writeCachedViewTargets: ReturnType<typeof vi.fn>;
}

function createHarness(
  overrides: Partial<
    Omit<PhpLaravelViewTargetResolverDeps, "workspaceTargetCollectorDeps">
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
  const readCachedViewTargets = vi.fn(
    overrides.readCachedViewTargets ??
      (() => null as PhpLaravelViewTarget[] | null),
  );
  const writeCachedViewTargets = vi.fn(
    overrides.writeCachedViewTargets ?? (() => undefined),
  );

  const deps: PhpLaravelViewTargetResolverDeps = {
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
    readCachedViewTargets,
    writeCachedViewTargets,
  };

  deps.workspaceTargetCollectorDeps = {
    ...deps.workspaceTargetCollectorDeps,
    currentWorkspaceRootRef: deps.currentWorkspaceRootRef,
    readFileContent: deps.readNavigationFileContent,
    readWorkspaceDirectory,
  };

  return {
    resolver: createPhpLaravelViewTargetResolver(deps),
    ref,
    readNavigationFileContent,
    readWorkspaceDirectory,
    readCachedViewTargets,
    writeCachedViewTargets,
  };
}

describe("createPhpLaravelViewTargetResolver", () => {
  it("collects sorted view targets by scanning resources/views recursively and caches them", async () => {
    const viewsRoot = `${ROOT}/resources/views`;
    const adminDir = `${viewsRoot}/admin`;
    const cache = new Map<string, PhpLaravelViewTarget[]>();
    const readWorkspaceDirectory = vi.fn(async (path: string) => {
      if (path === viewsRoot) {
        return [
          fileEntry(`${viewsRoot}/welcome.blade.php`),
          directoryEntry(adminDir),
          fileEntry(`${viewsRoot}/ignored.txt`),
        ];
      }

      if (path === adminDir) {
        return [
          fileEntry(`${adminDir}/dashboard.blade.php`),
          fileEntry(`${adminDir}/profile.php`),
        ];
      }

      return [];
    });
    const harness = createHarness({
      readWorkspaceDirectory,
      readCachedViewTargets: (root) => cache.get(root) ?? null,
      writeCachedViewTargets: (root, targets) => {
        cache.set(root, targets);
      },
    });

    const targets = await harness.resolver.collect();

    expect(targets).toEqual([
      {
        name: "admin.dashboard",
        path: `${adminDir}/dashboard.blade.php`,
        relativePath: "resources/views/admin/dashboard.blade.php",
      },
      {
        name: "admin.profile",
        path: `${adminDir}/profile.php`,
        relativePath: "resources/views/admin/profile.php",
      },
      {
        name: "welcome",
        path: `${viewsRoot}/welcome.blade.php`,
        relativePath: "resources/views/welcome.blade.php",
      },
    ]);
    expect(harness.readNavigationFileContent).not.toHaveBeenCalled();
    expect(harness.readCachedViewTargets).toHaveBeenCalledWith(ROOT);
    expect(harness.writeCachedViewTargets).toHaveBeenCalledWith(ROOT, targets);

    const scansAfterFirstCollect = harness.readWorkspaceDirectory.mock.calls.length;
    await harness.resolver.collect();

    expect(harness.readWorkspaceDirectory.mock.calls.length).toBe(
      scansAfterFirstCollect,
    );
  });

  it("returns empty results without reading or caching when views are unsupported", async () => {
    const harness = createHarness({
      frameworkRuntime: GENERIC_RUNTIME,
    });

    await expect(harness.resolver.collect()).resolves.toEqual([]);
    await expect(harness.resolver.find("welcome")).resolves.toBeNull();

    expect(harness.readWorkspaceDirectory).not.toHaveBeenCalled();
    expect(harness.readNavigationFileContent).not.toHaveBeenCalled();
    expect(harness.readCachedViewTargets).not.toHaveBeenCalled();
    expect(harness.writeCachedViewTargets).not.toHaveBeenCalled();
  });

  it("caches an empty view scan when the views directory cannot be read", async () => {
    const harness = createHarness({
      readWorkspaceDirectory: async () => {
        throw new Error("missing views directory");
      },
    });

    await expect(harness.resolver.collect()).resolves.toEqual([]);

    expect(harness.writeCachedViewTargets).toHaveBeenCalledWith(ROOT, []);
  });

  it("drops collected targets and skips cache writes when the workspace root changes mid-scan", async () => {
    const deferred = createDeferred<FileEntry[]>();
    const harness = createHarness({
      readWorkspaceDirectory: async () => deferred.promise,
    });

    const pending = harness.resolver.collect();

    harness.ref.current = OTHER_ROOT;
    deferred.resolve([fileEntry(`${ROOT}/resources/views/leaked.blade.php`)]);

    await expect(pending).resolves.toEqual([]);
    expect(harness.writeCachedViewTargets).not.toHaveBeenCalled();
  });

  it("probes candidate relative paths in order and returns the first readable view", async () => {
    const readNavigationFileContent = vi.fn(async (path: string) => {
      if (path === `${ROOT}/resources/views/mail/invoice.php`) {
        return "<php-view>";
      }

      throw new Error("missing");
    });
    const harness = createHarness({ readNavigationFileContent });

    await expect(harness.resolver.find("mail.invoice")).resolves.toEqual({
      name: "mail.invoice",
      path: `${ROOT}/resources/views/mail/invoice.php`,
      position: { column: 1, lineNumber: 1 },
      relativePath: "resources/views/mail/invoice.php",
    });
    expect(harness.readNavigationFileContent.mock.calls.map(([path]) => path)).toEqual([
      `${ROOT}/resources/views/mail/invoice.blade.php`,
      `${ROOT}/resources/views/mail/invoice.php`,
    ]);
  });

  it("returns null for read failures and invalid view names", async () => {
    const harness = createHarness({
      readNavigationFileContent: async () => {
        throw new Error("missing");
      },
    });

    await expect(harness.resolver.find("missing.view")).resolves.toBeNull();
    await expect(harness.resolver.find("vendor::package.view")).resolves.toBeNull();

    expect(harness.readNavigationFileContent).toHaveBeenCalledTimes(2);
  });

  it("drops found targets when the workspace root changes during a read", async () => {
    const deferred = createDeferred<string>();
    const harness = createHarness({
      readNavigationFileContent: async () => deferred.promise,
    });

    const pending = harness.resolver.find("comments.show");

    harness.ref.current = OTHER_ROOT;
    deferred.resolve("<div>show</div>");

    await expect(pending).resolves.toBeNull();
  });

  it("keeps cached view targets isolated per workspace root", async () => {
    const cache = new Map<string, PhpLaravelViewTarget[]>();
    const readWorkspaceDirectory = vi.fn(async (path: string) => {
      if (path === `${ROOT}/resources/views`) {
        return [fileEntry(`${ROOT}/resources/views/one.blade.php`)];
      }

      if (path === `${OTHER_ROOT}/resources/views`) {
        return [fileEntry(`${OTHER_ROOT}/resources/views/two.blade.php`)];
      }

      return [];
    });
    const ref = { current: ROOT };
    const first = createHarness({
      currentWorkspaceRootRef: ref,
      readWorkspaceDirectory,
      readCachedViewTargets: (root) => cache.get(root) ?? null,
      writeCachedViewTargets: (root, targets) => {
        cache.set(root, targets);
      },
    });

    const rootTargets = await first.resolver.collect();

    ref.current = OTHER_ROOT;
    const second = createHarness({
      currentWorkspaceRootRef: ref,
      workspaceRoot: OTHER_ROOT,
      readWorkspaceDirectory,
      readCachedViewTargets: (root) => cache.get(root) ?? null,
      writeCachedViewTargets: (root, targets) => {
        cache.set(root, targets);
      },
    });

    const otherTargets = await second.resolver.collect();

    expect(rootTargets.map((target) => target.name)).toEqual(["one"]);
    expect(otherTargets.map((target) => target.name)).toEqual(["two"]);
    expect(cache.get(ROOT)?.map((target) => target.name)).toEqual(["one"]);
    expect(cache.get(OTHER_ROOT)?.map((target) => target.name)).toEqual([
      "two",
    ]);
  });
});
