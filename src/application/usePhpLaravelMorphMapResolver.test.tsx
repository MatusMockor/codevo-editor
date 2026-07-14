// @vitest-environment jsdom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";
import { phpLaravelFrameworkProvider } from "../domain/phpFrameworkProviders";
import type { TextSearchResult, WorkspaceDescriptor } from "../domain/workspace";
import { createPhpFrameworkIntelligence } from "./phpFrameworkIntelligence";
import { createPhpFrameworkRuntimeContext } from "./phpFrameworkRuntimeContext";
import {
  usePhpLaravelMorphMapResolver,
  type UsePhpLaravelMorphMapResolverOptions,
} from "./usePhpLaravelMorphMapResolver";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

const ROOT = "/workspace";
const LARAVEL_RUNTIME = createPhpFrameworkRuntimeContext(
  createPhpFrameworkIntelligence({
    matchedProviderIds: ["laravel"],
    profile: "laravel",
    providers: [phpLaravelFrameworkProvider],
  }),
);

type HookApi = ReturnType<typeof usePhpLaravelMorphMapResolver>;
type HookOptions = UsePhpLaravelMorphMapResolverOptions;

function phpDescriptor(rootPath = ROOT): WorkspaceDescriptor {
  return {
    javaScriptTypeScript: null,
    php: {
      classmapRoots: [],
      hasComposer: true,
      packageName: null,
      packages: [],
      phpPlatformVersion: null,
      phpVersionConstraint: null,
      psr4Roots: [],
    },
    rootPath,
  };
}

function textSearchResult(path: string, lineText: string): TextSearchResult {
  return {
    column: 19,
    lineNumber: 10,
    lineText,
    path,
    relativePath: path.replace(`${ROOT}/`, ""),
  };
}

function makeOptions(): HookOptions {
  return {
    currentWorkspaceRootRef: { current: ROOT },
    frameworkRuntime: LARAVEL_RUNTIME,
    readNavigationFileContent: vi.fn(async () => `<?php
use Illuminate\\Database\\Eloquent\\Relations\\Relation;

Relation::morphMap([
    'owner' => \\App\\Models\\User::class,
]);
`),
    textSearch: {
      searchText: vi.fn(async (_root: string, query: string) =>
        query === "morphMap"
          ? [
              textSearchResult(
                `${ROOT}/app/Providers/AppServiceProvider.php`,
                "Relation::morphMap([",
              ),
            ]
          : [],
      ),
    },
    workspaceDescriptor: phpDescriptor(),
    workspaceRoot: ROOT,
  };
}

function renderHook(options: HookOptions) {
  const container = document.createElement("div");
  const root = createRoot(container);
  const captured: { api: HookApi | null } = { api: null };

  function Harness({ hookOptions }: { hookOptions: HookOptions }) {
    captured.api = usePhpLaravelMorphMapResolver(hookOptions);
    return null;
  }

  act(() => {
    root.render(<Harness hookOptions={options} />);
  });

  return {
    api: () => {
      if (!captured.api) {
        throw new Error("hook not mounted");
      }

      return captured.api;
    },
    unmount: () => {
      act(() => {
        root.unmount();
      });
    },
  };
}

describe("usePhpLaravelMorphMapResolver", () => {
  it("keeps Laravel-named compatibility methods backed by the framework resolver", async () => {
    const options = makeOptions();
    const harness = renderHook(options);

    await expect(
      harness.api().resolvePhpLaravelProjectMorphMapModelType(),
    ).resolves.toBe("App\\Models\\User");
    await expect(
      harness.api().resolvePhpLaravelProjectMorphMapModelType(),
    ).resolves.toBe("App\\Models\\User");

    expect(options.textSearch.searchText).toHaveBeenCalledTimes(2);

    harness.api().resetPhpLaravelMorphMapModelTypeCache();

    await expect(
      harness.api().resolvePhpLaravelProjectMorphMapModelType(),
    ).resolves.toBe("App\\Models\\User");

    expect(options.textSearch.searchText).toHaveBeenCalledTimes(4);

    harness.unmount();
  });
});
