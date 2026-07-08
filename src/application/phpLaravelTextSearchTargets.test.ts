import { describe, expect, it, vi } from "vitest";
import {
  phpFrameworkRouteDefinitionsFromSource,
  phpLaravelFrameworkProvider,
} from "../domain/phpFrameworkProviders";
import { phpLaravelGateAbilityDefinitions } from "../domain/phpLaravelAuthorization";
import { phpLaravelMiddlewareAliasDefinitions } from "../domain/phpLaravelMiddleware";
import type { FileEntry, TextSearchResult } from "../domain/workspace";
import {
  createPhpLaravelTextSearchTargetCollectors,
  type PhpLaravelTextSearchTargetCollectorDeps,
} from "./phpLaravelTextSearchTargets";
import type { WorkspaceTargetCollectorDeps } from "./phpWorkspaceTargetCollector";

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

function searchResult(path: string): TextSearchResult {
  return {
    path,
    relativePath: relativeWorkspacePath(ROOT, path),
    lineNumber: 1,
    column: 1,
    lineText: "",
  };
}

function createDeps(
  overrides: Partial<PhpLaravelTextSearchTargetCollectorDeps> & {
    readFileContent?: WorkspaceTargetCollectorDeps["readFileContent"];
    searchText?: WorkspaceTargetCollectorDeps["textSearch"]["searchText"];
  } = {},
): {
  collectors: ReturnType<typeof createPhpLaravelTextSearchTargetCollectors>;
  ref: { current: string | null };
  readFileContent: ReturnType<typeof vi.fn>;
  searchText: ReturnType<typeof vi.fn>;
} {
  const ref: { current: string | null } = { current: ROOT };
  const searchText = vi.fn(
    overrides.searchText ?? (async () => [] as TextSearchResult[]),
  );
  const readFileContent = vi.fn(overrides.readFileContent ?? (async () => ""));
  const readWorkspaceDirectory = vi.fn(async () => [] as FileEntry[]);
  const workspaceTargetCollectorDeps: WorkspaceTargetCollectorDeps = {
    currentWorkspaceRootRef: ref,
    textSearch: { searchText },
    readFileContent,
    readWorkspaceDirectory,
    relativeWorkspacePath,
    joinWorkspacePath,
    isPhpPath,
  };

  const deps: PhpLaravelTextSearchTargetCollectorDeps = {
    workspaceRoot: ROOT,
    phpFrameworkProviders: PROVIDERS,
    isLaravelFrameworkActive: true,
    workspaceTargetCollectorDeps,
    ...overrides,
  };

  return {
    collectors: createPhpLaravelTextSearchTargetCollectors(deps),
    ref,
    readFileContent,
    searchText,
  };
}

describe("createPhpLaravelTextSearchTargetCollectors", () => {
  it("collects named routes from the current document and provider search queries", async () => {
    const currentSource =
      "<?php\nRoute::get('/comments')->name('comments.current');\n";
    const currentPath = `${ROOT}/routes/web.php`;
    const externalPath = `${ROOT}/routes/api.php`;
    const externalSource =
      "<?php\nRoute::get('/api/comments')->name('comments.api');\n";
    const { collectors, readFileContent, searchText } = createDeps({
      searchText: async () => [searchResult(currentPath), searchResult(externalPath)],
      readFileContent: async (path) => (path === externalPath ? externalSource : ""),
    });

    const targets = await collectors.collectNamedRoutes(
      currentSource,
      currentPath,
    );

    const expected = [
      ...phpFrameworkRouteDefinitionsFromSource(currentSource, PROVIDERS).map(
        (definition) => ({
          ...definition,
          path: currentPath,
          relativePath: "routes/web.php",
        }),
      ),
      ...phpFrameworkRouteDefinitionsFromSource(externalSource, PROVIDERS).map(
        (definition) => ({
          ...definition,
          path: externalPath,
          relativePath: "routes/api.php",
        }),
      ),
    ].sort((left, right) => {
      const nameOrder = left.name.localeCompare(right.name);

      if (nameOrder !== 0) {
        return nameOrder;
      }

      return left.path.localeCompare(right.path);
    });

    expect(targets).toEqual(expected);
    expect(searchText).toHaveBeenCalledWith(ROOT, "->name(", 200);
    expect(readFileContent).toHaveBeenCalledTimes(1);
    expect(readFileContent).toHaveBeenCalledWith(externalPath);
  });

  it("gates routes by route-capable providers and gates abilities by Laravel activity", async () => {
    const routeSource = "<?php\nRoute::get('/x')->name('x');\n";
    const gateSource = "<?php\nGate::define('update-post', fn () => true);\n";
    const { collectors, searchText } = createDeps({
      isLaravelFrameworkActive: false,
    });

    const routeTargets = await collectors.collectNamedRoutes(
      routeSource,
      `${ROOT}/routes/web.php`,
    );
    const routeSearchCount = searchText.mock.calls.length;

    expect(routeTargets).toEqual(
      phpFrameworkRouteDefinitionsFromSource(routeSource, PROVIDERS).map(
        (definition) => ({
          ...definition,
          path: `${ROOT}/routes/web.php`,
          relativePath: "routes/web.php",
        }),
      ),
    );
    expect(routeSearchCount).toBeGreaterThan(0);
    expect(
      await collectors.collectGateAbilities(
        gateSource,
        `${ROOT}/app/Providers/AuthServiceProvider.php`,
      ),
    ).toEqual([]);
    expect(searchText).toHaveBeenCalledTimes(routeSearchCount);

    const inactiveRoutes = createDeps({ phpFrameworkProviders: [] });
    expect(
      await inactiveRoutes.collectors.collectNamedRoutes(
        routeSource,
        `${ROOT}/routes/web.php`,
      ),
    ).toEqual([]);
    expect(inactiveRoutes.searchText).not.toHaveBeenCalled();
  });

  it("collects gate abilities with the existing parser and Gate::define query", async () => {
    const source = `<?php\n\nGate::define('update-post', [PostPolicy::class, 'update']);\nGate::define('delete-post', fn ($user) => $user->isAdmin());\n`;
    const currentPath = `${ROOT}/app/Providers/AuthServiceProvider.php`;
    const { collectors, searchText } = createDeps();

    const targets = await collectors.collectGateAbilities(source, currentPath);

    const expected = phpLaravelGateAbilityDefinitions(source)
      .map((definition) => ({
        ...definition,
        path: currentPath,
        relativePath: "app/Providers/AuthServiceProvider.php",
      }))
      .sort((left, right) => {
        const nameOrder = left.name.localeCompare(right.name);

        if (nameOrder !== 0) {
          return nameOrder;
        }

        return left.path.localeCompare(right.path);
      });

    expect(targets).toEqual(expected);
    expect(searchText).toHaveBeenCalledWith(ROOT, "Gate::define", 200);
  });

  it("collects middleware aliases with both legacy Kernel anchors", async () => {
    const source = `<?php\n\nclass Kernel {\n    protected $middlewareAliases = [\n        'auth' => Authenticate::class,\n        'verified' => EnsureEmailIsVerified::class,\n    ];\n}\n`;
    const currentPath = `${ROOT}/app/Http/Kernel.php`;
    const { collectors, searchText } = createDeps();

    const targets = await collectors.collectMiddlewareAliases(source, currentPath);

    const expected = phpLaravelMiddlewareAliasDefinitions(source)
      .map((definition) => ({
        ...definition,
        path: currentPath,
        relativePath: "app/Http/Kernel.php",
      }))
      .sort((left, right) => {
        const nameOrder = left.name.localeCompare(right.name);

        if (nameOrder !== 0) {
          return nameOrder;
        }

        return left.path.localeCompare(right.path);
      });

    expect(targets).toEqual(expected);
    expect(searchText).toHaveBeenCalledWith(ROOT, "middlewareAliases", 200);
    expect(searchText).toHaveBeenCalledWith(ROOT, "routeMiddleware", 200);
  });

  it("drops text-search results when the workspace root changes mid-flight", async () => {
    const deferred = createDeferred<TextSearchResult[]>();
    const { collectors, ref } = createDeps({
      searchText: () => deferred.promise,
    });

    const pending = collectors.collectGateAbilities(
      "<?php\nGate::define('leaked', fn () => true);\n",
      `${ROOT}/app/Providers/AuthServiceProvider.php`,
    );

    ref.current = "/other";
    deferred.resolve([]);

    expect(await pending).toEqual([]);
  });
});
