import { phpLaravelFrameworkProvider } from "../domain/phpFrameworkLaravelProvider";
import { phpNetteFrameworkProvider } from "../domain/phpFrameworkNetteProvider";
// @vitest-environment jsdom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";
import {
  phpFrameworkRouteDefinitionsFromSource,
} from "../domain/phpFrameworkProviders";
import type { FileEntry, TextSearchResult } from "../domain/workspace";
import { createPhpFrameworkIntelligence } from "./phpFrameworkIntelligence";
import {
  usePhpFrameworkTargets,
  type PhpFrameworkTargets,
  type PhpFrameworkTargetsDependencies,
} from "./usePhpFrameworkTargets";

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

interface FrameworkHarness {
  hook: () => PhpFrameworkTargets;
  searchText: ReturnType<typeof vi.fn>;
  readFileContent: ReturnType<typeof vi.fn>;
  readWorkspaceDirectory: ReturnType<typeof vi.fn>;
  rerender: (overrides?: Partial<PhpFrameworkTargetsDependencies>) => void;
  unmount: () => void;
}

function fileEntry(path: string): FileEntry {
  const name = path.slice(path.lastIndexOf("/") + 1);

  return { name, path, kind: "file" };
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

  let deps: PhpFrameworkTargetsDependencies = {
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

  const render = () => {
    act(() => {
      root.render(<HarnessComponent />);
    });
  };

  render();

  return {
    hook: () => {
      if (!captured.hook) {
        throw new Error("hook not mounted");
      }

      return captured.hook;
    },
    searchText,
    readFileContent,
    readWorkspaceDirectory,
    rerender: (nextOverrides = {}) => {
      deps = {
        ...deps,
        ...nextOverrides,
      };
      render();
    },
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
    expect("findNetteAjaxSnippetTarget" in harness.hook()).toBe(false);
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
    expect(await harness.hook().findEnvironmentTarget("APP_URL")).toBeNull();
    expect(await harness.hook().findViewTarget("comments.show")).toBeNull();
    expect(await harness.hook().findConfigTarget("app.name")).toBeNull();
    expect(await harness.hook().findTranslationTarget("messages.welcome")).toBeNull();
    expect("findNetteAjaxSnippetTarget" in harness.hook()).toBe(false);
    expect(harness.searchText).not.toHaveBeenCalled();
    expect(harness.readFileContent).not.toHaveBeenCalled();
    expect(harness.readWorkspaceDirectory).not.toHaveBeenCalled();

    harness.unmount();
  });

  it("invalidates mounted Laravel target caches while the generic provider is active", async () => {
    let viewFiles = [fileEntry(`${ROOT}/resources/views/stale.blade.php`)];
    const readWorkspaceDirectory = vi.fn(async (path: string) => {
      if (path === `${ROOT}/resources/views`) {
        return viewFiles;
      }

      return [];
    });
    const harness = renderPhpFrameworkTargets({
      readWorkspaceDirectory: readWorkspaceDirectory as never,
    });

    await expect(harness.hook().collectViewTargets()).resolves.toEqual([
      {
        name: "stale",
        path: `${ROOT}/resources/views/stale.blade.php`,
        relativePath: "resources/views/stale.blade.php",
      },
    ]);

    viewFiles = [fileEntry(`${ROOT}/resources/views/fresh.blade.php`)];
    harness.rerender({
      frameworkIntelligence: GENERIC_FRAMEWORK_INTELLIGENCE,
    });
    harness.hook().invalidateTargetCache();
    harness.rerender({
      frameworkIntelligence: LARAVEL_FRAMEWORK_INTELLIGENCE,
    });

    await expect(harness.hook().collectViewTargets()).resolves.toEqual([
      {
        name: "fresh",
        path: `${ROOT}/resources/views/fresh.blade.php`,
        relativePath: "resources/views/fresh.blade.php",
      },
    ]);
    expect(readWorkspaceDirectory).toHaveBeenCalledTimes(2);

    harness.unmount();
  });

  it("keeps unrelated targets inert for the Nette provider", async () => {
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
    expect(await harness.hook().findEnvironmentTarget("APP_URL")).toBeNull();
    expect(await harness.hook().findViewTarget("comments.show")).toBeNull();
    expect(await harness.hook().findConfigTarget("app.name")).toBeNull();
    expect(harness.searchText).not.toHaveBeenCalled();
    expect(harness.readFileContent).not.toHaveBeenCalled();
    expect(harness.readWorkspaceDirectory).not.toHaveBeenCalled();

    harness.unmount();
  });

  it("delegates env target lookup to the active Laravel adapter", async () => {
    const readFileContent = vi.fn(async (path: string) => {
      if (path === `${ROOT}/.env`) {
        return "APP_NAME=Editor\n";
      }

      if (path === `${ROOT}/.env.example`) {
        return "APP_URL=https://example.test\n";
      }

      throw new Error(`Unexpected read: ${path}`);
    });
    const harness = renderPhpFrameworkTargets({
      readNavigationFileContent: readFileContent as never,
    });

    await expect(harness.hook().findEnvironmentTarget("APP_URL")).resolves.toEqual({
      name: "APP_URL",
      path: `${ROOT}/.env.example`,
      position: { column: 1, lineNumber: 1 },
      relativePath: ".env.example",
    });
    expect(readFileContent).toHaveBeenNthCalledWith(1, `${ROOT}/.env`);
    expect(readFileContent).toHaveBeenNthCalledWith(2, `${ROOT}/.env.example`);

    harness.unmount();
  });
});
