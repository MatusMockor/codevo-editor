// @vitest-environment jsdom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";
import type { EditorPosition } from "../domain/languageServerFeatures";
import {
  phpLaravelFrameworkProvider,
  type PhpFrameworkProvider,
} from "../domain/phpFrameworkProviders";
import type {
  EditorDocument,
  TextSearchGateway,
  WorkspaceDescriptor,
} from "../domain/workspace";
import { createPhpFrameworkIntelligence } from "./phpFrameworkIntelligence";
import {
  createPhpFrameworkRuntimeContext,
  type PhpFrameworkRuntimeContext,
} from "./phpFrameworkRuntimeContext";
import {
  usePhpFrameworkDefinitionNavigation,
  type PhpFrameworkDefinitionNavigation,
  type PhpFrameworkDefinitionNavigationDependencies,
} from "./usePhpFrameworkDefinitionNavigation";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

const ROOT = "/workspace";
const OTHER_ROOT = "/other";
const LARAVEL_RUNTIME = createPhpFrameworkRuntimeContext(
  createPhpFrameworkIntelligence({
    matchedProviderIds: ["laravel"],
    profile: "laravel",
    providers: [phpLaravelFrameworkProvider],
  }),
);
const GENERIC_RUNTIME = createPhpFrameworkRuntimeContext(
  createPhpFrameworkIntelligence({
    matchedProviderIds: [],
    profile: "generic",
    providers: [],
  }),
);
const ROUTE_CAPABLE_PROVIDER: PhpFrameworkProvider = {
  id: "route-capable",
  routes: {
    explicitModelBindingClassNameFromSource: ({ parameterName, source }) => {
      const pattern = new RegExp(
        `bindModel\\(['"]${parameterName}['"],\\s*([A-Za-z_][A-Za-z0-9_]*)::class\\)`,
      );

      return pattern.exec(source)?.[1] ?? null;
    },
    explicitModelBindingSearchQueries: ["bindModel("],
    modelBindingAt: ({ offset, source }) => {
      const parameterStart = source.indexOf("{account}");

      if (parameterStart < 0) {
        return null;
      }

      const parameterEnd = parameterStart + "{account}".length;

      if (offset < parameterStart || offset > parameterEnd) {
        return null;
      }

      return {
        explicitModelClassName: null,
        modelShortName: "Account",
        parameterEnd,
        parameterName: "account",
        parameterStart,
      };
    },
    modelNamespacePrefixes: () => ["App\\Models\\"],
  },
};
const ROUTE_CAPABLE_RUNTIME = createPhpFrameworkRuntimeContext(
  createPhpFrameworkIntelligence({
    matchedProviderIds: ["route-capable"],
    profile: "generic",
    providers: [ROUTE_CAPABLE_PROVIDER],
  }),
);
const LARAVEL_RUNTIME_WITHOUT_ROUTES: PhpFrameworkRuntimeContext = {
  ...LARAVEL_RUNTIME,
  supports: (capability) => capability !== "routes",
  supportsTargetCollection: (kind) => kind !== "routes",
};
const LARAVEL_RUNTIME_WITHOUT_DISPATCH: PhpFrameworkRuntimeContext = {
  ...LARAVEL_RUNTIME,
  supports: (capability) => capability !== "dispatch",
};
const LARAVEL_RUNTIME_WITHOUT_STRING_LITERALS: PhpFrameworkRuntimeContext = {
  ...LARAVEL_RUNTIME,
  supports: (capability) => capability !== "stringLiterals",
};

function makeDescriptor(): WorkspaceDescriptor {
  return {
    javaScriptTypeScript: null,
    php: {
      classmapRoots: [],
      hasComposer: true,
      packageName: null,
      packages: [],
      phpPlatformVersion: null,
      phpVersionConstraint: null,
      psr4Roots: [{ dev: false, namespace: "App\\", paths: [`${ROOT}/app`] }],
    },
    rootPath: ROOT,
  };
}

function makeTextSearch(
  searchText: TextSearchGateway["searchText"] = vi.fn(async () => []),
): TextSearchGateway {
  return {
    replaceInPath: vi.fn(async () => ({
      files: [],
      totalReplacements: 0,
    })),
    searchText,
  };
}

function makeDeps(
  overrides: Partial<PhpFrameworkDefinitionNavigationDependencies> = {},
): PhpFrameworkDefinitionNavigationDependencies {
  return {
    activeDocument: {
      content: "",
      language: "php",
      name: "routes.php",
      path: `${ROOT}/routes/web.php`,
      savedContent: "",
    },
    currentWorkspaceRootRef: { current: ROOT },
    frameworkLiteralNavigationDependencies: {
      collectNamedRouteTargets: vi.fn(async () => []),
      findConfigTarget: vi.fn(async () => null),
      findEnvTarget: vi.fn(async () => null),
      findTranslationTarget: vi.fn(async () => null),
      findViewTarget: vi.fn(async () => null),
    },
    frameworkRuntime: LARAVEL_RUNTIME,
    openNavigationTarget: vi.fn(async () => true),
    openPhpClassTarget: vi.fn(async () => true),
    readNavigationFileContent: vi.fn(async () => ""),
    resolvePhpClassSourcePaths: vi.fn(async () => []),
    textSearch: makeTextSearch(),
    workspaceDescriptor: makeDescriptor(),
    workspaceRoot: ROOT,
    ...overrides,
  };
}

function renderHook(deps: PhpFrameworkDefinitionNavigationDependencies) {
  const container = document.createElement("div");
  const root = createRoot(container);
  const captured: { api: PhpFrameworkDefinitionNavigation | null } = {
    api: null,
  };

  function Harness({
    dependencies,
  }: {
    dependencies: PhpFrameworkDefinitionNavigationDependencies;
  }) {
    captured.api = usePhpFrameworkDefinitionNavigation(dependencies);
    return null;
  }

  act(() => {
    root.render(<Harness dependencies={deps} />);
  });

  const api = (): PhpFrameworkDefinitionNavigation => {
    if (!captured.api) {
      throw new Error("hook not mounted");
    }

    return captured.api;
  };

  return {
    api,
    unmount: () => {
      act(() => {
        root.unmount();
      });
    },
  };
}

function position(lineNumber: number, column: number): EditorPosition {
  return { column, lineNumber };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((innerResolve) => {
    resolve = innerResolve;
  });

  return { promise, resolve };
}

describe("usePhpFrameworkDefinitionNavigation", () => {
  it("opens Laravel dispatch handlers before falling back to plain class navigation", async () => {
    const jobPath = `${ROOT}/app/Jobs/SyncOrder.php`;
    const openNavigationTarget = vi.fn(async () => true);
    const openPhpClassTarget = vi.fn(async () => true);
    const deps = makeDeps({
      openNavigationTarget,
      openPhpClassTarget,
      readNavigationFileContent: vi.fn(
        async () => "<?php class SyncOrder { public function handle() {} }",
      ),
      resolvePhpClassSourcePaths: vi.fn(async () => [jobPath]),
    });
    const harness = renderHook(deps);
    const source = `<?php\nuse App\\Jobs\\SyncOrder;\ndispatch(new SyncOrder());`;

    const handled = await harness
      .api()
      .providePhpFrameworkDefinition(source, source.indexOf("SyncOrder());"));

    expect(handled).toBe(true);
    expect(openNavigationTarget).toHaveBeenCalledWith(
      jobPath,
      position(1, 41),
      "SyncOrder",
    );
    expect(openPhpClassTarget).not.toHaveBeenCalled();

    harness.unmount();
  });

  it("opens explicit route model bindings before implicit model namespace fallbacks", async () => {
    const openPhpClassTarget = vi.fn(async () => true);
    const deps = makeDeps({ openPhpClassTarget });
    const harness = renderHook(deps);
    const source = `<?php\nuse Illuminate\\Support\\Facades\\Route;\nuse App\\Models\\AdminUser;\nRoute::model('user', AdminUser::class);\nRoute::get('/users/{user}', fn () => null);`;

    const handled = await harness
      .api()
      .providePhpFrameworkDefinition(source, source.indexOf("{user}") + 2);

    expect(handled).toBe(true);
    expect(openPhpClassTarget).toHaveBeenCalledTimes(1);
    expect(openPhpClassTarget).toHaveBeenCalledWith(
      "App\\Models\\AdminUser",
      "AdminUser",
    );

    harness.unmount();
  });

  it("requires the runtime routes capability for Laravel route model binding", async () => {
    const openPhpClassTarget = vi.fn(async () => false);
    const searchText = vi.fn(async () => []);
    const deps = makeDeps({
      frameworkRuntime: LARAVEL_RUNTIME_WITHOUT_ROUTES,
      openPhpClassTarget,
      textSearch: makeTextSearch(searchText),
    });
    const harness = renderHook(deps);
    const source = `<?php\nuse Illuminate\\Support\\Facades\\Route;\nuse App\\Models\\AdminUser;\nRoute::model('user', AdminUser::class);\nRoute::get('/users/{user}', fn () => null);`;

    const handled = await harness
      .api()
      .providePhpFrameworkDefinition(source, source.indexOf("{user}") + 2);

    expect(handled).toBe(false);
    expect(openPhpClassTarget).not.toHaveBeenCalledWith(
      "App\\Models\\AdminUser",
      "AdminUser",
    );
    expect(searchText).not.toHaveBeenCalled();

    harness.unmount();
  });

  it("does not require the runtime routes capability for Laravel dispatch handler navigation", async () => {
    const jobPath = `${ROOT}/app/Jobs/SyncOrder.php`;
    const openNavigationTarget = vi.fn(async () => true);
    const openPhpClassTarget = vi.fn(async () => false);
    const readNavigationFileContent = vi.fn(
      async () => "<?php class SyncOrder { public function handle() {} }",
    );
    const resolvePhpClassSourcePaths = vi.fn(async () => [jobPath]);
    const deps = makeDeps({
      frameworkRuntime: LARAVEL_RUNTIME_WITHOUT_ROUTES,
      openNavigationTarget,
      openPhpClassTarget,
      readNavigationFileContent,
      resolvePhpClassSourcePaths,
    });
    const harness = renderHook(deps);
    const source = `<?php\nuse App\\Jobs\\SyncOrder;\ndispatch(new SyncOrder());`;

    const handled = await harness
      .api()
      .providePhpFrameworkDefinition(source, source.indexOf("SyncOrder());"));

    expect(handled).toBe(true);
    expect(openNavigationTarget).toHaveBeenCalledWith(
      jobPath,
      position(1, 41),
      "SyncOrder",
    );
    expect(openPhpClassTarget).not.toHaveBeenCalled();

    harness.unmount();
  });

  it("requires the runtime dispatch capability for Laravel dispatch handler navigation", async () => {
    const openNavigationTarget = vi.fn(async () => true);
    const openPhpClassTarget = vi.fn(async () => false);
    const readNavigationFileContent = vi.fn(async () => {
      throw new Error("runtime without dispatch should not read handlers");
    });
    const resolvePhpClassSourcePaths = vi.fn(async () => [
      `${ROOT}/app/Jobs/SyncOrder.php`,
    ]);
    const deps = makeDeps({
      frameworkRuntime: LARAVEL_RUNTIME_WITHOUT_DISPATCH,
      openNavigationTarget,
      openPhpClassTarget,
      readNavigationFileContent,
      resolvePhpClassSourcePaths,
    });
    const harness = renderHook(deps);
    const source = `<?php\nuse App\\Jobs\\SyncOrder;\ndispatch(new SyncOrder());`;

    const handled = await harness
      .api()
      .providePhpFrameworkDefinition(source, source.indexOf("dispatch") + 2);

    expect(handled).toBe(false);
    expect(resolvePhpClassSourcePaths).not.toHaveBeenCalled();
    expect(readNavigationFileContent).not.toHaveBeenCalled();
    expect(openNavigationTarget).not.toHaveBeenCalled();

    harness.unmount();
  });

  it("opens route model bindings for a route-capable non-Laravel provider", async () => {
    const openPhpClassTarget = vi.fn(async () => true);
    const deps = makeDeps({
      frameworkRuntime: ROUTE_CAPABLE_RUNTIME,
      openPhpClassTarget,
    });
    const harness = renderHook(deps);
    const source = `<?php\nframeworkRoute('/accounts/{account}');`;

    const handled = await harness
      .api()
      .providePhpFrameworkDefinition(source, source.indexOf("{account}") + 2);

    expect(handled).toBe(true);
    expect(openPhpClassTarget).toHaveBeenCalledWith(
      "App\\Models\\Account",
      "Account",
    );

    harness.unmount();
  });

  it("uses provider-supplied explicit route model-binding search queries", async () => {
    const bindingPath = `${ROOT}/routes/bindings.php`;
    const openPhpClassTarget = vi.fn(async () => true);
    const searchText = vi.fn(async () => [
      {
        column: 1,
        lineNumber: 1,
        lineText: "bindModel(",
        path: bindingPath,
        preview: "bindModel(",
        relativePath: "routes/bindings.php",
      },
    ]);
    const deps = makeDeps({
      frameworkRuntime: ROUTE_CAPABLE_RUNTIME,
      openPhpClassTarget,
      readNavigationFileContent: vi.fn(
        async () =>
          "<?php\nuse App\\Models\\ExternalAccount;\nbindModel('account', ExternalAccount::class);",
      ),
      textSearch: makeTextSearch(searchText),
    });
    const harness = renderHook(deps);
    const source = `<?php\nframeworkRoute('/accounts/{account}');`;

    const handled = await harness
      .api()
      .providePhpFrameworkDefinition(source, source.indexOf("{account}") + 2);

    expect(handled).toBe(true);
    expect(searchText).toHaveBeenCalledTimes(1);
    expect(searchText).toHaveBeenCalledWith(ROOT, "bindModel(", 100);
    expect(searchText).not.toHaveBeenCalledWith(ROOT, "Route::model", 100);
    expect(searchText).not.toHaveBeenCalledWith(ROOT, "Route::bind", 100);
    expect(openPhpClassTarget).toHaveBeenCalledWith(
      "App\\Models\\ExternalAccount",
      "ExternalAccount",
    );

    harness.unmount();
  });

  it("skips literal navigation when the generic runtime exposes no framework providers", async () => {
    const findViewTarget = vi.fn(async () => ({
      name: "orders.show",
      path: `${ROOT}/resources/views/orders/show.blade.php`,
      position: position(1, 1),
    }));
    const openNavigationTarget = vi.fn(async () => true);
    const activeDocument: EditorDocument = {
      content: "",
      language: "php",
      name: "Controller.php",
      path: `${ROOT}/app/Http/Controllers/Controller.php`,
      savedContent: "",
    };
    const deps = makeDeps({
      activeDocument,
      frameworkRuntime: GENERIC_RUNTIME,
      frameworkLiteralNavigationDependencies: {
        collectNamedRouteTargets: vi.fn(async () => []),
        findConfigTarget: vi.fn(async () => null),
        findEnvTarget: vi.fn(async () => null),
        findTranslationTarget: vi.fn(async () => null),
        findViewTarget,
      },
      openNavigationTarget,
    });
    const harness = renderHook(deps);
    const source = "<?php view('orders.show');";

    const handled = await harness
      .api()
      .providePhpFrameworkDefinition(source, source.indexOf("orders.show") + 2);

    expect(handled).toBe(false);
    expect(findViewTarget).not.toHaveBeenCalled();
    expect(openNavigationTarget).not.toHaveBeenCalled();

    harness.unmount();
  });

  it("requires the runtime stringLiterals capability for direct literal navigation", async () => {
    const findConfigTarget = vi.fn(async () => ({
      key: "app.name",
      path: `${ROOT}/config/app.php`,
      position: position(1, 1),
    }));
    const openNavigationTarget = vi.fn(async () => true);
    const deps = makeDeps({
      frameworkRuntime: LARAVEL_RUNTIME_WITHOUT_STRING_LITERALS,
      frameworkLiteralNavigationDependencies: {
        collectNamedRouteTargets: vi.fn(async () => []),
        findConfigTarget,
        findEnvTarget: vi.fn(async () => null),
        findTranslationTarget: vi.fn(async () => null),
        findViewTarget: vi.fn(async () => null),
      },
      openNavigationTarget,
    });
    const harness = renderHook(deps);
    const source = "<?php config('app.name');";

    const handled = await harness
      .api()
      .providePhpFrameworkDefinition(source, source.indexOf("app.name") + 2);

    expect(handled).toBe(false);
    expect(findConfigTarget).not.toHaveBeenCalled();
    expect(openNavigationTarget).not.toHaveBeenCalled();

    harness.unmount();
  });

  it("drops literal navigation when the active workspace changes after an awaited finder", async () => {
    const viewTarget = deferred<{
      name: string;
      path: string;
      position: EditorPosition;
    } | null>();
    const currentWorkspaceRootRef = { current: ROOT };
    const openNavigationTarget = vi.fn(async () => true);
    const activeDocument: EditorDocument = {
      content: "",
      language: "php",
      name: "Controller.php",
      path: `${ROOT}/app/Http/Controllers/Controller.php`,
      savedContent: "",
    };
    const deps = makeDeps({
      activeDocument,
      currentWorkspaceRootRef,
      frameworkLiteralNavigationDependencies: {
        collectNamedRouteTargets: vi.fn(async () => []),
        findConfigTarget: vi.fn(async () => null),
        findEnvTarget: vi.fn(async () => null),
        findTranslationTarget: vi.fn(async () => null),
        findViewTarget: vi.fn(() => viewTarget.promise),
      },
      openNavigationTarget,
    });
    const harness = renderHook(deps);
    const source = "<?php view('orders.show');";
    const navigationPromise = harness
      .api()
      .providePhpFrameworkDefinition(source, source.indexOf("orders.show") + 2);

    currentWorkspaceRootRef.current = OTHER_ROOT;
    viewTarget.resolve({
      name: "orders.show",
      path: `${ROOT}/resources/views/orders/show.blade.php`,
      position: position(1, 1),
    });

    await expect(navigationPromise).resolves.toBe(false);
    expect(openNavigationTarget).not.toHaveBeenCalled();

    harness.unmount();
  });

  it("drops literal navigation when the definition request becomes stale after an awaited finder", async () => {
    const viewTarget = deferred<{
      name: string;
      path: string;
      position: EditorPosition;
    } | null>();
    let requestActive = true;
    const openNavigationTarget = vi.fn(async () => true);
    const activeDocument: EditorDocument = {
      content: "",
      language: "php",
      name: "Controller.php",
      path: `${ROOT}/app/Http/Controllers/Controller.php`,
      savedContent: "",
    };
    const deps = makeDeps({
      activeDocument,
      frameworkLiteralNavigationDependencies: {
        collectNamedRouteTargets: vi.fn(async () => []),
        findConfigTarget: vi.fn(async () => null),
        findEnvTarget: vi.fn(async () => null),
        findTranslationTarget: vi.fn(async () => null),
        findViewTarget: vi.fn(() => viewTarget.promise),
      },
      openNavigationTarget,
    });
    const harness = renderHook(deps);
    const source = "<?php view('orders.show');";
    const navigationPromise = harness
      .api()
      .providePhpFrameworkDefinition(
        source,
        source.indexOf("orders.show") + 2,
        { canNavigate: () => requestActive },
      );

    requestActive = false;
    viewTarget.resolve({
      name: "orders.show",
      path: `${ROOT}/resources/views/orders/show.blade.php`,
      position: position(1, 1),
    });

    await expect(navigationPromise).resolves.toBe(false);
    expect(openNavigationTarget).not.toHaveBeenCalled();

    harness.unmount();
  });
});
