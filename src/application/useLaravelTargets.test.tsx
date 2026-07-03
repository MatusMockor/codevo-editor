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
  phpFrameworkRouteDefinitionsFromSource,
  phpLaravelFrameworkProvider,
} from "../domain/phpFrameworkProviders";
import { phpLaravelGateAbilityDefinitions } from "../domain/phpLaravelAuthorization";
import { phpLaravelMiddlewareAliasDefinitions } from "../domain/phpLaravelMiddleware";
import { phpLaravelEnvEntriesFromSource } from "../domain/phpLaravelEnv";
import type { TextSearchResult } from "../domain/workspace";

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

  const deps: LaravelTargetsDependencies = {
    currentWorkspaceRootRef: ref,
    workspaceRoot: ROOT,
    textSearch: { searchText } as never,
    readNavigationFileContent: readFileContent as never,
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
    unmount: () => {
      act(() => {
        root.unmount();
      });
    },
  };
}

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
});
