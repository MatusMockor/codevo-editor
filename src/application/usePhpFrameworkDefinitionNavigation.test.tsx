// @vitest-environment jsdom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";
import type { EditorPosition } from "../domain/languageServerFeatures";
import { phpLaravelFrameworkProvider } from "../domain/phpFrameworkProviders";
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
const LARAVEL_RUNTIME_WITHOUT_ROUTES: PhpFrameworkRuntimeContext = {
  ...LARAVEL_RUNTIME,
  supports: (capability) => capability !== "routes",
  supportsTargetCollection: (kind) => kind !== "routes",
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
  searchText = vi.fn(async () => []),
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
    isLaravelFrameworkActive: true,
    openNavigationTarget: vi.fn(async () => true),
    openPhpClassTarget: vi.fn(async () => true),
    providers: [phpLaravelFrameworkProvider],
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

  it("requires the runtime routes capability for Laravel dispatch handler navigation", async () => {
    const openNavigationTarget = vi.fn(async () => true);
    const openPhpClassTarget = vi.fn(async () => false);
    const readNavigationFileContent = vi.fn(async () => {
      throw new Error("runtime without routes should not read Laravel handlers");
    });
    const resolvePhpClassSourcePaths = vi.fn(async () => [
      `${ROOT}/app/Jobs/SyncOrder.php`,
    ]);
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
      .providePhpFrameworkDefinition(source, source.indexOf("dispatch") + 2);

    expect(handled).toBe(false);
    expect(resolvePhpClassSourcePaths).not.toHaveBeenCalled();
    expect(readNavigationFileContent).not.toHaveBeenCalled();
    expect(openNavigationTarget).not.toHaveBeenCalled();

    harness.unmount();
  });

  it("uses runtime providers for literal navigation when runtime overrides legacy Laravel providers", async () => {
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
});
