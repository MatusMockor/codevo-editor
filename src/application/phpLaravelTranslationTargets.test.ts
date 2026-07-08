import { describe, expect, it, vi } from "vitest";
import { phpLaravelFrameworkProvider } from "../domain/phpFrameworkProviders";
import type { PhpLaravelTranslationTarget } from "../domain/phpLaravelTranslations";
import type { FileEntry } from "../domain/workspace";
import {
  createPhpLaravelTranslationTargetResolver,
  type PhpLaravelTranslationTargetResolverDeps,
} from "./phpLaravelTranslationTargets";

const ROOT = "/workspace";
const PROVIDERS = [phpLaravelFrameworkProvider];

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

function fileEntry(path: string): FileEntry {
  const name = path.slice(path.lastIndexOf("/") + 1);
  return { name, path, kind: "file" };
}

function directoryEntry(path: string): FileEntry {
  const name = path.slice(path.lastIndexOf("/") + 1);
  return { name, path, kind: "directory" };
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

interface Harness {
  ref: { current: string | null };
  readFileContent: ReturnType<typeof vi.fn>;
  readWorkspaceDirectory: ReturnType<typeof vi.fn>;
  readCachedTranslationTargets: ReturnType<typeof vi.fn>;
  writeCachedTranslationTargets: ReturnType<typeof vi.fn>;
  resolver: ReturnType<typeof createPhpLaravelTranslationTargetResolver>;
}

function createHarness(
  overrides: Partial<PhpLaravelTranslationTargetResolverDeps> = {},
): Harness {
  const ref: { current: string | null } = { current: ROOT };
  const readFileContent = vi.fn(async () => "");
  const readWorkspaceDirectory = vi.fn(async () => [] as FileEntry[]);
  const readCachedTranslationTargets = vi.fn(() => null);
  const writeCachedTranslationTargets = vi.fn();

  const deps: PhpLaravelTranslationTargetResolverDeps = {
    currentWorkspaceRootRef: ref,
    workspaceRoot: ROOT,
    phpFrameworkProviders: PROVIDERS,
    readNavigationFileContent: readFileContent as never,
    readWorkspaceDirectory: readWorkspaceDirectory as never,
    relativeWorkspacePath,
    joinWorkspacePath,
    readCachedTranslationTargets,
    writeCachedTranslationTargets,
    ...overrides,
  };

  return {
    ref,
    readFileContent: deps.readNavigationFileContent as ReturnType<typeof vi.fn>,
    readWorkspaceDirectory: deps.readWorkspaceDirectory as ReturnType<typeof vi.fn>,
    readCachedTranslationTargets: deps.readCachedTranslationTargets as ReturnType<
      typeof vi.fn
    >,
    writeCachedTranslationTargets: deps.writeCachedTranslationTargets as ReturnType<
      typeof vi.fn
    >,
    resolver: createPhpLaravelTranslationTargetResolver(deps),
  };
}

describe("createPhpLaravelTranslationTargetResolver", () => {
  it("collects php locale files before json files and keeps the first duplicate", async () => {
    const langRoot = `${ROOT}/lang`;
    const resourcesLangRoot = `${ROOT}/resources/lang`;
    const enDir = `${langRoot}/en`;
    const frDir = `${langRoot}/fr`;
    const skDir = `${resourcesLangRoot}/sk`;
    const enPhp = `<?php\n\nreturn [\n    'welcome' => 'Welcome',\n];\n`;
    const frPhp = `<?php\n\nreturn [\n    'welcome' => 'Bienvenue',\n];\n`;
    const skPhp = `<?php\n\nreturn [\n    'title' => 'Nazov',\n];\n`;
    const enJson = `{\n  "messages.welcome": "JSON duplicate",\n  "Json only": "Only JSON"\n}`;
    const harness = createHarness({
      readWorkspaceDirectory: vi.fn(async (path: string) => {
        if (path === langRoot) {
          return [
            directoryEntry(frDir),
            directoryEntry(enDir),
            directoryEntry(`${langRoot}/bad.locale`),
            fileEntry(`${langRoot}/en.json`),
          ];
        }

        if (path === resourcesLangRoot) {
          return [directoryEntry(skDir)];
        }

        if (path === enDir) {
          return [fileEntry(`${enDir}/messages.php`)];
        }

        if (path === frDir) {
          return [fileEntry(`${frDir}/messages.php`)];
        }

        if (path === skDir) {
          return [fileEntry(`${skDir}/dashboard.php`)];
        }

        return [];
      }) as never,
      readNavigationFileContent: vi.fn(async (path: string) => {
        if (path === `${enDir}/messages.php`) {
          return enPhp;
        }

        if (path === `${frDir}/messages.php`) {
          return frPhp;
        }

        if (path === `${skDir}/dashboard.php`) {
          return skPhp;
        }

        if (path === `${langRoot}/en.json`) {
          return enJson;
        }

        throw new Error(`unexpected read ${path}`);
      }) as never,
    });

    const targets = await harness.resolver.collect();
    const byKey = new Map(targets.map((target) => [target.key, target]));

    expect(byKey.get("messages.welcome")?.path).toBe(`${enDir}/messages.php`);
    expect(byKey.get("dashboard.title")?.path).toBe(`${skDir}/dashboard.php`);
    expect(byKey.get("Json only")?.path).toBe(`${langRoot}/en.json`);
    expect(targets.map((target) => target.key)).toEqual(
      ["dashboard.title", "Json only", "messages.welcome"].sort((left, right) =>
        left.localeCompare(right),
      ),
    );
    expect(harness.writeCachedTranslationTargets).toHaveBeenCalledWith(ROOT, targets);
  });

  it("returns cached translations without touching the workspace", async () => {
    const cached: PhpLaravelTranslationTarget[] = [
      {
        key: "messages.cached",
        path: `${ROOT}/lang/en/messages.php`,
        position: { column: 1, lineNumber: 3 },
        relativePath: "lang/en/messages.php",
      },
    ];
    const harness = createHarness({
      readCachedTranslationTargets: vi.fn(() => cached) as never,
    });

    await expect(harness.resolver.collect()).resolves.toBe(cached);
    expect(harness.readWorkspaceDirectory).not.toHaveBeenCalled();
    expect(harness.readFileContent).not.toHaveBeenCalled();
    expect(harness.writeCachedTranslationTargets).not.toHaveBeenCalled();
  });

  it("drops a collection and skips the cache write when the workspace root changes mid-flight", async () => {
    const deferred = createDeferred<FileEntry[]>();
    const harness = createHarness({
      readWorkspaceDirectory: vi.fn((path: string) =>
        path === `${ROOT}/lang` ? deferred.promise : Promise.resolve([]),
      ) as never,
    });

    const pending = harness.resolver.collect();
    harness.ref.current = "/other";
    deferred.resolve([directoryEntry(`${ROOT}/lang/en`)]);

    await expect(pending).resolves.toEqual([]);
    expect(harness.writeCachedTranslationTargets).not.toHaveBeenCalled();
  });

  it("finds php translation keys from the English locale before later locales", async () => {
    const langRoot = `${ROOT}/lang`;
    const enDir = `${langRoot}/en`;
    const frDir = `${langRoot}/fr`;
    const harness = createHarness({
      readWorkspaceDirectory: vi.fn(async (path: string) => {
        if (path === langRoot) {
          return [directoryEntry(frDir), directoryEntry(enDir)];
        }

        return [];
      }) as never,
      readNavigationFileContent: vi.fn(async (path: string) => {
        if (path === `${enDir}/messages.php`) {
          return `<?php\nreturn ['welcome' => 'Welcome'];\n`;
        }

        if (path === `${frDir}/messages.php`) {
          return `<?php\nreturn ['welcome' => 'Bienvenue'];\n`;
        }

        throw new Error(`unexpected read ${path}`);
      }) as never,
    });

    const target = await harness.resolver.find("messages.welcome");

    expect(target?.path).toBe(`${enDir}/messages.php`);
    expect(harness.readFileContent).not.toHaveBeenCalledWith(
      `${frDir}/messages.php`,
    );
  });

  it("falls back to json translation files for json-style keys", async () => {
    const langRoot = `${ROOT}/lang`;
    const harness = createHarness({
      readWorkspaceDirectory: vi.fn(async (path: string) =>
        path === langRoot ? [fileEntry(`${langRoot}/en.json`)] : [],
      ) as never,
      readNavigationFileContent: vi.fn(async (path: string) => {
        if (path === `${langRoot}/en.json`) {
          return `{\n  "Welcome back": "Welcome back"\n}`;
        }

        throw new Error(`unexpected read ${path}`);
      }) as never,
    });

    const target = await harness.resolver.find("Welcome back");

    expect(target).toEqual({
      key: "Welcome back",
      path: `${langRoot}/en.json`,
      position: { column: 4, lineNumber: 2 },
      relativePath: "lang/en.json",
    });
  });
});
