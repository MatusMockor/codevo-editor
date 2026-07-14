// @vitest-environment jsdom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";
import {
  phpLaravelFrameworkProvider,
  phpNetteFrameworkProvider,
} from "../domain/phpFrameworkProviders";
import type { TextSearchResult, WorkspaceDescriptor } from "../domain/workspace";
import { createPhpFrameworkIntelligence } from "./phpFrameworkIntelligence";
import { createPhpFrameworkRuntimeContext } from "./phpFrameworkRuntimeContext";
import {
  usePhpLaravelMorphMapResolver,
  type UsePhpLaravelMorphMapResolverOptions,
} from "./usePhpLaravelMorphMapResolver";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

const ROOT = "/workspace";
const GENERIC_RUNTIME = createPhpFrameworkRuntimeContext(
  createPhpFrameworkIntelligence({
    matchedProviderIds: [],
    profile: "generic",
    providers: [],
  }),
);
const LARAVEL_RUNTIME = createPhpFrameworkRuntimeContext(
  createPhpFrameworkIntelligence({
    matchedProviderIds: ["laravel"],
    profile: "laravel",
    providers: [phpLaravelFrameworkProvider],
  }),
);
const LARAVEL_WITH_NETTE_RUNTIME = createPhpFrameworkRuntimeContext(
  createPhpFrameworkIntelligence({
    matchedProviderIds: ["laravel", "nette"],
    profile: "laravel",
    providers: [phpLaravelFrameworkProvider, phpNetteFrameworkProvider],
  }),
);
const STALE_LEGACY_LARAVEL_RUNTIME = {
  ...LARAVEL_RUNTIME,
  providers: [],
  hasProvider: () => false,
  isLaravel: true,
};

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

function morphMapSource(modelClassName: string): string {
  return `<?php
use Illuminate\\Database\\Eloquent\\Relations\\Relation;

Relation::morphMap([
    'owner' => ${modelClassName}::class,
]);
`;
}

function makeOptions(overrides: Partial<HookOptions> = {}): HookOptions {
  return {
    currentWorkspaceRootRef: { current: ROOT },
    frameworkRuntime: LARAVEL_RUNTIME,
    readNavigationFileContent: vi.fn(async () =>
      morphMapSource("\\App\\Models\\User"),
    ),
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
    ...overrides,
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

  const render = (hookOptions: HookOptions) => {
    act(() => {
      root.render(<Harness hookOptions={hookOptions} />);
    });
  };

  render(options);

  return {
    api: () => {
      if (!captured.api) {
        throw new Error("hook not mounted");
      }

      return captured.api;
    },
    rerender: render,
    unmount: () => {
      act(() => {
        root.unmount();
      });
    },
  };
}

function createDeferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolver) => {
    resolve = resolver;
  });

  return { promise, resolve };
}

describe("usePhpLaravelMorphMapResolver", () => {
  it("caches morph map model type results per provider signature", async () => {
    const options = makeOptions();
    const harness = renderHook(options);

    await expect(
      harness.api().resolvePhpLaravelProjectMorphMapModelType(),
    ).resolves.toBe("App\\Models\\User");
    await expect(
      harness.api().resolvePhpLaravelProjectMorphMapModelType(),
    ).resolves.toBe("App\\Models\\User");

    expect(options.textSearch.searchText).toHaveBeenCalledTimes(2);
    expect(options.readNavigationFileContent).toHaveBeenCalledTimes(1);

    harness.rerender({
      ...options,
      frameworkRuntime: LARAVEL_WITH_NETTE_RUNTIME,
    });

    await expect(
      harness.api().resolvePhpLaravelProjectMorphMapModelType(),
    ).resolves.toBe("App\\Models\\User");

    expect(options.textSearch.searchText).toHaveBeenCalledTimes(4);
    expect(options.readNavigationFileContent).toHaveBeenCalledTimes(2);

    harness.unmount();
  });

  it("drops stale morph map results when the active root changes mid-search", async () => {
    const morphMapSearch = createDeferred<TextSearchResult[]>();
    const currentWorkspaceRootRef = { current: ROOT };
    const readNavigationFileContent = vi.fn(async () =>
      morphMapSource("\\App\\Models\\User"),
    );
    const options = makeOptions({
      currentWorkspaceRootRef,
      readNavigationFileContent,
      textSearch: {
        searchText: vi.fn(async (_root: string, query: string) =>
          query === "morphMap" ? morphMapSearch.promise : [],
        ),
      },
    });
    const harness = renderHook(options);
    const modelType = harness.api().resolvePhpLaravelProjectMorphMapModelType();

    await vi.waitFor(() => {
      expect(options.textSearch.searchText).toHaveBeenCalledWith(
        ROOT,
        "morphMap",
        200,
      );
    });

    currentWorkspaceRootRef.current = "/other-workspace";
    morphMapSearch.resolve([
      textSearchResult(
        `${ROOT}/app/Providers/AppServiceProvider.php`,
        "Relation::morphMap([",
      ),
    ]);

    await expect(modelType).resolves.toBeNull();
    expect(readNavigationFileContent).not.toHaveBeenCalled();

    harness.unmount();
  });

  it("uses runtime Laravel state for the Laravel gate", async () => {
    const textSearch = {
      searchText: vi.fn(async () => [] as TextSearchResult[]),
    };
    const options = makeOptions({
      frameworkRuntime: GENERIC_RUNTIME,
      textSearch,
    });
    const harness = renderHook(options);

    await expect(
      harness.api().resolvePhpLaravelProjectMorphMapModelType(),
    ).resolves.toBeNull();

    expect(textSearch.searchText).not.toHaveBeenCalled();

    harness.unmount();
  });

  it("does not search morph maps for stale legacy Laravel state without a Laravel provider", async () => {
    const textSearch = {
      searchText: vi.fn(async () => [] as TextSearchResult[]),
    };
    const options = makeOptions({
      frameworkRuntime: STALE_LEGACY_LARAVEL_RUNTIME,
      textSearch,
    });
    const harness = renderHook(options);

    await expect(
      harness.api().resolvePhpLaravelProjectMorphMapModelType(),
    ).resolves.toBeNull();

    expect(textSearch.searchText).not.toHaveBeenCalled();

    harness.unmount();
  });

  it("returns a unique model result while skipping duplicate, non-PHP, and unreadable matches", async () => {
    const providerPath = `${ROOT}/app/Providers/AppServiceProvider.php`;
    const duplicateProviderPath = `${ROOT}/app/Providers/AuthServiceProvider.php`;
    const readFailurePath = `${ROOT}/app/Providers/BrokenServiceProvider.php`;
    const options = makeOptions({
      readNavigationFileContent: vi.fn(async (path: string) => {
        if (path === readFailurePath) {
          throw new Error("cannot read file");
        }

        return morphMapSource("\\App\\Models\\User");
      }),
      textSearch: {
        searchText: vi.fn(async (_root: string, query: string) =>
          query === "morphMap"
            ? [
                textSearchResult(providerPath, "Relation::morphMap(["),
                textSearchResult(providerPath, "Relation::morphMap(["),
                textSearchResult(duplicateProviderPath, "Relation::morphMap(["),
                textSearchResult(readFailurePath, "Relation::morphMap(["),
                textSearchResult(`${ROOT}/README.md`, "Relation::morphMap(["),
              ]
            : [],
        ),
      },
    });
    const harness = renderHook(options);

    await expect(
      harness.api().resolvePhpLaravelProjectMorphMapModelType(),
    ).resolves.toBe("App\\Models\\User");

    expect(options.readNavigationFileContent).toHaveBeenCalledTimes(3);
    expect(options.readNavigationFileContent).not.toHaveBeenCalledWith(
      `${ROOT}/README.md`,
    );

    harness.unmount();
  });
});
