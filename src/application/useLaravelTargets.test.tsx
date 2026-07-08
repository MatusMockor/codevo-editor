// @vitest-environment jsdom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";
import {
  useLaravelTargets,
  type LaravelTargets,
  type LaravelTargetsDependencies,
} from "./useLaravelTargets";
import {
  usePhpFrameworkTargets,
  type PhpFrameworkTargets,
  type PhpFrameworkTargetsDependencies,
} from "./usePhpFrameworkTargets";
import {
  phpFrameworkRouteDefinitionsFromSource,
  phpLaravelFrameworkProvider,
  phpNetteFrameworkProvider,
} from "../domain/phpFrameworkProviders";
import { phpLaravelGateAbilityDefinitions } from "../domain/phpLaravelAuthorization";
import { phpLaravelMiddlewareAliasDefinitions } from "../domain/phpLaravelMiddleware";
import { phpLaravelEnvEntriesFromSource } from "../domain/phpLaravelEnv";
import { phpLaravelViewNameFromRelativePath } from "../domain/phpLaravelViews";
import { phpFrameworkConfigKeysFromSource } from "../domain/phpFrameworkProviders";
import { phpFrameworkTranslationKeysFromSource } from "../domain/phpFrameworkProviders";
import { phpFrameworkJsonTranslationKeysFromSource } from "../domain/phpFrameworkProviders";
import type { FileEntry, TextSearchResult } from "../domain/workspace";
import { phpLaravelAuthGuardConfigKey } from "../domain/phpLaravelAuth";
import { phpLaravelDatabaseConnectionConfigKey } from "../domain/phpLaravelDatabase";
import { phpLaravelStorageDiskConfigKey } from "../domain/phpLaravelStorage";
import { createPhpFrameworkIntelligence } from "./phpFrameworkIntelligence";

const ROOT = "/workspace";
const PROVIDERS = [phpLaravelFrameworkProvider];
const LARAVEL_FRAMEWORK_INTELLIGENCE = createPhpFrameworkIntelligence({
  matchedProviderIds: ["laravel"],
  profile: "laravel",
  providers: PROVIDERS,
});
const GENERIC_FRAMEWORK_INTELLIGENCE = createPhpFrameworkIntelligence({
  matchedProviderIds: [],
  profile: "generic",
  providers: [],
});
const NETTE_FRAMEWORK_INTELLIGENCE = createPhpFrameworkIntelligence({
  matchedProviderIds: ["nette"],
  profile: "nette",
  providers: [phpNetteFrameworkProvider],
});

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
  hook: () => LaravelTargets;
  ref: { current: string | null };
  searchText: ReturnType<typeof vi.fn>;
  readFileContent: ReturnType<typeof vi.fn>;
  readWorkspaceDirectory: ReturnType<typeof vi.fn>;
  unmount: () => void;
}

interface FrameworkHarness {
  hook: () => PhpFrameworkTargets;
  ref: { current: string | null };
  searchText: ReturnType<typeof vi.fn>;
  readFileContent: ReturnType<typeof vi.fn>;
  readWorkspaceDirectory: ReturnType<typeof vi.fn>;
  unmount: () => void;
}

function renderLaravelTargets(
  overrides: Partial<LaravelTargetsDependencies> = {},
): Harness {
  const container = document.createElement("div");
  const root = createRoot(container);
  const captured: { hook: LaravelTargets | null } = { hook: null };

  const ref: { current: string | null } = { current: ROOT };
  const searchText = vi.fn(async () => [] as TextSearchResult[]);
  const readFileContent = vi.fn(async () => "");
  const readWorkspaceDirectory = vi.fn(async () => [] as FileEntry[]);

  const deps: LaravelTargetsDependencies = {
    currentWorkspaceRootRef: ref,
    workspaceRoot: ROOT,
    textSearch: { searchText } as never,
    readNavigationFileContent: readFileContent as never,
    readWorkspaceDirectory: readWorkspaceDirectory as never,
    relativeWorkspacePath,
    joinWorkspacePath,
    isPhpPath,
    activePhpFrameworkProviders: PROVIDERS,
    isLaravelFrameworkActive: true,
    ...overrides,
  };

  function HarnessComponent() {
    captured.hook = useLaravelTargets(deps);
    return null;
  }

  act(() => {
    root.render(<HarnessComponent />);
  });

  return {
    hook: () => {
      if (!captured.hook) {
        throw new Error("hook not mounted");
      }
      return captured.hook;
    },
    ref,
    searchText,
    readFileContent,
    readWorkspaceDirectory,
    unmount: () => {
      act(() => {
        root.unmount();
      });
    },
  };
}

function renderPhpFrameworkTargets(
  overrides: Partial<PhpFrameworkTargetsDependencies> = {},
): FrameworkHarness {
  const container = document.createElement("div");
  const root = createRoot(container);
  const captured: { hook: PhpFrameworkTargets | null } = { hook: null };

  const ref: { current: string | null } = { current: ROOT };
  const searchText = vi.fn(async () => [] as TextSearchResult[]);
  const readFileContent = vi.fn(async () => "");
  const readWorkspaceDirectory = vi.fn(async () => [] as FileEntry[]);

  const deps: PhpFrameworkTargetsDependencies = {
    currentWorkspaceRootRef: ref,
    workspaceRoot: ROOT,
    textSearch: { searchText } as never,
    readNavigationFileContent: readFileContent as never,
    readWorkspaceDirectory: readWorkspaceDirectory as never,
    relativeWorkspacePath,
    joinWorkspacePath,
    isPhpPath,
    frameworkIntelligence: LARAVEL_FRAMEWORK_INTELLIGENCE,
    ...overrides,
  };

  function HarnessComponent() {
    captured.hook = usePhpFrameworkTargets(deps);
    return null;
  }

  act(() => {
    root.render(<HarnessComponent />);
  });

  return {
    hook: () => {
      if (!captured.hook) {
        throw new Error("hook not mounted");
      }
      return captured.hook;
    },
    ref,
    searchText,
    readFileContent,
    readWorkspaceDirectory,
    unmount: () => {
      act(() => {
        root.unmount();
      });
    },
  };
}

describe("usePhpFrameworkTargets", () => {
  it("adapts the active Laravel provider to neutral named route collection", async () => {
    const source =
      "<?php\nRoute::get('/comments')->name('comments.definition');\n";
    const currentPath = `${ROOT}/routes/web.php`;
    const harness = renderPhpFrameworkTargets();

    const targets = await harness
      .hook()
      .collectNamedRouteTargets(source, currentPath);

    const expected = phpFrameworkRouteDefinitionsFromSource(source, PROVIDERS)
      .map((definition) => ({
        ...definition,
        path: currentPath,
        relativePath: "routes/web.php",
      }))
      .sort((left, right) => {
        const nameOrder = left.name.localeCompare(right.name);
        if (nameOrder !== 0) {
          return nameOrder;
        }
        return left.path.localeCompare(right.path);
      });

    expect(expected.length).toBeGreaterThan(0);
    expect(targets).toEqual(expected);
    expect(harness.searchText).toHaveBeenCalledWith(ROOT, "->name(", 200);

    harness.unmount();
  });

  it("returns empty targets when no framework provider is active", async () => {
    const harness = renderPhpFrameworkTargets({
      frameworkIntelligence: GENERIC_FRAMEWORK_INTELLIGENCE,
    });

    expect(
      await harness
        .hook()
        .collectNamedRouteTargets(
          "<?php Route::get('/x')->name('x');",
          `${ROOT}/routes/web.php`,
        ),
    ).toEqual([]);
    expect(
      await harness
        .hook()
        .collectAuthorizationAbilityTargets(
          "<?php Gate::define('x', fn () => true);",
          `${ROOT}/app/Providers/AuthServiceProvider.php`,
        ),
    ).toEqual([]);
    expect(await harness.hook().collectEnvironmentTargets()).toEqual([]);
    expect(await harness.hook().collectViewTargets()).toEqual([]);
    expect(await harness.hook().collectConfigTargets()).toEqual([]);
    expect(await harness.hook().collectTranslationTargets()).toEqual([]);
    expect(await harness.hook().findViewTarget("comments.show")).toBeNull();
    expect(await harness.hook().findConfigTarget("app.name")).toBeNull();
    expect(await harness.hook().findTranslationTarget("messages.welcome")).toBeNull();
    expect(harness.searchText).not.toHaveBeenCalled();
    expect(harness.readFileContent).not.toHaveBeenCalled();
    expect(harness.readWorkspaceDirectory).not.toHaveBeenCalled();

    harness.unmount();
  });

  it("keeps the Laravel adapter inert for a non-Laravel provider", async () => {
    const harness = renderPhpFrameworkTargets({
      frameworkIntelligence: NETTE_FRAMEWORK_INTELLIGENCE,
    });

    expect(
      await harness
        .hook()
        .collectNamedRouteTargets(
          "<?php Route::get('/x')->name('x');",
          `${ROOT}/routes/web.php`,
        ),
    ).toEqual([]);
    expect(await harness.hook().collectEnvironmentTargets()).toEqual([]);
    expect(await harness.hook().collectViewTargets()).toEqual([]);
    expect(await harness.hook().collectConfigTargets()).toEqual([]);
    expect(await harness.hook().collectTranslationTargets()).toEqual([]);
    expect(await harness.hook().findViewTarget("comments.show")).toBeNull();
    expect(await harness.hook().findConfigTarget("app.name")).toBeNull();
    expect(await harness.hook().findTranslationTarget("messages.welcome")).toBeNull();
    expect(harness.searchText).not.toHaveBeenCalled();
    expect(harness.readFileContent).not.toHaveBeenCalled();
    expect(harness.readWorkspaceDirectory).not.toHaveBeenCalled();

    harness.unmount();
  });
});

describe("useLaravelTargets", () => {
  it("collects named route targets 1:1 with the domain parser", async () => {
    const source =
      "<?php\nRoute::get('/comments')->name('comments.definition');\n";
    const currentPath = `${ROOT}/routes/web.php`;
    const harness = renderLaravelTargets();

    const targets = await harness
      .hook()
      .collectPhpLaravelNamedRouteTargets(source, currentPath);

    const expected = phpFrameworkRouteDefinitionsFromSource(source, PROVIDERS)
      .map((definition) => ({
        ...definition,
        path: currentPath,
        relativePath: "routes/web.php",
      }))
      .sort((left, right) => {
        const nameOrder = left.name.localeCompare(right.name);
        if (nameOrder !== 0) {
          return nameOrder;
        }
        return left.path.localeCompare(right.path);
      });

    expect(expected.length).toBeGreaterThan(0);
    expect(targets).toEqual(expected);
    // Route search anchors are wired through the provider.
    expect(harness.searchText).toHaveBeenCalledWith(ROOT, "->name(", 200);

    harness.unmount();
  });

  it("collects gate ability targets 1:1 and searches Gate::define", async () => {
    const source = `<?php\n\nGate::define('update-post', [PostPolicy::class, 'update']);\nGate::define('delete-post', fn ($user) => $user->isAdmin());\n`;
    const currentPath = `${ROOT}/app/Providers/AuthServiceProvider.php`;
    const harness = renderLaravelTargets();

    const targets = await harness
      .hook()
      .collectPhpLaravelGateAbilityTargets(source, currentPath);

    const expected = phpLaravelGateAbilityDefinitions(source)
      .map((definition) => ({
        ...definition,
        path: currentPath,
        relativePath: relativeWorkspacePath(ROOT, currentPath),
      }))
      .sort((left, right) => {
        const nameOrder = left.name.localeCompare(right.name);
        if (nameOrder !== 0) {
          return nameOrder;
        }
        return left.path.localeCompare(right.path);
      });

    expect(expected.length).toBeGreaterThan(0);
    expect(targets).toEqual(expected);
    expect(harness.searchText).toHaveBeenCalledWith(ROOT, "Gate::define", 200);

    harness.unmount();
  });

  it("collects middleware alias targets 1:1 and searches both anchors", async () => {
    const source = `<?php\n\nclass Kernel {\n    protected $middlewareAliases = [\n        'auth' => Authenticate::class,\n        'verified' => EnsureEmailIsVerified::class,\n    ];\n}\n`;
    const currentPath = `${ROOT}/app/Http/Kernel.php`;
    const harness = renderLaravelTargets();

    const targets = await harness
      .hook()
      .collectPhpLaravelMiddlewareAliasTargets(source, currentPath);

    const expected = phpLaravelMiddlewareAliasDefinitions(source)
      .map((definition) => ({
        ...definition,
        path: currentPath,
        relativePath: relativeWorkspacePath(ROOT, currentPath),
      }))
      .sort((left, right) => {
        const nameOrder = left.name.localeCompare(right.name);
        if (nameOrder !== 0) {
          return nameOrder;
        }
        return left.path.localeCompare(right.path);
      });

    expect(expected.length).toBeGreaterThan(0);
    expect(targets).toEqual(expected);
    expect(harness.searchText).toHaveBeenCalledWith(ROOT, "middlewareAliases", 200);
    expect(harness.searchText).toHaveBeenCalledWith(ROOT, "routeMiddleware", 200);

    harness.unmount();
  });

  it("collects env targets from the first readable dotenv file", async () => {
    const envSource = `APP_NAME=Codevo\nAPP_ENV=local\nexport QUEUE_CONNECTION=sync\n`;
    const readFileContent = vi.fn(async (path: string) => {
      if (path === `${ROOT}/.env`) {
        return envSource;
      }
      throw new Error("no such file");
    });
    const harness = renderLaravelTargets({
      readNavigationFileContent: readFileContent as never,
    });

    const targets = await harness.hook().collectPhpLaravelEnvTargets();

    const expected = phpLaravelEnvEntriesFromSource(envSource).map((entry) => ({
      ...entry,
      path: `${ROOT}/.env`,
      relativePath: ".env",
    }));

    expect(expected.length).toBeGreaterThan(0);
    expect(targets).toEqual(expected);
    expect(readFileContent).toHaveBeenCalledTimes(1);
    expect(readFileContent).toHaveBeenCalledWith(`${ROOT}/.env`);

    harness.unmount();
  });

  it("returns empty collectors when Laravel is inactive", async () => {
    const harness = renderLaravelTargets({ isLaravelFrameworkActive: false });

    expect(
      await harness
        .hook()
        .collectPhpLaravelNamedRouteTargets(
          "<?php Route::get('/x')->name('x');",
          `${ROOT}/routes/web.php`,
        ),
    ).toEqual([]);
    expect(
      await harness
        .hook()
        .collectPhpLaravelGateAbilityTargets("<?php Gate::define('x', fn () => true);", `${ROOT}/a.php`),
    ).toEqual([]);
    expect(await harness.hook().collectPhpLaravelEnvTargets()).toEqual([]);
    expect(harness.searchText).not.toHaveBeenCalled();

    harness.unmount();
  });

  it("drops a collection whose workspace root changed mid-flight", async () => {
    const deferred = createDeferred<TextSearchResult[]>();
    const searchText = vi.fn(() => deferred.promise);
    const harness = renderLaravelTargets({
      textSearch: { searchText } as never,
    });

    const pending = harness
      .hook()
      .collectPhpLaravelGateAbilityTargets(
        "<?php Gate::define('leaked', fn () => true);",
        `${ROOT}/a.php`,
      );

    harness.ref.current = "/other";
    deferred.resolve([]);

    expect(await pending).toEqual([]);

    harness.unmount();
  });

  it("collects view targets by recursively scanning resources/views without reading files", async () => {
    const viewsRoot = `${ROOT}/resources/views`;
    const commentsDir = `${viewsRoot}/comments`;
    const readWorkspaceDirectory = vi.fn(async (path: string) => {
      if (path === viewsRoot) {
        return [directoryEntry(commentsDir), fileEntry(`${viewsRoot}/welcome.blade.php`)];
      }
      if (path === commentsDir) {
        return [
          fileEntry(`${commentsDir}/show.blade.php`),
          fileEntry(`${commentsDir}/notes.txt`),
        ];
      }
      return [];
    });
    const readFileContent = vi.fn(async () => "");
    const harness = renderLaravelTargets({
      readWorkspaceDirectory: readWorkspaceDirectory as never,
      readNavigationFileContent: readFileContent as never,
    });

    const targets = await harness.hook().collectPhpLaravelViewTargets();

    expect(readFileContent).not.toHaveBeenCalled();
    expect(targets).toEqual(
      [
        {
          name: phpLaravelViewNameFromRelativePath("resources/views/comments/show.blade.php"),
          path: `${commentsDir}/show.blade.php`,
          relativePath: "resources/views/comments/show.blade.php",
        },
        {
          name: phpLaravelViewNameFromRelativePath("resources/views/welcome.blade.php"),
          path: `${viewsRoot}/welcome.blade.php`,
          relativePath: "resources/views/welcome.blade.php",
        },
      ].sort((left, right) => left.name!.localeCompare(right.name!)),
    );

    harness.unmount();
  });

  it("memoizes view targets and rescans after cache invalidation", async () => {
    const viewsRoot = `${ROOT}/resources/views`;
    const readWorkspaceDirectory = vi.fn(async (path: string) =>
      path === viewsRoot ? [fileEntry(`${viewsRoot}/home.blade.php`)] : [],
    );
    const harness = renderLaravelTargets({
      readWorkspaceDirectory: readWorkspaceDirectory as never,
    });

    await harness.hook().collectPhpLaravelViewTargets();
    const scansAfterFirst = readWorkspaceDirectory.mock.calls.length;
    expect(scansAfterFirst).toBeGreaterThan(0);

    // Cache hit: no additional directory scans.
    await harness.hook().collectPhpLaravelViewTargets();
    expect(readWorkspaceDirectory.mock.calls.length).toBe(scansAfterFirst);

    // Invalidate: the next call rescans.
    harness.hook().invalidatePhpLaravelTargetCache();
    await harness.hook().collectPhpLaravelViewTargets();
    expect(readWorkspaceDirectory.mock.calls.length).toBeGreaterThan(scansAfterFirst);

    harness.unmount();
  });

  it("collects config targets with a file-level target that survives read failures", async () => {
    const configRoot = `${ROOT}/config`;
    const appSource = `<?php\n\nreturn [\n    'name' => 'Codevo',\n];\n`;
    const readWorkspaceDirectory = vi.fn(async (path: string) =>
      path === configRoot
        ? [
            fileEntry(`${configRoot}/app.php`),
            fileEntry(`${configRoot}/broken.php`),
            fileEntry(`${configRoot}/ignored.txt`),
          ]
        : [],
    );
    const readFileContent = vi.fn(async (path: string) => {
      if (path === `${configRoot}/app.php`) {
        return appSource;
      }
      throw new Error("read failed");
    });
    const harness = renderLaravelTargets({
      readWorkspaceDirectory: readWorkspaceDirectory as never,
      readNavigationFileContent: readFileContent as never,
    });

    const targets = await harness.hook().collectPhpLaravelConfigTargets();
    const keys = targets.map((target) => target.key);

    // The `.txt` file is never read.
    expect(readFileContent).not.toHaveBeenCalledWith(`${configRoot}/ignored.txt`);
    // File-level targets for both php files (broken.php survives its read failure).
    expect(keys).toContain("app");
    expect(keys).toContain("broken");
    // Content-derived keys from app.php match the domain parser.
    for (const target of phpFrameworkConfigKeysFromSource(appSource, "app", PROVIDERS)) {
      expect(keys).toContain(target.key);
    }
    // Sorted by key.
    expect(keys).toEqual([...keys].sort((left, right) => left.localeCompare(right)));

    harness.unmount();
  });

  it("collects translation targets from php locale files then json, php winning duplicates", async () => {
    const langRoot = `${ROOT}/lang`;
    const enDir = `${langRoot}/en`;
    const phpSource = `<?php\n\nreturn [\n    'welcome' => 'Welcome home',\n];\n`;
    const jsonSource = `{\n    "welcome": "Welcome json",\n    "Goodbye": "See you"\n}\n`;
    const readWorkspaceDirectory = vi.fn(async (path: string) => {
      if (path === langRoot) {
        return [directoryEntry(enDir), fileEntry(`${langRoot}/en.json`)];
      }
      if (path === `${ROOT}/resources/lang`) {
        return [];
      }
      if (path === enDir) {
        return [fileEntry(`${enDir}/messages.php`)];
      }
      return [];
    });
    const readFileContent = vi.fn(async (path: string) => {
      if (path === `${enDir}/messages.php`) {
        return phpSource;
      }
      if (path === `${langRoot}/en.json`) {
        return jsonSource;
      }
      throw new Error(`unexpected read ${path}`);
    });
    const harness = renderLaravelTargets({
      readWorkspaceDirectory: readWorkspaceDirectory as never,
      readNavigationFileContent: readFileContent as never,
    });

    const targets = await harness.hook().collectPhpLaravelTranslationTargets();
    const byKey = new Map(targets.map((target) => [target.key, target]));

    const phpKeys = phpFrameworkTranslationKeysFromSource(phpSource, "messages", PROVIDERS);
    const jsonKeys = phpFrameworkJsonTranslationKeysFromSource(jsonSource, PROVIDERS);
    expect(phpKeys.length).toBeGreaterThan(0);
    expect(jsonKeys.length).toBeGreaterThan(0);

    // The php-file translation key wins the duplicate over the json one.
    expect(byKey.get("messages.welcome")?.path).toBe(`${enDir}/messages.php`);
    // A json-only key is still collected.
    expect(byKey.get("Goodbye")?.path).toBe(`${langRoot}/en.json`);
    // Sorted by key.
    const keys = targets.map((target) => target.key);
    expect(keys).toEqual([...keys].sort((left, right) => left.localeCompare(right)));

    harness.unmount();
  });

  it("finds a view target by probing candidate blade paths", async () => {
    const readFileContent = vi.fn(async (path: string) => {
      if (path === `${ROOT}/resources/views/comments/show.blade.php`) {
        return "<div>show</div>";
      }
      throw new Error("missing");
    });
    const harness = renderLaravelTargets({
      readNavigationFileContent: readFileContent as never,
    });

    const target = await harness.hook().findPhpLaravelViewTarget("comments.show");

    expect(target).toEqual({
      name: "comments.show",
      path: `${ROOT}/resources/views/comments/show.blade.php`,
      position: { column: 1, lineNumber: 1 },
      relativePath: "resources/views/comments/show.blade.php",
    });

    harness.unmount();
  });

  it("finds a config target by reading the config file for the key", async () => {
    const appSource = `<?php\n\nreturn [\n    'name' => 'Codevo',\n];\n`;
    const readFileContent = vi.fn(async (path: string) =>
      path === `${ROOT}/config/app.php` ? appSource : Promise.reject(new Error("missing")),
    );
    const harness = renderLaravelTargets({
      readNavigationFileContent: readFileContent as never,
    });

    const target = await harness.hook().findPhpLaravelConfigTarget("app.name");

    expect(target?.key).toBe("app.name");
    expect(target?.path).toBe(`${ROOT}/config/app.php`);
    expect(target?.relativePath).toBe("config/app.php");

    harness.unmount();
  });

  it("returns empty directory-scan collectors when Laravel is inactive", async () => {
    const readWorkspaceDirectory = vi.fn(async () => [] as FileEntry[]);
    const harness = renderLaravelTargets({
      isLaravelFrameworkActive: false,
      activePhpFrameworkProviders: [],
      readWorkspaceDirectory: readWorkspaceDirectory as never,
    });

    expect(await harness.hook().collectPhpLaravelViewTargets()).toEqual([]);
    expect(await harness.hook().collectPhpLaravelConfigTargets()).toEqual([]);
    expect(await harness.hook().collectPhpLaravelTranslationTargets()).toEqual([]);
    expect(await harness.hook().findPhpLaravelViewTarget("a.b")).toBeNull();
    expect(await harness.hook().findPhpLaravelConfigTarget("a.b")).toBeNull();
    expect(await harness.hook().findPhpLaravelTranslationTarget("a.b")).toBeNull();
    // Config-derived collectors (auth guards, database connections, ...) are
    // all built on collectPhpLaravelConfigTargets/findPhpLaravelConfigTarget,
    // so an inactive Laravel framework must starve every one of them too.
    expect(await harness.hook().collectPhpLaravelAuthGuardTargets()).toEqual([]);
    expect(await harness.hook().collectPhpLaravelDatabaseConnectionTargets()).toEqual(
      [],
    );
    expect(await harness.hook().collectPhpLaravelStorageDiskTargets()).toEqual([]);
    expect(await harness.hook().findPhpLaravelAuthGuardTarget("web")).toBeNull();
    expect(
      await harness.hook().findPhpLaravelDatabaseConnectionTarget("mysql"),
    ).toBeNull();
    expect(await harness.hook().findPhpLaravelStorageDiskTarget("local")).toBeNull();
    expect(readWorkspaceDirectory).not.toHaveBeenCalled();

    harness.unmount();
  });

  describe("config-derived collectors", () => {
    const configRoot = `${ROOT}/config`;
    const authSource = `<?php\n\nreturn [\n    'defaults' => [\n        'guard' => 'web',\n    ],\n    'guards' => [\n        'web' => [\n            'driver' => 'session',\n            'provider' => 'users',\n        ],\n        'api' => [\n            'driver' => 'token',\n            'provider' => 'users',\n        ],\n    ],\n];\n`;
    const databaseSource = `<?php\n\nreturn [\n    'default' => 'mysql',\n    'connections' => [\n        'sqlite' => [\n            'driver' => 'sqlite',\n        ],\n        'mysql' => [\n            'driver' => 'mysql',\n        ],\n    ],\n];\n`;
    const filesystemsSource = `<?php\n\nreturn [\n    'default' => 'local',\n    'disks' => [\n        'local' => [\n            'driver' => 'local',\n        ],\n        's3' => [\n            'driver' => 's3',\n        ],\n    ],\n];\n`;

    function renderConfigDerivedHarness(): Harness {
      const readWorkspaceDirectory = vi.fn(async (path: string) =>
        path === configRoot
          ? [
              fileEntry(`${configRoot}/auth.php`),
              fileEntry(`${configRoot}/database.php`),
              fileEntry(`${configRoot}/filesystems.php`),
            ]
          : [],
      );
      const readFileContent = vi.fn(async (path: string) => {
        if (path === `${configRoot}/auth.php`) {
          return authSource;
        }
        if (path === `${configRoot}/database.php`) {
          return databaseSource;
        }
        if (path === `${configRoot}/filesystems.php`) {
          return filesystemsSource;
        }
        throw new Error(`unexpected read ${path}`);
      });

      return renderLaravelTargets({
        readWorkspaceDirectory: readWorkspaceDirectory as never,
        readNavigationFileContent: readFileContent as never,
      });
    }

    it("collects auth guard targets 1:1 from config targets, filtered and sorted by guard name", async () => {
      const harness = renderConfigDerivedHarness();

      const targets = await harness.hook().collectPhpLaravelAuthGuardTargets();

      // Only the two leaf `auth.guards.*` keys become guard targets; deeper
      // keys like `auth.guards.web.driver` are filtered out because the
      // remainder after the `auth.guards.` prefix still contains a dot.
      expect(targets.map((target) => target.guardName)).toEqual(["api", "web"]);
      expect(targets.every((target) => target.relativePath === "config/auth.php")).toBe(
        true,
      );
      expect(targets.every((target) => target.key.startsWith("auth.guards."))).toBe(
        true,
      );

      harness.unmount();
    });

    it("collects database connection targets sharing the connectionName property, filtered and sorted", async () => {
      const harness = renderConfigDerivedHarness();

      const targets = await harness
        .hook()
        .collectPhpLaravelDatabaseConnectionTargets();

      expect(targets.map((target) => target.connectionName)).toEqual([
        "mysql",
        "sqlite",
      ]);
      expect(
        targets.every((target) => target.relativePath === "config/database.php"),
      ).toBe(true);

      harness.unmount();
    });

    it("collects storage disk targets 1:1, filtered and sorted by disk name", async () => {
      const harness = renderConfigDerivedHarness();

      const targets = await harness.hook().collectPhpLaravelStorageDiskTargets();

      expect(targets.map((target) => target.diskName)).toEqual(["local", "s3"]);
      expect(
        targets.every((target) => target.relativePath === "config/filesystems.php"),
      ).toBe(true);

      harness.unmount();
    });

    it("finds an auth guard target by name via the underlying config target", async () => {
      const harness = renderConfigDerivedHarness();

      const target = await harness.hook().findPhpLaravelAuthGuardTarget("web");

      expect(target?.guardName).toBe("web");
      expect(target?.key).toBe(phpLaravelAuthGuardConfigKey("web"));
      expect(target?.path).toBe(`${configRoot}/auth.php`);
      expect(target?.relativePath).toBe("config/auth.php");

      harness.unmount();
    });

    it("finds a database connection target by name via the underlying config target", async () => {
      const harness = renderConfigDerivedHarness();

      const target = await harness
        .hook()
        .findPhpLaravelDatabaseConnectionTarget("sqlite");

      expect(target?.connectionName).toBe("sqlite");
      expect(target?.key).toBe(phpLaravelDatabaseConnectionConfigKey("sqlite"));
      expect(target?.path).toBe(`${configRoot}/database.php`);

      harness.unmount();
    });

    it("returns null from find when the name is not a usable config key", async () => {
      const harness = renderConfigDerivedHarness();

      // A space is not a usable auth guard name, so no config file is ever read.
      expect(await harness.hook().findPhpLaravelAuthGuardTarget("web guard")).toBeNull();
      expect(phpLaravelStorageDiskConfigKey("local disk")).toBeNull();
      expect(harness.readFileContent).not.toHaveBeenCalled();

      harness.unmount();
    });

    it("returns null from find when the config key has no matching target", async () => {
      const harness = renderConfigDerivedHarness();

      const target = await harness
        .hook()
        .findPhpLaravelStorageDiskTarget("does-not-exist");

      expect(target).toBeNull();

      harness.unmount();
    });
  });
});
